"""
Local FLUX.2 [klein] inference server (Hugging Face diffusers).

Keeps the model resident on the GPU (Apple Metal / CUDA / CPU fallback) and
exposes a tiny HTTP API used by the NestJS API:

  GET  /health            -> loading state, device, model
  POST /generate          -> PNG bytes (text-to-image, multi-reference editing, inpainting)
  POST /enhance           -> {"text": ...} chat completion with the model's own Qwen3 text encoder
  POST /cancel/{request}  -> interrupt a running generation

Weights are loaded from the default Hugging Face cache (~/.cache/huggingface/hub,
or $HF_HOME); nothing is stored in the app folder.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Optional

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

MODEL_ID = os.environ.get("IMAGE_MODEL", "black-forest-labs/FLUX.2-klein-4B")
DEFAULT_STEPS = int(os.environ.get("INFERENCE_STEPS", "4"))
DEFAULT_GUIDANCE = float(os.environ.get("INFERENCE_GUIDANCE", "1.0"))

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


class Engine:
    """Owns the pipelines. All GPU work is serialized behind a single lock."""

    def __init__(self) -> None:
        self.device, self.dtype = pick_device()
        self.status = "loading"
        self.error: Optional[str] = None
        self.pipe = None
        self.inpaint_pipe = None
        self.lock = threading.Lock()
        self.cancelled: set[str] = set()
        self.loaded_in: Optional[float] = None

    def load(self) -> None:
        try:
            from diffusers import Flux2KleinInpaintPipeline, Flux2KleinPipeline

            started = time.time()
            log.info("Loading %s on %s (%s)…", MODEL_ID, self.device, self.dtype)
            try:
                pipe = Flux2KleinPipeline.from_pretrained(MODEL_ID, torch_dtype=self.dtype, local_files_only=True)
            except Exception:
                log.info("Model not fully in the local Hugging Face cache, downloading…")
                pipe = Flux2KleinPipeline.from_pretrained(MODEL_ID, torch_dtype=self.dtype)
            pipe.to(self.device)
            pipe.set_progress_bar_config(disable=True)
            # Same weights, second pipeline: no extra memory.
            self.inpaint_pipe = Flux2KleinInpaintPipeline.from_pipe(pipe)
            self.inpaint_pipe.set_progress_bar_config(disable=True)
            self.pipe = pipe
            self.loaded_in = time.time() - started
            self.status = "ready"
            log.info("Model ready in %.1fs", self.loaded_in)
        except Exception as exc:  # noqa: BLE001
            log.exception("Model failed to load")
            self.status = "error"
            self.error = f"{type(exc).__name__}: {exc}"

    # -- image ----------------------------------------------------------------

    def _interrupt_cb(self, request_id: Optional[str]):
        def callback(pipe, step, timestep, kwargs):
            if request_id and request_id in self.cancelled:
                pipe._interrupt = True
            return kwargs

        return callback

    def generate(self, req: "GenerateRequest") -> tuple[Image.Image, float]:
        self._require_ready()
        with self.lock:
            if req.request_id and req.request_id in self.cancelled:
                self.cancelled.discard(req.request_id)
                raise Cancelled()
            started = time.time()
            generator = torch.Generator("cpu").manual_seed(req.seed)
            refs = [decode_image(r) for r in req.references]
            common = dict(
                prompt=req.prompt,
                num_inference_steps=req.steps or DEFAULT_STEPS,
                guidance_scale=req.guidance if req.guidance is not None else DEFAULT_GUIDANCE,
                generator=generator,
                callback_on_step_end=self._interrupt_cb(req.request_id),
            )
            with torch.inference_mode():
                if req.inpaint:
                    source = decode_image(req.inpaint.image)
                    mask = decode_image(req.inpaint.mask, mode="L")
                    width, height = snap(source.width), snap(source.height)
                    # Soft edges blend the new content into its surroundings.
                    blur = max(4, round(min(width, height) / 96))
                    mask = mask.resize(source.size).filter(ImageFilter.GaussianBlur(blur))
                    pipe = self.inpaint_pipe
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
                    pipe = self.pipe
                    pipe._interrupt = False
                    image = pipe(
                        image=refs or None,
                        width=snap(req.width),
                        height=snap(req.height),
                        **common,
                    ).images[0]
            if req.request_id and req.request_id in self.cancelled:
                self.cancelled.discard(req.request_id)
                raise Cancelled()
            if self.device == "mps":
                torch.mps.empty_cache()
            return image, time.time() - started

    # -- text (prompt enhancer) -----------------------------------------------

    def enhance(self, req: "EnhanceRequest") -> str:
        """Chat completion using FLUX.2 klein's Qwen3 text encoder (a full causal LM)."""
        self._require_ready()
        tok = self.pipe.tokenizer
        model = self.pipe.text_encoder
        messages = [{"role": "system", "content": req.system}, {"role": "user", "content": req.user}]
        try:
            text = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        except TypeError:
            text = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        with self.lock, torch.inference_mode():
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
        if self.status == "error":
            raise HTTPException(500, f"The model failed to load: {self.error}")


class Cancelled(Exception):
    pass


def snap(n: int) -> int:
    return max(256, min(2048, int(round(n / 16)) * 16))


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
    threading.Thread(target=engine.load, daemon=True).start()
    yield


app = FastAPI(title="Imagegen local inference", lifespan=lifespan)


class InpaintInput(BaseModel):
    image: str
    mask: str
    strength: float = Field(1.0, ge=0, le=1)


class GenerateRequest(BaseModel):
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
        "model": MODEL_ID,
        "device": engine.device,
        "dtype": str(engine.dtype).replace("torch.", ""),
        "loadSeconds": engine.loaded_in,
        "defaults": {"steps": DEFAULT_STEPS, "guidance": DEFAULT_GUIDANCE},
    }


@app.post("/generate")
async def generate(req: GenerateRequest):
    try:
        image, seconds = await run_in_threadpool(engine.generate, req)
    except Cancelled:
        raise HTTPException(499, "Canceled")
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return Response(buf.getvalue(), media_type="image/png", headers={"X-Inference-Seconds": f"{seconds:.2f}"})


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
