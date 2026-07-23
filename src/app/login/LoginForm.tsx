import Icon from "@/components/Icon";

/**
 * Form di login con POST NATIVO (senza fetch/JS): il browser invia le
 * credenziali e segue il redirect del server applicando il cookie di sessione
 * in modo nativo. È la modalità più affidabile su iOS Safari.
 */
export default function LoginForm({ error }: { error?: boolean }) {
  return (
    <form className="login-form" method="POST" action="/api/auth/login">
      {error && <div className="form-error">Credenziali non valide</div>}
      <div className="form-row">
        <label>Email</label>
        <input
          className="input"
          type="email"
          name="email"
          autoComplete="username"
          placeholder="nome@zato.it"
          required
        />
      </div>
      <div className="form-row">
        <label>Password</label>
        <input
          className="input"
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </div>
      <button className="btn-primary" style={{ justifyContent: "center", padding: "10px" }}>
        <Icon name="logout" size={15} /> Accedi
      </button>
    </form>
  );
}
