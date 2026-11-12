import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { createMachine } from "@/lib/machineService";
import { machineSheetKinds, sheetKindsFor } from "@/lib/allestimento";

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
    // Schede di allestimento scelte nel wizard: si tengono solo quelle che la
    // tipologia prevede, e si scrive l'elenco solo se e' una restrizione vera
    // (tutte = elenco vuoto, cosi' una scheda aggiunta domani alla tipologia
    // compare anche sui fascicoli di oggi).
    const allKinds = sheetKindsFor(b.plantType || null);
    const picked = Array.isArray(b.sheetKinds) ? machineSheetKinds(b.plantType || null, b.sheetKinds) : allKinds;
    const sheetKinds = picked.length === allKinds.length ? [] : picked;

    const machine = await createMachine(
      {
        job: String(b.job),
        jobBody: b.jobBody || null,
        jobContainer: b.jobContainer || null,
        year: Number(b.year) || new Date().getFullYear(),
        plantType: b.plantType || null,
        model: String(b.model),
        customer: String(b.customer),
        customerId: typeof b.customerId === "string" && b.customerId ? b.customerId : null,
        country: String(b.country || "Italia"),
        countryCode: String(b.countryCode || "IT"),
        site: b.site || null,
        productionStart: b.productionStart ? new Date(b.productionStart) : null,
        deliveryDate: b.deliveryDate ? new Date(b.deliveryDate) : null,
        pressureSettings: b.pressureSettings || null,
        plateWeight: b.plateWeight || null,
        platePower: b.platePower || null,
        plateVoltage: b.plateVoltage || null,
        sheetKinds,
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
