/**
 * The part of qrcode 1.5.3 (T7) that lib/keptra/qr.ts uses. The package ships no
 * types, and a types package would be a second dependency for one function.
 */
declare module 'qrcode' {
  interface BitMatrix {
    readonly size: number;
    get(row: number, col: number): number | boolean;
  }
  interface Segment {
    readonly data: string;
  }
  interface QRCodeSymbol {
    readonly modules: BitMatrix;
    readonly segments: readonly Segment[];
  }
  interface QRCodeOptions {
    readonly errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  }
  const QRCode: {
    create(text: string, options?: QRCodeOptions): QRCodeSymbol;
  };
  export default QRCode;
}
