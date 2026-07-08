"use client";

import { useEffect, useRef } from "react";
import QRCode from "qrcode";

/** QR-код заказа для показа на кассе. */
export default function QrCanvas({ value, size = 200 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    QRCode.toCanvas(ref.current, value, {
      width: size,
      margin: 1,
      color: { dark: "#14231a", light: "#ffffff" },
    }).catch(() => {});
  }, [value, size]);

  return <canvas ref={ref} className="rounded-xl" />;
}
