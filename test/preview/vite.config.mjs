/**
 * The local preview's Vite configuration (test/preview/server.mjs writes the files
 * it swaps in). NOT the build: `npm run build` uses ../../vite.config.ts, which
 * knows nothing of this.
 *
 * Three modules are swapped, by resolved path, for the preview's own:
 * - lib/keptra/contracts.ts — the addresses of the contracts deployed on the fork;
 * - lib/rpc.ts — the fork's endpoint on 127.0.0.1 (T20: never a production node);
 * - lib/keptra/webauthn.ts — passkeyOrigin true on localhost, so the summary sheet
 *   (C12) opens; and signHash answered by the preview server's software passkey of
 *   the session (/__preview/sign), since the page's passkeys are keptra.io's and
 *   the store's flow has to run to its end (SPEC-BLOCO-03 V1).
 * /api goes to the preview's bridge.
 */
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const gen = process.env.PREVIEW_GEN_DIR;
const api = `http://127.0.0.1:${process.env.PREVIEW_API_PORT ?? 8787}`;

const webauthn = readFileSync(path.join(root, 'lib/keptra/webauthn.ts'), 'utf8')
  .replace('return origin === KEPTRA_ORIGIN && hasWebAuthn;', 'return hasWebAuthn || origin.length > 0; // PREVIEW ONLY: the sheet opens on localhost')
  .replace(
    '  const credential = (await credentials.get({',
    `  // PREVIEW ONLY: the preview server signs with the session's software passkey.
  if (credentials === navigator.credentials) return (await fetch('/__preview/sign', { method: 'POST', body: JSON.stringify({ hash }) })).json();
  const credential = (await credentials.get({`,
  );
if (!webauthn.includes('/__preview/sign')) throw new Error('the preview could not swap signHash');
writeFileSync(path.join(gen, 'webauthn.ts'), webauthn);

const SWAP = new Map([
  [path.join(root, 'lib/keptra/contracts.ts'), path.join(gen, 'contracts.ts')],
  [path.join(root, 'lib/rpc.ts'), path.join(gen, 'rpc.ts')],
  [path.join(root, 'lib/keptra/webauthn.ts'), path.join(gen, 'webauthn.ts')],
].map(([from, to]) => [path.normalize(from).toLowerCase(), to]));

export default {
  root,
  plugins: [
    react(),
    {
      name: 'keptra-preview-swap',
      enforce: 'pre',
      async resolveId(source, importer, options) {
        if (!importer || importer.startsWith(gen)) return null;
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        const swap = resolved && SWAP.get(path.normalize(resolved.id.split('?')[0]).toLowerCase());
        return swap ?? null;
      },
    },
  ],
  server: { port: Number(process.env.PREVIEW_WEB_PORT ?? 5174), strictPort: true, fs: { allow: [root, gen] }, proxy: { '/api': api, '/__preview': api } },
};
