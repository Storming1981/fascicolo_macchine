"use client";
import { useState } from "react";
import Icon from "@/components/Icon";
import BrainChat from "@/components/BrainChat";
import KnowledgeList, { RecurringIssuesPanel, type ArticleRow } from "./KnowledgeList";
import SourcesPanel from "./SourcesPanel";
import GlossaryPanel from "./GlossaryPanel";

/**
 * Knowledge ZATO — il "cervello" aziendale.
 *
 * Cinque schede, in ordine di uso quotidiano: si chiede al Brain, e le altre
 * schede servono a nutrirlo (documenti, dizionario, articoli) e a leggere cosa
 * il campo sta segnalando (problematiche ricorrenti).
 */

type Tab = "brain" | "fonti" | "dizionario" | "articoli" | "problemi";

const TABS: { key: Tab; label: string; icon: string; hint: string }[] = [
  { key: "brain", label: "Chiedi al Brain", icon: "boost", hint: "Assistente tecnico su tutta la documentazione" },
  { key: "fonti", label: "Documenti", icon: "doc", hint: "Manuali, procedure, disegni e video indicizzati" },
  { key: "dizionario", label: "Dizionario", icon: "table", hint: "Gergo di cantiere e termini tecnici" },
  { key: "articoli", label: "Articoli", icon: "pin", hint: "Know-how scritto internamente" },
  { key: "problemi", label: "Problematiche", icon: "flag", hint: "Cosa si ripete in cantiere" },
];

export default function KnowledgeHome({
  articles,
  canManage,
  canAsk,
  brainConfigured,
  counts,
}: {
  articles: ArticleRow[];
  canManage: boolean;
  canAsk: boolean;
  brainConfigured: boolean;
  counts: { sources: number; chunks: number; terms: number };
}) {
  const [tab, setTab] = useState<Tab>(canAsk ? "brain" : "fonti");
  const visible = TABS.filter((t) => t.key !== "brain" || canAsk);
  const active = TABS.find((t) => t.key === tab);

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Knowledge ZATO</h1>
          <p>{active?.hint ?? "Il sapere tecnico ZATO, cercabile e interrogabile"}</p>
        </div>
        <div className="kb-head-stats">
          <span>
            <strong>{counts.sources}</strong> fonti
          </span>
          <span>
            <strong>{counts.chunks.toLocaleString("it-IT")}</strong> frammenti
          </span>
          <span>
            <strong>{counts.terms}</strong> termini
          </span>
        </div>
      </div>

      <div className="kb-tabs">
        {visible.map((t) => (
          <button
            key={t.key}
            className={"kb-tab" + (tab === t.key ? " active" : "")}
            onClick={() => setTab(t.key)}
          >
            <Icon name={t.icon} size={15} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "brain" && canAsk && <BrainChat configured={brainConfigured} />}
      {tab === "fonti" && <SourcesPanel canManage={canManage} />}
      {tab === "dizionario" && <GlossaryPanel canManage={canManage} />}
      {tab === "articoli" && <KnowledgeList articles={articles} canManage={canManage} />}
      {tab === "problemi" && <RecurringIssuesPanel canManage={canManage} />}
    </div>
  );
}
