# Análise: PostgREST Egress ~150 MB/dia — PubliAI (txvncrgkoynoxwopfkbp)

**Data:** 2026-08-17 · **Analista:** read-only, nada foi alterado.

> **Snapshot ANTES das correções.** Os números e os crons citados aqui são o estado em 17/08/2026.
> Aplicadas em 18/08: correção **1** (schedule do `backfill-faturamento` → `30 6 * * *`), **3**
> (`memoCatalogo`) e **4** (filtro de reprocesso de perguntas/claims). A correção **2** (early-exit
> no `upsertVenda`) segue pendente e é a maior alavanca restante. Ver `docs/TASKS.md` e
> `docs/reference/edge-functions.md`.
>
> **Atenção ao número da seção 2:** o "~30–50 MB/dia" ali assume a correção **2**, que NÃO foi
> feita. Com 1+3+4 apenas — e usando o efeito medido em produção do filtro (perguntas eliminadas
> por completo, claims −65%) — o esperado é **~85–105 MB/dia** (≈3,1–3,6 GB/mês contra os 5 GB do
> plano). Passa da cota com ~30% de folga, não com as 3–5× que a correção 2 traria.
**Fontes:** código na main + dados reais coletados por leitura: `pg_stat_statements` (acumulado desde 26/05), `edge_logs` das últimas 24h (Management API, SQL read-only), `table-stats` via CLI.

## Conclusão em uma frase

O egress NÃO vem de payloads gordos nem do frontend — vem de **VOLUME de requisições dos workers de faturamento**: ~155 mil requests REST/dia, 24/7, dos quais ~121 mil (78%) são o pipeline `upsertVenda` re-executado **para cada venda, a cada hora**, pelos schedules `backfill-faturamento` (janela 7 dias) e `reconciliar-faturamento` (janela 72h + TODOS os claims), mesmo quando nada mudou.

## Números medidos (últimas 24h, domingo — dia de uso humano leve)

Requests REST por path+método (edge_logs, 24h):

| Path | Método | Req/dia | Origem |
|---|---|---|---|
| ml_vendas | GET | 22.760 | select "anterior" do upsertVenda + delta poll frontend |
| ml_vendas | POST | 19.112 | upsert (com `raw` ~1,9 KB no request) |
| ml_vendas_itens | DELETE | 19.107 | delete-and-replace do upsertVenda |
| ml_vendas_itens | POST | 19.087 | idem |
| ml_mensagens | PATCH | 19.106 | update order_status dentro do upsertVenda |
| venda_item_custo | POST | 19.100 | congelamento de custo (ON CONFLICT DO NOTHING) |
| ml_perguntas | GET+POST+HEAD | 10.607 | upsertPergunta (select anterior + upsert) por pergunta/hora |
| ml_devolucoes | GET+POST | 8.489 | upsertDevolucao por claim/hora, 2 workers |
| ml_vendas | PATCH | 3.261 | tem_devolucao etc. |
| marketplace_connections | GET | 2.513 | resolução de token/org por execução |
| ml_webhook_eventos | POST | 1.779 | log de webhook |
| variacoes | GET | 1.195 | `carregarCatalogo` (5.395 linhas → 6 páginas/carga) |
| pulse_* | vários | ~4.400 | ADR-0119, desde 16/08 |
| notificacoes | GET+HEAD | 801 | polls de 60s do frontend (aba aberta) |

Total: **~155k requests/dia**, mínimo noturno de ~3.500/h (bate 1:1 com o gráfico "nunca zera").

Aritmética que fecha o volume: `ml_vendas` tem **177 vendas na janela de 72h** e **421 na de 7 dias** (contado no banco). `upsertVenda` = **6 requests** (GET anterior + POST venda + PATCH mensagens + DELETE itens + POST itens + POST custo). Por hora: reconciliar 177×6 = 1.062 + backfill 421×6 = 2.526 + claims (~88 × re-upsert completo) ≈ **~4.200 req/h só desse pipeline** → ~100k/dia ✓ (confere com os 121k observados, o resto é perguntas/devoluções/webhooks).

`pg_stat_statements` confirma a escala acumulada: 870.663 upserts em `ml_vendas` e 981.616 DELETEs de itens desde 26/05 — **~500 re-upserts por venda existente** (1.734 vendas na tabela).

### Como isso vira MB

Egress = bytes de RESPOSTA (request/ingress não conta). Cada resposta PostgREST carrega ~450–600 B de headers (content-range, content-profile, server, CORS...) + body (medido por content-length nos não-chunked: ~42 B nos upserts/selects-anterior).

| Fonte | Conta | MB/dia | Confiança |
|---|---|---|---|
| Pipeline vendas (workers) | 121.500 req × ~550 B | **~64** | alta (contagem medida; 550 B = header estimado + body medido) |
| Perguntas (workers) | 10.600 × 550 B | ~5,6 | alta |
| Devoluções (workers) | 8.500 × 550 B | ~4,5 | alta |
| `carregarCatalogo` (variacoes) | 1.195 GET × ~20–30 KB gzip (página de 1.000 linhas ≈ 150–200 KB JSON, comprimida) | **~25–35** | média (gzip presumido — Deno fetch pede gzip; se a metragem for pré-compressão, sobe para ~180) |
| Conexões/webhooks/rpc/profiles | ~6.000 × 500 B | ~3 | alta |
| Pulse (desde 16/08) | ~4.400 × 600 B | ~2,7 | média |
| Frontend (domingo; dia útil sobe) | ~1.500 req, maioria pequena + fetch cheio de janela ~100 KB gzip por visita ao Faturamento | ~2–15 | média |
| **Total estimado** | | **~110–130** | vs. 172 MB medido em 17/08 — mesma ordem; a folga cabe em headers maiores/TLS/dia com mais webhooks |

## 1. Suspeitos ranqueados

### #1 — `upsertVenda` re-executado para toda venda, toda hora (confiança: ALTA)
`supabase/functions/_shared/faturamento/io.ts:252-345` — sempre executa os 6 requests, **sem early-exit quando a venda não mudou**. Chamado por:
- `supabase/functions/backfill-faturamento/index.ts:117-147` — QStash `30 * * * *` (horário!), body `{"dias":7}` → 421 vendas × 6 req × 24 = **60.600 req/dia**
- `supabase/functions/reconciliar-faturamento/index.ts:135-165` — QStash `0 * * * *`, janela 72h → 177 × 6 × 24 = **25.500 req/dia**
- idem, passo de claims (`index.ts:105-130`): cada claim re-roda `upsertDevolucao` + `upsertVenda` completo → ~88 claims/h ≈ **15.000 req/dia**
- `sync-venda`/`sync-devolucao` por webhook (legítimo, ~2k/dia)

Estimativa: **~64 MB/dia (40–55% do total)**.

### #2 — `carregarCatalogo` puxa TODAS as 5.395 variações a cada chamada (confiança: MÉDIA-ALTA)
`supabase/functions/_shared/faturamento/io.ts:67-160` — pagina `familias` + `variacoes` + `anuncios_externos_itens` inteiras da org. Chamado **2× por org por execução** do reconciliar (linhas 105 e 139 do index.ts — mesmo dado, sem memo), 1× no backfill, 1× por webhook em `sync-venda`/`sync-devolucao`. 1.195 GETs/dia em `/rest/v1/variacoes` medidos. Estimativa: **~25–35 MB/dia** (gzip). Confiança média porque depende de a metragem do Supabase ser pós-compressão.

### #3 — Reconciliação de perguntas e claims SEM janela (confiança: ALTA)
`reconciliar-faturamento/index.ts:85-101` re-upserta TODAS as perguntas do seller a cada hora (88 no banco → 10,6k req/dia) e `buscarClaimsSeller` "varre TODOS os claims" (comentário no próprio docs/reference/edge-functions.md:766) → 8,5k req/dia em ml_devolucoes. Estimativa: **~10 MB/dia**.

### #4 — Frontend (confiança: ALTA de que é PEQUENO)
Polls de 60s (badges/notificações) usam `head:true` count e select de 5 colunas com `limit(20)` (`src/lib/notificacoes.ts:13-27`, `src/hooks/usePerguntas.ts`); `useVendas` já é delta-poll de 180s (ADR-0082). Medido: ~800 req/dia de notificações ≈ **0,4 MB/dia**. O fetch cheio da janela do Faturamento (~100 KB gzip) só ocorre em visita/remontagem. Dia útil com abas abertas: **~5–15 MB/dia**. Não é o vilão.

## 2. Quanto cada correção economiza (ranqueado por economia ÷ esforço)

| # | Correção | Economia MB/dia | % do total | Esforço |
|---|---|---|---|---|
| 1 | **Backfill-faturamento de 24×/dia → 1×/dia** (editar schedule QStash, zero código) | ~33 | ~22% | 5 min |
| 2 | **Early-exit no `upsertVenda`**: o GET "anterior" já existe; comparar `last_updated` do pedido ML (ou hash) com o gravado e pular os 5 writes se nada mudou (~90% das passadas) | ~45–55 | ~35% | 2–4 h + testes (código financeiro → cuidado, ver ressalva) |
| 3 | **Memoizar `carregarCatalogo` por execução** (reconciliar chama 2× por org) e/ou cache Redis 15 min (Redis já está na stack) | ~12–20 | ~10% | 30 min (memo) / 2 h (Redis) |
| 4 | **Janela nos claims/perguntas do reconciliar** (só claims abertos ou atualizados <7d; perguntas UNANSWERED ou <48h) | ~8–10 | ~6% | 1–2 h |
| 5 | Reconciliar-faturamento 1h → 2h (webhook cobre o tempo real) | ~12 | ~8% | 5 min (avaliar risco de perder webhook por mais tempo) |

Combinado #1+#2+#3: **~90–100 MB/dia → o egress REST cai para ~30–50 MB/dia**, bem dentro da cota (150 MB/dia é ~4,5 GB/mês sozinho; a meta é <~160 MB/dia TOTAL com margem).

## 3. Quick wins vs. estruturais

**Quick wins (<1h, sem deploy de código):**
- Backfill-faturamento: cron `30 * * * *` → `30 3 * * *` (1×/dia) ou `30 */6 * * *` (4×/dia). É rede de segurança do reconciliar (72h) + webhooks; 7 dias re-varridos de hora em hora é redundância tripla. **−33 a −30 MB/dia.**
- Reconciliar-faturamento: `0 * * * *` → `0 */2 * * *` se aceitável. **−12 MB/dia.**
- Memo de `carregarCatalogo` no reconciliar (passar o catálogo do passo 1 para o passo 2 por org — 10 linhas). **−6 MB/dia.**

**Estruturais (planejar, com ADR/testes — mexe em código financeiro):**
- Early-exit no `upsertVenda` por `date_last_updated` do ML. Ressalva: `shipment`/`frete`/`liquidoPorPayment` vêm de FORA do pedido — o critério de "nada mudou" precisa incluir shipping_status/substatus e money_release, ou o early-exit só pular os writes de itens/custo/mensagens (que nunca mudam pós-fechamento) mantendo o upsert da venda. Regra da memória do projeto: nunca rebaixar rigor em código financeiro — fazer com trava de teste.
- Cache Redis do catálogo com invalidação no publish/ingest.
- Janela em claims/perguntas.

## 4. O que NÃO é o problema (descartado com evidência)

- **Polling do frontend** — já foi o problema (ADR-0081, ciclo passado) e foi corrigido: delta-poll de vendas (ADR-0082, um tick sem mudança = `[]`), badges com `count head:true`, `refetchOnWindowFocus` global off (`src/lib/query-client.ts:6`). Medido: notificações+perguntas ≈ 1.500 req/dia × <100 B body ≈ <1 MB/dia.
- **Storage** — 6,5% do dia 17/08; a URL assinada persistida do ADR-0081 resolveu.
- **`select('*')` em tabelas gordas** — 14 ocorrências, todas em fluxos de publicação/ingest de baixa frequência (publish-familia-ml, ingest-lote), não em loop.
- **Realtime/`useLoteRealtime`** — Realtime egress ~1 KB/dia no breakdown. (`realtime.list_changes` consome 37,6% do tempo de CPU do banco — tema de performance, não de egress.)
- **Pulse (ADR-0119)** — schedules criados em 16/08; o consumo constante existe desde 24/07. ~4,4k req pequenos/dia ≈ 2,7 MB.
- **Scripts/jobs locais** — nenhum cron/launchd local aponta para o PostgREST (verificado `crontab`, `~/Library/LaunchAgents`, `scripts/`).
- **`!inner`/embeds gordos** — o único embed grande (`itens+custos` no `buscarVendas`) já exclui `raw` (`src/lib/faturamento.ts:111`) e roda no delta-poll.
- **Falta de limit em listagens** — notificações `limit(20)`, mensagens `limit`, perguntas 88 linhas; irrelevante no volume.

## 5. Como medir depois

1. **Antes/depois imediato (sem esperar o dashboard):** contagem de requests/hora via Management API (read-only):
   ```
   GET https://api.supabase.com/v1/projects/txvncrgkoynoxwopfkbp/analytics/endpoints/logs.all
     ?iso_timestamp_start=...&iso_timestamp_end=...
     &sql=select r.path, r.method, count(*) n from edge_logs t
          cross join unnest(t.metadata) m cross join unnest(m.request) r
          where r.path like '/rest%' group by 1,2 order by n desc
   ```
   Meta: de ~155k para **<40k req/dia**; POST /rest/v1/ml_vendas de 19k para <2k/dia.
2. **Dashboard Supabase** → Usage → Egress per day: piso noturno deve cair de ~100 MB para <30 MB/dia em 24–48h após mudar os schedules.
3. `pg_stat_statements` (delta entre dois dias): `calls` do upsert de `ml_vendas` deve cair ~10×.
4. Conferir schedules aplicados: `curl https://qstash.upstash.io/v2/schedules` (tabela canônica em `docs/reference/edge-functions.md:85`).

## Limitações

- `edge_logs` do plano Free retém ~24h e o dia amostrado foi um domingo — dias úteis têm mais tráfego humano (frontend sobe alguns MB), mas o piso de ~3.500 req/h noturno é 100% dos workers e não depende do dia.
- `content-length` só aparece em respostas não-chunked; os ~550 B/resposta incluem estimativa de headers (~500 B). Se o Supabase metrar egress pré-compressão, a fatia do `carregarCatalogo` sobe de ~30 para ~180 MB/dia — nesse cenário o fix #3 vira o mais urgente. A query de verificação do item 5 resolve a dúvida na prática.
- `pg_stat_statements.rows` é inútil para PostgREST (toda resposta é 1 linha `json_agg`) — não usar como proxy de egress.
