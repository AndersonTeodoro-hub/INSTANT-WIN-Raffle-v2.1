/**
 * The delivery code's QR (9.2, T6, T7). The QR carries the code and nothing else.
 *
 * The QR library that was already in the tree (qrcode 1.5.3, now a declared
 * dependency, T7) builds the symbol; this file turns its modules into one SVG
 * path, so the page draws it as markup — no canvas, no data URL, no innerHTML.
 */

import QRCode from 'qrcode';

export interface QrSymbol {
  /** Modules per side, without the quiet zone. */
  readonly size: number;
  /** An SVG path of the dark modules, one unit per module, offset by the quiet zone. */
  readonly path: string;
  /** What the symbol encodes, read back from the library's segments. */
  readonly data: string;
}

/** Four modules of quiet zone, as the standard asks. */
export const QUIET_ZONE = 4;

export function qrSymbol(text: string): QrSymbol {
  const symbol = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const { size } = symbol.modules;
  let path = '';
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (symbol.modules.get(row, col)) path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return { size, path, data: symbol.segments.map((segment) => segment.data).join('') };
}
