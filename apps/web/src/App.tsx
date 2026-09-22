import { useState, useEffect, useCallback, useRef } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { Toaster, toast } from "sonner";
import type { Overview } from "../../../packages/shared/src/types";
import { api, fetchOverview } from "./lib/api";
import { currentMonth } from "./lib/utils";
import { Shell } from "./components/Shell";
import { LoadingSkeleton, EmptyState } from "./components/common";
import { Button } from "./components/ui/button";
import { Editor, type EditorState } from "./components/Editors";
import { Dashboard } from "./pages/Dashboard";
import { TransactionsPage } from "./pages/TransactionsPage";
import { AccountsPage, CardsPage, InvoicesPage } from "./pages/AccountsCards";
import { PlanningPage, CalendarPage } from "./pages/PlanningCalendar";
import { CategoriesPage, ReportsPage } from "./pages/CategoriesReports";
import { SettingsPage, LoginPage } from "./pages/SettingsLogin";
export default function App() {
  const [data, setData] = useState<Overview | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [month, setMonth] = useState(currentMonth()),
    [theme, setTheme] = useState(
      () => localStorage.getItem("ng-theme") || "dark",
    ),
    [search, setSearch] = useState(""),
    [editor, setEditor] = useState<EditorState>(null);
  const navigate = useNavigate();
  const requestVersion = useRef(0);
  useEffect(() => {
    document.documentElement.className = theme;
    localStorage.setItem("ng-theme", theme);
  }, [theme]);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    const result = await fetchOverview(month);
    if (version !== requestVersion.current) return;
    setData(result);
    setError("");
  }, [month]);
  useEffect(() => {
    refresh()
      .catch((e) => {
        if (e.status !== 401) setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [refresh]);
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch (e) {
      if ((e as { status?: number }).status !== 401)
        toast.error((e as Error).message);
    } finally {
      requestVersion.current++;
      setData(null);
      navigate("/");
    }
  }
  const edit = (item: Overview["transactions"][number]) =>
      setEditor({ kind: "transaction", item }),
    newTransaction = () => setEditor({ kind: "transaction" }),
    pay = (item: Overview["invoices"][number]) =>
      setEditor({ kind: "pay", item });
  const common = { data: data!, month, setMonth };
  return (
    <>
      <Toaster
        richColors
        theme={theme === "light" ? "light" : "dark"}
        position="top-center"
      />
      {loading ? (
        <div className="initial-loading">
          <LoadingSkeleton />
        </div>
      ) : !data ? (
        error ? (
          <div className="login-page">
            <EmptyState
              text={error}
              action={
                <Button
                  onClick={() => {
                    setLoading(true);
                    refresh()
                      .catch((e) => setError(e.message))
                      .finally(() => setLoading(false));
                  }}
                >
                  Tentar novamente
                </Button>
              }
            />
          </div>
        ) : (
          <LoginPage onLogin={refresh} />
        )
      ) : (
        <Shell
          name={data.user.name}
          theme={theme}
          setTheme={setTheme}
          onSearch={setSearch}
          onLogout={logout}
          onNotifications={() => navigate("/planejamento")}
        >
          <Routes>
            <Route
              path="/"
              element={
                <Dashboard
                  {...common}
                  onNew={newTransaction}
                  onEdit={edit}
                  onNotifications={() => navigate("/planejamento")}
                />
              }
            />
            <Route
              path="/transacoes"
              element={
                <TransactionsPage
                  {...common}
                  search={search}
                  setSearch={setSearch}
                  onEdit={edit}
                  onNew={newTransaction}
                />
              }
            />
            <Route
              path="/contas"
              element={
                <AccountsPage
                  data={data}
                  onEdit={(item) => setEditor({ kind: "account", item })}
                />
              }
            />
            <Route
              path="/cartoes"
              element={
                <CardsPage
                  data={data}
                  month={month}
                  onEdit={(item) => setEditor({ kind: "card", item })}
                />
              }
            />
            <Route
              path="/faturas"
              element={<InvoicesPage {...common} onPay={pay} onEdit={edit} />}
            />
            <Route
              path="/planejamento"
              element={
                <PlanningPage
                  {...common}
                  onNew={newTransaction}
                  onEdit={edit}
                  onPay={pay}
                  refresh={refresh}
                />
              }
            />
            <Route
              path="/calendario"
              element={<CalendarPage {...common} onEdit={edit} onPay={pay} />}
            />
            <Route path="/relatorios" element={<ReportsPage {...common} />} />
            <Route
              path="/categorias"
              element={
                <CategoriesPage
                  data={data}
                  onEdit={(item) => setEditor({ kind: "category", item })}
                  refresh={refresh}
                />
              }
            />
            <Route
              path="/configuracoes"
              element={
                <SettingsPage
                  data={data}
                  theme={theme}
                  setTheme={setTheme}
                  onLogout={logout}
                  refresh={refresh}
                />
              }
            />
            <Route
              path="*"
              element={
                <EmptyState
                  text="Página não encontrada."
                  action={
                    <Button onClick={() => navigate("/")}>
                      Voltar ao início
                    </Button>
                  }
                />
              }
            />
          </Routes>
          {editor && (
            <Editor
              key={editor.kind + editor.item?.id}
              state={editor}
              data={data}
              close={() => setEditor(null)}
              refresh={refresh}
            />
          )}
        </Shell>
      )}
    </>
  );
}
