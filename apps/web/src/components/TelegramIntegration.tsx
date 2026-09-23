import { useEffect, useState } from "react";
import { Send, Unplug, RefreshCw } from "lucide-react";
import { ChartCard } from "@/components/common";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
type Status = { enabled: boolean; connected: boolean; username: string | null };
export function TelegramIntegration() {
  const [status, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function refresh() {
    try {
      setStatus(await api<Status>("/integrations/telegram"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    const listener = () => {
      void refresh();
    };
    window.addEventListener("focus", listener);
    return () => window.removeEventListener("focus", listener);
  }, []);
  async function connect() {
    setBusy(true);
    setError("");
    try {
      setLink(await api("/integrations/telegram/link", { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await api("/integrations/telegram", { method: "DELETE" });
      setLink(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ChartCard title="Telegram">
      <div className="form-grid">
        <p className="full">
          Envie comprovantes, imagens ou PDFs e confira a sugestão no Telegram.
          O lançamento só é salvo quando você confirmar.
        </p>
        {error && (
          <p role="alert" className="form-error full">
            {error}
          </p>
        )}
        <p className="full" aria-live="polite">
          {!status
            ? "Verificando conexão…"
            : status.connected
              ? "Conectado" +
                (status.username ? " a @" + status.username : "") +
                "."
              : status.enabled
                ? "Seu Telegram ainda não está conectado."
                : "A integração precisa ser configurada no servidor."}
        </p>
        {link && !status?.connected && (
          <div className="full">
            <Button asChild>
              <a href={link.url} target="_blank" rel="noreferrer">
                <Send size={16} /> Abrir Telegram e conectar
              </a>
            </Button>
            <p>
              Link de uso único. Válido até{" "}
              {new Date(link.expiresAt).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              . Toque em Iniciar no bot e volte para atualizar.
            </p>
          </div>
        )}
      </div>
      <div className="form-actions">
        {status?.connected ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            <Unplug size={16} />
            Desconectar
          </Button>
        ) : (
          <Button
            disabled={busy || !status?.enabled}
            onClick={() => void connect()}
          >
            <Send size={16} />
            {busy
              ? "Gerando link…"
              : link
                ? "Gerar novo link"
                : "Conectar Telegram"}
          </Button>
        )}
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void refresh()}
          aria-label="Atualizar conexão do Telegram"
        >
          <RefreshCw size={16} />
        </Button>
      </div>
    </ChartCard>
  );
}
