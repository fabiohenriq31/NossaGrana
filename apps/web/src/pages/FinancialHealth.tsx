import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HeartPulse, RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import type { HealthResponse } from "../../../../packages/shared/src/health";
import type { Overview } from "../../../../packages/shared/src/types";
import { api } from "@/lib/api";
import { money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  ChartCard,
  EmptyState,
  LoadingSkeleton,
  MonthSelector,
} from "@/components/common";
import {
  HealthSettingsForm,
  GoalForm,
  ContributionForm,
  MonthlyGoalForm,
  PlanForm,
  type HealthModal,
} from "@/components/HealthForms";
import {
  HealthMetrics,
  ReservePanel,
  GoalsPanel,
  MonthlyGoalsPanel,
  PlanPanel,
  TipsPanel,
  ClassificationPanel,
  HistoryPanel,
  CommitmentsPanel,
  ReviewPanel,
  ContributionsPanel,
  nullableMoney,
} from "@/components/HealthPanels";
import "@/styles/health.css";

const tabs = {
  overview: "Visão do mês",
  reserve: "Reserva",
  tips: "Dicas para você",
  goals: "Objetivos",
  plan: "Plano Coflu",
  monthly: "Metas do mês",
  history: "Evolução",
  reviews: "Fechamentos",
};
type Tab = keyof typeof tabs;
export default function FinancialHealthPage({
  month,
  setMonth,
  data,
  onNew,
}: {
  month: string;
  setMonth: (month: string) => void;
  data: Overview;
  onNew: () => void;
}) {
  const [health, setHealth] = useState<HealthResponse | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview"),
    [modal, setModal] = useState<HealthModal>(null),
    [revision, setRevision] = useState(0);
  const offeredOnboarding = useRef(false);
  const navigate = useNavigate();
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<HealthResponse>("/financial-health/" + month, {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setHealth(result);
        if (!offeredOnboarding.current) {
          offeredOnboarding.current = true;
          if (!result.settings.onboarded)
            setModal({ kind: "settings", onboarding: true });
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [month, revision, data]);
  async function mutate(path: string, body: unknown, method = "PATCH") {
    try {
      await api(path, { method, body: JSON.stringify(body) });
      refresh();
      toast.success("Alteração salva.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  function done(createGoal?: boolean) {
    setModal(createGoal ? { kind: "goal" } : null);
    refresh();
  }
  function navigateSection(href: string) {
    const map: Record<string, Tab> = {
      "#reserva": "reserve",
      "#objetivos": "goals",
      "#compromissos": "overview",
      "#evolucao": "history",
    };
    if (href in map) {
      setTab(map[href]);
      if (href === "#compromissos")
        requestAnimationFrame(() =>
          document
            .getElementById("compromissos")
            ?.scrollIntoView({ block: "start", behavior: "smooth" }),
        );
    } else navigate(href);
  }
  if (!health && loading) return <LoadingSkeleton />;
  if (!health)
    return (
      <EmptyState
        text={error || "Não foi possível carregar a Saúde Financeira."}
        action={<Button onClick={refresh}>Tentar novamente</Button>}
      />
    );
  const s = health.snapshot;
  const actions = { health, edit: setModal, mutate };
  const modalTitle =
    modal?.kind === "settings"
      ? modal.onboarding
        ? "Seu primeiro passo no Coflu"
        : "Preferências e reserva"
      : modal?.kind === "goal"
        ? modal.goal
          ? "Editar objetivo e simular"
          : "O que você quer conquistar?"
        : modal?.kind === "contribution"
          ? "Registrar contribuição ou retirada"
          : modal?.kind === "monthly"
            ? "Revisar meta mensal"
            : "Organizar prioridade";
  return (
    <div className="financial-health" aria-busy={loading}>
      <div className="page-heading">
        <div>
          <h1>
            <HeartPulse size={25} aria-hidden /> Saúde Financeira
          </h1>
          <p>
            Veja como suas finanças evoluíram e escolha seus próximos passos.
          </p>
        </div>
        <div className="health-actions">
          <Button
            variant="outline"
            size="icon"
            aria-label="Atualizar saúde financeira"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={17} />
          </Button>
          <Button
            variant="outline"
            onClick={() => setModal({ kind: "settings" })}
          >
            <Settings2 size={17} />
            Preferências
          </Button>
        </div>
      </div>
      <div className="health-toolbar">
        <MonthSelector month={month} setMonth={setMonth} />
        <span className="health-badge">
          {s.dataQuality.status === "SUFFICIENT"
            ? "Dados suficientes"
            : s.dataQuality.status === "PARTIAL"
              ? "Dados parciais"
              : "Conhecendo sua rotina"}
        </span>
      </div>
      <nav className="health-tabs" aria-label="Seções de Saúde Financeira">
        {Object.entries(tabs).map(([key, label]) => (
          <Button
            key={key}
            variant={tab === key ? "default" : "ghost"}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => setTab(key as Tab)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {error && (
        <div className="health-note" role="alert">
          {error}{" "}
          <Button variant="outline" onClick={refresh}>
            Tentar novamente
          </Button>
        </div>
      )}
      {s.dataQuality.status !== "SUFFICIENT" && (
        <div className="health-note">
          <strong>{s.dataQuality.message}</strong>
          {s.dataQuality.status === "INSUFFICIENT" && (
            <Button variant="outline" size="sm" onClick={onNew}>
              Adicionar lançamento
            </Button>
          )}
        </div>
      )}
      {tab === "overview" && (
        <>
          <HealthMetrics snapshot={s} />
          <div className="health-grid">
            {s.indicators.map((i) => (
              <ChartCard key={i.label} title={i.label}>
                <span
                  className={"health-badge indicator-" + i.state.toLowerCase()}
                >
                  {i.state === "POSITIVE"
                    ? "Dentro da referência"
                    : i.state === "ATTENTION"
                      ? "Ponto de atenção"
                      : i.state === "CRITICAL"
                        ? "Requer revisão"
                        : "Em acompanhamento"}
                </span>
                <p className="muted">{i.reason}</p>
              </ChartCard>
            ))}
          </div>
          <ReservePanel {...actions} compact />
          <TipsPanel
            key={health.fingerprint}
            {...actions}
            navigateSection={navigateSection}
            compact
          />
          <div className="health-grid">
            <ChartCard title="Como suas despesas se distribuem">
              <dl className="health-details">
                {[
                  ["Essenciais", s.essentialExpenses],
                  ["Não essenciais", s.nonEssentialExpenses],
                  ["Ainda não classificadas", s.unclassifiedExpenses],
                  ["Fixas ou recorrentes", s.fixedExpenses],
                  ["Variáveis classificadas", s.variableExpenses],
                  ["Natureza não classificada", s.unclassifiedNatureExpenses],
                  ["Compras no cartão", s.creditCardExpenses],
                  ["Parcelas neste mês", s.installmentsCurrentMonth],
                  ["Juros e taxas classificados", s.interestAndFees],
                  ["Assinaturas identificadas", s.subscriptionExpenses],
                ].map(([label, amount]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{money(amount as number)}</dd>
                  </div>
                ))}
              </dl>
              <Button variant="outline" onClick={() => setTab("reserve")}>
                Revisar classificação
              </Button>
            </ChartCard>
            <ChartCard title="Capacidade e comparações">
              <p>
                Média disponível observada:{" "}
                <strong>{nullableMoney(s.savingsCapacity)}</strong>
              </p>
              <p className="muted">
                Resultado médio positivo não significa que o dinheiro foi
                separado. Consulte também os compromissos futuros e o conjunto
                dos seus objetivos.
              </p>
              {s.previousMonthComparison ? (
                <>
                  <p>
                    Diferença de despesas para o mês anterior:{" "}
                    {money(s.previousMonthComparison.expenses)}
                    {s.previousMonthComparison.expensesPercent !== null
                      ? " (" +
                        s.previousMonthComparison.expensesPercent.toLocaleString(
                          "pt-BR",
                        ) +
                        "%)"
                      : ""}
                    .
                  </p>
                  <p>
                    Variação do resultado:{" "}
                    {money(s.previousMonthComparison.result)}.
                  </p>
                </>
              ) : (
                <p>Comparações exigem dois meses completos.</p>
              )}
              {s.projection && (
                <details>
                  <summary>Estimativa para o fim do mês</summary>
                  <strong>{money(s.projection.result)}</strong>
                  <p className="muted">{s.projection.method}</p>
                </details>
              )}
            </ChartCard>
          </div>
          <div id="compromissos">
            <CommitmentsPanel snapshot={s} />
          </div>
          <details className="panel">
            <summary>Entenda a qualidade destes dados</summary>
            {s.dataQuality.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </details>
        </>
      )}
      {tab === "reserve" && (
        <>
          <ReservePanel {...actions} />
          <ContributionsPanel health={health} />
          <ClassificationPanel {...actions} />
        </>
      )}
      {tab === "tips" && (
        <TipsPanel
          key={health.fingerprint}
          {...actions}
          navigateSection={navigateSection}
        />
      )}
      {tab === "goals" && <GoalsPanel {...actions} />}
      {tab === "plan" && <PlanPanel {...actions} />}
      {tab === "monthly" && <MonthlyGoalsPanel {...actions} />}
      {tab === "history" && <HistoryPanel snapshot={s} />}
      {tab === "reviews" && (
        <ReviewPanel key={month} health={health} refresh={refresh} />
      )}
      <Dialog
        title={modalTitle}
        open={!!modal}
        onOpenChange={(v) => {
          if (!v) setModal(null);
        }}
        description="Você revisa e escolhe. Nenhuma movimentação bancária será realizada."
      >
        {modal?.kind === "settings" && (
          <HealthSettingsForm
            health={health}
            onboarding={modal.onboarding}
            done={done}
          />
        )}
        {modal?.kind === "goal" && (
          <GoalForm health={health} goal={modal.goal} done={done} />
        )}
        {modal?.kind === "contribution" && (
          <ContributionForm goal={modal.goal} done={done} />
        )}
        {modal?.kind === "monthly" && (
          <MonthlyGoalForm
            initial={modal.initial}
            candidate={modal.candidate}
            health={health}
            month={month}
            done={done}
          />
        )}
        {modal?.kind === "plan" && (
          <PlanForm initial={modal.initial} health={health} done={done} />
        )}
      </Dialog>
    </div>
  );
}
