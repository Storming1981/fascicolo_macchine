// Ordini di produzione agganciati al fascicolo, come si leggono in pagina.
//
// Modulo **puro** (client + server): la chiave sta su `Machine` e la si legge
// anche nell'elenco macchine, dove importare `erp.ts` vorrebbe dire tirarsi
// dietro il driver SQL Server in un componente client.

export type OrderField = "erpBodyOrder" | "erpContainerOrder" | "erpStandOrder" | "erpBladesOrder";

/**
 * I quattro ordini che un fascicolo puo' agganciare, nell'ordine in cui si
 * leggono in Analisi ore. Il ruolo "Corpo" in pagina si chiama *Produzione*
 * dove la tipologia ha un job solo (`mainOrderRole`).
 */
export const ORDER_FIELDS: { field: OrderField; role: string }[] = [
  { field: "erpBodyOrder", role: "Corpo" },
  { field: "erpContainerOrder", role: "Container" },
  { field: "erpStandOrder", role: "Cavalletto" },
  { field: "erpBladesOrder", role: "Lame" },
];

/**
 * Come si scrive un ordine di produzione: `"H|2026||691"` → **H/2026/691**.
 * E' la stessa forma delle tendine di Analisi ore, quindi e' anche quella che
 * la gente scrive nella ricerca. null se la chiave non e' leggibile.
 */
export function orderRef(key: string | null | undefined): string | null {
  const p = String(key ?? "").split("|");
  if (p.length !== 4) return null;
  const [tipork, anno, , num] = p;
  if (!tipork || !anno || !num) return null;
  return `${tipork}/${anno}/${num}`;
}
