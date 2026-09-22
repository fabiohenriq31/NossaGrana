import { useState } from "react";
import { Plus, ChevronRight, LockKeyhole } from "lucide-react";
import type {
  Overview,
  Account,
  CreditCard,
  Invoice,
} from "../../../../packages/shared/src/types";
import { Button } from "@/components/ui/button";
import {
  BankLogo,
  CurrencyValue,
  EmptyState,
  MonthSelector,
} from "@/components/common";
import { CreditCardVisual } from "@/components/CreditCardVisual";
import { dateLabel } from "@/lib/utils";
export function AccountsPage({
  data,
  onEdit,
}: {
  data: Overview;
  onEdit: (a?: Account) => void;
}) {
  const [archived, setArchived] = useState(false);
  const accounts = data.accounts.filter((a) => archived || a.active);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Contas</h1>
          <p>Todas as suas contas em um só lugar.</p>
        </div>
        <Button onClick={() => onEdit()}>
          <Plus size={17} />
          Nova conta
        </Button>
      </div>
      <div className="section-note">
        <span>
          {accounts.length} contas · Saldo total{" "}
          <CurrencyValue value={data.analytics.accountTotal} />
        </span>
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{" "}
          Mostrar arquivadas
        </label>
      </div>
      <div className="accounts-grid">
        {accounts.map((a) => (
          <button
            className={"account-card panel " + (!a.active ? "archived" : "")}
            key={a.id}
            onClick={() => onEdit(a)}
          >
            <BankLogo bank={a.bankId} />
            <span>
              <h2>{data.banks.find((b) => b.id === a.bankId)?.name}</h2>
              <small>
                {a.owner} · {a.name}
              </small>
              {!a.active && <small>Arquivada</small>}
            </span>
            <CurrencyValue value={a.balance} />
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
      {!accounts.length && (
        <EmptyState text="Cadastre uma conta para começar." />
      )}
    </>
  );
}
export function CardsPage({
  data,
  month,
  onEdit,
}: {
  data: Overview;
  month: string;
  onEdit: (c?: CreditCard) => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Cartões</h1>
          <p>Gerencie seus cartões de crédito.</p>
        </div>
        <Button onClick={() => onEdit()}>
          <Plus size={17} />
          Novo cartão
        </Button>
      </div>
      <div className="credit-cards-grid">
        {data.cards.map((c) => (
          <section className="panel" key={c.id}>
            <div className="panel-heading">
              <h2>{c.name}</h2>
              <Button variant="ghost" size="sm" onClick={() => onEdit(c)}>
                Editar
                <ChevronRight size={14} />
              </Button>
            </div>
            <CreditCardVisual
              card={c}
              invoice={data.invoices.find(
                (i) => i.cardId === c.id && i.competence === month,
              )}
            />
            <div className="card-owner">
              {c.owner} · {c.brand}
              <span>{c.active ? "Ativo" : "Arquivado"}</span>
            </div>
          </section>
        ))}
      </div>
      {!data.cards.length && (
        <EmptyState text="Adicione um cartão de crédito." />
      )}
      <p className="privacy-note">
        <LockKeyhole size={14} /> Somente os últimos quatro dígitos são
        armazenados.
      </p>
    </>
  );
}
export function InvoicesPage({
  data,
  month,
  setMonth,
  onPay,
  onEdit,
}: {
  data: Overview;
  month: string;
  setMonth: (m: string) => void;
  onPay: (i: Invoice) => void;
  onEdit: (t: Overview["transactions"][number]) => void;
}) {
  const rows = data.invoices.filter((i) => i.competence === month);
  const [detail, setDetail] = useState<string | null>(null);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Faturas</h1>
          <p>Acompanhe os fechamentos e pagamentos.</p>
        </div>
        <MonthSelector month={month} setMonth={setMonth} />
      </div>
      <div className="invoices-grid">
        {rows.map((i) => {
          const c = data.cards.find((c) => c.id === i.cardId)!;
          return (
            <section className="panel invoice-card" key={i.id}>
              <div className="panel-heading">
                <div className="inline-bank">
                  <BankLogo bank={c.bankId} />
                  <h2>
                    {c.name} • {c.last4}
                  </h2>
                </div>
                <span
                  className={
                    "status-pill " +
                    (i.status === "Paga"
                      ? "income"
                      : i.status === "Atrasada"
                        ? "expense"
                        : "")
                  }
                >
                  {i.status}
                </span>
              </div>
              <div className="invoice-total">
                <small>
                  Fatura de {i.competence.split("-").reverse().join("/")}
                </small>
                <CurrencyValue value={i.total} />
              </div>
              <div className="invoice-facts">
                <span>
                  Fechamento<b>{dateLabel(i.closingDate)}</b>
                </span>
                <span>
                  Vencimento<b>{dateLabel(i.dueDate)}</b>
                </span>
                <span>
                  Valor pago
                  <b>
                    <CurrencyValue value={i.paid} />
                  </b>
                </span>
                <span>
                  Restante
                  <b>
                    <CurrencyValue value={i.remaining} />
                  </b>
                </span>
              </div>
              <div className="form-actions">
                <Button
                  variant="outline"
                  onClick={() => setDetail(detail === i.id ? null : i.id)}
                >
                  {detail === i.id ? "Ocultar" : "Ver lançamentos"}
                </Button>
                <Button disabled={i.remaining <= 0} onClick={() => onPay(i)}>
                  Pagar fatura
                </Button>
              </div>
              {detail === i.id && (
                <div className="invoice-transactions">
                  {data.transactions
                    .filter(
                      (t) =>
                        t.invoiceId === i.id || t.paymentInvoiceId === i.id,
                    )
                    .map((t) => (
                      <div key={t.id}>
                        <span>
                          <button onClick={() => onEdit(t)}>
                            {t.description}
                          </button>
                          <small>
                            {dateLabel(t.date)} ·{" "}
                            {t.paymentInvoiceId
                              ? data.accounts.find((a) => a.id === t.accountId)
                                  ?.name + " · "
                              : ""}{" "}
                            {t.status === "PENDENTE"
                              ? "Pendente"
                              : t.status === "CANCELADA"
                                ? "Cancelada"
                                : "Confirmada"}
                          </small>
                        </span>
                        <CurrencyValue value={t.amount} />
                      </div>
                    ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {!rows.length && <EmptyState text="Nenhuma fatura nesta competência." />}
    </>
  );
}
