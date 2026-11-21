"""
Image upscalers, served by POST /upscale (see server.py).

Each upscaler implements the small `Upscaler` interface and is registered in
`UPSCALERS` under a stable id. The id must match the catalog in
apps/api/src/providers/upscalers.ts (label, scales and description live there too).

To add another upscaler (Real-ESRGAN, a diffusers pipeline, another MLX model…),
subclass `Upscaler`, implement `upscale()` and add an instance to `UPSCALERS`.
An upscaler may run in-process (keep its weights in `self`) or shell out to a CLI
in its own environment, like `MlxGenUpscaler` does.

  - seedvr2-7b-8bit   SeedVR2 7B, 8-bit MLX package (AbstractFramework/seedvr2-7b-8bit), run
                      through the `mlx-gen` CLI. Apple Silicon only. Install once with
                      `pnpm setup:upscale` (installs mlx-gen as a uv tool and downloads ~9 GB).
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Callable, Optional

from PIL import Image

log = logging.getLogger("inference")


class UpscaleCancelled(Exception):
    pass


#: Largest output tile side, in pixels. Memory grows steeply with the output size
#: (SeedVR2 7B: ~37-44 GB peak up to ~2.4 MP, 66 GB at 4 MP, out of memory at 16 MP),
#: so bigger results are produced tile by tile and blended.
TILE_SIDE = int(os.environ.get("UPSCALE_TILE", "1536"))
#: Overlap between neighboring tiles, in output pixels (feather-blended).
TILE_OVERLAP = int(os.environ.get("UPSCALE_TILE_OVERLAP", "128"))


class Upscaler(ABC):
    """
    Base class. Subclasses implement `upscale_batch()`; `upscale()` splits images whose
    output would exceed `tile_side` into overlapping tiles, upscales them in one batch
    (so a model loads once) and blends them back together.
    """

    #: Stable id (matches the API catalog).
    id: str
    label: str
    #: Scale factors this upscaler accepts.
    scales: tuple[int, ...] = (2, 4)
    #: Largest output side, in pixels; requests above it are refused.
    max_side: int = 8192
    #: Largest output tile side (None: never tile).
    tile_side: Optional[int] = TILE_SIDE
    #: Tile sizes are rounded to this many source pixels.
    tile_multiple: int = 16

    def availability(self) -> Optional[str]:
        """None when ready to run, otherwise a human readable reason (e.g. not installed)."""
        return None

    @abstractmethod
    def upscale_batch(self, images: list[Image.Image], scale: int, seed: int, should_stop: Callable[[], bool]) -> list[Image.Image]:
        """Upscales each image by `scale`. Raise UpscaleCancelled when `should_stop()` turns true."""

    def upscale(self, image: Image.Image, scale: int, seed: int, should_stop: Callable[[], bool]) -> Image.Image:
        boxes = self.tile_boxes(image.width, image.height, scale)
        if len(boxes) == 1:
            return self._fit(self.upscale_batch([image], scale, seed, should_stop)[0], image.width * scale, image.height * scale)
        log.info("Upscaling %dx%d ×%d in %d tiles with %s…", image.width, image.height, scale, len(boxes), self.label)
        tiles = self.upscale_batch([image.crop(b) for b in boxes], scale, seed, should_stop)
        return blend_tiles(tiles, boxes, scale, image.width, image.height)

    def tile_boxes(self, width: int, height: int, scale: int) -> list[tuple[int, int, int, int]]:
        """Overlapping source-space crop boxes whose upscaled size stays within `tile_side`."""
        if not self.tile_side or max(width, height) * scale <= self.tile_side:
            return [(0, 0, width, height)]
        m = self.tile_multiple
        tile = max(m * 4, (self.tile_side // scale) // m * m)
        overlap = max(m, (TILE_OVERLAP // scale) // m * m)

        def spans(size: int) -> list[tuple[int, int]]:
            if size <= tile:
                return [(0, size)]
            n = -(-(size - overlap) // (tile - overlap))  # ceil
            starts = [round(i * (size - tile) / (n - 1)) for i in range(n)]
            return [(s, s + tile) for s in starts]

        return [(x0, y0, x1, y1) for (y0, y1) in spans(height) for (x0, x1) in spans(width)]

    @staticmethod
    def _fit(img: Image.Image, width: int, height: int) -> Image.Image:
        img = img.convert("RGB")
        return img if img.size == (width, height) else img.resize((width, height), Image.LANCZOS)


def blend_tiles(tiles: list[Image.Image], boxes: list[tuple[int, int, int, int]], scale: int, width: int, height: int) -> Image.Image:
    """Pastes upscaled tiles at their output positions, cross-fading the overlaps linearly."""
    import numpy as np

    W, H = width * scale, height * scale
    acc = np.zeros((H, W, 3), np.float32)
    weight = np.zeros((H, W, 1), np.float32)
    for tile, (x0, y0, x1, y1) in zip(tiles, boxes):
        ox0, oy0, ox1, oy1 = x0 * scale, y0 * scale, x1 * scale, y1 * scale
        tw, th = ox1 - ox0, oy1 - oy0
        arr = np.asarray(Upscaler._fit(tile, tw, th), np.float32)
        ramp = TILE_OVERLAP

        def ramp_1d(n: int, at_start: bool, at_end: bool) -> "np.ndarray":
            r = np.ones(n, np.float32)
            k = min(ramp, n // 2)
            edge = (np.arange(k, dtype=np.float32) + 0.5) / k
            if not at_start:
                r[:k] = np.minimum(r[:k], edge)
            if not at_end:
                r[n - k :] = np.minimum(r[n - k :], edge[::-1])
            return r

        wx = ramp_1d(tw, ox0 == 0, ox1 == W)
        wy = ramp_1d(th, oy0 == 0, oy1 == H)
        w = (wy[:, None] * wx[None, :])[..., None]
        acc[oy0:oy1, ox0:ox1] += arr * w
        weight[oy0:oy1, ox0:ox1] += w
    out = acc / np.maximum(weight, 1e-6)
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8))


def _find_executable(name: str, env_var: str) -> Optional[str]:
    """$ENV_VAR, then PATH, then uv's tool bin dir (launchd/Docker supervisors often lack it in PATH)."""
    forced = os.environ.get(env_var)
    if forced:
        return forced if Path(forced).exists() else None
    found = shutil.which(name)
    if found:
        return found
    candidate = Path.home() / ".local" / "bin" / name
    return str(candidate) if candidate.exists() else None


class MlxGenUpscaler(Upscaler):
    """
    Runs `mlxgen upscale` (https://github.com/lpalbou/mlx-gen) in its own process and
    environment: MLX and its pinned dependencies stay out of this torch venv, and the
    model's memory is released as soon as the job ends. All tiles of an image go
    through a single run (one model load).
    """

    def __init__(self, id: str, label: str, model: str, scales: tuple[int, ...] = (2, 4), extra_args: tuple[str, ...] = ()):
        self.id = id
        self.label = label
        self.model = model
        self.scales = scales
        self.extra_args = extra_args

    def availability(self) -> Optional[str]:
        if not _find_executable("mlxgen", "MLXGEN_BIN"):
            return "mlx-gen isn't installed. Run `pnpm setup:upscale`."
        return None

    def upscale_batch(self, images: list[Image.Image], scale: int, seed: int, should_stop: Callable[[], bool]) -> list[Image.Image]:
        exe = _find_executable("mlxgen", "MLXGEN_BIN")
        if not exe:
            raise RuntimeError(self.availability())
        with tempfile.TemporaryDirectory(prefix="imagegen-upscale-") as tmp:
            src_dir, out_dir = Path(tmp) / "in", Path(tmp) / "out"
            src_dir.mkdir()
            out_dir.mkdir()
            names = [f"tile{i:03d}" for i in range(len(images))]
            for name, img in zip(names, images):
                img.save(src_dir / f"{name}.png")
            cmd = [
                exe, "upscale",
                "--model", self.model,
                "--image-path", str(src_dir if len(images) > 1 else src_dir / f"{names[0]}.png"),
                "--resolution", f"{scale}x",
                "--seed", str(seed),
                "--output", str(out_dir / "{input_name}.png"),
                "--no-progress",
                # Keep MLX's buffer cache small between tiles (the default scales with RAM).
                "--mlx-cache-limit-gb", os.environ.get("UPSCALE_MLX_CACHE_GB", "4"),
                *self.extra_args,
            ]
            log_path = Path(tmp) / "mlxgen.log"
            log.info("Running %s on %d image(s), ×%d…", self.label, len(images), scale)
            # Output goes to a file: a pipe nobody reads until exit can fill up and hang the run.
            with open(log_path, "w") as log_file:
                proc = subprocess.Popen(cmd, stdout=log_file, stderr=subprocess.STDOUT, text=True)
                while proc.poll() is None:
                    if should_stop():
                        proc.kill()
                        proc.wait()
                        raise UpscaleCancelled()
                    time.sleep(0.25)
            output = log_path.read_text(errors="replace")
            if proc.returncode != 0:
                tail = "\n".join(output.strip().splitlines()[-8:])
                if "OutOfMemory" in output or "Insufficient Memory" in output:
                    raise RuntimeError(f"ran out of GPU memory; lower UPSCALE_TILE (now {self.tile_side}px). {tail}")
                raise RuntimeError(f"mlxgen exited with code {proc.returncode}: {tail}")
            results = []
            for name in names:
                found = next(iter(sorted(out_dir.glob(f"{name}*.png"))), None)
                if found is None:
                    raise RuntimeError(f"mlxgen didn't write {name}. Output: {output[-800:]}")
                with Image.open(found) as img:
                    results.append(img.convert("RGB"))
            return results


UPSCALERS: dict[str, Upscaler] = {
    u.id: u
    for u in [
        MlxGenUpscaler("seedvr2-7b-8bit", "SeedVR2 7B (8-bit MLX)", "AbstractFramework/seedvr2-7b-8bit"),
    ]
}

DEFAULT_UPSCALER = os.environ.get("UPSCALER") or next(iter(UPSCALERS))


def download_all() -> None:
    """Fetch every upscaler's weights (used by `pnpm setup:upscale`)."""
    exe = _find_executable("mlxgen", "MLXGEN_BIN")
    if not exe:
        raise SystemExit("mlx-gen isn't installed: run `uv tool install --python 3.13 mlx-gen --with 'pillow<12.2'` first.")
    for u in UPSCALERS.values():
        if isinstance(u, MlxGenUpscaler):
            log.info("Downloading %s (%s)…", u.label, u.model)
            subprocess.run([exe, "download", "--model", u.model], check=True)
