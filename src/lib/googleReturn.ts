/**
 * Dove rimandare l'utente dopo il consenso Google. Il profilo e le
 * impostazioni, piu' il **fascicolo** (`m:M-2026-0013`), perche' il permesso di
 * pescare da Google Foto lo si chiede stando dentro una scheda macchina e
 * tornare altrove vorrebbe dire ritrovare la strada a mano.
 *
 * Elenco chiuso: il valore attraversa lo `state` e finisce in una redirect,
 * quindi accettare un path qualunque vorrebbe dire farsi spedire gli utenti
 * dove capita. Sta in un modulo a se' perche' lo usano **due** route (auth e
 * callback) e un route handler non puo' esportare altro che i suoi verbi.
 */
export function returnTarget(raw: string | null | undefined): string {
  if (raw === "profilo") return "profilo";
  const m = /^m:([A-Za-z0-9-]{1,24})$/.exec(raw ?? "");
  return m ? `m:${m[1]}` : "impostazioni";
}

/** Pagina corrispondente, senza lo slash iniziale. */
export function returnPage(ret: string): string {
  const m = /^m:([A-Za-z0-9-]{1,24})$/.exec(ret);
  return m ? `macchine/${m[1]}` : ret === "profilo" ? "profilo" : "impostazioni";
}
