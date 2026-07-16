"use client";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "./Icon";
import { initials } from "@/lib/domain";

type CampoApp = "interventi" | "fascicolo";

const TABS: { app: CampoApp; href: string; label: string; icon: string }[] = [
  { app: "interventi", href: "/campo/interventi", label: "Interventi", icon: "wrench" },
  { app: "fascicolo", href: "/campo/macchine", label: "Fascicolo", icon: "machines" },
];

export default function CampoShell({
  user,
  apps,
  canDesktop,
  children,
}: {
  user: { name: string; email: string };
  apps: CampoApp[];
  canDesktop: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState(false);

  const tabs = TABS.filter((t) => apps.includes(t.app));

  function goDesktop() {
    document.cookie = "shell=desktop; path=/; max-age=31536000; samesite=lax";
    router.push("/dashboard");
  }
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="campo">
      <header className="campo-top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="campo-logo" src="/zato-logo.png" alt="ZATO" />
        <span className="campo-spacer" />
        <button className="campo-user" onClick={() => setMenu((m) => !m)} aria-label="Menu utente">
          <span className="user-avatar">{initials(user.name)}</span>
        </button>
        {menu && (
          <>
            <div className="campo-menu-overlay" onClick={() => setMenu(false)} />
            <div className="campo-menu">
              <div className="campo-menu-user">
                <div className="user-name">{user.name}</div>
                <div className="user-role">{user.email}</div>
              </div>
              {canDesktop && (
                <button onClick={goDesktop}>
                  <Icon name="table" size={16} /> Versione Desktop
                </button>
              )}
              <button onClick={logout}>
                <Icon name="logout" size={16} /> Esci
              </button>
            </div>
          </>
        )}
      </header>

      <main className="campo-main">{children}</main>

      {tabs.length > 1 && (
        <nav className="campo-tabbar">
          {tabs.map((t) => {
            const active = pathname === t.href || pathname.startsWith(t.href + "/");
            return (
              <Link key={t.app} href={t.href} className={"campo-tab" + (active ? " active" : "")}>
                <Icon name={t.icon} size={22} />
                <span>{t.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
