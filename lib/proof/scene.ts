/**
 * The film's shapes, in three dimensions, and the one projection both renderers
 * use — WebGL (components/film/sceneGL.ts) and the still version drawn once with
 * Canvas 2D (drawStill, for reduced motion, no WebGL, or a weak device).
 *
 * Every shape is STRANDS lines of POINTS points, so any two morph into each other
 * point by point on the GPU. Each point is [x, y, z, accent]: accent 0 is the
 * engraving's silver, 1 is green (proven on-chain), -1 amber (a prize moving).
 * The rosettes are the proof mark of lib/proof/mark.ts; the rest is geometry.
 */
import { bandPoint, bandStrands, markExtent, markParams, proofRandom, type MarkParams } from './mark';

export const STRANDS = 48;
export const POINTS = 240;

export type ShapeId = 'chaos' | 'rosette' | 'ticket' | 'block' | 'reveal' | 'payout' | 'escrow' | 'modules' | 'rings';
export const SHAPES: readonly ShapeId[] = ['chaos', 'rosette', 'ticket', 'block', 'reveal', 'payout', 'escrow', 'modules', 'rings'];

type Vec = [number, number, number];
type Strand = { points: Vec[]; accent: number };

/** Resample a polyline to `count` points evenly spaced along its length. */
function resample(line: Vec[], count: number): Vec[] {
  const lengths = [0];
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    lengths.push(lengths[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const total = lengths[lengths.length - 1] || 1;
  const out: Vec[] = [];
  let seg = 1;
  for (let i = 0; i < count; i++) {
    const at = (i / (count - 1)) * total;
    while (seg < line.length - 1 && lengths[seg] < at) seg++;
    const span = lengths[seg] - lengths[seg - 1] || 1;
    const t = Math.min(1, Math.max(0, (at - lengths[seg - 1]) / span));
    const [a, b] = [line[seg - 1], line[seg]];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

const circle = (cx: number, cy: number, cz: number, r: number, turns = 1, phase = 0): Vec[] =>
  Array.from({ length: 97 }, (_, i) => {
    const a = phase + (i / 96) * Math.PI * 2 * turns;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz] as Vec;
  });

function rosetteStrands(params: MarkParams, count: number, scale: number, center: Vec = [0, 0, 0], flatten = 1, accent = 0): Strand[] {
  const fit = scale / markExtent(params);
  const strands: Strand[] = [];
  bandStrands(params, count).forEach((n, b) => {
    for (let j = 0; j < n; j++) {
      const points: Vec[] = [];
      for (let i = 0; i < POINTS; i++) {
        const [x, y, z] = bandPoint(params.bands[b], params.tilt, j, n, i, POINTS);
        points.push([center[0] + x * fit, center[1] + y * fit, center[2] + z * fit * flatten]);
      }
      strands.push({ points, accent });
    }
  });
  return strands;
}

/** The unresolved state: random walks inside a sphere, seeded by the proof. */
function chaos(bytes: Uint8Array): Strand[] {
  const r = proofRandom(bytes, 0xc4a05);
  return Array.from({ length: STRANDS }, () => {
    let p: Vec = [(r() - 0.5) * 1.4, (r() - 0.5) * 1.4, (r() - 0.5) * 1.4];
    let d: Vec = [r() - 0.5, r() - 0.5, r() - 0.5];
    const points: Vec[] = [];
    for (let i = 0; i < POINTS; i++) {
      d = [d[0] + (r() - 0.5) * 0.9, d[1] + (r() - 0.5) * 0.9, d[2] + (r() - 0.5) * 0.9];
      const len = Math.hypot(...d) || 1;
      d = [d[0] / len, d[1] / len, d[2] / len];
      p = [p[0] + d[0] * 0.045, p[1] + d[1] * 0.045, p[2] + d[2] * 0.045];
      const out = Math.hypot(...p);
      if (out > 1.02) {
        const n: Vec = [p[0] / out, p[1] / out, p[2] / out];
        const dot = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
        d = [d[0] - 2 * dot * n[0], d[1] - 2 * dot * n[1], d[2] - 2 * dot * n[2]];
        p = [n[0] * 1.02, n[1] * 1.02, n[2] * 1.02];
      }
      points.push(p);
    }
    return { points, accent: 0 };
  });
}

/**
 * The ticket: an engraved border band with the tear's two notches, the tear
 * itself as a row of perforations, printed rows, security waves, and the proof's
 * own rosette as the stamp on the stub.
 */
function ticket(params: MarkParams): Strand[] {
  const W = 1.72;
  const H = 0.88;
  const tearX = 0.4;
  const bend = (x: number) => 0.07 * Math.cos(x * 1.4);
  const flat = (points: Vec[]): Vec[] => points.map(([x, y]) => [x, y, bend(x)]);
  const strands: Strand[] = [];

  const outline = (inset: number): Vec[] => {
    const w = W / 2 - inset;
    const h = H / 2 - inset;
    const c = 0.07;
    const notch = 0.085 + inset;
    const line: Vec[] = [];
    const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
      for (let i = 0; i <= 12; i++) {
        const a = a0 + ((a1 - a0) * i) / 12;
        line.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0]);
      }
    };
    arc(-w + c, h - c, c, Math.PI / 2, Math.PI);
    arc(-w + c, -h + c, c, Math.PI, (Math.PI * 3) / 2);
    arc(tearX, -h - inset, notch, Math.PI, 0);
    arc(w - c, -h + c, c, -Math.PI / 2, 0);
    arc(w - c, h - c, c, 0, Math.PI / 2);
    arc(tearX, h + inset, notch, 0, -Math.PI);
    line.push(line[0]);
    return flat(line);
  };
  for (let k = 0; k < 12; k++) strands.push({ points: resample(outline(k * 0.011), POINTS), accent: 0 });

  // The tear: a prolate trochoid, loops like perforations, twice.
  for (let k = 0; k < 2; k++) {
    const line: Vec[] = [];
    const turns = 15;
    const b = 0.02;
    const length = H - 0.2;
    for (let i = 0; i <= 600; i++) {
      const t = (i / 600) * turns * Math.PI * 2;
      line.push([tearX + b * Math.cos(t) + k * 0.006, -length / 2 + (length / (turns * Math.PI * 2)) * t - b * Math.sin(t), 0]);
    }
    strands.push({ points: resample(flat(line), POINTS), accent: 0 });
  }

  // Printed rows, left of the tear: there and back, so each is one strand.
  const rows: [number, number, number][] = [
    [0.26, -0.72, 0.1],
    [0.235, -0.72, 0.1],
    [0.12, -0.72, -0.12],
    [0.05, -0.72, 0.16],
    [-0.06, -0.72, -0.2],
    [-0.2, -0.72, -0.34],
    [-0.27, -0.72, 0.0],
    [-0.27, 0.12, 0.3],
    [-0.13, 0.08, 0.3],
    [-0.19, 0.08, 0.3],
  ];
  for (const [y, x0, x1] of rows) strands.push({ points: resample(flat([[x0, y, 0], [x1, y, 0], [x0, y - 0.004, 0]]), POINTS), accent: 0 });

  // Security waves behind the rows.
  for (let k = 0; k < 12; k++) {
    const y0 = -0.34 + (k / 11) * 0.68;
    const line: Vec[] = [];
    for (let i = 0; i <= 120; i++) {
      const x = -0.78 + (i / 120) * 1.1;
      line.push([x, y0 + 0.028 * Math.sin(x * 9 + k * 0.7), 0]);
    }
    strands.push({ points: resample(flat(line), POINTS), accent: 0 });
  }

  // The stamp: the proof's own rosette, on the stub.
  const stamp = rosetteStrands(params, 12, 0.24, [0.72, 0, 0], 0.2).map((s) => ({ ...s, points: flat(s.points) }));
  return [...strands, ...stamp].slice(0, STRANDS);
}

/** Sealed: the proof inside, the block's edges closing round it (green: on-chain). */
function block(params: MarkParams): Strand[] {
  const v = (i: number): Vec => [(i & 1 ? 1 : -1) * 0.62, (i & 2 ? 1 : -1) * 0.62, (i & 4 ? 1 : -1) * 0.62];
  const cycles = [
    [0, 1, 3, 2, 6, 7, 5, 4, 0],
    [0, 2, 3, 1, 5, 7, 6, 4, 0],
    [0, 1, 5, 4, 6, 7, 3, 2, 0],
  ];
  const edges: Strand[] = [];
  for (let k = 0; k < 24; k++) {
    const cycle = cycles[k % 3];
    const shrink = 1 - Math.floor(k / 3) * 0.012;
    edges.push({ points: resample(cycle.map((i) => v(i).map((c) => c * shrink) as Vec), POINTS), accent: 1 });
  }
  return [...edges, ...rosetteStrands(params, 24, 0.4)];
}

/** Revealed: the rosette flat to the viewer, the winners' strands in green. */
function reveal(params: MarkParams, winners: number): Strand[] {
  const strands = rosetteStrands(params, STRANDS, 0.92, [0, 0, 0], 0.18);
  const outer = bandStrands(params, STRANDS)[0];
  const lit = Math.max(1, Math.min(winners, 12));
  for (let k = 0; k < lit; k++) strands[Math.floor((k * outer) / lit)].accent = 1;
  return strands;
}

const bezier = (a: Vec, b: Vec, c: Vec, d: Vec): Vec[] =>
  Array.from({ length: 81 }, (_, i) => {
    const t = i / 80;
    const u = 1 - t;
    return [0, 1, 2].map((k) => u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * d[k]) as Vec;
  });

/** The prize leaves the contract for the winner's wallet: amber, the colour of a prize. */
function payout(params: MarkParams): Strand[] {
  const from: Vec = [-0.95, 0, 0];
  const to: Vec = [0.95, 0, 0];
  const strands = rosetteStrands(params, 8, 0.26, from, 0.4);
  const r = proofRandom(new Uint8Array([7, 7, 7]), 3);
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    const start: Vec = [from[0] + Math.cos(a) * 0.1, from[1] + Math.sin(a) * 0.1, 0];
    const end: Vec = [to[0] + Math.cos(a) * 0.035, to[1] + Math.sin(a) * 0.035, 0];
    const lift = (r() - 0.5) * 0.9;
    const depth = (r() - 0.5) * 0.6;
    strands.push({ points: resample(bezier(start, [-0.35, lift, depth], [0.35, lift * 0.5, -depth], end), POINTS), accent: -1 });
  }
  for (let k = 0; k < 8; k++) strands.push({ points: resample(circle(to[0], to[1], 0, 0.1 + k * 0.012), POINTS), accent: 1 });
  return strands;
}

/**
 * Keptra: the buyer, the escrow holding the payment, the store — the path to the
 * store in green, opened by a proven delivery — and under the escrow the pool's
 * three layers (bond, risk reserve, capital) that protect a winner if a brand fails.
 */
function escrow(): Strand[] {
  const strands: Strand[] = [];
  const y = 0.16;
  for (let k = 0; k < 4; k++) strands.push({ points: resample(circle(-1.02, y, 0, 0.1 + k * 0.014), POINTS), accent: 0 });
  for (let k = 0; k < 6; k++) strands.push({ points: resample(circle(0, y, -0.15 + k * 0.06, 0.2), POINTS), accent: 0 });
  for (let k = 0; k < 4; k++) strands.push({ points: resample(circle(1.02, y, 0, 0.1 + k * 0.014), POINTS), accent: 1 });
  for (let k = 0; k < 10; k++) {
    const s = (k - 4.5) * 0.012;
    strands.push({ points: resample(bezier([-0.9, y + s, 0], [-0.6, y + 0.18 + s, 0.05], [-0.4, y + 0.18 - s, -0.05], [-0.2, y + s * 0.5, 0]), POINTS), accent: 0 });
  }
  for (let k = 0; k < 10; k++) {
    const s = (k - 4.5) * 0.012;
    strands.push({ points: resample(bezier([0.2, y + s * 0.5, 0], [0.4, y + 0.18 - s, 0.05], [0.6, y + 0.18 + s, -0.05], [0.9, y + s, 0]), POINTS), accent: 1 });
  }
  [-0.3, -0.45, -0.6].forEach((depth) => {
    for (let k = 0; k < 4; k++) {
      const line: Vec[] = [];
      for (let i = 0; i <= 60; i++) {
        const x = -0.78 + (i / 60) * 1.56;
        line.push([x, depth - 0.09 * (1 - (x * x) / 0.61) - k * 0.008, 0]);
      }
      strands.push({ points: resample(line, POINTS), accent: 0 });
    }
  });
  for (let k = 0; k < 2; k++) strands.push({ points: resample([[k * 0.02 - 0.01, y - 0.2, 0], [k * 0.02 - 0.01, -0.36, 0]], POINTS), accent: 0 });
  return strands;
}

/** Concentric rings: a module, or a step, with no proof to show yet. */
function ringsAt(center: Vec, radius: number, count: number): Strand[] {
  return Array.from({ length: count }, (_, k) => ({ points: resample(circle(center[0], center[1], center[2], radius * (0.45 + (k / count) * 0.55)), POINTS), accent: 0 }));
}

/**
 * Keptra's three modules — Instant Win, Giveaways, the Event Center: a module
 * carries a mark only if it has a settled draw of its own; otherwise rings. All
 * three are live, so all three are green. Giveaways and the Event Center run on
 * the one GiveawayManagerV2, so their latest draw, and their mark, is the same.
 */
function modules(lottery: MarkParams | null, campaign: MarkParams | null): Strand[] {
  const at = (params: MarkParams | null, x: number) =>
    params ? rosetteStrands(params, 16, 0.36, [x, 0, 0], 0.5, 1) : ringsAt([x, 0, 0], 0.34, 16).map((s) => ({ ...s, accent: 1 }));
  return [...at(lottery, -0.92), ...at(campaign, 0), ...at(campaign, 0.92)];
}

function pack(strands: Strand[]): Float32Array {
  const out = new Float32Array(STRANDS * POINTS * 4);
  for (let s = 0; s < STRANDS; s++) {
    const strand = strands[s % strands.length];
    for (let i = 0; i < POINTS; i++) {
      const p = strand.points[i];
      out.set([p[0], p[1], p[2], strand.accent], (s * POINTS + i) * 4);
    }
  }
  return out;
}

/**
 * Every shape for one proof, packed for the GPU. `winners`: how many strands light
 * up in the reveal; `lottery` and `campaign`: each module's own latest settled
 * draw, for the modules (null: rings).
 */
export function buildShapes(bytes: Uint8Array, data: { winners: number; lottery: Uint8Array | null; campaign: Uint8Array | null }): Record<ShapeId, Float32Array> {
  const params = markParams(bytes);
  return {
    chaos: pack(chaos(bytes)),
    rosette: pack(rosetteStrands(params, STRANDS, 0.95)),
    ticket: pack(ticket(params)),
    block: pack(block(params)),
    reveal: pack(reveal(params, data.winners)),
    payout: pack(payout(params)),
    escrow: pack(escrow()),
    modules: pack(modules(data.lottery ? markParams(data.lottery) : null, data.campaign ? markParams(data.campaign) : null)),
    rings: pack(ringsAt([0, 0, 0], 0.9, STRANDS)),
  };
}

/** Where the shape sits and how it turns: centre and scale in clip space, rotation in radians. */
export interface Camera {
  readonly cx: number;
  readonly cy: number;
  readonly scale: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
}

const DIST = 4;

/**
 * The projection, column-major for WebGL: rotate, then a mild perspective, then
 * place the unit shape on its anchor (cx, cy, scale), keeping circles round.
 */
export function cameraMatrix(cam: Camera, aspect: number): Float32Array {
  const [cy, sy] = [Math.cos(cam.yaw), Math.sin(cam.yaw)];
  const [cp, sp] = [Math.cos(cam.pitch), Math.sin(cam.pitch)];
  const [cr, sr] = [Math.cos(cam.roll), Math.sin(cam.roll)];
  // R = Rz(roll) · Rx(pitch) · Ry(yaw), rows.
  const ry = [
    [cy, 0, sy],
    [0, 1, 0],
    [-sy, 0, cy],
  ];
  const rx = [
    [1, 0, 0],
    [0, cp, -sp],
    [0, sp, cp],
  ];
  const rz = [
    [cr, -sr, 0],
    [sr, cr, 0],
    [0, 0, 1],
  ];
  const mul = (a: number[][], b: number[][]) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
  const R = mul(rz, mul(rx, ry));
  const sx = cam.scale / aspect;
  const rows = [
    [...R[0].map((v, j) => v * sx - (cam.cx / DIST) * R[2][j]), cam.cx],
    [...R[1].map((v, j) => v * cam.scale - (cam.cy / DIST) * R[2][j]), cam.cy],
    [...R[2].map((v) => -0.25 * v), 0],
    [...R[2].map((v) => -v / DIST), 1],
  ];
  const m = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) m[c * 4 + r] = rows[r][c];
  return m;
}

export const SILVER: Vec = [0.8, 0.84, 0.9];
export const GREEN: Vec = [0.133, 0.773, 0.369];
export const AMBER: Vec = [0.961, 0.62, 0.043];

/**
 * The still version: the same shape, the same projection, drawn once with Canvas
 * 2D — for reduced motion, no WebGL, or a device too weak for the live scene.
 * `tint` pulls every line towards green, as the live scene does.
 */
export function drawStill(canvas: HTMLCanvasElement, shape: Float32Array, cam: Camera, tint = 0): void {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = Math.max(1, ratio * 0.75);
  ctx.lineJoin = 'round';
  const m = cameraMatrix(cam, width / height);
  const px = (x: number, y: number, z: number): [number, number, number] => {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    const depth = -(m[2] * x + m[6] * y + m[10] * z + m[14]) * 4;
    return [((nx + 1) / 2) * canvas.width, ((1 - ny) / 2) * canvas.height, depth];
  };
  for (let s = 0; s < STRANDS; s++) {
    const base = s * POINTS * 4;
    const accent = shape[base + 3];
    const green = Math.max(accent, tint, 0);
    let color = SILVER.map((v, k) => v + (GREEN[k] - v) * green);
    if (accent < 0) color = color.map((v, k) => v + (AMBER[k] - v) * -accent);
    let depthSum = 0;
    ctx.beginPath();
    for (let i = 0; i < POINTS; i++) {
      const o = base + i * 4;
      const [x, y, depth] = px(shape[o], shape[o + 1], shape[o + 2]);
      depthSum += depth;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const depth = Math.min(1, Math.max(0, (depthSum / POINTS + 1.2) / 2.4));
    ctx.strokeStyle = `rgba(${color.map((v) => Math.round(v * 255)).join(',')},${(0.16 + 0.46 * depth).toFixed(3)})`;
    ctx.stroke();
  }
}

/** The proof bytes for the scene, from a hex proof (mark.ts proofBytes), re-exported for the film. */
export { proofBytes } from './mark';
