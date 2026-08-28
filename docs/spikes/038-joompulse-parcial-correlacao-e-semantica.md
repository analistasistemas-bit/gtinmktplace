# Spike 038 — JoomPulse (PARCIAL): correlação, allowlist e semântica

**Data:** 2026-08-28
**ADR:** [0132 — Análise Avançada com JoomPulse](../decisions/0132-analise-avancada-joompulse.md)
**Escopo:** questões abertas #1 (correlação), #2 (allowlist MCP) e #3 (semântica das estimativas).
**Status:** **PARCIAL.** Fecha 3 das 15 questões. **Não** cobre OAuth multi-conta, refresh,
revogação, quotas, latência, cold start nem isolamento entre organizações — nada disso é
testável a partir desta superfície.

## Como foi feito

O MCP da JoomPulse está conectado ao Claude Code (superfície `claude.ai`), com 5 ferramentas:
`list_resources`, `read_resource`, `query_cubejs_meli`, `query_cubejs_shopee` e
`find_sourcing_candidates_on_joompro`. O spike leu os recursos `pulse://tables`,
`pulse://tables/MercadoProductsWeekly` e `pulse://rules`, e rodou 4 consultas reais.

**Esta conexão não viola a D-2.** A D-2 proíbe o *PubliAI* chamar `https://joompulse.com/mcp`;
aqui o cliente é a ferramenta de desenvolvimento, não o runtime do produto.

**Esta conexão também não prova nada sobre OAuth por organização.** É uma credencial única de
sessão. O fluxo multi-conta continua não verificado.

---

## Q#1 — Correlação: FECHADA (Radar e Viabilidade)

### Não existe GTIN na JoomPulse

Os cubos MercadoLivre **não têm nenhuma dimensão de GTIN/EAN**. A premissa "demanda por GTIN"
que a D-10 já desconfiava está morta: não é ambígua, é inexistente.

### As duas chaves reais

O cubo `MlbProductsWithFilters` (4 cubos irmãos, mesmo schema) indexa por:

| Dimensão JoomPulse | Formato | Equivalente no PubliAI |
|---|---|---|
| `id` | `MLB` + dígitos, sem hífen | `ml_item_id` (86 ocorrências nas migrations) |
| `productId` | catálogo: `MLB` + dígitos; **não-catálogo: stub `MLB-` + dígitos** | `catalog_product_id` (15 ocorrências) |
| `shopId` | id do vendedor | `seller_id` da concorrência |

**Nenhuma transformação é necessária e nenhum mecanismo novo precisa ser criado.** As duas
chaves já estão persistidas:

- `pulse_produtos` tem índice único `(org_id, catalog_product_id)`
  (`20260816125057_pulse_v1.sql:20`);
- `variacoes` e `anuncios_externos_itens` carregam `catalog_product_id`
  (`20260722175451_adr88_catalogo_up.sql`);
- a Viabilidade **já** recebe o `product_id` resolvido: `analisar-item-viabilidade.ts:65` chama
  `resolverMercado(conc.product_id, …)`, protegido por `if (!conc.product_id) return base;`
  na linha 59 — ou seja, o "falha explícita quando não há correlação" que a D-10 exige **já é o
  comportamento atual**, não precisa ser construído.

O tipo é `product_id?: string | null` (`concorrencia/tipos.ts:9`). Item sem catálogo resolvido
simplesmente não tem chave — e cai no mesmo caminho de "sem dado".

### Roteamento de cubo (afeta custo, não semântica)

Os 4 cubos têm schema idêntico; muda a chave de cluster:

- filtro por listagem → `MlbProductsSortedByItemId`
- filtro por catálogo → `MlbProductsSortedByProductId`
- filtro por vendedor → `MlbProductsSortedByShopId`
- corte por categoria/tempo/flags → `MercadoProductsWeekly` (único com pré-agregação)

Duas diferenças de SQL entre eles: `brand` é truncado em 25 chars no `MercadoProductsWeekly`, e
`reviewsRating` agrega como `avg` nele e `max` nos três Sorted.

---

## Q#2 — Allowlist: FECHADA, mas o contrato não é o que a ADR imaginou

### O que entra na allowlist do v1

Só **uma** ferramenta: `query_cubejs_meli`. As outras quatro não servem ao v1
(`query_cubejs_shopee` só quando o E5 existir; `find_sourcing_candidates_on_joompro` é sourcing
de importação, fora de escopo; `list_resources`/`read_resource` são documentação, consumo de
desenvolvimento).

### O achado estrutural

A ferramenta **não expõe operações de domínio**. Ela recebe `query`: uma string JSON no formato
CubeJS `/load`. Não há endpoint "vendas do anúncio X".

Consequência direta para a D-9: a allowlist do Gateway **não é uma lista de ferramentas**, é a
lista de *cubos, dimensões, measures e filtros* que o Gateway se permite montar. O Gateway
**constrói** o JSON CubeJS a partir de parâmetros tipados; nunca aceita fragmento de query vindo
do browser. Isso reforça a D-9 em vez de contradizê-la, mas muda o que precisa ser escrito.

### Dois vetores de erro documentados na própria fonte

1. **`segments` é descartado em silêncio.** Uma query que usa a chave volta com as linhas
   **sem filtro** e **sem erro**. Qualquer repasse de chave desconhecida do cliente é vetor de
   resposta errada — e, num contexto multi-org, de vazamento.
2. **`order` descendente em measure põe NULL primeiro.** "Top N por GMV" volta vazio se não
   houver um `filters` com `gt 0` junto.

---

## Q#3 — Semântica: FECHADA, e ela derruba a promessa da D-3

### As measures

| Campo | Unidade | Natureza |
|---|---|---|
| `orderCount1d` / `1w` / `1m` | unidades | **Estimativa** JoomPulse por listagem, agregador `sum` |
| `orderGmv1d` / `1w` / `1m` | BRL | **Estimativa** — literalmente `orderCount × priceAmount` |
| `catalogOrderCount1m` / `catalogOrderGmv1m` | un. / BRL | **Estimativa** no nível do catálogo, agregador `max` |
| `priceAmount` | BRL | **Real**, preço atual do buy-box |
| `sold` / `soldItem` / `catalogSales` | unidades | Faixa do selo "vendidos" do ML — **vitalício, não é taxa** |
| `conversionRate` | — | **Placeholder não populado** (JPA-3310). Não usar. |

A documentação da JoomPulse exige, em letras próprias: *"Must be disclosed in every answer"*.
Isso cobre o requisito de "indicação explícita de estimativa" da ADR.

### `orderCountMin/Max` NÃO são banda de confiança

São agregadores `min`/`max` **sobre o slice da query**. Numa consulta de uma listagem só,
`orderCount1m = orderCountMin1m = orderCountMax1m` (verificado: 1250/1250/1250). Não há intervalo
de incerteza disponível — a divulgação de estimativa é **rótulo, não faixa**.

### Janela e `coletado_em`

- Grão: uma linha por listagem por `date`. `date` retornado: `2026-08-27`, com
  `lastRefreshTime` `2026-08-28T18:18Z` → **D-1**.
- Coleta diária ~03:25 UTC, lag documentado de ~24h (caveat #5).
- As janelas `1d`/`1w`/`1m` são **móveis**, ancoradas na data do snapshot — não são mês
  calendário. O rótulo da UI precisa dizer isso (a ADR já previa esse caso).

### O achado que muda o desenho: `orderCount1m` só existe para o ganhador do buy-box

Consulta real, 3 catálogos, 15 listagens (`MlbProductsSortedByProductId`):

| productId | listagem | buyBoxWiner | orderCount1m | catalogOrderCount1m | numBuyBoxSellers |
|---|---|---|---|---|---|
| MLB18407878 | MLB4677897999 (AMAMOSDERMO) | **true** | **820** | 820 | 15 |
| MLB18407878 | outras 4 listagens | false | **0** | 820 | 15 |
| MLB25749603 | MLB5580784982 (WEBSTORCAMPINAS) | **true** | **27** | 27 | 18 |
| MLB25749603 | outras 8 listagens | false | **0** | 27 | 18 |
| MLB25284234 | MLB4772345439 (AVILBV) | false | 0 | **0** | 2 |

A regra `SN-10` da JoomPulse confirma que isso é estrutural, não amostra:
*"exactly one listing wins it, `orderCount1m` concentrates on that listing (the rest are ~0)"*.

**Num catálogo com 15–18 concorrentes, 14 a 17 deles devolvem `0`** — e esse `0` não significa
"não vendeu". Significa "as vendas estimadas do catálogo não foram atribuídas a esta listagem".

Renderizar esse `0` como "0 vendas/mês do rival" seria exatamente o dado inventado que a D-3
proíbe, só que com o sinal invertido: a ADR se preocupou em não transformar ausência em zero, e
o que a fonte entrega é um zero que precisa ser tratado como ausência.

### Tabela-verdade obrigatória

Substitui o estado único "Sem dado para este item" da ADR por quatro:

| Linha existe? | `buyBoxWiner` | `catalogOrderCount1m` | Significado | UI |
|---|---|---|---|---|
| não | — | — | listagem não rastreada pela JoomPulse | travessão + "sem dado" |
| sim | true | > 0 | estimativa real do ganhador | número + fonte + janela |
| sim | false | > 0 | catálogo tem demanda, **não atribuída a esta listagem** | **nunca renderizar 0** — mostrar a demanda do catálogo |
| sim | qualquer | 0 | o catálogo em si não tem venda estimada | "sem venda estimada no período" |

### Campos que são do catálogo, não da listagem

`reviewsCount`, `reviewsRating`, `numImages` e `daysInAd` retornam **o mesmo valor para todas as
listagens de um `productId`**. Nunca apresentá-los como diferença entre rivais — a comparação
seria falsa por construção.

---

## Cobertura: NÃO medida

4 ids `MLB` extraídos de docs (provavelmente desatualizados) foram consultados em
`MlbProductsSortedByItemId` sem filtro de status: **1 retornou linha, 3 não**.

**Isto não é uma medição de cobertura e não deve ser citado como taxa.** O cubo contém 288.809.387
listagens `active`, 33.332 `paused` e 13.675 `closed` — ou seja, uma listagem pausada *teria*
voltado. Os 3 ids simplesmente não estão no snapshot; a causa não foi investigada.

**Sonda pendente:** medir a taxa real de acerto contra os `ml_item_id` atuais de `anuncios` e os
`catalog_product_id` de `pulse_produtos`, em produção. Sem esse número não dá para dimensionar
quantas telas cairiam em "sem dado".

---

## Achado fora do escopo: Shopee já existe

`query_cubejs_shopee` cobre a Shopee Brasil (cubos `Shb*`) com item, categoria, loja, série
semanal de vendas e histórico de preço/review. A ADR-0132 só fala de MercadoLivre. Limitações
relevantes: histórico só a partir de **2026-05-01**, sem conceito de catálogo/buy-box, e a maior
parte das estatísticas exposta como *dimensão* (não agrega sozinha).

Isso não muda o v1, mas é insumo para o E5 (Shopee) e deve ser considerado quando o conector
existir.

---

## Questões que continuam abertas

Fechadas: **#1, #2, #3**.

Continuam bloqueando (não testáveis daqui): **#4** (contrato HTTP), **#5** (storage de
credencial), **#6** (cifragem/rotação), **#7** (refresh rotation e revogação), **#8**
(o que "Desconectar" faz), **#9**/**#10** (cache e invariância entre contas), **#11** (rate
limits e latência), **#12** (cold start), **#13**/**#14** (ciclo de vida e expurgo), **#15**
(alertas).

### Questão nova (#16)

A superfície entregue é um **assistente analítico voltado a agente**, não uma API de dados: ela
traz scripts de recusa, regras de divulgação obrigatória e roteia explicitamente a análise de
concorrentes para a **UI Concorrentes da JoomPulse**. A D-18 registrou que a parceria formal
remove o bloqueio de termos de uso — mas foi escrita antes de alguém ver esta superfície.

**Pergunta para a JoomPulse:** a parceria cobre uso server-to-server desta superfície por um
Gateway do PubliAI, ou existe/está prevista uma API de dados própria para esse fim? Isso não é
decidível a partir daqui.

## Decisão que volta para o Diego

A D-3 promete "Radar enriquecido com vendas e receita estimadas **do rival**". A fonte não
entrega isso: entrega a estimativa **do ganhador do buy-box** mais a demanda **do catálogo**.

O v1 honesto é: *demanda do catálogo + quem detém o buy-box + a estimativa do ganhador*. É uma
feature diferente da que a ADR descreve. Conforme a D-17, a escolha volta para decisão antes de
qualquer código — não é ajuste de implementação.
