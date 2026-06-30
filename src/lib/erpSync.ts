import { prisma } from "@/lib/db";
import { getMachineErpData, type ErpMachineData } from "@/lib/erp";
import { resolveCountry } from "@/lib/domain";

/**
 * Sincronizzazione di un fascicolo macchina con il gestionale ZATO (ERP).
 *
 * Aggiorna SOLO i campi alimentati dal gestionale (vedi opzioni); le date di
 * produzione vengono salvate sia su `Machine.productionStart` sia come
 * `MachineMilestone` (source GESTIONALE). I campi senza dato nel gestionale
 * non vengono toccati, per non sovrascrivere con valori vuoti.
 */

export type SyncOptions = {
  customer?: boolean; // cliente + paese
  production?: boolean; // inizio/fine produzione
  description?: boolean; // descrizione commessa
  hours?: boolean; // ore di lavorazione
};

const ALL: Required<SyncOptions> = {
  customer: true,
  production: true,
  description: true,
  hours: true,
};

export type SyncResult = {
  machineId: string;
  code: string;
  found: boolean; // almeno una commessa trovata nel gestionale
  changed: string[]; // elenco campi aggiornati
  erp: ErpMachineData;
};

export async function syncMachine(
  machineId: string,
  options: SyncOptions = ALL,
): Promise<SyncResult> {
  const opt = { ...ALL, ...options };

  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
    select: {
      id: true,
      code: true,
      job: true,
      jobBody: true,
      jobContainer: true,
      erpBodyOrder: true,
      erpContainerOrder: true,
      erpStandOrder: true,
      erpBladesOrder: true,
    },
  });
  if (!machine) throw new Error("Macchina non trovata");

  const erp = await getMachineErpData({
    job: machine.job,
    jobBody: machine.jobBody,
    jobContainer: machine.jobContainer,
    bodyOrder: machine.erpBodyOrder,
    containerOrder: machine.erpContainerOrder,
    standOrder: machine.erpStandOrder,
    bladesOrder: machine.erpBladesOrder,
  });

  const found = erp.jobs.some((j) => j.found);
  const changed: string[] = [];
  const data: Record<string, unknown> = {};

  if (found) {
    // Cliente + paese
    if (opt.customer && erp.customer) {
      data.customer = erp.customer;
      changed.push("cliente");
      const raw = erp.customerCountryIso || erp.customerCountryName;
      const resolved = resolveCountry(raw);
      // aggiorna il paese solo se riconosciuto (evita codici "XX")
      if (raw && resolved.code !== "XX") {
        data.country = resolved.label;
        data.countryCode = resolved.code;
        changed.push("paese");
      }
    }

    // Descrizione commessa
    if (opt.description && erp.description) {
      data.erpDescription = erp.description;
      changed.push("descrizione");
    }

    // Ore di lavorazione
    if (opt.hours && erp.totalHours > 0) {
      data.erpHours = Math.round(erp.totalHours * 100) / 100;
      changed.push("ore");
    }

    // Inizio produzione (campo fascicolo)
    if (opt.production && erp.productionStart) {
      data.productionStart = erp.productionStart;
    }

    // Marca sempre la data di sync se almeno una commessa è stata trovata
    data.erpSyncedAt = new Date();
    await prisma.machine.update({ where: { id: machine.id }, data });

    // Milestone produzione (diario), con origine GESTIONALE
    if (opt.production) {
      if (erp.productionStart) {
        await upsertMilestone(machine.id, "production_start", erp.productionStart);
        changed.push("inizio produzione");
      }
      if (erp.productionEnd) {
        await upsertMilestone(machine.id, "production_end", erp.productionEnd);
        changed.push("fine produzione");
      }
    }
  }

  return { machineId: machine.id, code: machine.code, found, changed, erp };
}

async function upsertMilestone(machineId: string, key: string, date: Date) {
  await prisma.machineMilestone.upsert({
    where: { machineId_key: { machineId, key } },
    update: { date, source: "GESTIONALE" },
    create: { machineId, key, date, source: "GESTIONALE" },
  });
}

/**
 * Sincronizza tutte le macchine. Ritorna un riepilogo.
 * `onProgress` opzionale per log incrementale (CLI).
 */
export async function syncAllMachines(
  options: SyncOptions = ALL,
  onProgress?: (done: number, total: number, last: SyncResult) => void,
): Promise<{
  total: number;
  matched: number;
  updated: number;
  withProduction: number;
  errors: { code: string; error: string }[];
}> {
  const machines = await prisma.machine.findMany({ select: { id: true, code: true } });
  let matched = 0;
  let updated = 0;
  let withProduction = 0;
  const errors: { code: string; error: string }[] = [];

  let done = 0;
  for (const m of machines) {
    try {
      const r = await syncMachine(m.id, options);
      if (r.found) matched++;
      if (r.changed.length > 0) updated++;
      if (r.erp.hasProduction) withProduction++;
      done++;
      onProgress?.(done, machines.length, r);
    } catch (e) {
      done++;
      errors.push({ code: m.code, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { total: machines.length, matched, updated, withProduction, errors };
}
