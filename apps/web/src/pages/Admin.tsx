import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Coins,
  Crown,
  LogOut,
  Plus,
  Power,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { FeatureKey } from "../../../../packages/shared/src/types";
import { api } from "@/lib/api";
import { money } from "@/lib/utils";
import { ChartCard, EmptyState, LoadingSkeleton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { reasonLabels } from "./Plan";

/* Tipos espelham apps/api/src/settings.ts e admin-routes.ts. */
interface PlanDef {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  monthlyCredits: number;
  unlimited: boolean;
  features: FeatureKey[];
  active: boolean;
  highlight: boolean;
}
interface Settings {
  signupEnabled: boolean;
  invitesEnabled: boolean;
  maintenance: { enabled: boolean; message: string };
  banner: {
    enabled: boolean;
    message: string;
    tone: "info" | "warning" | "success";
  };
  aiEnabled: boolean;
  telegramQuickLaunch: boolean;
  signupBonusCredits: number;
  lowCreditWarning: number;
  maxMembers: number;
  creditCosts: {
    text: number;
    receipt: number;
    statement: number;
    coach: number;
  };
  plans: PlanDef[];
  creditPacks: {
    id: string;
    credits: number;
    priceCents: number;
    active: boolean;
  }[];
  upgrade: { contactUrl: string; message: string };
}
interface Stats {
  households: number;
  users: number;
  active7: number;
  signups7: number;
  signups30: number;
  payingHouseholds: number;
  estimatedMonthlyRevenue: number;
  creditsSoldThisMonth: number;
  usage: { kind: string; uses: number; credits: number }[];
  byPlan: { plan: string; name: string; count: number }[];
  recent: {
    id: string;
    name: string;
    email: string;
    createdAt: string;
    household: { name: string };
  }[];
}
interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  active: boolean;
  lastLoginAt: string | null;
}
interface HouseholdRow {
  id: string;
  name: string;
  active: boolean;
  plan: string;
  planName: string;
  planExpired: boolean;
  planExpiresAt: string | null;
  credits: number;
  createdAt: string;
  transactions: number;
  users: AdminUser[];
}

const tabs = [
  ["overview", "Visão geral"],
  ["households", "Clientes"],
  ["settings", "Controles"],
  ["plans", "Planos e créditos"],
  ["audit", "Auditoria"],
] as const;
type Tab = (typeof tabs)[number][0];
const usageLabels: Record<string, string> = {
  text: "Textos no Telegram",
  receipt: "Comprovantes",
  statement: "Faturas importadas",
  coach: "Análises com IA",
};
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "nunca";
const fail = (e: unknown) => {
  toast.error((e as Error).message);
};

export function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="admin-page">
      <div className="page-heading">
        <div>
          <h1>Administração</h1>
          <p>
            Clientes, planos, créditos e chaves do sistema, sem mexer no código.
          </p>
        </div>
      </div>
      <div className="admin-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "households" && <Households />}
      {(tab === "settings" || tab === "plans") && (
        <SettingsEditor section={tab} />
      )}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="admin-tile panel">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Overview() {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    api<Stats>("/admin/stats").then(setS).catch(fail);
  }, []);
  if (!s) return <LoadingSkeleton />;
  return (
    <>
      <div className="admin-tiles">
        <Tile label="Casas" value={s.households} hint={s.users + " pessoas"} />
        <Tile label="Ativos em 7 dias" value={s.active7} />
        <Tile
          label="Cadastros"
          value={s.signups7}
          hint={s.signups30 + " em 30 dias"}
        />
        <Tile label="Casas pagantes" value={s.payingHouseholds} />
        <Tile
          label="Receita mensal estimada"
          value={money(s.estimatedMonthlyRevenue)}
          hint="soma dos planos ativos"
        />
        <Tile label="Créditos vendidos no mês" value={s.creditsSoldThisMonth} />
      </div>
      <div className="admin-columns">
        <ChartCard title="Uso de IA neste mês">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Usos</th>
                <th>Créditos</th>
              </tr>
            </thead>
            <tbody>
              {s.usage.map((u) => (
                <tr key={u.kind}>
                  <td>{usageLabels[u.kind] || u.kind}</td>
                  <td>{u.uses}</td>
                  <td>{u.credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ChartCard>
        <ChartCard title="Casas por plano">
          <table className="admin-table">
            <tbody>
              {s.byPlan.map((p) => (
                <tr key={p.plan}>
                  <td>{p.name}</td>
                  <td>{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ChartCard>
        <ChartCard title="Cadastros recentes">
          <ul className="admin-recent">
            {s.recent.map((u) => (
              <li key={u.id}>
                <strong>{u.name}</strong> · {u.email}
                <small>
                  {u.household.name} · {when(u.createdAt)}
                </small>
              </li>
            ))}
          </ul>
        </ChartCard>
      </div>
    </>
  );
}

function Households() {
  const [q, setQ] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState<{
      items: HouseholdRow[];
      pages: number;
      total: number;
    } | null>(null),
    [credits, setCredits] = useState<HouseholdRow | null>(null),
    [plan, setPlan] = useState<HouseholdRow | null>(null),
    [ledger, setLedger] = useState<HouseholdRow | null>(null),
    [plans, setPlans] = useState<PlanDef[]>([]);
  const load = useCallback(
    () =>
      api<{ items: HouseholdRow[]; pages: number; total: number }>(
        "/admin/households?page=" +
          page +
          (query ? "&q=" + encodeURIComponent(query) : ""),
      )
        .then(setData)
        .catch(fail),
    [page, query],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api<{ settings: Settings }>("/admin/settings")
      .then((r) => setPlans(r.settings.plans))
      .catch(fail);
  }, []);
  const act = async (path: string, body: unknown, done: string) => {
    try {
      await api(path, { method: "PATCH", body: JSON.stringify(body) });
      toast.success(done);
      await load();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      <form
        className="admin-search"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(q.trim());
        }}
      >
        <Search size={17} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por casa, nome ou e-mail"
          aria-label="Buscar clientes"
        />
        <Button type="submit" size="sm">
          Buscar
        </Button>
      </form>
      {!data ? (
        <LoadingSkeleton />
      ) : !data.items.length ? (
        <EmptyState text="Nenhuma casa encontrada." />
      ) : (
        <div className="admin-households">
          {data.items.map((h) => (
            <article
              key={h.id}
              className={
                "admin-household panel" + (h.active ? "" : " inactive")
              }
            >
              <header>
                <div>
                  <h3>
                    {h.name}{" "}
                    {!h.active && (
                      <span className="pill danger">Desativada</span>
                    )}
                  </h3>
                  <small>
                    Desde {when(h.createdAt)} · {h.transactions} lançamentos
                  </small>
                </div>
                <div className="admin-household-meta">
                  <span className={"pill" + (h.plan === "FREE" ? "" : " paid")}>
                    {h.planName}
                    {h.planExpired
                      ? " (vencido)"
                      : h.planExpiresAt
                        ? " até " + when(h.planExpiresAt).slice(0, 8)
                        : ""}
                  </span>
                  <span className="pill">
                    <Coins size={13} /> {h.credits}
                  </span>
                </div>
              </header>
              <ul className="admin-users">
                {h.users.map((u) => (
                  <li key={u.id} className={u.active ? "" : "inactive"}>
                    <div>
                      <strong>
                        {u.name}{" "}
                        {u.role === "ADMIN" && (
                          <Crown size={13} aria-label="Administrador" />
                        )}
                      </strong>
                      <small>
                        {u.email} · último acesso {when(u.lastLoginAt)}
                      </small>
                    </div>
                    <div className="admin-user-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Encerrar sessões"
                        onClick={() =>
                          act(
                            "/admin/users/" + u.id,
                            { logout: true },
                            "Sessões encerradas.",
                          )
                        }
                      >
                        <LogOut size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          act(
                            "/admin/users/" + u.id,
                            { role: u.role === "ADMIN" ? "USER" : "ADMIN" },
                            u.role === "ADMIN"
                              ? "Agora é usuário comum."
                              : "Agora é administrador.",
                          )
                        }
                      >
                        {u.role === "ADMIN" ? "Remover admin" : "Tornar admin"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          act(
                            "/admin/users/" + u.id,
                            { active: !u.active },
                            u.active
                              ? "Pessoa desativada."
                              : "Pessoa reativada.",
                          )
                        }
                      >
                        {u.active ? "Desativar" : "Reativar"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <footer>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCredits(h)}
                >
                  <Coins size={15} /> Créditos
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPlan(h)}>
                  <Crown size={15} /> Plano
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setLedger(h)}>
                  Histórico
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={h.active ? "danger-text" : ""}
                  onClick={() => {
                    if (
                      h.active &&
                      !window.confirm(
                        "Desativar " +
                          h.name +
                          "? Os membros perdem o acesso até reativar.",
                      )
                    )
                      return;
                    void act(
                      "/admin/households/" + h.id,
                      { active: !h.active },
                      h.active ? "Casa desativada." : "Casa reativada.",
                    );
                  }}
                >
                  <Power size={15} />{" "}
                  {h.active ? "Desativar casa" : "Reativar casa"}
                </Button>
              </footer>
            </article>
          ))}
          <div className="admin-pager">
            <Button
              size="sm"
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </Button>
            <span>
              Página {page} de {data.pages} · {data.total} casas
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={page >= data.pages}
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
      {credits && (
        <CreditsDialog
          household={credits}
          close={() => setCredits(null)}
          done={load}
        />
      )}
      {plan && (
        <PlanDialog
          household={plan}
          plans={plans}
          close={() => setPlan(null)}
          done={load}
        />
      )}
      {ledger && (
        <LedgerDialog household={ledger} close={() => setLedger(null)} />
      )}
    </>
  );
}

function CreditsDialog({
  household,
  close,
  done,
}: {
  household: HouseholdRow;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={"Créditos · " + household.name}
      description={"Saldo atual: " + household.credits + " créditos."}
    >
      <form
        className="admin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            const sign = f.get("op") === "remove" ? -1 : 1;
            await api("/admin/households/" + household.id + "/credits", {
              method: "POST",
              body: JSON.stringify({
                delta: sign * Number(f.get("amount")),
                note: String(f.get("note") || ""),
                purchase: f.get("purchase") === "on",
              }),
            });
            toast.success("Créditos atualizados.");
            await done();
            close();
          } catch (err) {
            fail(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Operação
          <select name="op" defaultValue="add">
            <option value="add">Adicionar</option>
            <option value="remove">Remover</option>
          </select>
        </label>
        <label>
          Quantidade
          <input
            name="amount"
            type="number"
            min={1}
            max={100000}
            required
            defaultValue={10}
          />
        </label>
        <label>
          Motivo (aparece no histórico do cliente)
          <input
            name="note"
            maxLength={200}
            placeholder="Ex.: pagamento via PIX em 24/11"
          />
        </label>
        <label className="admin-check">
          <input type="checkbox" name="purchase" /> Foi uma compra (entra em
          "créditos vendidos")
        </label>
        <Button type="submit" disabled={busy}>
          Salvar
        </Button>
      </form>
    </Dialog>
  );
}

function PlanDialog({
  household,
  plans,
  close,
  done,
}: {
  household: HouseholdRow;
  plans: PlanDef[];
  close: () => void;
  done: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={"Plano · " + household.name}
      description={"Plano atual: " + household.planName + "."}
    >
      <form
        className="admin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await api("/admin/households/" + household.id + "/plan", {
              method: "PUT",
              body: JSON.stringify({
                plan: f.get("plan"),
                expiresAt: f.get("expiresAt") || null,
                grantCredits: f.get("grant") === "on",
              }),
            });
            toast.success("Plano atualizado.");
            await done();
            close();
          } catch (err) {
            fail(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Plano
          <select name="plan" defaultValue={household.plan}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ·{" "}
                {p.priceCents ? money(p.priceCents) + "/mês" : "grátis"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Válido até (vazio = sem data para acabar)
          <input type="date" name="expiresAt" />
        </label>
        <label className="admin-check">
          <input type="checkbox" name="grant" defaultChecked /> Entregar agora
          os créditos do primeiro mês
        </label>
        <Button type="submit" disabled={busy}>
          Salvar
        </Button>
      </form>
    </Dialog>
  );
}

function LedgerDialog({
  household,
  close,
}: {
  household: HouseholdRow;
  close: () => void;
}) {
  const [rows, setRows] = useState<
    | {
        id: string;
        delta: number;
        balanceAfter: number;
        reason: string;
        note: string | null;
        createdAt: string;
      }[]
    | null
  >(null);
  useEffect(() => {
    api<typeof rows>("/admin/households/" + household.id + "/ledger")
      .then(setRows)
      .catch(fail);
  }, [household.id]);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={"Histórico · " + household.name}
    >
      {!rows ? (
        <LoadingSkeleton />
      ) : (
        <table className="admin-table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{when(r.createdAt)}</td>
                <td>
                  {reasonLabels[r.reason] || r.reason}
                  {r.note ? " · " + r.note : ""}
                </td>
                <td
                  className={
                    r.delta > 0 ? "positive" : r.delta < 0 ? "negative" : ""
                  }
                >
                  {r.delta > 0 ? "+" + r.delta : r.delta}
                </td>
                <td>{r.balanceAfter}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  danger,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  danger?: boolean;
}) {
  return (
    <label className={"admin-toggle" + (danger && checked ? " danger" : "")}>
      <div>
        <strong>{label}</strong>
        <small>{hint}</small>
      </div>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 100000,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
const reais = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const toCents = (v: string) =>
  Math.max(
    0,
    Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100) || 0,
  );

function SettingsEditor({ section }: { section: "settings" | "plans" }) {
  const [s, setS] = useState<Settings | null>(null),
    [saved, setSaved] = useState(""),
    [labels, setLabels] = useState<Record<FeatureKey, string> | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ settings: Settings; featureLabels: Record<FeatureKey, string> }>(
      "/admin/settings",
    )
      .then((r) => {
        setS(r.settings);
        setSaved(JSON.stringify(r.settings));
        setLabels(r.featureLabels);
      })
      .catch(fail);
  }, []);
  if (!s || !labels) return <LoadingSkeleton />;
  const dirty = JSON.stringify(s) !== saved;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setS({ ...s, [k]: v });
  const setPlan = (i: number, p: Partial<PlanDef>) =>
    set(
      "plans",
      s.plans.map((x, j) => (j === i ? { ...x, ...p } : x)),
    );
  async function save() {
    setBusy(true);
    try {
      const r = await api<Settings>("/admin/settings", {
        method: "PUT",
        body: JSON.stringify(s),
      });
      setS(r);
      setSaved(JSON.stringify(r));
      toast.success("Configurações salvas. Valem na hora para todos.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-settings">
      {section === "settings" ? (
        <>
          <ChartCard title="Acesso">
            <Toggle
              label="Cadastro aberto"
              hint="Desligado: ninguém novo cria conta. Quem já tem conta continua entrando."
              checked={s.signupEnabled}
              onChange={(v) => set("signupEnabled", v)}
            />
            <Toggle
              label="Convites de parceiro(a)"
              hint="Permite gerar link para a segunda pessoa entrar na casa."
              checked={s.invitesEnabled}
              onChange={(v) => set("invitesEnabled", v)}
            />
            <Toggle
              label="Modo manutenção"
              hint="Bloqueia o app para todos, menos administradores."
              checked={s.maintenance.enabled}
              danger
              onChange={(v) =>
                set("maintenance", { ...s.maintenance, enabled: v })
              }
            />
            <label>
              Mensagem de manutenção
              <input
                value={s.maintenance.message}
                maxLength={300}
                onChange={(e) =>
                  set("maintenance", {
                    ...s.maintenance,
                    message: e.target.value,
                  })
                }
              />
            </label>
            <NumberField
              label="Pessoas por casa"
              value={s.maxMembers}
              min={1}
              max={10}
              onChange={(v) => set("maxMembers", v)}
            />
          </ChartCard>
          <ChartCard title="Inteligência artificial">
            <Toggle
              label="IA ligada"
              hint="Desligada: o Telegram não lê textos, comprovantes nem faturas (nada é cobrado)."
              checked={s.aiEnabled}
              onChange={(v) => set("aiEnabled", v)}
            />
            <Toggle
              label="Lançamento rápido no Telegram"
              hint="Lança direto quando não há dúvida. Desligado: sempre pede confirmação."
              checked={s.telegramQuickLaunch}
              onChange={(v) => set("telegramQuickLaunch", v)}
            />
          </ChartCard>
          <ChartCard title="Aviso no topo do app">
            <Toggle
              label="Mostrar aviso"
              hint="Uma faixa para todos os usuários (novidade, instabilidade, promoção)."
              checked={s.banner.enabled}
              onChange={(v) => set("banner", { ...s.banner, enabled: v })}
            />
            <label>
              Texto do aviso
              <input
                value={s.banner.message}
                maxLength={300}
                onChange={(e) =>
                  set("banner", { ...s.banner, message: e.target.value })
                }
              />
            </label>
            <label>
              Cor
              <select
                value={s.banner.tone}
                onChange={(e) =>
                  set("banner", {
                    ...s.banner,
                    tone: e.target.value as Settings["banner"]["tone"],
                  })
                }
              >
                <option value="info">Informação</option>
                <option value="success">Novidade</option>
                <option value="warning">Atenção</option>
              </select>
            </label>
          </ChartCard>
          <ChartCard title="Como assinar">
            <label>
              Link para assinar ou comprar (WhatsApp, formulário, checkout)
              <input
                value={s.upgrade.contactUrl}
                placeholder="https://wa.me/55..."
                onChange={(e) =>
                  set("upgrade", {
                    ...s.upgrade,
                    contactUrl: e.target.value.trim(),
                  })
                }
              />
            </label>
            <label>
              Mensagem na tela de planos
              <input
                value={s.upgrade.message}
                maxLength={300}
                onChange={(e) =>
                  set("upgrade", { ...s.upgrade, message: e.target.value })
                }
              />
            </label>
          </ChartCard>
        </>
      ) : (
        <>
          <ChartCard title="Créditos">
            <div className="admin-grid-fields">
              <NumberField
                label="Créditos de boas-vindas"
                value={s.signupBonusCredits}
                max={1000}
                onChange={(v) => set("signupBonusCredits", v)}
              />
              <NumberField
                label="Avisar quando restarem"
                value={s.lowCreditWarning}
                max={1000}
                onChange={(v) => set("lowCreditWarning", v)}
              />
              {(
                Object.keys(s.creditCosts) as (keyof Settings["creditCosts"])[]
              ).map((k) => (
                <NumberField
                  key={k}
                  label={"Custo: " + usageLabels[k].toLowerCase()}
                  value={s.creditCosts[k]}
                  max={100}
                  onChange={(v) =>
                    set("creditCosts", { ...s.creditCosts, [k]: v })
                  }
                />
              ))}
            </div>
            <p className="muted">
              Com {s.signupBonusCredits} créditos de boas-vindas, uma casa nova
              lança cerca de{" "}
              {s.creditCosts.text
                ? Math.floor(s.signupBonusCredits / s.creditCosts.text)
                : "∞"}{" "}
              gastos por texto.
            </p>
          </ChartCard>
          {s.plans.map((p, i) => (
            <ChartCard
              key={i}
              title={"Plano " + (p.name || "novo")}
              action={
                p.id !== "FREE" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remover plano"
                    onClick={() =>
                      set(
                        "plans",
                        s.plans.filter((_, j) => j !== i),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </Button>
                )
              }
            >
              <div className="admin-grid-fields">
                <label>
                  Código
                  <input
                    value={p.id}
                    disabled={p.id === "FREE"}
                    onChange={(e) =>
                      setPlan(i, {
                        id: e.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9_]/g, ""),
                      })
                    }
                  />
                </label>
                <label>
                  Nome
                  <input
                    value={p.name}
                    maxLength={40}
                    onChange={(e) => setPlan(i, { name: e.target.value })}
                  />
                </label>
                <label>
                  Preço por mês (R$)
                  <input
                    inputMode="decimal"
                    defaultValue={reais(p.priceCents)}
                    onBlur={(e) =>
                      setPlan(i, { priceCents: toCents(e.target.value) })
                    }
                  />
                </label>
                <NumberField
                  label="Créditos por mês"
                  value={p.monthlyCredits}
                  onChange={(v) => setPlan(i, { monthlyCredits: v })}
                />
              </div>
              <label>
                Descrição
                <input
                  value={p.description}
                  maxLength={200}
                  onChange={(e) => setPlan(i, { description: e.target.value })}
                />
              </label>
              <fieldset className="admin-features">
                <legend>
                  O que está incluído (o resto aparece como demonstração)
                </legend>
                {(Object.keys(labels) as FeatureKey[]).map((f) => (
                  <label key={f} className="admin-check">
                    <input
                      type="checkbox"
                      checked={p.features.includes(f)}
                      onChange={(e) =>
                        setPlan(i, {
                          features: e.target.checked
                            ? [...p.features, f]
                            : p.features.filter((x) => x !== f),
                        })
                      }
                    />
                    {labels[f]}
                  </label>
                ))}
              </fieldset>
              <div className="admin-inline">
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={p.unlimited}
                    onChange={(e) =>
                      setPlan(i, { unlimited: e.target.checked })
                    }
                  />{" "}
                  IA ilimitada (não gasta créditos)
                </label>
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={p.active}
                    disabled={p.id === "FREE"}
                    onChange={(e) => setPlan(i, { active: e.target.checked })}
                  />{" "}
                  Aparece para os clientes
                </label>
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={p.highlight}
                    onChange={(e) =>
                      setPlan(i, { highlight: e.target.checked })
                    }
                  />{" "}
                  Destacar
                </label>
              </div>
            </ChartCard>
          ))}
          <Button
            variant="outline"
            disabled={s.plans.length >= 8}
            onClick={() =>
              set("plans", [
                ...s.plans,
                {
                  id: "NOVO" + s.plans.length,
                  name: "Novo plano",
                  description: "",
                  priceCents: 0,
                  monthlyCredits: 0,
                  unlimited: false,
                  features: [],
                  active: false,
                  highlight: false,
                },
              ])
            }
          >
            <Plus size={16} /> Adicionar plano
          </Button>
          <ChartCard title="Pacotes de créditos avulsos">
            {s.creditPacks.map((p, i) => (
              <div key={i} className="admin-pack">
                <NumberField
                  label="Créditos"
                  value={p.credits}
                  min={1}
                  onChange={(v) =>
                    set(
                      "creditPacks",
                      s.creditPacks.map((x, j) =>
                        j === i ? { ...x, credits: v } : x,
                      ),
                    )
                  }
                />
                <label>
                  Preço (R$)
                  <input
                    inputMode="decimal"
                    defaultValue={reais(p.priceCents)}
                    onBlur={(e) =>
                      set(
                        "creditPacks",
                        s.creditPacks.map((x, j) =>
                          j === i
                            ? { ...x, priceCents: toCents(e.target.value) }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={p.active}
                    onChange={(e) =>
                      set(
                        "creditPacks",
                        s.creditPacks.map((x, j) =>
                          j === i ? { ...x, active: e.target.checked } : x,
                        ),
                      )
                    }
                  />{" "}
                  À venda
                </label>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remover pacote"
                  onClick={() =>
                    set(
                      "creditPacks",
                      s.creditPacks.filter((_, j) => j !== i),
                    )
                  }
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              disabled={s.creditPacks.length >= 8}
              onClick={() =>
                set("creditPacks", [
                  ...s.creditPacks,
                  {
                    id: "P" + Date.now().toString(36).slice(-6),
                    credits: 50,
                    priceCents: 990,
                    active: true,
                  },
                ])
              }
            >
              <Plus size={15} /> Adicionar pacote
            </Button>
          </ChartCard>
        </>
      )}
      <div className={"admin-savebar" + (dirty ? " visible" : "")}>
        <span>Alterações não salvas</span>
        <Button variant="ghost" onClick={() => setS(JSON.parse(saved))}>
          Descartar
        </Button>
        <Button onClick={save} disabled={busy || !dirty}>
          {busy ? "Salvando…" : "Salvar alterações"}
        </Button>
      </div>
    </div>
  );
}

function Audit() {
  const [rows, setRows] = useState<
    | {
        id: string;
        actor: string;
        action: string;
        targetType: string | null;
        targetId: string | null;
        details: unknown;
        createdAt: string;
      }[]
    | null
  >(null);
  useEffect(() => {
    api<typeof rows>("/admin/audit").then(setRows).catch(fail);
  }, []);
  const labels: Record<string, string> = {
    "credits.adjust": "Ajustou créditos",
    "plan.set": "Mudou plano",
    "household.activate": "Reativou casa",
    "household.deactivate": "Desativou casa",
    "user.update": "Alterou pessoa",
    "settings.update": "Mudou configurações",
  };
  if (!rows) return <LoadingSkeleton />;
  if (!rows.length) return <EmptyState text="Nenhuma ação registrada ainda." />;
  return (
    <ChartCard title="Últimas 100 ações">
      <table className="admin-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{when(r.createdAt)}</td>
              <td>
                <Users size={13} /> {r.actor}
              </td>
              <td>{labels[r.action] || r.action}</td>
              <td className="admin-details">
                {r.details ? JSON.stringify(r.details) : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  );
}
