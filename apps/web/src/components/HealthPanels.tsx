import { useState } from "react";
import {
  ArrowUp,
  ArrowDown,
  Plus,
  Pencil,
  Pause,
  Play,
  Target,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import type {
  FinancialSnapshot,
  HealthResponse,
  GoalView,
  RecommendationCandidate,
  CoachOutput,
} from "../../../../packages/shared/src/health";
import { api } from "@/lib/api";
import { money, monthLabel } from "@/lib/utils";
import { ChartCard, EmptyState } from "./common";
import { Button } from "./ui/button";
import {
  stateLabels,
  stageLabels,
  monthlyLabels,
  type HealthModal,
} from "./HealthForms";

type Actions = {
  health: HealthResponse;
  edit: (modal: HealthModal) => void;
  mutate: (path: string, body: unknown, method?: string) => Promise<void>;
};
export const nullableMoney = (value: number | null) =>
  value === null ? "Ainda não calculado" : money(value);
export function HealthProgress({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  return (
    <div
      className="health-progress"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
export function HealthMetrics({
  snapshot: s,
}: {
  snapshot: FinancialSnapshot;
}) {
  return (
    <div className="health-metrics">
      {[
        ["Entrou", money(s.income), "income"],
        ["Saiu", money(s.expenses), "expense"],
        [
          "Resultado",
          money(s.monthlyResult),
          s.monthlyResult < 0 ? "expense" : "income",
        ],
        [
          "Taxa de economia",
          s.savingsRate === null
            ? "Sem renda registrada"
            : s.savingsRate.toLocaleString("pt-BR") + "%",
          "",
        ],
      ].map(([label, value, color]) => (
        <ChartCard key={label} title={label}>
          <strong className={"health-number " + color}>{value}</strong>
        </ChartCard>
      ))}
    </div>
  );
}
export function ReservePanel({
  health,
  edit,
  compact = false,
}: Pick<Actions, "health" | "edit"> & { compact?: boolean }) {
  const r = health.snapshot.reserve;
  return (
    <ChartCard
      title="Reserva de emergência"
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={() => edit({ kind: "settings" })}
        >
          Configurar reserva
        </Button>
      }
      className="health-reserve"
    >
      <div className="health-reserve-heading">
        <ShieldCheck aria-hidden size={30} />
        <div>
          <small>Reserva atual declarada</small>
          <strong className="health-number">{money(r.amount)}</strong>
        </div>
        <div>
          <small>Despesas essenciais cobertas</small>
          <strong className="health-number">
            {r.coverageMonths === null
              ? "—"
              : r.coverageMonths.toLocaleString("pt-BR") + " meses"}
          </strong>
        </div>
      </div>
      {r.coverageMonths === null ? (
        <p className="health-note">
          Ainda precisamos conhecer melhor suas despesas essenciais para
          calcular sua cobertura de emergência. Você pode informar seu custo
          essencial mensal aproximado.
        </p>
      ) : (
        <p className="muted">
          Reserva de {money(r.amount)} ÷ custo essencial de{" "}
          {money(r.essentialMonthly!)} por mês. Base:{" "}
          {r.source === "USER_ESTIMATE"
            ? "estimativa informada por você"
            : "média dos meses completos e classificados"}
          .
        </p>
      )}
      {r.nextMilestoneMonths !== null && (
        <>
          <div className="health-between">
            <strong>Próximo marco: {r.nextMilestoneMonths} meses</strong>
            <span>{r.progressToMilestone?.toLocaleString("pt-BR")}%</span>
          </div>
          <HealthProgress
            value={r.progressToMilestone || 0}
            label="Progresso para o próximo marco"
          />
          <p>
            Faltam <strong>{nullableMoney(r.remainingToMilestone)}</strong> para{" "}
            {nullableMoney(r.nextMilestoneAmount)}.
          </p>
        </>
      )}
      <p>
        Meta escolhida:{" "}
        <strong>
          {r.targetIsCustom
            ? nullableMoney(r.targetAmount)
            : r.targetMonths + " meses"}
        </strong>
        {!r.targetIsCustom && " · " + nullableMoney(r.targetAmount)}.
        {r.remainingToTarget === 0
          ? " Meta atingida com os valores declarados."
          : ""}
      </p>
      {!compact && (
        <>
          <div className="health-milestones">
            {r.milestones.map((m) => (
              <div key={m.months} className={m.achieved ? "achieved" : ""}>
                <strong>
                  {m.months} {m.months === 1 ? "mês" : "meses"}
                </strong>
                <span>{nullableMoney(m.amount)}</span>
                <small>
                  {m.achieved
                    ? "Alcançado"
                    : m.months === 1
                      ? "Reserva inicial"
                      : m.months === 3
                        ? "Proteção básica"
                        : m.months === 6
                          ? "Proteção ampliada"
                          : "Referência adicional"}
                </small>
              </div>
            ))}
          </div>
          <p className="muted">
            Esses marcos são referências educacionais, não garantias. A escolha
            depende da sua realidade e pode ser personalizada.
          </p>
          {r.referenceChange !== null && r.referenceChange !== 0 && (
            <p className="health-note">
              Sua estimativa de despesas essenciais{" "}
              {r.referenceChange > 0 ? "aumentou" : "diminuiu"}. O valor
              correspondente à meta de {r.targetMonths} meses mudou em{" "}
              {money(Math.abs(r.referenceChange))} em relação à janela anterior.
            </p>
          )}
          {r.source === "USER_ESTIMATE" &&
            r.observedEssentialMonthly !== null && (
              <p className="health-note">
                O Coflu observou {money(r.observedEssentialMonthly)} por mês em
                despesas essenciais. Seu valor informado é{" "}
                {nullableMoney(r.essentialMonthly)}. Sua escolha foi preservada;
                use Configurar reserva se quiser revisar.
              </p>
            )}
        </>
      )}
      <div className="health-actions">
        <Button onClick={() => edit({ kind: "contribution" })}>
          <Plus size={16} />
          Registrar contribuição
        </Button>
      </div>
    </ChartCard>
  );
}
export function GoalsPanel({ health, edit, mutate }: Actions) {
  const [showArchived, setShowArchived] = useState(false);
  const goals = health.snapshot.financialGoals.filter(
    (g) => showArchived || g.status !== "CANCELLED",
  );
  const members = new Map(health.members.map((m) => [m.id, m.name]));
  return (
    <>
      <div className="health-between">
        <h2>Objetivos de vida</h2>
        <Button onClick={() => edit({ kind: "goal" })}>
          <Plus size={16} />
          Novo objetivo
        </Button>
      </div>
      <label className="health-check muted">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Mostrar cancelados
      </label>
      {!goals.length ? (
        <EmptyState
          text="O que você quer conquistar? Crie seu primeiro objetivo."
          action={
            <Button onClick={() => edit({ kind: "goal" })}>
              Criar objetivo
            </Button>
          }
        />
      ) : (
        <div className="health-grid">
          {goals.map((g) => (
            <ChartCard
              key={g.id}
              title={g.name}
              action={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={"Editar " + g.name}
                  onClick={() => edit({ kind: "goal", goal: g })}
                >
                  <Pencil size={16} />
                </Button>
              }
            >
              <p className="muted">
                <Target size={15} aria-hidden />{" "}
                {g.scope === "PERSONAL"
                  ? members.get(g.memberId!) || "Membro"
                  : "Objetivo da casa"}{" "}
                · {stateLabels[g.status]}
              </p>
              <p>
                <strong>{money(g.currentAmount)}</strong> /{" "}
                {money(g.targetAmount)}
              </p>
              <HealthProgress
                value={g.progress}
                label={"Progresso de " + g.name}
              />
              <p>
                {g.progress.toLocaleString("pt-BR")}% · faltam{" "}
                {money(g.remainingAmount)}
              </p>
              <p>
                {g.overdue
                  ? "Prazo vencido. Revise a data ou o valor desejado."
                  : g.monthlyRequired === null
                    ? "Revise o prazo."
                    : "Para atingir até " +
                      new Date(g.targetDate + "T12:00:00Z").toLocaleDateString(
                        "pt-BR",
                      ) +
                      ": " +
                      money(g.monthlyRequired) +
                      " por mês, sem considerar rendimentos."}
              </p>
              {g.capacityGap !== null && g.capacityGap > 0 && (
                <p className="health-note">
                  O aporte necessário supera sua média disponível em{" "}
                  {money(g.capacityGap)}. Experimente ampliar o prazo ou reduzir
                  o orçamento em Editar.
                </p>
              )}
              {health.snapshot.savingsCapacity === null && (
                <p className="muted">
                  Ainda não há histórico suficiente para comparar o aporte à sua
                  capacidade média.
                </p>
              )}
              <details>
                <summary>Ver contribuições e retiradas</summary>
                <ContributionsPanel health={health} goal={g} />
              </details>
              <div className="health-actions">
                <Button
                  variant="outline"
                  disabled={g.status === "CANCELLED"}
                  onClick={() => edit({ kind: "contribution", goal: g })}
                >
                  Registrar contribuição
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void mutate("/financial-goals/" + g.id, {
                      status:
                        g.status === "PAUSED" || g.status === "CANCELLED"
                          ? "ACTIVE"
                          : "PAUSED",
                    })
                  }
                >
                  {g.status === "PAUSED" || g.status === "CANCELLED" ? (
                    <>
                      <Play size={15} />
                      Retomar
                    </>
                  ) : (
                    <>
                      <Pause size={15} />
                      Pausar
                    </>
                  )}
                </Button>
              </div>
            </ChartCard>
          ))}
        </div>
      )}
    </>
  );
}
export function MonthlyGoalsPanel({ health, edit, mutate }: Actions) {
  const goals = health.snapshot.monthlyGoals;
  return (
    <>
      <div className="health-between">
        <h2>Metas de {monthLabel(health.snapshot.month)}</h2>
        <Button onClick={() => edit({ kind: "monthly" })}>
          <Plus size={16} />
          Nova meta
        </Button>
      </div>
      <p className="muted">
        Sugestões só entram aqui quando você aceita. As metas de cada mês são
        independentes.
      </p>
      {!goals.length ? (
        <EmptyState text="Nenhuma meta aceita ou criada neste mês." />
      ) : (
        <div className="health-grid">
          {goals.map((g) => (
            <ChartCard
              key={g.id}
              title={g.name}
              action={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={"Editar meta " + g.name}
                  onClick={() => edit({ kind: "monthly", initial: g })}
                >
                  <Pencil size={16} />
                </Button>
              }
            >
              <p className="muted">
                {monthlyLabels[g.type]} · {stateLabels[g.status]} ·{" "}
                {g.source === "USER" ? "Criada por você" : "Sugestão aceita"}
              </p>
              <p className="health-number">
                {money(g.currentAmount)}{" "}
                <small>/ {money(g.targetAmount)}</small>
              </p>
              <HealthProgress
                value={g.progress}
                label={"Progresso da meta " + g.name}
              />
              <p>
                {g.type === "CATEGORY_LIMIT"
                  ? g.withinPlan
                    ? "Dentro do limite escolhido."
                    : "O gasto registrado ultrapassou o limite escolhido."
                  : g.remaining === 0
                    ? "Valor da meta alcançado."
                    : "Faltam " + money(g.remaining) + " para a meta."}
              </p>
              <Button
                variant="ghost"
                onClick={() =>
                  void mutate("/monthly-goals/" + g.id, {
                    status: g.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
                  })
                }
              >
                {g.status === "ACTIVE" ? "Pausar meta" : "Retomar meta"}
              </Button>
            </ChartCard>
          ))}
        </div>
      )}
    </>
  );
}
export function PlanPanel({ health, edit, mutate }: Actions) {
  async function move(index: number, step: number) {
    const ids = health.plan.map((p) => p.id);
    [ids[index], ids[index + step]] = [ids[index + step], ids[index]];
    await mutate("/coflu-plan/order", { ids }, "POST");
  }
  const firstGoal = health.snapshot.financialGoals.find(
    (g) => g.status === "ACTIVE",
  );
  return (
    <>
      <div className="health-between">
        <h2>Plano Coflu</h2>
        <Button onClick={() => edit({ kind: "plan" })}>
          <Plus size={16} />
          Adicionar prioridade
        </Button>
      </div>
      <p className="muted">
        Você escolhe a ordem, pausa etapas e mantém objetivos em paralelo.
        Nenhuma sugestão é obrigatória.
      </p>
      {health.plan.length ? (
        <ol className="health-plan">
          {health.plan.map((p, i) => (
            <li key={p.id} className="panel">
              <div className="health-between">
                <span className="health-badge">{stageLabels[p.stage]}</span>
                <span className="muted">{stateLabels[p.status]}</span>
              </div>
              <h3>{p.title}</h3>
              {p.notes && <p>{p.notes}</p>}
              {p.targetAmount !== null && p.currentAmount !== null && (
                <>
                  <p>
                    {money(p.currentAmount)} / {money(p.targetAmount)}
                  </p>
                  <HealthProgress
                    value={p.progress || 0}
                    label={"Progresso de " + p.title}
                  />
                </>
              )}
              {p.reserveMonths && p.targetAmount === null && (
                <p className="muted">
                  Informe o custo essencial para calcular o valor deste marco de{" "}
                  {p.reserveMonths} meses.
                </p>
              )}
              <div className="health-actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => edit({ kind: "plan", initial: p })}
                >
                  Editar prioridade
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void mutate("/coflu-plan/" + p.id, {
                      status: p.status === "PAUSED" ? "ACTIVE" : "PAUSED",
                    })
                  }
                >
                  {p.status === "PAUSED" ? "Retomar" : "Pausar"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void mutate("/coflu-plan/" + p.id, { status: "CANCELLED" })
                  }
                >
                  Remover do plano
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={i === 0}
                  aria-label={"Subir " + p.title}
                  onClick={() => void move(i, -1)}
                >
                  <ArrowUp size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={i === health.plan.length - 1}
                  aria-label={"Descer " + p.title}
                  onClick={() => void move(i, 1)}
                >
                  <ArrowDown size={16} />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState text="Seu plano começa com suas escolhas. Nenhuma prioridade foi adicionada automaticamente." />
      )}
      <ChartCard title="Ideias para organizar o plano">
        <div className="health-actions">
          {[1, 3, 6].map((months, i) => (
            <Button
              key={months}
              variant="outline"
              onClick={() =>
                edit({
                  kind: "plan",
                  initial: {
                    title:
                      "Construir reserva de " +
                      months +
                      (months === 1 ? " mês" : " meses"),
                    reserveMonths: months,
                    stage: i === 0 ? "NOW" : i === 1 ? "NEXT" : "LATER",
                  },
                })
              }
            >
              Revisar marco de {months} {months === 1 ? "mês" : "meses"}
            </Button>
          ))}
          {firstGoal && (
            <Button
              variant="outline"
              onClick={() =>
                edit({
                  kind: "plan",
                  initial: {
                    title: firstGoal.name,
                    financialGoalId: firstGoal.id,
                    stage: "PARALLEL",
                  },
                })
              }
            >
              {firstGoal.name} em paralelo
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() =>
              edit({
                kind: "plan",
                initial: { title: "Construir patrimônio", stage: "LONG_TERM" },
              })
            }
          >
            Revisar prioridade de longo prazo
          </Button>
        </div>
        <p className="muted">
          Revise antes de adicionar. O plano não recomenda ativos nem movimenta
          dinheiro.
        </p>
      </ChartCard>
    </>
  );
}
const evidenceLabels: Record<string, string> = {
  overdueAmount: "Obrigações vencidas",
  interestAndFees: "Juros e taxas classificados",
  reserveAmount: "Reserva declarada",
  observedEssentialMonthly: "Média essencial observada",
  currentFund: "Reserva atual",
  essentialMonthly: "Custo essencial mensal",
  coverageMonths: "Cobertura em meses",
  nextMilestoneMonths: "Próximo marco em meses",
  nextMilestoneAmount: "Valor do próximo marco",
  remaining: "Valor restante",
  suggestedMonthly: "Aporte mensal sugerido",
  targetAmount: "Valor do objetivo",
  currentAmount: "Já destinado",
  monthlyRequired: "Aporte mensal necessário",
  observedCapacity: "Capacidade média observada",
  capacityGap: "Diferença para a capacidade",
  current: "Mês atual",
  previous: "Mês anterior",
  variation: "Variação percentual",
  nextMonthCommitted: "Próximo mês comprometido",
  installmentsNextMonth: "Parcelas por competência do próximo mês",
  averageResult: "Resultado médio",
};
function Evidence({ candidate }: { candidate: RecommendationCandidate }) {
  return (
    <details>
      <summary>De onde vem esta dica?</summary>
      <dl className="health-details">
        {Object.entries(candidate.evidence).map(([key, value]) => (
          <div key={key}>
            <dt>{evidenceLabels[key] || "Referência"}</dt>
            <dd>
              {typeof value === "number"
                ? key.toLowerCase().includes("months")
                  ? value.toLocaleString("pt-BR")
                  : key === "variation"
                    ? value.toLocaleString("pt-BR") + "%"
                    : money(value)
                : (value ?? "Dados insuficientes")}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
export function TipsPanel({
  health,
  edit,
  mutate,
  navigateSection,
  compact = false,
}: Actions & { navigateSection: (href: string) => void; compact?: boolean }) {
  const candidates = compact
    ? health.recommendations.filter((r) => !r.decision).slice(0, 3)
    : health.recommendations;
  const [analysis, setAnalysis] = useState<{
      output: CoachOutput | null;
      message: string;
    } | null>(null),
    [busy, setBusy] = useState(false);
  return (
    <ChartCard title="Dicas para você">
      <p className="muted">
        Baseadas nos registros e nas classificações que você informou. Você pode
        aceitar, editar ou ignorar.
      </p>
      {!candidates.length ? (
        <EmptyState text="Sem novas dicas fundamentadas neste período. Continue registrando e classificando suas finanças." />
      ) : (
        candidates.map((r) => (
          <article className="health-tip" key={r.key}>
            <h3>{r.title}</h3>
            <p>{r.explanation}</p>
            <Evidence candidate={r} />
            <div className="health-actions">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateSection(r.href)}
              >
                Ver dados
              </Button>
              {r.decision === "ACCEPTED" ? (
                <span className="health-badge">Meta aceita</span>
              ) : r.decision === "IGNORED" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void mutate(
                      `/financial-health/${health.snapshot.month}/recommendations/decision`,
                      { key: r.key, decision: "RESET" },
                      "POST",
                    )
                  }
                >
                  Reconsiderar dica
                </Button>
              ) : (
                <>
                  {r.suggestedGoal && (
                    <Button
                      size="sm"
                      onClick={() =>
                        edit({
                          kind: "monthly",
                          initial: r.suggestedGoal!,
                          candidate: r,
                        })
                      }
                    >
                      Revisar e criar meta
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void mutate(
                        `/financial-health/${health.snapshot.month}/recommendations/decision`,
                        { key: r.key, decision: "IGNORED" },
                        "POST",
                      )
                    }
                  >
                    Ignorar
                  </Button>
                </>
              )}
            </div>
          </article>
        ))
      )}
      {!compact && (
        <div className="health-ai">
          <h3>Análise inteligente opcional</h3>
          <p className="muted">
            A IA explica indicadores agregados e recomendações calculadas. Não
            recebe nomes, comprovantes ou histórico detalhado e não pode alterar
            os cálculos ou seus dados.
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setAnalysis(
                  await api(
                    `/financial-health/${health.snapshot.month}/analysis`,
                    {
                      method: "POST",
                      body: JSON.stringify({ refresh: !!analysis }),
                    },
                  ),
                );
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? "Preparando explicação…"
              : analysis
                ? "Atualizar explicação"
                : "Explicar com IA"}
          </Button>
          {analysis && (
            <div role="status">
              <p className="muted">{analysis.message}</p>
              {analysis.output && (
                <>
                  <p>{analysis.output.summary}</p>
                  {analysis.output.positivePoints.map((p, i) => (
                    <p key={"p" + i}>{p}</p>
                  ))}
                  {analysis.output.attentionPoints.map((p, i) => (
                    <p key={"a" + i}>{p}</p>
                  ))}
                  <p>{analysis.output.emergencyFundInsight}</p>
                  {analysis.output.recommendations.map((r, i) => (
                    <p key={i}>{r.explanation}</p>
                  ))}
                  {analysis.output.goalInsights.map((p, i) => (
                    <p key={"g" + i}>{p}</p>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </ChartCard>
  );
}
export function ClassificationPanel({
  health,
  mutate,
}: Pick<Actions, "health" | "mutate">) {
  const labels = {
    UNCLASSIFIED: "Não classificada",
    ESSENTIAL: "Essencial",
    NON_ESSENTIAL: "Não essencial",
  };
  return (
    <ChartCard title="O que é essencial para você?">
      <p className="muted">
        A classificação pertence a você. Uma subcategoria pode herdar a
        classificação da categoria ou ter uma escolha própria. Alterações
        recalculam as análises atuais; fechamentos já salvos preservam seus
        valores.
      </p>
      {!health.categories.length ? (
        <EmptyState text="Cadastre categorias para classificar suas despesas." />
      ) : (
        health.categories.map((c) => (
          <details className="health-classification" key={c.id}>
            <summary>
              {c.name}{" "}
              <small>{labels[c.essentiality as keyof typeof labels]}</small>
            </summary>
            <div className="health-classification-fields">
              <label>
                Essencialidade
                <select
                  aria-label={"Essencialidade de " + c.name}
                  value={c.essentiality}
                  onChange={(e) =>
                    void mutate("/financial-health/categories/" + c.id, {
                      essentiality: e.target.value,
                    })
                  }
                >
                  {Object.entries(labels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Natureza
                <select
                  aria-label={"Natureza de " + c.name}
                  value={c.expenseNature}
                  onChange={(e) =>
                    void mutate("/financial-health/categories/" + c.id, {
                      expenseNature: e.target.value,
                    })
                  }
                >
                  <option value="UNCLASSIFIED">Não classificada</option>
                  <option value="FIXED">Fixa</option>
                  <option value="VARIABLE">Variável</option>
                </select>
              </label>
              <label>
                Finalidade
                <select
                  aria-label={"Finalidade de " + c.name}
                  value={c.financialRole}
                  onChange={(e) =>
                    void mutate("/financial-health/categories/" + c.id, {
                      financialRole: e.target.value,
                    })
                  }
                >
                  <option value="GENERAL">Geral</option>
                  <option value="INTEREST_FEES">Juros e taxas</option>
                  <option value="DEBT_PAYMENT">Amortização de dívida</option>
                  <option value="SUBSCRIPTION">Assinatura</option>
                </select>
              </label>
            </div>
            {c.subcategories.map((sub) => (
              <label className="health-subcategory" key={sub.id}>
                {sub.name}
                <select
                  aria-label={"Essencialidade de " + sub.name}
                  value={sub.essentiality || ""}
                  onChange={(e) =>
                    void mutate("/financial-health/subcategories/" + sub.id, {
                      essentiality: e.target.value || null,
                    })
                  }
                >
                  <option value="">Herdar categoria</option>
                  {Object.entries(labels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </details>
        ))
      )}
    </ChartCard>
  );
}
export function CommitmentsPanel({
  snapshot: s,
}: {
  snapshot: FinancialSnapshot;
}) {
  return (
    <ChartCard title="Composição do próximo mês">
      <strong className="health-number">
        {money(s.futureCommittedExpenses)}
      </strong>
      <p className="muted">
        Faturas pelo vencimento e seu saldo atual em aberto, pendências e
        recorrências previstas. Saldos iniciais de cartão entram nas faturas;
        parcelas já contidas nelas não são somadas de novo.
      </p>
      {!s.commitments.length ? (
        <EmptyState text="Nenhum compromisso registrado para o próximo mês." />
      ) : (
        <ul className="health-list">
          {s.commitments.map((c) => (
            <li key={c.kind + c.id}>
              <div>
                <strong>{c.name}</strong>
                <small>
                  {new Date(c.date + "T12:00:00Z").toLocaleDateString("pt-BR")}
                  {c.estimated
                    ? " · Recorrência estimada, ainda não gerada"
                    : " · Registrado"}
                </small>
              </div>
              <strong>{money(c.amount)}</strong>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
export function HistoryPanel({ snapshot: s }: { snapshot: FinancialSnapshot }) {
  const max = Math.max(1, ...s.history.flatMap((h) => [h.income, h.expenses]));
  return (
    <>
      <ChartCard title="Evolução dos registros">
        <p className="muted">
          Períodos sem registros não são tratados como meses completos com renda
          zero.
        </p>
        <div className="health-history">
          {s.history.map((h) => (
            <div key={h.month}>
              <strong>{monthLabel(h.month)}</strong>
              <small>
                {h.complete
                  ? "Período completo"
                  : h.hasData
                    ? "Parcial"
                    : "Sem histórico"}
              </small>
              {h.hasData || h.complete ? (
                <>
                  <div className="health-history-bar">
                    <span
                      className="income-bar"
                      style={{ width: `${(h.income / max) * 100}%` }}
                    />
                  </div>
                  <span>Entrou {money(h.income)}</span>
                  <div className="health-history-bar">
                    <span
                      className="expense-bar"
                      style={{ width: `${(h.expenses / max) * 100}%` }}
                    />
                  </div>
                  <span>Saiu {money(h.expenses)}</span>
                  <p>Resultado: {money(h.monthlyResult)}</p>
                </>
              ) : (
                <p>Sem valores para comparar.</p>
              )}
            </div>
          ))}
        </div>
      </ChartCard>
      <div className="health-grid">
        {[
          ["Média de três meses", s.threeMonthAverage],
          ["Média de seis meses", s.sixMonthAverage],
        ].map(([title, value]) => {
          const avg = value as FinancialSnapshot["threeMonthAverage"];
          return (
            <ChartCard title={title as string} key={title as string}>
              {avg ? (
                <>
                  <p>Renda: {money(avg.income)}</p>
                  <p>Despesas: {money(avg.expenses)}</p>
                  <p>Essenciais: {nullableMoney(avg.essentialExpenses)}</p>
                  <p>Resultado: {money(avg.result)}</p>
                  <small>{avg.months.map(monthLabel).join(" · ")}</small>
                </>
              ) : (
                <p>
                  Ainda não há meses completos suficientes. Nenhuma média foi
                  extrapolada.
                </p>
              )}
            </ChartCard>
          );
        })}
      </div>
    </>
  );
}
export function ReviewPanel({
  health,
  refresh,
}: {
  health: HealthResponse;
  refresh: () => void;
}) {
  const [selected, setSelected] = useState<{
      snapshotData: FinancialSnapshot;
      version: number;
      status: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <ChartCard
      title="Fechamentos mensais"
      action={
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const result = await api<typeof selected>(
                `/financial-health/${health.snapshot.month}/review`,
                { method: "POST" },
              );
              setSelected(result);
              refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Gerando…" : "Gerar fechamento"}
        </Button>
      }
    >
      <p className="muted">
        Cada fechamento guarda a fotografia do período no momento da geração. Se
        os dados mudarem, uma nova versão preserva a anterior. Meses em
        andamento ficam identificados como parciais.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!health.reviews.length ? (
        <EmptyState text="Nenhum fechamento salvo neste mês." />
      ) : (
        <ul className="health-list">
          {health.reviews.map((r) => (
            <li key={r.id}>
              <div>
                <strong>
                  Versão {r.version} ·{" "}
                  {r.status === "PARTIAL" ? "Parcial" : "Fechado"}
                </strong>
                <small>{new Date(r.generatedAt).toLocaleString("pt-BR")}</small>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    setSelected(await api(`/financial-reviews/${r.id}`));
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Ver versão {r.version}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="health-review" aria-label="Fechamento preservado">
          <h3>Fotografia preservada · versão {selected.version}</h3>
          <HealthMetrics snapshot={selected.snapshotData} />
          <dl className="health-details">
            <div>
              <dt>Reserva declarada</dt>
              <dd>{money(selected.snapshotData.reserve.amount)}</dd>
            </div>
            <div>
              <dt>Cobertura essencial</dt>
              <dd>
                {selected.snapshotData.reserve.coverageMonths === null
                  ? "Dados insuficientes"
                  : selected.snapshotData.reserve.coverageMonths.toLocaleString(
                      "pt-BR",
                    ) + " meses"}
              </dd>
            </div>
            <div>
              <dt>Próximo mês comprometido</dt>
              <dd>{money(selected.snapshotData.futureCommittedExpenses)}</dd>
            </div>
          </dl>
          {selected.snapshotData.financialGoals.map((g) => (
            <p key={g.id}>
              {g.name}: {g.progress.toLocaleString("pt-BR")}% ·{" "}
              {money(g.currentAmount)} de {money(g.targetAmount)}
            </p>
          ))}
          <p className="muted">{selected.snapshotData.dataQuality.message}</p>
        </div>
      )}
    </ChartCard>
  );
}
export function ContributionsPanel({
  health,
  goal,
}: {
  health: HealthResponse;
  goal?: GoalView;
}) {
  const rows = health.snapshot.goalContributions.filter(
    (c) => c.goalId === (goal?.id || null),
  );
  return (
    <ChartCard
      title={"Contribuições e retiradas · " + monthLabel(health.snapshot.month)}
    >
      {!rows.length ? (
        <EmptyState text="Nenhuma contribuição ou retirada registrada neste mês." />
      ) : (
        <ul className="health-list">
          {rows.map((c) => (
            <li key={c.id}>
              <div>
                <strong>
                  {c.direction === "DEPOSIT" ? "Contribuição" : "Retirada"}
                </strong>
                <small>
                  {new Date(c.date + "T12:00:00Z").toLocaleDateString("pt-BR")}
                  {c.notes ? " · " + c.notes : ""}
                </small>
              </div>
              <strong>
                {c.direction === "WITHDRAWAL" ? "− " : "+ "}
                {money(c.amount)}
              </strong>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
