"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { INTERVENTO_STATUS_META, PRIORITY_META, initials } from "@/lib/domain";
import type { InterventoStatus } from "@prisma/client";

type LiveTech = {
  id: string;
  techName: string | null;
  badgeId: string | null;
  commessa: string | null;
  siteName: string | null;
  customerName: string | null;
  lat: number | null;
  lng: number | null;
  clockIn: string;
};

export type MapSite = {
  id: string;
  name: string;
  customer: string;
  city: string | null;
  province: string | null;
  lat: number;
  lng: number;
  status: string;
  interventi: { id: string; code: string; title: string; status: InterventoStatus; priority: number }[];
};

export type PlannedRow = {
  id: string;
  code: string;
  title: string;
  customer: string | null;
  site: string | null;
  siteId: string | null;
  lat: number | null;
  lng: number | null;
  tech: string | null;
  machine: string | null;
  scheduledStart: string;
};

// Carica Leaflet da CDN una sola volta.
let leafletPromise: Promise<void> | null = null;
function loadLeaflet(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as unknown as { L?: unknown }).L) return Promise.resolve();
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise<void>((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    js.async = true;
    js.onload = () => resolve();
    js.onerror = () => reject(new Error("Leaflet non caricato"));
    document.body.appendChild(js);
  });
  return leafletPromise;
}

const STATUS_HEX: Record<string, string> = {
  alert: "#dc2626",
  in_corso: "#2f6aed",
  ok: "#10b981",
};

export default function MappaClient({ sites, planned }: { sites: MapSite[]; planned: PlannedRow[] }) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const techMarkersRef = useRef<any[]>([]);
  const [sel, setSel] = useState<string | null>(sites[0]?.id ?? null);
  const [err, setErr] = useState(false);
  const [showTechs, setShowTechs] = useState(false);
  const [techs, setTechs] = useState<LiveTech[]>([]);
  const [techBusy, setTechBusy] = useState(false);

  async function toggleTechs() {
    if (showTechs) {
      setShowTechs(false);
      return;
    }
    setTechBusy(true);
    try {
      const res = await fetch("/api/presence/live");
      const d = await res.json().catch(() => null);
      setTechs(res.ok ? d.presences ?? [] : []);
      setShowTechs(true);
    } finally {
      setTechBusy(false);
    }
  }

  function focusTech(t: LiveTech) {
    const map = mapRef.current;
    if (!map || t.lat == null || t.lng == null) return;
    map.flyTo([t.lat, t.lng], 11, { animate: true, duration: 0.9 });
  }

  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then(() => {
        if (cancelled || !mapDivRef.current || mapRef.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const L = (window as any).L;
        const map = L.map(mapDivRef.current, { center: [42.5, 12.5], zoom: 5, zoomControl: true });
        L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
          attribution: "© OpenStreetMap © CARTO",
          subdomains: "abcd",
          maxZoom: 19,
        }).addTo(map);

        for (const s of sites) {
          const hex = STATUS_HEX[s.status] ?? "#10b981";
          const icon = L.divIcon({
            className: "",
            html: `<div style="position:relative;display:flex;flex-direction:column;align-items:center;">
              <div style="width:34px;height:34px;background:${hex};border:2.5px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.25);">${s.province ?? ""}</div>
              <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${hex};margin-top:-1px;"></div>
            </div>`,
            iconSize: [34, 46],
            iconAnchor: [17, 46],
          });
          L.marker([s.lat, s.lng], { icon })
            .addTo(map)
            .bindTooltip(`<strong>${s.customer}</strong><br/>${s.name}`, {
              direction: "top",
              offset: [0, -46],
            })
            .on("click", () => setSel(s.id));
        }

        // pin viola: cantieri da pianificare (interventi programmati)
        const greenSiteIds = new Set(sites.map((s) => s.id));
        const seenPlanned = new Set<string>();
        for (const p of planned) {
          if (p.lat == null || p.lng == null || !p.siteId) continue;
          if (greenSiteIds.has(p.siteId) || seenPlanned.has(p.siteId)) continue;
          seenPlanned.add(p.siteId);
          const icon = L.divIcon({
            className: "",
            html: `<div style="position:relative;display:flex;flex-direction:column;align-items:center;opacity:0.9;">
              <div style="width:28px;height:28px;background:#8b5cf6;border:2.5px dashed #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.22);"></div>
              <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid #8b5cf6;margin-top:-1px;"></div>
            </div>`,
            iconSize: [28, 40],
            iconAnchor: [14, 40],
          });
          L.marker([p.lat, p.lng], { icon })
            .addTo(map)
            .bindTooltip(`<strong>${p.customer ?? p.title}</strong><br/>Da pianificare`, { direction: "top", offset: [0, -40] });
        }

        mapRef.current = map;
      })
      .catch(() => setErr(true));
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [sites, planned]);

  useEffect(() => {
    if (!mapRef.current || !sel) return;
    const s = sites.find((x) => x.id === sel);
    if (s) mapRef.current.flyTo([s.lat, s.lng], 9, { animate: true, duration: 0.8 });
  }, [sel, sites]);

  // pin dei tecnici live
  useEffect(() => {
    const map = mapRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L = (window as any).L;
    if (!map || !L) return;
    techMarkersRef.current.forEach((m) => map.removeLayer(m));
    techMarkersRef.current = [];
    if (!showTechs) return;

    // raggruppa per cantiere per sfalsare i pin sovrapposti
    const bySite: Record<string, number> = {};
    for (const t of techs) {
      if (t.lat == null || t.lng == null) continue;
      const key = `${t.lat},${t.lng}`;
      const n = bySite[key] ?? 0;
      bySite[key] = n + 1;
      const offLat = t.lat + n * 0.02;
      const offLng = t.lng + n * 0.02;
      const icon = L.divIcon({
        className: "",
        html: `<div class="tech-live-dot"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      const m = L.marker([offLat, offLng], { icon, zIndexOffset: 1000 })
        .addTo(map)
        .bindTooltip(
          `<strong>${t.techName ?? "Tecnico"}</strong><br/>${t.customerName ?? ""}${t.commessa ? " · commessa " + t.commessa : ""}`,
          { direction: "top", offset: [0, -8] }
        );
      techMarkersRef.current.push(m);
    }
  }, [showTechs, techs]);

  const cur = sites.find((s) => s.id === sel) ?? null;

  return (
    <div className="view map-view">
      <div className="view-header">
        <div>
          <h1>Mappa cantieri</h1>
          <p>{sites.length} cantieri con tecnici on-site ora · {planned.length} interventi da pianificare</p>
        </div>
        <button
          className={"btn-ghost" + (showTechs ? " active" : "")}
          onClick={toggleTechs}
          disabled={techBusy}
        >
          <Icon name="people" size={15} />
          {techBusy ? "…" : showTechs ? `Tecnici live (${techs.length})` : "Tecnici live"}
        </button>
      </div>

      <div className="map-layout">
          <div className="map-canvas">
            {err ? (
              <div className="empty-state">Mappa non disponibile (Leaflet non raggiungibile).</div>
            ) : (
              <div ref={mapDivRef} style={{ width: "100%", height: "100%" }} />
            )}
          </div>

          <div className="map-side">
            <div className="card">
              <div className="card-body" style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5 }}>
                <span className="flex-inline"><span className="badge-dot" style={{ background: "#dc2626" }} /> Alert</span>
                <span className="flex-inline"><span className="badge-dot" style={{ background: "#2f6aed" }} /> In corso</span>
                <span className="flex-inline"><span className="badge-dot" style={{ background: "#10b981" }} /> Operativo</span>
                <span className="flex-inline"><span className="badge-dot" style={{ background: "#8b5cf6" }} /> Da pianificare</span>
              </div>
            </div>

            {showTechs && (
              <div className="card">
                <div className="card-header">
                  <h3 style={{ fontSize: 13 }}>Tecnici on-site</h3>
                  <span className="muted small">{techs.length}</span>
                </div>
                <ul className="mini-list">
                  {techs.map((t) => (
                    <li key={t.id}>
                      <button
                        className="mini-row"
                        style={{ width: "100%", border: 0, background: "transparent", cursor: t.lat != null ? "pointer" : "default", textAlign: "left" }}
                        onClick={() => focusTech(t)}
                        title={t.lat != null ? "Vai sulla mappa" : "Cantiere senza coordinate"}
                      >
                        <span className="tech-avatar">{initials(t.techName ?? "?")}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{t.techName ?? t.badgeId ?? "Tecnico"}</div>
                          <div className="muted small">
                            {t.customerName ?? t.siteName ?? "—"}
                            {t.commessa ? ` · ${t.commessa}` : ""}
                          </div>
                        </div>
                        <span className="mono muted small">
                          {new Date(t.clockIn).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </button>
                    </li>
                  ))}
                  {techs.length === 0 && <li className="muted small">Nessun tecnico timbrato ora.</li>}
                </ul>
              </div>
            )}

            {cur && (
              <div className="card">
                <div className="card-header">
                  <h3>{cur.customer}</h3>
                </div>
                <div className="muted small" style={{ marginBottom: 10 }}>
                  {cur.name} · {[cur.city, cur.province].filter(Boolean).join(" ")}
                </div>
                <ul className="mini-list">
                  {cur.interventi.map((i) => {
                    const meta = INTERVENTO_STATUS_META[i.status];
                    const prio = PRIORITY_META[i.priority] ?? PRIORITY_META[3];
                    return (
                      <li key={i.id}>
                        <Link href={`/service/interventi/${i.id}`} className="mini-row">
                          <span className="mono muted small">{i.code}</span>
                          <span style={{ flex: 1, fontWeight: 600 }}>{i.title}</span>
                          <span className="prio-chip" style={{ background: prio.color + "1f", color: prio.color }}>{prio.short}</span>
                          <span className="status-chip" style={{ background: meta.color + "22", color: meta.color }}>{meta.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                  {cur.interventi.length === 0 && <li className="muted small">Nessun intervento attivo.</li>}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="map-cards">
          <div className="card">
            <div className="card-header">
              <h3 style={{ fontSize: 13 }}>Cantieri attivi oggi</h3>
              <span className="muted small">{sites.length}</span>
            </div>
            <ul className="mini-list two-col">
              {sites.map((s) => (
                <li key={s.id}>
                  <button
                    className="mini-row"
                    style={{ width: "100%", border: 0, background: s.id === sel ? "var(--accent-soft)" : "transparent", cursor: "pointer" }}
                    onClick={() => setSel(s.id)}
                  >
                    <span className="badge-dot" style={{ background: STATUS_HEX[s.status] ?? "#10b981" }} />
                    <span style={{ flex: 1, fontWeight: 600 }}>{s.customer}</span>
                    <span className="mono muted small">{s.province}</span>
                  </button>
                </li>
              ))}
              {sites.length === 0 && <li className="muted small">Nessun tecnico on-site ora.</li>}
            </ul>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 style={{ fontSize: 13 }}>Cantieri da pianificare</h3>
              <span className="muted small">{planned.length}</span>
            </div>
            <ul className="mini-list two-col">
              {planned.map((p) => (
                <li key={p.id}>
                  <Link href={`/service/interventi/${p.id}`} className="mini-row">
                    <span className="badge-dot" style={{ background: "#8b5cf6" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{p.customer ?? p.title}</div>
                      <div className="muted small">
                        {new Date(p.scheduledStart).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}
                        {p.tech ? ` · ${p.tech}` : ""}
                        {p.machine ? ` · ${p.machine}` : ""}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
              {planned.length === 0 && <li className="muted small">Nessun intervento pianificato.</li>}
            </ul>
          </div>
        </div>
    </div>
  );
}
