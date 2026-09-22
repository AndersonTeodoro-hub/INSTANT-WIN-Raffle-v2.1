/**
 * Captures of the main Keptra screens in a real browser (Chrome, headless), at the
 * three widths of T21 — 1440, 1024 and 390 px — against the local preview only
 * (T20). NOT part of the build. No dependency: the DevTools protocol over the
 * WebSocket Node already has.
 *
 *   CHROME_BIN=<chrome.exe> node test/preview/shoot.mjs <seed.json>
 *
 * Writes test/preview/screens/<screen>-<width>.png, full page.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const chrome = process.env.CHROME_BIN;
const web = `http://localhost:${process.env.PREVIEW_WEB_PORT ?? 5174}`;
const seed = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'screens');
mkdirSync(out, { recursive: true });

const WIDTHS = [
  { width: 1440, height: 900, mobile: false },
  { width: 1024, height: 768, mobile: false },
  { width: 390, height: 844, mobile: true },
];

const SCREENS = [
  { name: 'customer-offer', as: 'buyer', url: `/offers/${seed.termsId}` },
  { name: 'customer-orders', as: 'buyer', url: '/orders' },
  { name: 'customer-order-window', as: 'buyer', url: `/orders/${seed.windowOrder}` },
  { name: 'customer-sign-sheet', as: 'buyer', url: `/orders/${seed.paidOrder}`, click: 'Cancel the order', wait: 'Sign with passkey' },
  { name: 'account', as: 'buyer', url: '/account' },
  { name: 'business-orders', as: 'store', url: '/business' },
  { name: 'business-offers', as: 'store', url: '/business/offers' },
  { name: 'business-obligations', as: 'store', url: '/business/obligations' },
  { name: 'pool', as: 'none', url: '/pool' },
  { name: 'event-center', as: 'none', url: '/events' },
];

const port = 9333;
const profile = mkdtempSync(path.join(os.tmpdir(), 'keptra-shoot-'));
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let version;
for (let i = 0; i < 60; i += 1) {
  try {
    version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
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
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    id += 1;
    pending.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)));
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
const waitFor = async (text, ms = 30_000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await evaluate(`document.body && document.body.innerText.includes(${JSON.stringify(text)})`)) return true;
    await sleep(400);
  }
  return false;
};

await send('Page.enable');
await send('Runtime.enable');
void version;

for (const screen of SCREENS) {
  await fetch(`${web}/__preview/login?as=${screen.as}`);
  for (const size of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.mobile });
    await send('Page.navigate', { url: `${web}${screen.url}` });
    await sleep(2500);
    // Let the chain reads and the bridge answer: no "Loading" left on the page, or 25 s.
    const until = Date.now() + 25_000;
    while (Date.now() < until && (await evaluate(`/Loading|Reading|Checking|Looking/.test(document.body.innerText)`))) await sleep(500);
    if (screen.click) {
      await evaluate(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes(${JSON.stringify(screen.click)}))?.click()`);
      await waitFor(screen.wait);
      await sleep(600);
    }
    const { contentSize } = await send('Page.getLayoutMetrics');
    const height = screen.click ? size.height : Math.min(Math.ceil(contentSize.height), 6000);
    await send('Emulation.setDeviceMetricsOverride', { width: size.width, height, deviceScaleFactor: 1, mobile: size.mobile });
    await sleep(400);
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(path.join(out, `${screen.name}-${size.width}.png`), Buffer.from(data, 'base64'));
    console.log(`${screen.name}-${size.width}.png`);
  }
}

socket.close();
proc.kill();
process.exit(0);
