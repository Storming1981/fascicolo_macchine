import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { createMachine } from "@/lib/machineService";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.create")))
    return NextResponse.json({ error: "Permesso negato per creare fascicoli" }, { status: 403 });
  try {
    const b = await req.json();
    if (!b.job || !b.model || !b.customer) {
      return NextResponse.json({ error: "Job, modello e cliente sono obbligatori" }, { status: 400 });
    }
    const machine = await createMachine(
      {
        job: String(b.job),
        jobBody: b.jobBody || null,
        jobContainer: b.jobContainer || null,
        year: Number(b.year) || new Date().getFullYear(),
        plantType: b.plantType || null,
        model: String(b.model),
        customer: String(b.customer),
        country: String(b.country || "Italia"),
        countryCode: String(b.countryCode || "IT"),
        site: b.site || null,
        productionStart: b.productionStart ? new Date(b.productionStart) : null,
        deliveryDate: b.deliveryDate ? new Date(b.deliveryDate) : null,
        pressureSettings: b.pressureSettings || null,
        plateWeight: b.plateWeight || null,
        platePower: b.platePower || null,
        plateVoltage: b.plateVoltage || null,
        components: b.components || undefined,
      },
      user.name,
      user.id
    );
    return NextResponse.json({ ok: true, code: machine.code });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Errore creazione fascicolo" }, { status: 500 });
  }
}
