import { useMemo } from 'react';
import { QUIET_ZONE, qrSymbol } from '../../lib/keptra/qr';

/** 9.2 and T6: the delivery code as a QR carrying the code alone, drawn as one SVG path on white. */
export function QrCode({ text, label, size = 220 }: { text: string; label: string; size?: number }) {
  const symbol = useMemo(() => qrSymbol(text), [text]);
  const side = symbol.size + 2 * QUIET_ZONE;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${side} ${side}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="max-w-full rounded-lg bg-white"
    >
      <rect width={side} height={side} fill="#ffffff" />
      <path d={symbol.path} fill="#000000" />
    </svg>
  );
}
