import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Pause, Play } from 'lucide-react';
import type { Camera, ShapeId } from '../../lib/proof/scene';
import type { Frame, Scene } from './sceneGL';

/*
 * The film: one scene, fixed behind a presentation page, that scroll drives from
 * shape to shape (lib/proof/scene.ts). The page declares where the scene sits and
 * what it shows with <FilmSection> and <FilmAnchor>; the scene glides from anchor
 * to anchor, so it follows the layout at every width.
 *
 * Order of arrival (performance): the text and the first view are plain HTML and
 * paint first; the geometry and the WebGL renderer are separate chunks, fetched
 * after the first paint, and the scene fades in once they are ready.
 *
 * Two modes:
 * - live: WebGL, pinned chapters, the scene morphing with the scroll, reacting to
 *   the pointer and to touch;
 * - still: for prefers-reduced-motion, no WebGL, a weak device, or a frame rate
 *   that cannot keep up — every chapter in normal flow, each with its shape drawn
 *   once in place (Canvas 2D, same geometry, same projection). The whole story,
 *   without the movement.
 */

export type Mode = 'live' | 'still';

export interface KeySpec {
  /** Where in the section's pinned range the scene reaches this shape (0–1). */
  readonly at: number;
  readonly shape: ShapeId;
  readonly yaw?: number;
  readonly pitch?: number;
  readonly roll?: number;
  /** Multiplier of the anchor's size. */
  readonly zoom?: number;
  /** 0–1 towards green: a proven fact. */
  readonly tint?: number;
  /** 0–1: light travels along the strands (value moving). */
  readonly flow?: number;
  /** The scene's presence here (0 hides it behind a reading section). */
  readonly alpha?: number;
  /** Radians per second round the view axis while resting here. */
  readonly spin?: number;
  /** The key the still version draws (default: the last one). */
  readonly still?: boolean;
}

interface Registration {
  readonly anchor: HTMLElement;
  readonly keys: readonly KeySpec[];
}

interface FilmContextValue {
  readonly mode: Mode | null;
  readonly shapes: Record<ShapeId, Float32Array> | null;
  readonly register: (registration: Registration) => () => void;
}

const FilmContext = createContext<FilmContextValue>({ mode: null, shapes: null, register: () => () => {} });
export const useFilmMode = () => useContext(FilmContext).mode;

type SceneModule = typeof import('../../lib/proof/scene');

interface Key {
  readonly y: number;
  readonly shape: ShapeId;
  readonly cam: Camera;
  readonly tint: number;
  readonly flow: number;
  readonly alpha: number;
  readonly spin: number;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const INTRO_MS = 1800;

/** Reduced motion, saved data, few cores or little memory, no WebGL: the still version. */
function detectMode(): Mode {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'still';
  // Pinned chapters need a screen tall enough to hold their text.
  if (window.innerHeight < 500) return 'still';
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return 'still';
  if ((nav.deviceMemory !== undefined && nav.deviceMemory < 4) || (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency < 4)) return 'still';
  try {
    if (!document.createElement('canvas').getContext('webgl')) return 'still';
  } catch {
    return 'still';
  }
  return 'live';
}

export function Film({
  proof,
  fallback,
  winners = 3,
  lottery = null,
  campaign = null,
  pauseLabel,
  playLabel,
  children,
}: {
  /** The latest settled draw's proof; undefined while it is being read. */
  proof: string | undefined;
  /** What the rosettes are drawn from when there is no settled draw (or the read is slow). */
  fallback: string;
  winners?: number;
  /** Each module's own latest settled draw (the modules shape); null draws rings. */
  lottery?: string | null;
  campaign?: string | null;
  pauseLabel: string;
  playLabel: string;
  children: React.ReactNode;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [module, setModule] = useState<SceneModule | null>(null);
  const [waited, setWaited] = useState(false);
  const [paused, setPaused] = useState(false);
  const registrations = useRef(new Set<Registration>());
  const [layoutVersion, setLayoutVersion] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // After the first paint: decide the mode, then fetch the geometry.
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const decide = () => setMode(detectMode());
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1));
    idle(decide);
    media.addEventListener('change', decide);
    const timer = window.setTimeout(() => setWaited(true), 2500);
    return () => {
      media.removeEventListener('change', decide);
      window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (mode === null || module !== null) return;
    void import('../../lib/proof/scene').then(setModule);
  }, [mode, module]);

  const source = proof ?? (waited ? fallback : undefined);
  const shapes = useMemo(() => {
    if (module === null || source === undefined) return null;
    return module.buildShapes(module.proofBytes(source), {
      winners,
      lottery: lottery ? module.proofBytes(lottery) : null,
      campaign: campaign ? module.proofBytes(campaign) : null,
    });
  }, [module, source, winners, lottery, campaign]);

  const register = useCallback((registration: Registration) => {
    registrations.current.add(registration);
    setLayoutVersion((v) => v + 1);
    return () => {
      registrations.current.delete(registration);
      setLayoutVersion((v) => v + 1);
    };
  }, []);

  const value = useMemo(() => ({ mode, shapes, register }), [mode, shapes, register]);

  return (
    <FilmContext.Provider value={value}>
      <div className={clsx(mode === 'live' && 'film-live')}>
        {mode === 'live' && (
          <>
            <canvas ref={canvasRef} aria-hidden="true" className="film-canvas pointer-events-none fixed inset-0 z-0 h-full w-full" />
            <LiveScene canvas={canvasRef} shapes={shapes} registrations={registrations} layoutVersion={layoutVersion} paused={paused} onTooSlow={() => setMode('still')} />
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
              aria-label={paused ? playLabel : pauseLabel}
              title={paused ? playLabel : pauseLabel}
              className="iw-btn iw-btn-secondary fixed bottom-4 right-4 z-30 h-11 w-11 min-h-0 px-0 text-gray-300 backdrop-blur-md sm:bottom-6 sm:right-6"
            >
              {paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
            </button>
          </>
        )}
        {children}
      </div>
    </FilmContext.Provider>
  );
}

/** Measures the anchors into keys along the page's scroll. */
function measure(registrations: Set<Registration>): Key[] {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const keys: Key[] = [];
  for (const { anchor, keys: specs } of registrations) {
    const section = anchor.closest<HTMLElement>('[data-film-section]');
    if (!section) continue;
    const sectionRect = section.getBoundingClientRect();
    const top = sectionRect.top + window.scrollY;
    const range = Math.max(0, sectionRect.height - vh);
    const sticky = anchor.closest<HTMLElement>('[data-film-sticky]');
    const a = anchor.getBoundingClientRect();
    // The opening section (it starts under the header) is where the page is at scroll 0.
    const base = !sticky && top < vh * 0.25 ? 0 : top;
    for (const spec of specs) {
      const y = base + spec.at * range;
      const anchorTop = sticky ? a.top - sticky.getBoundingClientRect().top : a.top + window.scrollY - y;
      const size = Math.min(a.width, a.height) * (spec.zoom ?? 1);
      keys.push({
        y,
        shape: spec.shape,
        tint: spec.tint ?? 0,
        flow: spec.flow ?? 0,
        alpha: spec.alpha ?? 1,
        spin: spec.spin ?? 0,
        cam: {
          cx: ((a.left + a.width / 2) / vw) * 2 - 1,
          cy: 1 - ((anchorTop + a.height / 2) / vh) * 2,
          scale: size / vh,
          yaw: spec.yaw ?? 0,
          pitch: spec.pitch ?? 0,
          roll: spec.roll ?? 0,
        },
      });
    }
  }
  return keys.sort((p, q) => p.y - q.y);
}

function LiveScene({
  canvas,
  shapes,
  registrations,
  layoutVersion,
  paused,
  onTooSlow,
}: {
  canvas: React.RefObject<HTMLCanvasElement>;
  shapes: Record<ShapeId, Float32Array> | null;
  registrations: React.MutableRefObject<Set<Registration>>;
  layoutVersion: number;
  paused: boolean;
  onTooSlow: () => void;
}) {
  const scene = useRef<Scene | null>(null);
  const keys = useRef<Key[]>([]);
  const state = useRef({
    intro: -1,
    pointer: [0, 0] as [number, number],
    tilt: [0, 0] as [number, number],
    target: [0, 0] as [number, number],
    light: 0,
    lastMove: -1e9,
    start: performance.now(),
    frames: [] as number[],
    judged: false,
    spin: 0,
  });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const wake = useRef<() => void>(() => {});

  // The renderer, once the geometry is here; new geometry after that is uploaded in place.
  useEffect(() => {
    if (shapes === null || canvas.current === null) return;
    if (scene.current) {
      scene.current.update(shapes);
      // A proof that arrives while the hero is in view resolves again, from chaos.
      if (window.scrollY < window.innerHeight * 0.4) state.current.intro = performance.now();
      wake.current();
      return;
    }
    let live = true;
    void import('./sceneGL').then(({ createScene }) => {
      if (!live || canvas.current === null) return;
      scene.current = createScene(canvas.current, shapes);
      if (scene.current === null) return onTooSlow();
      state.current.intro = performance.now();
      wake.current();
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes]);
  useEffect(() => () => scene.current?.destroy(), []);

  // Layout: the anchors, measured again when anything moves them.
  useLayoutEffect(() => {
    const remeasure = () => {
      keys.current = measure(registrations.current);
      scene.current?.resize();
      wake.current();
    };
    remeasure();
    const observer = new ResizeObserver(remeasure);
    observer.observe(document.body);
    void document.fonts?.ready.then(remeasure);
    return () => observer.disconnect();
  }, [layoutVersion, registrations]);

  // The pointer: a spring toward it for the tilt, a light where it is.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const x = (event.clientX / window.innerWidth) * 2 - 1;
      const y = 1 - (event.clientY / window.innerHeight) * 2;
      state.current.pointer = [x, y];
      state.current.target = [x, y];
      if (event.pointerType !== 'touch' || event.buttons > 0) state.current.lastMove = performance.now();
      wake.current();
    };
    const leave = () => {
      state.current.target = [0, 0];
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', move);
      document.documentElement.removeEventListener('pointerleave', leave);
    };
  }, []);

  // One loop. It sleeps when nothing moves: paused and still, or the tab hidden.
  useEffect(() => {
    let raf = 0;
    let running = false;
    let last = performance.now();
    let clock = 0;

    const frameAt = (now: number, dt: number): Frame | null => {
      const list = keys.current;
      if (list.length === 0) return null;
      const s = state.current;
      const y = window.scrollY;
      let i = list.findIndex((k) => k.y > y);
      if (i === -1) i = list.length;
      const a = list[Math.max(0, i - 1)];
      const b = list[Math.min(list.length - 1, i)];
      const raw = b.y === a.y ? 1 : (y - a.y) / (b.y - a.y);
      const m = smooth(clamp((raw - 0.12) / 0.76));
      const lerp = (p: number, q: number) => p + (q - p) * m;
      // Spin is integrated (moving between chapters never jumps the angle) and
      // kept within half a turn either way; it only applies where a key spins,
      // so a shape that does not turn unwinds into its own pose.
      if (!pausedRef.current) s.spin = ((s.spin + lerp(a.spin, b.spin) * (dt / 1000) + Math.PI) % (Math.PI * 2)) - Math.PI;
      const spinning = lerp(a.spin > 0 ? 1 : 0, b.spin > 0 ? 1 : 0);
      const cam: Camera = {
        cx: lerp(a.cam.cx, b.cam.cx),
        cy: lerp(a.cam.cy, b.cam.cy),
        scale: lerp(a.cam.scale, b.cam.scale),
        yaw: lerp(a.cam.yaw, b.cam.yaw) + s.tilt[0] * 0.38,
        pitch: lerp(a.cam.pitch, b.cam.pitch) - s.tilt[1] * 0.26,
        roll: lerp(a.cam.roll, b.cam.roll) + s.spin * spinning,
      };
      let from = a.shape;
      let to = b.shape;
      let mix = m;
      // The first seconds: the draw resolves out of chaos into the first shape.
      if (s.intro >= 0) {
        const t = clamp((now - s.intro) / INTRO_MS);
        if (t >= 1 || y > window.innerHeight * 0.5) s.intro = -1;
        else if (i <= 1) {
          from = 'chaos';
          to = list[0].shape;
          mix = smooth(t);
        }
      }
      return {
        from,
        to,
        mix,
        cam,
        tint: lerp(a.tint, b.tint),
        flow: lerp(a.flow, b.flow),
        alpha: lerp(a.alpha, b.alpha) * clamp((now - s.start) / 600),
        time: clock,
        pointer: s.pointer,
        light: s.light,
      };
    };

    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const s = state.current;
      if (!pausedRef.current) clock += dt / 1000;
      // Critically damped towards the pointer: it follows, it does not snap.
      const k = 1 - Math.exp(-dt / 180);
      s.tilt = [s.tilt[0] + (s.target[0] - s.tilt[0]) * k, s.tilt[1] + (s.target[1] - s.tilt[1]) * k];
      s.light += ((now - s.lastMove < 2200 ? 1 : 0) - s.light) * (1 - Math.exp(-dt / 400));
      const frame = frameAt(now, dt);
      if (scene.current && frame) scene.current.draw(frame);

      // Judge the device once, over the first two seconds after the intro.
      if (!s.judged && scene.current && s.intro < 0 && !pausedRef.current) {
        s.frames.push(dt);
        if (s.frames.length >= 90) {
          s.judged = true;
          const median = [...s.frames].sort((p, q) => p - q)[s.frames.length >> 1];
          if (median > 34) return onTooSlow();
        }
      }

      const settling = Math.abs(s.target[0] - s.tilt[0]) + Math.abs(s.target[1] - s.tilt[1]) > 0.002 || s.intro >= 0 || s.light > 0.01;
      if (document.hidden || (pausedRef.current && !settling)) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (running || document.hidden) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    wake.current = start;
    const onScroll = () => start();
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onScroll);
    start();
    return () => {
      cancelAnimationFrame(raf);
      running = false;
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    wake.current();
  }, [paused]);

  return null;
}

/**
 * A chapter. Pinned in the live film (its content stays while the scene moves,
 * for `length` of scroll); in the still version it is a plain section.
 */
export function FilmSection({
  id,
  pinned = true,
  length = '170svh',
  className,
  panelClassName,
  children,
  label,
}: {
  id: string;
  pinned?: boolean;
  length?: string;
  className?: string;
  panelClassName?: string;
  children: React.ReactNode;
  label?: string;
}) {
  const mode = useFilmMode();
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState(false);
  const live = mode === 'live' && pinned;

  // The chapter in the middle of the screen is the one being told.
  useEffect(() => {
    if (!live || !ref.current) return;
    const observer = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), { rootMargin: '-45% 0px -45% 0px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [live]);

  return (
    <section
      id={id}
      ref={ref}
      aria-label={label}
      data-film-section=""
      data-active={live ? active : undefined}
      className={clsx('relative z-10', className)}
      style={live ? { height: length } : undefined}
    >
      <div data-film-sticky={live ? '' : undefined} className={clsx(live && 'sticky top-0 h-[100svh]', panelClassName)}>
        {children}
      </div>
    </section>
  );
}

/**
 * Where the scene sits in a chapter, and what it shows there. Live, it is an
 * empty frame the scene is fitted to; still, the shape is drawn in it once.
 */
export function FilmAnchor({
  keys,
  className,
  children,
  ghost = false,
}: {
  keys: readonly KeySpec[];
  className?: string;
  children?: React.ReactNode;
  /** Only a place for the camera (the scene hidden behind a reading section): nothing is drawn here. */
  ghost?: boolean;
}) {
  const { mode, shapes, register } = useContext(FilmContext);
  const ref = useRef<HTMLDivElement>(null);
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const signature = JSON.stringify(keys);

  useEffect(() => {
    if (mode !== 'live' || !ref.current) return;
    return register({ anchor: ref.current, keys: keysRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, register, signature]);

  return (
    <div ref={ref} aria-hidden={ghost || undefined} className={clsx('relative', className)}>
      {mode === 'still' && shapes && !ghost && <StillShape shapes={shapes} spec={keys.find((k) => k.still) ?? keys[keys.length - 1]} />}
      {children}
    </div>
  );
}

function StillShape({ shapes, spec }: { shapes: Record<ShapeId, Float32Array>; spec: KeySpec }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let live = true;
    const draw = () =>
      void import('../../lib/proof/scene').then(({ drawStill }) => {
        if (!live || !ref.current) return;
        const zoom = spec.zoom ?? 1;
        drawStill(ref.current, shapes[spec.shape], { cx: 0, cy: 0, scale: zoom, yaw: spec.yaw ?? 0, pitch: spec.pitch ?? 0, roll: spec.roll ?? 0 }, spec.tint ?? 0);
      });
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [shapes, spec]);
  return <canvas ref={ref} aria-hidden="true" className="absolute inset-0 h-full w-full" />;
}
