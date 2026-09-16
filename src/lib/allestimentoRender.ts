import "server-only";
import { hasAllestimentoSheets, sheetCommessa, type SheetKind } from "./allestimento";
import { loadSheet } from "./allestimentoService";
import { generateAllestimentoPdf } from "./allestimentoPdf";

/**
 * PDF di una scheda di allestimento dai dati correnti del fascicolo, con il nome
 * file da usare in download e negli allegati e-mail. null se la macchina non
 * esiste o non è un BLUE DEVIL.
 */
export async function renderSheetPdf(
  machineId: string,
  kind: SheetKind
): Promise<{ bytes: Uint8Array; filename: string; machineCode: string; commessa: string } | null> {
  const s = await loadSheet(machineId, kind);
  if (!s || !hasAllestimentoSheets(s.machine.plantType)) return null;
  const m = s.machine;
  const commessa = sheetCommessa(kind, m);
  const bytes = await generateAllestimentoPdf({
    kind,
    machineCode: m.code,
    commessa,
    country: m.country,
    header: s.header,
    model: m.model,
    values: s.values,
    components: m.components.map((c) => ({ groupId: c.groupId, serials: c.items.map((i) => i.serial ?? "") })),
    compilerName: s.compilerName,
    compiledAt: s.compiledAt,
    compilerSignature: s.compilerSignature,
  });
  const filename = `${kind === "CONTAINER" ? "M5.17_Scheda_container" : "M5.16_Scheda_trituratore"}_${commessa}.pdf`.replace(
    /[^\w.\-]+/g,
    "_"
  );
  return { bytes, filename, machineCode: m.code, commessa };
}
