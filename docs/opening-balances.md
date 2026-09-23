# Coflu — valores iniciais de faturas

## Fonte de verdade e modelagem

A arquitetura original usa Invoice por cartão e competência de fechamento, Transaction para compras e pagamentos, InstallmentPurchase/Installment para distribuir parcelas, service.ts para mutações e overview, e analytics.ts para relatórios. Não há serviço separado de créditos negativos ou juros. Estornos existentes cancelam transações/pagamentos; somente CONFIRMADA afeta os totais. O fechamento é determinado pelas datas do ciclo; não há lançamento automático de fechamento.

Invoice ganhou openingBalance (Int, centavos inteiros, NOT NULL DEFAULT 0, CHECK >= 0) e openingBalanceDate (Date nullable, dia de inclusão no fuso de São Paulo). A chave única cardId + competence existente garante um saldo efetivo por ciclo. Nenhuma compra, categoria, pessoa ou Transaction é criada ao informar saldos. O campo pode ser reduzido futuramente em uma operação atômica que cadastre uma compra explicitamente identificada como parte dele; esse fluxo futuro não foi implementado.

A migration é 20260923120000_invoice_opening_balance/migration.sql. Adiciona dois campos e uma restrição; não remove tabela, coluna ou dados. Foi testada do zero e sobre o schema anterior com uma fatura/compra de teste, preservando ambas. Foi aplicada ao Supabase existente: 22 faturas preservadas, 30 transações antes e depois e soma inicial zero.

## Cálculos e pagamentos

- Total da fatura = openingBalance + compras/parcelas confirmadas daquele ciclo.
- Restante da fatura = total - pagamentos confirmados.
- Comprometimento = saldos iniciais de todos os ciclos + todas as compras/parcelas confirmadas do cartão - pagamentos confirmados. O valor agregado da compra parcelada não é somado novamente.
- Disponível = limite cadastrado - comprometimento.

invoiceAmounts centraliza total/pago/restante, inclusive para validar pagamentos. cardCommitment é compartilhado entre cardUsed (validações de gravação) e overview (resumos). Não é uma segunda regra concorrente baseada somente na fatura atual.

O pagamento mantém a Transaction existente com paymentInvoiceId e InvoicePayment: debita a conta selecionada, atualiza status/restante e libera limite. Analytics e monthTransactions já excluem pagamentos das despesas; saldos iniciais ficam fora dessas transações por construção. Estornar pagamento recompõe conta, fatura e limite.

O patrimônio considera o compromisso importado desde openingBalanceDate, incluindo os ciclos futuros já comprometidos. Não reconstrói histórico anterior à adoção do Coflu. O campo representa uma fotografia corrigível, não um livro de auditoria de versões passadas.

## API

- GET /api/cards/:id/opening-balances: lista competência, valor em centavos e indicador de bloqueio por pagamento.
- PUT /api/cards/:id/opening-balances: substitui atomicamente o conjunto de saldos. Body: { balances: [{ competence: "2026-10", amount: 250000 }] }. Mês omitido ou valor zero remove somente o saldo inicial, preservando Invoice e compras.
- POST /api/cards e PUT /api/cards/:id: aceitam openingBalances opcional; cadastro do cartão e saldos são atômicos. Omitir o campo em uma edição comum preserva os saldos.
- POST /api/invoices/:id/pay: passa a considerar openingBalance no restante.
- GET /api/overview: expõe os campos e os totais atualizados para cartões, faturas, dashboard, planejamento e calendário.

Autenticação e household vêm da sessão. O cartão é validado dentro da transação, e o cliente não envia invoiceId. Schemas strict rejeitam campos indevidos, negativos, NaN, centavos fracionados, meses inválidos e competências repetidas. Os valores são absolutos: um retry no mesmo cartão/ciclo não incrementa saldo. A operação usa a transação serializable com retries já existente. Meses não precisam ser consecutivos. Pagamentos confirmados bloqueiam mudanças do saldo daquele ciclo; um retry sem alteração permanece permitido. O limite total continua sendo respeitado.

## Interface

O cadastro pergunta se já existem valores comprometidos após os dados básicos. O mesmo formulário de valores é reutilizado pela ação Valores iniciais em cartões existentes. Permite adicionar/remover ciclos, editar valor e escolher mês em português e ano. Totais e valores usam reais em padrão brasileiro. Meses com pagamentos ficam bloqueados com explicação.

Cartões distinguem limite total, disponível, comprometido, fatura atual e próximas faturas. As próximas faturas abrem a competência correta. No detalhe da fatura, Valores anteriores ao Coflu / Saldo inicial/importado ficam separados dos Lançamentos. Os componentes Dialog, Button, tokens e cores existentes foram preservados. No mobile os campos ficam em linhas verticais, sem tabela/rolagem horizontal.

## Validação

- 25 cenários novos em tests/opening-balances.test.ts cobrem os 22 requisitos, atomicidade, concorrência, estorno e proteção após pagamento.
- 101 testes passaram na suíte completa sequencial, incluindo finanças, domínio, marca, matching de comprovantes e Telegram com provedores simulados.
- Typecheck, ESLint e build Vite passaram; permanece o aviso preexistente de bundle acima de 500 kB.
- Chrome real: cadastro com seis meses, começar do zero, validação de valor negativo, adição/edição/exclusão posterior, mês não consecutivo, virada de ano, proteção de valores pagos e pagamento pela interface.
- Nove capturas desktop/mobile e claro/escuro; sem erros JavaScript ou HTTP 5xx. Evidência local: docs/opening-balances-verification.json e docs/screenshots/coflu-opening-*.png.
- Não foram feitas compras ou pagamentos de teste na base real. Toda a aceitação financeira ocorreu no banco local isolado.
- A suíte antiga foi desacoplada do ID da família real. O runner exige TEST_DATABASE_URL local e execução sequencial para evitar interferência entre testes de integração. Foi preservada explicitamente a resposta 409 ao excluir categoria com histórico, inclusive no PostgreSQL 18 local.

### Cenário de aceitação

| Estado | Fatura OUT | Comprometido | Disponível | Despesas de OUT |
| --- | ---: | ---: | ---: | ---: |
| Saldos OUT 2500, NOV 1100, DEZ 800, JAN 600, FEV 500, MAR 500 | R$ 2.500,00 | R$ 6.000,00 | R$ 4.000,00 | R$ 0,00 |
| Mercado 180 + Combustível 220 + Restaurante 100 | R$ 3.000,00 | R$ 6.500,00 | R$ 3.500,00 | R$ 500,00 |
| Pagamento integral de OUT | R$ 0,00 restante | R$ 3.500,00 | R$ 6.500,00 | R$ 500,00 |

A conta de teste começou em R$ 20.000,00 e terminou em R$ 17.000,00. Outubro ficou Paga, mantendo total histórico de R$ 3.000,00. Teste adicional: saldo de R$ 3.000,00 com pagamento de R$ 1.000,00 deixa R$ 2.000,00 e libera R$ 1.000,00 de limite. Outro teste combina saldo de R$ 1.000,00 com compra de R$ 3.000,00 em 10 parcelas e confirma comprometimento de R$ 4.000,00, sem duplicação.

## Arquivos alterados

- apps/api/prisma/schema.prisma e migrations/20260923120000_invoice_opening_balance/migration.sql.
- apps/api/src/domain.ts, service.ts, financial-routes.ts e analytics.ts.
- packages/shared/src/validation.ts e types.ts.
- apps/web/src/components/OpeningBalances.tsx e Editors.tsx.
- apps/web/src/pages/AccountsCards.tsx, App.tsx e styles/pages.css.
- tests/opening-balances.test.ts e api.test.ts.
- scripts/opening-balances-browser-qa.mjs, scripts/run-tests.mjs, package.json e .env.example.
- README.md e este documento.

## Limites preservados

Não implementa importação detalhada/substituição automática de saldo por compras. Não muda o modelo existente de estornos, fechamento ou juros. Valores que excedem o limite cadastrado são rejeitados, seguindo a validação financeira atual. Editar/excluir valores de faturas com pagamentos exige estorno. O retry de saldos de um cartão existente é idempotente; a criação de cartões continua com a semântica POST já existente (não introduz chave global de idempotência para cadastro de cartões).
