import * as XLSX from "xlsx";
import { COMPONENT_GROUPS } from "./components";
import { resolveCountry } from "./domain";

export type ParsedComponent = {
  groupId: string;
  brand: string | null;
  items: { position: number; label: string; serial: string | null }[];
  extra: Record<string, string> | null;
};

export type ParsedMachine = {
  job: string;
  jobBody: string | null;
  jobContainer: string | null;
  year: number;
  customer: string;
  country: string;
  countryCode: string;
  pressureSettings: string | null;
  components: ParsedComponent[];
  rowIndex: number;
};

function colIndex(letter: string): number {
  return XLSX.utils.decode_col(letter);
}

function cell(row: unknown[], letter: string): string | null {
  const v = row[colIndex(letter)];
  if (v === undefined || v === null || v === "") return null;
  return String(v).trim();
}

const EMPTY = new Set(["", "-", "—", "N/A", "NA", "NON PRESENTE", "NON INSTALLATO"]);
function clean(v: string | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (!t || EMPTY.has(t.toUpperCase())) return null;
  return t;
}

/**
 * Parsing del file Excel "FILE MATRICOLE".
 * Intestazioni su righe 1-2, dati dalla riga 3 in poi.
 */
export function parseMatricoleWorkbook(buffer: Buffer | ArrayBuffer): {
  machines: ParsedMachine[];
  errors: string[];
} {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames.includes("data") ? "data" : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });

  const machines: ParsedMachine[] = [];
  const errors: string[] = [];

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const job = clean(cell(row, "A")) || clean(cell(row, "B"));
    const jobBody = clean(cell(row, "B"));
    const jobContainer = clean(cell(row, "C"));
    const yearRaw = clean(cell(row, "D"));
    const customer = clean(cell(row, "E"));

    if (!job && !customer && !jobBody) continue; // riga vuota
    if (!job && !jobBody) {
      errors.push(`Riga ${i + 1}: job number mancante, riga ignorata.`);
      continue;
    }

    const year = yearRaw ? parseInt(yearRaw.replace(/\D/g, ""), 10) : new Date().getFullYear();
    const country = resolveCountry(clean(cell(row, "F")));
    const pressure = clean(cell(row, "BA"));

    const components: ParsedComponent[] = COMPONENT_GROUPS.map((g) => {
      const brand = g.excel.brandCol ? clean(cell(row, g.excel.brandCol)) : null;
      const items = g.slots.map((label, idx) => {
        const colLetter = g.excel.serialCols[idx];
        const serial = colLetter ? clean(cell(row, colLetter)) : null;
        return { position: idx, label, serial };
      });
      let extra: Record<string, string> | null = null;
      if (g.extra && g.excel.extraCols) {
        extra = {};
        for (const [k, spec] of Object.entries(g.excel.extraCols)) {
          if (spec.includes("+")) {
            const parts = spec.split("+").map((c) => clean(cell(row, c)));
            const joined = parts.filter(Boolean).join(" / ");
            if (joined) extra[k] = joined;
          } else {
            const val = clean(cell(row, spec));
            if (val) extra[k] = val;
          }
        }
        if (Object.keys(extra).length === 0) extra = null;
      }
      return { groupId: g.id, brand, items, extra };
    });

    machines.push({
      job: job || jobBody!,
      jobBody,
      jobContainer,
      year: Number.isFinite(year) ? year : new Date().getFullYear(),
      customer: customer || "Cliente da definire",
      country: country.label,
      countryCode: country.code,
      pressureSettings: pressure,
      components,
      rowIndex: i + 1,
    });
  }

  return { machines, errors };
}

/** Codice fascicolo: M-AAAA-NNNN (NNNN progressivo nell'anno). */
export function machineCode(year: number, seq: number): string {
  return `M-${year}-${String(seq).padStart(4, "0")}`;
}
