import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { isErpConfigured, getErpCustomerByConto } from "@/lib/erp";
import { resolveCountry } from "@/lib/domain";

/** Aggiorna nome/indirizzo/città/provincia/paese del cliente dai dati anagra. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "customer.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  if (!isErpConfigured())
    return NextResponse.json({ error: "Gestionale non configurato" }, { status: 503 });

  const { id } = await ctx.params;
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) return NextResponse.json({ error: "Cliente non trovato" }, { status: 404 });
  if (!customer.erpConto)
    return NextResponse.json(
      { error: "Cliente non agganciato al gestionale (manca il conto ERP)" },
      { status: 400 }
    );

  try {
    const erp = await getErpCustomerByConto(customer.erpConto);
    if (!erp) return NextResponse.json({ error: "Conto non trovato in anagra" }, { status: 404 });

    // Paese: usa l'ISO2 di tabstat se riconosciuto, altrimenti il nome.
    const country = erp.countryIso
      ? resolveCountry(erp.countryIso)
      : resolveCountry(erp.countryName);

    const updated = await prisma.customer.update({
      where: { id },
      data: {
        name: erp.name || customer.name,
        city: erp.city ?? customer.city,
        province: erp.province ?? customer.province,
        country: country.code !== "XX" ? country.label : customer.country,
        countryCode: country.code !== "XX" ? country.code : customer.countryCode,
      },
    });

    return NextResponse.json({
      ok: true,
      customer: { city: updated.city, province: updated.province, country: updated.country },
      address: erp.address,
      cap: erp.cap,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore gestionale" },
      { status: 502 }
    );
  }
}
