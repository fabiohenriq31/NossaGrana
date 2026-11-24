import type {
  CreditCard,
  Invoice,
} from "../../../../packages/shared/src/types";
import { BankLogo, CurrencyValue } from "./common";
import { dateLabel, today } from "@/lib/utils";

/**
 * Fatura atual = a primeira que ainda não fechou (o dia do fechamento ainda
 * entra nela). Também devolve a fatura já fechada que ainda tem saldo a pagar.
 */
export function cardInvoices(cardId: string, invoices: Invoice[]) {
  const day = today();
  const mine = invoices
    .filter((i) => i.cardId === cardId)
    .sort((a, b) => a.closingDate.localeCompare(b.closingDate));
  return {
    open: mine.find((i) => i.closingDate.slice(0, 10) >= day),
    toPay: mine.find(
      (i) => i.closingDate.slice(0, 10) < day && i.remaining > 0,
    ),
  };
}

export function CreditCardVisual({
  card,
  invoices,
  details = true,
}: {
  card: CreditCard;
  invoices: Invoice[];
  details?: boolean;
}) {
  const { open: invoice, toPay } = cardInvoices(card.id, invoices);
  return (
    <div className="card-visual-wrap">
      <div className="credit-card" style={{ background: card.color }}>
        <div className="credit-top">
          <BankLogo bank={card.bankId} name={card.name} />
          {card.brand === "Mastercard" ? (
            <span className="mastercard" aria-label={card.brand}>
              <i />
              <i />
            </span>
          ) : (
            <strong className="card-brand">{card.brand}</strong>
          )}
        </div>
        <p className="card-number">•••• {card.last4}</p>
        <div className="credit-bottom">
          <small>Limite disponível</small>
          <CurrencyValue value={card.available} />
        </div>
      </div>
      {details && (
        <div className="credit-details">
          <div>
            <span>Fatura atual</span>
            <strong>
              <CurrencyValue value={invoice?.total || 0} />
            </strong>
          </div>
          <div>
            <span>
              Fecha em{" "}
              <b>
                {invoice
                  ? dateLabel(invoice.closingDate)
                  : "dia " + card.closingDay}
              </b>
            </span>
            <span>
              Vence em{" "}
              <b>
                {invoice ? dateLabel(invoice.dueDate) : "dia " + card.dueDay}
              </b>
            </span>
          </div>
          {toPay && (
            <p
              className={
                "card-to-pay" + (toPay.status === "Atrasada" ? " late" : "")
              }
            >
              <span>
                Fatura fechada{" "}
                {toPay.status === "Atrasada" ? "· atrasada" : "a pagar"}
              </span>
              <span>
                <CurrencyValue value={toPay.remaining} /> · vence{" "}
                {dateLabel(toPay.dueDate)}
              </span>
            </p>
          )}
          <progress
            max={card.limit || 1}
            value={card.used}
            aria-label="Utilização do limite"
          />
        </div>
      )}
    </div>
  );
}
