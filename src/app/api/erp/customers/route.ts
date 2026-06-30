import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { isErpConfigured, searchErpCustomers } from "@/lib/erp";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "customer.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  if (!isErpConfigured())
    return NextResponse.json({ error: "Gestionale non configurato", customers: [] }, { status: 503 });

  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    const customers = await searchErpCustomers(q);
    return NextResponse.json({ customers });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore gestionale", customers: [] },
      { status: 502 }
    );
  }
}
