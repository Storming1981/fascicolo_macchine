import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; portale?: string }>;
}) {
  const u = await currentUser();
  if (u) redirect(u.role === "CLIENTE" ? "/portale" : "/dashboard");
  const { error, portale } = await searchParams;
  const isPortal = portale != null;

  return (
    <div className="login-shell">
      <div className="login-side">
        {/* Sfondo video (auto-hostato). Se il file non c'è resta il gradiente. */}
        <video
          className="login-video"
          autoPlay
          muted
          loop
          playsInline
          poster="/video/hero-poster.jpg"
        >
          <source src="/video/hero.mp4" type="video/mp4" />
        </video>
        <div className="login-side-overlay" />
        <div className="login-side-content">
        <div className="login-side-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/zato-logo.png" alt="ZATO" />
        </div>
        <div>
          {isPortal ? (
            <>
              <h2>Portale assistenza ZATO</h2>
              <p>
                Segui i tuoi interventi e comunica direttamente con il Service ZATO: stato
                dei lavori, aggiornamenti e conversazione, sempre a portata di mano.
              </p>
            </>
          ) : (
            <>
              <h2>Fascicolo Tecnico Macchina</h2>
              <p>
                Il diario digitale di ogni macchina ZATO: produzione, componenti e matricole,
                montaggio e collaudo con firma digitale, interventi e manutenzioni — dalla
                genesi alla rottamazione.
              </p>
            </>
          )}
        </div>
        <p className="small" style={{ color: "#cdd9e8" }}>
          © {new Date().getFullYear()} ZATO Recycling Solutions
        </p>
        </div>
      </div>
      <div className="login-main">
        <div className="login-card">
          <h1>{isPortal ? "Portale clienti" : "Accedi"}</h1>
          <p className="sub">
            {isPortal
              ? "Accedi con le credenziali fornite da ZATO per il portale assistenza."
              : "Inserisci le credenziali per accedere al fascicolo tecnico."}
          </p>
          <LoginForm error={!!error} portale={isPortal} />
        </div>
      </div>
    </div>
  );
}
