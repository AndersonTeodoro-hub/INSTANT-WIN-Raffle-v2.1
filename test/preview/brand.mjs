/**
 * The Keptra link-preview image and app icons (SPEC-BLOCO-03 T9: the platform's
 * name in the previews and the manifest), rendered by Chrome from the markup below
 * and written to public/. NOT part of the build; run once when the mark changes.
 *
 *   CHROME_BIN=<chrome.exe> node test/preview/brand.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const FONTS = '<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800;900&family=IBM+Plex+Mono:wght@500&display=block" rel="stylesheet">';
const mark = (size) => `<div style="width:${size}px;height:${size}px;border:${Math.round(size / 14)}px solid #F59E0B;border-radius:${Math.round(size / 5)}px;display:grid;place-items:center;box-sizing:border-box;font:900 ${Math.round(size * 0.62)}px 'Big Shoulders Display';color:#F59E0B;line-height:1">K</div>`;
const page = (body, w, h) => `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>html,body{margin:0;width:${w}px;height:${h}px;background:#0A0A0B;overflow:hidden}</style></head><body>${body}</body></html>`;

const OG = page(
  `<div style="display:flex;align-items:center;gap:72px;height:630px;padding:0 120px;box-sizing:border-box">
     ${mark(250)}
     <div>
       <div style="font:900 150px 'Big Shoulders Display';color:#fff;line-height:.9">KEPTRA</div>
       <div style="margin-top:30px;font:500 34px 'IBM Plex Mono';letter-spacing:.12em;color:#9CA3AF">PROMISES, KEPT.</div>
       <div style="margin-top:22px;font:500 20px 'IBM Plex Mono';letter-spacing:.06em;color:#6B7280;white-space:nowrap">ON-CHAIN GUARANTEE FOR BRANDS · ARBITRUM ONE</div>
     </div>
   </div>`,
  1200,
  630,
);
const icon = (size) => page(`<div style="display:grid;place-items:center;width:${size}px;height:${size}px">${mark(Math.round(size * 0.78))}</div>`, size, size);

const OUT = [
  ['public/og-image-keptra.png', OG, 1200, 630],
  ['public/favicon-512.png', icon(512), 512, 512],
  ['public/favicon-192.png', icon(192), 192, 192],
  ['public/favicon-48.png', icon(48), 48, 48],
  ['public/apple-touch-icon.png', icon(180), 180, 180],
];

const port = 9334;
const proc = spawn(process.env.CHROME_BIN, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), 'keptra-brand-'))}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
for (let i = 0; i < 60; i += 1) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/version`);
    break;
  } catch {
    await sleep(500);
  }
}
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  pending.get(message.id)?.(message.result);
});
const send = (method, params = {}) => new Promise((resolve) => {
  id += 1;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});
for (const [file, html, width, height] of OUT) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` });
  await sleep(2500);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(root, file), Buffer.from(data, 'base64'));
  console.log(file);
}
socket.close();
proc.kill();
process.exit(0);
