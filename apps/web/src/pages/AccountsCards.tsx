import { useState } from "react";
import {
  Plus,
  ChevronRight,
  LockKeyhole,
  CreditCard as CreditCardIcon,
  Utensils,
  ShoppingCart,
  Bus,
  Fuel,
  Layers,
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
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
import { OpeningBalancesDialog } from "@/components/OpeningBalances";
import { Link } from "react-router-dom";
import { dateLabel, monthLabel, money } from "@/lib/utils";
import { isBenefitAccount } from "../../../../packages/shared/src/validation";
export function AccountsPage({
  data,
  onEdit,
}: {
  data: Overview;
  onEdit: (a?: Account) => void;
}) {
  const [archived, setArchived] = useState(false);
  const accounts = data.accounts.filter(
    (a) => (archived || a.active) && !isBenefitAccount(a.type),
  );
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
          {accounts.length} contas · Saldo{" "}
          <CurrencyValue
            value={accounts
              .filter((a) => a.active)
              .reduce((t, a) => t + a.balance, 0)}
          />
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
const cardKinds = [
  ["CREDITO", CreditCardIcon, "Crédito", "Limite, fatura e parcelas"],
  ["Vale-refeição", Utensils, "Refeição", "Restaurantes e lanches"],
  ["Vale-alimentação", ShoppingCart, "Alimentação", "Mercado e padaria"],
  ["Vale-transporte", Bus, "Transporte", "Ônibus, metrô e trem"],
  ["Vale-combustível", Fuel, "Combustível", "Abastecimento do carro"],
  ["Multibenefício", Layers, "Multibenefício", "Flash, Caju, Swile e afins"],
] as const;

export function CardsPage({
  data,
  onEdit,
  onBenefit,
  refresh,
}: {
  data: Overview;
  onEdit: (c?: CreditCard) => void;
  onBenefit: (a?: Account, type?: string) => void;
  refresh: () => Promise<void>;
}) {
  const [openingCard, setOpeningCard] = useState<CreditCard | null>(null);
  const [choosing, setChoosing] = useState(false);
  const benefits = data.accounts.filter(
    (a) => a.active && isBenefitAccount(a.type),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Cartões</h1>
          <p>Cartões de crédito e de benefício.</p>
        </div>
        <Button onClick={() => setChoosing(true)}>
          <Plus size={17} />
          Novo cartão
        </Button>
      </div>
      <Dialog
        open={choosing}
        onOpenChange={setChoosing}
        title="Novo cartão"
        description="Qual tipo de cartão você quer cadastrar?"
      >
        <div className="card-kinds">
          {cardKinds.map(([id, Icon, label, hint]) => (
            <button
              key={id}
              type="button"
              className="card-kind"
              onClick={() => {
                setChoosing(false);
                if (id === "CREDITO") onEdit();
                else onBenefit(undefined, id);
              }}
            >
              <Icon size={22} />
              <span>
                {label}
                <small>{hint}</small>
              </span>
              <ChevronRight size={18} />
            </button>
          ))}
        </div>
      </Dialog>
      {benefits.length > 0 && (
        <>
          <h2 className="cards-section-title">Cartões de benefício</h2>
          <div className="benefit-grid">
            {benefits.map((a) => {
              const recharge = data.recurrences.find(
                (r) => r.active && r.template.accountId === a.id,
              );
              return (
                <button
                  key={a.id}
                  type="button"
                  className="benefit-card panel"
                  onClick={() => onBenefit(a)}
                >
                  <span
                    className="benefit-chip"
                    style={{ background: a.color }}
                  >
                    <BankLogo bank={a.bankId} />
                    {a.type}
                  </span>
                  <span className="benefit-name">
                    {a.name}
                    <small>
                      {a.owner} ·{" "}
                      {data.banks.find((b) => b.id === a.bankId)?.name}
                    </small>
                  </span>
                  <span className="benefit-balance">
                    <small>Saldo disponível</small>
                    <CurrencyValue value={a.balance} />
                  </span>
                  <small className="benefit-recharge">
                    {recharge
                      ? `Recarga de ${money(recharge.amount)} todo dia ${Number(recharge.nextDate.slice(8, 10))}`
                      : "Sem recarga programada"}
                  </small>
                </button>
              );
            })}
          </div>
        </>
      )}
      {benefits.length > 0 && data.cards.length > 0 && (
        <h2 className="cards-section-title">Cartões de crédito</h2>
      )}
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
            <CreditCardVisual card={c} invoices={data.invoices} />
            <div className="card-owner">
              {c.owner} · {c.brand}
              <span>{c.active ? "Ativo" : "Arquivado"}</span>
            </div>
            <div className="invoice-facts card-limit-facts">
              <span>
                Limite total
                <b>
                  <CurrencyValue value={c.limit} />
                </b>
              </span>
              <span>
                Limite comprometido
                <b>
                  <CurrencyValue value={c.used} />
                </b>
              </span>
            </div>
            <Button
              variant="outline"
              disabled={!c.active}
              onClick={() => setOpeningCard(c)}
            >
              Valores iniciais
            </Button>
            <div className="card-upcoming">
              <h3>Próximas faturas</h3>
              {data.invoices
                .filter((i) => i.cardId === c.id && i.remaining > 0)
                .map((i) => (
                  <div key={i.id}>
                    <Link to={"/faturas?month=" + i.competence}>
                      {monthLabel(i.competence)}
                    </Link>
                    <CurrencyValue value={i.remaining} />
                  </div>
                ))}
              {!data.invoices.some(
                (i) => i.cardId === c.id && i.remaining > 0,
              ) && <p className="muted">Nenhuma fatura em aberto.</p>}
            </div>
          </section>
        ))}
      </div>
      {!data.cards.length && !benefits.length && (
        <EmptyState text="Adicione um cartão de crédito ou de benefício." />
      )}
      {openingCard && (
        <OpeningBalancesDialog
          card={openingCard}
          invoices={data.invoices.filter((i) => i.cardId === openingCard.id)}
          close={() => setOpeningCard(null)}
          refresh={refresh}
        />
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
                  {i.openingBalance > 0 && (
                    <section className="invoice-opening">
                      <h3>Valores anteriores ao Coflu</h3>
                      <div>
                        <span>Saldo inicial/importado</span>
                        <CurrencyValue value={i.openingBalance} />
                      </div>
                    </section>
                  )}
                  <h3>Lançamentos</h3>
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
