/**
 * The Keptra screens in a real browser (Chrome, headless), against the local
 * preview only (T20). NOT part of the build. No dependency: the DevTools protocol
 * over the WebSocket Node already has.
 *
 *   CHROME_BIN=<chrome.exe> node test/preview/shoot.mjs <seed.json> <out dir, outside the repository>
 *
 * 1. Every new screen at the three widths of T21 (1440, 1024 and 390 px): a
 *    capture, and the contrast of every piece of text on it measured against the
 *    ground it is painted on (SPEC-BLOCO-03 V2: at least 4.5:1).
 * 2. The store's flow of V1 (A1), to its end: register the tracking number, reload,
 *    open the notice's link, declare the shipment — the signing sheet holding the
 *    focus and giving it back (B1) — sign, and see the order shipped.
 *
 * V6: the captures and contrast.json go to <out dir>, never into the repository.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const chrome = process.env.CHROME_BIN;
const web = `http://localhost:${process.env.PREVIEW_WEB_PORT ?? 5174}`;
const seed = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const out = path.resolve(process.argv[3] ?? '');
if (!process.argv[3] || !path.relative(repo, out).startsWith('..')) throw new Error('give an output directory outside the repository (V6)');
mkdirSync(out, { recursive: true });

const WIDTHS = [
  { width: 1440, height: 900, mobile: false },
  { width: 1024, height: 768, mobile: false },
  { width: 390, height: 844, mobile: true },
];

/** The new screens (T8, V2), in the states that show different text. */
const SCREENS = [
  { name: 'sign-in', as: 'none', url: '/orders' },
  { name: 'customer-offer', as: 'buyer', url: `/offers/${seed.termsId}` },
  { name: 'customer-offer-own-means', as: 'buyer', url: `/offers/${seed.ownMeansTermsId}` },
  { name: 'customer-orders', as: 'buyer', url: '/orders' },
  { name: 'customer-order-paid', as: 'buyer', url: `/orders/${seed.paidOrder}` },
  { name: 'customer-order-window', as: 'buyer', url: `/orders/${seed.windowOrder}` },
  { name: 'customer-sign-sheet', as: 'buyer', url: `/orders/${seed.paidOrder}`, click: 'Cancel the order', wait: 'Sign with passkey' },
  { name: 'customer-voucher', as: 'buyer', url: '/vouchers/1' },
  { name: 'customer-orders-read-failed', as: 'buyer', url: '/orders', fail: 'order/list', wait: 'Try again' },
  { name: 'account', as: 'buyer', url: '/account' },
  { name: 'account-business', as: 'store', url: '/account' },
  { name: 'business-orders', as: 'store', url: '/business' },
  { name: 'business-order-link', as: 'store', url: `/store/orders/${seed.paidOrder}` },
  { name: 'business-offers', as: 'store', url: '/business/offers' },
  { name: 'business-obligations', as: 'store', url: '/business/obligations' },
  { name: 'pool', as: 'none', url: '/pool' },
  { name: 'privacy', as: 'none', url: '/privacy' },
];

// --- the browser ------------------------------------------------------------------------------
const port = 9333;
const profile = mkdtempSync(path.join(os.tmpdir(), 'keptra-shoot-'));
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
for (let i = 0; i < 60; i += 1) {
  try {
    await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
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
const settle = async () => {
  await sleep(2000);
  const until = Date.now() + 25_000;
  while (Date.now() < until && (await evaluate(`/Loading|Reading|Checking|Looking/.test(document.body.innerText)`))) await sleep(500);
  await sleep(700); // the fade-in (animate-fade-in-up, 0.5 s) ends before anything is measured
};
const clickButton = (text) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.innerText.trim().includes(${JSON.stringify(text)})); if (!b) return false; b.focus(); b.click(); return true; })()`);
const shot = async (file, size, full = true) => {
  const { contentSize } = await send('Page.getLayoutMetrics');
  const height = full ? Math.min(Math.ceil(contentSize.height), 8000) : size.height;
  await send('Emulation.setDeviceMetricsOverride', { width: size.width, height, deviceScaleFactor: 1, mobile: size.mobile });
  await sleep(400);
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(path.join(out, file), Buffer.from(data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.mobile });
};

/**
 * V2, in the page: every visible piece of text — text nodes, the value and the
 * placeholder of a field — against the colour actually behind it, the element's own
 * background and its ancestors' composited down to an opaque one, with every
 * ancestor's opacity applied to the text. WCAG 2.1 relative luminance. While the
 * signing sheet is open only the sheet is measured: the page is behind its backdrop.
 */
const MEASURE = `(() => {
  const parse = (value) => {
    const m = value.match(/rgba?\\(([^)]+)\\)/) || value.match(/color\\(srgb ([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number);
    const scale = value.startsWith('color(') ? 255 : 1;
    return { r: parts[0] * scale, g: parts[1] * scale, b: parts[2] * scale, a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const ground = (element) => {
    const layers = [];
    for (let at = element; at; at = at.parentElement) {
      const colour = parse(getComputedStyle(at).backgroundColor);
      if (colour && colour.a > 0) {
        layers.push(colour);
        if (colour.a >= 1) break;
      }
    }
    let result = { r: 0, g: 0, b: 0, a: 1 };
    for (const layer of layers.reverse()) result = over(layer, result);
    return result;
  };
  const opacity = (element) => {
    let value = 1;
    for (let at = element; at; at = at.parentElement) value *= Number(getComputedStyle(at).opacity);
    return value;
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const measured = [];
  const add = (element, text, colour) => {
    const bg = ground(element);
    const fg = over({ ...colour, a: colour.a * opacity(element) }, bg);
    measured.push({ text: text.slice(0, 60), ratio: Math.round(ratio(fg, bg) * 100) / 100, fg: [fg.r, fg.g, fg.b].map(Math.round).join(','), bg: [bg.r, bg.g, bg.b].map(Math.round).join(',') });
  };
  // With the signing sheet open, the page behind it is under its backdrop and takes no input: the sheet is what is read.
  const scope = document.querySelector('[role="dialog"]') ?? document.body;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim();
    const element = node.parentElement;
    if (!text || !element || !visible(element) || element.closest('svg, script, style')) continue;
    add(element, text, parse(getComputedStyle(element).color));
  }
  for (const field of scope.querySelectorAll('input, textarea, select')) {
    if (!visible(field)) continue;
    if (field.value) add(field, field.value, parse(getComputedStyle(field).color));
    else if (field.placeholder) add(field, field.placeholder, parse(getComputedStyle(field, '::placeholder').color));
  }
  const failures = measured.filter((m) => m.ratio < 4.5);
  return { texts: measured.length, min: measured.reduce((low, m) => Math.min(low, m.ratio), Infinity), failures };
})()`;

await send('Page.enable');
await send('Runtime.enable');
const login = (as) => fetch(`${web}/__preview/login?as=${as}`);
const report = [];

// --- 1. the screens, and their contrast -------------------------------------------------------
for (const screen of SCREENS) {
  await login(screen.as);
  if (screen.fail) await fetch(`${web}/__preview/fail?route=${screen.fail}&on=1`);
  for (const size of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.mobile });
    await send('Page.navigate', { url: `${web}${screen.url}` });
    await settle();
    if (screen.click) await clickButton(screen.click);
    if (screen.wait) await waitFor(screen.wait);
    if (screen.click) await sleep(900);
    const contrast = await evaluate(MEASURE);
    report.push({ screen: screen.name, width: size.width, ...contrast });
    await shot(`${screen.name}-${size.width}.png`, size, !screen.click);
    console.log(`${screen.name}-${size.width}: ${contrast.texts} texts, lowest ${contrast.min}:1, ${contrast.failures.length} below 4.5`);
  }
  if (screen.fail) await fetch(`${web}/__preview/fail?route=${screen.fail}&on=0`);
}
writeFileSync(path.join(out, 'contrast.json'), JSON.stringify(report, null, 2));

// --- 2. V1: the store's flow, with a reload -----------------------------------------------------
const flow = [];
const step = async (name, check) => {
  const ok = await check();
  flow.push({ step: name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  await shot(`v1-${String(flow.length).padStart(2, '0')}-${name}.png`, WIDTHS[0], false);
  return ok;
};
const card = (orderId, expression) =>
  `(() => { const card = [...document.querySelectorAll('article')].find((a) => a.innerText.includes('Order #${orderId}')); return card ? (${expression}) : false; })()`;
const offersShip = (orderId) => evaluate(card(orderId, `[...card.querySelectorAll('button')].some((b) => b.innerText.includes('Declare shipped')) && !card.querySelector('#track-${orderId}')`));
const order = seed.paidOrder;
const size = WIDTHS[0];
await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false });
await login('store');
await send('Page.navigate', { url: `${web}/business` });
await settle();
await step('before-tracking-asks-for-the-number', () => evaluate(card(order, `!!card.querySelector('#track-${order}')`)));
await evaluate(card(order, `(() => {
  const input = card.querySelector('#track-${order}');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(input, 'CTT0009998887PT');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  [...card.querySelectorAll('button')].find((b) => b.innerText.includes('Register tracking')).click();
  return true;
})()`));
await step('tracking-registered', () => waitFor('Tracking number registered. Now declare the order shipped.'));
await send('Page.reload', { ignoreCache: true });
await settle();
await step('after-reload-offers-declare-shipped', () => offersShip(order));
await send('Page.navigate', { url: `${web}/store/orders/${order}` });
await settle();
await step('notice-link-offers-declare-shipped', () => offersShip(order));
// B1: the sheet holds the focus and gives it back to the button that opened it.
await clickButton('Declare shipped');
await waitFor('Sign with passkey');
await sleep(700);
// Real key presses, through the browser's own input: seven Tabs forwards, seven back, each landing inside the sheet.
const press = async (key, keyCode, modifiers = 0) => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: keyCode, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: keyCode, modifiers });
  await sleep(80);
};
const landed = [];
for (let i = 0; i < 14; i += 1) {
  await press('Tab', 9, i < 7 ? 0 : 8);
  landed.push(await evaluate(`document.querySelector('[role="dialog"]')?.contains(document.activeElement) === true`));
}
await step('sheet-holds-the-focus', async () => landed.every(Boolean));
await press('Escape', 27);
await sleep(800);
await step('focus-back-on-declare-shipped', () => evaluate(`document.activeElement?.innerText?.includes('Declare shipped') === true`));
await clickButton('Declare shipped');
await waitFor('Sign with passkey');
await sleep(700);
await clickButton('Sign with passkey');
await step('shipment-signed-and-relayed', () => waitFor('Done on-chain.', 90_000).then(async (done) => done || waitFor('Sent; confirming on-chain.', 5_000)));
await sleep(20_000); // the preview's orders pass, every 15 s, as the cron's
await send('Page.reload', { ignoreCache: true });
await settle();
await step('after-the-pass-the-order-is-shipped', () => evaluate(card(order, `card.innerText.includes('Shipped — on its way')`)));
writeFileSync(path.join(out, 'v1-flow.json'), JSON.stringify(flow, null, 2));

socket.close();
proc.kill();
const below = report.filter((r) => r.failures.length > 0);
console.log(`contrast: ${report.length} screen-widths, ${below.length} with text below 4.5:1; flow: ${flow.filter((s) => s.ok).length}/${flow.length} steps`);
process.exit(below.length === 0 && flow.every((s) => s.ok) ? 0 : 1);
