/**
 * The proof mark: the shape a settled draw leaves, generated from its own proof.
 *
 * A guilloché rosette — the engraving banknotes and certificates carry because it
 * cannot be copied by hand — whose every parameter is read from the 32 bytes of
 * the draw's proof: the hash of the Chainlink VRF fulfilment transaction that
 * settled a lottery round (PrizeAwarded is emitted inside rawFulfillRandomWords),
 * or the VRF seed an Event Center campaign stores on-chain. The same proof always
 * draws the same shape; any other proof draws another. Nothing here is random:
 * the only generator is seeded by the proof.
 *
 * Pure functions, no DOM: the SVG mark (components/proof/ProofMark.tsx), the 3D
 * scene (lib/proof/scene.ts) and the check (test/proof/mark.test.mjs) share them.
 */

/** 32 bytes of a hash or a uint256 written in hex. Shorter input is left-padded, like a uint256. */
export function proofBytes(proof: string): Uint8Array {
  const hex = proof.toLowerCase().replace(/^0x/, '').replace(/[^0-9a-f]/g, '').padStart(64, '0').slice(-64);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** A uint256 (the campaign's VRF seed) as the 0x-prefixed 32-byte hex the mark reads. */
export const uintHex = (value: bigint): `0x${string}` => `0x${value.toString(16).padStart(64, '0')}`;

/** mulberry32, seeded by an FNV-1a fold of every byte of the proof (and a salt per use). */
export function proofRandom(bytes: Uint8Array, salt = 0): () => number {
  let h = (2166136261 ^ salt) >>> 0;
  for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0;
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One woven band of the rosette. Integer frequencies, so every strand closes on itself. */
export interface Band {
  readonly radius: number;
  readonly k1: number;
  readonly a1: number;
  readonly w1: number;
  readonly k2: number;
  readonly a2: number;
  readonly w2: number;
  /** The third dimension: how the band rises and falls. */
  readonly k3: number;
  readonly a3: number;
  readonly w3: number;
  /** The share of the strands this band gets. */
  readonly share: number;
}

export interface MarkParams {
  readonly bands: readonly Band[];
  readonly tilt: number;
  /** The proof's 64 hex digits, read round the rim of the SVG mark. */
  readonly nibbles: readonly number[];
}

export function markParams(bytes: Uint8Array): MarkParams {
  const r = proofRandom(bytes, 0x9e37);
  const count = 2 + (bytes[31] % 2);
  const radii = count === 2 ? [0.66, 0.36] : [0.7, 0.47, 0.26];
  const shares = count === 2 ? [0.62, 0.38] : [0.46, 0.32, 0.22];
  const int = (lo: number, span: number) => lo + Math.floor(r() * span);
  const bands = radii.map((radius, index): Band => {
    const k1 = int(index === 0 ? 5 : 3, 9);
    return {
      radius,
      k1,
      a1: radius * (0.14 + r() * 0.12),
      w1: int(1, 3),
      k2: k1 * 2 + int(1, 7),
      a2: radius * (0.03 + r() * 0.05),
      w2: int(1, 2),
      k3: int(2, 5),
      a3: 0.07 + r() * 0.13,
      w3: int(1, 2),
      share: shares[index],
    };
  });
  const nibbles: number[] = [];
  for (const b of bytes) nibbles.push(b >> 4, b & 15);
  return { bands, tilt: r() * Math.PI * 2, nibbles };
}

/** How many strands each band gets out of `total`, the outer band first. */
export function bandStrands(params: MarkParams, total: number): number[] {
  const counts = params.bands.map((band) => Math.max(2, Math.round(band.share * total)));
  counts[0] += total - counts.reduce((sum, n) => sum + n, 0);
  return counts;
}

/**
 * Point `i` of `points` on strand `j` of `n` in `band`, as [x, y, z]. θ runs a full
 * turn, so the last point meets the first.
 */
export function bandPoint(band: Band, tilt: number, j: number, n: number, i: number, points: number): [number, number, number] {
  const theta = (i / (points - 1)) * Math.PI * 2;
  const phi = (j / n) * Math.PI * 2;
  const r = band.radius + band.a1 * Math.sin(band.k1 * theta + band.w1 * phi) + band.a2 * Math.sin(band.k2 * theta - band.w2 * phi);
  const z = band.a3 * Math.sin(band.k3 * theta + band.w3 * phi) * (band.radius / 0.66);
  return [r * Math.cos(theta + tilt), r * Math.sin(theta + tilt), z];
}

/** The largest radius any band reaches, so a drawing can fit the rosette to its frame. */
export function markExtent(params: MarkParams): number {
  return Math.max(...params.bands.map((band) => band.radius + band.a1 + band.a2));
}

export interface MarkPath {
  readonly d: string;
  readonly band: number;
}

/**
 * The flat mark for SVG, in a 200 × 200 box centred on (100, 100): the rosette
 * fitted inside radius `fit` (of 100), one path per strand.
 */
export function markPaths(params: MarkParams, strands: number, points: number, fit = 80): MarkPath[] {
  const scale = fit / markExtent(params);
  const out: MarkPath[] = [];
  bandStrands(params, strands).forEach((n, bandIndex) => {
    const band = params.bands[bandIndex];
    for (let j = 0; j < n; j++) {
      let d = '';
      for (let i = 0; i < points; i++) {
        const [x, y] = bandPoint(band, params.tilt, j, n, i, points);
        d += `${i === 0 ? 'M' : 'L'}${(100 + x * scale).toFixed(1)} ${(100 + y * scale).toFixed(1)}`;
      }
      out.push({ d: `${d}Z`, band: bandIndex });
    }
  });
  return out;
}

/** The rim: one tick per hex digit of the proof, its length the digit's value. */
export function rimPath(params: MarkParams, inner = 88, span = 8): string {
  let d = '';
  params.nibbles.forEach((value, index) => {
    const a = params.tilt + (index / params.nibbles.length) * Math.PI * 2;
    const r1 = inner;
    const r2 = inner + 1.5 + (value / 15) * span;
    d += `M${(100 + Math.cos(a) * r1).toFixed(1)} ${(100 + Math.sin(a) * r1).toFixed(1)}L${(100 + Math.cos(a) * r2).toFixed(1)} ${(100 + Math.sin(a) * r2).toFixed(1)}`;
  });
  return d;
}

/** "0x3f9a…c21b": the proof as it is printed under its mark. */
export const shortProof = (proof: string) => `${proof.slice(0, 6)}…${proof.slice(-4)}`;
