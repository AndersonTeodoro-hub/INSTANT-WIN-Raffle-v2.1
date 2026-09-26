import React, { useEffect, useRef, useState } from 'react';
import { formatUnits } from 'viem';

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A figure read from the chain, counting to its value: from zero the first time
 * when `from0` (the prize a page opens on, a win), and from the old value to the
 * new one whenever the chain moves it. It always lands on exactly the string
 * formatUnits gives; reduced motion shows that string at once. Assistive tech
 * reads only the final value, never the frames.
 */
export const CountUp: React.FC<{
  value: bigint;
  decimals: number;
  from0?: boolean;
  /** Milliseconds before it starts (a reveal that orders its figures). */
  delay?: number;
  duration?: number;
  className?: string;
}> = ({ value, decimals, from0 = false, delay = 0, duration = 1100, className }) => {
  const final = formatUnits(value, decimals);
  const places = (final.split('.')[1] ?? '').length;
  const target = Number(value) / 10 ** decimals;
  const shown = useRef(from0 ? 0 : target);
  const [text, setText] = useState(() => (from0 && !reduced() ? (0).toFixed(places) : final));

  useEffect(() => {
    const start = shown.current;
    if (reduced() || start === target) {
      shown.current = target;
      setText(final);
      return;
    }
    let raf = 0;
    const begin = performance.now() + delay;
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - begin) / duration));
      // Exponential ease-out: fast away from the old figure, settling on the new one.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const current = start + (target - start) * eased;
      shown.current = current;
      setText(t === 1 ? final : current.toFixed(places));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [final]);

  return (
    <span className={className}>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{final}</span>
    </span>
  );
};
