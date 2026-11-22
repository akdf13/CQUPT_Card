declare module "jsbarcode" {
  type Options = {
    format?: string;
    width?: number;
    height?: number;
    displayValue?: boolean;
    text?: string;
    fontOptions?: string;
    font?: string;
    fontSize?: number;
    background?: string;
    lineColor?: string;
    margin?: number;
    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
    valid?: (valid: boolean) => void;
  };
  export default function JsBarcode(
    element: Element | string | null,
    data: string,
    options?: Options
  ): void;
}

declare module "qrcode" {
  const QRCode: any;
  export default QRCode;
}

/** 构建时由 vite.config.ts 注入（APP_VERSION 环境变量） */
declare const __APP_VERSION__: string;
