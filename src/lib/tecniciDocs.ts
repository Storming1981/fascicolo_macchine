// ============================================================
//  DOCUMENTI DEI TECNICI — il fascicolo TeamSystem portato in cantiere.
//
//  Dentro ogni intervento, sotto Documenti, compaiono gli operatori della
//  squadra; per ciascuno si consultano i suoi attestati (cartella corsi),
//  l'idoneità alla mansione, DPI, nomine e coperture assicurative.
//
//  PRIVACY PRIMA DI TUTTO. Il fascicolo TeamSystem di un dipendente contiene
//  anche cedolini, CU, dichiarazioni fiscali, comunicazioni personali e — nella
//  cartella SALUTE E SICUREZZA — la documentazione sanitaria. Qui passa una
//  WHITELIST: solo le cartelle che servono in cantiere, e dall'area salute
//  solo il certificato di IDONEITÀ (il giudizio, non gli esiti delle visite).
//  Una cartella nuova non compare finché non la si aggiunge qui di proposito.
//
//  PERCHÉ UN ARCHIVIO LOCALE. `getLatestFiles` restituisce solo gli ultimi 30
//  file, e i cedolini (uno al mese, più 13ma e CU) ne occupano metà: un
//  attestato di un anno fa esce dalla finestra. Ogni lettura accumula i
//  metadati in `TsEmployeeDoc`, così ciò che si è visto una volta resta.
//  Il file non si copia: si scarica al volo da TeamSystem a ogni apertura.
// ============================================================

import { prisma } from "./db";
import {
  teamsystemConfigured,
  tsCourses,
  tsLatestFiles,
  tsPeople,
  type TsCourse,
  type TsFile,
  type TsPerson,
} from "./teamsystemHr";

export type TsDocCategory = "attestati" | "idoneita" | "dpi" | "nomine" | "assicurazione";

export const TS_CATEGORY_LABEL: Record<TsDocCategory, string> = {
  attestati: "Corsi e attestati",
  idoneita: "Idoneità alla mansione",
  dpi: "DPI",
  nomine: "Nomine e incarichi",
  assicurazione: "Coperture assicurative",
};
export const TS_CATEGORY_ORDER: TsDocCategory[] = ["attestati", "idoneita", "dpi", "nomine", "assicurazione"];

/** Mai, qualunque cartella li contenga. */
const DENY_TYPES = new Set(["CED", "CU", "13MA", "14MA"]);
const DENY_PATH = /CEDOLIN|CERTIFICAZIONE UNICA|DOCUMENTI AMMINISTRATIVI|CONTRATT|COMUNICAZIONI|POLICIES|DISCIPLIN|BUSTA|TFR|RETRIBU/i;

/**
 * Cartella del fascicolo TeamSystem → categoria mostrata in cantiere, oppure
 * null (il documento non esce da TeamSystem).
 */
export function classifyTsFile(f: Pick<TsFile, "percorsoFile" | "titolo" | "nomeFile" | "tipoDocumento">): TsDocCategory | null {
  const path = (f.percorsoFile ?? "").toUpperCase();
  const text = `${f.titolo ?? ""} ${f.nomeFile ?? ""}`.toUpperCase();
  if (DENY_TYPES.has((f.tipoDocumento ?? "").toUpperCase())) return null;
  if (DENY_PATH.test(path)) return null;

  // Area sanitaria: solo il giudizio di idoneità, nient'altro.
  if (/SALUTE|SANITAR|VISIT[AE] MEDIC|SORVEGLIANZA/.test(path)) {
    return /IDONEIT/.test(text) ? "idoneita" : null;
  }
  if (/ATTESTAT|FORMAZIONE|\/CORSI|ABILITAZ|PATENTIN/.test(path)) return "attestati";
  if (/\/DPI\b|DISPOSITIVI DI PROTEZIONE/.test(path)) return "dpi";
  if (/NOMIN|INCARIC/.test(path)) return "nomine";
  if (/CHUBB|ASSICURAZ|POLIZZ|COPERTUR/.test(path)) return "assicurazione";
  return null;
}

// ------------------------------------------------------------
//  Aggancio utente dell'app ↔ dipendente TeamSystem
// ------------------------------------------------------------

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, "")
    .split(/\s+/)
    .filter(Boolean);

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const sameTokens = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(" ") === [...b].sort().join(" ");

/**
 * Il dipendente TeamSystem di un utente. Due regole, in quest'ordine:
 *  1. NOME: stesse parole di cognome+nome in qualunque ordine ("Paolo D'eramo"
 *     = "D'ERAMO PAOLO"). Vince sulla matricola, perché la matricola del
 *     timbratore non sempre è quella giusta (un tecnico ha da noi il 122, che
 *     in TeamSystem è un'altra persona; lui è il 121).
 *  2. MATRICOLA (= ID_PAYROLL, zeri iniziali tolti) univoca, E almeno una
 *     parola del nome quasi uguale: regge i refusi del timbratore
 *     ("Armed Xhasysa" = "XHAHYSA ARMEND") senza agganciare un omonimo di
 *     matricola — ID_PAYROLL si ripete fra ZATO SpA e ZATO North America.
 * Solo dipendenti in forza e con un codice fiscale vero (quelli americani
 * hanno "XXXXXX…" e le API documenti non li riconoscono).
 */
export function matchTsPerson(
  user: { name: string; matricola: string | null },
  people: TsPerson[]
): TsPerson | null {
  const pool = people.filter((p) => !p.ceased && /^[A-Z0-9]{16}$/.test(p.fiscalCode));
  const tokens = norm(user.name);
  if (!tokens.length) return null;

  const byName = pool.filter((p) => sameTokens(tokens, norm(`${p.surname} ${p.name}`)));
  if (byName.length === 1) return byName[0];

  const mat = (user.matricola ?? "").replace(/^0+/, "");
  if (!mat) return null;
  const byMat = pool.filter((p) => p.payrollId.replace(/^0+/, "") === mat);
  const close = byMat.filter((p) => {
    const other = norm(`${p.surname} ${p.name}`);
    return tokens.some((t) => other.some((o) => editDistance(t, o) <= 2));
  });
  return close.length === 1 ? close[0] : null;
}

/**
 * Aggancia gli utenti non ancora collegati. Un collegamento `manual` non si
 * tocca; uno `auto` si rifà solo se `relink`.
 */
export async function linkUsers(userIds: string[], opts: { relink?: boolean } = {}) {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, matricola: true, tsPersonId: true, tsLinkMode: true },
  });
  const todo = users.filter((u) => u.tsLinkMode !== "manual" && (!u.tsPersonId || opts.relink));
  if (!todo.length) return [];
  const people = await tsPeople();
  const taken = new Set(
    (
      await prisma.user.findMany({
        where: { tsPersonId: { not: null }, id: { notIn: todo.map((u) => u.id) } },
        select: { tsPersonId: true },
      })
    ).map((u) => u.tsPersonId)
  );
  const results: { userId: string; name: string; person: TsPerson | null }[] = [];
  for (const u of todo) {
    const person = matchTsPerson(u, people.filter((p) => !taken.has(p.personId)));
    results.push({ userId: u.id, name: u.name, person });
    if (!person) continue;
    taken.add(person.personId);
    if (person.personId !== u.tsPersonId)
      await prisma.user.update({
        where: { id: u.id },
        data: { tsPersonId: person.personId, tsFiscalCode: person.fiscalCode, tsLinkMode: "auto" },
      });
  }
  return results;
}

// ------------------------------------------------------------
//  Lettura del fascicolo e archivio locale
// ------------------------------------------------------------

/** Una lettura ogni 10 minuti per persona basta: il fascicolo cambia di rado. */
const REFRESH_MS = 10 * 60_000;

export async function refreshUserDocs(userId: string, force = false): Promise<void> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { tsFiscalCode: true, tsDocsSyncedAt: true },
  });
  if (!u?.tsFiscalCode) return;
  if (!force && u.tsDocsSyncedAt && Date.now() - u.tsDocsSyncedAt.getTime() < REFRESH_MS) return;

  const files = await tsLatestFiles(u.tsFiscalCode);
  const now = new Date();
  for (const f of files) {
    const category = classifyTsFile(f);
    if (!category) continue; // cedolini & co. non vengono nemmeno annotati
    const data = {
      userId,
      category,
      title: (f.titolo || f.nomeFile || "Documento").trim(),
      fileName: (f.nomeFile || f.titolo || "documento").trim(),
      folderPath: f.percorsoFile ?? "",
      docType: f.tipoDocumento ?? null,
      uploadedAt: f.dataCaricamento ? new Date(f.dataCaricamento) : null,
      lastSeenAt: now,
    };
    await prisma.tsEmployeeDoc.upsert({
      where: { uuid: f.uuidDocumento },
      create: { uuid: f.uuidDocumento, ...data },
      update: data,
    });
  }
  await prisma.user.update({ where: { id: userId }, data: { tsDocsSyncedAt: now } });
}

export interface TecnicoDocsDto {
  userId: string;
  name: string;
  role: "lead" | "member";
  linked: boolean;
  syncedAt: string | null;
  error: string | null;
  folders: {
    key: TsDocCategory;
    label: string;
    docs: { id: string; title: string; fileName: string; uploadedAt: string | null }[];
  }[];
  courses: Omit<TsCourse, "personId">[];
}

/** Squadra dell'intervento (capo cantiere prima) col fascicolo di ciascuno. */
export async function loadTeamDocs(
  interventoId: string,
  opts: { refresh?: boolean } = {}
): Promise<{ configured: boolean; team: TecnicoDocsDto[] } | null> {
  const it = await prisma.intervento.findUnique({
    where: { id: interventoId },
    select: {
      assignedTechId: true,
      tech: { select: { id: true, name: true } },
      participants: { select: { id: true, name: true } },
    },
  });
  if (!it) return null;

  const members = new Map<string, { name: string; role: "lead" | "member" }>();
  if (it.tech) members.set(it.tech.id, { name: it.tech.name, role: "lead" });
  for (const p of it.participants) if (!members.has(p.id)) members.set(p.id, { name: p.name, role: "member" });
  const ids = [...members.keys()];

  const configured = teamsystemConfigured();
  const errors = new Map<string, string>();
  let courses: TsCourse[] = [];
  if (configured && ids.length) {
    try {
      await linkUsers(ids);
    } catch (e) {
      console.error("[teamsystem] aggancio squadra", interventoId, e);
    }
    await Promise.all(
      ids.map((id) =>
        refreshUserDocs(id, opts.refresh).catch((e) => {
          console.error("[teamsystem] documenti", id, e);
          errors.set(id, "Fascicolo TeamSystem non raggiungibile: si mostrano i documenti già letti.");
        })
      )
    );
    try {
      courses = await tsCourses(opts.refresh);
    } catch (e) {
      console.error("[teamsystem] formazione", e);
    }
  }

  const [users, docs] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, tsPersonId: true, tsDocsSyncedAt: true },
    }),
    prisma.tsEmployeeDoc.findMany({
      where: { userId: { in: ids } },
      orderBy: [{ uploadedAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const byUser = new Map(users.map((u) => [u.id, u]));

  const team = ids.map((id): TecnicoDocsDto => {
    const m = members.get(id)!;
    const u = byUser.get(id);
    const mine = docs.filter((d) => d.userId === id);
    return {
      userId: id,
      name: m.name,
      role: m.role,
      linked: !!u?.tsPersonId,
      syncedAt: u?.tsDocsSyncedAt?.toISOString() ?? null,
      error: errors.get(id) ?? null,
      folders: TS_CATEGORY_ORDER.map((key) => ({
        key,
        label: TS_CATEGORY_LABEL[key],
        docs: mine
          .filter((d) => d.category === key)
          .map((d) => ({
            id: d.id,
            title: d.title,
            fileName: d.fileName,
            uploadedAt: d.uploadedAt?.toISOString() ?? null,
          })),
      })),
      courses: courses
        .filter((c) => u?.tsPersonId && c.personId === u.tsPersonId)
        .sort((a, b) => (b.end ?? b.start ?? "").localeCompare(a.end ?? a.start ?? ""))
        .map(({ personId: _p, ...c }) => c),
    };
  });
  return { configured, team };
}

/**
 * Chi può aprire i documenti TeamSystem di `ownerId`: l'interessato; chi vede
 * tutti gli interventi; chi sta nella stessa squadra di un intervento con lui
 * (capo cantiere e tecnici si vedono fra loro). Nessun altro.
 */
export async function canSeeTechDocs(
  viewer: { id: string },
  ownerId: string,
  viewAll: boolean
): Promise<boolean> {
  if (viewer.id === ownerId || viewAll) return true;
  const onTeam = (uid: string) => ({
    OR: [{ assignedTechId: uid }, { participants: { some: { id: uid } } }],
  });
  const shared = await prisma.intervento.count({
    where: { AND: [onTeam(viewer.id), onTeam(ownerId)] },
  });
  return shared > 0;
}
