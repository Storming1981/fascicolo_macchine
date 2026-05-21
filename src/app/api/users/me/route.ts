import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    hasPin: !!user.pinHash,
    hasSignature: !!user.signatureImage,
  });
}

export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const b = await req.json();
  const data: Record<string, unknown> = {};
  if (b.signatureImage === null) {
    data.signatureImage = null;
  } else if (typeof b.signatureImage === "string" && b.signatureImage.startsWith("data:image")) {
    data.signatureImage = b.signatureImage;
  }
  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nessun campo valido" }, { status: 400 });
  await prisma.user.update({ where: { id: user.id }, data });
  return NextResponse.json({ ok: true });
}
