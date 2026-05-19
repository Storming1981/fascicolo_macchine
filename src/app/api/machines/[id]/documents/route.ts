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
  const category = String(form.get("category") || "documento");
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "Nessun file" }, { status: 400 });

  for (const f of files) {
    const saved = await saveFile(f, `${machine.code}/documenti`);
    await prisma.document.create({
      data: {
        machineId: id,
        name: f.name,
        path: saved.path,
        sizeBytes: saved.size,
        category,
      },
    });
  }
  return NextResponse.json({ ok: true, count: files.length });
}
