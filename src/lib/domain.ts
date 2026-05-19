import type { MachineStatus, DiaryPhase, Role } from "@prisma/client";

export const STATUS_META: Record<MachineStatus, { label: string; color: string }> = {
  PRODUCTION: { label: "In produzione", color: "#1d6fb8" },
  TESTING: { label: "In collaudo", color: "#f59e0b" },
  SHIPPED: { label: "Spedita", color: "#8b5cf6" },
  INSTALLED: { label: "Installata", color: "#10b981" },
  MAINTENANCE: { label: "In esercizio", color: "#0ea5a3" },
  SCRAPPED: { label: "Dismessa", color: "#71717a" },
};

export const STATUS_ORDER: MachineStatus[] = [
  "PRODUCTION",
  "TESTING",
  "SHIPPED",
  "INSTALLED",
  "MAINTENANCE",
  "SCRAPPED",
];

export const PHASE_META: Record<DiaryPhase, { label: string; color: string }> = {
  PRODUCTION: { label: "Produzione", color: "#1d6fb8" },
  TESTING: { label: "Collaudo", color: "#f59e0b" },
  SHIPPED: { label: "Spedizione", color: "#8b5cf6" },
  INSTALLED: { label: "Installazione", color: "#10b981" },
  MAINTENANCE: { label: "Manutenzione", color: "#0ea5a3" },
  SCRAPPED: { label: "Rottamazione", color: "#71717a" },
};

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Amministratore",
  CAPO_OFFICINA: "Capo officina",
  MONTATORE: "Operatore montaggio",
  CABLATORE: "Cablatore elettrico",
  PROGRAMMATORE: "Programmatore HMI",
  COLLAUDATORE: "Collaudatore",
  TECNICO_CAMPO: "Tecnico campo",
  LOGISTICA: "Logistica",
};

/**
 * Anagrafica paesi: codice ISO2, etichetta IT, colori indicativi (3 bande),
 * alias di riconoscimento (varianti EN/IT dal file MATRICOLE).
 */
type CountryDef = {
  code: string;
  label: string;
  colors: [string, string, string];
  aliases: string[];
};

const COUNTRY_DB: CountryDef[] = [
  { code: "IT", label: "Italia", colors: ["#009246", "#ffffff", "#ce2b37"], aliases: ["ITALY"] },
  { code: "DE", label: "Germania", colors: ["#000000", "#dd0000", "#ffce00"], aliases: ["GERMANY"] },
  { code: "ES", label: "Spagna", colors: ["#aa151b", "#f1bf00", "#aa151b"], aliases: ["SPAIN"] },
  { code: "FR", label: "Francia", colors: ["#0055a4", "#ffffff", "#ef4135"], aliases: ["FRANCE"] },
  { code: "GB", label: "Regno Unito", colors: ["#012169", "#ffffff", "#c8102e"], aliases: ["UK", "UNITED KINGDOM", "ENGLAND"] },
  { code: "US", label: "USA", colors: ["#b22234", "#ffffff", "#3c3b6e"], aliases: ["UNITED STATES", "U.S.A.", "ZATO NA"] },
  { code: "SE", label: "Svezia", colors: ["#006aa7", "#fecc00", "#006aa7"], aliases: ["SWEDEN"] },
  { code: "NO", label: "Norvegia", colors: ["#ba0c2f", "#ffffff", "#00205b"], aliases: ["NORWAY"] },
  { code: "FI", label: "Finlandia", colors: ["#ffffff", "#003580", "#ffffff"], aliases: ["FINLAND"] },
  { code: "IS", label: "Islanda", colors: ["#02529c", "#ffffff", "#dc1e35"], aliases: ["ICELAND"] },
  { code: "DK", label: "Danimarca", colors: ["#c8102e", "#ffffff", "#c8102e"], aliases: ["DENMARK"] },
  { code: "NL", label: "Olanda", colors: ["#ae1c28", "#ffffff", "#21468b"], aliases: ["NETHERLANDS", "HOLLAND"] },
  { code: "BE", label: "Belgio", colors: ["#2d2926", "#fdda24", "#ef3340"], aliases: ["BELGIUM"] },
  { code: "AT", label: "Austria", colors: ["#ed2939", "#ffffff", "#ed2939"], aliases: [] },
  { code: "CH", label: "Svizzera", colors: ["#d52b1e", "#ffffff", "#d52b1e"], aliases: ["SWITZERLAND"] },
  { code: "PL", label: "Polonia", colors: ["#ffffff", "#ffffff", "#dc143c"], aliases: ["POLAND"] },
  { code: "PT", label: "Portogallo", colors: ["#006600", "#006600", "#ff0000"], aliases: ["PORTUGAL"] },
  { code: "CZ", label: "Rep. Ceca", colors: ["#11457e", "#ffffff", "#d7141a"], aliases: ["CZECH", "CZECH REPUBLIC", "CZECHIA"] },
  { code: "HU", label: "Ungheria", colors: ["#cd2a3e", "#ffffff", "#436f4d"], aliases: ["HUNGARY"] },
  { code: "RO", label: "Romania", colors: ["#002b7f", "#fcd116", "#ce1126"], aliases: [] },
  { code: "RS", label: "Serbia", colors: ["#c6363c", "#0c4076", "#ffffff"], aliases: [] },
  { code: "AL", label: "Albania", colors: ["#e41e20", "#e41e20", "#e41e20"], aliases: [] },
  { code: "RU", label: "Russia", colors: ["#ffffff", "#0039a6", "#d52b1e"], aliases: [] },
  { code: "TR", label: "Turchia", colors: ["#e30a17", "#ffffff", "#e30a17"], aliases: ["TURKEY", "TÜRKIYE"] },
  { code: "KR", label: "Corea", colors: ["#ffffff", "#cd2e3a", "#0047a0"], aliases: ["KOREA", "SOUTH KOREA"] },
  { code: "TW", label: "Taiwan", colors: ["#fe0000", "#000095", "#fe0000"], aliases: [] },
  { code: "JP", label: "Giappone", colors: ["#ffffff", "#bc002d", "#ffffff"], aliases: ["JAPAN"] },
  { code: "IN", label: "India", colors: ["#ff9933", "#ffffff", "#138808"], aliases: [] },
  { code: "TH", label: "Thailandia", colors: ["#a51931", "#2d2a4a", "#a51931"], aliases: ["THAILAND"] },
  { code: "IL", label: "Israele", colors: ["#ffffff", "#0038b8", "#ffffff"], aliases: ["ISRAEL"] },
  { code: "IQ", label: "Iraq", colors: ["#ce1126", "#ffffff", "#000000"], aliases: [] },
  { code: "IR", label: "Iran", colors: ["#239f40", "#ffffff", "#da0000"], aliases: [] },
  { code: "SA", label: "Arabia Saudita", colors: ["#165d31", "#165d31", "#165d31"], aliases: ["SAUDI", "SAUDI ARABIA"] },
  { code: "ZA", label: "Sudafrica", colors: ["#007749", "#ffb915", "#de3831"], aliases: ["SOUTH AFRICA"] },
  { code: "CA", label: "Canada", colors: ["#d52b1e", "#ffffff", "#d52b1e"], aliases: [] },
  { code: "MX", label: "Messico", colors: ["#006847", "#ffffff", "#ce1126"], aliases: ["MEXICO"] },
  { code: "BR", label: "Brasile", colors: ["#009b3a", "#fedf00", "#009b3a"], aliases: ["BRAZIL"] },
  { code: "AR", label: "Argentina", colors: ["#74acdf", "#ffffff", "#74acdf"], aliases: [] },
  { code: "CL", label: "Cile", colors: ["#ffffff", "#0039a6", "#d52b1e"], aliases: ["CHILE", "CHILI", "CILE"] },
  { code: "PE", label: "Perù", colors: ["#d91023", "#ffffff", "#d91023"], aliases: ["PERU"] },
  { code: "PY", label: "Paraguay", colors: ["#d52b1e", "#ffffff", "#0038a8"], aliases: [] },
  { code: "PA", label: "Panama", colors: ["#ffffff", "#005293", "#d21034"], aliases: [] },
  { code: "PR", label: "Portorico", colors: ["#ed0000", "#ffffff", "#0050f0"], aliases: ["PUERTO RICO"] },
  { code: "AU", label: "Australia", colors: ["#00247d", "#ffffff", "#cf142b"], aliases: [] },
  { code: "NZ", label: "Nuova Zelanda", colors: ["#00247d", "#ffffff", "#cc142b"], aliases: ["NEW ZEALAND"] },
];

export const COUNTRIES: { code: string; label: string }[] = COUNTRY_DB.map((c) => ({
  code: c.code,
  label: c.label,
}));

export const FLAG_COLORS: Record<string, [string, string, string]> = Object.fromEntries(
  COUNTRY_DB.map((c) => [c.code, c.colors])
);

const COUNTRY_BY_NAME: Record<string, { code: string; label: string }> = (() => {
  const m: Record<string, { code: string; label: string }> = {};
  for (const c of COUNTRY_DB) {
    const ref = { code: c.code, label: c.label };
    m[c.code] = ref;
    m[c.label.toUpperCase()] = ref;
    for (const a of c.aliases) m[a.toUpperCase()] = ref;
  }
  return m;
})();

export function resolveCountry(raw?: string | null): { code: string; label: string } {
  if (!raw) return { code: "IT", label: "Italia" };
  const key = String(raw).trim().toUpperCase();
  if (COUNTRY_BY_NAME[key]) return COUNTRY_BY_NAME[key];
  return { code: "XX", label: raw.trim() };
}

export function statusToPhase(s: MachineStatus): DiaryPhase {
  return s as unknown as DiaryPhase;
}

/** Avanzamento indicativo in base allo stato (modificabile manualmente). */
export function defaultProgress(status: MachineStatus): number {
  switch (status) {
    case "PRODUCTION":
      return 30;
    case "TESTING":
      return 75;
    case "SHIPPED":
      return 90;
    case "INSTALLED":
    case "MAINTENANCE":
      return 100;
    case "SCRAPPED":
      return 100;
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
