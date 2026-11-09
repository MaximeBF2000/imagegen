// End-to-end test of the built API (run `pnpm build` first).
// Boots the server with the offline mock providers on a temp data dir.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4300 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}/api`;
const dataDir = mkdtempSync(path.join(tmpdir(), 'imagegen-test-'));
let server;

const api = async (method, url, body) => {
  const res = await fetch(BASE + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const png = (w, h, color) =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

before(async () => {
  server = spawn(process.execPath, [path.join(here, '..', 'dist', 'main.js')], {
    env: {
      ...process.env,
      IMAGEGEN_IGNORE_DOTENV: '1',
      IMAGE_PROVIDER: 'mock',
      TEXT_PROVIDER: 'mock',
      API_PORT: String(PORT),
      API_PUBLIC_URL: `http://localhost:${PORT}`,
      DATA_DIR: dataDir,
      API_TOKEN: '',
      QUEUE_CONCURRENCY: '3',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
});

after(() => {
  server?.kill();
  rmSync(dataDir, { recursive: true, force: true });
});

test('config reports providers', async () => {
  const { body } = await api('GET', '/config');
  assert.equal(body.ready, true);
  assert.equal(body.image.provider, 'mock');
});

test('text-to-image with variants runs through the queue', async () => {
  const { status, body: gen } = await api('POST', '/generations', { prompt: 'a red fox', count: 3, aspectRatio: '16:9', seed: 42 });
  assert.equal(status, 201);
  assert.equal(gen.jobs.length, 3);
  assert.deepEqual(gen.jobs.map((j) => j.seed), [42, 43, 44]);
  assert.ok(['queued', 'running'].includes(gen.status));

  const { body: done } = await api('GET', `/generations/${gen.id}/wait?timeout=30`);
  assert.equal(done.status, 'completed');
  assert.equal(done.progress.succeeded, 3);
  const img = done.jobs[0].image;
  assert.ok(img.width > img.height, '16:9 should be landscape');

  const file = await fetch(img.url);
  assert.equal(file.status, 200);
  const thumb = await fetch(img.thumbUrl);
  assert.equal(thumb.headers.get('content-type'), 'image/webp');
  const dl = await fetch(img.downloadUrl);
  assert.match(dl.headers.get('content-disposition'), /a-red-fox-1\.png/);
});

test('upload + image-to-image + inpainting keeps unmasked pixels', async () => {
  const form = new FormData();
  form.append('files', new Blob([await png(400, 300, { r: 0, g: 0, b: 255 })], { type: 'image/png' }), 'blue.png');
  const up = await fetch(`${BASE}/assets`, { method: 'POST', body: form });
  assert.equal(up.status, 201);
  const [asset] = await up.json();
  assert.equal(asset.width, 400);

  const i2i = (await api('POST', '/generations', { prompt: 'make it purple', inputImageIds: [asset.id] })).body;
  assert.equal(i2i.mode, 'image-to-image');
  assert.equal(i2i.aspectRatio, 'auto');

  // Mask: white rectangle on the right half.
  const mask = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#000' } })
    .composite([{ input: await png(200, 300, '#fff'), left: 200, top: 0 }])
    .png()
    .toBuffer();
  const inp = (
    await api('POST', '/generations', {
      prompt: 'a sun',
      inputImageIds: [asset.id],
      mask: `data:image/png;base64,${mask.toString('base64')}`,
    })
  ).body;
  assert.equal(inp.mode, 'inpaint');
  const done = (await api('GET', `/generations/${inp.id}/wait?timeout=30`)).body;
  assert.equal(done.status, 'completed', JSON.stringify(done.jobs[0].error));
  const out = Buffer.from(await (await fetch(done.jobs[0].image.url)).arrayBuffer());
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 400);
  const px = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  assert.deepEqual(px(10, 150), [0, 0, 255], 'left (unmasked) side must be untouched');
  assert.notDeepEqual(px(390, 150), [0, 0, 255], 'right (masked) side must change');

  await api('GET', `/generations/${i2i.id}/wait?timeout=30`);
});

test('prompt enhancer', async () => {
  const { status, body } = await api('POST', '/prompts/enhance', { prompt: 'cat on roof' });
  assert.equal(status, 200);
  assert.ok(body.prompt.length > 'cat on roof'.length);
});

test('enhance=true stores the enhanced prompt', async () => {
  const gen = (await api('POST', '/generations', { prompt: 'a lighthouse', enhance: true, count: 2 })).body;
  const done = (await api('GET', `/generations/${gen.id}/wait?timeout=30`)).body;
  assert.ok(done.enhancedPrompt?.startsWith('A lighthouse'));
});

test('failures, retry, cancel, delete', async () => {
  const failing = (await api('POST', '/generations', { prompt: 'please fail' })).body;
  const failed = (await api('GET', `/generations/${failing.id}/wait?timeout=30`)).body;
  // Mock failures are plain Errors -> retried up to QUEUE_MAX_ATTEMPTS, then failed.
  assert.equal(failed.status, 'failed');
  assert.equal(failed.jobs[0].attempts, 3);

  const big = (await api('POST', '/generations', { prompt: 'many', count: 8 })).body;
  const canceled = (await api('POST', `/generations/${big.id}/cancel`)).body;
  assert.equal(canceled.progress.queued + canceled.progress.running, 0);
  assert.equal(canceled.status, 'canceled');

  const retried = (await api('POST', `/jobs/${canceled.jobs[0].id}/retry`)).body;
  assert.ok(['queued', 'running'].includes(retried.jobs[0].status));

  assert.equal((await api('DELETE', `/generations/${big.id}`)).status, 204);
  assert.equal((await api('GET', `/generations/${big.id}`)).status, 404);
});

test('bulk + pagination + search + validation', async () => {
  const { status, body } = await api('POST', '/generations/bulk', {
    items: [{ prompt: 'bulk one', label: 'batch-A' }, { prompt: 'bulk two', label: 'batch-A' }],
  });
  assert.equal(status, 201);
  assert.equal(body.items.length, 2);

  const page1 = (await api('GET', '/generations?limit=2')).body;
  assert.equal(page1.items.length, 2);
  assert.ok(page1.nextCursor);
  const page2 = (await api('GET', `/generations?limit=2&cursor=${page1.nextCursor}`)).body;
  assert.ok(!page2.items.some((g) => page1.items.find((p) => p.id === g.id)));

  const byLabel = (await api('GET', '/generations?label=batch-A')).body;
  assert.equal(byLabel.items.length, 2);

  assert.equal((await api('POST', '/generations', { prompt: '' })).status, 400);
  assert.equal((await api('POST', '/generations', { prompt: 'x', count: 99 })).status, 400);
});

test('SSE stream emits generation updates', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/events`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const created = (await api('POST', '/generations', { prompt: 'sse check' })).body;
  let buf = '';
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !buf.includes(created.id)) {
    const { value } = await reader.read();
    buf += new TextDecoder().decode(value);
  }
  ctrl.abort();
  assert.ok(buf.includes('event: generation'), 'should receive generation events');
  assert.ok(buf.includes(created.id));
});

test('folders: generate into, move images, filter, archive, delete', async () => {
  const folder = (await api('POST', '/folders', { name: 'Product shots' })).body;
  assert.equal(folder.name, 'Product shots');

  const gen = (await api('POST', '/generations', { prompt: 'mug on a table', count: 3, folderId: folder.id })).body;
  assert.ok(gen.jobs.every((j) => j.folderId === folder.id));
  await api('GET', `/generations/${gen.id}/wait?timeout=30`);

  const other = (await api('POST', '/folders', { name: 'Keepers' })).body;
  const moved = (await api('POST', '/images/move', { ids: [gen.jobs[0].id], folderId: other.id })).body;
  assert.equal(moved.moved, 1);

  const list = (await api('GET', '/folders')).body;
  const counts = Object.fromEntries(list.items.map((f) => [f.name, f.imageCount]));
  assert.equal(counts['Product shots'], 2);
  assert.equal(counts['Keepers'], 1);
  assert.equal(list.items.find((f) => f.name === 'Keepers').covers.length, 1);

  const inKeepers = (await api('GET', `/generations?folderId=${other.id}`)).body.items;
  assert.equal(inKeepers.length, 1);
  assert.equal(inKeepers[0].jobs.filter((j) => j.folderId === other.id).length, 1);
  const unfiled = (await api('GET', '/generations?folderId=none&limit=100')).body.items;
  assert.ok(!unfiled.some((g) => g.id === gen.id), 'all images are in folders');

  // Zip archive of the folder: 2 images + manifest, valid central directory.
  const res = await fetch(`${BASE}/folders/${folder.id}/archive`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /product-shots\.zip/);
  const zip = Buffer.from(await res.arrayBuffer());
  const eocd = zip.subarray(zip.length - 22);
  assert.equal(eocd.readUInt32LE(0), 0x06054b50);
  assert.equal(eocd.readUInt16LE(10), 3);
  assert.ok(zip.includes(Buffer.from('manifest.json')));
  assert.ok(zip.includes(Buffer.from('mug-on-a-table-2.png')));

  const sel = await fetch(`${BASE}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [gen.jobs[1].id] }),
  });
  assert.equal(Buffer.from(await sel.arrayBuffer()).subarray(-22).readUInt16LE(10), 2);

  // Delete keeps images by default; deleteImages=true removes them.
  assert.equal((await api('DELETE', `/folders/${other.id}`)).status, 204);
  const after = (await api('GET', `/generations/${gen.id}`)).body;
  assert.equal(after.jobs[0].folderId, null);
  assert.equal(after.jobs[0].status, 'succeeded');
  assert.equal((await api('DELETE', `/folders/${folder.id}?deleteImages=true`)).status, 204);
  const remaining = (await api('GET', `/generations/${gen.id}`)).body;
  assert.equal(remaining.jobs.length, 1);
});
