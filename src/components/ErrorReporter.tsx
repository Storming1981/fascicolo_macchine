"use client";
import { useEffect } from "react";

/**
 * Diagnostica temporanea: invia al server gli errori JS non gestiti del browser
 * (e un "hello" con lo user-agent), così si leggono nei log della VPS anche per
 * dispositivi dove non si può aprire la console (es. iPad Safari).
 */
export default function ErrorReporter() {
  useEffect(() => {
    const send = (payload: Record<string, unknown>) => {
      try {
        const body = JSON.stringify({ ...payload, path: location.pathname, ua: navigator.userAgent });
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/clientlog", new Blob([body], { type: "application/json" }));
        } else {
          fetch("/api/clientlog", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
        }
      } catch {
        /* best-effort */
      }
    };
    const onErr = (e: ErrorEvent) =>
      send({ t: "error", msg: e.message, src: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack?.slice(0, 600) });
    const onRej = (e: PromiseRejectionEvent) =>
      send({ t: "reject", reason: String(e.reason), stack: (e.reason as Error)?.stack?.slice(0, 600) });

    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    send({ t: "hello" });
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);
  return null;
}
