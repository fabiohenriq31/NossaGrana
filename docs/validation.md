# Validação final — 22/09/2026

- Build de produção e TypeScript: aprovados.
- Prisma schema: válido; Client regenerado; migrate diff não detectou divergências entre o schema e o Supabase.
- Quatro migrations aplicadas, sem reset ou remoção de dados reais.
- 17 testes aprovados (unidade e integração): saldos, PIX, débito, dinheiro, crédito, fechamento, centavos de parcelas, pagamentos parciais/integrais concorrentes, estorno, transferências, edição, cancelamento, contas a pagar/receber, recorrências, isolamento e reinício da API.
- Teste no Chrome aprovado: login de Fábio e Bianca, cadastro de três contas e cartão, lançamentos pelo formulário, 12 parcelas, edição/cancelamento, filtros, liquidação com conta/data, recorrência, pagamento parcial, troca de competência e reabertura do navegador.
- Nove páginas internas inspecionadas; capturas em 1920, 1440, 1280, 1024, 768, 390 e 360 px; sem overflow horizontal ou exceções JavaScript.
- Comparação visual: mantidas sidebar, sete indicadores, três gráficos, três painéis inferiores, cartão roxo, paleta e tipografia. Mobile mantém saldo, quatro atalhos e navegação inferior. Valores das imagens qa-* são testes isolados.
- Supabase real: dois usuários, 20 categorias de referência, zero contas/cartões/transações no encerramento dos testes. Núcleos temporários foram removidos.
- Permissões anon/authenticated: sem leitura ou escrita nas 17 tabelas financeiras/aplicação.
- Segredos: nenhuma ocorrência de credenciais reais nos arquivos de código/documentação/build verificados; .env e .env.* ignorados. Essa verificação foi realizada antes da publicação inicial no GitHub.

Evidências: browser-qa.json, database-verification.json, security-check.json, supabase-preflight.json e screenshots/real-empty-_.png / screenshots/qa-_.png. Outras capturas mais antigas registram etapas do protótipo, não o estado atual.

Limites explícitos: usuários iniciais são criados por script; não existe tela de cadastro de novos usuários. Upload/Storage, Telegram, leitura de documentos e integração automática com bancos ficam para etapas futuras. Recorrências são geradas pelo botão Gerar mês. Nenhum fluxo financeiro implementado usa mocks como fonte de dados.

O sistema está em execução local, conectado ao Supabase. Não foi publicado em hospedagem externa.
