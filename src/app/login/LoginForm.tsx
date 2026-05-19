"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (res.ok) {
      router.replace("/dashboard");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || "Accesso non riuscito");
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      {err && <div className="form-error">{err}</div>}
      <div className="form-row">
        <label>Email</label>
        <input
          className="input"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nome@zato.it"
          required
        />
      </div>
      <div className="form-row">
        <label>Password</label>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <button className="btn-primary" disabled={loading} style={{ justifyContent: "center", padding: "10px" }}>
        <Icon name="logout" size={15} /> {loading ? "Accesso…" : "Accedi"}
      </button>
    </form>
  );
}
