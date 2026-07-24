"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "./Icon";
import { initials } from "@/lib/domain";

type NavKey =
  | "dashboard"
  | "macchine"
  | "persone"
  | "service"
  | "interventi"
  | "chat"
  | "pianificazione"
  | "mappa"
  | "clienti"
  | "notifiche"
  | "knowledge";

export default function AppShell({
  user,
  machineCount,
  nav,
  canCampo,
  caps,
  children,
}: {
  user: { name: string; roleLabel: string; email: string };
  machineCount: number;
  nav: Record<NavKey, boolean>;
  canCampo: boolean;
  caps: { import: boolean; settings: boolean; service: boolean };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  function goCampo() {
    document.cookie = "shell=campo; path=/; max-age=31536000; samesite=lax";
    router.push("/campo");
  }

  // iPadOS Safari si presenta come "Macintosh" (modalità desktop), quindi il
  // rilevamento lato server non lo riconosce come tablet. Qui, lato client,
  // usiamo touch + pointer coarse (che un vero desktop non ha) per mandare i
  // dispositivi touch alla versione Campo — a meno che l'utente abbia scelto
  // esplicitamente il desktop (cookie shell) o non abbia app Campo.
  useEffect(() => {
    if (!canCampo) return;
    if (document.cookie.split("; ").some((c) => c.startsWith("shell="))) return;
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
    const touch = (navigator.maxTouchPoints ?? 0) > 1;
    if (coarse && touch) {
      document.cookie = "shell=campo; path=/; max-age=31536000; samesite=lax";
      window.location.replace("/campo");
    }
  }, [canCampo]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  // Gruppi del menu richiudibili: la scelta resta salvata sul dispositivo, così
  // su tablet/telefono si tiene aperto solo ciò che serve davvero.
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem("nav-collapsed");
      if (raw) setClosedGroups(JSON.parse(raw));
    } catch {
      /* preferenza non critica */
    }
  }, []);

  function toggleGroup(title: string) {
    setClosedGroups((prev) => {
      const next = { ...prev, [title]: !prev[title] };
      try {
        localStorage.setItem("nav-collapsed", JSON.stringify(next));
      } catch {
        /* preferenza non critica */
      }
      return next;
    });
  }

  const [searching, setSearching] = useState(false);

  async function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    setOpen(false);
    if (!term) {
      router.push("/macchine");
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
      const d = await res.json().catch(() => null);
      if (res.ok && d?.type === "machine" && d.code) {
        router.push(`/macchine/${encodeURIComponent(d.code)}`);
      } else if (res.ok && d?.type === "intervento" && d.id) {
        router.push(`/service/interventi/${d.id}`);
      } else if (res.ok && d?.type === "customer" && d.id) {
        router.push(`/service/clienti/${d.id}`);
      } else {
        router.push(`/macchine?q=${encodeURIComponent(term)}`);
      }
    } catch {
      router.push(`/macchine?q=${encodeURIComponent(term)}`);
    } finally {
      setSearching(false);
      router.refresh();
    }
  }

  const GROUPS: {
    title: string;
    items: { href: string; label: string; icon: string; badge?: boolean; show: boolean }[];
  }[] = [
    {
      title: "Fascicolo",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: "home", show: nav.dashboard },
        { href: "/macchine", label: "Macchine", icon: "machines", badge: true, show: nav.macchine },
      ],
    },
    {
      title: "Service",
      items: [
        { href: "/service", label: "Panoramica", icon: "home", show: caps.service && nav.service },
        { href: "/service/interventi", label: "Interventi", icon: "wrench", show: caps.service && nav.interventi },
        { href: "/service/chat", label: "Chat", icon: "sign", show: caps.service && nav.chat },
        { href: "/service/pianificazione", label: "Pianificazione", icon: "clock", show: caps.service && nav.pianificazione },
        { href: "/service/mappa", label: "Mappa cantieri", icon: "pin", show: caps.service && nav.mappa },
        { href: "/service/clienti", label: "Clienti & Cantieri", icon: "people", show: caps.service && nav.clienti },
        { href: "/service/notifiche", label: "Notifiche", icon: "bell", show: caps.service && nav.notifiche },
      ],
    },
    {
      title: "Knowledge",
      items: [
        { href: "/knowledge", label: "Knowledge ZATO", icon: "doc", show: nav.knowledge },
      ],
    },
    {
      title: "Registro",
      items: [{ href: "/persone", label: "Persone & Firme", icon: "people", show: nav.persone }],
    },
    {
      title: "Amministrazione",
      items: [
        { href: "/import", label: "Import Dati", icon: "upload", show: caps.import },
        { href: "/impostazioni", label: "Impostazioni", icon: "gear", show: caps.settings },
      ],
    },
  ]
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show) }))
    .filter((g) => g.items.length > 0);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className={"app" + (open ? " nav-open" : "")}>
      <div className="nav-overlay" onClick={() => setOpen(false)} />
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/zato-logo.png" alt="ZATO" />
          </div>
        </div>
        <nav className="nav">
          {GROUPS.map((g) => {
            const closed = !!closedGroups[g.title];
            const hasActive = g.items.some(
              (n) => pathname === n.href || pathname.startsWith(n.href + "/")
            );
            return (
              <div key={g.title}>
                <button
                  type="button"
                  className={"nav-section" + (closed ? " closed" : "")}
                  onClick={() => toggleGroup(g.title)}
                  aria-expanded={!closed}
                >
                  <span>{g.title}</span>
                  {/* pallino quando il gruppo chiuso contiene la pagina corrente */}
                  {closed && hasActive && <span className="nav-section-dot" />}
                  <Icon name="chev-down" size={13} />
                </button>
                {!closed &&
                  g.items.map((n) => {
                    const active = pathname === n.href || pathname.startsWith(n.href + "/");
                    return (
                      <Link
                        key={n.href}
                        href={n.href}
                        className={"nav-item" + (active ? " active" : "")}
                        onClick={() => setOpen(false)}
                      >
                        <Icon name={n.icon} size={18} />
                        <span>{n.label}</span>
                        {n.badge && <span className="nav-badge">{machineCount}</span>}
                      </Link>
                    );
                  })}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="user">
            <div className="user-avatar">{initials(user.name)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="user-name">{user.name}</div>
              <div className="user-role">{user.email}</div>
            </div>
          </div>
          {canCampo && (
            <button className="logout-btn" onClick={goCampo} title="Passa alla versione mobile/tablet">
              <Icon name="remote" size={15} /> Versione Campo
            </button>
          )}
          <button className="logout-btn" onClick={logout}>
            <Icon name="logout" size={15} /> Esci
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: 1 }}>
            <button className="hamburger" onClick={() => setOpen(true)} aria-label="Menu">
              <Icon name="menu" size={18} />
            </button>
            <form className="search" onSubmit={submitSearch}>
              <Icon name="search" size={15} color="var(--muted)" />
              <input
                placeholder={searching ? "Ricerca…" : "Cerca matricola, job, cliente…"}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Cerca"
              />
            </form>
          </div>
          <div className="topbar-actions">
            <div className="topbar-greeting">
              <div className="hi">Bentornato!</div>
              <div className="who">{user.name}</div>
            </div>
            <div className="user-avatar">{initials(user.name)}</div>
            {caps.service ? (
              <Link className="icon-btn" href="/service/notifiche" aria-label="Notifiche">
                <Icon name="bell" size={18} />
                <span className="dot" />
              </Link>
            ) : (
              <button className="icon-btn" aria-label="Notifiche">
                <Icon name="bell" size={18} />
                <span className="dot" />
              </button>
            )}
            {caps.settings ? (
              <Link className="icon-btn bordered" href="/impostazioni" aria-label="Impostazioni">
                <Icon name="gear" size={18} />
              </Link>
            ) : (
              <button className="icon-btn bordered" aria-label="Impostazioni" disabled>
                <Icon name="gear" size={18} />
              </button>
            )}
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
