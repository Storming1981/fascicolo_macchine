import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/uploads";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const { id } = await ctx.params;
  const machine = await prisma.machine.findUnique({ where: { id } });
  if (!machine) return NextResponse.json({ error: "Macchina non trovata" }, { status: 404 });

  const form = await req.formData();
  const category = String(form.get("category") || "produzione");
  const caption = String(form.get("caption") || "").trim() || null;
  const componentItemId = String(form.get("componentItemId") || "").trim() || null;
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "Nessuna foto" }, { status: 400 });

  let n = 0;
  for (const f of files) {
    const saved = await saveFile(f, `${machine.code}/foto`);
    await prisma.photo.create({
      data: {
        machineId: id,
        componentItemId,
        path: saved.path,
        category,
        caption,
        authorName: user.name,
        authorId: user.id,
      },
    });
    n++;
  }
  return NextResponse.json({ ok: true, count: n });
}
