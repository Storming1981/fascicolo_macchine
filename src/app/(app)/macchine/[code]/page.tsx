import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/domain";
import { userCaps } from "@/lib/caps";
import MachineDetail from "./MachineDetail";

export const dynamic = "force-dynamic";

export default async function MachinePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const machine = await prisma.machine.findUnique({
    where: { code: decodeURIComponent(code) },
    include: {
      components: { include: { items: { orderBy: { position: "asc" } } } },
      diaryEvents: { orderBy: { date: "asc" }, include: { photos: true, signature: true } },
      photos: { orderBy: { createdAt: "desc" } },
      documents: { orderBy: { uploadedAt: "desc" } },
      signatures: true,
      milestones: true,
      collaudo: true,
    },
  });
  if (!machine) notFound();

  const user = await currentUser();
  const caps = await userCaps(
    "machine.edit",
    "machine.intervention",
    "machine.sign",
    "service.view",
    "intervento.create",
    "chat.send"
  );

  // Dati del modulo Service collegati a questo fascicolo
  const [serviceInterventi, serviceChats] = await Promise.all([
    prisma.intervento.findMany({
      where: { machineId: machine.id },
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

  // Serializza date in stringhe per il client
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
    plateWeight: machine.plateWeight,
    platePower: machine.platePower,
    plateVoltage: machine.plateVoltage,
    notes: machine.notes,
    components: machine.components.map((c) => ({
      id: c.id,
      groupId: c.groupId,
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
    photos: machine.photos.map((p) => ({
      id: p.id,
      path: p.path,
      category: p.category,
      caption: p.caption,
      authorName: p.authorName,
      takenAt: p.takenAt.toISOString(),
    })),
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
    milestones: machine.milestones.map((m) => ({
      key: m.key,
      date: m.date.toISOString(),
      source: m.source,
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

  return (
    <MachineDetail
      machine={data}
      qrDataUrl={qrDataUrl}
      service={{
        interventi: serviceInterventi,
        chats: serviceChats.map((c) => ({
          id: c.id,
          title: c.title,
          channel: c.channel,
          contactName: c.contactName,
          messages: c._count.messages,
        })),
      }}
      currentUser={{
        id: user!.id,
        name: user!.name,
        role: ROLE_LABEL[user!.role],
        hasPin: !!user!.pinHash,
        hasSignature: !!user!.signatureImage,
      }}
      caps={{
        edit: caps["machine.edit"],
        intervention: caps["machine.intervention"],
        sign: caps["machine.sign"],
        service: caps["service.view"],
        interventoCreate: caps["intervento.create"],
        chatSend: caps["chat.send"],
      }}
    />
  );
}
