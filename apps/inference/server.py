"""
Local image model inference server (Hugging Face diffusers).

Keeps one image model resident on the GPU (Apple Metal / CUDA / CPU fallback)
and swaps it when a request asks for another one from the MODELS registry:

  - flux2-klein-4b        FLUX.2 [klein] 4B (bf16): text-to-image, multi-reference editing, inpainting
  - qwen-image-2.1-turbo  Qwen-Image 2.1 Turbo, Q8 GGUF denoiser + Q8 GGUF uncensored Qwen3-VL encoder
                          (see qwen_gguf.py): text-to-image and multi-reference editing

Tiny HTTP API used by the NestJS API:

  GET  /health            -> loading state, device, loaded model, available models
  POST /generate          -> PNG bytes (text-to-image, multi-reference editing, inpainting)
  POST /enhance           -> {"text": ...} chat completion with the loaded model's own text encoder
  POST /models/{id}/load  -> switch the resident model now (generate does it on demand)
  POST /cancel/{request}  -> interrupt a running generation

Weights are loaded from the default Hugging Face cache (~/.cache/huggingface/hub,
or $HF_HOME); nothing is stored in the app folder.
"""

from __future__ import annotations

import base64
import gc
import io
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Callable, Optional

from pathlib import Path


def load_dotenv() -> None:
    """Load the repository's root .env, overriding inherited variables (shell
    helpers may export stale copies of it). IMAGEGEN_IGNORE_DOTENV=1 skips it."""
    env_file = Path(__file__).resolve().parents[2] / ".env"
    if os.environ.get("IMAGEGEN_IGNORE_DOTENV") or not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        os.environ[key.strip()] = value


load_dotenv()

import torch  # noqa: E402  (after .env so torch/HF see its settings)
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.concurrency import run_in_threadpool  # noqa: E402
from fastapi.responses import Response  # noqa: E402
from PIL import Image, ImageFilter  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

FLUX_REPO = "black-forest-labs/FLUX.2-klein-4B"
# FLUX.2 klein only: 4 steps / guidance 1.0 is what the distilled model is tuned for.
FLUX_STEPS = int(os.environ.get("INFERENCE_STEPS", "4"))
FLUX_GUIDANCE = float(os.environ.get("INFERENCE_GUIDANCE", "1.0"))

log = logging.getLogger("inference")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [inference] %(message)s")


def pick_device() -> tuple[str, torch.dtype]:
    forced = os.environ.get("INFERENCE_DEVICE")
    if forced:
        return forced, torch.bfloat16 if forced != "cpu" else torch.float32
    if torch.cuda.is_available():
        return "cuda", torch.bfloat16
    if torch.backends.mps.is_available():
        return "mps", torch.bfloat16
    return "cpu", torch.float32


@dataclass
class Loaded:
    """A resident model: its pipelines plus the causal LM used by the prompt enhancer."""

    id: str
    pipe: object
    tokenizer: object
    lm: object
    inpaint_pipe: object = None


def load_flux(device: str, dtype: torch.dtype) -> Loaded:
    from diffusers import Flux2KleinInpaintPipeline, Flux2KleinPipeline

    try:
        pipe = Flux2KleinPipeline.from_pretrained(FLUX_REPO, torch_dtype=dtype, local_files_only=True)
    except Exception:
        log.info("Model not fully in the local Hugging Face cache, downloading…")
        pipe = Flux2KleinPipeline.from_pretrained(FLUX_REPO, torch_dtype=dtype)
    pipe.to(device)
    pipe.set_progress_bar_config(disable=True)
    # Same weights, second pipeline: no extra memory.
    inpaint = Flux2KleinInpaintPipeline.from_pipe(pipe)
    inpaint.set_progress_bar_config(disable=True)
    return Loaded("flux2-klein-4b", pipe, pipe.tokenizer, pipe.text_encoder, inpaint)


def load_qwen(device: str, dtype: torch.dtype) -> Loaded:
    import qwen_gguf

    pipe = qwen_gguf.load_pipeline(dtype)
    pipe.to(device)
    pipe.set_progress_bar_config(disable=True)
    return Loaded("qwen-image-2.1-turbo", pipe, pipe.processor.tokenizer, pipe.text_encoder)


@dataclass
class ModelSpec:
    label: str
    load: Callable[[str, torch.dtype], Loaded]
    #: Pixel dimensions are rounded to this multiple.
    multiple: int = 16


MODELS: dict[str, ModelSpec] = {
    "flux2-klein-4b": ModelSpec("FLUX.2 [klein] 4B", load_flux),
    "qwen-image-2.1-turbo": ModelSpec("Qwen-Image 2.1 Turbo (Q8 GGUF)", load_qwen, multiple=32),
}
ALIASES = {FLUX_REPO: "flux2-klein-4b"}


def resolve_model(model_id: Optional[str]) -> str:
    model_id = ALIASES.get(model_id or "", model_id) or DEFAULT_MODEL
    if model_id not in MODELS:
        raise HTTPException(400, f"Unknown model {model_id!r}. Available: {', '.join(MODELS)}")
    return model_id


DEFAULT_MODEL = ALIASES.get(os.environ.get("IMAGE_MODEL", ""), os.environ.get("IMAGE_MODEL") or "flux2-klein-4b")
if DEFAULT_MODEL not in MODELS:
    DEFAULT_MODEL = "flux2-klein-4b"


class Engine:
    """Owns the resident model. All GPU work (and model swaps) is serialized behind a single lock."""

    def __init__(self) -> None:
        self.device, self.dtype = pick_device()
        self.status = "loading"
        self.error: Optional[str] = None
        self.model_id = DEFAULT_MODEL  # loaded, or being loaded
        self.current: Optional[Loaded] = None
        self.lock = threading.Lock()
        self.cancelled: set[str] = set()
        self.loaded_in: Optional[float] = None

    def startup(self) -> None:
        with self.lock:
            self._switch(DEFAULT_MODEL)

    def ensure(self, model_id: str) -> float:
        """Make `model_id` resident (caller holds the lock). Returns the load time, 0 if it already was."""
        if self.current and self.current.id == model_id:
            return 0.0
        return self._switch(model_id)

    def _switch(self, model_id: str) -> float:
        spec = MODELS[model_id]
        self.model_id, self.status, self.error = model_id, "loading", None
        if self.current is not None:
            log.info("Unloading %s…", self.current.id)
            self.current = None
            gc.collect()
            if self.device == "mps":
                torch.mps.empty_cache()
            elif self.device == "cuda":
                torch.cuda.empty_cache()
        started = time.time()
        log.info("Loading %s on %s (%s)…", spec.label, self.device, self.dtype)
        try:
            self.current = spec.load(self.device, self.dtype)
        except Exception as exc:  # noqa: BLE001
            log.exception("Model failed to load")
            self.status = "error"
            self.error = f"{type(exc).__name__}: {exc}"
            raise HTTPException(500, f"{spec.label} failed to load: {self.error}") from exc
        self.loaded_in = time.time() - started
        self.status = "ready"
        log.info("%s ready in %.1fs", spec.label, self.loaded_in)
        return self.loaded_in

    # -- image ----------------------------------------------------------------

    def _interrupt_cb(self, request_id: Optional[str]):
        def callback(pipe, step, timestep, kwargs):
            if request_id and request_id in self.cancelled:
                pipe._interrupt = True
            return kwargs

        return callback

    def generate(self, req: "GenerateRequest") -> tuple[Image.Image, float, float]:
        model_id = resolve_model(req.model)
        with self.lock:
            if req.request_id and req.request_id in self.cancelled:
                self.cancelled.discard(req.request_id)
                raise Cancelled()
            load_seconds = self.ensure(model_id)
            m = self.current
            started = time.time()
            generator = torch.Generator("cpu").manual_seed(req.seed)
            refs = [decode_image(r) for r in req.references]
            multiple = MODELS[model_id].multiple
            callback = self._interrupt_cb(req.request_id)
            with torch.inference_mode():
                if model_id == "qwen-image-2.1-turbo":
                    if req.inpaint:
                        raise HTTPException(400, "Qwen-Image 2.1 has no native inpainting (the API emulates it)")
                    # Steps and sigmas come from the checkpoint (8-step Turbo schedule), guidance is off.
                    image = m.pipe(
                        prompt=req.prompt,
                        image=refs or None,
                        width=snap(req.width, multiple),
                        height=snap(req.height, multiple),
                        generator=generator,
                        callback_on_step_end=callback,
                    ).images[0]
                else:
                    common = dict(
                        prompt=req.prompt,
                        num_inference_steps=req.steps or FLUX_STEPS,
                        guidance_scale=req.guidance if req.guidance is not None else FLUX_GUIDANCE,
                        generator=generator,
                        callback_on_step_end=callback,
                    )
                    if req.inpaint:
                        source = decode_image(req.inpaint.image)
                        mask = decode_image(req.inpaint.mask, mode="L")
                        width, height = snap(source.width, multiple), snap(source.height, multiple)
                        # Soft edges blend the new content into its surroundings.
                        blur = max(4, round(min(width, height) / 96))
                        mask = mask.resize(source.size).filter(ImageFilter.GaussianBlur(blur))
                        pipe = m.inpaint_pipe
                        pipe._interrupt = False
                        image = pipe(
                            image=source,
                            mask_image=mask,
                            image_reference=refs or None,
                            strength=req.inpaint.strength,
                            width=width,
                            height=height,
                            **common,
                        ).images[0]
                    else:
                        pipe = m.pipe
                        pipe._interrupt = False
                        image = pipe(
                            image=refs or None,
                            width=snap(req.width, multiple),
                            height=snap(req.height, multiple),
                            **common,
                        ).images[0]
            if req.request_id and req.request_id in self.cancelled:
                self.cancelled.discard(req.request_id)
                raise Cancelled()
            if self.device == "mps":
                torch.mps.empty_cache()
            return image, time.time() - started, load_seconds

    def load(self, model_id: str) -> float:
        with self.lock:
            return self.ensure(resolve_model(model_id))

    # -- text (prompt enhancer) -----------------------------------------------

    def enhance(self, req: "EnhanceRequest") -> str:
        """Chat completion with the resident model's text encoder (Qwen3 / Qwen3-VL, both full causal LMs)."""
        self._require_ready()
        with self.lock:
            tok, model = self.current.tokenizer, self.current.lm
            messages = [{"role": "system", "content": req.system}, {"role": "user", "content": req.user}]
            try:
                text = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
            except TypeError:
                text = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
            with torch.inference_mode():
                inputs = tok(text, return_tensors="pt").to(self.device)
                out = model.generate(
                    **inputs,
                    max_new_tokens=req.max_tokens,
                    do_sample=req.temperature > 0,
                    temperature=max(req.temperature, 1e-3),
                    top_p=0.9,
                    pad_token_id=tok.pad_token_id or tok.eos_token_id,
                )
        completion = tok.decode(out[0][inputs["input_ids"].shape[1] :], skip_special_tokens=True)
        return strip_thinking(completion).strip()

    def _require_ready(self) -> None:
        if self.status == "loading":
            raise HTTPException(503, "The model is still loading, try again in a moment.")
        if self.status == "error" or self.current is None:
            raise HTTPException(500, f"The model failed to load: {self.error}")


class Cancelled(Exception):
    pass


def snap(n: int, multiple: int = 16) -> int:
    return max(256, min(2048, int(round(n / multiple)) * multiple))


def decode_image(data: str, mode: str = "RGB") -> Image.Image:
    raw = base64.b64decode(data.split(",", 1)[1] if data.startswith("data:") else data)
    return Image.open(io.BytesIO(raw)).convert(mode)


def strip_thinking(text: str) -> str:
    if "</think>" in text:
        text = text.split("</think>", 1)[1]
    return text.replace("<think>", "")


# -- HTTP -----------------------------------------------------------------------

engine = Engine()


@asynccontextmanager
async def lifespan(_: FastAPI):
    def startup():
        try:
            engine.startup()
        except HTTPException:
            pass  # recorded in engine.status / engine.error

    threading.Thread(target=startup, daemon=True).start()
    yield


app = FastAPI(title="Imagegen local inference", lifespan=lifespan)


class InpaintInput(BaseModel):
    image: str
    mask: str
    strength: float = Field(1.0, ge=0, le=1)


class GenerateRequest(BaseModel):
    model: Optional[str] = None
    prompt: str
    width: int = 1024
    height: int = 1024
    seed: int = 0
    steps: Optional[int] = Field(None, ge=1, le=100)
    guidance: Optional[float] = None
    references: list[str] = []
    inpaint: Optional[InpaintInput] = None
    request_id: Optional[str] = None


class EnhanceRequest(BaseModel):
    system: str
    user: str
    temperature: float = 0.7
    max_tokens: int = 400


@app.get("/health")
def health():
    return {
        "status": engine.status,
        "error": engine.error,
        "model": engine.model_id,
        "defaultModel": DEFAULT_MODEL,
        "models": [{"id": k, "label": v.label} for k, v in MODELS.items()],
        "device": engine.device,
        "dtype": str(engine.dtype).replace("torch.", ""),
        "loadSeconds": engine.loaded_in,
    }


@app.post("/generate")
async def generate(req: GenerateRequest):
    try:
        image, seconds, load_seconds = await run_in_threadpool(engine.generate, req)
    except Cancelled:
        raise HTTPException(499, "Canceled")
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    headers = {"X-Inference-Seconds": f"{seconds:.2f}", "X-Load-Seconds": f"{load_seconds:.2f}"}
    return Response(buf.getvalue(), media_type="image/png", headers=headers)


@app.post("/models/{model_id}/load")
async def load_model(model_id: str):
    seconds = await run_in_threadpool(engine.load, model_id)
    return {"model": engine.model_id, "loadSeconds": seconds}


@app.post("/enhance")
async def enhance(req: EnhanceRequest):
    return {"text": await run_in_threadpool(engine.enhance, req)}


@app.post("/cancel/{request_id}")
def cancel(request_id: str):
    engine.cancelled.add(request_id)
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.environ.get("INFERENCE_HOST", "127.0.0.1"), port=int(os.environ.get("INFERENCE_PORT", "8000")))
