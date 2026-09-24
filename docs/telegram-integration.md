# Telegram + OpenAI — Coflu

Implementado como entrada adicional da aplicação existente. A identidade visual e o serviço financeiro foram preservados. O bot prepara **sugestões**; somente o botão **Confirmar**, acionado pelo usuário vinculado, chama o serviço existente de criação de transações.

## Configuração

Todas as variáveis abaixo pertencem **ao backend**. Não usar prefixo VITE_, não colocá-las no Git nem no frontend.

| Variável | Uso |
| --- | --- |
| TELEGRAM_BOT_TOKEN | Token do bot fornecido pelo BotFather |
| TELEGRAM_WEBHOOK_SECRET | Segredo aleatório, mínimo 32 caracteres; recomendado hexadecimal de 32 bytes |
| OPENAI_API_KEY | Chave do projeto OpenAI |
| OPENAI_FINANCE_MODEL | Modelo; padrão centralizado: gpt-4.1-mini |
| SUPABASE_URL | URL HTTPS do projeto Supabase existente |
| SUPABASE_SERVICE_ROLE_KEY | Chave de serviço do Storage, somente backend |
| SUPABASE_STORAGE_BUCKET | financial-attachments |
| DATABASE_URL / DIRECT_URL | Conexões Prisma existentes |
| JWT_SECRET / APP_ORIGIN / APP_MODE | Configuração existente da aplicação |

O arquivo .env.example contém apenas placeholders. Foi gerado um TELEGRAM_WEBHOOK_SECRET no .env local, sem imprimir seu valor. As variáveis locais não são automaticamente copiadas para Render/Vercel.

Para trocar o modelo, altere OPENAI_FINANCE_MODEL no ambiente da API e reinicie/republique. O modelo escolhido precisa suportar Responses API, entrada de imagens/PDF e Structured Outputs. O teste externo desta entrega usou gpt-4.1-mini e o serviço retornou gpt-4.1-mini-2025-04-14. Nenhuma chamada de modelo está no navegador.

## Banco e bucket privado

Migration aditiva: apps/api/prisma/migrations/20260923010000_telegram_suggestions/migration.sql.

~~~sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm telegram:setup
~~~

O último comando verifica o bot com getMe e verifica/cria financial-attachments como **privado**, com limite de 10 MB e tipos JPEG, PNG, WebP e PDF. Se encontrar um bucket público, falha; não publica documentos nem altera silenciosamente a visibilidade de um bucket existente.

Também é possível criar o bucket pelo painel Supabase: Storage → New bucket → financial-attachments → Public bucket DESATIVADO. Não conceder políticas públicas de leitura/escrita. A API acessa o Storage com a chave de serviço. A migration retira privilégios dos papéis públicos anon/authenticated nas novas tabelas, mantendo o padrão existente de acesso por Fastify/Prisma.

Anexos guardam storagePath, SHA-256 e metadados, sem URL pública permanente. Downloads temporários exigem usuário autenticado, dono da sugestão e Household correto; a URL assinada dura até 300 segundos. O documento original é privado; campos textuais extraídos são minimizados, PAN é removido e chaves PIX não são retidas.

## Produção: Render + Vercel existentes

1. Publique esta versão da API no Render e o frontend na Vercel. Build e start permanecem os existentes; gere o Prisma Client e aplique migrations no deploy.
2. Copie as variáveis de integração para o **serviço backend Render**. Use o mesmo projeto Supabase e o mesmo bot. Não colocar chaves na Vercel estática.
3. Preserve APP_ORIGIN=https://nossagrana-alpha.vercel.app (sem barra final) e HOST=0.0.0.0 no Render.
4. Verifique /api/health no backend.
5. Registre o webhook somente depois de a versão nova estar publicada:

~~~sh
pnpm telegram:setup https://nossagrana.onrender.com/api/integrations/telegram/webhook
~~~

Execute com as variáveis do ambiente de produção carregadas. O script envia o segredo por API, sem incluí-lo na linha de comando, e verifica a existência do endpoint antes de registrar. O endpoint é POST /api/integrations/telegram/webhook. O Telegram deve enviar X-Telegram-Bot-Api-Secret-Token com o segredo configurado. São recebidos apenas message e callback_query; updates pendentes não são descartados.

A fila PostgreSQL roda dentro do processo da API. O backend precisa estar em execução para processar e retentar tarefas. Em um serviço suspenso, tarefas persistem e retomam quando a API voltar; um serviço sempre ativo evita atrasos. Não executar getUpdates/long polling junto com webhook. Esta versão não adiciona um segundo consumidor por long polling.

**O webhook de produção não foi registrado nesta entrega:** isso depende da publicação deste código no backend. O comando acima é a etapa de ativação após o deploy.

## Desenvolvimento local

~~~sh
pnpm dev
~~~

Abra o frontend local, entre e use Configurações → Telegram. Para receber mensagens reais localmente, exponha a API por um túnel HTTPS e registre esse endereço no script de setup. Um bot tem apenas um webhook: para não deslocar produção, use outro bot de desenvolvimento. Não executar testes de fila enquanto um worker real do mesmo banco consome updates de teste.

## Conectar Fábio e Bianca

Cada pessoa precisa fazer a vinculação em sua própria sessão do Coflu:

1. Fábio entra com seu e-mail/senha existentes.
2. Abre Configurações → Telegram → Conectar Telegram.
3. Abre o link e toca em Iniciar no bot.
4. Volta ao aplicativo e clica em Atualizar conexão.
5. Bianca repete os passos usando o próprio login e Telegram.

Não compartilhe links de vinculação. Eles são aleatórios, expiram em 10 minutos e são de uso único. Só o hash é guardado no banco/fila. O nome da saudação vem do cadastro real, não do username do Telegram. A identidade é resolvida pelo ID numérico do Telegram → User → Household. Grupos, bots e usuários não vinculados não processam documentos.

Desconectar remove identidade, links e callbacks pendentes; lançamentos confirmados permanecem no histórico.

## Conferir, editar e confirmar

- Envie uma foto, print ou PDF de até 10 MB, ou descreva um lançamento por texto em conversa privada.
- Receba o resumo com valor, data, tipo, pagamento, categoria, conta/cartão e responsável.
- Quando faltar informação ou houver duas contas do mesmo banco, escolha explicitamente. O sistema não cria contas. Categorias não reconhecidas recebem Outros; se essa categoria estiver ausente, somente ela é criada no Household.
- Use Editar para descrição, valor total, data, tipo, pagamento, conta, destino, cartão, categoria/subcategoria, responsável ou parcelas.
- Valores digitados: 187,42 ou 187.42; datas: AAAA-MM-DD. /cancelar sai de uma edição textual.
- Compras parceladas exigem revisar **valor TOTAL e quantidade de parcelas**. A integração não multiplica automaticamente valor de parcela.
- Confirmar salva pela função createTransaction existente; transferências usam o mesmo fluxo que cria Transfer, e crédito/parcelas usam as faturas existentes.
- Descartar não cria movimentação. Confiança alta nunca dispensa confirmação.
- O dashboard atualiza ao retornar à janela e a cada 30 segundos enquanto está visível.

Só BRL é aceito. Moeda ausente/estrangeira exige correção explícita do valor em reais. Documentos com vários eventos devem ser revisados e não são desdobrados automaticamente.

### Lançamentos por texto

Exemplo: `Recebi 600 reais de freelancer hoje no cofrinho do PicPay`. O bot prepara uma receita de R$ 600,00 e procura a conta ativa pelo nome, banco e responsável citados. Se existir um único cofrinho compatível, ele aparece no resumo; citar apenas PicPay quando existem várias contas exige escolher a conta. A categoria desconhecida usa Outros. Nenhuma nova conta é criada.

`Vou receber 600 amanhã no cofrinho do PicPay` prepara uma receita pendente: salvar a sugestão não aumenta o saldo até a confirmação do recebimento no aplicativo. Quando o texto não esclarece se o dinheiro já chegou à conta, o resumo exige escolher a situação. O botão Editar permite corrigir todos os campos, inclusive situação. Evento realizado sem data usa o dia do envio em America/Sao_Paulo, com aviso; evento futuro sem data deve ser completado.

Mensagens com mais de uma movimentação pedem um envio por lançamento. Conversas e perguntas não criam sugestões. A IA interpreta o texto e pode errar: a confirmação humana continua obrigatória. Reentregas do mesmo update reutilizam a sugestão, e confirmar duas vezes não duplica o lançamento. Texto livre não cria nem exige anexo; a rota de comprovante retorna 404 quando a sugestão não possui arquivo. O texto da fila é apagado ao concluir o processamento; a extração estruturada mantém o histórico da sugestão.

Publicação: aplicar `pnpm db:migrate` antes de iniciar o backend atualizado. A migration `20260924120000_telegram_text` permite sugestões sem anexo e acrescenta a situação financeira, preservando sugestões antigas como confirmadas financeiramente (mas ainda sujeitas à confirmação humana). Não requer novas variáveis de ambiente nem novo webhook.

## Modelos e endpoints

Modelos novos:
- TelegramIdentity: vínculo único User/ID numérico Telegram e estado temporário de edição.
- TelegramLinkToken: hash, validade e consumo do token.
- TelegramUpdate: update_id único, tarefa durável, lease, tentativas, status e código de erro.
- TransactionSuggestion: extração estruturada, campos sugeridos, usuário/família, anexos, revisão, duplicidade, versão, status e uso do modelo.
- TelegramCallback: tokens opacos que apontam para ação/seleção server-side, com versão e validade.

Alterados:
- Attachment: hash, status de armazenamento, retenção, vínculo Household e sugestão.
- Transaction: suggestionId, preservando a relação de todas as parcelas com a sugestão.
- User, Household, Account, CreditCard, Category e Subcategory: relações inversas.
- As relações sugeridas possuem FKs; a confirmação revalida pertencimento, atividade e regras financeiras, pois FK isolada não autoriza acesso.

Endpoints:
| Método | Caminho | Acesso |
| --- | --- | --- |
| POST | /api/integrations/telegram/webhook | Segredo Telegram obrigatório |
| GET | /api/integrations/telegram | Sessão: status do próprio vínculo |
| POST | /api/integrations/telegram/link | Sessão: gera link próprio |
| DELETE | /api/integrations/telegram | Sessão: desconecta próprio usuário |
| GET | /api/integrations/telegram/suggestions/:id/attachment | Sessão + dono + Household |

## Segurança, idempotência e falhas

- Webhook só valida/enfileira; downloads, Storage, OpenAI e respostas são processados pelo worker.
- Limite de 40 mensagens por remetente/hora, além do limite do endpoint.
- Downloads têm timeout, leitura limitada e comparação de MIME com assinatura do arquivo. IDs de arquivo são resolvidos exclusivamente pela API Telegram.
- SHA-256 é único por Household. Arquivo idêntico não repete análise quando já existe sugestão; arquivo semelhante só produz alerta de possível duplicidade financeira.
- Possível duplicidade compara valor/data com descrição ou conta/cartão, além do identificador extraído em hash. É uma heurística, não garantia de detectar todos os casos.
- update_id único impede reprocessar o mesmo update. Tombstones são preservadas depois de limpar o payload.
- Callback guarda apenas token opaco no Telegram. Dados escolhidos ficam no banco. Versão invalida botões antigos; dono e Household são verificados novamente.
- Confirmação e todas as transações/parcelas são gravadas na mesma transação serializável. Duplo clique retorna que já foi salvo; falha do serviço financeiro faz rollback da confirmação.
- Fila usa lease global renovável para preservar processamento sequencial, sem Redis. Há até três tentativas para falhas transitórias de provedores.
- Storage usa caminho determinístico e checkpoint; upload sucedido antes de interrupção pode ser repetido no mesmo caminho. Metadados existem antes de upload e permitem limpeza de órfãos.
- Uma interrupção entre OpenAI responder e a sugestão ser persistida pode repetir a chamada paga; não cria duas sugestões/transações. Mensagens Telegram também podem ser reenviadas após falha entre envio e checkpoint. Não se promete entrega exatamente uma vez para serviços externos.
- Nenhum corpo de documento, token, chave ou resposta completa de provedor é escrito nos logs. Metadados de modelo/tokens ficam na sugestão; erros de fila guardam códigos.
- Sugestões expiram em 7 dias. Anexos não confirmados são removidos do Storage depois de 30 dias; metadados/hash permanecem para deduplicação. Confirmados são conservados como comprovantes.
- Limpeza roda a cada hora com API ativa; manualmente: pnpm telegram:cleanup.

## Arquivos da implementação

Criados:
- apps/api/src/integrations/telegram/config.ts
- apps/api/src/integrations/telegram/analyzer.ts
- apps/api/src/integrations/telegram/providers.ts
- apps/api/src/integrations/telegram/identity.ts
- apps/api/src/integrations/telegram/suggestions.ts
- apps/api/src/integrations/telegram/integration.ts
- apps/api/src/integrations/telegram/routes.ts
- apps/api/prisma/migrations/20260923010000_telegram_suggestions/migration.sql
- apps/web/src/components/TelegramIntegration.tsx
- tests/telegram.test.ts
- scripts/telegram-setup.ts
- scripts/telegram-cleanup.ts
- scripts/telegram-live-check.ts
- scripts/telegram-browser-check.mjs
- eslint.config.mjs
- docs/telegram-integration.md

Alterados:
- apps/api/prisma/schema.prisma; apps/api/src/app.ts; server.ts; service.ts
- apps/web/src/App.tsx; pages/SettingsLogin.tsx
- .env.example; package.json; pnpm-lock.yaml; tsconfig.json; README.md
- scripts/security-check.mjs; tests/api.test.ts
- Remoção mecânica de imports/variáveis sem uso e const em financial-routes.ts, Charts.tsx, Transactions.tsx e lib/finance.ts para o lint.

O ignoreDeprecations foi alinhado à versão TypeScript 5.9 instalada; o valor 6.0 que estava no arquivo causava erro de compilação com essa versão.

## Validação

~~~sh
pnpm db:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
~~~

tests/telegram.test.ts cobre autorização, token único/expirado, nome real, sugestões sem lançamento, confirmação concorrente, descarte, PIX, receita, transferência, crédito, parcelas, campos ausentes, ambiguidade, cartões, categorias, duplicidade exata/financeira, reenvio de update, isolamento de famílias, MIME/tamanho, PDF, falhas OpenAI/Storage, callbacks adulterados, edição, webhook, retry, expiração e desvinculação.

A suíte comum usa PostgreSQL Supabase com famílias de teste isoladas e **simula Telegram, OpenAI e Storage**. Não usa comprovantes reais nem chamadas pagas. A limpeza exclui apenas as famílias identificadas como pertencentes à execução de teste. O teste financeiro antigo foi ajustado para comparar os dados reais antes/depois, sem assumir que a família real está vazia.

Verificação externa opcional, com custo de API e documento sintético:

~~~sh
pnpm exec tsx scripts/telegram-live-check.ts
~~~

Ela verifica getMe, bucket privado, upload/download assinado e extração real de imagem/PDF, sem mensagens ao usuário ou transações. Remove seu próprio arquivo de teste ao terminar.

Verificação de navegador:

~~~sh
node scripts/telegram-browser-check.mjs
~~~

Usa usuário temporário para testar login, Configurações, geração do link e tema/responsividade. O link não é enviado a ninguém e o vínculo real das pessoas não é alterado.

## Limites da entrega e ativação restante

O banco foi migrado, o bucket privado criado, o bot verificado e a extração real testada com documentos sintéticos. O recebimento de uma mensagem real enviada por Fábio/Bianca, o clique humano no bot e a confirmação após deploy ainda dependem de publicar esta versão, registrar o webhook e conectar cada pessoa. Não foram declarados como teste end-to-end real.

Textos financeiros livres, processamento automático de extratos com várias transações e edição do arquivo original não fazem parte desta versão. O build mantém o aviso anterior de bundle grande; não houve redesenho ou reestruturação do frontend para esta integração.

Referências oficiais: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [entrada de arquivos](https://developers.openai.com/api/docs/guides/file-inputs), [Telegram Bot API](https://core.telegram.org/bots/api), [Supabase buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals).


### Resultados registrados nesta entrega

- Prisma Client gerado; schema validado; migration aplicada; histórico atualizado e comparação banco/schema sem diferenças.
- Typecheck, lint e build passaram. Vite manteve o aviso de chunk acima de 500 kB.
- Suíte final completa: 57 testes passaram, incluindo transferência entre contas do mesmo titular. Zero falhas ou testes ignorados.
- Serviços reais: getMe Telegram; criação/verificação do bucket privado; upload, URL assinada e remoção do arquivo sintético; Responses API para PNG e PDF (valor 187,42 e data 2026-09-23 corretos).
- Navegador Chrome: login, card, geração de link, desktop/mobile, tema claro/escuro; nenhum erro de console depois do login nem resposta 5xx.
- Auditoria de secrets: nenhum segredo encontrado e nenhum .env real rastreado pelo Git.
- Não executados: publicação desta versão, registro do webhook de produção, vinculação real de Fábio/Bianca e confirmação humana de um comprovante real.

## Ajuste de reconhecimento de comprovantes

Para novos comprovantes, categoria ausente ou sem correspondência utiliza a categoria Outros do Household. A categoria é criada de forma idempotente somente se necessária. Uma categoria reconhecida continua sendo preservada; não são criadas categorias com nomes inventados pela IA nem subcategorias no fallback.

O titular é comparado por palavras completas, permitindo o nome completo no campo De corresponder ao responsável abreviado do cadastro. Razões sociais de bancos são normalizadas (por exemplo, BANCO SANTANDER S.A. → Santander). Duas contas compatíveis continuam sem seleção automática. Em receitas, é considerado o destinatário. O prompt diferencia banco da origem e banco do destinatário. Lançamentos confirmados e extrações antigas não são reescritos.

Validação deste ajuste: 18 testes (reconhecimento + domínio), typecheck e lint passaram. O teste de fallback usou família isolada no Supabase e verificou criação concorrente única de Outros, sem criar transações. A suíte de fila não foi executada contra o banco com worker de produção ativo para não misturar tarefas simuladas com mensagens reais.
