/**
 * Persone esterne senza account (cliente, ente certificatore, fornitore) che
 * possono firmare, ad esempio, l'approvazione del collaudo. Modulo puro: lo
 * usano sia le route sia i componenti client.
 */
export type ExternalSignerRow = {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  active: boolean;
  signs: number;
  /** accesso all'app (ruolo Collaudatore esterno), se creato */
  account?: { username: string | null; email: string; active: boolean } | null;
};

/** "Mario Rossi (ACME Srl)": come compare a verbale e a diario. */
export function externalSignerLabel(s: { firstName: string; lastName: string; company: string }): string {
  return `${s.firstName} ${s.lastName}`.trim() + (s.company ? ` (${s.company})` : "");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const opt = (v: unknown, max: number) => str(v, max) || null;

/** Valida il corpo di creazione/modifica. Nome, cognome e ditta obbligatori. */
export function parseExternalSigner(
  b: Record<string, unknown>
): { ok: true; data: Omit<ExternalSignerRow, "id" | "active" | "signs" | "account"> } | { ok: false; error: string } {
  const data = {
    firstName: str(b.firstName, 80),
    lastName: str(b.lastName, 80),
    company: str(b.company, 120),
    jobTitle: opt(b.jobTitle, 80),
    email: opt(b.email, 160)?.toLowerCase() ?? null,
    phone: opt(b.phone, 40),
    notes: opt(b.notes, 1000),
  };
  if (!data.firstName || !data.lastName || !data.company)
    return { ok: false, error: "Nome, cognome e ditta sono obbligatori" };
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
    return { ok: false, error: "E-mail non valida" };
  return { ok: true, data };
}

/**
 * Nome utente per entrare senza e-mail (gli esterni non ne hanno una che
 * serva): minuscole, cifre, punto, trattino, trattino basso; niente "@",
 * cosi' il login capisce da solo se gli si e' dato un'e-mail o un nome utente.
 */
export function normalizeUsername(v: unknown): string | null {
  const u = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[a-z0-9._-]{3,40}$/.test(u) ? u : null;
}

/** Proposta di nome utente dalla scheda: "elia.presti". */
export function suggestUsername(firstName: string, lastName: string): string {
  return `${firstName}.${lastName}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");
}

/**
 * L'e-mail resta obbligatoria e univoca in anagrafica: per chi entra col nome
 * utente se ne mette una interna su dominio .local, che le notifiche
 * riconoscono come non recapitabile (notifyDeliver) e non provano a spedire.
 */
export const usernameEmail = (username: string) => `${username}@esterni.local`;
