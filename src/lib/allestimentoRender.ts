import "server-only";
import {
  blockKindOf,
  blockNumberOf,
  hasAllestimentoSheets,
  sheetCommessa,
  sheetDef,
  type SheetKind,
} from "./allestimento";
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
    // I componenti ripetibili (nastri, separatori): ognuno è un componente a sé,
    // quindi non entra nelle righe fisse ma in un elenco suo.
    blocks: m.components
      .flatMap((c) => {
        const block = blockKindOf(c.groupId);
        if (!block) return [];
        const extra = (c.extra && typeof c.extra === "object" ? c.extra : {}) as Record<string, string>;
        const spec = block.fields
          .map((f) => {
            const v = (f.key === "brand" ? c.brand : extra[f.key]) ?? "";
            return v.trim() ? `${f.label}: ${v.trim()}` : "";
          })
          .filter(Boolean)
          .join(" · ");
        return [
          {
            kind: block.key,
            n: blockNumberOf(c.groupId),
            label: c.label ?? block.label,
            spec,
            serials: c.items.map((i) => [i.serial ?? "", i.lot ?? ""].filter(Boolean).join(" · ")),
          },
        ];
      })
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.n - b.n),
    components: m.components.map((c) => ({
      groupId: c.groupId,
      // il lotto punzonato accanto alla matricola (es. 09/26) va stampato con lei
      serials: c.items.map((i) => [i.serial ?? "", i.lot ?? ""].filter(Boolean).join(" · ")),
    })),
    compilerName: s.compilerName,
    compiledAt: s.compiledAt,
    compilerSignature: s.compilerSignature,
  });
  const def = sheetDef(kind);
  const filename = `${def.code}_${def.title.toLowerCase().replace(/^scheda /, "scheda_")}_${commessa}.pdf`.replace(
    /[^\w.\-]+/g,
    "_"
  );
  return { bytes, filename, machineCode: m.code, commessa };
}
