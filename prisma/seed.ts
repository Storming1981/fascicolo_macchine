import { PrismaClient, MachineStatus, DiaryPhase, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { COMPONENT_GROUPS } from "../src/lib/components";

const prisma = new PrismaClient();

type Cmp = { brand?: string; items: (string | null)[]; extra?: Record<string, string> };
type Seed = {
  code: string;
  job: string;
  jobBody?: string;
  jobContainer?: string;
  model: string;
  year: number;
  customer: string;
  country: string;
  countryCode: string;
  site: string;
  status: MachineStatus;
  progress: number;
  productionStart: string;
  deliveryDate: string;
  pressure: string;
  plate: { weight: string; power: string; voltage: string };
  components: Record<string, Cmp>;
  diary: {
    date: string;
    phase: DiaryPhase;
    type?: string;
    title: string;
    note?: string;
    actor: string;
    oldSerial?: string;
    newSerial?: string;
    signed?: boolean;
  }[];
};

const MACHINES: Seed[] = [
  {
    code: "M-2026-0142",
    job: "1260178",
    jobBody: "1260178",
    jobContainer: "5260341",
    model: "ZSR 2200 / Trituratore primario",
    year: 2026,
    customer: "NORD METAL RECYCLING",
    country: "Germania",
    countryCode: "DE",
    site: "Hannover, DE",
    status: "TESTING",
    progress: 78,
    productionStart: "2025-11-04",
    deliveryDate: "2026-06-12",
    pressure: "255 bar + 3/4 giro (320 bar)",
    plate: { weight: "38 500 kg", power: "450 kW", voltage: "400V / 50Hz" },
    components: {
      gearboxes: { brand: "DINAMIC OIL", items: ["43260112", "43260114", "43260115", "43260117"] },
      hyd_motors: { brand: "LINDE", items: ["HYX237P00821", "HYX237P00824", "HYX237P00822", "HYX237P00825"] },
      hyd_pumps: { brand: "LINDE", items: ["HYX222P00301", "HYX222P00305"], extra: { valves: "380 / 380" } },
      boost_pumps: { brand: "MARZOCCHI", items: ["115079220", "115079221", "115079218", "115079219"] },
      electric_motor: { brand: "SIMOTOP", items: ["T3C 355L4-4", "26S0124680"] },
      container: { brand: "IDROFOGLIA", items: ["C260041"] },
      hyd_unit: { brand: "MAGNUM", items: ["074"] },
      grease: { brand: "CIAPONI", items: ["076892"] },
      cabinet: { brand: "STEL", items: ["26/0114"] },
      hmi: { brand: "ESA", items: ["26-154-01044"] },
      dissipators: { brand: "SESINO", items: ["2606101", "2606102"] },
      remote: { brand: "IMET", items: ["2000094221", "2000084450", "2000094222", "2080126441"] },
      blades: { brand: "CODITRA", items: [], extra: { type: "Bimetallico HRC58", lot: "LT-26-0184" } },
    },
    diary: [
      { date: "2025-11-04", phase: "PRODUCTION", title: "Apertura cantiere produzione", actor: "Mario Rossi", note: "Job 1260178 aperto." },
      { date: "2025-12-03", phase: "PRODUCTION", title: "Montaggio gruppo idraulico", actor: "Aldo Verdi", note: "Pompe LINDE installate. Coppia di serraggio OK.", signed: true },
      { date: "2026-01-14", phase: "PRODUCTION", title: "Cablaggio quadro elettrico STEL", actor: "Paolo Costa", note: "Quadro 26/0114 installato. Test isolamento conforme.", signed: true },
      { date: "2026-03-22", phase: "TESTING", title: "Avvio collaudo a vuoto", actor: "Francesco Greco", note: "Pressione 255 bar nominali raggiunta.", signed: true },
      { date: "2026-04-05", phase: "TESTING", type: "replace", title: "Sostituzione pompa boost #3", actor: "Aldo Verdi", note: "Perdita su raccordo in rodaggio.", oldSerial: "115079218", newSerial: "115079218R", signed: true },
    ],
  },
  {
    code: "M-2026-0118",
    job: "1260100",
    model: "ZSR 1800 / Compatto",
    year: 2026,
    customer: "AHYRESA RECICLAJES",
    country: "Spagna",
    countryCode: "ES",
    site: "Bilbao, ES",
    status: "PRODUCTION",
    progress: 42,
    productionStart: "2026-01-15",
    deliveryDate: "2026-09-30",
    pressure: "240 bar + 1/2 giro (300 bar)",
    plate: { weight: "32 100 kg", power: "355 kW", voltage: "400V / 50Hz" },
    components: {
      gearboxes: { brand: "DINAMIC OIL", items: ["43260091", "43260092", "43260093", "43260094"] },
      hyd_motors: { brand: "LINDE", items: ["HYX237P00701", null, null, null] },
      hyd_pumps: { brand: "LINDE", items: ["HYX222P00280", null], extra: { valves: "380 / —" } },
    },
    diary: [
      { date: "2026-01-15", phase: "PRODUCTION", title: "Apertura cantiere produzione", actor: "Mario Rossi", note: "Job 1260100 — AHYRESA Spagna." },
      { date: "2026-03-19", phase: "PRODUCTION", title: "Avvio montaggio gruppo idraulico", actor: "Aldo Verdi", note: "Pompa LINDE HYX222P00280 in installazione." },
    ],
  },
  {
    code: "M-2025-0973",
    job: "1250515",
    model: "ZSR 2200 / Trituratore primario",
    year: 2025,
    customer: "ISLENKA",
    country: "Islanda",
    countryCode: "IS",
    site: "Reykjavík, IS",
    status: "MAINTENANCE",
    progress: 100,
    productionStart: "2025-02-10",
    deliveryDate: "2025-08-22",
    pressure: "250 bar + 3/4 giro (315 bar)",
    plate: { weight: "37 800 kg", power: "450 kW", voltage: "400V / 50Hz" },
    components: {
      gearboxes: { brand: "DINAMIC OIL", items: ["48250250", "48250251", "49250501", "48250252"] },
      hyd_motors: { brand: "LINDE", items: ["HYX237N00586", "HYX237P00100", "HYX237P00098", "HYX237P00101"] },
      container: { brand: "IDROFOGLIA", items: ["C250028"] },
      hmi: { brand: "ESA", items: ["25-154-00921"] },
      blades: { brand: "CODITRA", items: [], extra: { type: "Bimetallico HRC58", lot: "LT-26-0042" } },
    },
    diary: [
      { date: "2025-02-10", phase: "PRODUCTION", title: "Apertura cantiere", actor: "Mario Rossi" },
      { date: "2025-05-22", phase: "TESTING", title: "Collaudo positivo", actor: "Francesco Greco", note: "Verbale CL-2025-0091.", signed: true },
      { date: "2025-08-22", phase: "SHIPPED", title: "Spedizione Rotterdam → Reykjavík", actor: "Logistica" },
      { date: "2025-09-09", phase: "INSTALLED", title: "Installazione e avviamento", actor: "Davide Ferrari", note: "Formazione operatori cliente (4h).", signed: true },
      { date: "2026-03-02", phase: "MAINTENANCE", type: "replace", title: "Sostituzione lame CODITRA", actor: "Davide Ferrari", note: "Set esaurito a 4200h.", oldSerial: "LT-25-0091", newSerial: "LT-26-0042", signed: true },
    ],
  },
  {
    code: "M-2025-0884",
    job: "1250473",
    model: "ZSR 2200 / Trituratore primario",
    year: 2025,
    customer: "NORD SCHROTT",
    country: "Germania",
    countryCode: "DE",
    site: "Kiel, DE",
    status: "MAINTENANCE",
    progress: 100,
    productionStart: "2025-01-08",
    deliveryDate: "2025-06-04",
    pressure: "255 bar + 3/4 giro (320 bar)",
    plate: { weight: "38 200 kg", power: "450 kW", voltage: "400V / 50Hz" },
    components: {
      gearboxes: { brand: "DINAMIC OIL", items: ["13250169", "13250175", "13250173", "13250170"] },
      hmi: { brand: "ESA", items: ["25-154-00904R"] },
      cabinet: { brand: "STEL", items: ["25/0058"] },
    },
    diary: [
      { date: "2025-01-08", phase: "PRODUCTION", title: "Apertura cantiere", actor: "Mario Rossi" },
      { date: "2025-04-22", phase: "TESTING", title: "Collaudo OK", actor: "Francesco Greco", signed: true },
      { date: "2025-06-18", phase: "INSTALLED", title: "Installazione e avvio", actor: "Davide Ferrari", signed: true },
      { date: "2025-11-06", phase: "MAINTENANCE", type: "replace", title: "Sostituzione pannello HMI", actor: "Davide Ferrari", note: "Errore E-117. Sostituito in garanzia.", oldSerial: "25-154-00904", newSerial: "25-154-00904R", signed: true },
    ],
  },
  {
    code: "M-2025-0791",
    job: "1250294",
    model: "ZSR 2200 / Trituratore primario",
    year: 2025,
    customer: "KUUSAKOSKI",
    country: "Svezia",
    countryCode: "SE",
    site: "Göteborg, SE",
    status: "SHIPPED",
    progress: 92,
    productionStart: "2024-12-12",
    deliveryDate: "2025-07-18",
    pressure: "250 bar + 3/4 giro (315 bar)",
    plate: { weight: "37 900 kg", power: "450 kW", voltage: "400V / 50Hz" },
    components: {
      gearboxes: { brand: "DINAMIC OIL", items: ["09250116", "09250117", "09250123", "51240646"] },
      container: { brand: "IDROFOGLIA", items: ["C250012"] },
    },
    diary: [
      { date: "2024-12-12", phase: "PRODUCTION", title: "Apertura cantiere", actor: "Mario Rossi" },
      { date: "2025-04-30", phase: "TESTING", title: "Collaudo OK", actor: "Francesco Greco", signed: true },
      { date: "2025-07-18", phase: "SHIPPED", title: "Spedizione via Göteborg", actor: "Logistica" },
    ],
  },
  {
    code: "M-2020-0318",
    job: "1200008",
    jobBody: "20008",
    jobContainer: "20012",
    model: "ZSR 2200 / Trituratore primario",
    year: 2020,
    customer: "RVT GmbH",
    country: "Germania",
    countryCode: "DE",
    site: "Mannheim, DE",
    status: "SCRAPPED",
    progress: 100,
    productionStart: "2020-03-02",
    deliveryDate: "2020-09-15",
    pressure: "255 bar + 3/4 giro (320 bar)",
    plate: { weight: "37 600 kg", power: "420 kW", voltage: "400V / 50Hz" },
    components: {
      gearboxes: { brand: "DINAMIC OIL", items: ["43200006", "43200004", "43200007", "43200005"] },
      electric_motor: { brand: "SIEMENS", items: ["UC2004/266528201", "UC2004/266728455"] },
    },
    diary: [
      { date: "2020-03-02", phase: "PRODUCTION", title: "Apertura cantiere", actor: "Mario Rossi" },
      { date: "2020-08-10", phase: "TESTING", title: "Collaudo finale", actor: "Francesco Greco", signed: true },
      { date: "2020-10-02", phase: "INSTALLED", title: "Installazione", actor: "Davide Ferrari", signed: true },
      { date: "2022-05-14", phase: "MAINTENANCE", type: "replace", title: "Sostituzione motore elettrico", actor: "Davide Ferrari", note: "Avvolgimenti bruciati.", oldSerial: "UC2004/266528301", newSerial: "UC2004/266728455" },
      { date: "2025-12-19", phase: "SCRAPPED", title: "Dismissione e rottamazione", actor: "Davide Ferrari", note: "Fine vita. Verbale rottamazione VR-2025-0012.", signed: true },
    ],
  },
];

const USERS: { name: string; email: string; role: Role; pin?: string }[] = [
  { name: "Amministratore ZATO", email: "admin@zato.it", role: "ADMIN", pin: "0000" },
  { name: "Mario Rossi", email: "m.rossi@zato.it", role: "CAPO_OFFICINA", pin: "1111" },
  { name: "Aldo Verdi", email: "a.verdi@zato.it", role: "MONTATORE", pin: "2222" },
  { name: "Paolo Costa", email: "p.costa@zato.it", role: "CABLATORE", pin: "3333" },
  { name: "Giulio Marini", email: "g.marini@zato.it", role: "PROGRAMMATORE", pin: "4444" },
  { name: "Francesco Greco", email: "f.greco@zato.it", role: "COLLAUDATORE", pin: "5555" },
  { name: "Davide Ferrari", email: "d.ferrari@zato.it", role: "TECNICO_CAMPO", pin: "6666" },
];

async function main() {
  console.log("Seed: utenti…");
  const userMap = new Map<string, string>();
  for (const u of USERS) {
    const rec = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        name: u.name,
        email: u.email,
        role: u.role,
        passwordHash: await bcrypt.hash("zato2026", 10),
        pinHash: u.pin ? await bcrypt.hash(u.pin, 10) : null,
      },
    });
    userMap.set(u.name, rec.id);
  }

  console.log("Seed: macchine di esempio…");
  for (const m of MACHINES) {
    const existing = await prisma.machine.findUnique({ where: { code: m.code } });
    if (existing) {
      console.log(`  ${m.code} già presente, salto.`);
      continue;
    }
    await prisma.machine.create({
      data: {
        code: m.code,
        job: m.job,
        jobBody: m.jobBody || m.job,
        jobContainer: m.jobContainer || null,
        model: m.model,
        year: m.year,
        customer: m.customer,
        country: m.country,
        countryCode: m.countryCode,
        site: m.site,
        status: m.status,
        progress: m.progress,
        productionStart: new Date(m.productionStart),
        deliveryDate: new Date(m.deliveryDate),
        pressureSettings: m.pressure,
        plateWeight: m.plate.weight,
        platePower: m.plate.power,
        plateVoltage: m.plate.voltage,
        components: {
          create: COMPONENT_GROUPS.map((g) => {
            const c = m.components[g.id];
            return {
              groupId: g.id,
              brand: c?.brand || null,
              extra: c?.extra ? c.extra : undefined,
              items: {
                create: g.slots.map((label, position) => ({
                  position,
                  label,
                  serial: c?.items?.[position] || null,
                })),
              },
            };
          }),
        },
        diaryEvents: {
          create: m.diary.map((d) => ({
            phase: d.phase,
            type: d.type || "milestone",
            title: d.title,
            note: d.note || null,
            date: new Date(d.date),
            createdAt: new Date(d.date),
            actorName: d.actor,
            oldSerial: d.oldSerial || null,
            newSerial: d.newSerial || null,
            authorId: userMap.get(d.actor) || null,
          })),
        },
      },
    });

    // firma collaudo di esempio per macchine collaudate
    if (["SHIPPED", "INSTALLED", "MAINTENANCE", "SCRAPPED", "TESTING"].includes(m.status)) {
      const machine = await prisma.machine.findUnique({ where: { code: m.code } });
      if (machine && m.progress >= 75) {
        await prisma.signature.create({
          data: {
            machineId: machine.id,
            role: "Collaudo",
            signerName: "Francesco Greco",
            signerId: userMap.get("Francesco Greco") || null,
            method: "PIN",
            hash: "seed-" + machine.code,
          },
        });
        await prisma.signature.create({
          data: {
            machineId: machine.id,
            role: "Montaggio",
            signerName: "Aldo Verdi",
            signerId: userMap.get("Aldo Verdi") || null,
            method: "PIN",
            hash: "seed-mont-" + machine.code,
          },
        });
      }
    }
    console.log(`  creata ${m.code}`);
  }
  console.log("Seed completato. Login: admin@zato.it / zato2026 (tutti gli utenti: password zato2026).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
