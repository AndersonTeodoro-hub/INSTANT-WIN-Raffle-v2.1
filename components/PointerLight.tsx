import { useEffect } from 'react';

/**
 * A soft light under the pointer on whatever surface it is over — a card, a
 * panel (index.css: .iw-surface and .iw-surface-raised draw it from --mx/--my,
 * registered as non-inherited). One listener for the whole app, written once
 * per frame, on the one element under the pointer; only a fine pointer that can
 * hover gets it, so a tap never leaves a light behind.
 */
export function PointerLight() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let lit: HTMLElement | null = null;
    let pending: PointerEvent | null = null;
    let raf = 0;
    const off = (el: HTMLElement) => {
      el.style.removeProperty('--mx');
      el.style.removeProperty('--my');
    };
    const apply = () => {
      raf = 0;
      const event = pending;
      if (!event) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.iw-surface, .iw-surface-raised') : null;
      if (lit && lit !== target) off(lit);
      lit = target;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty('--mx', `${Math.round(event.clientX - rect.left)}px`);
      target.style.setProperty('--my', `${Math.round(event.clientY - rect.top)}px`);
    };
    const move = (event: PointerEvent) => {
      pending = event;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const leave = () => {
      if (lit) off(lit);
      lit = null;
    };
    window.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      leave();
    };
  }, []);
  return null;
}
