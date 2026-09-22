import type {
  CreditCard,
  Invoice,
} from "../../../../packages/shared/src/types";
import { BankLogo, CurrencyValue } from "./common";
import { dateLabel } from "@/lib/utils";
export function CreditCardVisual({
  card,
  invoice,
  details = true,
}: {
  card: CreditCard;
  invoice?: Invoice;
  details?: boolean;
}) {
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
