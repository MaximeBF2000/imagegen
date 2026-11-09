"""
Qwen-Image 2.1 Turbo from GGUF files, loaded into diffusers' QwenImage21Pipeline.

  - denoiser:     AtomicChat/Qwen-Image-2.1-Turbo-GGUF            (Q8_0, kept quantized, dequantized per layer)
  - text encoder: AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF (Q8_0 Qwen3-VL-8B language model, abliterated)
  - vision tower: the `model.visual.*` tensors of the official encoder, needed to read reference images.
                  The GGUF repo ships them as an llama.cpp mmproj file, which transformers can't load, so
                  `fetch_vision_tower` downloads just those tensors (~1.2 GB) out of the official 17.5 GB
                  safetensors file with HTTP range requests.
  - configs, tokenizer/processor, scheduler and VAE: Qwen/Qwen-Image-2.1-Turbo (small files only).

Everything lives in the default Hugging Face cache, except the extracted vision tower, which is
written next to it ($HF_HOME/imagegen/).
"""

from __future__ import annotations

import json
import logging
import os
import re
import struct
import warnings
from pathlib import Path

import torch

log = logging.getLogger("inference")

BASE_REPO = "Qwen/Qwen-Image-2.1-Turbo"
BASE_PATTERNS = ["model_index.json", "processor/*", "scheduler/*", "*/config.json", "text_encoder/generation_config.json", "vae/*"]
TRANSFORMER = ("AtomicChat/Qwen-Image-2.1-Turbo-GGUF", "Qwen-Image-2.1-Turbo-Q8_0.gguf")
TEXT_ENCODER = ("AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF", "Qwen-Image-2.1-Turbo-Uncensored-Q8_0.gguf")
VISION_SOURCE = (BASE_REPO, "text_encoder/model.safetensors")
VISION_PREFIX = "model.visual."


# -- downloads --------------------------------------------------------------------


def _download(repo: str, filename: str) -> str:
    from huggingface_hub import hf_hub_download

    try:
        return hf_hub_download(repo, filename, local_files_only=True)
    except Exception:
        log.info("Downloading %s/%s…", repo, filename)
        return hf_hub_download(repo, filename)


def _base_snapshot() -> str:
    from huggingface_hub import snapshot_download

    try:
        return snapshot_download(BASE_REPO, allow_patterns=BASE_PATTERNS, local_files_only=True)
    except Exception:
        return snapshot_download(BASE_REPO, allow_patterns=BASE_PATTERNS)


def _vision_path() -> Path:
    from huggingface_hub.constants import HF_HOME

    return Path(HF_HOME) / "imagegen" / "qwen-image-2.1-turbo-vision.safetensors"


def fetch_vision_tower() -> Path:
    """Extract the vision tower tensors from the official encoder file without downloading all of it."""
    out = _vision_path()
    if out.exists():
        return out
    from huggingface_hub import get_session, hf_hub_url

    url = hf_hub_url(*VISION_SOURCE)
    session = get_session()
    headers = {}
    from huggingface_hub.utils import build_hf_headers

    headers.update(build_hf_headers())

    def read_range(start: int, end: int) -> bytes:  # inclusive end
        for attempt in range(5):
            try:
                res = session.get(url, headers={**headers, "Range": f"bytes={start}-{end}"}, follow_redirects=True, timeout=300)
                res.raise_for_status()
                if res.status_code != 206:
                    raise RuntimeError("The server ignored the HTTP range request")
                return res.content
            except RuntimeError:
                raise
            except Exception as exc:  # noqa: BLE001  (network hiccup: retry)
                if attempt == 4:
                    raise
                log.warning("Range request failed (%s), retrying…", exc)
        raise AssertionError("unreachable")

    header_len = struct.unpack("<Q", read_range(0, 7))[0]
    header = json.loads(read_range(8, 8 + header_len - 1))
    data_start = 8 + header_len
    wanted = {k: v for k, v in header.items() if k.startswith(VISION_PREFIX)}
    if not wanted:
        raise RuntimeError(f"No {VISION_PREFIX}* tensors in {VISION_SOURCE}")
    # The vision tensors are contiguous in practice: fetch the span covering them in a few big chunks.
    lo = min(v["data_offsets"][0] for v in wanted.values())
    hi = max(v["data_offsets"][1] for v in wanted.values())
    log.info("Fetching the Qwen3-VL vision tower (%d tensors, %.2f GB)…", len(wanted), (hi - lo) / 1e9)
    blob = bytearray()
    chunk = 32 * 1024 * 1024
    for start in range(lo, hi, chunk):
        blob += read_range(data_start + start, data_start + min(hi, start + chunk) - 1)

    new_header, parts, offset = {}, [], 0
    for name, info in sorted(wanted.items(), key=lambda kv: kv[1]["data_offsets"][0]):
        a, b = info["data_offsets"]
        parts.append(bytes(blob[a - lo : b - lo]))
        new_header[name] = {"dtype": info["dtype"], "shape": info["shape"], "data_offsets": [offset, offset + (b - a)]}
        offset += b - a
    raw_header = json.dumps(new_header, separators=(",", ":")).encode()
    raw_header += b" " * (-len(raw_header) % 8)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    with open(tmp, "wb") as f:
        f.write(struct.pack("<Q", len(raw_header)))
        f.write(raw_header)
        for p in parts:
            f.write(p)
    os.replace(tmp, out)
    return out


def download_all() -> None:
    _base_snapshot()
    _download(*TRANSFORMER)
    _download(*TEXT_ENCODER)
    fetch_vision_tower()


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


def _gguf_language_model(path: str, dtype: torch.dtype) -> dict[str, torch.Tensor]:
    from gguf import GGUFReader
    from gguf.quants import dequantize

    reader = GGUFReader(path)
    state = {}
    for t in reader.tensors:
        array = dequantize(t.data, t.tensor_type)
        shape = tuple(reversed([int(x) for x in t.shape]))
        with warnings.catch_warnings():  # read-only memmap views: `.to(dtype)` copies them anyway
            warnings.simplefilter("ignore", UserWarning)
            state[_hf_name(t.name)] = torch.from_numpy(array.reshape(shape)).to(dtype)
    return state


def _text_encoder(base: str, dtype: torch.dtype):
    from safetensors.torch import load_file
    from transformers import AutoConfig, Qwen3VLForConditionalGeneration

    from accelerate import init_empty_weights

    config = AutoConfig.from_pretrained(base, subfolder="text_encoder")
    # Parameters stay empty (filled from the GGUF below); buffers such as rotary frequencies are real.
    with init_empty_weights(include_buffers=False):
        model = Qwen3VLForConditionalGeneration._from_config(config, torch_dtype=dtype)
    state = _gguf_language_model(_download(*TEXT_ENCODER), dtype)
    state.update({k: v.to(dtype) for k, v in load_file(fetch_vision_tower()).items()})
    expected = set(model.state_dict().keys())
    missing, unexpected = expected - state.keys(), state.keys() - expected
    if missing or unexpected:
        raise RuntimeError(f"Text encoder weights don't match: missing {sorted(missing)[:5]}, unexpected {sorted(unexpected)[:5]}")
    model.load_state_dict(state, assign=True, strict=True)
    return model.eval()


# -- pipeline ---------------------------------------------------------------------


def _unpack_non_linear_gguf(model: torch.nn.Module, dtype: torch.dtype) -> None:
    """diffusers only dequantizes GGUF weights inside Linear layers. Others (e.g. the BF16
    `txt_in.text_norm.weight` of an RMSNorm) would be used as raw bytes, so unpack them once."""
    from diffusers.quantizers.gguf.utils import GGUFParameter, dequantize_gguf_tensor

    for module in model.modules():
        if isinstance(module, torch.nn.Linear):
            continue
        for name, param in list(module.named_parameters(recurse=False)):
            if isinstance(param, GGUFParameter):
                value = dequantize_gguf_tensor(param).to(dtype)
                setattr(module, name, torch.nn.Parameter(value, requires_grad=False))


def load_pipeline(dtype: torch.dtype):
    from diffusers import GGUFQuantizationConfig, QwenImage21Pipeline, QwenImage21Transformer2DModel

    base = _base_snapshot()
    transformer = QwenImage21Transformer2DModel.from_single_file(
        _download(*TRANSFORMER),
        quantization_config=GGUFQuantizationConfig(compute_dtype=dtype),
        config=base,
        subfolder="transformer",
        torch_dtype=dtype,
    )
    _unpack_non_linear_gguf(transformer, dtype)
    text_encoder = _text_encoder(base, dtype)
    return QwenImage21Pipeline.from_pretrained(base, transformer=transformer, text_encoder=text_encoder, torch_dtype=dtype)
