import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Wallet,
  CreditCard,
  ReceiptText,
  NotebookTabs,
  CalendarDays,
  ChartNoAxesCombined,
  Tags,
  Settings,
  Sun,
  Moon,
  ChevronRight,
  ChevronDown,
  Search,
  Bell,
  Ellipsis,
  House,
  HeartPulse,
  PiggyBank,
  Coins,
  ShieldCheck,
  Info,
} from "lucide-react";
import type { Overview } from "../../../../packages/shared/src/types";
import { Dropdown } from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
// Os quatro primeiros são o uso do dia a dia; o resto fica em "Avançado".
export const MAIN_ITEMS = 4;
export const navItems = [
  ["/", "Orçamento", PiggyBank],
  ["/transacoes", "Transações", ArrowLeftRight],
  ["/faturas", "Faturas", ReceiptText],
  ["/cartoes", "Cartões", CreditCard],
  ["/painel", "Painel completo", LayoutDashboard],
  ["/contas", "Contas", Wallet],
  ["/planejamento", "Planejamento", NotebookTabs],
  ["/saude-financeira", "Saúde Financeira", HeartPulse],
  ["/calendario", "Calendário", CalendarDays],
  ["/relatorios", "Relatórios", ChartNoAxesCombined],
  ["/categorias", "Categorias", Tags],
  ["/plano", "Plano e créditos", Coins],
  ["/configuracoes", "Configurações", Settings],
] as const;
const adminItem = ["/admin", "Administração", ShieldCheck] as const;
const initials = (name: string) =>
  name
    .split(/[\s&]+/)
    .filter((w) => w && w.toLowerCase() !== "e")
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
export function Logo() {
  return (
    <span className="logo">
      <img src="/favicon.svg" alt="" />
      <span>Coflu</span>
    </span>
  );
}
export function AppSidebar({
  name,
  theme,
  setTheme,
  admin,
}: {
  name: string;
  theme: string;
  setTheme: (s: string) => void;
  admin: boolean;
}) {
  const items = admin ? [...navItems, adminItem] : navItems;
  return (
    <aside className="sidebar">
      <NavLink to="/" className="brand-link">
        <Logo />
      </NavLink>
      <nav aria-label="Navegação principal">
        {items.map(([path, title, Icon], i) => (
          <div key={path} className="nav-entry">
            {i === MAIN_ITEMS && <span className="nav-section">Avançado</span>}
            <NavLink to={path} end={path === "/"}>
              <Icon size={19} />
              <span>{title}</span>
            </NavLink>
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <NavLink to="/configuracoes" className="profile">
          <span className="avatar small-avatar">{name.slice(0, 1)}</span>
          <span>
            {name}
            <small>Ver perfil</small>
          </span>
          <ChevronRight size={15} />
        </NavLink>
        <div className="theme-selector">
          {[
            ["light", "Claro", Sun],
            ["dark", "Escuro", Moon],
          ].map(([v, label, Icon]) => (
            <Button
              key={v as string}
              variant="ghost"
              aria-pressed={theme === v}
              onClick={() => setTheme(v as string)}
            >
              {typeof Icon !== "string" && <Icon size={17} />}
              <span>{label as string}</span>
            </Button>
          ))}
        </div>
      </div>
    </aside>
  );
}
export function AppHeader({
  onSearch,
  onLogout,
  onNotifications,
  household,
}: {
  onSearch: (s: string) => void;
  onLogout: () => void;
  onNotifications: () => void;
  household: Overview["household"];
}) {
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  return (
    <header className="app-header">
      <form
        className="global-search"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(search);
          navigate("/transacoes");
        }}
      >
        <Search size={18} />
        <input
          aria-label="Busca global"
          placeholder="Buscar transações, categorias, contas..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>
      <div className="header-actions">
        <NavLink
          to="/plano"
          className="credit-chip"
          title="Créditos de IA: plano e histórico"
        >
          <Coins size={16} />
          {household.unlimited ? "∞" : household.credits}
        </NavLink>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Notificações"
          onClick={onNotifications}
        >
          <Bell size={20} />
        </Button>
        <Dropdown
          trigger={
            <Button variant="ghost" className="household">
              <span className="avatar">{initials(household.name)}</span>
              <strong>{household.name}</strong>
              <ChevronDown size={15} />
            </Button>
          }
          items={[
            { label: "Meu perfil", action: () => navigate("/configuracoes") },
            { label: "Plano e créditos", action: () => navigate("/plano") },
            { label: "Sair da conta", action: onLogout },
          ]}
        />
      </div>
    </header>
  );
}
export function MobileNavigation({ admin }: { admin: boolean }) {
  const items = admin ? [...navItems, adminItem] : navItems;
  const [more, setMore] = useState(false);
  return (
    <>
      <nav className="mobile-nav" aria-label="Navegação mobile">
        {[
          ["/", "Orçamento", House],
          ["/transacoes", "Transações", ArrowLeftRight],
          ["/faturas", "Faturas", ReceiptText],
        ].map(([path, label, Icon]) => (
          <NavLink to={path as string} end key={path as string}>
            {typeof Icon !== "string" && <Icon size={21} />}
            <span>{label as string}</span>
          </NavLink>
        ))}
        <button onClick={() => setMore(true)}>
          <Ellipsis size={22} />
          <span>Mais</span>
        </button>
      </nav>
      <Dialog title="Mais opções" open={more} onOpenChange={setMore}>
        <nav className="more-menu">
          {items.slice(3).map(([path, title, Icon]) => (
            <NavLink key={path} to={path} onClick={() => setMore(false)}>
              <Icon size={19} />
              {title}
              <ChevronRight size={16} />
            </NavLink>
          ))}
        </nav>
      </Dialog>
    </>
  );
}
export function Shell({
  children,
  data,
  theme,
  setTheme,
  onSearch,
  onLogout,
  onNotifications,
}: {
  children: ReactNode;
  data: Overview;
  theme: string;
  setTheme: (s: string) => void;
  onSearch: (s: string) => void;
  onLogout: () => void;
  onNotifications: () => void;
}) {
  return (
    <>
      <AppSidebar
        name={data.user.name}
        theme={theme}
        setTheme={setTheme}
        admin={data.user.role === "ADMIN"}
      />
      <div className="main-shell">
        <AppHeader
          onSearch={onSearch}
          onLogout={onLogout}
          onNotifications={onNotifications}
          household={data.household}
        />
        {data.banner && (
          <div className={"app-banner " + data.banner.tone} role="status">
            <Info size={16} />
            {data.banner.message}
          </div>
        )}
        <main>{children}</main>
      </div>
      <MobileNavigation admin={data.user.role === "ADMIN"} />
    </>
  );
}
