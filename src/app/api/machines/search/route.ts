import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { isSheetKind, machineSheetKinds, type SheetKind } from "@/lib/allestimento";

/**
 * Fascicoli da scegliere in una tendina (oggi: destinazione di una scheda di
 * allestimento che si sposta). Non e' la ricerca globale: qui servono poche
 * righe, gia' filtrate a quelle che possono **ricevere** quella scheda.
 *
 * GET ?q=&kind=TRITURATORE&exclude=<id>
 * `busy` = su quel fascicolo la scheda e' gia' compilata o firmata: si mostra
 * lo stesso (altrimenti sembrerebbe che il fascicolo non esista) ma non si
 * sceglie.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const kindRaw = url.searchParams.get("kind");
  const kind: SheetKind | null = isSheetKind(kindRaw) ? kindRaw : null;
  const exclude = url.searchParams.get("exclude") ?? "";

  const words = q.split(/\s+/).filter(Boolean).slice(0, 4);
  const ci = (w: string) => ({ contains: w, mode: "insensitive" as const });
  const machines = await prisma.machine.findMany({
    where: {
      ...(exclude ? { id: { not: exclude } } : {}),
      AND: words.map((w) => ({
        OR: [
          { code: ci(w) },
          { job: ci(w) },
          { jobBody: ci(w) },
          { jobContainer: ci(w) },
          { customer: ci(w) },
          { model: ci(w) },
          { plantType: ci(w) },
        ],
      })),
    },
    select: {
      id: true,
      code: true,
      job: true,
      model: true,
      customer: true,
      plantType: true,
      sheetKinds: true,
      allestimenti: kind ? { where: { kind }, select: { status: true, values: true } } : false,
    },
    orderBy: [{ year: "desc" }, { createdAt: "desc" }],
    take: 60,
  });

  const rows = machines
    .filter((m) => !kind || machineSheetKinds(m.plantType, m.sheetKinds).includes(kind))
    .slice(0, 20)
    .map((m) => {
      const rec = (m.allestimenti ?? [])[0];
      const values = (rec?.values ?? {}) as Record<string, { spec?: string; serial?: string; note?: string }>;
      const compiled =
        !!rec &&
        (rec.status === "SIGNED" ||
          Object.values(values).some((v) => `${v?.spec ?? ""}${v?.serial ?? ""}${v?.note ?? ""}`.trim()));
      return {
        id: m.id,
        code: m.code,
        job: m.job,
        model: m.model,
        customer: m.customer,
        plantType: m.plantType,
        busy: compiled,
      };
    });
  return NextResponse.json({ machines: rows });
}
