"use client";
import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from "react";

export type SignaturePadHandle = {
  clear: () => void;
  isEmpty: () => boolean;
  toDataURL: () => string | undefined;
};

export const SignaturePad = forwardRef<SignaturePadHandle, { height?: number }>(
  function SignaturePad({ height = 150 }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const last = useRef<{ x: number; y: number } | null>(null);
    const [hasInk, setHasInk] = useState(false);

    useImperativeHandle(ref, () => ({
      clear: () => {
        const c = canvasRef.current;
        if (!c) return;
        c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
        setHasInk(false);
      },
      isEmpty: () => !hasInk,
      toDataURL: () => canvasRef.current?.toDataURL("image/png"),
    }));

    useEffect(() => {
      const c = canvasRef.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = c.getBoundingClientRect();
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#14202b";
      ctx.lineWidth = 2;
    }, []);

    const pos = (e: React.MouseEvent | React.TouchEvent) => {
      const c = canvasRef.current!;
      const r = c.getBoundingClientRect();
      const t = "touches" in e ? e.touches[0] : null;
      const cx = (t ? t.clientX : (e as React.MouseEvent).clientX) - r.left;
      const cy = (t ? t.clientY : (e as React.MouseEvent).clientY) - r.top;
      return { x: cx, y: cy };
    };
    const start = (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      drawing.current = true;
      last.current = pos(e);
    };
    const move = (e: React.MouseEvent | React.TouchEvent) => {
      if (!drawing.current) return;
      e.preventDefault();
      const ctx = canvasRef.current!.getContext("2d")!;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.current!.x, last.current!.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current = p;
      if (!hasInk) setHasInk(true);
    };
    const end = () => {
      drawing.current = false;
    };

    return (
      <div className="sig-wrap" style={{ height }}>
        <canvas
          ref={canvasRef}
          className="sig-canvas"
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
        />
        {!hasInk && <div className="sig-hint">Firma qui col dito o col mouse</div>}
      </div>
    );
  }
);
