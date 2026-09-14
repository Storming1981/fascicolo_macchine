import QRCode from "qrcode";
import { prisma } from "./db";
import { currentUser } from "./auth";
import { ROLE_LABEL } from "./domain";
import { userCaps } from "./caps";
import { getPlantConfig } from "./settings";
import { COMPONENT_GROUPS } from "./components";
import { resolveMilestones } from "./milestoneAuto";

/**
 * Carica tutte le props della scheda fascicolo macchina. Condiviso tra guscio
 * desktop e app Campo (fascicolo). Ritorna null se la macchina non esiste.
 */
export async function loadMachineDetailProps(code: string) {
  const machine = await prisma.machine.findUnique({
    where: { code: decodeURIComponent(code) },
    include: {
      components: { include: { items: { orderBy: { position: "asc" } } } },
      diaryEvents: {
        orderBy: { date: "asc" },
        include: { photos: { where: { deletedAt: null } }, signature: true },
      },
      photos: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: {
          componentItem: { select: { label: true, component: { select: { groupId: true, label: true } } } },
          intervento: { select: { code: true, title: true } },
          diaryEvent: { select: { title: true, date: true } },
        },
      },
      documents: { orderBy: { uploadedAt: "desc" } },
      signatures: true,
      milestones: true,
      collaudo: true,
      machineNotes: {
        orderBy: { createdAt: "desc" },
        include: { revisions: { orderBy: { editedAt: "desc" } } },
      },
    },
  });
  if (!machine) return null;

  const user = await currentUser();
  const caps = await userCaps(
    "machine.edit",
    "machine.intervention",
    "machine.sign",
    "service.view",
    "intervento.create",
    "chat.send",
    "customer.manage"
  );
  // tipologie/modelli configurabili: servono alla modifica dell'anagrafica
  const plantConfig = await getPlantConfig();

  const [serviceInterventi, serviceChats] = await Promise.all([
    prisma.intervento.findMany({
      where: { machineId: machine.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, code: true, title: true, status: true, priority: true },
    }),
    prisma.conversation.findMany({
      where: { machineId: machine.id },
      orderBy: [{ lastMessageAt: "desc" }],
      select: { id: true, title: true, channel: true, contactName: true, _count: { select: { messages: true } } },
    }),
  ]);
  const qrDataUrl = await QRCode.toDataURL(
    `https://fascicolo.zato.it/macchine/${machine.code}`,
    { margin: 1, width: 280, color: { dark: "#0f3b66", light: "#ffffff" } }
  );

  const milestones = await resolveMilestones({ id: machine.id, job: machine.job }, machine.milestones);

  const data = {
    id: machine.id,
    code: machine.code,
    job: machine.job,
    jobBody: machine.jobBody,
    jobContainer: machine.jobContainer,
    erpBodyOrder: machine.erpBodyOrder,
    erpContainerOrder: machine.erpContainerOrder,
    erpStandOrder: machine.erpStandOrder,
    erpBladesOrder: machine.erpBladesOrder,
    erpDescription: machine.erpDescription,
    erpHours: machine.erpHours,
    erpSyncedAt: machine.erpSyncedAt?.toISOString() ?? null,
    plantType: machine.plantType,
    model: machine.model,
    year: machine.year,
    customer: machine.customer,
    customerId: machine.customerId,
    country: machine.country,
    countryCode: machine.countryCode,
    site: machine.site,
    status: machine.status,
    progress: machine.progress,
    productionStart: machine.productionStart?.toISOString() ?? null,
    deliveryDate: machine.deliveryDate?.toISOString() ?? null,
    pressureSettings: machine.pressureSettings,
    tiranteGiunto: machine.tiranteGiunto,
    plateWeight: machine.plateWeight,
    platePower: machine.platePower,
    plateVoltage: machine.plateVoltage,
    notes: machine.notes,
    components: machine.components.map((c) => ({
      id: c.id,
      groupId: c.groupId,
      label: c.label,
      brand: c.brand,
      extra: (c.extra as Record<string, string> | null) || null,
      items: c.items.map((i) => ({
        id: i.id,
        position: i.position,
        label: i.label,
        serial: i.serial,
        note: i.note,
      })),
    })),
    diary: machine.diaryEvents.map((e) => ({
      id: e.id,
      phase: e.phase,
      type: e.type,
      title: e.title,
      note: e.note,
      date: e.date.toISOString(),
      actorName: e.actorName,
      oldSerial: e.oldSerial,
      newSerial: e.newSerial,
      signed: !!e.signature,
      photos: e.photos.map((p) => ({ id: p.id, path: p.path, caption: p.caption })),
    })),
    photos: machine.photos.map((p) => {
      const comp = p.componentItem?.component;
      const groupLabel = comp
        ? COMPONENT_GROUPS.find((g) => g.id === comp.groupId)?.label ?? comp.label ?? "Componente"
        : null;
      return {
        id: p.id,
        path: p.path,
        category: p.category,
        caption: p.caption,
        authorId: p.authorId,
        authorName: p.authorName,
        takenAt: p.takenAt.toISOString(),
        componentItemId: p.componentItemId,
        componentLabel: p.componentItem ? `${groupLabel} — ${p.componentItem.label}` : null,
        interventoId: p.interventoId,
        interventoCode: p.intervento?.code ?? null,
        interventoTitle: p.intervento?.title ?? null,
        diaryEventId: p.diaryEventId,
        diaryTitle: p.diaryEvent?.title ?? null,
        diaryDate: p.diaryEvent?.date.toISOString() ?? null,
      };
    }),
    documents: machine.documents.map((d) => ({
      id: d.id,
      name: d.name,
      path: d.path,
      sizeBytes: d.sizeBytes,
      category: d.category,
    })),
    signatures: machine.signatures
      .filter((s) => !s.diaryEventId)
      .map((s) => ({
        id: s.id,
        role: s.role,
        signerName: s.signerName,
        method: s.method,
        imageData: s.imageData,
        signedAt: s.signedAt.toISOString(),
      })),
    notesLog: machine.machineNotes.map((n) => ({
      id: n.id,
      text: n.text,
      authorId: n.authorId,
      authorName: n.authorName,
      createdAt: n.createdAt.toISOString(),
      editedByName: n.editedByName,
      editedAt: n.editedAt?.toISOString() ?? null,
      deletedAt: n.deletedAt?.toISOString() ?? null,
      deletedByName: n.deletedByName,
      revisions: n.revisions.map((r) => ({
        id: r.id,
        text: r.text,
        editedByName: r.editedByName,
        editedAt: r.editedAt.toISOString(),
      })),
    })),
    milestones: milestones.map((m) => ({
      key: m.key,
      date: m.date.toISOString(),
      source: m.source,
      detail: m.detail,
    })),
    collaudo: machine.collaudo
      ? {
          status: machine.collaudo.status,
          answers: (machine.collaudo.answers as Record<string, { value: string | null; note?: string }>) || {},
          compilerName: machine.collaudo.compilerName,
          compiledAt: machine.collaudo.compiledAt?.toISOString() || null,
          compilerSignature: machine.collaudo.compilerSignature,
          approverName: machine.collaudo.approverName,
          approvedAt: machine.collaudo.approvedAt?.toISOString() || null,
          approverSignature: machine.collaudo.approverSignature,
          approverRemarks: machine.collaudo.approverRemarks,
          compilerId: machine.collaudo.compilerId,
        }
      : null,
  };

  return {
    machine: data,
    plantConfig,
    qrDataUrl,
    service: {
      interventi: serviceInterventi,
      chats: serviceChats.map((c) => ({
        id: c.id,
        title: c.title,
        channel: c.channel,
        contactName: c.contactName,
        messages: c._count.messages,
      })),
    },
    currentUser: {
      id: user!.id,
      name: user!.name,
      role: ROLE_LABEL[user!.role],
      hasPin: !!user!.pinHash,
      hasSignature: !!user!.signatureImage,
    },
    caps: {
      edit: caps["machine.edit"],
      intervention: caps["machine.intervention"],
      sign: caps["machine.sign"],
      service: caps["service.view"],
      interventoCreate: caps["intervento.create"],
      chatSend: caps["chat.send"],
      customerManage: caps["customer.manage"],
    },
  };
}
