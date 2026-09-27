# Vendas SKU — design

**Data:** 2026-09-26 · **Origem:** grilling com Diego (8 perguntas) + benchmark do Mercado Turbo
*Vendas por SKU* · **ADR:** [0172](../../decisions/0172-vendas-sku-analise-por-variacao.md) ·
**Termos:** `docs/reference/glossario.md` → seção "Vendas SKU".

## Objetivo

Uma aba nova em Faturamento, **Vendas SKU**, que diz quais variações sustentam o resultado e conta a
**história** de cada uma desde a primeira venda registrada no PubliAI. Não é cópia do benchmark: ele é um
ranking de faturamento bruto do período. Aqui a análise é por **lucro**, ao longo do tempo, com eventos e
sinais de risco.

## Benchmark (Mercado Turbo, visitado 2026-09-26, só leitura)

| Tem lá | Fica? |
|---|---|
| KPIs: valor, qtde, ticket, SKUs com venda, concentração top 5 | fica, com Δ% contra o período anterior |
| Frase "X lidera com Y%" | vira 3 insights automáticos |
| Ranking com participação valor/qtde | fica, ordenado por lucro |
| Top 10 em barras (valor + ticket) | sai: o ranking ordenável (lucro, unidades, lucro/unidade) responde |
| Volume × Faturamento (5 cards) | sai, pelo mesmo motivo |
| Vendas por UF do SKU (modal) | vai para o dossiê |
| Faixas de ticket | sai (nunca definida) |
| Curva ABC em outra página e outro período | embutida, no mesmo período, por lucro ou faturamento |

O que falta lá e é o diferencial daqui: lucro/Markup/Margem s/ venda, comparação de períodos, canceladas e
devolvidas separadas, eixo de tempo, eventos, estoque/cobertura, visitas/conversão, busca e filtros, e
atalhos de período (lá é texto dd/mm/aaaa).

## Fatia 1 — aba `/faturamento?aba=sku`

**Fonte:** os itens de `agruparPorPedido` (a mesma da aba Vendas), agrupados por `codigo` no navegador
(ADR-0172 D-5). Sem RPC e sem fórmula nova. Enriquecimento pela família mais recente do `(org, codigo)`.

- **Filtros:** período com atalhos (7/30/90 dias, mês, custom) + comparar com o período anterior; busca
  por código/título; família, fornecedor, origem (nacional/importado); filtro **sem custo**; alternador
  **agrupar por família**.
- **Faixa "sem custo"** no topo quando houver: "N SKUs sem custo · R$ X de faturamento sem lucro calculado".
  Todo produto tem que ter custo.
- **KPIs:** faturamento, lucro, Markup, Margem s/ venda, unidades, SKUs com venda (e quantos venderam 1
  vez), concentração top 5, **% do faturamento com custo real** e **prejuízo total** (quanto os SKUs
  negativos tiraram). Δ contra o período anterior: % nos valores, **pontos percentuais** em Markup e Margem,
  e R$ quando a base anterior é zero ou negativa.
- **Quem explica a variação do lucro:** os SKUs que mais somaram ou tiraram em R$, incluindo "entrou no
  período" e "deixou de vender".
- **Insights:** de 0 a 3, só com evidência (ex.: "3 SKUs fazem 50% do lucro", "4 SKUs com cobertura
  < 15 dias").
- **Ranking:** código + título + miniatura, unidades, faturamento, lucro, **lucro por unidade**, Markup,
  Margem s/ venda, ticket, canceladas, taxa de devolução, **tendência** e **alertas** (glossário). Ordena
  por lucro por padrão. Selos: "custo estimado", "lucro parcial", "sem custo". Linha extra: "devolução não
  atribuída" e "sem código".
- **Abrir a conta da linha:** bruto → comissão + frete → imposto → custo → lucro, com a quantidade de
  pedidos. Comissão e frete aparecem juntos porque o item só carrega o líquido rateado. O link para os
  pedidos fica no dossiê (2a).
- **Curva ABC** (lucro | faturamento). Por lucro, só sobre o lucro positivo; SKUs com prejuízo ficam na
  faixa "D — prejuízo".
- **Cobertura:** kit vinculado mostra "estoque compartilhado com a base", sem dias.
- **Invariante:** a soma dos SKUs no período = total da aba Vendas no mesmo filtro (por construção; teste
  de guarda).

## Fatia 2a — Dossiê `/faturamento/sku/:codigo` (dados existentes)

> Revisada pelo GPT-6 Astra em 2026-09-27 ("sim com ajustes"). As decisões abaixo incorporam a revisão.

**Contrato: histórico observado, com cobertura explícita.** O dossiê mostra o que os registros do PubliAI
comprovam, desde a primeira venda registrada. Não promete "história completa": publicação, promoção e
estoque têm cobertura parcial, e a tela diz isso.

**Carga (sem fórmula nova):** uma RPC de **seleção** (`security definer`, `current_org_id()`, sem dinheiro)
devolve os ids das vendas que contêm o código **mais os demais membros dos mesmos packs/envios**. O
navegador busca essas vendas com o mesmo `select` de `buscarVendas`, roda os mesmos resolvers e
`agruparPorPedido`, e **só depois** separa os itens do SKU. Assim o rateio de frete e os centavos são
os da aba Vendas. Paginação por GET com desempate por id; colunas explícitas, nunca `raw` inteiro.
Critério de aceite: medir linhas, bytes e tempo do SKU de maior volume da Avil, incluindo a expansão dos
packs.

**Referência temporal:** gráfico e KPIs seguem o período escolhido; tendência e cobertura são a posição
**de hoje** ("posição em dd/mm"). Calendário em BRT: semana começa na segunda, mês civil, intervalos
sem sobreposição; a semana/mês corrente é marcada como incompleta.

**Cabeçalho:** foto, título, família, 1ª e última venda, idade comercial, tendência, alertas, e o bloco
**Qualidade do histórico**: desde quando há vendas, % do faturamento com custo real, e quais fontes têm
cobertura parcial.

**Linha do tempo** (semanal/mensal): unidades, faturamento, lucro e **preço vendido** = média ponderada
por quantidade, com faixa mín./máx.; semana sem venda fica sem preço. Na família, avisa que o preço
médio também muda pelo mix. Clicar num ponto abre os pedidos daquele intervalo, com o SKU destacado.

**Eventos**, cada um com o vínculo declarado: **SKU exato**, **anúncio compartilhado** (evento do MLB que
atende várias variações) ou **não resolvido**.
- Anúncios identificados nos registros (vínculo atual, vendas antigas e snapshot PxV). Não existe
  histórico geral de republicação; primeira venda de um MLB não vira "data de publicação".
- Entrada registrada com custo X (`estoque_movimentos`); ruptura = saldo anterior > 0 → resultante 0;
  retorno = anterior 0 → resultante > 0. Movimento sem saldo é ignorado.
- Moderação **detectada** / **resolução observada** (`ml_moderacao`, por MLB → anúncio compartilhado
  quando o MLB tem várias variações).
- Devolução (só `type='returns'`, a mesma definição da Fatia 1): evento em `aberto_em`, estorno em
  `fechado_em`. Motivo = texto traduzido, código cru ou "não informado".
- Perguntas: faixa semanal de contagem, por MLB (anúncio compartilhado).
- Promoção: **não entra na linha do tempo**. Vira o bloco **Situação atual nas campanhas** (status e
  última sincronização). Se houver faixa no gráfico, o texto é "vigência da campanha; participação
  histórica desconhecida".

**Estoque:** saldo canônico e cobertura (posição de hoje). **Kit vinculado:** saldo = `floor(base/N)`,
cobertura "estoque compartilhado" sem dias, ruptura quando `floor(base/N)` chega a 0; entradas pertencem
à base.

**Devoluções:** taxa por coorte (pedidos, só `returns`), motivos. **UFs:** agregadas pelos **itens
faturáveis do SKU** com a UF da respectiva order (nunca o bruto do pack inteiro), com "sem localização".

**Família** (`/faturamento/sku/familia/:codigo_pai`): composição **atual** pelo catálogo, incluindo
irmãs **sem vendas**; soma valores e unidades e recalcula percentuais (nunca soma taxas nem coberturas);
eventos compartilhados deduplicados pelo id original; pedidos contados por order. **Mix das irmãs**:
participação em unidades e contribuição para o lucro, contra o período anterior.

**Kit Virtual:** vendas com `kit_item_id` aparecem separadas ("vendido dentro de kit"), com aviso de
cobertura parcial (sem backfill de `kit_item_id`).

**Estados:** cadastrado sem vendas (idade e tendência indisponíveis), histórico sem cadastro atual
(vendas aparecem, família/estoque não), código não encontrado (404 do app), estoque desconhecido ≠ zero.
A linha "sem código" do ranking não abre dossiê.

**Segurança:** rotas sob os guards existentes; a RPC nova deriva a org no servidor, fixa
`search_path`, revoga `public`/`anon`, e tem teste com o mesmo código/MLB em duas orgs e chamada anônima.

**Fora da 2a:** histórico completo de publicação/republicação, adesão/saída histórica de promoção e efeito
atribuído à campanha, dias exatos sem estoque/demanda perdida, marcador por mudança de preço ou por
pergunta, lucro líquido de devoluções como métrica nova.

## Fatia 2b — coleta diária (visitas, conversão, preço)

- Worker diário (QStash, `verify_jwt=false`, idempotente por `(org, item, dia)`), só leitura no ML.
- Visitas: `items/{id}/visits/time_window`, carga inicial de até 150 dias (cobre desde jun/2026). O ML
  consolida em até 48h, então o dia corrente fica pendente.
- Preço diário: multiget do próprio anúncio, 20 por chamada.
- No dossiê: visitas/dia, **conversão** (unidades ÷ visitas) e preço diário sobre a linha do tempo.

## Fatia 2c — Ads e posição (após spikes)

- **Spike Ads (1 dia):** o app tem permissão de Product Ads? Avil/DSA anunciam? Métrica diária por
  anúncio (cliques, impressões, CPC, ROAS, orgânico × pago). Se sim, entra no dossiê e o lucro ganha
  "lucro após Ads".
- **Spike posição:** custo mensal medido (Apify × SKUs × frequência) + de onde vem a palavra-chave de cada
  SKU. Diego aprova o custo antes de ligar.

## Fatia 3 — depois

Recompra (compradores que voltam ao SKU), exportação, ações diretas (abrir família, ver promoção).

## Fora

Pausa/reativação na linha do tempo, enquanto não houver registro. Tela de configuração dos limites.
Backfill de pedidos anteriores à entrada no PubliAI.

## Pré-requisitos corrigidos antes da Fatia 1 (2026-09-26)

- **Centavos:** o rateio do líquido entre itens (`agruparPorPedido`) agora joga o resíduo no item faturável
  de maior valor. A soma dos itens = líquido do pedido.
- **Unidades:** `Pedido.unidadesFaturaveis` alimenta o KPI "Unidades" da aba Vendas e a Geografia. Pack
  com order cancelada não conta o item cancelado, igual ao Financeiro.
- **Não alterado, de propósito:** o markup por pedido/pack continua entrando com o líquido inteiro quando
  qualquer item tem custo (`sales-summary.ts`, comentário "assim markup/lucro batem entre todas as telas").
  Medido: 1 pack em 3.778. A Vendas SKU calcula por item e não herda isso.

## Riscos

- Dossiê de SKU com pouco volume vira ruído: a tendência exige ≥ 5 unidades na janela.
- Kit vinculado: estoque vem da base (`floor(base/N)`); cobertura é "estoque compartilhado", sem dias.
- Janela de 48h das visitas: a conversão do dia corrente não é mostrada.
