import { NextResponse } from "next/server";
import { currentUser, hashPassword, hashPin, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUserGoogleInfo, isGoogleConfigured } from "@/lib/google";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    hasPin: !!user.pinHash,
    hasSignature: !!user.signatureImage,
    googleConfigured: isGoogleConfigured(),
    google: await getUserGoogleInfo(user.id),
  });
}

/**
 * Profilo dell'utente loggato. Campi liberi: firma personale, telefono, foto.
 * Password e PIN di firma cambiano solo confermando la password attuale: una
 * sessione lasciata aperta su un tablet di officina non deve bastare a
 * impadronirsi delle firme di qualcun altro.
 */
export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
  const data: Record<string, unknown> = {};

  if (b.signatureImage === null) {
    data.signatureImage = null;
  } else if (typeof b.signatureImage === "string" && b.signatureImage.startsWith("data:image")) {
    data.signatureImage = b.signatureImage;
  }

  if (typeof b.phone === "string") data.phone = b.phone.trim().slice(0, 40) || null;

  if (b.photo === null) data.photo = null;
  else if (typeof b.photo === "string") {
    if (!b.photo.startsWith("data:image") || b.photo.length > 1_500_000)
      return NextResponse.json({ error: "Foto non valida o troppo grande" }, { status: 400 });
    data.photo = b.photo;
  }

  const wantsPassword = b.newPassword !== undefined;
  const wantsPin = b.pin !== undefined;
  if (wantsPassword || wantsPin) {
    if (!(await verifyPassword(String(b.currentPassword ?? ""), user.passwordHash)))
      return NextResponse.json({ error: "La password attuale non è corretta" }, { status: 400 });

    if (wantsPassword) {
      const np = String(b.newPassword ?? "");
      if (np.length < 8)
        return NextResponse.json({ error: "La nuova password deve avere almeno 8 caratteri" }, { status: 400 });
      data.passwordHash = await hashPassword(np);
    }
    if (wantsPin) {
      if (b.pin === null) data.pinHash = null;
      else {
        const pin = String(b.pin);
        if (!/^\d{4,6}$/.test(pin))
          return NextResponse.json({ error: "Il PIN deve avere da 4 a 6 cifre" }, { status: 400 });
        data.pinHash = await hashPin(pin);
      }
    }
  }

  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nessun campo valido" }, { status: 400 });
  await prisma.user.update({ where: { id: user.id }, data });
  return NextResponse.json({ ok: true });
}
