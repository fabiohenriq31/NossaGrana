import { paymentMethods } from "@/components/Editors";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, SlidersHorizontal, Download } from "lucide-react";
import type {
  Overview,
  Transaction,
} from "../../../../packages/shared/src/types";
import { Button } from "@/components/ui/button";
import { TransactionList } from "@/components/Transactions";
import { MonthSelector } from "@/components/common";
export function TransactionsPage({
  data,
  month,
  setMonth,
  search,
  setSearch,
  onEdit,
  onNew,
}: {
  data: Overview;
  month: string;
  setMonth: (s: string) => void;
  search: string;
  setSearch: (s: string) => void;
  onEdit: (t: Transaction) => void;
  onNew: () => void;
}) {
  const [type, setType] = useState(""),
    [person, setPerson] = useState(""),
    [status, setStatus] = useState(""),
    [category, setCategory] = useState(""),
    [account, setAccount] = useState(""),
    [card, setCard] = useState(""),
    [method, setMethod] = useState(""),
    [filters, setFilters] = useState(false);
  const needle = search.toLocaleLowerCase("pt-BR");
  const list = data.transactions
    .filter((t) => t.competence === month)
    .filter(
      (t) =>
        (!type || t.type === type) &&
        (!person || t.owner === person) &&
        (status ? t.status === status : t.status !== "CANCELADA") &&
        (!account ||
          t.accountId === account ||
          t.destinationAccountId === account) &&
        (!card || t.cardId === card) &&
        (!method || t.paymentMethod === method) &&
        (!category || t.categoryId === category) &&
        [
          t.description,
          t.notes,
          ...t.tags,
          data.categories.find((c) => c.id === t.categoryId)?.name || "",
          data.accounts.find((a) => a.id === t.accountId)?.name || "",
        ]
          .join(" ")
          .toLocaleLowerCase("pt-BR")
          .includes(needle),
    );
  function exportCsv() {
    const escape = (s: string) =>
      '"' + s.replace(/"/g, '""').replace(/^[=+@-]/, "'") + '"';
    const csv =
      "\uFEFFDescrição;Valor em centavos;Data;Tipo;Responsável;Status\n" +
      list
        .map((t) =>
          [
            escape(t.description),
            t.amount,
            t.date.slice(0, 10),
            t.type,
            escape(t.owner),
            t.status,
          ].join(";"),
        )
        .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "nossagrana-" + month + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Transações</h1>
          <p>Controle cada detalhe das nossas finanças.</p>
        </div>
        <Button onClick={onNew}>
          <Plus size={17} />
          Nova transação
        </Button>
      </div>
      <div className="filter-toolbar panel">
        <div className="search-field">
          <Search size={18} />
          <input
            aria-label="Buscar transações"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar transações…"
          />
        </div>
        <select
          aria-label="Tipo de transação"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">Todos os tipos</option>
          <option value="RECEITA">Receitas</option>
          <option value="DESPESA">Despesas</option>
          <option value="TRANSFERENCIA">Transferências</option>
        </select>
        <MonthSelector month={month} setMonth={setMonth} />
        <Button
          variant="outline"
          size="icon"
          aria-label="Mais filtros"
          aria-expanded={filters}
          onClick={() => setFilters(!filters)}
        >
          <SlidersHorizontal size={17} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Exportar transações"
          onClick={exportCsv}
        >
          <Download size={17} />
        </Button>
      </div>
      {filters && (
        <div className="advanced-filters panel">
          <label>
            Responsável
            <select
              aria-label="Responsável"
              value={person}
              onChange={(e) => setPerson(e.target.value)}
            >
              <option value="">Todos</option>
              {["Fábio", "Bianca", "Casa"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Situação
            <select
              aria-label="Situação"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Todas</option>
              <option value="CONFIRMADA">Confirmadas</option>
              <option value="PENDENTE">Pendentes</option>
              <option value="CANCELADA">Canceladas</option>
            </select>
          </label>
          <label>
            Categoria
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Todas</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Conta
            <select
              aria-label="Conta"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">Todas</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.owner} · {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cartão
            <select
              aria-label="Cartão"
              value={card}
              onChange={(e) => setCard(e.target.value)}
            >
              <option value="">Todos</option>
              {data.cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Forma de pagamento
            <select
              aria-label="Forma de pagamento"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="">Todas</option>
              {paymentMethods.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="ghost"
            onClick={() => {
              setType("");
              setPerson("");
              setStatus("");
              setCategory("");
              setAccount("");
              setCard("");
              setMethod("");
              setSearch("");
            }}
          >
            Limpar filtros
          </Button>
        </div>
      )}
      {search && (
        <div className="search-matches">
          {data.accounts
            .filter((a) =>
              (a.name + " " + a.bankId).toLowerCase().includes(needle),
            )
            .map((a) => (
              <Link to="/contas" key={a.id}>
                Conta: {a.name}
              </Link>
            ))}
          {data.categories
            .filter((c) => c.name.toLowerCase().includes(needle))
            .map((c) => (
              <Link to="/categorias" key={c.id}>
                Categoria: {c.name}
              </Link>
            ))}
        </div>
      )}
      <section className="panel transactions-page">
        <div className="panel-heading">
          <h2>Movimentações</h2>
          <span className="muted">{list.length} lançamentos</span>
        </div>
        <TransactionList transactions={list} data={data} onClick={onEdit} />
      </section>
    </>
  );
}
