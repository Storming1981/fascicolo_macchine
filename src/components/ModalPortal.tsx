"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Monta il modale direttamente su <body>.
 *
 * Serve a iOS/iPadOS Safari: un elemento `position: fixed` annidato dentro un
 * contenitore con scroll (`.view { overflow: auto }` dentro `.main`/`.app` con
 * `overflow: hidden`) viene posizionato in modo inaffidabile e il modale può
 * finire fuori dall'area visibile — il tap sul pulsante sembra "non fare nulla".
 * Fuori dal portale, inoltre, blocca lo scroll di fondo mentre è aperto.
 */
export default function ModalPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!mounted) return null;
  return createPortal(children, document.body);
}
