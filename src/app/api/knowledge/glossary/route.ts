import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { seedGlossary } from "@/lib/brain/glossary";

export const dynamic = "force-dynamic";

/** Il dizionario tecnico ZATO. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const terms = await prisma.knowledgeTerm.findMany({ orderBy: [{ category: "asc" }, { term: "asc" }] });
  return NextResponse.json({ terms });
}

/** Crea un termine, oppure popola il dizionario con le voci di partenza. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const b = await req.json().catch(() => null);

  if (b?.action === "seed") {
    const created = await seedGlossary();
    return NextResponse.json({ ok: true, created });
  }

  const term = typeof b?.term === "string" ? b.term.trim() : "";
  if (!term) return NextResponse.json({ error: "Termine obbligatorio" }, { status: 400 });

  const aliases = Array.isArray(b.aliases)
    ? b.aliases.map(String).map((s: string) => s.trim()).filter(Boolean)
    : typeof b.aliases === "string"
      ? b.aliases.split(",").map((s: string) => s.trim()).filter(Boolean)
      : [];

  const existing = await prisma.knowledgeTerm.findUnique({ where: { term } });
  if (existing) return NextResponse.json({ error: "Termine già presente nel dizionario" }, { status: 409 });

  const created = await prisma.knowledgeTerm.create({
    data: {
      term,
      aliases: aliases.slice(0, 20),
      definition: typeof b.definition === "string" ? b.definition.trim() || null : null,
      category: typeof b.category === "string" && b.category.trim() ? b.category.trim() : "Generale",
      plantType: typeof b.plantType === "string" ? b.plantType.trim() || null : null,
    },
  });
  return NextResponse.json({ ok: true, term: created });
}
