import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { importPicked } from "@/lib/googlePicker";

/**
 * Porta nel fascicolo le foto che l'utente ha scelto dal suo Google Foto.
 *
 * Le foto **si copiano**: da qui in avanti stanno sul disco del server come
 * tutte le altre e si vedono anche se l'utente le cancella da Google o revoca
 * il permesso. Un collegamento al suo account sarebbe un fascicolo che dipende
 * dalla libreria di una persona.
 *
 * `{ sessionId, category?, componentItemId? }` — con `componentItemId` la foto
 * finisce direttamente sullo slot del componente, come quelle scattate lì.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { id } = await ctx.params;
  const machine = await prisma.machine.findUnique({ where: { id }, select: { id: true, code: true } });
  if (!machine) return NextResponse.json({ error: "Macchina non trovata" }, { status: 404 });

  const b = (await req.json().catch(() => null)) as {
    sessionId?: string;
    category?: string;
    componentItemId?: string | null;
  } | null;
  const sessionId = typeof b?.sessionId === "string" ? b.sessionId : "";
  if (!sessionId) return NextResponse.json({ error: "sessionId mancante" }, { status: 400 });

  const componentItemId = typeof b?.componentItemId === "string" && b.componentItemId ? b.componentItemId : null;
  if (componentItemId) {
    // lo slot deve essere di QUESTA macchina: l'id arriva dal client
    const it = await prisma.componentItem.findUnique({
      where: { id: componentItemId },
      select: { component: { select: { machineId: true } } },
    });
    if (it?.component.machineId !== machine.id)
      return NextResponse.json({ error: "Slot non valido" }, { status: 400 });
  }

  const r = await importPicked({
    userId: user.id,
    userName: user.name,
    sessionId,
    machineId: machine.id,
    machineCode: machine.code,
    category: typeof b?.category === "string" && b.category ? b.category : "produzione",
    componentItemId,
  });
  if ("error" in r) return NextResponse.json(r, { status: 409 });

  // i path servono a chi importa su uno slot: la matricola si legge subito
  // dalla foto appena arrivata, senza aspettare il ricaricamento della pagina
  const paths = await prisma.photo.findMany({
    where: { id: { in: r.photoIds } },
    select: { path: true },
  });
  return NextResponse.json({
    ok: true,
    count: r.photoIds.length,
    photoIds: r.photoIds,
    paths: paths.map((p) => p.path),
    skipped: r.skipped,
  });
}
