/**
 * The local preview's Vite configuration (test/preview/server.mjs writes the files
 * it swaps in). NOT the build: `npm run build` uses ../../vite.config.ts, which
 * knows nothing of this.
 *
 * Three modules are swapped, by resolved path, for the preview's own:
 * - lib/keptra/contracts.ts — the addresses of the contracts deployed on the fork;
 * - lib/rpc.ts — the fork's endpoint on 127.0.0.1 (T20: never a production node);
 * - lib/keptra/webauthn.ts's passkeyOrigin — true on localhost, so the summary sheet
 *   (C12) can be opened and photographed; nothing can be signed from here, since
 *   the passkeys are keptra.io's.
 * /api goes to the preview's bridge.
 */
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const gen = process.env.PREVIEW_GEN_DIR;
const api = `http://127.0.0.1:${process.env.PREVIEW_API_PORT ?? 8787}`;

const webauthn = readFileSync(path.join(root, 'lib/keptra/webauthn.ts'), 'utf8').replace(
  'return origin === KEPTRA_ORIGIN && hasWebAuthn;',
  'return hasWebAuthn || origin.length > 0; // PREVIEW ONLY: the sheet opens on localhost; nothing signs',
);
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
