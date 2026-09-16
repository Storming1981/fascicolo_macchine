import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { hasAllestimentoSheets, isSheetKind, sheetKindsFor, type SheetKind } from "@/lib/allestimento";
import { ensureSheetComponents, getSheetOptions, loadSheet, saveSheet, signSheet } from "@/lib/allestimentoService";
import { isGoogleConfigured, resolveSenderEmail } from "@/lib/google";

/**
 * Schede di allestimento BLUE DEVIL (M5.16 Trituratore / M5.17 Container).
 * GET  → entrambe le schede; crea i gruppi componente mancanti (`created` > 0 =
 *        il client deve ricaricare il fascicolo per vedere i nuovi slot).
 * PUT  { kind, header, values } → salva.
 * POST { kind, action: "sign", signature?, saveSignature? } → firma del compilatore.
 */
async function guard(id: string) {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "Non autorizzato" }, { status: 401 }) };
  const machine = await prisma.machine.findUnique({ where: { id }, select: { id: true, plantType: true } });
  if (!machine) return { error: NextResponse.json({ error: "Macchina non trovata" }, { status: 404 }) };
  if (!hasAllestimentoSheets(machine.plantType))
    return {
      error: NextResponse.json(
        { error: "Nessuna scheda di allestimento prevista per questa tipologia impianto" },
        { status: 400 }
      ),
    };
  return { user, kinds: sheetKindsFor(machine.plantType) };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id);
  if (g.error) return g.error;

  const created = await ensureSheetComponents(id);
  const sheets: Record<string, unknown> = {};
  for (const kind of g.kinds) {
    const s = await loadSheet(id, kind);
    if (!s) continue;
    sheets[kind] = {
      kind,
      header: s.header,
      values: s.values,
      status: s.status,
      compilerName: s.compilerName,
      compiledAt: s.compiledAt,
      compilerSignature: s.compilerSignature,
      updatedAt: s.updatedAt,
      updatedByName: s.updatedByName,
    };
  }
  return NextResponse.json({
    created,
    kinds: g.kinds,
    sheets,
    options: await getSheetOptions(),
    // mittente per il modulo "Invia via e-mail" (casella personale o aziendale)
    mail: { configured: isGoogleConfigured(), from: await resolveSenderEmail(g.user.id) },
  });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id);
  if (g.error) return g.error;
  const user = g.user;
  if (!(await userCan(user.role, "machine.intervention")) && !(await userCan(user.role, "machine.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b || !isSheetKind(b.kind) || !g.kinds.includes(b.kind as SheetKind))
    return NextResponse.json({ error: "Scheda non prevista per questa macchina" }, { status: 400 });

  const r = await saveSheet(id, b.kind, { header: b.header, values: b.values }, user);
  return NextResponse.json({ ok: true, ...r });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id);
  if (g.error) return g.error;
  const user = g.user;
  if (!(await userCan(user.role, "machine.intervention")))
    return NextResponse.json({ error: "Permesso negato per firmare la scheda" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b || !isSheetKind(b.kind) || b.action !== "sign" || !g.kinds.includes(b.kind as SheetKind))
    return NextResponse.json({ error: "Dati non validi" }, { status: 400 });

  const drawn = typeof b.signature === "string" && b.signature.startsWith("data:image") ? b.signature : null;
  const signature = drawn ?? user.signatureImage ?? null;
  if (!signature)
    return NextResponse.json(
      { error: "Firma mancante. Disegnala ora o imposta la firma personale." },
      { status: 400 }
    );
  if (drawn && b.saveSignature === true)
    await prisma.user.update({ where: { id: user.id }, data: { signatureImage: drawn } });

  await signSheet(id, b.kind, signature, user);
  return NextResponse.json({ ok: true });
}
