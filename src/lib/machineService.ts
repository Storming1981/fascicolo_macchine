import { prisma } from "./db";
import { COMPONENT_GROUPS } from "./components";
import { machineCode } from "./excel";
import { Prisma } from "@prisma/client";
import type { MachineStatus } from "@prisma/client";

export type ComponentInput = {
  groupId: string;
  brand?: string | null;
  items: { position: number; label: string; serial?: string | null }[];
  extra?: Record<string, string> | null;
};

export type CreateMachineInput = {
  job: string;
  jobBody?: string | null;
  jobContainer?: string | null;
  year: number;
  plantType?: string | null;
  model: string;
  customer: string;
  /** Anagrafica cliente (Customer.id). Se assente si tenta il match per nome. */
  customerId?: string | null;
  country: string;
  countryCode: string;
  site?: string | null;
  status?: MachineStatus;
  progress?: number;
  productionStart?: Date | null;
  deliveryDate?: Date | null;
  pressureSettings?: string | null;
  plateWeight?: string | null;
  platePower?: string | null;
  plateVoltage?: string | null;
  components?: ComponentInput[];
};

/** Genera il prossimo codice fascicolo M-AAAA-NNNN per l'anno indicato. */
export async function nextMachineCode(year: number): Promise<string> {
  const count = await prisma.machine.count({ where: { year } });
  let seq = count + 1;
  // garantisce univocità anche con buchi/import multipli
  for (let i = 0; i < 9999; i++) {
    const code = machineCode(year, seq);
    const exists = await prisma.machine.findUnique({ where: { code } });
    if (!exists) return code;
    seq++;
  }
  return machineCode(year, Date.now() % 10000);
}

/**
 * Risolve il collegamento all'anagrafica clienti di un fascicolo.
 * Se `customerId` è valorizzato lo verifica e restituisce nome/paese ufficiali
 * del Customer (l'anagrafica è la fonte di verità); altrimenti prova il match
 * per nome (case-insensitive) così anche l'import massivo aggancia i clienti
 * già censiti. Ritorna `null` in `id` se non c'è corrispondenza.
 */
export async function resolveCustomerLink(input: {
  customerId?: string | null;
  customer?: string | null;
}): Promise<{ id: string | null; name: string | null; country: string | null; countryCode: string | null }> {
  const none = { id: null, name: null, country: null, countryCode: null };
  if (input.customerId) {
    const c = await prisma.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true, name: true, country: true, countryCode: true },
    });
    if (c) return c;
  }
  const name = (input.customer ?? "").trim();
  if (!name) return none;
  const byName = await prisma.customer.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true, country: true, countryCode: true },
  });
  return byName ?? none;
}

export async function createMachine(input: CreateMachineInput, authorName = "Sistema", authorId?: string) {
  const code = await nextMachineCode(input.year);
  const link = await resolveCustomerLink(input);
  const customerName = link.name ?? input.customer;
  const machine = await prisma.machine.create({
    data: {
      code,
      job: input.job,
      jobBody: input.jobBody || input.job,
      jobContainer: input.jobContainer || null,
      year: input.year,
      plantType: input.plantType || null,
      model: input.model,
      customer: customerName,
      customerId: link.id,
      country: input.country,
      countryCode: input.countryCode,
      site: input.site || null,
      status: input.status || "PRODUCTION",
      progress: input.progress ?? 0,
      productionStart: input.productionStart || new Date(),
      deliveryDate: input.deliveryDate || null,
      pressureSettings: input.pressureSettings || null,
      plateWeight: input.plateWeight || null,
      platePower: input.platePower || null,
      plateVoltage: input.plateVoltage || null,
      components: {
        create: (input.components && input.components.length
          ? input.components
          : COMPONENT_GROUPS.map<ComponentInput>((g) => ({
              groupId: g.id,
              items: g.slots.map((label, position) => ({ position, label })),
            }))
        ).map((c) => {
          const group = COMPONENT_GROUPS.find((g) => g.id === c.groupId);
          const items: ComponentInput["items"] =
            c.items && c.items.length
              ? c.items
              : (group?.slots || []).map((label, position) => ({ position, label }));
          return {
            groupId: c.groupId,
            brand: c.brand || null,
            extra: (c.extra as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            items: {
              create: items.map((it) => ({
                position: it.position,
                label: it.label,
                serial: it.serial || null,
              })),
            },
          };
        }),
      },
      diaryEvents: {
        create: {
          phase: "PRODUCTION",
          type: "milestone",
          title: "Apertura fascicolo tecnico",
          note: `Fascicolo creato per job ${input.job} — ${customerName}.`,
          actorName: authorName,
          authorId: authorId || null,
        },
      },
    },
  });
  return machine;
}
