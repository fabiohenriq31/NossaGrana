# Coflu

Finanças compartilhadas de Fábio e Bianca, com a composição visual aprovada: dashboard escuro, sete indicadores, gráficos, listas, cartões, tema claro e navegação própria no celular.

React/Vite → API Fastify → Prisma → PostgreSQL do **projeto Supabase existente**. O frontend não usa supabase-js nem acessa tabelas diretamente. Valores financeiros são inteiros em centavos. localStorage armazena apenas a preferência de tema.

## Configuração e execução

Requisitos: Node.js 22.14+ e pnpm 11+. Não há criação automática de PostgreSQL local, infraestrutura, migrations ou dados demo.

1. Copie .env.example para .env somente se ainda não existir.
2. No painel do projeto Supabase existente, abra **Connect → Prisma** e copie as strings completas para DATABASE_URL e DIRECT_URL. Preserve exatamente host, usuário, porta, senha e parâmetros fornecidos. DATABASE_URL serve ao Prisma da aplicação; DIRECT_URL às migrations. Se a rede não suportar a conexão direta IPv6, obtenha no próprio painel a alternativa compatível para operações administrativas. Não reconstrua URLs manualmente.
3. Configure JWT_SECRET com pelo menos 32 caracteres aleatórios; APP_MODE=REAL; APP_ORIGIN=http://127.0.0.1:5173; PORT=3001; NODE_ENV=development.
4. Configure os e-mails e senhas iniciais nas variáveis FABIO_EMAIL, FABIO_PASSWORD, BIANCA_EMAIL e BIANCA_PASSWORD.
5. Execute:

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm db:verify
pnpm db:init-real
pnpm dev
```

Abra [Coflu](http://127.0.0.1:5173). Mantenha o terminal em execução. Para iniciar separadamente: pnpm dev:api e pnpm dev:web. O Vite encaminha /api ao Fastify em 127.0.0.1:3001. pnpm build valida TypeScript e gera o frontend em apps/web/dist.

Os segredos ficam no .env local do backend. Não é necessário cadastrá-los em funções do Supabase, porque esta API roda no Node/Fastify. Em uma futura hospedagem, configure essas mesmas variáveis no ambiente privado do servidor, APP_ORIGIN com a origem HTTPS real e NODE_ENV=production. Não publique variáveis VITE_ com segredos.

Documentação oficial: [Prisma com Supabase](https://supabase.com/docs/guides/database/prisma), [conexões PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Acesso inicial real

pnpm db:init-real cria apenas o household nossagrana-family, os usuários Fábio e Bianca e os catálogos de bancos e categorias. Não cria contas, cartões, saldos, compras ou faturas.

Em novas instalações, os e-mails padrão, caso não configurados, são fabio@coflu.local e bianca@coflu.local. Nas instalações existentes, preserve os e-mails de acesso configurados no ambiente e no banco. As senhas iniciais são as variáveis FABIO_PASSWORD e BIANCA_PASSWORD do .env. Se estiverem ausentes ou com o placeholder configure-me, a inicialização gera senhas aleatórias e grava somente nesse arquivo local, sem imprimi-las. Guarde-as e altere-as em Configurações após entrar.

A inicialização é idempotente e não redefine senhas de usuários existentes. A alteração de senha exige a atual e encerra as sessões antigas. Os dois usuários compartilham o mesmo núcleo financeiro.

No primeiro acesso, siga os atalhos do Dashboard: cadastrar primeira conta e saldo inicial, cadastrar cartões e registrar receitas/despesas.

## Regras financeiras implementadas

- Contas: banco com logo, várias contas por banco, titular, tipo, saldo inicial e data de referência, cor, observação e situação. Saldo inicial representa o início da data informada. Após a primeira movimentação, saldo inicial e data ficam preservados. Saldo atual deriva dos registros confirmados.
- Despesas: PIX, débito, dinheiro, boleto, crédito, transferência como meio de pagamento e outro. Categoria obrigatória. Dinheiro exige conta Carteira/Dinheiro. Receita entra na conta de destino. Transferência entre contas é um tipo próprio, atômico, com duas contas diferentes, sem criar receita/despesa no resultado.
- Cartões: banco, nome, titular, bandeira, últimos quatro dígitos opcionais, limite, fechamento, vencimento, cor e conta padrão para pagar. Nunca são aceitos PAN completo, CVV ou PIN. Fechamento/vencimento ficam preservados depois que existem faturas.
- Crédito não debita conta imediatamente. Compra no dia do fechamento pertence à fatura que fecha nesse dia; compra posterior vai à próxima. Parcelas têm vínculo com a compra original e são distribuídas em competências consecutivas; o resto em centavos vai às primeiras parcelas.
- O resultado mensal reconhece a despesa de crédito na competência da respectiva fatura/parcela. O patrimônio considera todas as obrigações confirmadas da compra desde sua data, inclusive parcelas futuras. O pagamento liquida a obrigação e sai da conta, sem repetir a despesa.
- Pagamento parcial/integral de fatura, saldo restante e limite disponível são derivados. Transações serializáveis com retry impedem pagamentos concorrentes acima do restante. Estorno cancela o pagamento e recompõe a conta.
- Pendências não afetam saldo. Ao confirmar, selecione conta e data efetivas; a data prevista fica preservada em dueDate. A confirmação repetida não duplica o lançamento.
- Recorrências semanais, mensais, anuais e por intervalo de dias. O cadastro cria a primeira ocorrência pendente; Planejamento → Gerar mês cria as seguintes. O dia âncora é preservado em fevereiro. A chave única recorrência/data impede duplicações, inclusive após cancelamento. Não há agendador automático externo.
- Edição atualiza o mesmo registro; saldos não recebem débitos incrementais duplicados. Uma parcela pode ter valor, descrição e categoria corrigidos. Data/cartão da série são preservados; cancele e recrie a compra para mudar sua estrutura. Compras de faturas com pagamento exigem estornar os pagamentos antes de alterar/cancelar.
- Cancelamentos preservam o histórico e deixam de compor os totais. Contas/cartões são arquivados. Categorias/subcategorias utilizadas têm exclusão bloqueada.
- Dashboard e relatórios recebem totais e séries calculados no backend; seletor de mês atualiza os dados. Transações têm busca, filtros por mês, tipo, responsável, conta, cartão, categoria, situação e forma de pagamento, além de exportação CSV.
- Datas civis são validadas e armazenadas com horário UTC estável; apresentação em pt-BR e BRL.

## Banco e migrations

O schema em apps/api/prisma/schema.prisma é a fonte de verdade. Migrations versionadas:

| Migration                                | Finalidade                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| 20260922202621_init                      | Estrutura inicial, vínculos, enums e índices                                             |
| 20260922210000_real_finance              | Data do saldo inicial, métodos de pagamento, cancelamento, parcelas, pagamentos e anexos |
| 20260922210100_private_api_access        | Revoga acesso das funções anon/authenticated às tabelas da aplicação                     |
| 20260922220000_preserve_category_history | Impede apagar categorias/subcategorias vinculadas ao histórico                           |

Tabelas: User, Household, Bank, Account, CreditCard, Invoice, InvoicePayment, Transaction, Transfer, Category, Subcategory, InstallmentPurchase, Installment, RecurringTransaction, Attachment, Tag e ExternalImport, além de _prisma_migrations.

InvoicePayment e Installment possuem vínculos próprios; valor, data e conta continuam no registro financeiro único para não duplicar fontes de verdade.

Aplicar em outro ambiente preparado: pnpm db:migrate. Verificar conectividade/tabelas: pnpm db:verify. Não usar db push como substituto do histórico. Nunca executar reset, truncate, drop database/schema na base real. A migration de categorias altera restrições e não remove registros.

## Segurança

Cookies JWT HttpOnly, SameSite=Strict, Secure em produção, expiração em oito horas e invalidação ao trocar a senha. Rotas protegidas com verificação do usuário e household no banco, validação Zod estrita, hashes bcrypt, rate limiting e verificação de origem nas mutações. IDs de outras famílias são rejeitados.

As funções públicas anon/authenticated da Data API não recebem acesso às tabelas financeiras. A autorização de negócio está no Fastify; não foram criadas políticas RLS permissivas. Use a conexão privada de backend indicada pelo painel. Migrations futuras que adicionem tabelas devem também manter as permissões privadas.

.env e .env.* são ignorados; somente .env.example é versionável. Segredos não aparecem no frontend ou documentação. Logs não incluem payloads financeiros ou senhas.

## Demo opcional, separado

**Não execute o seed na base real.** Nenhum comando dev executa seed.

O seed exige APP_MODE=DEMO, NODE_ENV diferente de production e SEED_PASSWORD local com pelo menos dez caracteres. Também recusa qualquer banco que contenha household REAL. Use exclusivamente um banco de desenvolvimento separado já configurado por você. Mude as variáveis de conexão somente no ambiente desse banco, aplique migrations e execute pnpm db:seed. Usuários demo: fabio@demo.local e bianca@demo.local. A API só autentica usuários cujo modo corresponda a APP_MODE.

## Anexos e integrações futuras

Attachment contém transactionId, householdId, storagePath, fileName, mimeType, fileSize, source e createdAt. apps/api/src/storage.ts define o contrato do armazenamento privado, caminho por household e limite de validade para downloads assinados.

Bucket previsto: financial-attachments, **privado**. SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são placeholders opcionais apenas no backend para essa etapa futura. O bucket não foi criado e upload, URLs assinadas, leitura automática de documentos e Telegram não estão implementados. Não há botões simulando essas operações. [Controle de acesso do Storage](https://supabase.com/docs/guides/storage/security/access-control).

## Validação

```sh
pnpm test
pnpm build
# Com frontend e API em execução:
pnpm test:browser
```

tests/domain.test.ts cobre centavos, fechamento, calendário, conservação de patrimônio e rejeição de entradas inválidas. tests/api.test.ts executa operações contra o Supabase com household UUID isolado, cobre o checklist financeiro e reinicia Fastify/Prisma para verificar persistência. O finally apaga somente registros desse núcleo de teste; nunca limpa o núcleo real.

scripts/browser-qa.mjs valida o primeiro acesso real vazio, cria núcleo temporário para os formulários, testa criação/edição/cancelamento/liquidação, reabre o navegador, verifica as páginas e os temas em larguras 360–1920 px. Antes de executar novamente depois de começar a usar a base real, adapte a asserção de primeiro acesso vazio para os dados reais existentes; ela não altera os dados reais. Capturas qa-* contêm dados temporários de teste, removidos ao terminar. Capturas real-empty-* mostram o primeiro acesso sem finanças. Evidência: docs/browser-qa.json e docs/supabase-preflight.json.

## Organização

- apps/web: interface, páginas e componentes.
- apps/api/src: autenticação, rotas, regras financeiras e cálculos.
- apps/api/prisma: schema e migrations.
- packages/shared: contratos e validações.
- scripts: desenvolvimento, inicialização real, demo e verificações.
- tests: unidade e integração.
- docs: design system e evidências.

Logos bancários são ativos estáticos de identificação. Fontes: [Simple Icons](https://github.com/simple-icons/simple-icons) e [react-bancos](https://github.com/henriquezolini/react-bancos). Veja apps/web/public/banks/README.md e LICENSE-react-bancos.txt. Não há integração com bancos/Open Finance, importação automática, sincronização bancária ou envio de notificações externas. Os lançamentos são manuais; os indicadores usam exclusivamente os registros persistidos na API.

## GitHub

Repositório: [Repositório Coflu](https://github.com/fabiohenriq31/NossaGrana).

O .gitignore exclui ambientes reais, dados locais, dependências, builds, capturas e relatórios JSON gerados pelos testes. As evidências citadas acima são geradas localmente ao executar os scripts. Somente .env.example, com placeholders, deve ser versionado. Antes de cada publicação, execute node scripts/security-check.mjs e revise git diff --cached.

## Comprovantes pelo Telegram

A integração Telegram + OpenAI está implementada com confirmação humana obrigatória. Envie imagem ou PDF; revise a sugestão e confirme no bot. Todas as gravações usam o serviço financeiro já existente.

No backend, configure TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, OPENAI_API_KEY, OPENAI_FINANCE_MODEL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SUPABASE_STORAGE_BUCKET. Use os placeholders de .env.example; nunca exponha essas chaves no frontend. O modelo padrão é gpt-4.1-mini e pode ser trocado por OPENAI_FINANCE_MODEL, seguido de reinício da API.

~~~sh
pnpm db:generate
pnpm db:migrate
pnpm telegram:setup
~~~

O setup verifica/cria o bucket privado financial-attachments. Após publicar esta versão da API, registre o webhook no backend:

~~~sh
pnpm telegram:setup https://nossagrana.onrender.com/api/integrations/telegram/webhook
~~~

Cada pessoa entra na própria conta e abre Configurações → Telegram → Conectar Telegram. O link é temporário e de uso único. O desenvolvimento local com Telegram real exige túnel HTTPS para a API e, preferencialmente, um bot separado; não combinar webhook e long polling.

Validação: pnpm typecheck, pnpm lint, pnpm test e pnpm build. A suíte simula os provedores externos e usa famílias isoladas no PostgreSQL. A verificação real opcional é pnpm exec tsx scripts/telegram-live-check.ts; ela consome chamadas OpenAI com documentos sintéticos.

O [guia completo da integração](docs/telegram-integration.md) descreve ambientes, produção/local, bucket, webhook, vinculação de Fábio/Bianca, modelos Prisma, endpoints, idempotência, retenção, testes e limitações. A publicação e a vinculação real no Telegram são etapas separadas dos testes automatizados.
