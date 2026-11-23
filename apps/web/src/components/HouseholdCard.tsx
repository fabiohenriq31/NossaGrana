import { useEffect, useState } from "react";
import { Copy, Link2, Pencil, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ChartCard } from "@/components/common";
import { Button } from "@/components/ui/button";

interface Household {
  name: string;
  members: { id: string; name: string; email: string; me: boolean }[];
  invites: { id: string; expiresAt: string }[];
  maxMembers: number;
  invitesEnabled: boolean;
}

/** Membros da casa e convite do parceiro (link válido por 7 dias, uso único). */
export function HouseholdCard({ refresh }: { refresh: () => Promise<void> }) {
  const [h, setH] = useState<Household | null>(null),
    [link, setLink] = useState(""),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false);
  const load = () =>
    api<Household>("/household")
      .then(setH)
      .catch((e) => toast.error((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  if (!h) return <ChartCard title="Nossa casa">Carregando…</ChartCard>;
  const full = h.members.length >= h.maxMembers;
  async function invite() {
    setBusy(true);
    try {
      const r = await api<{ url: string }>("/household/invites", {
        method: "POST",
        body: "{}",
      });
      setLink(r.url);
      await navigator.clipboard?.writeText(r.url).catch(() => {});
      toast.success("Link copiado. Mande para quem vai dividir as contas.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ChartCard title="Nossa casa">
      {editing ? (
        <form
          className="household-name-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name"));
            try {
              await api("/household", {
                method: "PATCH",
                body: JSON.stringify({ name }),
              });
              setEditing(false);
              await Promise.all([load(), refresh()]);
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
        >
          <input
            name="name"
            defaultValue={h.name}
            minLength={2}
            maxLength={60}
            required
          />
          <Button type="submit" size="sm">
            Salvar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(false)}
          >
            <X size={15} />
          </Button>
        </form>
      ) : (
        <div className="household-title">
          <strong>{h.name}</strong>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Renomear casa"
            onClick={() => setEditing(true)}
          >
            <Pencil size={15} />
          </Button>
        </div>
      )}
      {h.members.map((m) => (
        <div className="family-member" key={m.id}>
          <span className="avatar">{m.name.slice(0, 1).toUpperCase()}</span>
          {m.name}
          <small>{m.me ? "Você" : m.email}</small>
        </div>
      ))}
      {!full && h.invitesEnabled && (
        <div className="household-invite">
          {link ? (
            <div className="invite-link">
              <Link2 size={15} />
              <input
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label="Copiar link"
                onClick={() =>
                  navigator.clipboard
                    ?.writeText(link)
                    .then(() => toast.success("Link copiado."))
                }
              >
                <Copy size={15} />
              </Button>
            </div>
          ) : (
            <p>
              {h.invites.length
                ? "Há um convite aberto. Gerar outro cancela o anterior."
                : "Convide quem divide as contas com você. O link vale por 7 dias e só pode ser usado uma vez."}
            </p>
          )}
          <Button variant="outline" onClick={invite} disabled={busy}>
            <UserPlus size={16} />
            {link || h.invites.length
              ? "Gerar novo convite"
              : "Convidar parceiro(a)"}
          </Button>
        </div>
      )}
    </ChartCard>
  );
}
