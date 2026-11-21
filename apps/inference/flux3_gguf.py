"""
FLUX 3 Image [klein] (step-distilled, 16 steps) from GGUF files, run with diffusers' FLUX.3 modular blocks.

  - denoiser:     AtomicChat/FLUX-3-Image-Klein-GGUF                (Q8_0, kept quantized, dequantized per layer)
  - text encoder: AtomicChat/FLUX-3-Image-Klein-TE-Uncensored-GGUF  (Q8_0 Qwen3-VL-4B-Instruct, refusal direction
                  projected out). Klein only reads the language model's hidden states, so the vision tower is
                  not loaded.
  - tokenizer + text encoder config: Qwen/Qwen3-VL-4B-Instruct (small files only; Klein's encoder is that model
                  byte for byte).
  - VAE: FLUX 3 uses FLUX.2's autoencoder, so it is read from black-forest-labs/FLUX.2-klein-4B (vae/ only).

Black Forest Labs' own FLUX 3 repo is gated; none of the files above are, so nothing here needs it. The
transformer config is the diffusers default for Klein plus `flow_map` (the step-distilled embedder), and it is
checked against the GGUF tensor shapes when the model loads.

The prompt upsampler (a separate 9B model) is not used: the app's own prompt enhancer writes captions.
"""

from __future__ import annotations

import json
import logging
import re
import warnings
from pathlib import Path
from typing import Callable, Optional

import torch

from qwen_gguf import _download, _unpack_non_linear_gguf

log = logging.getLogger("inference")

TRANSFORMER = ("AtomicChat/FLUX-3-Image-Klein-GGUF", "FLUX-3-Image-Klein-Q8_0.gguf")
TEXT_ENCODER = ("AtomicChat/FLUX-3-Image-Klein-TE-Uncensored-GGUF", "Qwen3-VL-4B-Instruct-Uncensored-Q8_0.gguf")
ENCODER_REPO = "Qwen/Qwen3-VL-4B-Instruct"
ENCODER_PATTERNS = ["*.json", "merges.txt", "vocab.json"]
VAE_REPO = "black-forest-labs/FLUX.2-klein-4B"

STEPS = 16  # what the step-distilled model is tuned for (CFG off)
SHIFT = 6.93  # FLUX.3's constant timestep shift

# Flux3Transformer2DModel defaults match Klein (5 per-mode + 28 joint blocks, 24 x 128 heads, 8 x 2560 text
# features); the distilled checkpoint adds the target-timestep embedder.
TRANSFORMER_CONFIG = {"_class_name": "Flux3Transformer2DModel", "flow_map": True}


# -- downloads --------------------------------------------------------------------


def _snapshot(repo: str, patterns: list[str]) -> str:
    from huggingface_hub import snapshot_download

    try:
        return snapshot_download(repo, allow_patterns=patterns, local_files_only=True)
    except Exception:
        log.info("Downloading %s (%s)…", repo, ", ".join(patterns))
        return snapshot_download(repo, allow_patterns=patterns)


def _transformer_config_dir() -> str:
    """diffusers' from_single_file wants a config folder; the gated BFL repo has the only official one."""
    from huggingface_hub.constants import HF_HOME

    root = Path(HF_HOME) / "imagegen" / "flux3-klein"
    (root / "transformer").mkdir(parents=True, exist_ok=True)
    (root / "transformer" / "config.json").write_text(json.dumps(TRANSFORMER_CONFIG, indent=2))
    return str(root)


def download_all() -> None:
    _download(*TRANSFORMER)
    _download(*TEXT_ENCODER)
    _snapshot(ENCODER_REPO, ENCODER_PATTERNS)
    _snapshot(VAE_REPO, ["vae/*"])


# -- text encoder from GGUF --------------------------------------------------------

_LAYER_MAP = {
    "attn_norm": "input_layernorm",
    "ffn_norm": "post_attention_layernorm",
    "attn_q": "self_attn.q_proj",
    "attn_k": "self_attn.k_proj",
    "attn_v": "self_attn.v_proj",
    "attn_output": "self_attn.o_proj",
    "attn_q_norm": "self_attn.q_norm",
    "attn_k_norm": "self_attn.k_norm",
    "ffn_gate": "mlp.gate_proj",
    "ffn_up": "mlp.up_proj",
    "ffn_down": "mlp.down_proj",
}
_TOP_MAP = {
    "token_embd.weight": "model.language_model.embed_tokens.weight",
    "output_norm.weight": "model.language_model.norm.weight",
    "output.weight": "lm_head.weight",
}


def _hf_name(gguf_name: str) -> str:
    if gguf_name in _TOP_MAP:
        return _TOP_MAP[gguf_name]
    m = re.fullmatch(r"blk\.(\d+)\.(\w+)\.(weight|bias)", gguf_name)
    if not m or m.group(2) not in _LAYER_MAP:
        raise KeyError(f"Unexpected tensor in the text encoder GGUF: {gguf_name}")
    return f"model.language_model.layers.{m.group(1)}.{_LAYER_MAP[m.group(2)]}.{m.group(3)}"


def _text_encoder(dtype: torch.dtype):
    from accelerate import init_empty_weights
    from gguf import GGUFReader
    from gguf.quants import dequantize
    from transformers import AutoConfig, Qwen3VLForConditionalGeneration

    config = AutoConfig.from_pretrained(_snapshot(ENCODER_REPO, ENCODER_PATTERNS))
    with init_empty_weights(include_buffers=False):
        model = Qwen3VLForConditionalGeneration._from_config(config, torch_dtype=dtype)
    # Text only: drop the (empty) vision tower rather than download weights nothing reads.
    model.model.visual = None

    state = {}
    for t in GGUFReader(_download(*TEXT_ENCODER)).tensors:
        array = dequantize(t.data, t.tensor_type)
        shape = tuple(reversed([int(x) for x in t.shape]))
        with warnings.catch_warnings():  # read-only memmap views: `.to(dtype)` copies them anyway
            warnings.simplefilter("ignore", UserWarning)
            state[_hf_name(t.name)] = torch.from_numpy(array.reshape(shape)).to(dtype)
    if "lm_head.weight" not in state:  # tied embeddings (Qwen3-VL-4B): llama.cpp stores them once
        state["lm_head.weight"] = state["model.language_model.embed_tokens.weight"]

    expected = set(model.state_dict().keys())
    missing, unexpected = expected - state.keys(), state.keys() - expected
    if missing or unexpected:
        raise RuntimeError(f"Text encoder weights don't match: missing {sorted(missing)[:5]}, unexpected {sorted(unexpected)[:5]}")
    model.load_state_dict(state, assign=True, strict=True)
    if config.get_text_config().tie_word_embeddings:
        model.tie_weights()
    return model.eval()


# -- pipeline ---------------------------------------------------------------------


class _Interrupted(Exception):
    pass


class Flux3Klein:
    """The FLUX.3 distilled modular pipeline without its prompt upsampler, with a diffusers-like call."""

    def __init__(self, pipe, tokenizer, text_encoder) -> None:
        self.pipe = pipe
        self.tokenizer = tokenizer
        self.text_encoder = text_encoder
        self._should_stop: Optional[Callable[[], bool]] = None

        def check(_module, _args, _kwargs):
            if self._should_stop and self._should_stop():
                raise _Interrupted()

        # The modular denoise loop has no step callback: check for cancellation before each transformer pass.
        pipe.transformer.register_forward_pre_hook(check, with_kwargs=True)

    def to(self, device: str) -> "Flux3Klein":
        self.pipe.to(device)
        return self

    def __call__(
        self,
        prompt: str,
        width: int,
        height: int,
        generator: torch.Generator,
        image=None,
        num_inference_steps: int = STEPS,
        should_stop: Optional[Callable[[], bool]] = None,
    ):
        """Returns a PIL image, or None when `should_stop` interrupted it."""
        kwargs = dict(prompt=prompt, width=width, height=height, generator=generator, num_inference_steps=num_inference_steps)
        if image:
            kwargs["image"] = image
        self._should_stop = should_stop
        try:
            return self.pipe(**kwargs, output="images")[0]
        except _Interrupted:
            return None
        finally:
            self._should_stop = None


def _strip_prefix_in_converter() -> None:
    """The GGUF keys carry ComfyUI's `model.diffusion_model.` prefix, which diffusers' FLUX.3 converter
    (unlike the FLUX.2 one) doesn't remove: without this, no weight would load."""
    from diffusers.loaders.single_file_model import SINGLE_FILE_LOADABLE_CLASSES

    entry = SINGLE_FILE_LOADABLE_CLASSES["Flux3Transformer2DModel"]
    convert = entry["checkpoint_mapping_fn"]
    if getattr(convert, "_strips_prefix", False):
        return
    prefix = "model.diffusion_model."

    def wrapped(checkpoint, **kwargs):
        for key in [k for k in checkpoint if k.startswith(prefix)]:
            checkpoint[key[len(prefix) :]] = checkpoint.pop(key)
        return convert(checkpoint, **kwargs)

    wrapped._strips_prefix = True
    entry["checkpoint_mapping_fn"] = wrapped


def _unpack_unquantized_gguf(model: torch.nn.Module, dtype: torch.dtype) -> None:
    """The GGUF keeps a few layers in BF16 (timestep embedders, text projection, final layer). diffusers leaves
    them as packed uint8 GGUF parameters and unpacks them on every call, which fails on MPS: unpack them once."""
    from diffusers.quantizers.gguf.utils import UNQUANTIZED_TYPES, GGUFParameter, dequantize_gguf_tensor

    for module in model.modules():
        for name, param in list(module.named_parameters(recurse=False)):
            if isinstance(param, GGUFParameter) and param.quant_type in UNQUANTIZED_TYPES:
                value = dequantize_gguf_tensor(param).to(dtype)
                setattr(module, name, torch.nn.Parameter(value, requires_grad=False))


def load_pipeline(dtype: torch.dtype) -> Flux3Klein:
    from diffusers import AutoencoderKLFlux2, FlowMatchEulerDiscreteScheduler, Flux3DistilledAutoBlocks, Flux3Transformer2DModel, GGUFQuantizationConfig
    from transformers import AutoProcessor

    _strip_prefix_in_converter()
    transformer = Flux3Transformer2DModel.from_single_file(
        _download(*TRANSFORMER),
        quantization_config=GGUFQuantizationConfig(compute_dtype=dtype),
        config=_transformer_config_dir(),
        subfolder="transformer",
        torch_dtype=dtype,
    )
    _unpack_non_linear_gguf(transformer, dtype)
    _unpack_unquantized_gguf(transformer, dtype)
    text_encoder = _text_encoder(dtype)
    tokenizer = AutoProcessor.from_pretrained(_snapshot(ENCODER_REPO, ENCODER_PATTERNS))
    vae = AutoencoderKLFlux2.from_pretrained(_snapshot(VAE_REPO, ["vae/*"]), subfolder="vae", torch_dtype=dtype)

    blocks = Flux3DistilledAutoBlocks()
    blocks.sub_blocks.pop("prompt_upsampler")
    pipe = blocks.init_pipeline()
    pipe.update_components(
        transformer=transformer,
        text_encoder=text_encoder,
        tokenizer=tokenizer,
        vae=vae,
        scheduler=FlowMatchEulerDiscreteScheduler(shift=SHIFT),
    )
    pipe.load_components(names=["image_processor"])
    return Flux3Klein(pipe, tokenizer.tokenizer, text_encoder)
