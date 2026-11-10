# Calculadora ML — ajustes (prefill, preço⇄margem, kit, tabela de frete)

- **Data:** 2026-11-10
- **Tela:** `/viabilidade` → aba "Calculadora ML" (ADR-0126)
- **Código atual:** `src/hooks/useCalculadoraML.ts`, `src/lib/calculadora-ml.ts`,
  `src/components/calculadora-ml/*`, `src/components/tabela-frete-viabilidade.tsx`

## Intenção

Diego usa a calculadora para decidir preço e compra. Hoje, ao escolher um produto já publicado,
ele precisa redigitar categoria, imposto, margem e preço — e o preço que aparece é o do cadastro,
não o praticado no ML. Também quer responder perguntas como: "se eu mantiver 38% de margem,
por quanto vendo o kit de 2 ou de 3 águas micelares?", e ver a tabela de frete do ML na mesma tela.

Sucesso = escolher o produto publicado e ver o cenário real sem digitar nada; mexer em margem
ou preço e ver o outro se ajustar; comparar kits de N unidades com frete recalculado.

## Escopo (5 frentes)

### 1. Produto cadastrado → preenchimento completo

Ao selecionar um produto cadastrado, preencher:

| Campo | Fonte |
|---|---|
| Custo | `variacoes.custo` (já funciona) |
| Medidas/peso | variação (já funciona) |
| Categoria ML | `familias.categoria_ml_id` — preenche o campo de categoria e o código (MLB…) sem consulta manual |
| Comissão | vem da cotação oficial (`calcular-tarifa-ml`) assim que categoria + preço existirem |
| Imposto (%) | `familias.origem` + alíquotas da org (`useAliquotas`: nacional/importado). Origem ausente/inválida → **não preencher** e mostrar aviso; nunca presumir (ADR-0107, regra financeira) |
| Preço de venda | **produto publicado:** preço vivo do anúncio no ML. **não publicado:** `variacoes.preco` (comportamento atual) |
| Modalidade | **publicado:** `listing_type_id` do anúncio (`gold_special`=Clássico, `gold_pro`=Premium). **avulso/não publicado:** seletor na tela |
| Margem-alvo | consequência do preço (ver frente 3): nasce como a margem real no preço praticado |

- Variação usada: mesma regra de hoje (`escolherVariacao` — `skuUnico`, senão menor código com dados).
- **Preço vivo** *(decisão do agente)*: o preço que o comprador paga agora (sale_price, inclui
  promoção), pois é sobre ele que comissão e margem incidem. Se houver promoção, exibir o preço
  "de" como informação. Fonte existente: `status-publicados` (lê `/items` + `/sale_price`). O
  construtor decide se reaproveita essa função ou cria leitura pontual por `ml_item_id` (ela
  varre todos os anúncios, ~4 s) — **somente leitura**, nenhuma escrita no ML.
- `listing_type_id` não está gravado localmente para famílias; vem da mesma leitura do anúncio.
- Falha na leitura do ML: cair para `variacoes.preco` com aviso visível "preço do cadastro — não
  foi possível ler o preço no ar" e modalidade manual.
- Tudo continua editável.

### 2. Campos numéricos sem setinhas, valor selecionado ao clicar

Vale para **todos** os campos numéricos da calculadora (`CampoNumero` em
`formulario-calculadora-ml.tsx`) *(decisão do agente: o pedido citou o campo de imposto)*:

- sem os botões de incrementar/decrementar (trocar `type="number"` por texto com
  `inputMode="decimal"`, ou esconder os spinners via CSS — construtor escolhe);
- ao focar (clique ou Tab), seleciona o valor inteiro para ser sobrescrito;
- aceitar vírgula decimal (pt-BR). Rolagem do mouse não pode alterar valor.

### 3. Preço ⇄ margem ligados

A **modalidade ativa** (frente 1) é a que manda na ligação. Os cards Clássico e Premium
continuam ambos visíveis.

- Usuário altera **preço** → margem recalcula (margem da modalidade ativa no novo preço).
- Usuário altera **margem** → preço recalcula para atingir essa margem na modalidade ativa.
  Como a comissão e o frete mudam por faixa de preço, o preço final precisa ser confirmado com
  a tarifa relida no preço resultante (mesma lógica de gross-up já usada no app; ADR-0050/0076;
  memória "comissão ML varia por preço"). Se não convergir, mostrar o melhor preço encontrado
  e a margem real dele, sem esconder a diferença.
- Alterar **custo, imposto, custos fixos/variáveis, rebate, medidas** → mantém o preço e
  recalcula a margem *(decisão do agente)*.
- O campo "Margem-alvo" passa a ser a margem viva. O botão "Validar preço projetado na API" e o
  texto "atinge a meta de X%" deixam de fazer sentido como estão; o construtor adapta a central
  de decisão para não exibir contradição (ex.: "Margem atual 38,55% atinge a meta 0%").
- Sem loop de atualização: só o campo editado pelo usuário dispara o recálculo do outro.

### 4. Multiplicador de kit

- Campo **Quantidade no kit (N)**, inteiro ≥ 1, padrão 1.
- Quadro comparativo com colunas **1 · 2 · 3 · N** (N omitido se for 1, 2 ou 3). Em cada coluna,
  mantendo a **margem atual** da modalidade ativa:
  - preço do kit;
  - preço por unidade (preço do kit ÷ quantidade);
  - frete;
  - comissão;
  - lucro do kit.
- Regras do kit de quantidade q:
  - custo do produto × q; peso × q;
  - **volume somado** (decisão do Diego). Caixa enviada à API: multiplicar só o **lado menor**
    por q *(decisão do agente: o ML cota frete pelas 3 medidas, e isso mantém o volume = soma)*.
    Ex.: 5×5×15 → kit de 3 = 15×5×15;
  - custos fixos/variáveis e rebate: **por kit, não multiplicados** *(decisão do agente; o
    construtor deixa isso explícito numa linha abaixo do quadro)*;
  - imposto: mesma alíquota sobre o preço do kit;
  - comissão e frete: cotação oficial no preço e nas medidas do kit, com a mesma confirmação de
    faixa da frente 3.
- Sem categoria ou sem medidas: o quadro mostra o que dá para calcular e marca frete como
  desconhecido, seguindo a regra de proveniência do ADR-0126 (nunca frete zero silencioso).
- Chamadas à API: com debounce, e só para as colunas visíveis.

### 5. Tabela de frete do ML no fim da tela

- Reaproveitar `TabelaFreteViabilidade` / `useTabelaFreteML` / edge `tabela-frete-ml` (já
  existentes, cache 24h, conta da org): faixas de peso × faixas de preço.
- Usa a categoria da calculadora. Sem categoria: mostrar o pedido para informar a categoria em
  vez da tabela.
- Bônus desejável *(decisão do agente, opcional)*: destacar a célula onde caem o produto e o kit N.

## Fora do escopo

- Salvar simulações (ADR-0126 mantém tudo em memória).
- Criar o anúncio do kit a partir da calculadora.
- Qualquer escrita no ML ou no cadastro.

## Restrições

- Sem migration prevista. Se o construtor concluir que precisa de uma, parar e revisar.
- Nenhuma escrita no ML; nenhum anúncio real alterado.
- Imposto nunca presumido: origem ausente → campo vazio + aviso.
- Custo do produto = `variacoes.custo`, nunca `familias.custo_centavos`.
- Selects novos (modalidade) usam `src/components/ui/select.tsx` ou um toggle de botões; nunca
  `<select>` nativo.
- Motor puro (`src/lib/calculadora-ml.ts`) continua independente da UI; preço⇄margem e kit
  testados ali com vitest.
- Edge alterada → deploy da função + conferência de versão (CLAUDE.md).

## Deixado ao construtor

- Se a leitura do preço vivo reaproveita `status-publicados` ou ganha leitura pontual.
- Implementação dos campos sem spinner (texto + máscara × CSS).
- Layout do quadro de kit e posição do seletor de modalidade.
- Algoritmo de convergência do preço por margem (iteração sobre a tarifa).
