import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import Icon, { Flag } from "@/components/Icon";
import { STATUS_META } from "@/lib/domain";

export const dynamic = "force-dynamic";

export default async function CampoMacchinePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const canMachine =
    (await userCan(user.role, "machine.intervention")) || (await userCan(user.role, "machine.edit"));
  if (!canMachine) redirect("/campo/interventi");
  const canCreate = await userCan(user.role, "machine.create");

  const q = (await searchParams).q?.trim() ?? "";
  const machines = await prisma.machine.findMany({
    where: q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { job: { contains: q, mode: "insensitive" } },
            { customer: { contains: q, mode: "insensitive" } },
            { model: { contains: q, mode: "insensitive" } },
            { components: { some: { items: { some: { serial: { contains: q, mode: "insensitive" } } } } } },
          ],
        }
      : {},
    // senza ricerca: elenco recente per selezione rapida
    orderBy: q ? { code: "asc" } : { createdAt: "desc" },
    take: q ? 40 : 25,
    select: {
      code: true,
      job: true,
      model: true,
      customer: true,
      country: true,
      countryCode: true,
      status: true,
    },
  });

  return (
    <div className="campo-view">
      <div className="campo-head campo-head-row">
        <div>
          <h1>Fascicolo macchina</h1>
          <p>{q ? `Risultati per «${q}»` : "Macchine recenti · cerca per job/matricola"}</p>
        </div>
        {canCreate && (
          <Link href="/campo/macchine/nuova" className="btn-primary-sm">
            <Icon name="plus" size={14} /> Nuova
          </Link>
        )}
      </div>

      <form className="campo-search" action="/campo/macchine" method="GET">
        <Icon name="search" size={16} color="var(--muted)" />
        <input name="q" defaultValue={q} placeholder="Job, matricola, cliente…" />
      </form>

      {machines.length === 0 ? (
        <div className="campo-empty">
          {q ? `Nessuna macchina trovata per «${q}».` : "Nessuna macchina."}
        </div>
      ) : (
        <div className="campo-cards">
          {machines.map((m) => {
            const st = STATUS_META[m.status];
            return (
              <Link key={m.code} href={`/campo/macchine/${encodeURIComponent(m.code)}`} className="campo-card">
                <div className="campo-card-top">
                  <span className="mono muted">{m.code}</span>
                  <span className="status-chip" style={{ background: st.color + "22", color: st.color }}>
                    {st.label}
                  </span>
                </div>
                <div className="campo-card-title">
                  Job <span className="mono">{m.job}</span> · {m.model}
                </div>
                <div className="campo-card-meta">
                  <span>
                    <Flag code={m.countryCode} /> {m.customer} — {m.country}
                  </span>
                </div>
                <div className="campo-card-foot">
                  <span className="muted small">Apri fascicolo</span>
                  <Icon name="chev-right" size={18} color="var(--muted)" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
