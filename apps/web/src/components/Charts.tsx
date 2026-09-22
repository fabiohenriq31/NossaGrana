import { EmptyState } from "./common";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import type { Overview } from "../../../../packages/shared/src/types";
import { chartMonths } from "@/lib/finance";
import { money } from "@/lib/utils";
export function CashflowChart({
  data,
  month,
  compact = false,
}: {
  data: Overview;
  month: string;
  compact?: boolean;
}) {
  if (!data.analytics.history.some((h) => h.receitas || h.despesas))
    return (
      <div className={"chart-container " + (compact ? "compact" : "")}>
        <EmptyState text="Nenhuma movimentação neste período." />
      </div>
    );
  return (
    <div
      className={"chart-container " + (compact ? "compact" : "")}
      role="img"
      aria-label="Gráfico de receitas e despesas dos últimos seis meses"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartMonths(data, month)}
          barGap={3}
          margin={{ top: 12, right: 0, bottom: 0, left: compact ? 0 : -20 }}
        >
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
          />
          <YAxis
            hide={compact}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickFormatter={(v) =>
              v >= 100000
                ? "R$ " +
                  (v / 100000).toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  }) +
                  "k"
                : "R$ " +
                  (v / 100).toLocaleString("pt-BR", {
                    maximumFractionDigits: 0,
                  })
            }
          />
          <Tooltip
            formatter={(v) => money(Number(v))}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--foreground)",
            }}
            cursor={{ fill: "var(--elevated)" }}
          />
          <Bar
            isAnimationActive={false}
            name="Receitas"
            dataKey="receitas"
            fill="#50c897"
            radius={[2, 2, 0, 0]}
            maxBarSize={15}
          />
          <Bar
            isAnimationActive={false}
            name="Despesas"
            dataKey="despesas"
            fill="#f45f65"
            radius={[2, 2, 0, 0]}
            maxBarSize={15}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
export function CategoryChart({
  data,
  month,
}: {
  data: Overview;
  month: string;
}) {
  const total = data.analytics.summary.expenses;
  const values = data.analytics.categorySpending;
  return (
    <div className="category-chart">
      <div className="donut">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              isAnimationActive={false}
              data={
                values.length
                  ? values
                  : [{ value: 1, color: "var(--elevated)" }]
              }
              dataKey="value"
              innerRadius="68%"
              outerRadius="95%"
              stroke="none"
              startAngle={90}
              endAngle={-270}
            >
              {(values.length
                ? values
                : [{ id: "empty", color: "var(--elevated)" }]
              ).map((c) => (
                <Cell key={c.id} fill={c.color} />
              ))}
            </Pie>
            <Tooltip
              active={values.length ? undefined : false}
              formatter={(v) => money(Number(v))}
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <strong>{money(total)}</strong>
      </div>
      <div className="category-legend">
        {values.map((c) => (
          <div key={c.id}>
            <i style={{ background: c.color }} />
            <span>{c.name}</span>
            <b>{Math.round((c.value / (total || 1)) * 100)}%</b>
          </div>
        ))}
        {!values.length && <small>Sem despesas neste mês</small>}
      </div>
    </div>
  );
}
export function PersonSpending({
  data,
  month,
}: {
  data: Overview;
  month: string;
}) {
  return (
    <div className="person-spending">
      {data.analytics.personSpending.map(
        ({ name: person, value: amount, percentage }, i) => {
          return (
            <div key={person}>
              <div className="person-label">
                {person}
                <span>{percentage}%</span>
              </div>
              <div className="person-bar-row">
                <div className="person-track">
                  <i
                    style={{ width: percentage + "%", opacity: 1 - i * 0.14 }}
                  />
                </div>
                <span>{money(amount)}</span>
              </div>
            </div>
          );
        },
      )}
    </div>
  );
}
