# Spike 041 — Censo do Radar na JoomPulse e validação da D-4

**Data:** 2026-08-28
**ADR:** [0141](../decisions/0141-analise-publiai-joompulse-radar-e-sonar.md) — fecha o item "definir o lote da consulta do Radar" do [Spike 040](040-revisao-adversarial-adr-0141.md)
**Antecede:** [Spike 039](039-joompulse-cobertura-medida.md), que estimou por amostra de 90
**Método:** os **229 catálogos ativos** (`pulse_produtos.status='ativo'`, 2 organizações) consultados contra o MCP real da JoomPulse em 3 lotes

## Resposta curta

O censo confirma a amostra do Spike 039 e **valida a emenda da D-4 com dado real**: a
organização aparece como ganhadora do buy-box em **16 catálogos**, identificada por nome de loja.
Esse estado seria invisível no desenho anterior, que comparava por anúncio.

| Estado da célula | Censo (229) | Projeção do Spike 039 |
|---|---|---|
| Prévia útil (ganhador + demanda > 0) | **147 (64%)** | ~153 (67%) |
| Catálogo existe, sem venda estimada | **53 (23%)** | ~53 (23%) |
| Sem dado | **29 (13%)** | ~23 (10%) |

A amostragem do Spike 039 estava correta dentro de 3 pontos em cada faixa. Cobertura de catálogo
medida no censo: **87%** (200/229), contra 90% estimados.

---

## 1. A D-4 funciona — e o "Você leva" existe

**Em 16 dos 200 catálogos encontrados (8%), o `buyBoxShopName` é `AVILBV`** — a própria
organização. Distribuídos pelos três lotes (6 / 1 / 9), então não é artefato de ordenação.

Isso encerra a dúvida que o Spike 039 levantou: comparar por **vendedor** não é só o caminho
menos ruim diante dos 4% de anúncios próprios indexados — é um caminho que **produz o estado
"Você leva" de verdade**, em volume visível na tela.

Observação secundária, sem conclusão: as vitórias da organização concentram-se em catálogos de
demanda baixa (11 dos 16 com `catalogOrderCount1m` ≤ 1). Pode ser leitura real do mercado ou
efeito da mesma defasagem que o Spike 039 documentou. **Não usar isso como insight até medir
contra o dado interno de vendas**, que o PubliAI tem.

## 2. O lote: a "consulta única" da D-4 não cabe

O teto do CubeJS é de **100 linhas por resposta** — e a D-4 devolve uma linha por catálogo. Com
229 catálogos e o Radar sem paginação (`src/pages/Pulse.tsx:79`), **uma consulta é impossível**.

Medido: **3 lotes de 77 ids** passaram sem erro, devolvendo 68, 64 e 68 linhas — cada lote coube
numa página, sem precisar de `offset`. O filtro `equals` aceitou 77 valores (payload de 1,4 KB)
sem reclamar.

**Recomendação para a implementação:** lotes de 75 ids, um `Promise.all` de
`ceil(catálogos / 75)` consultas. Em 229 catálogos são 3 chamadas. O número dobra a cada ~150
catálogos novos, então o lote precisa ser derivado do total, nunca fixado em 1.

## 3. A correlação por `productId` é literal — e está segura

O cubo casa a string **exatamente**, sem normalizar. Verificado:

| Consultado | Resultado |
|---|---|
| `MLB-6249171016` | encontrado |
| `MLB6249171016` (mesmo id sem hífen) | **nada** |
| `MLB38519117` | encontrado |
| `MLB-38519117` (mesmo id com hífen) | **nada** |

Existem **dois formatos de `productId` convivendo** na JoomPulse: `MLB38519117` e
`MLB-6249171016`. Isso levantou a hipótese de que parte dos catálogos "não encontrados" fosse
apenas divergência de formato. **Hipótese descartada:** os 229 `catalog_product_id` do PubliAI são
todos `^MLB[0-9]+$`, **zero com hífen**. O formato hifenizado é outro namespace da JoomPulse e não
toca a correlação. Nenhuma normalização é necessária — e introduzir uma seria errado.

## 4. Um falso alarme, registrado para não voltar

Uma varredura sem filtro devolveu 100 catálogos com `buyBoxShopId` idêntico (`99999768`) e
`numBuyBoxSellers = 1`, o que parecia valor-sentinela para "sem ganhador". **Não é:** `99999768`
é a loja real `RCPMOTOPARTS`, única vendedora naqueles catálogos. A varredura sem filtro
simplesmente vem agrupada por vendedor. Não há sentinela a tratar.

## 5. Suspeita aberta: `catalogOrderCount1m` parece discretizado

Os valores retornados repetem-se num conjunto pequeno — `0, 1, 2, 3, 4, 13, 14, 19, 20, 137,
200, 231, 820, 1021, 1542, 1752, 1974` — e dois catálogos distintos devolveram exatamente `1021`,
outros dois exatamente `19`. Isso sugere **faixa/bucket**, não contagem exata.

Se for bucket, exibir "27 vendas/mês" seria precisão falsa, e a ADR-0141 já obriga rótulo de
estimativa. **Não confirmado** — precisa de uma consulta longitudinal ou da documentação da
JoomPulse antes de qualquer decisão de UI. Fica registrado como pergunta, não como achado.

---

## Impacto no desenho

1. **D-4 emendada de novo:** a consulta é **em lotes de 75**, não única. O texto atual promete algo
   que o teto de 100 linhas do CubeJS não permite.
2. **A emenda anterior da D-4 (ganhador por vendedor) está validada** com 16 ocorrências reais.
3. **A projeção do Spike 039 se sustenta** — o estado "catálogo sem venda estimada" é 23% no censo,
   exatamente o previsto, e continua exigindo tratamento visual próprio.
4. **Nenhuma normalização de `productId`.** O join literal está correto e cobre 87% dos catálogos.
5. **Antes de exibir demanda como número exato**, resolver a suspeita de discretização (§5).

## Como reproduzir

`sonda_formato.py` e `gera_lotes.py` em `$CLAUDE_JOB_DIR/tmp` (efêmeros): extraem os ids ativos via
Management API e montam os 3 lotes. Os gotchas do Spike 039 continuam valendo (`User-Agent:
curl/8.7.1` contra o bloqueio do Cloudflare). Novo: `pulse_produtos` **não tem coluna `ativo`** —
o filtro é `status = 'ativo'`. E `MlbProductsWithFilters` é nome de família, não cubo consultável:
o cubo é `MlbProductsSortedByProductId`.
