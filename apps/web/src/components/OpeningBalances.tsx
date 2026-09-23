import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type {
  Invoice,
  CreditCard,
} from "../../../../packages/shared/src/types";
import { openingBalancesInput } from "../../../../packages/shared/src/validation";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { api } from "@/lib/api";
import { currentMonth, money, monthLabel } from "@/lib/utils";

// Parse Brazilian decimal text as integer cents, never rounding a float amount.
export function openingMoney(text: string): number {
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text.trim()))
    return NaN;
  const [whole, fraction = ""] = text.trim().replaceAll(".", "").split(",");
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(value) ? value : NaN;
}
const inputValue = (value: number) =>
  (value / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export function readOpeningBalances(form: FormData) {
  if (form.get("hasOpeningBalances") === "no") return [];
  const amounts = form.getAll("openingAmount");
  return openingBalancesInput.parse({
    balances: form.getAll("openingMonth").map((month, index) => ({
      competence: String(month),
      amount: openingMoney(String(amounts[index])),
    })),
  }).balances;
}
export function OpeningBalancesFields({
  invoices = [],
  onboarding = false,
}: {
  invoices?: Invoice[];
  onboarding?: boolean;
}) {
  const [enabled, setEnabled] = useState(!onboarding);
  const [rows, setRows] = useState(() =>
    invoices
      .filter((i) => i.openingBalance > 0)
      .map((i) => ({
        key: i.id,
        month: i.competence,
        value: inputValue(i.openingBalance),
        locked: i.paid > 0,
      })),
  );
  const total = rows.reduce(
    (sum, row) => sum + (openingMoney(row.value) || 0),
    0,
  );
  function addMonth() {
    let month = currentMonth();
    if (rows.length) {
      const date = new Date(
        [...rows].sort((a, b) => a.month.localeCompare(b.month)).at(-1)!.month +
          "-01T12:00:00Z",
      );
      if (!isNaN(date.getTime())) {
        date.setUTCMonth(date.getUTCMonth() + 1);
        month = date.toISOString().slice(0, 7);
      }
    }
    setRows([
      ...rows,
      { key: crypto.randomUUID(), month, value: "0,00", locked: false },
    ]);
  }
  return (
    <section
      className="opening-balances full"
      aria-label="Valores já comprometidos"
    >
      {onboarding ? (
        <fieldset>
          <legend>Este cartão já possui valores comprometidos?</legend>
          <p className="muted">
            Informe os valores que já existem nas suas próximas faturas. Você
            não precisa cadastrar todas as compras antigas agora.
          </p>
          <label className="opening-choice">
            <input
              type="radio"
              name="hasOpeningBalances"
              value="no"
              checked={!enabled}
              onChange={() => setEnabled(false)}
            />{" "}
            Não, começar do zero
          </label>
          <label className="opening-choice">
            <input
              type="radio"
              name="hasOpeningBalances"
              value="yes"
              checked={enabled}
              onChange={() => {
                setEnabled(true);
                if (!rows.length) addMonth();
              }}
            />{" "}
            Sim, adicionar valores existentes
          </label>
        </fieldset>
      ) : (
        <p className="muted">
          Informe somente valores anteriores ao Coflu que ainda não foram
          cadastrados como compras. Cada mês representa uma fatura independente,
          pelo mês de fechamento.
        </p>
      )}
      {enabled && (
        <>
          <h3>Valores já comprometidos</h3>
          {rows.map((row, index) => (
            <div className="opening-row" key={row.key}>
              <div className="opening-cycle">
                <input type="hidden" name="openingMonth" value={row.month} />
                <label>
                  <span>Mês da fatura</span>
                  <select
                    aria-label={"Mês da fatura " + (index + 1)}
                    required
                    value={row.month.slice(5)}
                    disabled={row.locked}
                    onChange={(e) =>
                      setRows(
                        rows.map((r) =>
                          r.key === row.key
                            ? {
                                ...r,
                                month:
                                  row.month.slice(0, 4) + "-" + e.target.value,
                              }
                            : r,
                        ),
                      )
                    }
                  >
                    {Array.from({ length: 12 }, (_, m) => {
                      const value = String(m + 1).padStart(2, "0");
                      return (
                        <option key={value} value={value}>
                          {monthLabel("2026-" + value).split(" de ")[0]}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label>
                  <span>Ano</span>
                  <input
                    aria-label={"Ano da fatura " + (index + 1)}
                    type="number"
                    min="1900"
                    max="2199"
                    required
                    value={row.month.split("-")[0]}
                    readOnly={row.locked}
                    onChange={(e) =>
                      setRows(
                        rows.map((r) =>
                          r.key === row.key
                            ? {
                                ...r,
                                month:
                                  e.target.value +
                                  "-" +
                                  row.month.split("-")[1],
                              }
                            : r,
                        ),
                      )
                    }
                  />
                </label>
              </div>
              <label>
                <span>Valor existente (R$)</span>
                <input
                  aria-label={"Valor existente " + (index + 1)}
                  name="openingAmount"
                  inputMode="decimal"
                  required
                  value={row.value}
                  readOnly={row.locked}
                  onChange={(e) =>
                    setRows(
                      rows.map((r) =>
                        r.key === row.key ? { ...r, value: e.target.value } : r,
                      ),
                    )
                  }
                  onBlur={() => {
                    const amount = openingMoney(row.value);
                    if (Number.isFinite(amount))
                      setRows(
                        rows.map((r) =>
                          r.key === row.key
                            ? { ...r, value: inputValue(amount) }
                            : r,
                        ),
                      );
                  }}
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                disabled={row.locked}
                aria-label={"Remover mês " + (index + 1)}
                onClick={() => setRows(rows.filter((r) => r.key !== row.key))}
              >
                <Trash2 size={17} />
              </Button>
              <small className="opening-row-note muted">
                {row.month &&
                /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(row.month)
                  ? monthLabel(row.month)
                  : "Selecione um mês"}
                {row.locked
                  ? " · Possui pagamentos; estorne-os para editar."
                  : ""}
              </small>
            </div>
          ))}
          {!rows.length && (
            <p className="muted">Nenhum valor inicial informado.</p>
          )}
          <Button type="button" variant="outline" onClick={addMonth}>
            <Plus size={16} /> Adicionar outro mês
          </Button>
          <div className="opening-total">
            <span>Total informado</span>
            <strong>{money(total)}</strong>
          </div>
          <p className="muted">
            Esses valores compõem as faturas e o limite comprometido. Não entram
            como novas despesas nos relatórios.
          </p>
        </>
      )}
    </section>
  );
}
export function OpeningBalancesDialog({
  card,
  invoices,
  close,
  refresh,
}: {
  card: CreditCard;
  invoices: Invoice[];
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const balances = readOpeningBalances(new FormData(event.currentTarget));
      await api("/cards/" + card.id + "/opening-balances", {
        method: "PUT",
        body: JSON.stringify({ balances }),
      });
      await refresh();
      toast.success("Valores iniciais atualizados.");
      close();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.name === "ZodError"
            ? "Confira os meses e valores: não repita meses e use valores positivos em reais, como 2.500,00."
            : e.message
          : "Não foi possível salvar.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title={"Valores iniciais · " + card.name}
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="opening-form">
          <OpeningBalancesFields invoices={invoices} />
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={busy}
            >
              Fechar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Salvando…" : "Salvar valores"}
            </Button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
