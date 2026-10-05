# Spike 055 — Base do ACOS de equilíbrio (venda atribuída do Mercado Ads × bruto do PubliAI)

**Data:** 2026-10-05 · **Org:** Avil · **Modo:** só leitura (SELECT via Management API, `read_only: true`), nenhuma chamada ao ML.
**Origem:** plano `docs/superpowers/plans/2026-10-04-painel-de-ads.md`, Task 7 Step 8 (achado #8 da revisão). ADR-0179.
**Pergunta:** o `direct_amount` que o Mercado Ads atribui a um grupo e o bruto faturável que o PubliAI soma (`Σ quantity × unit_price` de `ml_vendas_itens`) estão na mesma base monetária? Se sim, `custo ÷ vendas diretas` (ACOS direto) pode ser comparado à margem do PubliAI no semáforo.

## Escopo e definições

- **Janela:** 90 dias até ontem, 06/07/2026 a 04/10/2026 (dia BRT: `date_closed at time zone 'America/Sao_Paulo'`). A série de Ads na base vai de 29/06 a 03/10; na prática a comparação cobre 06/07 a 03/10.
- **Faturável:** o mesmo critério do app, `status in ('paid','partially_refunded','refunded')` (`STATUS_FATURAVEL` em `supabase/functions/_shared/platform-admin/sales-summary.ts`, usado por `ehFaturavel` em `src/lib/pedidos-faturamento.ts`). `cancelled` fica de fora.
- **MLB da venda:** `coalesce(ml_vendas.kit_item_id, ml_vendas_itens.ml_item_id)` (o kit conta no MLB do kit, como em `20261002225552_vitrine_kit_pedido.sql`).
- **Ads:** `ml_ads_grupo_dia` × `ml_ads_grupo` (`tipo = 'ITEM'`, `external_id` = MLB). Na Avil: 84 grupos ITEM, 32 FAMILY, 19 CATALOG; 12.161 linhas grupo-dia.
- **Preço atribuído:** `direct_amount / direct_units`. **Preço PubliAI:** `bruto_faturável / unidades_faturáveis` do mesmo MLB no mesmo dia.
- Universo dos critérios 1, 2 e 4: 457 linhas grupo ITEM × dia com `cost > 0` ou `direct_units > 0` (76 grupos); 153 dias com `direct_units > 0`; ITEM somou R$ 61.070,66 de `direct_amount` e 1.096 `direct_units` no período.

## Resultados por critério

### 1. Equivalência do preço unitário — DENTRO

| Recorte | Dias com venda dos dois lados | MLBs | Diferença ≤ 2 % |
|---|---|---|---|
| Estrito: MLB com **um único código** vendido na janela | 46 | 15 | **46 (100 %)** |
| Ampliado: qualquer MLB ITEM com **um único preço no dia** (variações com preço igual) | 113 | 22 | **113 (100 %)** |
| Todos os dias de grupos ITEM, sem filtro | 147 | 23 | 143 (97,3 %) |

Os 4 dias fora dos 2 % no recorte sem filtro são todos dias com **dois preços no mesmo dia** (troca de preço no meio do dia: `pmin ≠ pmax`), por exemplo MLB4752971229 em 07/07 (Ads R$ 19,35 contra média PubliAI R$ 20,87, com vendas a 19,35 e 23,90). O preço atribuído coincide com um dos preços praticados — é mix, não base diferente. Exemplo de casamento exato: MLB4831319319 em 01/10, `direct_amount` 500,80 / 8 = 62,60 = `unit_price` de todas as vendas do dia.

Leitura: o ML atribui pelo preço de venda unitário (o mesmo `unit_price` que o PubliAI soma) e na data da venda (o casamento é no mesmo dia BRT).

### 2. Descontos e promoções — DENTRO, com amostra fraca no recorte "promoção"

- **Por `ml_promocao_itens`** (item `started`/`pending` com a janela da `ml_promocoes` cobrindo o dia): estrito 0 dias com promoção (46 sem, 100 %); ampliado 5 dias com promoção em 1 MLB (100 %) e 108 sem (100 %). **Limitação:** `ml_promocao_itens` é foto atual, não histórico — só enxerga as campanhas vivas hoje (começadas a partir de 23/08). Promoções de julho/agosto já encerradas não aparecem; a amostra "com promoção" por esta via é pequena demais para concluir.
- **Por preço (desconto visível no `unit_price`):** dias em que o preço do dia ficou > 2 % abaixo do teto do próprio MLB na janela — 41 dias em 5 MLBs, **41 dentro (100 %)**; dias no teto: 72 dias em 20 MLBs, 72 dentro (100 %).

Leitura: quando o desconto está no `unit_price` (preço promocional/DEAL/SMART), os dois lados usam o preço com desconto. **Não medido:** cupom do vendedor (`SELLER_COUPON_CAMPAIGN`) não muda o `unit_price` do item na order; se o ML atribuir o valor pós-cupom, a diferença não aparece neste teste. Nenhum dia observado sugeriu isso, mas não há marcador de cupom por venda na base.

### 3. Kits — NÃO TESTÁVEL (amostra zero)

A Avil tem 0 `kits_virtuais`, 0 vendas com `kit_item_id` e nenhum grupo ou membro de Ads que seja kit. Em toda a base, só a DSA tem kits (2), sem vendas e sem Ads. O caminho do PubliAI (kit no MLB do kit via `kit_item_id`, `unit_price` de cada order de componente) **não foi confrontado com o Ads**. Sem dado, o semáforo não pode valer para kits.

### 4. Canceladas e devoluções — EFEITO PEQUENO, mas o ML continua contando

- Em **10 dias** (todos em julho) o `direct_units` do grupo foi maior que as unidades faturáveis do MLB no dia; em todos havia vendas canceladas do MLB no dia, e em nenhum dos 153 dias o `direct_units` passou do total de vendas (faturáveis + canceladas). Em 6 desses dias o MLB não teve **nenhuma** venda faturável — só canceladas — e o Ads atribuiu mesmo assim. Conclusão: **a venda atribuída do ML não sai quando a order é cancelada.**
- **Tamanho do efeito (piso):** o excesso visível soma 21 unidades / **R$ 901,62 = 1,48 %** do `direct_amount` ITEM do período.
- **Teto:** se todas as canceladas dos dias com venda Ads tiverem sido atribuídas, R$ 4.286,23 = **7,02 %** (37 dos 153 dias tiveram cancelada do MLB; R$ 4.107,95 de bruto cancelado nesses dias).
- A concentração em julho é compatível com o cancelamento chegar depois (as vendas recentes ainda podem ser canceladas) — o efeito nos últimos dias tende a aparecer depois.
- Efeito no ACOS direto: o denominador do ML fica inflado entre ~1,5 % e ~7 %, o ACOS do Ads sai um pouco **otimista** contra a base faturável do PubliAI.

### 5. Sanidade agregada — DENTRO

6 grupos de maior gasto em 30 dias (05/09 a 04/10), `direct_amount` contra o bruto faturável de todos os MLBs membros do grupo (`ml_ads_grupo_item` + `external_id` do ITEM) no mesmo período:

| Grupo (tipo) | Produto | Custo | Σ direct_amount | Bruto faturável | direct / bruto | direct_units / unidades |
|---|---|---|---|---|---|---|
| 2642163857 (FAMILY, 10 MLBs) | Tecido Helanca Light 10 m | 1.369,77 | 7.948,92 | 14.873,52 | 53 % | 106 / 198 |
| 2613331397 (FAMILY) | Lápis Grafite HB Pote 72 | 916,34 | 12.006,00 | 16.035,90 | 75 % | 303 / 404 |
| 2549351405 (ITEM) | Tecido Oxford Liso 10 m | 742,54 | 10.359,36 | 24.323,83 | 43 % | 159 / 373 |
| 2699858570 (FAMILY, 7 MLBs) | Tecido Oxford Estampas de Natal | 404,91 | 2.173,80 | 6.525,00 | 33 % | 32 / 95 |
| 2629478980 (FAMILY) | Franja Búfalo 5 mm | 209,60 | 1.399,32 | 1.952,47 | 72 % | 47 / 66 |
| 2612180125 (FAMILY) | Bordado Inglês Búfalo | 40,14 | 438,90 | 614,50 | 71 % | 11 / 15 |

Σ `direct_amount` ≤ bruto em 6/6. (O `total_amount` do grupo 2699858570, R$ 6.650,30, passa do bruto dos membros — esperado: inclui a venda indireta de outros anúncios.) Aproximação: agrupei por **grupo de Ads**, não por família do PubliAI; cada grupo do topo corresponde a uma família (o FAMILY agrupa os MLBs da família), mas famílias com mais de um grupo não foram somadas.

## Veredito

| # | Critério | Resultado |
|---|---|---|
| 1 | Preço unitário ≤ 2 % em ≥ 90 % dos dias | **Dentro** — 100 % (46 dias/15 MLBs estrito; 113/22 ampliado) |
| 2 | Idem separando promoção | **Dentro** pelo preço (41 dias com desconto, 100 %); pela tabela de promoções a amostra é pequena (5 dias) e a tabela é foto atual; cupom não medido |
| 3 | Kits | **Não testável** — zero kits com venda/Ads na Avil |
| 4 | Canceladas/devoluções | **ML continua contando** — piso 1,48 %, teto 7,02 % do `direct_amount`; viés otimista no ACOS do Ads |
| 5 | Σ direct_amount ≤ bruto (6 maiores) | **Dentro** — 6/6 (33 % a 75 %) |

**Escopo coberto:** Avil, grupos ITEM (critérios 1, 2, 4) e os 6 grupos de maior gasto (critério 5), 06/07 a 03/10/2026. Não coberto: kits, cupom do vendedor, grupos CATALOG/FAMILY no teste dia a dia (só no agregado), outras orgs.

**Decisão (conforme o plano):** nesta entrega o semáforo **segue desligado** (`BASE_ACOS_VALIDADA = false`). Os números indicam que a base monetária é a mesma (preço unitário na data da venda), com duas ressalvas para a decisão: (a) canceladas continuam na venda atribuída do ML (1,5 % a 7 %), (b) kits e cupom não foram provados. Ligar o semáforo é entrega separada, com decisão do Diego sobre estes números e validade por família/período encaminhada ao cálculo (por exemplo, excluir kits e famílias com cupom ativo).

## Queries

Executadas via `POST https://api.supabase.com/v1/projects/txvncrgkoynoxwopfkbp/database/query` com `read_only: true`. O processamento dos critérios (divisões, contagem ≤ 2 %, teto/piso de canceladas) foi feito em Python sobre o resultado da query 1.

### Query 1 — critérios 1, 2 e 4 (linha por grupo ITEM × dia)

```sql
with org as (select id from organizations where nome='Avil'),
j as (select date '2026-07-06' ini, date '2026-10-04' fim),
ads as (
  select g.external_id mlb, g.ad_group_id, d.dia, d.cost, d.direct_amount, d.direct_units, d.total_amount, d.units
  from ml_ads_grupo g join ml_ads_grupo_dia d on d.org_id=g.org_id and d.ad_group_id=g.ad_group_id
  cross join org cross join j
  where g.org_id=org.id and g.tipo='ITEM' and d.dia between j.ini and j.fim
),
vend as (
  select coalesce(s.kit_item_id, i.ml_item_id) mlb, (s.date_closed at time zone 'America/Sao_Paulo')::date dia,
    sum(i.quantity) filter (where s.status in ('paid','partially_refunded','refunded')) un_fat,
    sum(i.quantity*i.unit_price) filter (where s.status in ('paid','partially_refunded','refunded')) bruto_fat,
    sum(i.quantity) filter (where s.status not in ('paid','partially_refunded','refunded')) un_canc,
    sum(i.quantity*i.unit_price) filter (where s.status not in ('paid','partially_refunded','refunded')) bruto_canc,
    sum(i.quantity) filter (where s.tem_devolucao) un_dev,
    count(distinct i.codigo) codigos, min(i.unit_price) pmin, max(i.unit_price) pmax
  from ml_vendas s join ml_vendas_itens i on i.venda_id=s.id and i.org_id=s.org_id
  cross join org cross join j
  where s.org_id=org.id
    and s.date_closed >= (j.ini::timestamp at time zone 'America/Sao_Paulo')
    and s.date_closed <  ((j.fim+1)::timestamp at time zone 'America/Sao_Paulo')
  group by 1,2
),
cod as (
  select i.ml_item_id mlb, count(distinct i.codigo) n
  from ml_vendas s join ml_vendas_itens i on i.venda_id=s.id and i.org_id=s.org_id cross join org cross join j
  where s.org_id=org.id and s.date_closed >= (j.ini::timestamp at time zone 'America/Sao_Paulo') - interval '1 day'
  group by 1
),
promo as (
  select distinct pi.ml_item_id mlb, dd::date dia
  from ml_promocao_itens pi join ml_promocoes p on p.org_id=pi.org_id and p.promocao_id=pi.promocao_id
  cross join org cross join j
  cross join generate_series(j.ini, j.fim, interval '1 day') dd
  where pi.org_id=org.id and pi.status in ('started','pending')
    and dd::date >= coalesce((p.inicio at time zone 'America/Sao_Paulo')::date, j.ini)
    and dd::date <= coalesce((p.fim at time zone 'America/Sao_Paulo')::date, j.fim)
)
select a.mlb, a.ad_group_id, a.dia, a.cost, a.direct_amount, a.direct_units, a.total_amount, a.units,
  v.un_fat, v.bruto_fat, v.un_canc, v.bruto_canc, v.un_dev, v.pmin, v.pmax, c.n codigos_mlb,
  (pr.mlb is not null) promo
from ads a
left join vend v on v.mlb=a.mlb and v.dia=a.dia
left join cod c on c.mlb=a.mlb
left join promo pr on pr.mlb=a.mlb and pr.dia=a.dia
where a.direct_units > 0 or a.cost > 0;
```

Regras aplicadas sobre o resultado: dia comparável = `direct_units > 0 and un_fat > 0`; diferença = `|direct_amount/direct_units − bruto_fat/un_fat| ÷ (bruto_fat/un_fat)`; estrito = `codigos_mlb = 1`; ampliado = `pmin = pmax`; desconto por preço = `pmax < 0,98 × max(pmax do MLB na janela)`; excesso de canceladas = `direct_units − un_fat` quando positivo, valorizado ao preço atribuído; teto = `min(direct_units, un_canc)` ao preço atribuído.

### Query 2 — critério 3 (kits)

```sql
select o.nome, (select count(*) from kits_virtuais k where k.org_id=o.id) kits,
  (select count(*) from ml_vendas s where s.org_id=o.id and s.kit_item_id is not null) vendas_kit,
  (select count(*) from ml_ads_grupo g join kits_virtuais k on k.org_id=g.org_id and k.ml_item_id=g.external_id where g.org_id=o.id) grupos_ads_kit,
  (select count(*) from ml_ads_grupo_item gi join kits_virtuais k on k.org_id=gi.org_id and k.ml_item_id=gi.ml_item_id where gi.org_id=o.id) membros_ads_kit
from organizations o;
```

### Query 3 — critério 5 (6 maiores gastos, 30 dias)

```sql
with org as (select id from organizations where nome='Avil'),
j as (select date '2026-09-05' ini, date '2026-10-04' fim),
top as (
  select d.ad_group_id, sum(d.cost) cost, sum(d.direct_amount) direct_amount, sum(d.total_amount) total_amount,
         sum(d.direct_units) direct_units
  from ml_ads_grupo_dia d cross join org cross join j
  where d.org_id=org.id and d.dia between j.ini and j.fim group by 1 order by 2 desc limit 6
),
mem as (
  select t.ad_group_id, i.ml_item_id mlb from top t join ml_ads_grupo_item i on i.ad_group_id=t.ad_group_id cross join org where i.org_id=org.id
  union
  select g.ad_group_id, g.external_id from ml_ads_grupo g join top t using (ad_group_id) cross join org where g.org_id=org.id and g.tipo='ITEM'
),
v as (
  select m.ad_group_id, sum(i.quantity*i.unit_price) bruto, sum(i.quantity) un, min(i.titulo) titulo
  from mem m join ml_vendas_itens i on i.ml_item_id=m.mlb
  join ml_vendas s on s.id=i.venda_id and s.org_id=i.org_id
  cross join org cross join j
  where s.org_id=org.id and s.status in ('paid','partially_refunded','refunded')
    and s.date_closed >= (j.ini::timestamp at time zone 'America/Sao_Paulo')
    and s.date_closed <  ((j.fim+1)::timestamp at time zone 'America/Sao_Paulo')
  group by 1
)
select g.tipo, t.*, (select count(*) from mem where mem.ad_group_id=t.ad_group_id) n_mlbs, v.bruto, v.un, v.titulo
from top t join ml_ads_grupo g on g.ad_group_id=t.ad_group_id and g.org_id=(select id from org)
left join v on v.ad_group_id=t.ad_group_id order by t.cost desc;
```
