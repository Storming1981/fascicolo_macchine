import Icon from "@/components/Icon";

/**
 * Form di login con POST NATIVO (senza fetch/JS): il browser invia le
 * credenziali e segue il redirect del server applicando il cookie di sessione
 * in modo nativo. È la modalità più affidabile su iOS Safari.
 */
export default function LoginForm({ error, portale }: { error?: boolean; portale?: boolean }) {
  return (
    <form className="login-form" method="POST" action="/api/auth/login">
      {error && <div className="form-error">Credenziali non valide</div>}
      {portale && <input type="hidden" name="portale" value="1" />}
      <div className="form-row">
        <label>Email</label>
        <input
          className="input"
          type="email"
          name="email"
          autoComplete="username"
          placeholder={portale ? "email fornita da ZATO" : "nome@zato.it"}
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
