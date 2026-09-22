import React, { useState } from 'react';
import JSZip from 'jszip';
import api from '@fable/common/dist/api';
import { signedUploadHeaders } from '../upload-media-to-aws';

type Obj = Record<string, any>;
const cleanPath = (path: string) => path.replace(/^\/+/, '');

export function remapExport(value: any, ids: Record<string, number>, urls: Record<string, string>): any {
  if (typeof value === 'string') {
    const match = value.match(/^(\d+)(\/.*)?$/);
    if (match && ids[match[1]]) return `${ids[match[1]]}${match[2] || ''}`;
    return value.replace(/(?:https?:\/\/[^\s"'<>\\)]+)?\/root\/(?:proxy_asset|cmn|usr)\/[^\s"'<>\\)]+/g,
      url => urls[url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]] || url);
  }
  if (Array.isArray(value)) return value.map(v => remapExport(v, ids, urls));
  if (value && typeof value === 'object') {
    const result: Obj = {};
    for (const [key, v] of Object.entries(value)) result[ids[key] || key] = remapExport(v, ids, urls);
    return result;
  }
  return value;
}

function thumbnail(name: string, number: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 360;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#eef2f6'; ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = '#16023e'; ctx.font = 'bold 32px sans-serif';
  ctx.fillText(`Screen ${number}`, 36, 135);
  ctx.font = '22px sans-serif'; ctx.fillText(name.slice(0, 42), 36, 190);
  ctx.font = '16px sans-serif'; ctx.fillText('Imported recording', 36, 250);
  return canvas.toDataURL('image/png');
}

async function request(path: string, body?: Obj): Promise<any> {
  const resp = await api<any, any>(path, { auth: true, ...(body ? { body } : {}) });
  if (resp.status === 'Failure' || resp.data === undefined || resp.data === null) throw new Error(`Import request failed: ${path}`);
  return resp.data;
}

export default function ExportImport(): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Choose one exported Fable ZIP to restore it as an editable draft.');
  const [result, setResult] = useState('');

  const restore = async () => {
    if (!file || busy) return;
    setBusy(true); setResult('');
    try {
      setStatus('Checking export…');
      const zip = await JSZip.loadAsync(file);
      const files: Record<string, JSZip.JSZipObject> = {};
      for (const entry of Object.values(zip.files)) {
        if (!entry.dir) files[cleanPath(entry.name)] = entry;
      }
      const read = async (path: string) => {
        const entry = files[cleanPath(path)];
        if (!entry) throw new Error(`Missing export file: ${path}`);
        return JSON.parse(await entry.async('string'));
      };
      const metadata = Object.keys(files).filter(p => /^root\/ptour\/[^/]+\/0_d_data.json$/.test(p));
      if (metadata.length !== 1) throw new Error('Choose an export containing exactly one demo.');
      const raw = await read(metadata[0]);
      const old = raw.data || raw;
      const screens: Obj[] = old.screens || [];
      if (!screens.length || screens.length > 500) throw new Error('Export must contain 1–500 screens.');
      const base = `root/tour/${old.assetPrefixHash}/`;
      const index = await read(base + old.pubDataFileName);
      const loader = await read(base + old.pubLoaderFileName);
      const edits = await read(base + old.pubEditFileName);
      const types = files['_content-types.json'] ? await read('_content-types.json') : {};
      const screenIds = new Set(screens.map(s => `${s.id}`));
      for (const id of Object.keys(index.entities)) if (!screenIds.has(id)) throw new Error(`Missing recorded screen ${id}`);
      for (const screen of screens) {
        if (screen.type !== 1) throw new Error('This importer currently supports recorded HTML screens only.');
        await read(`root/srn/${screen.assetPrefixHash}/${old.cc.dataFileName}`);
        await read(`root/srn/${screen.assetPrefixHash}/${old.pubEditFileName}`);
      }
      // Only JSON and assets are read; exported application scripts are never executed.
      const checkpointKey = `fable/import/${localStorage.getItem('fable/oid')}/${old.rid}/${file.size}`;
      const checkpoint: Obj = JSON.parse(localStorage.getItem(checkpointKey) || '{}');
      checkpoint.assets = checkpoint.assets || {};
      checkpoint.screens = checkpoint.screens || {};
      const save = () => localStorage.setItem(checkpointKey, JSON.stringify(checkpoint));
      if (checkpoint.complete) { setResult(checkpoint.tour.rid); setStatus('This export has already been restored.'); return; }
      const assets = Object.keys(files).filter(p => /^root\/(proxy_asset|cmn|usr)\//.test(p));
      // Reserve destinations first so CSS can refer to other assets uploaded later.
      for (let i = 0; i < assets.length; i++) {
        const path = assets[i];
        setStatus(`Preparing asset ${i + 1} of ${assets.length}…`);
        if (!checkpoint.assets[path]) {
          const type = types[`/${path}`] || types[path] || 'application/octet-stream';
          const upload = await request(`/getuploadlink?te=${btoa(type)}`);
          checkpoint.assets[path] = { cdnPath: upload.cdnPath, type };
          // Presigned credentials stay in memory, not in the checkpoint.
          checkpoint.assets[path].pendingUrl = upload.url;
        }
      }
      const urls: Record<string, string> = {};
      for (const [path, asset] of Object.entries(checkpoint.assets) as [string, Obj][]) urls[`/${path}`] = asset.cdnPath;
      for (let i = 0; i < assets.length; i++) {
        const path = assets[i], asset = checkpoint.assets[path];
        if (asset.done) continue;
        setStatus(`Uploading asset ${i + 1} of ${assets.length}…`);
        // A failed upload reserves a fresh destination on the next attempt.
        if (!asset.pendingUrl) throw new Error('Asset upload interrupted. Please use a fresh export import checkpoint.');
        const blob = asset.type.includes('css')
          ? new Blob([remapExport(await files[path].async('string'), {}, urls)], { type: asset.type })
          : await files[path].async('blob');
        const resp = await fetch(asset.pendingUrl, { method: 'PUT', body: blob, headers: signedUploadHeaders(asset.pendingUrl, asset.type) });
        if (!resp.ok) throw new Error(`Asset upload failed (${resp.status})`);
        delete asset.pendingUrl; asset.done = true;
      }
      save();
      if (!checkpoint.tour) {
        setStatus('Creating draft demo…');
        checkpoint.tour = await request('/newtour', { name: old.displayName, description: old.description || '', settings: old.settings, info: { ...old.info, thumbnail: undefined } });
        save();
      }
      const ids: Record<string, number> = {};
      for (let i = 0; i < screens.length; i++) {
        const screen = screens[i];
        setStatus(`Restoring screen ${i + 1} of ${screens.length}…`);
        if (!checkpoint.screens[screen.id]) {
          const data = remapExport(await read(`root/srn/${screen.assetPrefixHash}/${old.cc.dataFileName}`), {}, urls);
          const created = await request('/newscreen', { name: screen.displayName, url: screen.url, type: 1, body: JSON.stringify(data), thumbnail: thumbnail(screen.displayName, i + 1) });
          checkpoint.screens[screen.id] = created; save();
        }
        const created = checkpoint.screens[screen.id];
        ids[screen.id] = created.id;
        if (!created.importComplete) {
          await request('/astsrntotour', { screenRid: created.rid, tourRid: checkpoint.tour.rid });
          const screenEdits = remapExport(await read(`root/srn/${screen.assetPrefixHash}/${old.pubEditFileName}`), {}, urls);
          await request('/recordeledit', { rid: created.rid, editData: JSON.stringify(screenEdits) });
          created.importComplete = true; save();
        }
      }
      setStatus('Restoring annotations, chapters, and styling…');
      const transformed = remapExport(index, ids, urls);
      for (const [route, data] of [['/recordtredit', transformed], ['/recordtrgbedit', remapExport(edits, ids, urls)], ['/recordtrloaderedit', remapExport(loader, ids, urls)]] as [string, Obj][]) {
        await request(route, { rid: checkpoint.tour.rid, editData: JSON.stringify(data) });
      }
      await request('/updtrprop', { tourRid: checkpoint.tour.rid, site: remapExport(old.site, ids, urls), settings: old.settings, responsive: old.responsive, inProgress: false, info: { ...old.info, thumbnail: checkpoint.screens[screens[0].id].thumbnail } });
      checkpoint.complete = true; save();
      setResult(checkpoint.tour.rid);
      setStatus(`Restored ${screens.length} screens as an editable draft. Original thumbnails were not in this export; numbered previews were created. External branding images may need replacement.`);
    } catch (error) {
      setStatus(`Import stopped: ${(error as Error).message}. Completed screens are retained; select the same ZIP to resume.`);
    } finally { setBusy(false); }
  };
  return <main style={{ padding: 40, maxWidth: 900, margin: 'auto' }}>
    <h1>Restore an exported demo</h1>
    <p>Recorded screens, annotations and chapters are restored to this account. The demo will remain unpublished.</p>
    <input aria-label="Demo export ZIP" type="file" accept=".zip" disabled={busy} onChange={e => setFile(e.target.files?.[0] || null)} />
    <button type="button" disabled={!file || busy} onClick={restore}>Restore demo</button>
    <p role="status">{status}</p>
    {result && <a href={`/preview/demo/${result}`}>Open restored demo</a>}
    <p><a href="/demos">Back to demos</a></p>
  </main>;
}

