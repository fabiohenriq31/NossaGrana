import { useState } from "react";
import { Plus, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { Overview, Category } from "../../../../packages/shared/src/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  ChartCard,
  CategoryIcon,
  EmptyState,
  MonthSelector,
} from "@/components/common";
import {
  CashflowChart,
  CategoryChart,
  PersonSpending,
} from "@/components/Charts";
import { api } from "@/lib/api";
import { money } from "@/lib/utils";
export function CategoriesPage({
  data,
  onEdit,
  refresh,
}: {
  data: Overview;
  onEdit: (c?: Category) => void;
  refresh: () => Promise<void>;
}) {
  const [sub, setSub] = useState<string | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false);
  const category = data.categories.find((c) => c.id === sub);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Categorias</h1>
          <p>Organize do seu jeito.</p>
        </div>
        <Button onClick={() => onEdit()}>
          <Plus size={17} />
          Nova categoria
        </Button>
      </div>
      <div className="categories-grid">
        {data.categories.map((c) => (
          <section key={c.id} className="category-card panel">
            <button onClick={() => onEdit(c)}>
              <CategoryIcon icon={c.icon} color={c.color} />
              <span>
                <h2>{c.name}</h2>
                <small>
                  {
                    data.transactions.filter((t) => t.categoryId === c.id)
                      .length
                  }{" "}
                  transações
                </small>
              </span>
              <ChevronRight size={18} />
            </button>
            <div className="category-subcategories">
              <span>
                {c.subcategories.map((s) => s.name).join(" · ") ||
                  "Sem subcategorias"}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setSub(c.id)}>
                Subcategorias
              </Button>
            </div>
          </section>
        ))}
      </div>
      {!data.categories.length && (
        <EmptyState text="Crie categorias para organizar os gastos." />
      )}
      <Dialog
        title={"Subcategorias · " + (category?.name || "")}
        open={!!sub}
        onOpenChange={(o) => {
          if (!o) {
            setSub(null);
            setEditing(null);
            setName("");
          }
        }}
      >
        {category?.subcategories.map((s) => (
          <div className="subcategory-row" key={s.id}>
            <button
              onClick={() => {
                setEditing(s.id);
                setName(s.name);
              }}
              aria-label={"Editar " + s.name}
            >
              {s.name}
            </button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={"Excluir " + s.name}
              onClick={async () => {
                try {
                  await api("/subcategories/" + s.id, { method: "DELETE" });
                  await refresh();
                  toast.success("Subcategoria excluída.");
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              <X size={16} />
            </Button>
          </div>
        ))}
        <form
          className="subcategory-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api(
                editing
                  ? "/subcategories/" + editing
                  : "/categories/" + sub + "/subcategories",
                {
                  method: editing ? "PUT" : "POST",
                  body: JSON.stringify({ name }),
                },
              );
              setName("");
              setEditing(null);
              await refresh();
              toast.success("Subcategoria adicionada.");
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            aria-label="Nome da subcategoria"
            placeholder="Nova subcategoria"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
          />
          <Button disabled={busy} type="submit">
            {editing ? "Salvar" : "Adicionar"}
          </Button>
        </form>
      </Dialog>
    </>
  );
}
export function ReportsPage({
  data,
  month,
  setMonth,
}: {
  data: Overview;
  month: string;
  setMonth: (m: string) => void;
}) {
  const values = data.analytics.wealth;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Relatórios</h1>
          <p>Entenda seus hábitos e acompanhe nossa evolução.</p>
        </div>
        <MonthSelector month={month} setMonth={setMonth} />
      </div>
      <div className="reports-grid">
        <ChartCard title="Evolução do patrimônio">
          <p className="muted report-caption">
            Últimos 6 meses · contas menos dívidas dos cartões
          </p>
          <div className="wealth-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={values}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="var(--muted)"
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => "R$ " + Math.round(v / 100000) + "k"}
                  stroke="var(--muted)"
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(v) => money(Number(v))}
                  contentStyle={{
                    background: "var(--card)",
                    borderColor: "var(--border)",
                  }}
                />
                <Bar
                  dataKey="value"
                  name="Patrimônio"
                  fill="var(--purple)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={40}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title="Receitas x Despesas">
          <CashflowChart data={data} month={month} />
          <p className="muted report-caption">
            Transferências e pagamentos de fatura não entram no resultado.
          </p>
        </ChartCard>
        <ChartCard title="Gastos por categoria">
          <CategoryChart data={data} month={month} />
        </ChartCard>
        <ChartCard title="Gastos por pessoa">
          <PersonSpending data={data} month={month} />
        </ChartCard>
      </div>
    </>
  );
}
