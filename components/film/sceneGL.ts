/**
 * The live scene: plain WebGL 1, no library. Every shape of lib/proof/scene.ts is
 * uploaded once; a frame binds two of them and morphs between them in the vertex
 * shader, strand after strand, so the CPU does no geometry per frame — one draw
 * call of STRANDS × POINTS points as lines, added light on the dark ground.
 *
 * Loaded on its own chunk, after the page's first view (components/film/Film.tsx).
 */
import { AMBER, GREEN, POINTS, SHAPES, SILVER, STRANDS, cameraMatrix, type Camera, type ShapeId } from '../../lib/proof/scene';

export interface Frame {
  readonly from: ShapeId;
  readonly to: ShapeId;
  /** 0 → from, 1 → to. */
  readonly mix: number;
  readonly cam: Camera;
  /** 0–1: every line towards green (a proven fact). */
  readonly tint: number;
  /** 0–1: light travelling along the strands (value moving). */
  readonly flow: number;
  /** 0–1: the whole scene's presence. */
  readonly alpha: number;
  readonly time: number;
  /** The pointer in clip space, and how much light it gives. */
  readonly pointer: readonly [number, number];
  readonly light: number;
}

const VERTEX = `
attribute vec4 a_from;
attribute vec4 a_to;
attribute vec2 a_st;
uniform mat4 u_m;
uniform float u_mix;
uniform float u_time;
uniform vec2 u_pointer;
uniform float u_aspect;
varying float v_accent;
varying float v_depth;
varying float v_t;
varying float v_s;
varying float v_light;
void main() {
  float k = clamp(u_mix * 1.5 - a_st.x * 0.5, 0.0, 1.0);
  k = k * k * (3.0 - 2.0 * k);
  vec3 p = mix(a_from.xyz, a_to.xyz, k);
  float wave = sin(a_st.y * 18.85 + u_time * 0.7 + a_st.x * 6.283);
  p += normalize(p + vec3(0.0001)) * wave * 0.006;
  gl_Position = u_m * vec4(p, 1.0);
  v_accent = mix(a_from.w, a_to.w, k);
  v_depth = -gl_Position.z * 4.0;
  v_t = a_st.y;
  v_s = a_st.x;
  vec2 d = (gl_Position.xy / gl_Position.w - u_pointer) * vec2(u_aspect, 1.0);
  v_light = exp(-dot(d, d) * 9.0);
}`;

const FRAGMENT = `
precision mediump float;
uniform vec3 u_silver;
uniform vec3 u_green;
uniform vec3 u_amber;
uniform float u_tint;
uniform float u_flow;
uniform float u_clock;
uniform float u_alpha;
uniform float u_light;
varying float v_accent;
varying float v_depth;
varying float v_t;
varying float v_s;
varying float v_light;
void main() {
  float depth = clamp((v_depth + 1.2) / 2.4, 0.0, 1.0);
  vec3 c = mix(u_silver, u_green, max(clamp(v_accent, 0.0, 1.0), u_tint));
  c = mix(c, u_amber, clamp(-v_accent, 0.0, 1.0));
  float a = mix(0.14, 0.6, depth) * (1.0 + 1.6 * v_light * u_light);
  float pulse = pow(max(0.0, sin((v_t * 3.0 - u_clock * 0.45 + v_s * 1.7) * 6.2831)), 30.0);
  a = (a + pulse * u_flow * 0.9) * u_alpha;
  gl_FragColor = vec4(c * a, a);
}`;

export interface Scene {
  draw(frame: Frame): void;
  /** New shapes (a proof arrived): uploaded in place, same buffers. */
  update(shapes: Record<ShapeId, Float32Array>): void;
  resize(): void;
  destroy(): void;
}

export function createScene(canvas: HTMLCanvasElement, shapes: Record<ShapeId, Float32Array>): Scene | null {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'default' });
  if (!gl) return null;

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffers = new Map<ShapeId, WebGLBuffer>();
  const upload = (next: Record<ShapeId, Float32Array>) => {
    for (const id of SHAPES) {
      const buffer = buffers.get(id) ?? gl.createBuffer()!;
      buffers.set(id, buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, next[id], gl.STATIC_DRAW);
    }
  };
  upload(shapes);

  // Where each point sits on its strand: s (which strand, 0–1) and t (along it, 0–1).
  const st = new Float32Array(STRANDS * POINTS * 2);
  const indices = new Uint16Array(STRANDS * (POINTS - 1) * 2);
  let n = 0;
  for (let s = 0; s < STRANDS; s++) {
    for (let i = 0; i < POINTS; i++) st.set([s / (STRANDS - 1), i / (POINTS - 1)], (s * POINTS + i) * 2);
    for (let i = 0; i < POINTS - 1; i++) {
      indices[n++] = s * POINTS + i;
      indices[n++] = s * POINTS + i + 1;
    }
  }
  const stBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, stBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, st, gl.STATIC_DRAW);
  const indexBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  const attr = (name: string) => gl.getAttribLocation(program, name);
  const uni = (name: string) => gl.getUniformLocation(program, name);
  const aFrom = attr('a_from');
  const aTo = attr('a_to');
  const aSt = attr('a_st');
  const u = {
    m: uni('u_m'),
    mix: uni('u_mix'),
    time: uni('u_time'),
    // The fragment shader's own clock: a uniform shared by both stages must have one precision.
    clock: uni('u_clock'),
    pointer: uni('u_pointer'),
    aspect: uni('u_aspect'),
    tint: uni('u_tint'),
    flow: uni('u_flow'),
    alpha: uni('u_alpha'),
    light: uni('u_light'),
  };
  gl.uniform3fv(uni('u_silver'), SILVER);
  gl.uniform3fv(uni('u_green'), GREEN);
  gl.uniform3fv(uni('u_amber'), AMBER);
  gl.enableVertexAttribArray(aFrom);
  gl.enableVertexAttribArray(aTo);
  gl.enableVertexAttribArray(aSt);
  gl.bindBuffer(gl.ARRAY_BUFFER, stBuffer);
  gl.vertexAttribPointer(aSt, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0, 0, 0, 0);

  const resize = () => {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();

  return {
    draw(frame) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (frame.alpha <= 0.001) return;
      const aspect = canvas.width / Math.max(1, canvas.height);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.get(frame.from)!);
      gl.vertexAttribPointer(aFrom, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.get(frame.to)!);
      gl.vertexAttribPointer(aTo, 4, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(u.m, false, cameraMatrix(frame.cam, aspect));
      gl.uniform1f(u.mix, frame.mix);
      gl.uniform1f(u.time, frame.time);
      gl.uniform1f(u.clock, frame.time);
      gl.uniform2f(u.pointer, frame.pointer[0], frame.pointer[1]);
      gl.uniform1f(u.aspect, aspect);
      gl.uniform1f(u.tint, frame.tint);
      gl.uniform1f(u.flow, frame.flow);
      gl.uniform1f(u.alpha, frame.alpha);
      gl.uniform1f(u.light, frame.light);
      gl.drawElements(gl.LINES, indices.length, gl.UNSIGNED_SHORT, 0);
    },
    update: upload,
    resize,
    destroy() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
