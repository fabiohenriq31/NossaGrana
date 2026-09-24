import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "@/lib/api";
import { money, today } from "@/lib/utils";
import { Button } from "./ui/button";
import type {
  HealthResponse,
  GoalFields,
  GoalView,
  MonthlyGoalFields,
  MonthlyGoalView,
  PlanFields,
  PlanView,
  RecommendationCandidate,
} from "../../../../packages/shared/src/health";

export const goalLabels: Record<string, string> = {
  TRAVEL: "Viagem",
  CAR: "Carro",
  HOME: "Casa",
  PHONE: "Celular",
  COMPUTER: "Computador",
  WEDDING: "Casamento",
  DEBT_PAYOFF: "Quitar dívida",
  INVESTMENT: "Patrimônio",
  EDUCATION: "Educação",
  OTHER: "Outro",
};
export const monthlyLabels: Record<string, string> = {
  SAVE_AMOUNT: "Economizar no mês",
  CATEGORY_LIMIT: "Limitar categoria",
  GOAL_CONTRIBUTION: "Contribuir para objetivo",
  EMERGENCY_FUND_CONTRIBUTION: "Contribuir para reserva",
  DEBT_REDUCTION: "Amortizar dívida",
  CUSTOM: "Meta personalizada",
};
export const stageLabels: Record<string, string> = {
  NOW: "Agora",
  NEXT: "Próximo marco",
  PARALLEL: "Em paralelo",
  LATER: "Depois",
  LONG_TERM: "Longo prazo",
};
export const stateLabels: Record<string, string> = {
  ACTIVE: "Ativo",
  PAUSED: "Pausado",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
};
const motivations = [
  "Ter segurança",
  "Sair das dívidas",
  "Comprar alguma coisa",
  "Viver experiências",
  "Construir uma família",
  "Construir patrimônio",
  "Organizar minha vida financeira",
  "Parar de me preocupar tanto com dinheiro",
  "Outro",
];
const cents = (f: FormData, key: string) =>
  Math.round(Number(String(f.get(key) || "0").replace(",", ".")) * 100);
const str = (f: FormData, key: string) => String(f.get(key) || "");
export function HealthField({
  label,
  children,
  full = false,
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <label className={full ? "full" : ""}>
      <span>{label}</span>
      {children}
    </label>
  );
}
function MoneyInput({
  name,
  value = 0,
  label,
  optional = false,
  min = 0,
}: {
  name: string;
  value?: number | null;
  label: string;
  optional?: boolean;
  min?: number;
}) {
  return (
    <HealthField label={label}>
      <input
        name={name}
        aria-label={label}
        type="number"
        min={min}
        max={10000000}
        step="0.01"
        inputMode="decimal"
        defaultValue={value === null ? "" : value / 100}
        required={!optional}
      />
    </HealthField>
  );
}
function Options({ labels }: { labels: Record<string, string> }) {
  return Object.entries(labels).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}
function FormFrame({
  submit,
  children,
  label = "Salvar",
}: {
  submit: (form: FormData) => Promise<void>;
  children: ReactNode;
  label?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await submit(form);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-grid health-form" onSubmit={save}>
      <fieldset disabled={busy}>{children}</fieldset>
      {error && (
        <p role="alert" className="form-error full">
          {error}
        </p>
      )}
      <div className="form-actions full">
        <Button disabled={busy} type="submit">
          {busy ? "Salvando…" : label}
        </Button>
      </div>
    </form>
  );
}
export function HealthSettingsForm({
  health,
  done,
  onboarding = false,
}: {
  health: HealthResponse;
  done: (createGoal?: boolean) => void;
  onboarding?: boolean;
}) {
  const s = health.settings;
  const [source, setSource] = useState(s.essentialSource);
  return (
    <FormFrame
      label={onboarding ? "Começar meu plano" : "Salvar preferências"}
      submit={async (f) => {
        await api("/financial-health/settings", {
          method: "PATCH",
          body: JSON.stringify({
            motivations: f.getAll("motivation"),
            reserveAnswer: str(f, "reserveAnswer"),
            onboarded: true,
            reserveInitialAmount: cents(f, "reserveInitialAmount"),
            reserveTargetMonths: Number(f.get("reserveTargetMonths")),
            reserveTargetAmount: str(f, "reserveTargetAmount")
              ? cents(f, "reserveTargetAmount")
              : null,
            milestones: str(f, "milestones")
              .split(",")
              .map((x) => Number(x.trim())),
            essentialEstimate: str(f, "essentialEstimate")
              ? cents(f, "essentialEstimate")
              : null,
            essentialSource: source,
            historyStart: str(f, "historyStart") || null,
          }),
        });
        done(f.get("createGoal") === "on");
      }}
    >
      <div className="full">
        <p>O que dinheiro significa para você neste momento?</p>
        <div className="health-choices">
          {motivations.map((m) => (
            <label key={m}>
              <input
                type="checkbox"
                name="motivation"
                value={m}
                defaultChecked={s.motivations.includes(m)}
              />
              {m}
            </label>
          ))}
        </div>
      </div>
      <HealthField label="Você possui uma reserva de emergência?">
        <select name="reserveAnswer" defaultValue={s.reserveAnswer}>
          <option value="YES">Sim</option>
          <option value="NO">Não</option>
          <option value="UNKNOWN">Não sei</option>
        </select>
      </HealthField>
      <MoneyInput
        name="reserveInitialAmount"
        label="Valor inicial declarado da reserva (R$)"
        value={s.reserveInitialAmount}
      />
      <p className="muted full">
        Considere somente o dinheiro que você separou para emergências.
        Contribuições e retiradas registradas são somadas a este valor inicial;
        os saldos bancários não entram automaticamente.
      </p>
      <HealthField label="Sua meta de reserva (meses)">
        <input
          name="reserveTargetMonths"
          type="number"
          min={1}
          max={60}
          defaultValue={s.reserveTargetMonths}
          list="reserve-month-options"
          required
        />
        <datalist id="reserve-month-options">
          {[3, 6, 9, 12].map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </HealthField>
      <MoneyInput
        name="reserveTargetAmount"
        label="Ou meta personalizada em reais (opcional)"
        value={s.reserveTargetAmount}
        optional
        min={0.01}
      />
      <p className="muted full">
        Os marcos são referências educacionais. Sua escolha pode considerar
        estabilidade da renda, dependentes, obrigações e conforto pessoal com
        riscos. Não há um prazo que garanta segurança para todos.
      </p>
      <HealthField label="Custo essencial utilizado">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as typeof source)}
        >
          <option value="OBSERVED_DATA">Média observada pelo Coflu</option>
          <option value="USER_ESTIMATE">Minha estimativa temporária</option>
        </select>
      </HealthField>
      <MoneyInput
        name="essentialEstimate"
        label="Meu custo essencial mensal aproximado (R$)"
        value={s.essentialEstimate}
        optional={source !== "USER_ESTIMATE"}
      />
      <p className="muted full">
        A estimativa é identificada como informada por você. Uma média observada
        futura será oferecida para revisão, sem substituir sua escolha.
      </p>
      <HealthField
        label="Marcos educacionais (meses, separados por vírgula)"
        full
      >
        <input
          name="milestones"
          defaultValue={s.milestones.join(", ")}
          required
        />
      </HealthField>
      <HealthField label="Histórico completo a partir de (opcional)" full>
        <input
          name="historyStart"
          type="date"
          max={today()}
          defaultValue={s.historyStart || ""}
        />
        <small>
          Preencha somente se revisou e registrou todas as movimentações desde
          essa data, inclusive meses sem atividade.
        </small>
      </HealthField>
      {onboarding && (
        <label className="health-check full">
          <input type="checkbox" name="createGoal" />
          Tenho algo que gostaria de conquistar e quero criar um objetivo.
        </label>
      )}
    </FormFrame>
  );
}
function readGoal(f: FormData): GoalFields {
  return {
    name: str(f, "name"),
    type: str(f, "type") as GoalFields["type"],
    targetAmount: cents(f, "targetAmount"),
    initialAmount: cents(f, "initialAmount"),
    targetDate: str(f, "targetDate"),
    scope: str(f, "scope") as GoalFields["scope"],
    memberId: str(f, "scope") === "PERSONAL" ? str(f, "memberId") : null,
    priority: Number(f.get("priority")),
    status: str(f, "status") as GoalFields["status"],
    icon: "target",
    notes: str(f, "notes"),
  };
}
export function GoalForm({
  goal,
  health,
  done,
}: {
  goal?: GoalView;
  health: HealthResponse;
  done: () => void;
}) {
  const [scope, setScope] = useState(goal?.scope || "HOUSEHOLD"),
    [simulation, setSimulation] = useState<{
      monthlyRequired: number | null;
      estimatedDate: string | null;
      overdue: boolean;
    } | null>(null),
    [simError, setSimError] = useState(""),
    [simBusy, setSimBusy] = useState(false);
  return (
    <FormFrame
      submit={async (f) => {
        await api("/financial-goals" + (goal ? "/" + goal.id : ""), {
          method: goal ? "PATCH" : "POST",
          body: JSON.stringify(readGoal(f)),
        });
        done();
      }}
    >
      <HealthField label="O que você quer conquistar?">
        <select name="type" defaultValue={goal?.type || "TRAVEL"}>
          <Options labels={goalLabels} />
        </select>
      </HealthField>
      <HealthField label="Nome do objetivo">
        <input
          name="name"
          defaultValue={goal?.name || ""}
          minLength={2}
          maxLength={100}
          placeholder="Ex.: Viagem em família"
          required
        />
      </HealthField>
      <HealthField label="Objetivo de quem?">
        <select
          name="scope"
          value={scope}
          onChange={(e) => setScope(e.target.value as typeof scope)}
        >
          <option value="HOUSEHOLD">Da casa</option>
          <option value="PERSONAL">Pessoal</option>
        </select>
      </HealthField>
      {scope === "PERSONAL" && (
        <HealthField label="Membro">
          <select name="memberId" defaultValue={goal?.memberId || ""} required>
            <option value="">Selecione</option>
            {health.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </HealthField>
      )}
      <MoneyInput
        name="targetAmount"
        label="Valor estimado do objetivo (R$)"
        value={goal?.targetAmount || 0}
        min={0.01}
      />
      <MoneyInput
        name="initialAmount"
        label="Quanto já possui inicialmente (R$)"
        value={goal?.initialAmount || 0}
      />
      <HealthField label="Data desejada">
        <input
          name="targetDate"
          type="date"
          defaultValue={goal?.targetDate || ""}
          required
        />
      </HealthField>
      <HealthField label="Prioridade">
        <select name="priority" defaultValue={goal?.priority || 2}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
              {n === 1 ? " · mais alta" : ""}
            </option>
          ))}
        </select>
      </HealthField>
      <HealthField label="Situação do objetivo">
        <select name="status" defaultValue={goal?.status || "ACTIVE"}>
          <Options labels={stateLabels} />
        </select>
      </HealthField>
      <HealthField label="Observações" full>
        <textarea
          name="notes"
          maxLength={1500}
          defaultValue={goal?.notes || ""}
        />
      </HealthField>
      <p className="muted full">
        Não inclua o mesmo dinheiro em dois objetivos ou na reserva. A reserva
        de emergência possui seu próprio painel. O valor inicial é separado das
        contribuições que você registrar depois.
      </p>
      <MoneyInput
        name="monthlyContribution"
        label="Se eu guardar por mês (R$)"
        value={goal?.monthlyRequired || 0}
      />
      <Button
        type="button"
        variant="outline"
        disabled={simBusy}
        onClick={async (e) => {
          const form = e.currentTarget.closest("form")!;
          if (!form.reportValidity()) return;
          const f = new FormData(form);
          setSimBusy(true);
          setSimError("");
          try {
            setSimulation(
              await api("/financial-goals/simulate", {
                method: "POST",
                body: JSON.stringify({
                  ...(goal ? { goalId: goal.id } : {}),
                  goal: readGoal(f),
                  monthlyContribution: cents(f, "monthlyContribution"),
                }),
              }),
            );
          } catch (e) {
            setSimError((e as Error).message);
          } finally {
            setSimBusy(false);
          }
        }}
      >
        {simBusy ? "Simulando…" : "Simular prazo e aporte"}
      </Button>
      {simError && (
        <p className="form-error full" role="alert">
          {simError}
        </p>
      )}
      {simulation && (
        <div className="health-note full" role="status">
          <strong>Simulação sem rendimentos</strong>
          <p>
            {simulation.monthlyRequired === null
              ? "O prazo já passou. Escolha uma nova data para calcular o aporte necessário."
              : "Para a data escolhida: " +
                money(simulation.monthlyRequired) +
                " por mês."}
          </p>
          <p>
            {simulation.estimatedDate
              ? "Com o aporte informado, data estimada: " +
                new Date(
                  simulation.estimatedDate + "T12:00:00Z",
                ).toLocaleDateString("pt-BR")
              : "Informe um aporte maior que zero para estimar quando chegará ao objetivo."}
          </p>
          <small>
            Você pode alterar a data desejada ou o valor estimado e simular
            novamente. A simulação não salva alterações.
          </small>
        </div>
      )}
    </FormFrame>
  );
}
export function ContributionForm({
  goal,
  done,
}: {
  goal?: GoalView;
  done: () => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  return (
    <FormFrame
      label="Registrar contribuição"
      submit={async (f) => {
        await api(
          goal
            ? `/financial-goals/${goal.id}/contributions`
            : "/emergency-fund/contributions",
          {
            method: "POST",
            body: JSON.stringify({
              amount: cents(f, "amount"),
              direction: str(f, "direction"),
              date: str(f, "date"),
              notes: str(f, "notes"),
              requestId,
            }),
          },
        );
        done();
      }}
    >
      <p className="health-note full">
        Este registro indica dinheiro que você já destinou a{" "}
        {goal ? goal.name : "sua reserva"}. Não movimenta dinheiro nem cria
        receita, despesa ou transferência bancária. Não registre aqui valores
        apenas planejados.
      </p>
      <HealthField label="Movimento">
        <select name="direction">
          <option value="DEPOSIT">Adicionar valor destinado</option>
          <option value="WITHDRAWAL">Retirar valor destinado</option>
        </select>
      </HealthField>
      <MoneyInput name="amount" label="Valor (R$)" min={0.01} />
      <HealthField label="Data da contribuição">
        <input
          name="date"
          type="date"
          defaultValue={today()}
          max={today()}
          required
        />
      </HealthField>
      <HealthField label="Observações" full>
        <textarea name="notes" maxLength={500} />
      </HealthField>
    </FormFrame>
  );
}
export function MonthlyGoalForm({
  initial,
  candidate,
  health,
  month,
  done,
}: {
  initial?: MonthlyGoalView | MonthlyGoalFields;
  candidate?: RecommendationCandidate;
  health: HealthResponse;
  month: string;
  done: () => void;
}) {
  const [type, setType] = useState(initial?.type || "SAVE_AMOUNT");
  return (
    <FormFrame
      label={candidate ? "Aceitar e criar meta" : "Salvar meta"}
      submit={async (f) => {
        const v: MonthlyGoalFields = {
          month: str(f, "month"),
          name: str(f, "name"),
          type,
          targetAmount: cents(f, "targetAmount"),
          categoryId: type === "CATEGORY_LIMIT" ? str(f, "categoryId") : null,
          financialGoalId:
            type === "GOAL_CONTRIBUTION" ? str(f, "financialGoalId") : null,
          userId: null,
          status: str(f, "status") as MonthlyGoalFields["status"],
          manualProgress: type === "CUSTOM" ? cents(f, "manualProgress") : 0,
        };
        const id = initial && "id" in initial ? initial.id : null;
        await api(
          candidate
            ? `/financial-health/${month}/recommendations/accept`
            : "/monthly-goals" + (id ? "/" + id : ""),
          {
            method: candidate || !id ? "POST" : "PATCH",
            body: JSON.stringify(
              candidate ? { key: candidate.key, changes: v } : v,
            ),
          },
        );
        done();
      }}
    >
      {candidate && (
        <p className="health-note full">
          {candidate.explanation} Ajuste os campos antes de aceitar. Esta
          sugestão ainda não é uma meta.
        </p>
      )}
      <HealthField label="Tipo de meta">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
        >
          <Options labels={monthlyLabels} />
        </select>
      </HealthField>
      <HealthField label="Nome da meta">
        <input
          name="name"
          defaultValue={initial?.name || ""}
          minLength={2}
          maxLength={100}
          required
        />
      </HealthField>
      <HealthField label="Mês da meta">
        <input
          type="month"
          name="month"
          defaultValue={initial?.month || month}
          required
        />
      </HealthField>
      <MoneyInput
        name="targetAmount"
        label="Valor da meta (R$)"
        value={initial?.targetAmount || 0}
        min={0.01}
      />
      {type === "CATEGORY_LIMIT" && (
        <HealthField label="Categoria">
          <select
            name="categoryId"
            defaultValue={initial?.categoryId || ""}
            required
          >
            <option value="">Selecione</option>
            {health.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </HealthField>
      )}
      {type === "GOAL_CONTRIBUTION" && (
        <HealthField label="Objetivo">
          <select
            name="financialGoalId"
            defaultValue={initial?.financialGoalId || ""}
            required
          >
            <option value="">Selecione</option>
            {health.snapshot.financialGoals
              .filter((g) => ["ACTIVE", "PAUSED"].includes(g.status))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
        </HealthField>
      )}
      {type === "CUSTOM" && (
        <MoneyInput
          name="manualProgress"
          label="Progresso informado (R$)"
          value={initial?.manualProgress || 0}
        />
      )}
      <HealthField label="Situação da meta">
        <select name="status" defaultValue={initial?.status || "ACTIVE"}>
          <Options labels={stateLabels} />
        </select>
      </HealthField>
      <p className="muted full">
        Economia usa o resultado registrado do mês, sem reservar dinheiro
        automaticamente. Aportes usam contribuições explícitas. Amortização usa
        despesas classificadas como pagamento de dívida; pagamentos de fatura
        não são contados novamente.
      </p>
    </FormFrame>
  );
}
export function PlanForm({
  initial,
  health,
  done,
}: {
  initial?: Partial<PlanFields> & { id?: string };
  health: HealthResponse;
  done: () => void;
}) {
  const [link, setLink] = useState(
    initial?.reserveMonths
      ? "reserve"
      : initial?.financialGoalId
        ? "goal"
        : "none",
  );
  return (
    <FormFrame
      submit={async (f) => {
        const v: PlanFields = {
          title: str(f, "title"),
          notes: str(f, "notes"),
          stage: str(f, "stage") as PlanFields["stage"],
          status: str(f, "status") as PlanFields["status"],
          position: initial?.position ?? health.plan.length,
          financialGoalId: link === "goal" ? str(f, "financialGoalId") : null,
          reserveMonths:
            link === "reserve" ? Number(f.get("reserveMonths")) : null,
        };
        await api("/coflu-plan" + (initial?.id ? "/" + initial.id : ""), {
          method: initial?.id ? "PATCH" : "POST",
          body: JSON.stringify(v),
        });
        done();
      }}
    >
      <HealthField label="Prioridade do plano">
        <input
          name="title"
          defaultValue={initial?.title || ""}
          minLength={2}
          maxLength={100}
          required
        />
      </HealthField>
      <HealthField label="Etapa">
        <select name="stage" defaultValue={initial?.stage || "NOW"}>
          <Options labels={stageLabels} />
        </select>
      </HealthField>
      <HealthField label="Acompanhar">
        <select value={link} onChange={(e) => setLink(e.target.value)}>
          <option value="none">Prioridade livre</option>
          <option value="reserve">Marco da reserva</option>
          <option value="goal">Objetivo cadastrado</option>
        </select>
      </HealthField>
      {link === "reserve" && (
        <HealthField label="Marco em meses">
          <input
            name="reserveMonths"
            type="number"
            min={1}
            max={60}
            defaultValue={initial?.reserveMonths || 1}
            required
          />
        </HealthField>
      )}
      {link === "goal" && (
        <HealthField label="Objetivo vinculado">
          <select
            name="financialGoalId"
            defaultValue={initial?.financialGoalId || ""}
            required
          >
            <option value="">Selecione</option>
            {health.snapshot.financialGoals
              .filter((g) => g.status !== "CANCELLED")
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
        </HealthField>
      )}
      <HealthField label="Situação da prioridade">
        <select name="status" defaultValue={initial?.status || "ACTIVE"}>
          <Options labels={stateLabels} />
        </select>
      </HealthField>
      <HealthField label="Observações" full>
        <textarea
          name="notes"
          maxLength={1500}
          defaultValue={initial?.notes || ""}
        />
      </HealthField>
      <p className="muted full">
        O plano organiza suas escolhas. Adicionar uma prioridade não cria
        contribuições, metas mensais ou movimentações financeiras.
      </p>
    </FormFrame>
  );
}
export type HealthModal =
  | { kind: "settings"; onboarding?: boolean }
  | { kind: "goal"; goal?: GoalView }
  | { kind: "contribution"; goal?: GoalView }
  | {
      kind: "monthly";
      initial?: MonthlyGoalView | MonthlyGoalFields;
      candidate?: RecommendationCandidate;
    }
  | { kind: "plan"; initial?: Partial<PlanView> }
  | null;
