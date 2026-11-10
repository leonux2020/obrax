// @vitest-environment happy-dom
// BURSTS IN SINGLE FILE: two (or twenty) photos in a row never fight for the line, never share a name and never overwrite each other.
//   - Drive: the photos of an expediente go up one at a time, in order; a photo counts as uploaded only when ITS upload succeeded; two syncs never run at once;
//   - names: every photo carries the whole id (random + millisecond clock) / the millisecond stamp of its capture, stable between syncs;
//   - worker (receiptSync.js): one drain at a time, a row is removed only after its expenses were applied, and a photo that arrives while the worker is leaving is not left behind.
import { describe, it, expect, vi } from 'vitest';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { createDriveClient } from '../src/lib/drive.js';
import { collectDossierImages, syncDossier } from '../src/lib/driveExport.js';
import { newEntryId } from '../src/lib/ledger.js';
import { createReceiptQueue } from '../src/lib/receiptQueue.js';
import { drainReceiptQueue } from '../src/lib/receiptSync.js';

const bytesOf = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => 65 + ((i + seed) % 26));
const img = (name, n, seed) => ({ name, mimeType: 'image/jpeg', load: async () => bytesOf(n, seed) });
const slow = (ms = 6) => new Promise((r) => setTimeout(r, ms));
const clientFor = (drive, wrap) => createDriveClient({ getToken: async () => drive.token, fetchImpl: wrap ? wrap(drive.fetchImpl) : drive.fetchImpl });
const isUpload = (url, init) => String(url).includes('/upload/') && init?.method === 'POST';
const nameOfUpload = (init) => JSON.parse(new TextDecoder().decode(init.body.slice(0, 600)).split('\r\n\r\n')[1].split('\r\n')[0]).name;
const projectFiles = (drive) => drive.backupFiles().map((f) => f.name).sort();

describe('names: two photos of the same second never collide', () => {
  const blobOf = (n) => new Blob([bytesOf(n)], { type: 'image/jpeg' });
  it('receipts and logbook photos use the WHOLE id (random + millisecond clock), not a 6-character slice', async () => {
    const at = Date.UTC(2026, 10, 10);
    const project = {
      logbook: [{ id: 'abc123xyz789', at, text: 'Losa', photo: true }, { id: 'abc123xyz780', at, text: 'Losa', photo: true }],
      expenses: [
        { id: 'e1', at, supplier: 'Sodimac', description: 'x', amount: 1, receiptId: 'rcp111aaa001' },
        { id: 'e2', at, supplier: 'Sodimac', description: 'y', amount: 1, receiptId: 'rcp111aaa002' }, // same first 6 characters, same day, same shop
      ],
    };
    const photos = await collectDossierImages(project, { notePhoto: async () => ({ blob: blobOf(10) }), receiptPhoto: async () => ({ blob: blobOf(10) }) });
    const names = photos.map((p) => p.name);
    expect(new Set(names).size).toBe(4);
    expect(names).toEqual(['Bitacora_2026-11-10_Losa_abc123xyz789.jpg', 'Bitacora_2026-11-10_Losa_abc123xyz780.jpg', 'Comprobante_2026-11-10_Sodimac_rcp111aaa001.jpg', 'Comprobante_2026-11-10_Sodimac_rcp111aaa002.jpg']);
  });

  it('camera photos end with their capture stamp in milliseconds: the same slot retaken is a NEW file, never an overwrite', async () => {
    const dataUrl = `data:image/jpeg;base64,${Buffer.from(bytesOf(20)).toString('base64')}`;
    const t1 = Date.UTC(2026, 10, 10, 9, 0, 0, 123);
    const t2 = t1 + 1; // the very next millisecond
    const photos = await collectDossierImages({}, { cameraPhotos: async () => [{ slot: 0, dataUrl, at: t1 }, { slot: 0, dataUrl, at: t2 }, { slot: 1, dataUrl, at: 0 }] });
    expect(photos.map((p) => p.name)).toEqual([`Obra_2026-11-10_1_${t1}.jpg`, `Obra_2026-11-10_1_${t2}.jpg`, 'Obra_sin-fecha_2.jpg']);
  });

  it('a burst of ids made by newEntryId in the same millisecond gives a different name to each of the 200 receipts', async () => {
    const at = Date.UTC(2026, 10, 10);
    const ids = Array.from({ length: 200 }, () => newEntryId());
    const project = { expenses: ids.map((receiptId, i) => ({ id: `e${i}`, at, supplier: 'Sodimac', description: 'x', amount: 1, receiptId })) };
    const photos = await collectDossierImages(project, { receiptPhoto: async () => ({ blob: blobOf(5) }) });
    expect(photos).toHaveLength(200);
    expect(new Set(photos.map((p) => p.name)).size).toBe(200);
  });

  it('the names are stable: a second pass over the same project derives exactly the same ones (a second sync uploads nothing twice)', async () => {
    const at = Date.UTC(2026, 10, 10);
    const project = { expenses: [{ id: 'e1', at, supplier: 'Sodimac', description: 'x', amount: 1, receiptId: 'rcp111aaa001' }] };
    const src = { receiptPhoto: async () => ({ blob: blobOf(5) }) };
    expect((await collectDossierImages(project, src)).map((p) => p.name)).toEqual((await collectDossierImages(project, src)).map((p) => p.name));
  });

  it('even if two photos of one run were given the very same name, both reach Drive (the second gets -2) and the first is not overwritten', async () => {
    const drive = createFakeDrive();
    await syncDossier({ client: clientFor(drive), title: 'Obra', images: [img('Obra_x.jpg', 40, 1), img('Obra_x.jpg', 55, 2), img('Obra_x.jpg', 70, 3)] });
    expect(projectFiles(drive)).toEqual(['Obra_x-2.jpg', 'Obra_x-3.jpg', 'Obra_x.jpg']);
    expect(drive.backupFiles().find((f) => f.name === 'Obra_x.jpg').body.length).toBe(40);
  });
});

describe('Drive: single file, and a photo is "uploaded" only when its own upload succeeded', () => {
  it('never two uploads in flight, in the order of the burst', async () => {
    const drive = createFakeDrive();
    let inflight = 0;
    let peak = 0;
    const order = [];
    const client = clientFor(drive, (f) => async (url, init) => {
      if (!isUpload(url, init)) return f(url, init);
      inflight += 1;
      peak = Math.max(peak, inflight);
      order.push(nameOfUpload(init));
      await slow();
      inflight -= 1;
      return f(url, init);
    });
    const images = Array.from({ length: 8 }, (_, i) => img(`Obra_${i}.jpg`, 50 + i, i));
    const stats = await syncDossier({ client, title: 'Obra', images });
    expect(peak).toBe(1);
    expect(order).toEqual(images.map((i) => i.name));
    expect(stats).toMatchObject({ uploaded: 8, failed: 0 });
  });

  it('a photo whose upload fails is NOT counted as uploaded; the others still go up; the next sync sends only the missing one', async () => {
    const drive = createFakeDrive();
    let n = 0;
    const flaky = clientFor(drive, (f) => async (url, init) => {
      if (isUpload(url, init) && (n += 1) === 2) return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
      return f(url, init);
    });
    const images = [img('Comprobante_a.jpg', 40, 1), img('Comprobante_b.jpg', 50, 2), img('Comprobante_c.jpg', 60, 3)];
    const first = await syncDossier({ client: flaky, title: 'Obra', images });
    expect(first).toMatchObject({ uploaded: 2, failed: 1, unchanged: 0 });
    expect(projectFiles(drive)).toEqual(['Comprobante_a.jpg', 'Comprobante_c.jpg']);
    const second = await syncDossier({ client: clientFor(drive), title: 'Obra', images });
    expect(second).toMatchObject({ uploaded: 1, unchanged: 2, failed: 0 });
    expect(projectFiles(drive)).toEqual(['Comprobante_a.jpg', 'Comprobante_b.jpg', 'Comprobante_c.jpg']);
  });

  it('QUEUE LOCK: two syncs asked at once for the same Drive never overlap, and nothing is uploaded twice', async () => {
    const drive = createFakeDrive();
    let inflight = 0;
    let peak = 0;
    const client = clientFor(drive, (f) => async (url, init) => {
      if (!isUpload(url, init)) return f(url, init);
      inflight += 1;
      peak = Math.max(peak, inflight);
      await slow();
      inflight -= 1;
      return f(url, init);
    });
    const images = Array.from({ length: 5 }, (_, i) => img(`Obra_${i}.jpg`, 50 + i, i));
    const [a, b] = await Promise.all([syncDossier({ client, title: 'Obra', images }), syncDossier({ client, title: 'Obra', images })]);
    expect(peak).toBe(1);
    expect(a.uploaded).toBe(5);
    expect(b).toMatchObject({ uploaded: 0, unchanged: 5 }); // it waited for its turn and saw the photos of the first
    expect(projectFiles(drive)).toEqual(images.map((i) => i.name).sort());
  });

  it('the second sync that waits carries its OWN (fresher) list: the photo taken meanwhile is uploaded', async () => {
    const drive = createFakeDrive();
    const client = clientFor(drive);
    const first = syncDossier({ client, title: 'Obra', images: [img('Obra_1.jpg', 40, 1)] });
    const second = syncDossier({ client, title: 'Obra', images: [img('Obra_1.jpg', 40, 1), img('Obra_2.jpg', 50, 2)] });
    await Promise.all([first, second]);
    expect(projectFiles(drive)).toEqual(['Obra_1.jpg', 'Obra_2.jpg']);
  });

  it('a sync that fails does not block the one behind it', async () => {
    const drive = createFakeDrive();
    const client = clientFor(drive);
    const bad = syncDossier({ client, title: 'Obra', documents: async () => { throw new Error('boom'); }, images: [img('Obra_1.jpg', 40, 1)] });
    const good = syncDossier({ client, title: 'Obra', images: [img('Obra_2.jpg', 50, 2)] });
    await expect(bad).rejects.toThrow('boom');
    await expect(good).resolves.toMatchObject({ uploaded: 1 });
    expect(projectFiles(drive)).toEqual(['Obra_2.jpg']);
  });
});

describe('worker: the receipt queue is emptied by ONE worker at a time', () => {
  const IMG = 'data:image/jpeg;base64,/9j/AAAA';
  const answer = (amount = 1000) => ({ isReceipt: true, receipts: [{ supplier: 'Sodimac', currency: 'CLP', date: '2026-10-29', total: amount, items: [{ description: 'Cemento', amount, category: 'material' }] }] });
  const park = (queue, n) => Promise.all(Array.from({ length: n }, (_, i) => queue.enqueue({ projectId: 'proyecto01', image: IMG, currency: 'CLP', lang: 'es', now: 1 + i })));

  it('several wake-ups at once (timer + online + new photo) never run two workers: each photo is read once, one request at a time', async () => {
    const queue = createReceiptQueue();
    await park(queue, 4);
    let inflight = 0;
    let peak = 0;
    const request = vi.fn(async () => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await slow(4);
      inflight -= 1;
      return answer();
    });
    const apply = vi.fn(async () => true);
    const drain = () => drainReceiptQueue({ queue, apply, request, online: () => true, now: () => 10_000 });
    await Promise.all([drain(), drain(), drain(), drain()]);
    expect(peak).toBe(1);
    expect(request).toHaveBeenCalledTimes(4);
    expect(apply).toHaveBeenCalledTimes(4);
    expect(await queue.list()).toHaveLength(0);
  });

  it('rows are processed in the order they were taken', async () => {
    const queue = createReceiptQueue();
    await park(queue, 3);
    const seen = [];
    await drainReceiptQueue({ queue, apply: async (_p, _e, row) => { seen.push(row.createdAt); return true; }, request: async () => answer(), online: () => true, now: () => 10_000 });
    expect(seen).toEqual([1, 2, 3]);
  });

  it('a row leaves the queue only AFTER its expenses were applied: if applying fails the photo stays queued', async () => {
    const queue = createReceiptQueue();
    await park(queue, 2);
    let n = 0;
    const apply = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('disk full');
      return true;
    });
    const res = await drainReceiptQueue({ queue, apply, request: async () => answer(), online: () => true, now: () => 10_000 });
    expect(res.done).toHaveLength(1);
    const rows = await queue.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending'); // waits for its retry
  });

  it('a photo that arrives in the very instant the worker is leaving is not left behind (the worker looks once more)', async () => {
    const real = createReceiptQueue();
    await park(real, 1);
    let armed = false;
    let late = null;
    const queue = new Proxy(real, {
      get(target, prop) {
        if (prop === 'list') {
          return async () => {
            const rows = await target.list();
            if (armed && !rows.length) {
              armed = false; // the final look of the worker: empty... and a new photo shows up right after it, together with a new wake-up
              await target.enqueue({ projectId: 'proyecto01', image: IMG, currency: 'CLP', lang: 'es', now: 5 });
              late = drainReceiptQueue({ queue, apply, request, online: () => true, now: () => 10_000 });
            }
            return rows;
          };
        }
        const v = target[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const request = vi.fn(async () => answer());
    let once = true;
    const apply = vi.fn(async () => {
      if (once) armed = true; // only after the FIRST photo
      once = false;
      return true;
    });
    const res = await drainReceiptQueue({ queue, apply, request, online: () => true, now: () => 10_000 });
    await late;
    expect(request).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(res.done).toHaveLength(2); // the results of both passes are one
    expect(await real.list()).toHaveLength(0);
  });

  it('after the run ends a new wake-up starts a fresh worker (the lock does not stay closed)', async () => {
    const queue = createReceiptQueue();
    const apply = vi.fn(async () => true);
    const request = vi.fn(async () => answer());
    await park(queue, 1);
    await drainReceiptQueue({ queue, apply, request, online: () => true, now: () => 10_000 });
    await park(queue, 1);
    await drainReceiptQueue({ queue, apply, request, online: () => true, now: () => 10_000 });
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
