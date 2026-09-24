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
} from "lucide-react";
import { Dropdown } from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
export const navItems = [
  ["/", "Dashboard", LayoutDashboard],
  ["/transacoes", "Transações", ArrowLeftRight],
  ["/contas", "Contas", Wallet],
  ["/cartoes", "Cartões", CreditCard],
  ["/faturas", "Faturas", ReceiptText],
  ["/planejamento", "Planejamento", NotebookTabs],
  ["/saude-financeira", "Saúde Financeira", HeartPulse],
  ["/calendario", "Calendário", CalendarDays],
  ["/relatorios", "Relatórios", ChartNoAxesCombined],
  ["/categorias", "Categorias", Tags],
  ["/configuracoes", "Configurações", Settings],
] as const;
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
}: {
  name: string;
  theme: string;
  setTheme: (s: string) => void;
}) {
  return (
    <aside className="sidebar">
      <NavLink to="/" className="brand-link">
        <Logo />
      </NavLink>
      <nav aria-label="Navegação principal">
        {navItems.map(([path, title, Icon]) => (
          <NavLink key={path} to={path} end={path === "/"}>
            <Icon size={19} />
            <span>{title}</span>
          </NavLink>
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
}: {
  onSearch: (s: string) => void;
  onLogout: () => void;
  onNotifications: () => void;
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
              <span className="avatar">FB</span>
              <strong>Fábio e Bianca</strong>
              <ChevronDown size={15} />
            </Button>
          }
          items={[
            { label: "Meu perfil", action: () => navigate("/configuracoes") },
            { label: "Sair da conta", action: onLogout },
          ]}
        />
      </div>
    </header>
  );
}
export function MobileNavigation() {
  const [more, setMore] = useState(false);
  return (
    <>
      <nav className="mobile-nav" aria-label="Navegação mobile">
        {[
          ["/", "Início", House],
          ["/transacoes", "Transações", ArrowLeftRight],
          ["/cartoes", "Cartões", CreditCard],
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
          {navItems.slice(2).map(([path, title, Icon]) => (
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
  name,
  theme,
  setTheme,
  onSearch,
  onLogout,
  onNotifications,
}: {
  children: ReactNode;
  name: string;
  theme: string;
  setTheme: (s: string) => void;
  onSearch: (s: string) => void;
  onLogout: () => void;
  onNotifications: () => void;
}) {
  return (
    <>
      <AppSidebar name={name} theme={theme} setTheme={setTheme} />
      <div className="main-shell">
        <AppHeader
          onSearch={onSearch}
          onLogout={onLogout}
          onNotifications={onNotifications}
        />
        <main>{children}</main>
      </div>
      <MobileNavigation />
    </>
  );
}
