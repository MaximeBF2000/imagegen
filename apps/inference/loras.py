"""
LoRA adapters, applied on top of an image model per request (see server.py).

Each LoRA is registered in `LORAS` under a stable id that must match the catalog in
apps/api/src/providers/loras.ts (label, trigger word, default strength and the UI
text live there). `models` says which image models it was trained for: a LoRA only
works with the architecture it was trained on.

Files are stored in LORA_DIR (default: $HF_HOME/loras, i.e.
~/.cache/huggingface/loras, next to the other model weights), not in the app.
`pnpm setup:loras` downloads them; Civitai needs an API key for that, read from
CIVITAI_TOKEN (environment or the repository's .env).

How they run: the first request that enables a LoRA loads it into the resident
pipeline's denoiser with PEFT (a few hundred MB, kept for as long as that model
stays loaded). Every request then activates exactly the LoRAs it asks for, with
their strengths, and disables the others, so switching LoRAs costs nothing. The
base weights are never modified (this also works on the GGUF-quantized denoisers,
where the LoRA runs as a small extra branch next to each quantized layer).

Catalog (pages: see apps/api/src/providers/loras.ts):
  - candid-amateur-iphone-qwen21  phone-photo look                      civitai.com/models/3012015
  - lenovo-ultrareal-qwen21       general photorealism                  civitai.com/models/1662740
  - detailifier-qwen21            finer faces, skin, fabric, materials  civitai.com/models/430687
  - anime-fusal(-turbo)-qwen21    anime illustration (base / Turbo)     huggingface.co/MicksHF/Qwen-Image-2.1-Anime-Fusal
  - consistency-qwen21            edits that keep the original framing  civitai.com/models/2969143
  - character-sheet-qwen21        one photo -> 3x2 character sheet      civitai.com/models/2995608
  - deblur-qwen21                 removes blur from a reference image   civitai.com/models/2975487
  - image-blend-fusion-qwen21     blends a pasted cut-out into a scene  civitai.com/models/2548669
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

log = logging.getLogger("inference")


@dataclass(frozen=True)
class LoraSpec:
    id: str
    label: str
    #: Image model ids (server.MODELS) this LoRA was trained for.
    models: tuple[str, ...]
    #: File name inside LORA_DIR.
    filename: str
    #: Where `download()` fetches it from.
    url: str
    sha256: Optional[str] = None
    #: Set when the URL needs a Civitai API key (CIVITAI_TOKEN).
    civitai: bool = False


QWEN = ("qwen-image-2.1-turbo", "qwen-image-2.1")
QWEN_BASE = ("qwen-image-2.1",)
QWEN_TURBO = ("qwen-image-2.1-turbo",)


def civitai(version: int) -> str:
    return f"https://civitai.com/api/download/models/{version}?type=Model&format=SafeTensor"


def hf(repo: str, filename: str) -> str:
    return f"https://huggingface.co/{repo}/resolve/main/{filename}"


LORAS: dict[str, LoraSpec] = {
    spec.id: spec
    for spec in [
        LoraSpec(
            id="candid-amateur-iphone-qwen21",
            label="Candid Amateur iPhone (Qwen 2.1)",
            models=QWEN,
            filename="cndamiph_Candid_Amateur_iPhone_Qwen21_v1.safetensors",
            url=civitai(3441588),
            sha256="a1199d1725c1440e4f03f3dda44b13530c38ef769594c602b92565bfb0985af4",
            civitai=True,
        ),
        LoraSpec(
            id="lenovo-ultrareal-qwen21",
            label="Lenovo UltraReal (Qwen 2.1)",
            models=QWEN,
            filename="lenovo_qwen21.safetensors",
            url=civitai(3349565),
            sha256="7f1e95c3ec1e9c7cea197f7b6f80f601af8e6b479f6ead78ab16df542f447c0e",
            civitai=True,
        ),
        LoraSpec(
            id="detailifier-qwen21",
            label="Detailifier (Qwen 2.1)",
            models=QWEN,
            filename="detailer_qwen_style_v1.safetensors",
            url=civitai(3468509),
            sha256="90d07b8725fc00166676d01f8319bade64dab9585a32392fcacb22a0a30b0925",
            civitai=True,
        ),
        LoraSpec(
            id="anime-fusal-qwen21",
            label="Anime FUSAL v3 (Qwen 2.1 base)",
            models=QWEN_BASE,
            filename="fusal-qwen-image-2.1-v3-exact-r80.safetensors",
            url=hf("MicksHF/Qwen-Image-2.1-Anime-Fusal", "fusal-qwen-image-2.1-v3-exact-r80.safetensors"),
            sha256="f5de464f68c4498b9766753d78c9b9492fddd30a1cef3a59fd2ed1545f5aff31",
        ),
        LoraSpec(
            id="anime-fusal-turbo-qwen21",
            label="Anime FUSAL Turbo preview (Qwen 2.1 Turbo)",
            models=QWEN_TURBO,
            filename="fusal-qwen-image-2.1-turbo-e6-preview-r128.safetensors",
            url=hf("MicksHF/Qwen-Image-2.1-Anime-Fusal", "fusal-qwen-image-2.1-turbo-e6-preview-r128.safetensors"),
            sha256="7f915e874a44d8ca7650b660d38216ba1b2c4ded881dd17582811b6b3e619e48",
        ),
        LoraSpec(
            id="consistency-qwen21",
            label="Consistency (Qwen 2.1 edits)",
            models=QWEN,
            filename="qwen-image-2.1-consistency.safetensors",
            url=civitai(3364470),
            sha256="4f44ada1be2189cc23b3d010f9603543403f48454e2f76842a3d30109b20bd63",
            civitai=True,
        ),
        LoraSpec(
            id="character-sheet-qwen21",
            label="Character Sheet (Qwen 2.1 base)",
            models=QWEN_BASE,
            filename="character-sheet-qwen-image-2.1-edit-lora-e9.safetensors",
            url=civitai(3397397),
            sha256="e180b4d7a108585859eb5f15a467821eb2b8fdb71a1798943bab376c23391d51",
            civitai=True,
        ),
        LoraSpec(
            id="deblur-qwen21",
            label="Deblur anything (Qwen 2.1)",
            models=QWEN,
            filename="deblur_wibble_snargle_floof.safetensors",
            url=civitai(3372351),
            sha256="af615b45da55b0de1a2066bf07df47c7ef1c121ffe9e20ba6055a33ce67e0e83",
            civitai=True,
        ),
        LoraSpec(
            id="image-blend-fusion-qwen21",
            label="Image Blend Fusion (Qwen 2.1)",
            models=QWEN,
            filename="Fusion_2000.safetensors",
            url=civitai(3363920),
            sha256="5c6ffed9b9cb5eb3eea3f384fcf3eabd9b2e9145a68c98830e43ab0be170113d",
            civitai=True,
        ),
    ]
}


def lora_dir() -> Path:
    custom = os.environ.get("LORA_DIR", "").strip()
    if custom:
        return Path(custom).expanduser()
    from huggingface_hub.constants import HF_HOME

    return Path(HF_HOME) / "loras"


def path_of(spec: LoraSpec) -> Path:
    return lora_dir() / spec.filename


def availability(spec: LoraSpec) -> Optional[str]:
    """None when the LoRA can be used, otherwise why not."""
    if not path_of(spec).exists():
        return f"Not downloaded yet: run `pnpm setup:loras`{' with CIVITAI_TOKEN set' if spec.civitai else ''}."
    return None


# -- downloads --------------------------------------------------------------------


def _civitai_token() -> str:
    token = os.environ.get("CIVITAI_TOKEN", "").strip()
    if token:
        return token
    env_file = Path(__file__).resolve().parents[2] / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            key, _, value = line.strip().partition("=")
            if key.strip() == "CIVITAI_TOKEN":
                return value.strip().strip("'\"")
    return ""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return None


def _resolve(url: str, token: str) -> str:
    """Civitai answers with a redirect to a signed CDN URL. Follow it by hand so the
    API key is only ever sent to civitai.com, never to the CDN."""
    request = urllib.request.Request(url, headers={"User-Agent": "imagegen-studio"})
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.build_opener(_NoRedirect).open(request, timeout=60):
            return url
    except urllib.error.HTTPError as err:
        if err.code in (301, 302, 303, 307, 308) and err.headers.get("Location"):
            return err.headers["Location"]
        if err.code in (401, 403):
            raise RuntimeError(
                "Civitai refused the download (401/403). Create an API key at https://civitai.com/user/account "
                "(API Keys) and put it in .env as CIVITAI_TOKEN=…"
            ) from err
        raise


def download(spec: LoraSpec) -> Path:
    out = path_of(spec)
    if out.exists():
        return out
    token = _civitai_token() if spec.civitai else ""
    if spec.civitai and not token:
        raise RuntimeError(
            f"{spec.label} is hosted on Civitai, which needs an API key to download. Create one at "
            "https://civitai.com/user/account (API Keys) and add CIVITAI_TOKEN=… to .env."
        )
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".part")
    log.info("Downloading LoRA %s → %s", spec.label, out)
    target = _resolve(spec.url, token)
    digest = hashlib.sha256()
    request = urllib.request.Request(target, headers={"User-Agent": "imagegen-studio"})
    with urllib.request.urlopen(request, timeout=120) as res, open(tmp, "wb") as f:
        while chunk := res.read(8 * 1024 * 1024):
            f.write(chunk)
            digest.update(chunk)
    if spec.sha256 and digest.hexdigest() != spec.sha256.lower():
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"Checksum mismatch for {spec.filename}: got {digest.hexdigest()}")
    os.replace(tmp, out)
    log.info("Saved %s (%.0f MB)", out, out.stat().st_size / 1e6)
    return out


def download_all() -> None:
    failed = []
    for spec in LORAS.values():
        try:
            download(spec)
        except Exception as exc:  # noqa: BLE001
            log.error("%s: %s", spec.id, exc)
            failed.append(spec.id)
    if failed:
        raise SystemExit(f"Could not download: {', '.join(failed)}")


# -- loading into a pipeline -------------------------------------------------------

#: ComfyUI fuses Qwen-Image 2.1's SwiGLU gate and up projections into one `gate_up` layer
#: (gate rows first); diffusers keeps them separate (`gate_layer`, `proj`). LoRAs trained in
#: ComfyUI therefore target `gate_up`. Splitting B by rows is exact: [Bg; Bu]·A = [Bg·A; Bu·A].
_GATE_UP = re.compile(r"^(.*\.img_mlp)\.gate[._]up\.(lora_[AB])\.weight$")


def _normalize(state: dict) -> dict:
    out = {}
    for key, value in state.items():
        m = _GATE_UP.match(key)
        if not m:
            out[key] = value
        elif m.group(2) == "lora_A":
            out[f"{m.group(1)}.gate_layer.lora_A.weight"] = value
            out[f"{m.group(1)}.proj.lora_A.weight"] = value.clone()
        else:
            gate, up = value.chunk(2, dim=0)
            out[f"{m.group(1)}.gate_layer.lora_B.weight"] = gate.contiguous()
            out[f"{m.group(1)}.proj.lora_B.weight"] = up.contiguous()
    return out


def load_state_dict(spec: LoraSpec, pipe) -> dict:
    from safetensors.torch import load_file

    raw = load_file(str(path_of(spec)))

    def rename(key: str) -> str:
        # Original-checkpoint prefix → the one diffusers' converter knows.
        if key.startswith("model.diffusion_model."):
            return "diffusion_model." + key[len("model.diffusion_model.") :]
        # Diffusers-format files (ai-toolkit, Fizgig…) prefix keys with "transformer.". With `.alpha`
        # entries present they go through the same converter, which expects bare module names.
        if key.startswith("transformer.") and any(k.endswith(".alpha") for k in raw):
            return key[len("transformer.") :]
        return key

    raw = {rename(k): v for k, v in raw.items()}
    state = pipe.lora_state_dict(raw)
    if isinstance(state, tuple):
        state = state[0]
    return _normalize(state)


@dataclass
class LoraState:
    """LoRAs loaded into one resident pipeline (dropped together with it)."""

    loaded: set[str] = field(default_factory=set)
    active: tuple = ()


def apply(pipe, state: LoraState, model_id: str, requested: list[tuple[str, float]]) -> None:
    """Activate exactly `requested` [(id, strength)] on `pipe`, loading adapters on first use."""
    for lora_id, _ in requested:
        spec = LORAS.get(lora_id)
        if spec is None:
            raise ValueError(f"Unknown LoRA {lora_id!r}. Available: {', '.join(LORAS) or 'none'}")
        if model_id not in spec.models:
            raise ValueError(f"{spec.label} only works with {', '.join(spec.models)}, not {model_id}")
        problem = availability(spec)
        if problem:
            raise ValueError(f"{spec.label}: {problem}")
        if lora_id not in state.loaded:
            log.info("Loading LoRA %s into %s…", spec.label, model_id)
            weights = load_state_dict(spec, pipe)
            pipe.load_lora_weights(weights, adapter_name=lora_id)
            state.loaded.add(lora_id)

    wanted = tuple((i, float(w)) for i, w in requested)
    if wanted == state.active:
        return
    if wanted:
        pipe.enable_lora()
        pipe.set_adapters([i for i, _ in wanted], adapter_weights=[w for _, w in wanted])
    elif state.loaded:
        pipe.disable_lora()
    state.active = wanted
