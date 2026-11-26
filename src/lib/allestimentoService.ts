import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { COMPONENT_GROUPS } from "./components";
import {
  allListKeys,
  allRows,
  BLOCKS,
  blockKindOf,
  sheetInitBlocks,
  SHEET_KINDS,
  defaultTipo,
  isListRow,
  isNa,
  listKey,
  naKey,
  NA_VALUE,
  resolveValues,
  sectionCanNa,
  sectionGroups,
  sheetDef,
  sheetGroupIds,
  machineSheetKinds,
  SHEET_LABEL,
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
  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
    select: { plantType: true, sheetKinds: true },
  });
  if (!machine) return 0;
  // Solo i gruppi delle schede di QUESTO fascicolo: su una cesoia non hanno
  // senso i riduttori del trituratore, e su un container senza corpo non ha
  // senso creare i gruppi della M5.16.
  const kinds = machineSheetKinds(machine.plantType, machine.sheetKinds);
  const groups = sheetGroupIds(kinds);
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
          items: { create: g.slots.map((label, position) => ({ position, label, photoOnly: !!g.photoOnly })) },
        },
      });
      if (gid === "shaft") await moveShaftLot(machineId);
      created++;
    } catch (e) {
      // richiesta concorrente che l'ha già creato
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  return created + (await ensureSheetSlots(machineId, groups)) + (await ensureSheetBlocks(machineId, kinds));
}

/**
 * Blocchi che la scheda dichiara gia' presenti (`repeatInit`): una linea di
 * separazione monta quasi sempre gli stessi pezzi, e aprire la scheda su un
 * foglio bianco voleva dire aggiungerli a mano uno per uno — con il rischio
 * che una scheda vuota sembri "non ancora compilata" quando invece il pezzo
 * non c'e'.
 *
 * Si creano **una volta sola**: se la scheda ha gia' un blocco qualsiasi,
 * quello che c'e' e' la linea vera e non si tocca. Trommel e tramoggia
 * nascono esclusi (`excluded`), cioe' su N.A.: ci sono nell'elenco ma non
 * chiedono niente finche' qualcuno non dice che sono montati.
 */
async function ensureSheetBlocks(machineId: string, kinds: SheetKind[]): Promise<number> {
  const inits = sheetInitBlocks(kinds);
  if (!inits.length) return 0;
  const existing = await prisma.component.findMany({ where: { machineId }, select: { groupId: true } });
  if (existing.some((c) => blockKindOf(c.groupId))) return 0;
  let created = 0;
  for (const init of inits) {
    const block = BLOCKS[init.kind];
    if (!block) continue;
    for (let n = 1; n <= init.count; n++) {
      try {
        await prisma.component.create({
          data: {
            machineId,
            groupId: `${init.kind}-${n}`,
            label: `${block.label} ${n}`,
            excluded: !!init.na,
            items: {
              create: block.slots.map((s, position) => ({
                position,
                label: s.label,
                photoOnly: !!s.photoOnly,
              })),
            },
          },
        });
        created++;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      }
    }
  }
  return created;
}

/**
 * Slot mancanti sui gruppi gia' presenti. La definizione di un gruppo puo'
 * crescere (gli alberi sono due, non uno) e senza questo i fascicoli aperti
 * prima resterebbero con gli slot di allora. Aggiunge solo in coda: gli slot
 * aggiunti a mano da un operatore (API component-item) non si toccano.
 */
async function ensureSheetSlots(machineId: string, groupIds: string[]): Promise<number> {
  const comps = await prisma.component.findMany({
    where: { machineId, groupId: { in: groupIds } },
    select: {
      id: true,
      groupId: true,
      extra: true,
      items: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, label: true, serial: true, photoOnly: true },
      },
    },
  });
  let added = 0;
  for (const c of comps) {
    const g = COMPONENT_GROUPS.find((x) => x.id === c.groupId);
    if (!g) continue;
    // Il gruppo e' diventato "solo foto" dopo che i suoi slot erano gia' stati
    // creati (la carpenteria di una linea): quegli slot continuavano a contare
    // fra le matricole del fascicolo, e una matricola che non si scrive mai lo
    // tiene indietro per sempre. In produzione erano 12 slot su 15.
    const photoOnly = !!g.photoOnly;
    const wrong = c.items.filter((i) => i.photoOnly !== photoOnly).map((i) => i.id);
    if (wrong.length)
      await prisma.componentItem.updateMany({ where: { id: { in: wrong } }, data: { photoOnly } });
    if (c.groupId === "blades") await moveBladesLot(c);
    // lo slot unico dell'albero si chiamava "Albero": col secondo prende il numero
    const unnamed = c.groupId === "shaft" ? c.items.find((i) => i.label === "Albero") : undefined;
    if (unnamed) await prisma.componentItem.update({ where: { id: unnamed.id }, data: { label: g.slots[0] } });
    if (c.items.length >= g.slots.length) continue;
    const next = c.items.reduce((m, i) => Math.max(m, i.position), -1) + 1;
    const missing = g.slots
      .slice(c.items.length)
      .map((label, i) => ({ componentId: c.id, position: next + i, label, photoOnly: !!g.photoOnly }));
    await prisma.componentItem.createMany({ data: missing });
    added += missing.length;
  }
  return added;
}

/**
 * Il lotto lame era un campo `extra` del gruppo (testo a mano): ora e' la
 * matricola dello slot "Set lame", che ha foto e OCR come le altre. Il valore
 * gia' inserito si sposta sullo slot la prima volta, e l'extra si svuota per
 * non lasciare due verita' sullo stesso dato.
 */
async function moveBladesLot(c: {
  id: string;
  extra: unknown;
  items: { id: string; serial: string | null }[];
}) {
  const extra = (c.extra && typeof c.extra === "object" ? c.extra : {}) as Record<string, unknown>;
  const lot = str(extra.lot, 120);
  const slot = c.items[0];
  if (!lot || !slot || (slot.serial ?? "").trim()) return;
  const { lot: _drop, ...rest } = extra;
  await prisma.$transaction([
    prisma.componentItem.update({ where: { id: slot.id }, data: { serial: lot } }),
    prisma.component.update({ where: { id: c.id }, data: { extra: rest as Prisma.InputJsonValue } }),
  ]);
}

/**
 * Il lotto albero era una voce scritta a mano nella scheda; ora e' la matricola
 * dello slot "Albero", che si legge dalla foto. Alla creazione del gruppo il
 * valore gia' inserito si sposta sullo slot, altrimenti sparirebbe dalla scheda
 * di tutti i fascicoli gia' compilati.
 */
async function moveShaftLot(machineId: string) {
  const rec = await prisma.allestimentoSheet.findUnique({
    where: { machineId_kind: { machineId, kind: "TRITURATORE" } },
    select: { values: true },
  });
  const v = readValues(rec?.values);
  const lot = str(v.lotto_albero?.spec, 120);
  if (!lot) return;
  const comp = await prisma.component.findFirst({
    where: { machineId, groupId: "shaft" },
    select: { items: { orderBy: { position: "asc" }, select: { id: true, serial: true } } },
  });
  const slot = comp?.items[0];
  if (!slot || (slot.serial ?? "").trim()) return;
  await prisma.componentItem.update({ where: { id: slot.id }, data: { serial: lot } });
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
  // Alimentazione del mulino: una delle due, mai niente. Senza una scelta
  // scritta la scheda non saprebbe quale card chiedere, e l'elettrico e' il
  // caso di gran lunga piu' frequente.
  if (fields.includes("alimentazione")) out.alim = header.alim === "Diesel" ? "Diesel" : "Elettrico";
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
    const spec = row.noSpec ? "" : str(v.spec);
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

  // Voci messe a N.A.: i capitoli si salvano fra i valori, i componenti si
  // escludono dalla macchina (`Component.excluded`) — altrimenti la matricola
  // del cavalletto resterebbe da compilare su una macchina senza cavalletto, e
  // il fascicolo non arriverebbe mai al 100%.
  const kinds = machineSheetKinds(before.machine.plantType, before.machine.sheetKinds);
  const excluded = new Map<string, boolean>();
  const naNotes: { title: string; note?: string }[] = [];
  for (const sec of def.sections) {
    // Si guardano tutti i capitoli escludibili, non solo quelli che ora lo
    // sono davvero: un fascicolo tornato corpo + container deve **perdere**
    // l'esclusione di quando era di solo corpo, altrimenti la matricola del
    // cavalletto resterebbe fuori dal conteggio senza che si veda piu' perche'.
    if (!sec.naButton) continue;
    const on = sectionCanNa(sec, kinds) && isNa(incoming, sec.key);
    if (on) stored[naKey(sec.key)] = { spec: NA_VALUE };
    for (const g of sectionGroups(sec)) excluded.set(g, on);
    if (on !== isNa(before.values, sec.key))
      naNotes.push({
        title: `${def.code} — ${sec.title.replace(/^ALLESTIMENTO /, "")}: ${
          on ? "capitolo non previsto (N.A.)" : "capitolo di nuovo previsto"
        }`,
      });
  }
  for (const row of allRows(def)) {
    const group = row.naComponent ? row.serials ?? row.bind?.group : undefined;
    if (!group) continue;
    const on = isNa(incoming, row.key);
    excluded.set(group, on);
    if (on !== isNa(before.values, row.key))
      naNotes.push({
        title: `${row.label}: ${on ? "componente non previsto (N.A.)" : "componente di nuovo previsto"}`,
        note: on
          ? "Non spedito con la macchina: le sue matricole non contano più fra quelle del fascicolo."
          : undefined,
      });
  }

  const comps = before.machine.components;
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const [groupId, on] of excluded) {
    const c = comps.find((x) => x.groupId === groupId);
    if (c && c.excluded !== on) ops.push(prisma.component.update({ where: { id: c.id }, data: { excluded: on } }));
  }
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
      excluded: excluded.get(c.groupId) ?? c.excluded,
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
  // Un componente escluso (o rimesso) non e' una voce qualunque della scheda:
  // cambia che cosa monta quella macchina, quindi va a diario come le spunte
  // di dotazione.
  for (const n of naNotes)
    ops.push(
      prisma.diaryEvent.create({
        data: {
          machineId,
          phase: "PRODUCTION",
          type: "note",
          title: n.title,
          note: n.note,
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

export type MoveSheetResult =
  | {
      ok: true;
      target: { id: string; code: string; job: string };
      moved: { groups: number; serials: number; photos: number; documents: number };
    }
  | { ok: false; status: number; error: string };

/** La scheda e' vuota? Una riga mai toccata non e' una compilazione. */
function sheetIsEmpty(rec: { values: unknown; status: string } | null): boolean {
  if (!rec) return true;
  if (rec.status === "SIGNED") return false;
  return !Object.values(readValues(rec.values)).some((v) =>
    `${v?.spec ?? ""}${v?.serial ?? ""}${v?.note ?? ""}`.trim()
  );
}

/**
 * Sposta una scheda di allestimento su un **altro fascicolo**.
 *
 * Succede davvero: un corpo o un container si allestisce a magazzino, sotto la
 * commessa di stock, e la commessa di vendita arriva dopo — su un altro
 * fascicolo. Ricompilare a mano trentotto voci e trenta matricole non e' una
 * strada: si sposta quello che e' gia' stato scritto.
 *
 * Si sposta **tutto quello che la scheda e'**: la riga (firma compresa), i
 * gruppi componente che le danno le matricole — con i loro slot e le loro foto
 * — i documenti delle sue caselle e le spunte di dotazione delle sue righe.
 * Lasciare indietro le matricole vorrebbe dire una scheda che parla di una
 * macchina e dei numeri che stanno su un'altra.
 *
 * Il fascicolo di destinazione **non deve averla gia' compilata**: fondere due
 * compilazioni non si puo' fare senza inventare, quindi si rifiuta e si dice
 * perche'. Una scheda mai toccata — riga vuota e gruppi senza matricole, creati
 * da `ensureSheetComponents` alla prima apertura — non e' una compilazione:
 * quella si sostituisce.
 */
export async function moveSheet(
  machineId: string,
  kind: SheetKind,
  targetId: string,
  user: { id: string; name: string }
): Promise<MoveSheetResult> {
  const def = sheetDef(kind);
  const what = `${def.code} ${SHEET_LABEL[kind]}`;
  if (!targetId || machineId === targetId)
    return { ok: false, status: 400, error: "Scegli un fascicolo di destinazione diverso da questo" };

  const pick = {
    id: true,
    code: true,
    job: true,
    plantType: true,
    sheetKinds: true,
    tiranteGiunto: true,
    filtroMaggiorato: true,
  } as const;
  const [src, dst] = await Promise.all([
    prisma.machine.findUnique({ where: { id: machineId }, select: pick }),
    prisma.machine.findUnique({ where: { id: targetId }, select: pick }),
  ]);
  if (!src || !dst) return { ok: false, status: 404, error: "Fascicolo non trovato" };
  if (!machineSheetKinds(dst.plantType, dst.sheetKinds).includes(kind))
    return {
      ok: false,
      status: 400,
      error: `Il fascicolo ${dst.code} non prevede la scheda ${what}: spostala su un fascicolo che la comprende.`,
    };

  const sheet = await prisma.allestimentoSheet.findUnique({
    where: { machineId_kind: { machineId, kind } },
  });
  if (!sheet)
    return {
      ok: false,
      status: 404,
      error: `La scheda ${what} non e' mai stata aperta: non c'e' niente da spostare.`,
    };

  const groups = sheetGroupIds([kind]);
  // Anche i **blocchi** della scheda (nastri, separatori, cabina): sono
  // componenti con un numero nell'id, quindi non stanno fra i gruppi fissi —
  // e lasciarli indietro vorrebbe dire una linea senza le sue matricole.
  const blockKinds = def.sections.flatMap((s) => s.repeat ?? []);
  const compWhere = (mid: string) => ({
    machineId: mid,
    OR: [
      { groupId: { in: groups } },
      ...blockKinds.map((k) => ({ groupId: { startsWith: `${k}-` } })),
    ],
  });
  const itemSel = { select: { id: true, serial: true, lot: true, note: true } };
  const [srcComps, dstComps, dstSheet] = await Promise.all([
    prisma.component.findMany({ where: compWhere(machineId), include: { items: itemSel } }),
    prisma.component.findMany({ where: compWhere(targetId), include: { items: itemSel } }),
    prisma.allestimentoSheet.findUnique({ where: { machineId_kind: { machineId: targetId, kind } } }),
  ]);

  if (!sheetIsEmpty(dstSheet))
    return {
      ok: false,
      status: 409,
      error: `Su ${dst.code} (commessa ${dst.job}) la scheda ${what} e' gia' compilata: due compilazioni non si fondono.`,
    };

  // Un gruppo della destinazione si sostituisce solo se e' davvero vuoto: una
  // matricola, un lotto, una nota, una marca o una foto sono lavoro di
  // qualcuno, e cancellarlo per far posto sarebbe peggio del non spostare.
  const dstItemIds = dstComps.flatMap((c) => c.items.map((i) => i.id));
  const withPhotos = dstItemIds.length
    ? new Set(
        (
          await prisma.photo.findMany({
            where: { componentItemId: { in: dstItemIds } },
            select: { componentItemId: true },
          })
        ).map((p) => p.componentItemId as string)
      )
    : new Set<string>();
  const busy = dstComps.filter(
    (c) =>
      (c.brand ?? "").trim() ||
      (c.extra && typeof c.extra === "object" && Object.keys(c.extra).length) ||
      c.items.some(
        (i) =>
          (i.serial ?? "").trim() || (i.lot ?? "").trim() || (i.note ?? "").trim() || withPhotos.has(i.id)
      )
  );
  if (busy.length) {
    const labels = busy.map(
      (c) => COMPONENT_GROUPS.find((g) => g.id === c.groupId)?.label ?? c.label ?? c.groupId
    );
    return {
      ok: false,
      status: 409,
      error: `Su ${dst.code} questi componenti hanno gia' dei dati: ${labels.join(", ")}. Spostala su un fascicolo libero.`,
    };
  }

  const itemIds = srcComps.flatMap((c) => c.items.map((i) => i.id));
  const serials = srcComps.reduce((n, c) => n + c.items.filter((i) => (i.serial ?? "").trim()).length, 0);
  const photos = itemIds.length ? await prisma.photo.count({ where: { componentItemId: { in: itemIds } } }) : 0;
  const docCats = allRows(def).flatMap((r) => (r.docs ?? []).map((d) => d.category));
  const documents = docCats.length
    ? await prisma.document.count({ where: { machineId, category: { in: docCats } } })
    : 0;
  const kitFlags = allRows(def)
    .map((r) => r.kitFlag)
    .filter((k): k is NonNullable<typeof k> => !!k);

  const note = `Commessa ${src.job} → ${dst.job} · ${serials} matricole, ${photos} foto, ${documents} documenti.`;
  const ops: Prisma.PrismaPromise<unknown>[] = [
    // prima si tolgono i gruppi vuoti della destinazione: il vincolo unico e'
    // (macchina, gruppo) e lo spostamento lo violerebbe
    ...dstComps.map((c) => prisma.component.delete({ where: { id: c.id } })),
    prisma.component.updateMany({
      where: { id: { in: srcComps.map((c) => c.id) } },
      data: { machineId: targetId },
    }),
    // ... e la riga vuota della scheda, per la stessa ragione: il vincolo e'
    // (macchina, scheda) e senza questo lo spostamento fallirebbe proprio sui
    // fascicoli dove la scheda era gia' stata aperta e lasciata in bianco.
    ...(dstSheet ? [prisma.allestimentoSheet.delete({ where: { id: dstSheet.id } })] : []),
    prisma.allestimentoSheet.update({ where: { id: sheet.id }, data: { machineId: targetId } }),
  ];
  if (itemIds.length)
    ops.push(
      prisma.photo.updateMany({ where: { componentItemId: { in: itemIds } }, data: { machineId: targetId } })
    );
  if (docCats.length)
    ops.push(
      prisma.document.updateMany({
        where: { machineId, category: { in: docCats } },
        data: { machineId: targetId },
      })
    );
  // Le spunte di dotazione stanno sulla riga del componente di questa scheda:
  // seguono la scheda, altrimenti direbbero il falso su entrambi i fascicoli.
  if (kitFlags.length)
    ops.push(
      prisma.machine.update({
        where: { id: targetId },
        data: Object.fromEntries(kitFlags.map((k) => [k, src[k]])),
      }),
      prisma.machine.update({
        where: { id: machineId },
        data: Object.fromEntries(kitFlags.map((k) => [k, false])),
      })
    );
  ops.push(
    prisma.diaryEvent.create({
      data: {
        machineId,
        phase: "PRODUCTION",
        type: "note",
        title: `${what}: scheda spostata sul fascicolo ${dst.code}`,
        note,
        actorName: user.name,
        authorId: user.id,
      },
    }),
    prisma.diaryEvent.create({
      data: {
        machineId: targetId,
        phase: "PRODUCTION",
        type: "note",
        title: `${what}: scheda arrivata dal fascicolo ${src.code}`,
        note,
        actorName: user.name,
        authorId: user.id,
      },
    })
  );
  await prisma.$transaction(ops);

  return {
    ok: true,
    target: { id: dst.id, code: dst.code, job: dst.job },
    moved: { groups: srcComps.length, serials, photos, documents },
  };
}
