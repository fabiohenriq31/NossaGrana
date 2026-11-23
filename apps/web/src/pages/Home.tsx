import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  Check,
  CreditCard,
  HeartPulse,
  Lock,
  MessageCircle,
  PiggyBank,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import type { FeatureKey } from "../../../../packages/shared/src/types";
import { Logo } from "@/components/Shell";
import { api } from "@/lib/api";
import { money } from "@/lib/utils";

interface HomeConfig {
  signupEnabled: boolean;
  signupBonusCredits: number;
  creditCosts: { text: number; receipt: number; statement: number };
  plans: {
    id: string;
    name: string;
    description: string;
    priceCents: number;
    monthlyCredits: number;
    unlimited: boolean;
    features: FeatureKey[];
    highlight: boolean;
  }[];
}

const featureLabels: Record<FeatureKey, string> = {
  telegramText: "Lançar gastos por texto no Telegram",
  telegramReceipt: "Ler comprovantes (PIX, boleto, recibo)",
  statementImport: "Importar fatura do cartão por print ou PDF",
  financialHealth: "Saúde financeira, metas e plano",
  coach: "Análise do mês com IA",
  reports: "Relatórios",
  planning: "Planejamento e calendário",
};

const pillars = [
  {
    icon: PiggyBank,
    title: "Orçamento por envelopes",
    text: "Cada categoria com o seu limite do mês. Vocês veem na hora quanto ainda cabe.",
  },
  {
    icon: CreditCard,
    title: "Cartões e faturas",
    text: "Parcelas, fechamento e vencimento de cada cartão, sem susto no fim do mês.",
  },
  {
    icon: MessageCircle,
    title: "Lançar pelo Telegram",
    text: "Mande “mercado 120 no débito” e o gasto entra no app, já categorizado.",
  },
  {
    icon: HeartPulse,
    title: "Saúde financeira",
    text: "Reserva de emergência, metas do casal e um plano para chegar lá.",
  },
];

/** Página pública de apresentação. Quem já entrou vai direto para o app. */
export function HomePage() {
  const [config, setConfig] = useState<HomeConfig | null>(null);
  useEffect(() => {
    api<HomeConfig>("/public/config")
      .then(setConfig)
      .catch(() => {});
  }, []);
  const signup = config?.signupEnabled !== false;
  const cta = signup ? "/cadastro" : "/entrar";
  const ctaLabel = signup ? "Criar conta grátis" : "Entrar";

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-wrap home-header-inner">
          <Link to="/" aria-label="Coflu, início">
            <Logo />
          </Link>
          <nav aria-label="Seções" className="home-nav">
            <a href="#funcoes">Funções</a>
            <a href="#telegram">Telegram</a>
            <a href="#casal">Para o casal</a>
            <a href="#planos">Planos</a>
          </nav>
          <div className="home-header-actions">
            <Link to="/entrar" className="home-btn ghost">
              Entrar
            </Link>
            {signup && (
              <Link to="/cadastro" className="home-btn primary">
                Criar conta
              </Link>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="home-hero">
          <div className="home-wrap home-hero-grid">
            <div className="home-hero-copy">
              <span className="home-eyebrow">Finanças a dois</span>
              <h1>
                O dinheiro da casa,
                <br />
                <em>organizado a dois.</em>
              </h1>
              <p>
                Orçamento, cartões e metas do casal num só lugar. Lance um gasto
                mandando uma mensagem no Telegram e deixe o resto com o Coflu.
              </p>
              <div className="home-hero-actions">
                <Link to={cta} className="home-btn primary large">
                  {ctaLabel} <ArrowRight size={18} />
                </Link>
                <a href="#funcoes" className="home-btn outline large">
                  Ver como funciona
                </a>
              </div>
              {signup && !!config?.signupBonusCredits && (
                <p className="home-hero-note">
                  <Sparkles size={15} /> Ganhe {config.signupBonusCredits}{" "}
                  créditos de IA ao criar a conta.
                </p>
              )}
            </div>
            <PhoneMock />
          </div>
        </section>

        <section className="home-section" id="funcoes">
          <div className="home-wrap">
            <h2 className="home-title">
              Tudo o que o dinheiro da casa precisa
            </h2>
            <div className="home-pillars">
              {pillars.map(({ icon: Icon, title, text }) => (
                <article key={title} className="home-pillar">
                  <Icon size={22} />
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="home-band dark" id="telegram">
          <div className="home-wrap home-split">
            <div>
              <span className="home-eyebrow">Lançamento rápido</span>
              <h2 className="home-title">
                Mande uma mensagem.
                <br />O Coflu lança.
              </h2>
              <p className="home-lead">
                Nada de abrir planilha na fila do mercado. Escreva do seu jeito,
                mande o print do comprovante ou a fatura do cartão, e confira
                antes de salvar.
              </p>
              <div className="home-chips">
                <span>Texto</span>
                <span>Comprovante PIX</span>
                <span>Boleto</span>
                <span>Print da fatura</span>
                <span>PDF</span>
              </div>
              <Link to={cta} className="home-btn primary">
                {ctaLabel}
              </Link>
            </div>
            <ChatMock />
          </div>
        </section>

        <section className="home-section" id="casal">
          <div className="home-wrap">
            <div className="home-section-head">
              <h2 className="home-title">
                Feito para quem
                <br />
                divide as contas
              </h2>
              <p>Cada um com o seu login, a mesma casa e os mesmos números.</p>
            </div>
            <div className="home-feature-panel">
              <div className="home-feature-art" aria-hidden>
                <div className="home-people">
                  <span className="a">V</span>
                  <span className="b">P</span>
                </div>
                <div className="home-split-bars">
                  <div>
                    <small>Você</small>
                    <i style={{ width: "58%" }} />
                  </div>
                  <div>
                    <small>Parceiro(a)</small>
                    <i style={{ width: "42%" }} />
                  </div>
                  <div>
                    <small>Casa</small>
                    <i style={{ width: "76%" }} />
                  </div>
                </div>
              </div>
              <div className="home-feature-cards">
                <article>
                  <Users size={20} />
                  <h3>Convite em um link</h3>
                  <p>
                    Crie a casa e mande o convite. Em um minuto os dois estão
                    dentro.
                  </p>
                </article>
                <article>
                  <ReceiptText size={20} />
                  <h3>Quem gastou o quê</h3>
                  <p>
                    Cada gasto é seu, do(a) parceiro(a) ou da casa. Sem conta de
                    padaria.
                  </p>
                </article>
                <article>
                  <ShieldCheck size={20} />
                  <h3>Seus dados, só seus</h3>
                  <p>
                    Nada de senha de banco. Vocês lançam o que querem
                    acompanhar.
                  </p>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section className="home-band green" id="planos">
          <div className="home-wrap">
            <div className="home-section-head">
              <h2 className="home-title">
                Comece grátis. Cresça quando quiser.
              </h2>
              <p>
                A IA funciona com créditos: um gasto por texto custa{" "}
                {config?.creditCosts.text ?? 1} crédito.
              </p>
            </div>
            {config?.plans.length ? (
              <div className="home-plans">
                {config.plans.map((p) => (
                  <article
                    key={p.id}
                    className={"home-plan" + (p.highlight ? " highlight" : "")}
                  >
                    {p.highlight && (
                      <span className="home-plan-tag">Mais completo</span>
                    )}
                    <h3>{p.name}</h3>
                    <p className="home-plan-price">
                      {p.priceCents ? money(p.priceCents) : "R$ 0"}
                      <small>/mês</small>
                    </p>
                    <p className="home-plan-desc">{p.description}</p>
                    <p className="home-plan-credits">
                      <Bot size={16} />
                      {p.unlimited
                        ? "IA ilimitada"
                        : p.monthlyCredits
                          ? p.monthlyCredits + " créditos por mês"
                          : (config.signupBonusCredits || 0) +
                            " créditos de boas-vindas"}
                    </p>
                    <ul>
                      {(Object.keys(featureLabels) as FeatureKey[]).map((f) => {
                        const on = p.features.includes(f);
                        return (
                          <li key={f} className={on ? "" : "off"}>
                            {on ? <Check size={15} /> : <Lock size={14} />}
                            {featureLabels[f]}
                          </li>
                        );
                      })}
                    </ul>
                    {signup && (
                      <Link
                        to="/cadastro"
                        className={"home-btn" + (p.highlight ? " primary" : "")}
                      >
                        {p.priceCents
                          ? "Criar conta e assinar"
                          : "Começar grátis"}
                      </Link>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="home-lead">Carregando planos…</p>
            )}
          </div>
        </section>

        <section className="home-closing">
          <div className="home-wrap">
            <h2>
              Com o Coflu, dinheiro a dois fica
              <br />
              <em>descomplicado.</em>
            </h2>
            <Link to={cta} className="home-btn primary large">
              {ctaLabel} <ArrowRight size={18} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <div className="home-wrap home-footer-inner">
          <Logo />
          <p>Finanças do casal em um só lugar.</p>
          <nav aria-label="Rodapé">
            <Link to="/entrar">Entrar</Link>
            {signup && <Link to="/cadastro">Criar conta</Link>}
            <a href="#planos">Planos</a>
          </nav>
          <small>© {new Date().getFullYear()} Coflu</small>
        </div>
      </footer>
    </div>
  );
}

function PhoneMock() {
  const envelopes = [
    ["Mercado", 72, "R$ 864 de R$ 1.200"],
    ["Casa", 45, "R$ 540 de R$ 1.200"],
    ["Lazer", 91, "R$ 364 de R$ 400"],
  ] as const;
  return (
    <div className="home-phone" aria-hidden>
      <div className="home-phone-screen">
        <div className="home-phone-top">
          <small>
            Orçamento de{" "}
            {new Date().toLocaleDateString("pt-BR", { month: "long" })}
          </small>
          <strong>R$ 1.732 livres</strong>
        </div>
        {envelopes.map(([name, pct, label]) => (
          <div key={name} className="home-envelope">
            <div>
              <span>{name}</span>
              <small>{label}</small>
            </div>
            <i>
              <b
                style={{ width: pct + "%" }}
                className={pct > 85 ? "warn" : ""}
              />
            </i>
          </div>
        ))}
        <div className="home-phone-toast">
          <MessageCircle size={15} /> Mercado R$ 120,00 lançado pelo Telegram
        </div>
      </div>
    </div>
  );
}

function ChatMock() {
  return (
    <div className="home-chat" aria-hidden>
      <div className="home-chat-head">
        <span className="home-chat-avatar">
          <Bot size={18} />
        </span>
        <div>
          <strong>Coflu</strong>
          <small>bot no Telegram</small>
        </div>
      </div>
      <div className="home-chat-body">
        <p className="me">mercado 120 no débito</p>
        <div className="bot">
          <strong>Confere?</strong>
          <span>Mercado · R$ 120,00</span>
          <span>Conta corrente · hoje</span>
          <div className="home-chat-buttons">
            <span>Salvar</span>
            <span>Corrigir</span>
          </div>
        </div>
        <p className="me">✓ Salvar</p>
        <p className="bot short">Lançado. Ainda cabem R$ 336 em Mercado.</p>
      </div>
    </div>
  );
}
