# ADR-0065 — Re-âncora do preço no piso dos MercadoLíderes quando há prejuízo

**Status:** Aceito
**Data:** 2026-07-08
**Decisores:** Diego
**Relacionado:** [ADR-0020 (preço líquido mínimo + semáforo)](0020-estrategia-de-preco-liquido-minimo.md); [ADR-0050 (frete no gross-up)](0050-frete-no-gross-up-preco-proprio.md); [ADR-0059 (desconto concorrência configurável)](0059-desconto-concorrencia-configuravel.md); [ADR-0015 (potencial de venda)](0015-potencial-de-venda-via-proxies.md); [ADR-0064 (concorrência agregada)](0064-concorrencia-agregada-por-variacao.md)

---

## Contexto

Pelo ADR-0020, com concorrência o preço é **mercado puro**: `menor_concorrente × (1 − desconto%)`,
estratégia `competitivo`. Ele deliberadamente vai a prejuízo quando o mercado está baixo, e o
semáforo sinaliza 🔴 para o operador decidir na Revisão.

O problema (relatado pelo Diego): em vários produtos o **menor preço** da concorrência é de
vendedores que **vendem muito barato provavelmente sem emitir nota / sem pagar imposto**. Ancorar
no menor preço faz o produto aparecer em "Prejuízo" e distorce o preço sugerido, mesmo havendo
vendedores estabelecidos (MercadoLíderes) praticando um preço maior e viável.

Uma tentativa anterior de resolver "prejuízo no competitivo" — um **piso viável** no ramo
competitivo — foi **revertida** (commit `e6dee14`, 2026-07-06) porque forçava o preço **acima de
todo o mercado** (ex.: R$34,40 vs concorrente R$19,47) com selo "vale a pena" mentiroso. Qualquer
solução nova NÃO pode repetir isso.

## Decisão

Adicionar uma **re-âncora condicional** ao ramo competitivo do `sugerirPrecoVenda`, **gated por
toggle** (`configuracoes.reancora_lider_ativa`, por org, default false):

- **Quando:** no CREATE, quando o preço competitivo (`menor_preço × (1 − desconto%)`) deixa o
  **líquido Clássico < custo** (prejuízo real, 🔴).
- **O que faz:** troca a base do preço de `menor_preço` para o **piso-líder** = menor preço entre
  os concorrentes **MercadoLíder** (`power_seller_status ≠ null`), e aplica o mesmo
  `desconto_concorrencia_pct`. `preço = piso-líder × (1 − desconto%)`.
- **Decisão família-level:** avaliada uma vez pelo **pior caso** (maior custo da família, como o
  semáforo do ADR-0020) e aplicada igual a todas as cores — o preço competitivo já é o mesmo para
  todas as variações; não pode divergir.
- **Sinal:** flag `familias.preco_reancorado_lider = true` + motivo em `estrategia_motivo`
  ("menor preço dava prejuízo; ancorado no piso dos MercadoLíderes (R$X)") + selo distinto na
  Revisão ("COMPETITIVO · âncora líder"). A estratégia continua `'competitivo'` (a flag
  diferencia; sem novo valor de enum).

**Bordas (o que preserva o ADR-0020 e NÃO repete o `e6dee14`):**
- Sem nenhum MercadoLíder → mantém o comportamento atual (menor_preço − desconto%, 🔴).
- Piso-líder − desconto% **ainda** < custo → usa a âncora mesmo assim, **🔴 honesto**. Nunca faz
  gross-up no ramo competitivo, nunca sobe o preço acima do piso-líder.
- Como piso-líder ≥ menor_preço, a re-âncora **sempre sobe ou mantém** o preço (nunca abaixa). Se
  um MercadoLíder já vende no menor preço, `piso-líder == menor_preço` e não há re-âncora (`>`
  estrito).
- Só CREATE; respeita `preco_editado_pelo_operador`.

## Implementação

- **Captura:** `DadosOfertas.ofertas_detalhe` (`{seller_id, preco}` por oferta) — antes o par
  era descartado (`parseItensProduto` guardava preços e vendedores em listas separadas). Agregado
  entre as cores em `agregarConcorrencia` (com guard `?? []` para cache legado de 6h sem o campo).
- **Piso-líder:** `_shared/preco/piso-lider.ts` — `pisoLiderDeOfertas` (pura) + `calcularPisoLider`
  (reusa `reputacaoVendedor`, cache Redis 24h).
- **Líquido no backend:** `_shared/preco/liquido.ts::liquidoClassico` — espelha o "Você recebe"
  Clássico, para detectar 🔴. Isso **reintroduz a busca de comissão/frete no caminho competitivo**
  (que o `e6dee14` havia removido) — mas **só para DETECTAR prejuízo e re-ancorar**, nunca para
  forçar preço, e **gated pelo toggle** (custo de API só quando ligado).
- **Estratégia:** 7º parâmetro `reancora` em `sugerirPrecoVenda`; retorno ganha `reancorado`.
- **Wiring:** `process-familia` (bloco gated, resiliente: falha → sem re-âncora). Migration
  `20260708144126` (toggle + flag). Toggle em Configurações; selo no `PainelAnalise`.

## Consequências

**Boas:**
- Produtos com undercut sem-nota deixam de aparecer em "Prejuízo" quando há um piso legítimo viável;
  o preço sugerido mira o segmento estabelecido (−desconto% do piso-líder).
- Não repete o `e6dee14`: o preço só escolhe entre dois preços **reais** de mercado (menor_preço ou
  piso-líder), nunca sintetizado por custo+margem, nunca acima do piso-líder; 🔴 continua 🔴.
- Reversível por toggle (desligar não precisa de deploy).

**Tradeoffs aceitos:**
- Com o toggle ON, comissão + frete são buscados para **toda** família competitiva (para computar o
  líquido e saber se é 🔴), não só as 🔴 — reputações reusam cache Redis 24h.
- O "menor preço" da âncora considera só cores com produto de catálogo no ML (mesma amostragem do
  ADR-0064).
- Contagem de vendedores segue aproximada quando o ML não retorna `seller_id` (raro; não afeta preço).

## Como reverter

1. Desligar o toggle `reancora_lider_ativa` (efeito imediato, sem deploy).
2. Para remover o código: em `sugerirPrecoVenda`, ignorar o 7º parâmetro; remover o bloco gated do
   `process-familia`, `_shared/preco/{piso-lider,liquido}.ts`, e a captura de `ofertas_detalhe` se
   não usada por mais nada. Colunas são aditivas (podem ficar).
