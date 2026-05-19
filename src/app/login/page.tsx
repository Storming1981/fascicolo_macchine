import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const s = await getSession();
  if (s) redirect("/dashboard");
  return (
    <div className="login-shell">
      <div className="login-side">
        <div className="login-side-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/zato-logo.png" alt="ZATO" />
        </div>
        <div>
          <h2>Fascicolo Tecnico Macchina</h2>
          <p>
            Il diario digitale di ogni macchina ZATO: produzione, componenti e matricole,
            montaggio e collaudo con firma digitale, interventi e manutenzioni — dalla
            genesi alla rottamazione.
          </p>
        </div>
        <p className="small" style={{ color: "#7d96b2" }}>
          © {new Date().getFullYear()} ZATO Recycling Solutions
        </p>
      </div>
      <div className="login-main">
        <div className="login-card">
          <h1>Accedi</h1>
          <p className="sub">Inserisci le credenziali per accedere al fascicolo tecnico.</p>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
