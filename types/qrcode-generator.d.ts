declare module "qrcode-generator" {
  interface QRCode {
    addData(value: string): void;
    make(): void;
    createSvgTag(cellSize?: number, margin?: number): string;
  }
  function qrcode(typeNumber: number, errorCorrectionLevel: string): QRCode;
  export default qrcode;
}
