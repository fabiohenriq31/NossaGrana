import { useState, type FormEvent, type ReactNode } from "react";
import { AlertDialog as A, Select as S } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type {
  Overview,
  Transaction,
  Account,
  CreditCard,
  Category,
  Invoice,
} from "../../../../packages/shared/src/types";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { BankLogo } from "./common";
import { api } from "@/lib/api";
import { today, money } from "@/lib/utils";
export type EditorState =
  | { kind: "transaction"; item?: Transaction }
  | { kind: "account"; item?: Account }
  | { kind: "card"; item?: CreditCard }
  | { kind: "category"; item?: Category }
  | { kind: "pay"; item: Invoice }
  | null;
const people = ["Fábio", "Bianca", "Casa"].map((id) => ({ id, name: id }));
export const paymentMethods = [
  ["PIX", "PIX"],
  ["DEBITO", "Débito"],
  ["CREDITO", "Crédito"],
  ["DINHEIRO", "Dinheiro"],
  ["BOLETO", "Boleto"],
  ["TRANSFERENCIA", "Transferência"],
  ["OUTRO", "Outro"],
];
function Field({
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
function Input({
  name,
  label,
  value = "",
  type = "text",
  required = true,
  full = false,
  min,
  max,
}: {
  name: string;
  label: string;
  value?: string | number;
  type?: string;
  required?: boolean;
  full?: boolean;
  min?: number;
  max?: number;
}) {
  return (
    <Field label={label} full={full}>
      <input
        aria-label={label}
        name={name}
        defaultValue={value}
        type={type}
        required={required}
        min={min}
        max={max}
      />
    </Field>
  );
}
function Select({
  name,
  label,
  value = "",
  items,
  required = true,
}: {
  name: string;
  label: string;
  value?: string;
  items: { id: string; name: string }[];
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <select
        name={name}
        aria-label={label}
        defaultValue={value}
        required={required}
      >
        <option value="">Selecione</option>
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
function BankSelect({ data, value }: { data: Overview; value?: string }) {
  const [bank, setBank] = useState(value || "");
  return (
    <Field label="Banco">
      <S.Root name="bankId" value={bank} onValueChange={setBank} required>
        <S.Trigger aria-label="Banco" className="bank-select-trigger">
          {bank ? (
            <>
              <BankLogo bank={bank} />
              <span>{data.banks.find((b) => b.id === bank)?.name}</span>
            </>
          ) : (
            <span>Selecione o banco</span>
          )}
          <ChevronDown size={16} />
        </S.Trigger>
        <S.Portal>
          <S.Content
            className="bank-select-content"
            position="popper"
            sideOffset={5}
          >
            <S.Viewport>
              {data.banks.map((b) => (
                <S.Item className="bank-select-item" key={b.id} value={b.id}>
                  <BankLogo bank={b.id} />
                  <S.ItemText>{b.name}</S.ItemText>
                  <S.ItemIndicator>
                    <Check size={16} />
                  </S.ItemIndicator>
                </S.Item>
              ))}
            </S.Viewport>
          </S.Content>
        </S.Portal>
      </S.Root>
    </Field>
  );
}
export function parseMoney(value: string) {
  const cleaned = value.trim().replace(/R\$|\s/g, "");
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized))
    throw new Error("Informe um valor com até duas casas decimais.");
  const sign = normalized.startsWith("-") ? -1 : 1;
  const [whole, part = ""] = normalized.replace("-", "").split(".");
  return sign * (Number(whole) * 100 + Number(part.padEnd(2, "0")));
}
const inputMoney = (n: number) => (n / 100).toFixed(2).replace(".", ",");
export function ConfirmAction({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action: () => Promise<void>;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false);
  return (
    <A.Root open={open} onOpenChange={setOpen}>
      <A.Trigger asChild>{children}</A.Trigger>
      <A.Portal>
        <A.Overlay className="dialog-overlay" />
        <A.Content className="dialog-content">
          <A.Title className="dialog-title">{title}</A.Title>
          <A.Description>{description}</A.Description>
          <div className="form-actions">
            <A.Cancel asChild>
              <Button variant="outline">Voltar</Button>
            </A.Cancel>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await action();
                  setOpen(false);
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Aguarde…" : "Confirmar"}
            </Button>
          </div>
        </A.Content>
      </A.Portal>
    </A.Root>
  );
}
function TransactionFields({
  data,
  item,
}: {
  data: Overview;
  item?: Transaction;
}) {
  const [type, setType] = useState(item?.type || "DESPESA"),
    [method, setMethod] = useState(item?.paymentMethod || "PIX"),
    [category, setCategory] = useState(item?.categoryId || ""),
    [repeat, setRepeat] = useState("");
  const accounts = data.accounts
    .filter((a) => a.active)
    .map((a) => ({ id: a.id, name: a.owner + " · " + a.name }));
  return (
    <>
      <Field label="Tipo">
        <select
          aria-label="Tipo"
          name="type"
          value={type}
          onChange={(e) => {
            setType(e.target.value as Transaction["type"]);
            setMethod("PIX");
          }}
        >
          <option value="DESPESA">Despesa</option>
          <option value="RECEITA">Receita</option>
          <option value="TRANSFERENCIA">Transferência</option>
        </select>
      </Field>
      <Select
        name="owner"
        label="Responsável"
        value={item?.owner || "Fábio"}
        items={people}
      />
      <Input
        name="description"
        label="Descrição"
        value={item?.description}
        full
      />
      <Input
        name="amount"
        label="Valor (R$)"
        value={inputMoney(item?.amount || 0)}
      />
      <Input
        name="date"
        label="Data"
        type="date"
        value={item?.date.slice(0, 10) || today()}
      />
      {type === "DESPESA" && (
        <Field label="Forma de pagamento">
          <select
            aria-label="Forma de pagamento"
            name="paymentMethod"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {paymentMethods.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {type === "DESPESA" && method === "CREDITO" ? (
        <Select
          name="cardId"
          label="Cartão"
          value={item?.cardId || ""}
          items={data.cards
            .filter((c) => c.active)
            .map((c) => ({ id: c.id, name: c.name + " • " + c.last4 }))}
        />
      ) : (
        <Select
          name="accountId"
          label={
            type === "TRANSFERENCIA"
              ? "Conta de origem"
              : type === "RECEITA"
                ? "Conta de destino"
                : "Conta"
          }
          value={item?.accountId || ""}
          items={accounts}
        />
      )}
      {type === "TRANSFERENCIA" ? (
        <Select
          name="destinationAccountId"
          label="Conta de destino"
          value={item?.destinationAccountId || ""}
          items={accounts}
        />
      ) : (
        <>
          <Field label="Categoria">
            <select
              aria-label="Categoria"
              name="categoryId"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required={type === "DESPESA"}
            >
              <option value="">Selecione</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Select
            key={category}
            name="subcategoryId"
            label="Subcategoria"
            value={item?.subcategoryId || ""}
            items={
              data.categories.find((c) => c.id === category)?.subcategories ||
              []
            }
            required={false}
          />
        </>
      )}
      <Select
        name="status"
        label="Situação"
        value={item?.status || "CONFIRMADA"}
        items={[
          { id: "CONFIRMADA", name: "Confirmada" },
          { id: "PENDENTE", name: "Pendente" },
        ]}
      />
      {type === "DESPESA" && method === "CREDITO" && !item && (
        <Input
          name="installments"
          label="Número de parcelas"
          type="number"
          value={1}
          min={1}
          max={120}
        />
      )}
      <Input
        name="tags"
        label="Tags (separadas por vírgula)"
        value={item?.tags.join(", ")}
        required={false}
        full
      />
      <Field label="Observações" full>
        <textarea name="notes" defaultValue={item?.notes} rows={2} />
      </Field>
      {!item && (
        <>
          <Field label="Repetir">
            <select
              aria-label="Repetir"
              name="frequency"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            >
              <option value="">Não repetir</option>
              <option value="MENSAL">Mensal</option>
              <option value="SEMANAL">Semanal</option>
              <option value="ANUAL">Anual</option>
              <option value="PERSONALIZADA">Personalizada (dias)</option>
            </select>
          </Field>
          {repeat && (
            <Input
              name="interval"
              label="A cada (períodos)"
              type="number"
              value={1}
              min={1}
              max={365}
            />
          )}
        </>
      )}
      {item?.installmentPurchaseId && (
        <p className="muted full">
          Correções de valor afetam somente esta parcela. Data e cartão ficam
          preservados.
        </p>
      )}
    </>
  );
}
function EntityFields({
  state,
  data,
}: {
  state: Exclude<EditorState, null>;
  data: Overview;
}) {
  if (state.kind === "transaction")
    return <TransactionFields data={data} item={state.item} />;
  if (state.kind === "account" || state.kind === "card") {
    const i = state.item;
    return (
      <>
        <Input name="name" label="Nome" value={i?.name} full />
        <BankSelect data={data} value={i?.bankId} />
        <Select
          name="owner"
          label="Titular"
          value={i?.owner || "Fábio"}
          items={people}
        />
        {state.kind === "account" ? (
          <>
            <Select
              name="type"
              label="Tipo da conta"
              value={state.item?.type || "Corrente"}
              items={[
                "Corrente",
                "Poupança",
                "Carteira",
                "Dinheiro",
                "Digital",
                "Investimento",
              ].map((id) => ({ id, name: id }))}
            />
            <Input
              name="initialBalance"
              label="Saldo inicial (R$)"
              value={inputMoney(state.item?.initialBalance || 0)}
            />
            <Input
              name="openingDate"
              label="Data de referência do saldo inicial"
              type="date"
              value={state.item?.openingDate.slice(0, 10) || today()}
            />
            <Input
              name="color"
              label="Cor da conta"
              type="color"
              value={state.item?.color || "#4389ff"}
            />
            <Input
              name="notes"
              label="Observação"
              value={state.item?.notes}
              required={false}
              full
            />
            <p className="muted full">
              Informe o saldo no início da data de referência. Após o primeiro
              lançamento, esse saldo fica preservado.
            </p>
          </>
        ) : (
          <>
            <Select
              name="brand"
              label="Bandeira"
              value={state.item?.brand || "Mastercard"}
              items={["Mastercard", "Visa", "Elo", "American Express"].map(
                (id) => ({ id, name: id }),
              )}
            />
            <Input
              name="last4"
              label="Últimos 4 dígitos"
              value={state.item?.last4}
              required={false}
            />
            <Input
              name="limit"
              label="Limite (R$)"
              value={inputMoney(state.item?.limit || 0)}
            />
            <Field label="Cor do cartão">
              <select
                aria-label="Cor do cartão"
                name="color"
                defaultValue={
                  state.item?.color ||
                  "linear-gradient(115deg, #9114d6, #4e1098)"
                }
              >
                {[
                  ["linear-gradient(115deg, #9114d6, #4e1098)", "Roxo Nubank"],
                  ["linear-gradient(115deg, #184fab, #202371)", "Azul"],
                  ["linear-gradient(115deg, #344856, #102331)", "Grafite"],
                  ["linear-gradient(115deg, #169c81, #09594e)", "Verde"],
                ].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Input
              name="closingDay"
              label="Dia de fechamento"
              type="number"
              min={1}
              max={31}
              value={state.item?.closingDay || 15}
            />
            <Input
              name="dueDay"
              label="Dia de vencimento"
              type="number"
              min={1}
              max={31}
              value={state.item?.dueDay || 22}
            />
            <Select
              name="paymentAccountId"
              label="Conta para pagamento da fatura"
              value={state.item?.paymentAccountId || ""}
              required={false}
              items={data.accounts
                .filter((a) => a.active)
                .map((a) => ({ id: a.id, name: a.owner + " · " + a.name }))}
            />
          </>
        )}
        <Select
          name="active"
          label="Status"
          value={i?.active === false ? "false" : "true"}
          items={[
            { id: "true", name: "Ativa" },
            { id: "false", name: "Arquivada" },
          ]}
        />
      </>
    );
  }
  if (state.kind === "category")
    return (
      <>
        <Input name="name" label="Nome" value={state.item?.name} full />
        <Input
          name="color"
          label="Cor"
          value={state.item?.color || "#8a91fa"}
          type="color"
        />
        <Select
          name="icon"
          label="Ícone"
          value={state.item?.icon || "wallet"}
          items={[
            { id: "home", name: "Moradia" },
            { id: "food", name: "Alimentação" },
            { id: "car", name: "Transporte" },
            { id: "receipt", name: "Assinaturas" },
            { id: "music", name: "Lazer" },
            { id: "wallet", name: "Outros" },
          ]}
        />
      </>
    );
  return (
    <>
      <Select
        name="accountId"
        label="Pagar com a conta"
        value={
          data.cards.find((c) => c.id === state.item.cardId)
            ?.paymentAccountId || ""
        }
        items={data.accounts
          .filter((a) => a.active)
          .map((a) => ({ id: a.id, name: a.owner + " · " + a.name }))}
      />
      <Input
        name="amount"
        label="Valor do pagamento (R$)"
        value={inputMoney(state.item.remaining)}
      />
      <Input
        name="date"
        label="Data do pagamento"
        type="date"
        value={today()}
      />
      <p className="full">Restante da fatura: {money(state.item.remaining)}</p>
    </>
  );
}
export function Editor({
  state,
  data,
  close,
  refresh,
}: {
  state: Exclude<EditorState, null>;
  data: Overview;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [settling, setSettling] = useState(false);
  const title =
    state.kind === "pay"
      ? "Pagar fatura"
      : (state.item ? "Editar " : "Nova ") +
        {
          transaction: "transação",
          account: "conta",
          card: "cartão",
          category: "categoria",
        }[state.kind];
  const readOnly =
    state.kind === "transaction" &&
    !!(state.item?.paymentInvoiceId || state.item?.status === "CANCELADA");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const f = new FormData(e.currentTarget),
        str = (key: string) => String(f.get(key) || ""),
        id = (key: string) => str(key) || null;
      let payload: Record<string, unknown>,
        path = "";
      if (settling && state.kind === "transaction") {
        await api("/transactions/" + state.item!.id + "/confirm", {
          method: "PATCH",
          body: JSON.stringify({
            date: str("date"),
            ...(state.item?.cardId ? {} : { accountId: str("accountId") }),
          }),
        });
        await refresh();
        toast.success("Lançamento confirmado.");
        close();
        return;
      }
      if (state.kind === "transaction") {
        payload = {
          description: str("description"),
          amount: parseMoney(str("amount")),
          date: str("date"),
          type: str("type"),
          paymentMethod:
            str("type") === "TRANSFERENCIA"
              ? "TRANSFERENCIA"
              : str("paymentMethod") || "OUTRO",
          status: str("status"),
          owner: str("owner"),
          accountId: id("accountId"),
          cardId: id("cardId"),
          destinationAccountId: id("destinationAccountId"),
          categoryId: id("categoryId"),
          subcategoryId: id("subcategoryId"),
          notes: str("notes"),
          tags: str("tags")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          installments: Number(str("installments") || 1),
        };
        if (str("frequency")) {
          await api("/recurrences", {
            method: "POST",
            body: JSON.stringify({
              transaction: payload,
              frequency: str("frequency"),
              interval: Number(str("interval") || 1),
              nextDate: str("date"),
            }),
          });
          await refresh();
          toast.success(
            "Recorrência criada com a primeira ocorrência pendente.",
          );
          close();
          return;
        }
        path = "/transactions";
      } else if (state.kind === "account") {
        path = "/accounts";
        payload = {
          name: str("name"),
          bankId: str("bankId"),
          owner: str("owner"),
          type: str("type"),
          initialBalance: parseMoney(str("initialBalance")),
          openingDate: str("openingDate"),
          color: str("color"),
          notes: str("notes"),
          active: str("active") === "true",
        };
      } else if (state.kind === "card") {
        path = "/cards";
        payload = {
          name: str("name"),
          bankId: str("bankId"),
          owner: str("owner"),
          brand: str("brand"),
          last4: str("last4"),
          limit: parseMoney(str("limit")),
          closingDay: Number(str("closingDay")),
          dueDay: Number(str("dueDay")),
          paymentAccountId: id("paymentAccountId"),
          color: str("color"),
          active: str("active") === "true",
        };
      } else if (state.kind === "category") {
        path = "/categories";
        payload = { name: str("name"), color: str("color"), icon: str("icon") };
      } else {
        path = "/invoices/" + state.item.id + "/pay";
        payload = {
          accountId: str("accountId"),
          amount: parseMoney(str("amount")),
          date: str("date"),
        };
      }
      await api(
        path + (state.item && state.kind !== "pay" ? "/" + state.item.id : ""),
        {
          method: state.item && state.kind !== "pay" ? "PUT" : "POST",
          body: JSON.stringify(payload),
        },
      );
      await refresh();
      toast.success("Salvo com sucesso.");
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(series = false) {
    if (!state.item) return;
    const path =
      series && state.kind === "transaction"
        ? "/installments/" + state.item.installmentPurchaseId
        : "/" +
          {
            transaction: "transactions",
            account: "accounts",
            card: "cards",
            category: "categories",
            pay: "invoices",
          }[state.kind] +
          "/" +
          state.item.id;
    await api(path, { method: "DELETE" });
    await refresh();
    toast.success("Registro atualizado.");
    close();
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy) close();
      }}
      title={settling ? "Confirmar pagamento/recebimento" : title}
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {readOnly && !settling ? (
        <div className="linked-detail">
          <h3>{state.item?.description}</h3>
          <strong>{money(state.item?.amount || 0)}</strong>
          <p>
            {state.item?.status === "CANCELADA"
              ? "Lançamento cancelado, preservado no histórico e fora dos saldos."
              : "Pagamento de fatura. Cancelá-lo estorna o pagamento e recompõe o saldo."}
          </p>
        </div>
      ) : (
        <form id="editor-form" onSubmit={submit}>
          <div className="form-grid">
            {settling && state.kind === "transaction" ? (
              <>
                {!state.item?.cardId && (
                  <Select
                    name="accountId"
                    label="Conta utilizada"
                    value={state.item?.accountId || ""}
                    items={data.accounts
                      .filter((a) => a.active)
                      .map((a) => ({
                        id: a.id,
                        name: a.owner + " · " + a.name,
                      }))}
                  />
                )}
                <Input
                  name="date"
                  label="Data da confirmação"
                  type="date"
                  value={today()}
                />
              </>
            ) : (
              <EntityFields state={state} data={data} />
            )}
          </div>
        </form>
      )}
      <div className="form-actions">
        {state.item &&
          state.kind !== "pay" &&
          !settling &&
          !(
            state.kind === "transaction" && state.item.status === "CANCELADA"
          ) && (
            <ConfirmAction
              title={
                state.kind === "account" || state.kind === "card"
                  ? "Arquivar registro?"
                  : "Cancelar registro?"
              }
              description="Os saldos e vínculos serão atualizados. Lançamentos cancelados ficam preservados no histórico."
              action={() => remove()}
            >
              <Button variant="ghost" className="delete-action">
                {state.kind === "account" || state.kind === "card"
                  ? "Arquivar"
                  : state.kind === "category"
                    ? "Excluir"
                    : "Cancelar lançamento"}
              </Button>
            </ConfirmAction>
          )}
        {state.kind === "transaction" &&
          state.item?.installmentPurchaseId &&
          state.item.status !== "CANCELADA" &&
          !settling && (
            <ConfirmAction
              title="Cancelar todas as parcelas?"
              description="Todas as parcelas desta compra serão canceladas se as faturas não tiverem pagamentos."
              action={() => remove(true)}
            >
              <Button variant="ghost">Cancelar compra</Button>
            </ConfirmAction>
          )}
        {state.kind === "transaction" &&
          state.item?.status === "PENDENTE" &&
          !settling && (
            <Button variant="outline" onClick={() => setSettling(true)}>
              Confirmar lançamento
            </Button>
          )}
        <Button variant="outline" onClick={close} disabled={busy}>
          Fechar
        </Button>
        {(!readOnly || settling) && (
          <Button type="submit" form="editor-form" disabled={busy}>
            {busy ? "Salvando…" : settling ? "Confirmar" : "Salvar"}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
