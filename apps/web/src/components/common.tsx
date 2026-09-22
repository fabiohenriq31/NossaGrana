import { type ReactNode, useState } from "react";
import {
  Home,
  ShoppingCart,
  Car,
  Receipt,
  Music,
  Wallet,
  ArrowLeftRight,
  Inbox,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { money, monthLabel } from "@/lib/utils";
import { Button } from "./ui/button";
const icons: Record<string, typeof Home> = {
  home: Home,
  food: ShoppingCart,
  car: Car,
  receipt: Receipt,
  music: Music,
  wallet: Wallet,
  transfer: ArrowLeftRight,
};
export function CategoryIcon({
  icon = "wallet",
  color = "var(--positive)",
  square = false,
}: {
  icon?: string;
  color?: string;
  square?: boolean;
}) {
  const Icon = icons[icon] || Wallet;
  return (
    <span
      className={"color-icon " + (square ? "square" : "")}
      style={{ background: color }}
    >
      <Icon size={19} />
    </span>
  );
}
export function BankLogo({ bank, name }: { bank: string; name?: string }) {
  const [failed, setFailed] = useState(false);
  return failed || bank === "outro" ? (
    <span className="bank-logo fallback">
      {(name || bank).slice(0, 2).toUpperCase()}
    </span>
  ) : (
    <img
      className="bank-logo"
      src={"/banks/" + bank + ".svg"}
      alt={name || bank}
      onError={() => setFailed(true)}
    />
  );
}
export function CurrencyValue({
  value,
  className = "",
  signed = false,
}: {
  value: number;
  className?: string;
  signed?: boolean;
}) {
  return (
    <span className={"currency " + className}>
      {signed && value > 0 ? "+ " : ""}
      {money(value)}
    </span>
  );
}
export function ChartCard({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={"panel " + className}>
      <div className="panel-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function EmptyState({
  text = "Nenhum lançamento por aqui.",
  action,
}: {
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={30} />
      <p>{text}</p>
      {action}
    </div>
  );
}
export function LoadingSkeleton() {
  return (
    <div
      className="loading-grid"
      aria-label="Carregando nossas finanças"
      role="status"
    >
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}
export function MonthSelector({
  month,
  setMonth,
}: {
  month: string;
  setMonth: (s: string) => void;
}) {
  function move(n: number) {
    const d = new Date(month + "-01T12:00:00");
    d.setMonth(d.getMonth() + n);
    setMonth(d.toLocaleDateString("sv-SE").slice(0, 7));
  }
  return (
    <div className="month-selector">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Mês anterior"
        onClick={() => move(-1)}
      >
        <ChevronLeft size={17} />
      </Button>
      <span>{monthLabel(month)}</span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Próximo mês"
        onClick={() => move(1)}
      >
        <ChevronRight size={17} />
      </Button>
    </div>
  );
}
