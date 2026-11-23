import { useState, type ReactNode } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { api } from "@/lib/api";
import { money } from "@/lib/utils";
import { Button } from "./ui/button";
import type { HealthResponse } from "../../../../packages/shared/src/health";

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
const reserveMonths = [3, 6, 9, 12];
type Reserve = "YES" | "NO" | "UNKNOWN";
type Step = "why" | "reserve" | "amount" | "target" | "essential" | "goal";

/** Aceita "1.234,56", "1234,56" ou "1234.56"; devolve centavos ou null. */
function parseMoney(text: string): number | null {
  const clean = text.replace(/[^\d,.]/g, "");
  if (!clean) return null;
  const normalized = clean.includes(",")
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean;
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}
const toText = (cents: number | null) =>
  cents ? (cents / 100).toFixed(2).replace(".", ",") : "";

/**
 * Primeiro acesso à Saúde Financeira: uma pergunta por vez. Respostas de
 * escolha única avançam sozinhas; o formulário completo fica em Preferências.
 */
export function OnboardingWizard({
  health,
  done,
}: {
  health: HealthResponse;
  done: (createGoal?: boolean) => void;
}) {
  const s = health.settings;
  const [why, setWhy] = useState<string[]>(s.motivations);
  const [reserve, setReserve] = useState<Reserve | null>(null);
  const [amount, setAmount] = useState(toText(s.reserveInitialAmount));
  const [months, setMonths] = useState<number | null>(null);
  const [customMonths, setCustomMonths] = useState("");
  const [estimate, setEstimate] = useState<string | null>(null);
  const [essential, setEssential] = useState<"OBSERVED" | "ESTIMATE" | null>(
    null,
  );
  const [history, setHistory] = useState<Step[]>(["why"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const step = history[history.length - 1]!;
  // Sem reserva, a pergunta do valor some; o total só diminui, nunca aumenta.
  const flow: Step[] =
    reserve === "NO" || reserve === "UNKNOWN"
      ? ["why", "reserve", "target", "essential", "goal"]
      : ["why", "reserve", "amount", "target", "essential", "goal"];
  const index = flow.indexOf(step);
  const go = (next: Step) => {
    setError("");
    setHistory((h) => [...h, next]);
  };
  const back = () => {
    setError("");
    setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
  };

  async function finish(createGoal: boolean) {
    setBusy(true);
    setError("");
    try {
      const typed = estimate === null ? null : parseMoney(estimate);
      await api("/financial-health/settings", {
        method: "PATCH",
        body: JSON.stringify({
          motivations: why,
          reserveAnswer: reserve ?? "UNKNOWN",
          onboarded: true,
          reserveInitialAmount:
            reserve === "YES" ? (parseMoney(amount) ?? 0) : 0,
          reserveTargetMonths: months ?? s.reserveTargetMonths,
          reserveTargetAmount: s.reserveTargetAmount,
          milestones: s.milestones,
          essentialEstimate: typed,
          essentialSource: typed ? "USER_ESTIMATE" : "OBSERVED_DATA",
          historyStart: s.historyStart,
        }),
      });
      done(createGoal);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="wizard">
      <div className="wizard-progress">
        <div
          className="wizard-bar"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={flow.length}
          aria-valuenow={index + 1}
          aria-label={`Passo ${index + 1} de ${flow.length}`}
        >
          <span style={{ width: ((index + 1) / flow.length) * 100 + "%" }} />
        </div>
        <span className="wizard-count">
          {index + 1} de {flow.length}
        </span>
      </div>

      <div className="wizard-step" key={step}>
        {step === "why" && (
          <Question
            title="O que dinheiro significa para você agora?"
            hint="Escolha quantas quiser. Isso ajuda a priorizar as dicas."
          >
            <div className="wizard-options two">
              {motivations.map((m) => {
                const on = why.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    className="wizard-option"
                    aria-pressed={on}
                    onClick={() =>
                      setWhy((w) => (on ? w.filter((x) => x !== m) : [...w, m]))
                    }
                  >
                    <span className="wizard-check">
                      {on && <Check size={14} strokeWidth={3} />}
                    </span>
                    {m}
                  </button>
                );
              })}
            </div>
            <Footer
              onNext={() => go("reserve")}
              nextLabel={why.length ? "Continuar" : "Pular"}
            />
          </Question>
        )}

        {step === "reserve" && (
          <Question
            title="Você já tem uma reserva de emergência?"
            hint="Dinheiro separado só para imprevistos, fora do dia a dia."
          >
            <Choices
              value={reserve}
              options={[
                ["YES", "Sim, tenho", "Vamos registrar quanto"],
                ["NO", "Ainda não", "O Coflu ajuda a começar"],
                ["UNKNOWN", "Não sei dizer", "Tudo bem, dá para ver depois"],
              ]}
              onPick={(v) => {
                setReserve(v as Reserve);
                go(v === "YES" ? "amount" : "target");
              }}
            />
            <Footer onBack={back} />
          </Question>
        )}

        {step === "amount" && (
          <Question
            title="Quanto tem guardado hoje?"
            hint="Só o que está separado para emergências. Contribuições futuras são somadas a este valor."
          >
            <MoneyField
              value={amount}
              onChange={setAmount}
              onEnter={() => go("target")}
              label="Valor da reserva"
            />
            <Footer onBack={back} onNext={() => go("target")} />
          </Question>
        )}

        {step === "target" && (
          <Question
            title="Quantos meses de custo quer ter guardado?"
            hint="Uma referência comum é de 3 a 12 meses. Depende da estabilidade da renda e de quem depende de vocês."
          >
            <div className="wizard-options four">
              {reserveMonths.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="wizard-option tile"
                  aria-pressed={months === m}
                  onClick={() => {
                    setMonths(m);
                    setCustomMonths("");
                    go("essential");
                  }}
                >
                  <strong>{m}</strong>
                  <small>meses</small>
                </button>
              ))}
            </div>
            <label className="wizard-inline">
              Outro número de meses
              <input
                type="number"
                min={1}
                max={60}
                inputMode="numeric"
                placeholder="Ex.: 18"
                value={customMonths}
                onChange={(e) => setCustomMonths(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && validMonths(customMonths)) {
                    e.preventDefault();
                    setMonths(Number(customMonths));
                    go("essential");
                  }
                }}
              />
            </label>
            <Footer
              onBack={back}
              onNext={
                validMonths(customMonths)
                  ? () => {
                      setMonths(Number(customMonths));
                      go("essential");
                    }
                  : undefined
              }
            />
          </Question>
        )}

        {step === "essential" && (
          <Question
            title="Quanto custa o essencial da casa por mês?"
            hint="Moradia, mercado, contas, transporte e saúde. É a base para calcular a reserva."
          >
            <Choices
              value={essential}
              options={[
                [
                  "OBSERVED",
                  "Deixe o Coflu calcular",
                  "Pela média dos seus lançamentos",
                ],
                ["ESTIMATE", "Quero informar um valor", "Uma estimativa sua"],
              ]}
              onPick={(v) => {
                setEssential(v as "OBSERVED" | "ESTIMATE");
                if (v === "OBSERVED") {
                  setEstimate(null);
                  go("goal");
                } else setEstimate(estimate ?? toText(s.essentialEstimate));
              }}
            />
            {estimate !== null && (
              <MoneyField
                value={estimate}
                onChange={setEstimate}
                onEnter={() => parseMoney(estimate) && go("goal")}
                label="Custo essencial por mês"
                autoFocus
              />
            )}
            <Footer
              onBack={back}
              onNext={
                estimate !== null && parseMoney(estimate)
                  ? () => go("goal")
                  : undefined
              }
            />
          </Question>
        )}

        {step === "goal" && (
          <Question
            title="Tem algo que querem conquistar?"
            hint="Uma viagem, um carro, quitar uma dívida… Dá para criar um objetivo agora ou depois."
          >
            <Choices
              value={null}
              disabled={busy}
              options={[
                ["YES", "Sim, criar um objetivo", "Logo em seguida"],
                ["NO", "Agora não", "Começar o plano"],
              ]}
              onPick={(v) => void finish(v === "YES")}
            />
            {busy && <p className="wizard-saving">Salvando…</p>}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <Footer onBack={busy ? undefined : back} />
          </Question>
        )}
      </div>
    </div>
  );
}

const validMonths = (v: string) =>
  /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 60;

function Question({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <>
      <h3 className="wizard-title">{title}</h3>
      <p className="wizard-hint">{hint}</p>
      {children}
    </>
  );
}

function Choices({
  value,
  options,
  onPick,
  disabled = false,
}: {
  value: string | null;
  options: [string, string, string][];
  onPick: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="wizard-options">
      {options.map(([v, label, detail]) => (
        <button
          key={v}
          type="button"
          className="wizard-option"
          aria-pressed={value === v}
          disabled={disabled}
          onClick={() => onPick(v)}
        >
          <span className="wizard-radio" />
          <span>
            {label}
            <small>{detail}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function MoneyField({
  value,
  onChange,
  onEnter,
  label,
  autoFocus = true,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  label: string;
  autoFocus?: boolean;
}) {
  const cents = parseMoney(value);
  return (
    <label className="wizard-money">
      <span className="sr-only">{label}</span>
      <span className="wizard-money-field">
        <span aria-hidden>R$</span>
        <input
          inputMode="decimal"
          placeholder="0,00"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d,.]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            }
          }}
        />
      </span>
      {cents ? <small>{money(cents)}</small> : null}
    </label>
  );
}

function Footer({
  onBack,
  onNext,
  nextLabel = "Continuar",
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
}) {
  return (
    <div className="wizard-footer">
      {onBack ? (
        <Button variant="ghost" type="button" onClick={onBack}>
          <ArrowLeft size={17} /> Voltar
        </Button>
      ) : (
        <span />
      )}
      {onNext && (
        <Button type="button" onClick={onNext}>
          {nextLabel}
        </Button>
      )}
    </div>
  );
}
