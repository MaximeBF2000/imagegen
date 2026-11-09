# Imagegen Studio

A fully local AI image generation and editing studio, running on your own GPU through 🤗 diffusers (Apple Silicon/Metal, CUDA, or CPU). Switch models from the header at any time:

- **[FLUX.2 [klein] 4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)**: fast (4 steps), multi-reference editing, native inpainting.
- **Qwen-Image 2.1 Turbo, Q8 GGUF**: the [Q8_0 denoiser](https://huggingface.co/AtomicChat/Qwen-Image-2.1-Turbo-GGUF) with the [Q8_0 uncensored Qwen3-VL text encoder](https://huggingface.co/AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF) (8 steps). Strong text rendering, multi-reference editing; inpainting is emulated.

![ImageGen Studio](./README_hero.png)

- **Async queue**: generations run in the background with bounded concurrency, persist across restarts, and retry transient errors automatically.
- **Variants**: up to 8 images per prompt, each with its own seed (fixed seeds give reproducible results: `seed`, `seed+1`, …).
- **Text + image → image**: drag & drop, paste (⌘V) or pick up to 4 reference images, or reuse any generated image as a reference.
- **Inpainting**: paint a mask with brush, eraser, undo and invert. It uses diffusers' native `Flux2KleinInpaintPipeline` (references work too), and pixels outside the mask are preserved exactly.
- **Prompt enhancer**: an LLM rewrites vague ideas into FLUX-optimized prompts. By default it reuses FLUX.2 klein's own Qwen3 text encoder, so there's nothing extra to download. Optionally use Ollama with a vision model so it can see your references. Use it on demand (✦ Enhance, undoable) or automatically on submit (Auto).
- **Folders**: organize individual images into folders, and pick a folder to generate into (it defaults to the folder you're viewing). Move images by dragging them onto a folder in the sidebar, through the image menu, or by multi-selecting them. **Download all** zips a folder (or everything) with a `manifest.json` of prompts and seeds.
- **Grid or list**: a dense chronological image grid with 3 tile sizes and multi-select (⌘/Shift-click, ⌘A) for bulk move, download and delete. A list view groups images by prompt.
- **Live UI**: SSE-driven skeletons show queue position, elapsed time and retries. There's also a lightbox (zoom/pan, filmstrip, keyboard navigation), downloads, search and infinite scroll. Click any prompt to copy it. The prompt box clears after each generation; press ↑ to bring back previous prompts.
- **API**: everything is scriptable over REST (single, bulk, long-poll `wait`, SSE). OpenAPI docs live at `/api/docs`.

## Quick start

Requirements: Node ≥ 22.13, pnpm, [uv](https://docs.astral.sh/uv/) (Python), and a GPU with ~16 GB free memory (any Apple Silicon Mac with 32 GB+ works).

One-time setup:

```bash
pnpm install
pnpm setup:model
```

`pnpm setup:model` creates the Python env (`apps/inference/.venv`) and downloads both models (~16 GB + ~17 GB) into the **default Hugging Face cache** (`~/.cache/huggingface/hub`, or `$HF_HOME`), not into the app. Use `pnpm setup:flux` or `pnpm setup:qwen` to fetch only one.

Pick the model in the header menu; your choice is remembered and each generation records the model it used ("Run again" reuses it). Only one model stays in memory: the first job for the other model swaps it in. `IMAGE_MODEL` in `.env` sets the default.

Then, every time:

```bash
pnpm dev
```

This starts three processes:

- Studio: http://localhost:3000
- API: http://localhost:4310/api, with interactive docs at http://localhost:4310/api/docs
- Inference server (Python): http://127.0.0.1:8000. It loads the model in a few seconds; the UI shows "Warming up the model" meanwhile, and queued jobs wait for it. On an M5 Max, a ~1 MP image takes ~15 s.

`.env` needs no edits. Useful knobs are `INFERENCE_STEPS` (default 4, what the distilled model is tuned for), `INFERENCE_DEVICE`, and `TEXT_PROVIDER`. To try the UI without the model, set `IMAGE_PROVIDER=mock` and `TEXT_PROVIDER=mock`.

Production mode: `pnpm build && pnpm start`.

## Running with Docker Compose

Web and API run as containers; FLUX runs **natively on the Mac** (Docker on macOS can't use the GPU). A small login agent keeps the two in sync: the model server starts when the `api` container starts and stops (unloading the model, freeing memory) when it stops. Containers have no restart policy, so nothing runs until you start it.

One-time setup (after `pnpm setup:model`):

```bash
pnpm docker:agent:install     # installs the launchd agent (~/Library/LaunchAgents/com.imagegen.inference-supervisor.plist)
```

Then:

```bash
docker compose up -d          # start: web, API, and (automatically) the model server
docker compose down           # stop everything, including the model server
```

You can also start or stop the stack from Docker Desktop; the model server follows. Open http://localhost:3000 as usual. The containers use the same `data/` folder as `pnpm dev`. Don't run both at once, since they use the same ports.

- Rebuild after code changes: `docker compose up -d --build`
- Supervisor and model logs: `pnpm docker:logs` (`~/Library/Logs/imagegen/`)
- Remove the agent: `pnpm docker:agent:uninstall`

While the containers are off, the agent only waits for Docker events and uses no CPU or GPU.

## Keyboard shortcuts

| Where | Keys |
| - | - |
| Anywhere | `/` focus prompt · `⌘K` search |
| Prompt | `↵` generate · `⇧↵` new line · `↑` `↓` previous prompts · `⌘V` paste image |
| Grid | `⌘`/`Shift`-click select · `⌘A` select all · `Esc` clear selection · drag images onto a folder |
| Lightbox | `←` `→` navigate · `D` download · `E` inpaint · `R` use as reference · `I` details · `+` `-` `0` zoom · `Del` delete |
| Inpaint | `B` brush · `E` eraser · `[` `]` brush size · `H` hide mask · `⌘Z` undo |

## Architecture

```
compose.yaml  web + api containers (FLUX stays native, see scripts/inference-supervisor.sh)
apps/
  web/        Next.js 16 + React 19 + Tailwind 4 + TanStack Query
  api/        NestJS 12 (ESM): queue, storage, providers, REST + SSE
  inference/  Python FastAPI + diffusers: keeps FLUX.2 klein loaded on the GPU
data/         SQLite database + images (created at runtime, git-ignored)
```

- **Inference** (`apps/inference/server.py`): keeps one model resident and swaps it on demand. FLUX.2 klein loads `Flux2KleinPipeline` (bf16) and shares its weights with `Flux2KleinInpaintPipeline`. Qwen-Image (`qwen_gguf.py`) runs `QwenImage21Pipeline` with the GGUF denoiser kept at Q8 (dequantized per layer), the GGUF text encoder mapped into transformers' `Qwen3VLForConditionalGeneration`, and the encoder's vision tower range-fetched from the official checkpoint so reference images work. It exposes `POST /generate` (with a `model` id), `POST /enhance` (chat with the resident model's Qwen text encoder), `POST /models/:id/load`, `POST /cancel/:id` and `GET /health`. GPU work and model swaps are serialized.

- **Storage**: SQLite through Node's built-in `node:sqlite` (no native build step) and image files on disk. Thumbnails are WebP, generated lazily with `sharp`.
- **Queue** (`apps/api/src/generations/queue.service.ts`): FIFO with `QUEUE_CONCURRENCY` workers. Interrupted jobs are re-queued on boot. Retryable failures (network, 429, 5xx) back off exponentially, up to `QUEUE_MAX_ATTEMPTS`.
- **Live updates**: every job change emits the full generation over `GET /api/events` (SSE); the web app patches its cache from these events.

### Swapping the model

All model access goes through two interfaces in `apps/api/src/providers/types.ts`:

```ts
interface ImageProvider { generate(req: ImageGenerationRequest): Promise<ImageGenerationResult>; capabilities; ... }
interface TextProvider  { complete(req: TextCompletionRequest): Promise<string>; ... }
```

- **Another local model**: add a loader to `MODELS` in `apps/inference/server.py` (see `qwen_gguf.py` for a GGUF example) and the same id with its capabilities to `apps/api/src/providers/models.ts`. It then shows up in the model picker and in `GET /api/config` → `image.models`.
- **Another engine** (ComfyUI, MLX, a remote API…): implement `ImageProvider`, register it in `apps/api/src/providers/registry.ts`, and set `IMAGE_PROVIDER=<name>`. `mock.providers.ts` is the smallest example. Set `capabilities.nativeInpainting = false` if your engine has no mask support; the app then emulates inpainting with a marked reference plus mask compositing.
- **Prompt enhancer via Ollama** (sees reference images): set `TEXT_PROVIDER=openai-compatible`, `TEXT_BASE_URL=http://localhost:11434/v1` and `TEXT_MODEL=qwen3-vl:8b` (any OpenAI-compatible server works).

The rest of the app (queue, UI, API) is provider-agnostic.

## API cheat-sheet

```bash
# Queue a generation (returns immediately). "model" is optional (default: IMAGE_MODEL)
curl -X POST localhost:4310/api/generations -H 'Content-Type: application/json' \
  -d '{"prompt":"a cozy cabin at dusk","count":4,"aspectRatio":"16:9","enhance":true,"model":"qwen-image-2.1-turbo"}'

# Wait until finished (long-poll)
curl localhost:4310/api/generations/<id>/wait?timeout=120

# Bulk queue (automation)
curl -X POST localhost:4310/api/generations/bulk -H 'Content-Type: application/json' \
  -d '{"items":[{"prompt":"…","label":"batch-1"},{"prompt":"…","label":"batch-1"}]}'

# Upload images / image-to-image / inpaint
curl -X POST localhost:4310/api/assets -F files=@photo.jpg
curl -X POST localhost:4310/api/generations -H 'Content-Type: application/json' \
  -d '{"prompt":"watercolor style","inputImageIds":["<asset-id>"]}'
curl -X POST localhost:4310/api/generations -H 'Content-Type: application/json' \
  -d '{"prompt":"a red bicycle","inputImageIds":["<asset-id>"],"mask":"data:image/png;base64,…"}'

# Prompt enhancer
curl -X POST localhost:4310/api/prompts/enhance -H 'Content-Type: application/json' -d '{"prompt":"cat on roof"}'

# Folders: create, generate into, move images, download as zip
curl -X POST localhost:4310/api/folders -H 'Content-Type: application/json' -d '{"name":"Product shots"}'
curl -X POST localhost:4310/api/generations -H 'Content-Type: application/json' \
  -d '{"prompt":"…","count":4,"folderId":"<folder-id>"}'
curl -X POST localhost:4310/api/images/move -H 'Content-Type: application/json' \
  -d '{"ids":["<job-id>"],"folderId":"<folder-id>"}'      # folderId null = out of folders
curl -OJ localhost:4310/api/folders/<folder-id>/archive    # or /api/archive?folderId=none, /api/archive (everything)
curl "localhost:4310/api/generations?folderId=<folder-id>"  # filter jobs[].folderId client-side

# Live events
curl -N localhost:4310/api/events
```

Folders hold **images** (the `jobs` of a generation), so the variants of one prompt can live in different folders. `generation.folderId` records the folder the generation was created into.

`inputImages` / `mask` also accept inline data URLs, base64 or http(s) URLs. Set `API_TOKEN` (and `NEXT_PUBLIC_API_TOKEN` for the web app) to require `Authorization: Bearer <token>`.

## Tests

```bash
pnpm --filter api build
pnpm test
```

The end-to-end suite boots the API with mock providers. It covers the queue, variants and seeds, uploads, image-to-image, inpainting pixel preservation, enhancement, retries, cancel/delete, bulk, pagination, SSE, and folders (moves, counts, zip archives, deletion).
