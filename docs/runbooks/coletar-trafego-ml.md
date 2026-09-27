# Runbook — Coleta de tráfego e oferta (`coletar-trafego-ml`)

Operação do worker da Fatia 2b de Vendas SKU: todo dia lê no Mercado Livre as **visitas por dia**
de cada MLB da org (`GET /items/{id}/visits/time_window`), o **preço de oferta observado**
(`GET /items/{id}/sale_price?context=channel_marketplace`) e o status do anúncio (multiget
`GET /items?ids=…&attributes=id,status`). **Só GET no ML** — o único POST é o refresh OAuth de
`_shared/ml/token.ts`. Nada é alterado em anúncio.

Grava em `ml_item_visitas_dia`, `ml_item_preco_dia`, `ml_trafego_item` e `ml_trafego_sync`, só pelas
RPCs de `supabase/migrations/20260927084615_vendas_sku_trafego.sql` (service_role). Contrato e
decisões: plano `docs/superpowers/plans/2026-09-27-vendas-sku-fatia-2b.md`, spike
`docs/spikes/052-visitas-e-preco-ml.md`.

Nada disto foi aplicado em produção pela implementação (Ruling 2b-1). A ordem abaixo é obrigatória:
banco → função → schedule.

## 1. Migration (one-time)

```bash
supabase link --project-ref txvncrgkoynoxwopfkbp   # se o worktree ainda não estiver linkado
supabase db push                                   # aplica 20260927084615_vendas_sku_trafego.sql
npm run db:check
```

Conferir que as 4 tabelas e as 6 RPCs existem (`reservar_trafego_posse`, `avancar_trafego_cursor`,
`gravar_visitas_dia`, `gravar_preco_dia`, `gravar_trafego_item`, `concluir_trafego_rodada`) e que as
RPCs só têm `execute` para `service_role`.

## 2. Deploy da função (one-time)

```bash
supabase functions deploy coletar-trafego-ml --no-verify-jwt
```

É a **única** função a deployar: os módulos de `_shared/` desta fatia (`_shared/trafego/*`) só são
importados por ela. Conferir a versão nova com `supabase functions list`.

**Conferir `verify_jwt = false`** (o QStash não manda JWT; `supabase/config.toml` já declara
`[functions.coletar-trafego-ml] verify_jwt = false`). Uma chamada sem nada tem que ser recusada
**pela função**, não pelo gateway:

```bash
curl -s -i -X POST https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/coletar-trafego-ml
# esperado: HTTP 401 com corpo "Invalid signature"
# errado:   401 em JSON "Missing authorization header" → gateway exigindo JWT; redeployar com --no-verify-jwt
```

## 3. Schedule QStash (one-time)

Cron **`17 9 * * *` (UTC) = 06:17 BRT**, fora da virada da hora (crons de `*/15`, `0 *`, `10 */6`) e
do `renovar-tokens-ml` (`:40`). **Sem body.** Retries 1 (um 500 do fan-out é tentado de novo; o
`deduplicationId` org+dia impede cadeia duplicada).

```bash
curl -s -X POST \
  "https://qstash.upstash.io/v2/schedules/https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/coletar-trafego-ml" \
  -H "Authorization: Bearer $QSTASH_TOKEN" \
  -H "Upstash-Cron: 17 9 * * *" \
  -H "Upstash-Retries: 1"
```

Anotar o `scheduleId` devolvido, conferir com o `curl … /v2/schedules` de
[edge-functions.md](../reference/edge-functions.md) e acrescentar a linha na tabela de schedules de lá.

## 4. Teste ponta a ponta

1. Disparar uma execução única pelo QStash (publish sem body na mesma URL, ou "Trigger" no schedule).
2. Resposta do fan-out: `{ "ok": true, "orgs": N }` — N = orgs com conexão ML.
3. No QStash (Logs/Events de cada mensagem — a função só loga erro): uma entrega por org com resposta
   `{ "ok": true, "resultado": "continua" | "ok" }`. Na carga inicial
   (150 dias) a Avil gera ~29 mensagens de lote 20 (spike 052 §4).
4. SQL (read-only, Management API):

```sql
select org_id, estado, rodada, posse_ate, cursor, carga_inicial_concluida_em, ultimo_ok_em, erro
  from ml_trafego_sync;
select estado, count(*) from ml_item_visitas_dia group by 1;
select dia, count(*) from ml_item_preco_dia group by 1 order by 1 desc limit 3;
select status, count(*), count(ultimo_ok_em) from ml_trafego_item group by 1;
```

Esperado ao fim da cadeia: `estado = 'ok'`, `posse_ate` e `cursor` nulos, `carga_inicial_concluida_em`
preenchido; visitas majoritariamente `ok` (os 2 dias mais recentes ficam `pendente` até fechar 48 h);
1 linha de preço por MLB no dia de hoje.

## 5. Como ler `ml_trafego_sync`

| `estado` | Significa | O que fazer |
|---|---|---|
| `sincronizando` | Cadeia em andamento. `posse_ate` > agora = viva (renovada a cada lote); `cursor` = último MLB gravado. | Nada. Se `posse_ate` já passou há muito, a cadeia morreu: a execução do dia seguinte assume e, na carga inicial, retoma do `cursor`. |
| `ok` | Rodada concluída. `ultimo_ok_em` = fim. | Nada. |
| `sem_acesso` | Org sem conexão ML ou token recusado (401). `erro` traz o motivo. | Reconectar a conta em Canais. |
| `erro` | Falha real (banco, refresh de token, exceção). `erro` e `ultimo_erro_em` preenchidos; a mensagem devolveu 500 e o QStash tentou 1 vez de novo. | Ver logs da função pelo `org_id`. A execução do dia seguinte recomeça. |

Outros sinais:
- Resposta `{ "resultado": "obsoleta" }` (HTTP 200) é normal: mensagem de uma rodada que perdeu a
  posse, ou fan-out do dia seguinte com a cadeia anterior ainda viva. Não é reentregue.
- 429/5xx do ML que não cabe no orçamento de 90 s vira continuação no mesmo cursor com `delay` =
  `Retry-After`; depois de 5 adiamentos seguidos os MLBs restantes do lote ficam `falha` e a cadeia anda.
- Dia `falha` nunca apaga um dia `ok`; dia ausente não é zero.
- Retenção: depois do fan-out, apaga visitas/preços com `dia` anterior a hoje − 13 meses (uma
  deleção por org e tabela). Falha só aparece no log (`retenção`), nunca como 500.

## 6. Pausar / retomar

- **Pausar:** no console do QStash, Schedules → `coletar-trafego-ml` → **Pause** (ou
  `curl -X POST https://qstash.upstash.io/v2/schedules/<scheduleId>/pause -H "Authorization: Bearer $QSTASH_TOKEN"`).
  Continuações já publicadas terminam a rodada em curso; nenhuma nova cadeia começa.
- **Retomar:** **Resume** (ou `…/<scheduleId>/resume`). Se a pausa passou de 7 dias, a janela de
  cada MLB se estende até o último dia `ok` (limite de 150 dias) — sem buraco.
- **Parar de vez:** apagar o schedule. Os dados ficam; a tela mostra a cobertura que existir.
