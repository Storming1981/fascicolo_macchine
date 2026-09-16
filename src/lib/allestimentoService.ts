import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { COMPONENT_GROUPS } from "./components";
import {
  allListKeys,
  allRows,
  SHEET_KINDS,
  defaultTipo,
  isListRow,
  listKey,
  resolveValues,
  sheetDef,
  sheetGroupIds,
  sheetKindsFor,
  serialListKey,
  type SheetHeader,
  type SheetKind,
  type SheetOptions,
  type SheetValues,
} from "./allestimento";

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const OPTIONS_KEY = "allestimentoOptions";
const MAX_OPTION_LEN = 80;
const MAX_OPTIONS_PER_LIST = 100;

/** Voci aggiunte dagli operatori agli elenchi delle schede (globali, per elenco). */
export async function getSheetOptions(): Promise<SheetOptions> {
  const row = await prisma.setting.findUnique({ where: { key: OPTIONS_KEY } });
  const raw = (row?.value ?? {}) as Record<string, unknown>;
  const out: SheetOptions = {};
  for (const [k, v] of Object.entries(raw))
    if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
  return out;
}

async function writeSheetOptions(opts: SheetOptions) {
  await prisma.setting.upsert({
    where: { key: OPTIONS_KEY },
    update: { value: opts },
    create: { key: OPTIONS_KEY, value: opts },
  });
}

/**
 * Aggiunge voci a uno o più elenchi. Ignora elenchi sconosciuti, voci vuote e
 * doppioni (anche rispetto alle voci di partenza, senza badare alle maiuscole).
 * Ritorna gli elenchi aggiornati.
 */
export async function addSheetOptions(additions: { list: string; value: string }[]): Promise<SheetOptions> {
  const valid = allListKeys();
  const defaults = new Map<string, string[]>();
  const addDefaults = (k: string, vals: string[]) =>
    defaults.set(k, [...(defaults.get(k) ?? []), ...vals]);
  for (const kind of SHEET_KINDS)
    for (const r of allRows(sheetDef(kind))) {
      if (isListRow(r)) addDefaults(listKey(kind, r), r.suggest ?? []);
      if (r.serialList) addDefaults(serialListKey(kind, r), r.serialList);
    }

  const opts = await getSheetOptions();
  let changed = false;
  for (const { list, value } of additions) {
    const v = value.trim().slice(0, MAX_OPTION_LEN);
    if (!v || !valid.has(list)) continue;
    const cur = opts[list] ?? [];
    const known = [...(defaults.get(list) ?? []), ...cur].map((x) => x.toUpperCase());
    if (known.includes(v.toUpperCase()) || cur.length >= MAX_OPTIONS_PER_LIST) continue;
    opts[list] = [...cur, v];
    changed = true;
  }
  if (changed) await writeSheetOptions(opts);
  return opts;
}

export async function removeSheetOption(list: string, value: string): Promise<SheetOptions> {
  const opts = await getSheetOptions();
  const cur = opts[list] ?? [];
  const next = cur.filter((x) => x.toUpperCase() !== value.trim().toUpperCase());
  if (next.length !== cur.length) {
    if (next.length) opts[list] = next;
    else delete opts[list];
    await writeSheetOptions(opts);
  }
  return opts;
}

/**
 * Crea sulla macchina i gruppi componente usati dalle schede che mancano (es.
 * "Blocchi motore" sui fascicoli importati prima che esistesse). Idempotente.
 */
export async function ensureSheetComponents(machineId: string): Promise<number> {
  const machine = await prisma.machine.findUnique({ where: { id: machineId }, select: { plantType: true } });
  if (!machine) return 0;
  // Solo i gruppi delle schede di QUESTA tipologia: su una cesoia non hanno
  // senso i riduttori del trituratore.
  const groups = sheetGroupIds(sheetKindsFor(machine.plantType));
  const existing = await prisma.component.findMany({ where: { machineId }, select: { groupId: true } });
  const have = new Set(existing.map((c) => c.groupId));
  let created = 0;
  for (const gid of groups) {
    if (have.has(gid)) continue;
    const g = COMPONENT_GROUPS.find((x) => x.id === gid);
    if (!g) continue;
    try {
      await prisma.component.create({
        data: {
          machineId,
          groupId: gid,
          items: { create: g.slots.map((label, position) => ({ position, label })) },
        },
      });
      created++;
    } catch (e) {
      // richiesta concorrente che l'ha già creato
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  return created;
}

function readHeader(raw: unknown): SheetHeader {
  const h = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { tipo: str(h.tipo, 80), collaudatoDa: str(h.collaudatoDa, 120), matricola: str(h.matricola, 80) };
}

/**
 * Campi d'intestazione che non si compilano a mano: il tipo GF del trituratore
 * è sempre GF4000 e "Collaudato da" è chi firma (compilatore) la check list di
 * collaudo M7.3 del fascicolo, uguale su entrambe le schede.
 */
function fixedHeader(
  kind: SheetKind,
  header: SheetHeader,
  machine: { model: string; collaudo: { compilerName: string | null } | null }
): SheetHeader {
  const fields = sheetDef(kind).headerFields ?? [];
  const out: SheetHeader = {
    tipo: kind === "TRITURATORE" ? defaultTipo(kind, machine.model) : header.tipo || defaultTipo(kind, machine.model),
  };
  // "Collaudato da" arriva dalla check list di collaudo; la matricola la scrive
  // chi compila (i moduli mulino e cesoia la chiedono in testata).
  if (fields.includes("collaudatoDa")) out.collaudatoDa = machine.collaudo?.compilerName ?? "";
  if (fields.includes("matricola")) out.matricola = header.matricola ?? "";
  return out;
}

function readValues(raw: unknown): SheetValues {
  return (raw && typeof raw === "object" ? raw : {}) as SheetValues;
}

/** Scheda pronta per UI e PDF: intestazione con default, valori risolti, firma. */
export async function loadSheet(machineId: string, kind: SheetKind) {
  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
    include: {
      components: { include: { items: { orderBy: { position: "asc" } } } },
      allestimenti: { where: { kind } },
      collaudo: { select: { compilerName: true } },
    },
  });
  if (!machine) return null;
  const rec = machine.allestimenti[0] ?? null;
  const header = fixedHeader(kind, readHeader(rec?.header), machine);
  return {
    machine,
    kind,
    header,
    values: resolveValues(kind, readValues(rec?.values), machine.components, machine),
    status: (rec?.status ?? "DRAFT") as "DRAFT" | "SIGNED",
    compilerName: rec?.compilerName ?? null,
    compiledAt: rec?.compiledAt ?? null,
    compilerSignature: rec?.compilerSignature ?? null,
    updatedAt: rec?.updatedAt ?? null,
    updatedByName: rec?.updatedByName ?? null,
  };
}

/**
 * Salva la scheda. Le specifiche collegate a un gruppo componente vanno sul
 * componente (marca / extra), il resto nella scheda. Se la scheda era firmata e
 * i dati cambiano, la firma decade: il PDF firmato non deve dire cose diverse da
 * quelle che il compilatore ha visto.
 */
export async function saveSheet(
  machineId: string,
  kind: SheetKind,
  input: { header?: unknown; values?: unknown },
  user: { id: string; name: string }
): Promise<{ signatureRevoked: boolean }> {
  await ensureSheetComponents(machineId);
  const before = await loadSheet(machineId, kind);
  if (!before) throw new Error("Macchina non trovata");

  const header = fixedHeader(kind, readHeader(input.header), before.machine);
  const incoming = readValues(input.values);
  const def = sheetDef(kind);

  const stored: SheetValues = {};
  const compUpdates = new Map<string, { brand?: string | null; extra?: Record<string, string> }>();

  for (const row of allRows(def)) {
    const v = incoming[row.key] ?? {};
    const spec = str(v.spec);
    const note = str(v.note, 1000);
    const serial = row.serialField || row.serialList ? str(v.serial, 120) : "";

    if (row.bind) {
      const u = compUpdates.get(row.bind.group) ?? {};
      if (row.bind.field === "brand") u.brand = spec || null;
      else u.extra = { ...(u.extra ?? {}), [row.bind.extraKey]: spec };
      compUpdates.set(row.bind.group, u);
    }
    const entry: { spec?: string; serial?: string; note?: string } = {};
    if (!row.bind && spec) entry.spec = spec;
    if (serial) entry.serial = serial;
    if (note) entry.note = note;
    if (Object.keys(entry).length) stored[row.key] = entry;
  }

  const comps = before.machine.components;
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const [groupId, u] of compUpdates) {
    const c = comps.find((x) => x.groupId === groupId);
    if (!c) continue;
    const data: Prisma.ComponentUpdateInput = {};
    if (u.brand !== undefined && u.brand !== c.brand) data.brand = u.brand;
    if (u.extra) {
      const cur = (c.extra && typeof c.extra === "object" ? c.extra : {}) as Record<string, string>;
      const next = { ...cur, ...u.extra };
      if (JSON.stringify(next) !== JSON.stringify(cur)) data.extra = next;
    }
    if (Object.keys(data).length) ops.push(prisma.component.update({ where: { id: c.id }, data }));
  }

  const after = resolveValues(kind, stored, comps.map((c) => {
    const u = compUpdates.get(c.groupId);
    const cur = (c.extra && typeof c.extra === "object" ? c.extra : {}) as Record<string, string>;
    return {
      groupId: c.groupId,
      brand: u?.brand !== undefined ? u.brand : c.brand,
      extra: u?.extra ? { ...cur, ...u.extra } : c.extra,
    };
  }), before.machine);
  if (!header.tipo) header.tipo = defaultTipo(kind, before.machine.model);

  const changed =
    JSON.stringify({ h: before.header, v: before.values }) !== JSON.stringify({ h: header, v: after });
  const signatureRevoked = changed && before.status === "SIGNED";

  const sheetData = {
    header: header as Prisma.InputJsonValue,
    values: stored as Prisma.InputJsonValue,
    updatedByName: user.name,
    ...(signatureRevoked
      ? { status: "DRAFT", compilerId: null, compilerName: null, compiledAt: null, compilerSignature: null }
      : {}),
  };
  ops.push(
    prisma.allestimentoSheet.upsert({
      where: { machineId_kind: { machineId, kind } },
      create: { machineId, kind, ...sheetData },
      update: sheetData,
    })
  );
  if (signatureRevoked)
    ops.push(
      prisma.diaryEvent.create({
        data: {
          machineId,
          phase: "PRODUCTION",
          type: "note",
          title: `${def.code} ${def.title.toLowerCase()}: modificata dopo la firma`,
          note: `La firma di ${before.compilerName ?? "—"} è decaduta: la scheda va firmata di nuovo.`,
          actorName: user.name,
          authorId: user.id,
        },
      })
    );
  await prisma.$transaction(ops);

  // Un valore scritto a mano in un campo a elenco entra nell'elenco: la volta
  // dopo si sceglie invece di riscriverlo.
  await addSheetOptions([
    ...allRows(def)
      .filter(isListRow)
      .map((row) => ({ list: listKey(kind, row), value: str(incoming[row.key]?.spec) })),
    ...allRows(def)
      .filter((row) => row.serialList)
      .map((row) => ({ list: serialListKey(kind, row), value: str(incoming[row.key]?.serial) })),
  ].filter((a) => a.value));
  return { signatureRevoked };
}

export async function signSheet(
  machineId: string,
  kind: SheetKind,
  signature: string,
  user: { id: string; name: string }
) {
  const def = sheetDef(kind);
  const data = {
    status: "SIGNED",
    compilerId: user.id,
    compilerName: user.name,
    compiledAt: new Date(),
    compilerSignature: signature,
    updatedByName: user.name,
  };
  await prisma.$transaction([
    prisma.allestimentoSheet.upsert({
      where: { machineId_kind: { machineId, kind } },
      create: { machineId, kind, ...data },
      update: data,
    }),
    prisma.diaryEvent.create({
      data: {
        machineId,
        phase: "PRODUCTION",
        type: "milestone",
        title: `${def.code} ${def.title.charAt(0)}${def.title.slice(1).toLowerCase()} compilata e firmata`,
        actorName: user.name,
        authorId: user.id,
      },
    }),
  ]);
}
