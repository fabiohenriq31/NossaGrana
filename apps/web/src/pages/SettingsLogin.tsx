import { TelegramIntegration } from "@/components/TelegramIntegration";
import { HouseholdCard } from "@/components/HouseholdCard";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { LockKeyhole, LogOut, Sun, Moon } from "lucide-react";
import { toast } from "sonner";
import type { Overview } from "../../../../packages/shared/src/types";
import { Logo } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { ChartCard } from "@/components/common";
import { api } from "@/lib/api";
interface PublicConfig {
  signupEnabled: boolean;
  invitesEnabled: boolean;
  maintenance: string | null;
  signupBonusCredits: number;
  creditCosts: { text: number };
}
const inviteToken = () =>
  new URLSearchParams(window.location.search).get("convite");
export function LoginPage({
  onLogin,
  initialMode = "login",
  showHomeLink = false,
}: {
  onLogin: () => Promise<void>;
  initialMode?: "login" | "signup";
  showHomeLink?: boolean;
}) {
  const invite = inviteToken();
  const [mode, setMode] = useState<"login" | "signup">(
      invite ? "signup" : initialMode,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [config, setConfig] = useState<PublicConfig | null>(null),
    [household, setHousehold] = useState<{
      householdName: string;
      members: string[];
    } | null>(null);
  useEffect(() => {
    api<PublicConfig>("/public/config")
      .then(setConfig)
      .catch(() => {});
    if (invite)
      api<{ householdName: string; members: string[] }>(
        "/auth/invite/" + encodeURIComponent(invite),
      )
        .then(setHousehold)
        .catch((e) => setError((e as Error).message));
  }, [invite]);
  const canSignup = invite ? !!household : !!config?.signupEnabled;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      if (mode === "login")
        await api("/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: f.get("email"),
            password: f.get("password"),
          }),
        });
      else {
        if (f.get("password") !== f.get("confirm"))
          throw new Error("As senhas não conferem.");
        await api("/auth/signup", {
          method: "POST",
          body: JSON.stringify({
            name: f.get("name"),
            email: f.get("email"),
            password: f.get("password"),
            ...(invite
              ? { invite }
              : f.get("householdName")
                ? { householdName: f.get("householdName") }
                : {}),
          }),
        });
        if (invite) window.history.replaceState(null, "", "/");
      }
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
        {showHomeLink ? (
          <Link
            to="/"
            className="login-home-link"
            aria-label="Voltar ao início"
          >
            <Logo />
          </Link>
        ) : (
          <Logo />
        )}
        <div className="login-heading">
          {mode === "login" ? (
            <>
              <h1>Bom ter você por aqui.</h1>
              <p>Entre para cuidar das finanças da casa.</p>
            </>
          ) : household ? (
            <>
              <h1>Você foi convidado(a).</h1>
              <p>
                Crie sua conta para entrar em{" "}
                <strong>{household.householdName}</strong>
                {household.members.length
                  ? " com " + household.members.join(" e ")
                  : ""}
                .
              </p>
            </>
          ) : (
            <>
              <h1>Organizem a grana juntos.</h1>
              <p>
                Crie a conta da casa e depois convide quem divide as contas com
                você.
                {config?.signupBonusCredits
                  ? " Você ganha " +
                    config.signupBonusCredits +
                    " créditos para lançar gastos pelo Telegram."
                  : ""}
              </p>
            </>
          )}
        </div>
        {!invite && (
          <div className="auth-tabs" role="tablist">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                type="button"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setError("");
                }}
              >
                {m === "login" ? "Entrar" : "Criar conta"}
              </button>
            ))}
          </div>
        )}
        {config?.maintenance && (
          <p role="status" className="form-error">
            {config.maintenance}
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {mode === "signup" && !canSignup ? (
          <p className="auth-closed">
            {invite
              ? "Este convite não está mais disponível. Peça um novo link para quem convidou você."
              : config
                ? "Os cadastros estão fechados no momento. Volte em breve."
                : "Carregando…"}
          </p>
        ) : (
          <form onSubmit={submit} key={mode}>
            {mode === "signup" && (
              <label>
                Seu nome
                <input
                  name="name"
                  autoComplete="given-name"
                  required
                  minLength={2}
                  maxLength={40}
                  placeholder="Como vão te chamar no app"
                />
              </label>
            )}
            <label>
              E-mail
              <input
                type="email"
                name="email"
                autoComplete={mode === "login" ? "username" : "email"}
                required
                placeholder="seu@email.com"
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                name="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
                minLength={mode === "signup" ? 10 : undefined}
                placeholder={
                  mode === "signup" ? "Mínimo de 10 caracteres" : "Sua senha"
                }
              />
            </label>
            {mode === "signup" && (
              <>
                <label>
                  Confirme a senha
                  <input
                    type="password"
                    name="confirm"
                    autoComplete="new-password"
                    required
                    minLength={10}
                  />
                </label>
                {!invite && (
                  <label>
                    Nome da casa (opcional)
                    <input
                      name="householdName"
                      maxLength={60}
                      placeholder="Ex.: Ana & Leo"
                    />
                  </label>
                )}
              </>
            )}
            <Button type="submit" disabled={busy}>
              {busy
                ? mode === "login"
                  ? "Entrando…"
                  : "Criando conta…"
                : mode === "login"
                  ? "Entrar no Coflu"
                  : "Criar conta"}
            </Button>
          </form>
        )}
        <p className="login-private">
          <LockKeyhole size={14} /> Os dados de cada casa são privados.
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
          <HouseholdCard refresh={refresh} />
          <Button variant="outline" onClick={onLogout}>
            <LogOut size={17} />
            Sair da conta
          </Button>
        </div>
      </div>
    </>
  );
}
