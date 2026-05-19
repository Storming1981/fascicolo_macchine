import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { parseMatricoleWorkbook } from "@/lib/excel";
import { createMachine } from "@/lib/machineService";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.import")))
    return NextResponse.json({ error: "Permesso negato per l'import" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  const commit = String(form.get("commit") || "") === "1";
  const model = String(form.get("model") || "Da definire").trim() || "Da definire";
  if (!(file instanceof File)) return NextResponse.json({ error: "File mancante" }, { status: 400 });

  let parsed;
  try {
    parsed = parseMatricoleWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "File non leggibile (atteso .xlsx/.csv formato MATRICOLE)" }, { status: 400 });
  }

  const { machines, errors } = parsed;
  const preview = machines.slice(0, 10).map((m) => ({
    job: m.job,
    year: m.year,
    customer: m.customer,
    country: m.country,
    serials: m.components.reduce(
      (a, c) => a + c.items.filter((i) => i.serial).length,
      0
    ),
  }));

  if (!commit) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      total: machines.length,
      errors,
      preview,
    });
  }

  let created = 0;
  let skipped = 0;
  const importErrors: string[] = [...errors];
  for (const m of machines) {
    try {
      const dup = await prisma.machine.findFirst({ where: { job: m.job, year: m.year } });
      if (dup) {
        skipped++;
        continue;
      }
      await createMachine(
        {
          job: m.job,
          jobBody: m.jobBody,
          jobContainer: m.jobContainer,
          year: m.year,
          model,
          customer: m.customer,
          country: m.country,
          countryCode: m.countryCode,
          pressureSettings: m.pressureSettings,
          components: m.components,
        },
        `${user.name} (import)`,
        user.id
      );
      created++;
    } catch (e) {
      console.error(e);
      importErrors.push(`Riga ${m.rowIndex} (job ${m.job}): errore inserimento.`);
    }
  }

  return NextResponse.json({ ok: true, created, skipped, total: machines.length, errors: importErrors });
}
