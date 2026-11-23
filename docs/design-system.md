# Contrato visual Coflu

Uma única linguagem para a Home, o login e o app: verde-água da marca, cantos generosos, contornos discretos e hierarquia pelo tamanho e peso do texto.

Cores: tokens em `apps/web/src/styles/tokens.css`. Os principais são:

- `--brand`: botões principais, foco, item ativo e seleção;
- `--brand-soft`: fundos de destaque;
- `--segment`: aba selecionada nos seletores segmentados.

O tema escuro usa grafite esverdeado e o claro usa a paleta da Home (#f4f7f6). O roxo fica só em dados, como categorias e gráficos. Ele nunca é usado como cor de ação.

Camada visual: `apps/web/src/styles/theme.css` é carregado por último e define:

- base, campos, caixas de seleção, botões e menu;
- cabeçalho, painéis, listas e diálogos;
- o login em duas colunas.

A Saúde Financeira tem ajustes próprios em `health.css`, que é carregado junto com a página.

Medidas:

- Raio de painel 16 px e de controle 10 px.
- Campos com 44 px de altura e anel de foco na cor da marca.
- Sidebar de 240 px e cabeçalho fixo de 68 px com desfoque.
- Indicadores do painel em grade automática (mínimo de 200 px), sem cortar valores.
- Fonte Barlow e ícones Lucide.

Formulários: rótulo com checkbox ou radio fica em linha. Grupos de escolha (`.health-choices`) viram blocos clicáveis que ganham a cor da marca quando marcados. Ações do diálogo ficam fixas no rodapé.

Mobile até 700 px:

- barra de topo com marca, créditos e conta;
- navegação inferior com indicador do item ativo;
- diálogos abrem como folha que sobe do rodapé, com botões de largura total;
- nenhuma tela pode ter rolagem horizontal.

Login e cadastro: painel da marca à esquerda e formulário à direita. Abaixo de 860 px, só o formulário aparece, com link de volta à Home. O app instalado não mostra esse link. Os campos de senha têm botão para mostrar ou esconder o que foi digitado.

Valores financeiros são centavos inteiros.

Cadastros guiados (como o primeiro acesso à Saúde Financeira):

- uma pergunta por vez, com barra de progresso e botão Voltar;
- respostas de escolha única avançam ao tocar;
- escolha múltipla e valores usam Continuar (Enter também avança);
- o total de passos só pode diminuir durante o fluxo, nunca aumentar;
- o formulário completo continua disponível para edição depois.
