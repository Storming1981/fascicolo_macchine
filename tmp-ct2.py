import io


def edit(p, pairs):
    s = io.open(p, encoding="utf-8", newline="").read()
    crlf = "\r\n" in s
    for a, b in pairs:
        A = a.replace("\n", "\r\n") if crlf else a
        B = b.replace("\n", "\r\n") if crlf else b
        assert s.count(A) == 1, (p, s.count(A), a[:70])
        s = s.replace(A, B)
    io.open(p, "w", encoding="utf-8", newline="").write(s)
    print("ok", p)


# ── Scheda: i sei tipi, raggruppati per alimentazione ───────────────────
edit(
    "src/components/AllestimentoSheets.tsx",
    [
        (
            """import {
  MATRICOLA_LABEL,""",
            """import {
  CONTAINER_TYPES,
  containerType,
  MATRICOLA_LABEL,""",
        ),
        (
            """            {def.typeOptions ? (
              <div className="al-choice">
                {def.typeOptions.map((o) => (
                  <button
                    key={o}
                    type="button"
                    disabled={disabled}
                    className={"al-choice-btn type" + (draft.header.tipo === o ? " active" : "")}
                    onClick={() => setHeader("tipo", o)}
                  >
                    {o === "CONTAINER E" ? "Elettrico · E" : o === "CONTAINER D" ? "Diesel · D" : o}
                  </button>
                ))}
              </div>
            ) : (""",
            """            {kind === "CONTAINER" ? (
              // Sei tipi in due famiglie: il mercato (E, E UL, E KOREA) e la
              // classe emissioni (Stage III, Tier IV, Stage V). La scheda da
              // compilare e' la stessa dentro ogni famiglia.
              <div className="al-type-groups">
                {(["Elettrico", "Diesel"] as const).map((g) => (
                  <div key={g} className="al-type-group">
                    <span className="al-type-group-label">{g}</span>
                    <div className="al-choice">
                      {CONTAINER_TYPES.filter(
                        (c) => c.group === g && (!c.legacy || draft.header.tipo === c.value)
                      ).map((c) => (
                        <button
                          key={c.value}
                          type="button"
                          disabled={disabled}
                          title={c.legacy ? "Valore storico: scegli la classe emissioni" : c.value}
                          className={"al-choice-btn type" + (draft.header.tipo === c.value ? " active" : "")}
                          onClick={() => setHeader("tipo", c.value)}
                        >
                          {c.short}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : def.typeOptions ? (
              <div className="al-choice">
                {def.typeOptions.map((o) => (
                  <button
                    key={o}
                    type="button"
                    disabled={disabled}
                    className={"al-choice-btn type" + (draft.header.tipo === o ? " active" : "")}
                    onClick={() => setHeader("tipo", o)}
                  >
                    {o}
                  </button>
                ))}
              </div>
            ) : (""",
        ),
    ],
)

# ── Elenco macchine: colonna + colore di riga ──────────────────────────
edit(
    "src/app/(app)/macchine/page.tsx",
    [
        (
            """import { progressForMachines } from "@/lib/progressService";""",
            """import { progressForMachines } from "@/lib/progressService";
import { defaultTipo } from "@/lib/allestimento";""",
        ),
        (
            """  const progress = await progressForMachines(machines);""",
            """  const progress = await progressForMachines(machines);
  // Tipo container (E, E UL, Stage V…): sta nell'intestazione della scheda
  // M5.17, una query sola per tutta la pagina.
  const sheets = await prisma.allestimentoSheet.findMany({
    where: { kind: "CONTAINER", machineId: { in: machines.map((m) => m.id) } },
    select: { machineId: true, header: true },
  });
  const tipoByMachine = new Map(
    sheets.map((s) => [s.machineId, ((s.header as { tipo?: string } | null)?.tipo ?? "").trim()])
  );""",
        ),
        (
            """    progress: progress.get(m.id)?.percent ?? 0,""",
            """    progress: progress.get(m.id)?.percent ?? 0,
    // senza scheda il tipo non e' stato scelto: si mostra il default del
    // modello solo quando la scheda esiste, altrimenti sarebbe un dato inventato
    containerType: tipoByMachine.has(m.id)
      ? tipoByMachine.get(m.id) || defaultTipo("CONTAINER", m.model)
      : null,""",
        ),
    ],
)

edit(
    "src/app/(app)/macchine/MachinesList.tsx",
    [
        (
            """import { hasKit, KITS } from "@/lib/kits";""",
            """import { hasKit, KITS } from "@/lib/kits";
import { containerType } from "@/lib/allestimento";""",
        ),
        (
            """  tiranteGiunto: boolean;
  filtroMaggiorato: boolean;""",
            """  tiranteGiunto: boolean;
  filtroMaggiorato: boolean;
  /** Tipo container dalla scheda M5.17 (null = scheda non ancora compilata). */
  containerType: string | null;""",
        ),
        (
            """                <th>Modello</th>""",
            """                <th>Modello</th>
                <th title="Tipo container dalla scheda di allestimento M5.17">Tipo container</th>""",
        ),
        (
            """                  <td>{m.model}</td>""",
            """                  <td>{m.model}</td>
                  <td>
                    {ct ? (
                      <span className="ctype-badge" style={{ background: `${ct.color}1a`, color: ct.color }}>
                        {ct.short}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>""",
        ),
        (
            """                <tr
                  key={m.id}
                  className="clickable"
                  onClick={() => router.push(`/macchine/${m.code}`)}
                >""",
            """                <tr
                  key={m.id}
                  className="clickable"
                  // Colore di riga per tipo container: serve a distinguerli a
                  // colpo d'occhio in un elenco di 195 fascicoli quasi uguali.
                  style={ct ? { borderLeft: `4px solid ${ct.color}`, background: `${ct.color}0d` } : undefined}
                  onClick={() => router.push(`/macchine/${m.code}`)}
                >""",
        ),
        (
            """              {filtered.map((m) => (""",
            """              {filtered.map((m) => {
                const ct = containerType(m.containerType);
                return (""",
        ),
        (
            """                </tr>
              ))}
            </tbody>""",
            """                </tr>
                );
              })}
            </tbody>""",
        ),
    ],
)
