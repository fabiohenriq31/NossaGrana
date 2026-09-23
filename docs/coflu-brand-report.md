# Coflu — relatório da correção de identidade

A alteração se limita à marca. Nenhuma regra financeira, layout, cor, tipografia, gráfico, espaçamento ou responsividade foi alterada. Nenhuma migration foi criada ou executada.

## Busca antes das alterações

Busca real com ripgrep, case-insensitive, incluindo arquivos ocultos e ignorados e todas as extensões. Padrão: nossa[ _-]?grana. Foram excluídos somente .git (histórico/objetos), node_modules e .pnpm-store (dependências de terceiros/cache).

Resultado: **48 ocorrências em 23 arquivos**; 38 nas fontes/documentação/configuração e 10 em build, ambiente e arquivos locais.

| Arquivo | Ocorrências antes |
| --- | ---: |
| .env | 2 |
| .local/postgres/postmaster.opts | 1 |
| .local/telegram-delivery-check.ts | 1 |
| apps/api/src/integrations/telegram/integration.ts | 3 |
| apps/api/src/integrations/telegram/suggestions.ts | 1 |
| apps/web/dist/assets/index-A0hoMERh.js | 4 |
| apps/web/dist/index.html | 2 |
| apps/web/index.html | 2 |
| apps/web/src/components/Shell.tsx | 1 |
| apps/web/src/pages/Dashboard.tsx | 1 |
| apps/web/src/pages/SettingsLogin.tsx | 1 |
| apps/web/src/pages/TransactionsPage.tsx | 1 |
| docs/design-system.md | 1 |
| docs/telegram-integration.md | 4 |
| package.json | 1 |
| README.md | 8 |
| scripts/browser-qa.mjs | 3 |
| scripts/dev.mjs | 1 |
| scripts/init-real.ts | 5 |
| scripts/telegram-browser-check.mjs | 1 |
| scripts/verify-database.mjs | 1 |
| tests/api.test.ts | 2 |
| vercel.json | 1 |

As saídas brutas com arquivo, linha, conteúdo e contagem foram guardadas fora do repositório, para que o próprio relatório de ocorrências não contaminasse uma nova busca:
- [Busca inicial](C:/Users/fabio/AppData/Local/Temp/coflu-brand-audit-before.json)
- [Busca final](C:/Users/fabio/AppData/Local/Temp/coflu-brand-audit-final.json)

## Arquivos alterados

- package.json: nome do pacote coflu; não havia dependências internas pelo nome antigo.
- apps/web/index.html: title, description, application-name, apple-mobile-web-app-title, Open Graph.
- apps/web/src/components/Shell.tsx: texto do logo na sidebar e componentes que reutilizam Logo.
- apps/web/src/pages/SettingsLogin.tsx: botão Entrar no Coflu.
- apps/web/src/pages/Dashboard.tsx: título Coflu no mobile.
- apps/web/src/pages/TransactionsPage.tsx: prefixo coflu- no CSV.
- apps/api/src/integrations/telegram/integration.ts: saudação, confirmação e orientação de conexão.
- apps/api/src/integrations/telegram/suggestions.ts: mensagem de autorização/conexão.
- apps/api/src/integrations/telegram/analyzer.ts: contexto de extração apresenta o produto como Coflu.
- scripts/dev.mjs: nome exibido ao iniciar.
- scripts/init-real.ts: e-mails padrão de instalações novas usam o domínio local da marca atual; IDs persistidos preservados.
- scripts/browser-qa.mjs e scripts/telegram-browser-check.mjs: expectativa exclusiva Entrar no Coflu.
- README.md, docs/design-system.md e docs/telegram-integration.md: nome do produto atualizado.
- apps/web/dist: regenerado; o bundle antigo foi substituído.

Criados para validação/documentação: tests/branding.test.ts, scripts/brand-browser-check.mjs e este relatório.

## Logo, metadata e PWA

O nome do logo é texto React. O SVG contém somente o símbolo de folhas e foi preservado sem redesenho. Os SVGs de bancos não contêm o nome da aplicação.

Título atual: Coflu • Nossas finanças. Descrição, Open Graph e nomes de aplicação/atalho Apple usam Coflu. Não havia manifest nem service worker/PWA configurados; não foi adicionada uma nova funcionalidade de PWA.

## Dados e compatibilidade

O Household real foi consultado: seu nome é Fábio & Bianca, um dado da família, preservado. Os seeds não criam nome de aplicação nesse campo. IDs de usuários/família, e-mails de login já cadastrados, URLs do Render/Vercel/GitHub e configuração histórica de PostgreSQL local foram preservados. Chaves técnicas de sessão/tema foram conservadas para não invalidar sessões nem preferências.

## Testes e Visual QA

- Typecheck: passou.
- ESLint: passou.
- Testes automatizados: 10 passaram (cinco de marca e cinco de domínio).
- Build Vite: passou; continua o aviso preexistente de bundle acima de 500 kB.
- Chrome real com usuário temporário isolado: login desktop/mobile, Dashboard desktop, sidebar, Dashboard mobile, menu mobile, Configurações/Telegram desktop e mobile, claro/escuro e title.
- Nove capturas de QA geradas em docs/screenshots/coflu-*.png.
- Sem erros de execução JavaScript ou respostas 5xx no QA.
- Saudação real do handler Telegram testada com identidade temporária e envio capturado em memória: Coflu; nenhuma mensagem externa enviada.
- Apenas dados temporários do QA foram inseridos e removidos; nenhum lançamento financeiro criado ou alterado.

## Busca final

**Zero branding anterior** nas fontes frontend/API, assets servidos, prompts e build regenerado.

A busca global ampla retorna **16 ocorrências técnicas em 10 arquivos**: 12 em fontes/documentação/configuração e quatro em arquivos locais ignorados. Cada ocorrência está registrada na saída final vinculada acima e na resposta final, com motivo individual. Não são nomes apresentados como marca do produto.

Para reproduzir a busca ampla:
~~~sh
rg -n -i --hidden --no-ignore --glob '!.git/**' --glob '!node_modules/**' --glob '!.pnpm-store/**' 'nossa[ _-]?grana' .
~~~
