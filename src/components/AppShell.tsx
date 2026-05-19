"use client";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "./Icon";
import { initials } from "@/lib/domain";

export default function AppShell({
  user,
  machineCount,
  caps,
  children,
}: {
  user: { name: string; roleLabel: string; email: string };
  machineCount: number;
  caps: { import: boolean; settings: boolean };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

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
        { href: "/dashboard", label: "Dashboard", icon: "home", show: true },
        { href: "/macchine", label: "Macchine", icon: "machines", badge: true, show: true },
      ],
    },
    {
      title: "Registro",
      items: [{ href: "/persone", label: "Persone & Firme", icon: "people", show: true }],
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
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="nav-section">{g.title}</div>
              {g.items.map((n) => {
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
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user">
            <div className="user-avatar">{initials(user.name)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="user-name">{user.name}</div>
              <div className="user-role">{user.email}</div>
            </div>
          </div>
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
            <button className="icon-btn" aria-label="Notifiche">
              <Icon name="bell" size={18} />
              <span className="dot" />
            </button>
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
