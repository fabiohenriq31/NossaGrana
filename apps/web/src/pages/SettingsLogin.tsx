import { TelegramIntegration } from "@/components/TelegramIntegration";
import { useState, type FormEvent } from "react";
import { LockKeyhole, LogOut, Sun, Moon } from "lucide-react";
import { toast } from "sonner";
import type { Overview } from "../../../../packages/shared/src/types";
import { Logo } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { ChartCard } from "@/components/common";
import { api } from "@/lib/api";
export function LoginPage({ onLogin }: { onLogin: () => Promise<void> }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: f.get("email"),
          password: f.get("password"),
        }),
      });
      await onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-card panel">
        <Logo />
        <div className="login-heading">
          <h1>Bom ter você por aqui.</h1>
          <p>Entre para cuidar das nossas finanças.</p>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <form onSubmit={submit}>
          <label>
            E-mail
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              placeholder="seu@email.com"
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              placeholder="Sua senha"
            />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? "Entrando…" : "Entrar no Coflu"}
          </Button>
        </form>
        <p className="login-private">
          <LockKeyhole size={14} /> Um espaço privado para Fábio e Bianca.
        </p>
      </div>
      <p className="login-slogan">
        MAIS CONTROLE. MAIS TRANQUILIDADE. JUNTOS. ♥
      </p>
    </div>
  );
}
export function SettingsPage({
  data,
  theme,
  setTheme,
  onLogout,
  refresh,
}: {
  data: Overview;
  theme: string;
  setTheme: (s: string) => void;
  onLogout: () => void;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Configurações</h1>
          <p>Seu perfil e suas preferências.</p>
        </div>
      </div>
      <div className="settings-grid">
        <ChartCard title="Meu perfil">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                const password = String(f.get("password") || "");
                const r = await api<{ reauthenticate: boolean }>("/profile", {
                  method: "PATCH",
                  body: JSON.stringify({
                    name: f.get("name"),
                    ...(password
                      ? { password, currentPassword: f.get("currentPassword") }
                      : {}),
                  }),
                });
                toast.success("Perfil atualizado.");
                if (r.reauthenticate) onLogout();
                else await refresh();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <label className="full">
                Nome
                <input
                  name="name"
                  defaultValue={data.user.name}
                  minLength={2}
                  required
                />
              </label>
              <label className="full">
                E-mail
                <input value={data.user.email} readOnly />
              </label>
              <label className="full">
                Senha atual
                <input
                  type="password"
                  name="currentPassword"
                  autoComplete="current-password"
                />
              </label>
              <label className="full">
                Nova senha (opcional)
                <input
                  type="password"
                  name="password"
                  minLength={10}
                  autoComplete="new-password"
                />
              </label>
            </div>
            <div className="form-actions">
              <Button type="submit" disabled={busy}>
                {busy ? "Salvando…" : "Salvar perfil"}
              </Button>
            </div>
          </form>
        </ChartCard>
        <div>
          <ChartCard title="Aparência">
            <div className="appearance-options">
              <Button
                variant={theme === "light" ? "default" : "outline"}
                onClick={() => setTheme("light")}
              >
                <Sun size={18} />
                Claro
              </Button>
              <Button
                variant={theme === "dark" ? "default" : "outline"}
                onClick={() => setTheme("dark")}
              >
                <Moon size={18} />
                Escuro
              </Button>
            </div>
          </ChartCard>
          <TelegramIntegration />
          <ChartCard title="Nossa família">
            <div className="family-member">
              <span className="avatar">F</span>Fábio
              <small>Acesso compartilhado</small>
            </div>
            <div className="family-member">
              <span className="avatar">B</span>Bianca
              <small>Acesso compartilhado</small>
            </div>
          </ChartCard>
          <Button variant="outline" onClick={onLogout}>
            <LogOut size={17} />
            Sair da conta
          </Button>
        </div>
      </div>
    </>
  );
}
