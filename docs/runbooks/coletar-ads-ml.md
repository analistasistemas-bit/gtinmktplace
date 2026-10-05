# Runbook — Coleta de Ads (`coletar-ads-ml`)

Worker da Fatia 2c de Vendas SKU. Todo dia lê no Mercado Livre, **só com GET**, o gasto e as vendas
atribuídas de Product Ads **por grupo de anúncios** (`ad_group_id`): anunciante
(`/advertising/advertisers?product_id=PADS`), grupos com gasto na janela (`ad_groups/search`), a série
diária de cada grupo (`/ad_groups/{id}?aggregation_type=daily`) e os membros atuais de FAMILY/CATALOG
(`/ad_groups/{id}/ads`). O único POST é o refresh OAuth de `_shared/ml/token.ts`. Nada é alterado em
anúncio ou campanha.

Grava em `ml_ads_sync`, `ml_ads_grupo`, `ml_ads_grupo_item`, `ml_ads_grupo_dia` e (v12, ADR-0179) `ml_ads_conta_dia`, só pelas RPCs de
`supabase/migrations/20260927124602_vendas_sku_ads.sql`. Contrato: plano
`docs/superpowers/plans/2026-09-27-vendas-sku-fatia-2c.md`; spike `docs/spikes/053-product-ads-ml.md`.

**Ativado em produção em 2026-09-27:** migration aplicada (`db push`), função deployada (ACTIVE, v1) e
schedule criado (cron `17 14 * * *` UTC, scheduleId `scd_7c8F3D7T64XecBkStgxwpDNuho1R`). Os passos abaixo
seguem valendo para reexecução manual, diagnóstico e a rotina de pausar/retomar.

## 1. Migration (one-time)

```bash
supabase link --project-ref txvncrgkoynoxwopfkbp   # se o worktree ainda não estiver linkado
supabase db push                                   # aplica 20260927124602_vendas_sku_ads.sql
npm run db:check
```

Conferir as 4 tabelas e as RPCs `reservar_ads_posse`, `avancar_ads_cursor`, `gravar_ads_lote`,
`concluir_ads_rodada`, `limpar_ads_retencao` (execute só `service_role`) e `vendas_sku_codigos_mlbs`
(execute `authenticated`, lida pelo dossiê).

## 2. Deploy (one-time)

```bash
supabase functions deploy coletar-ads-ml --no-verify-jwt
supabase functions deploy coletar-trafego-ml --no-verify-jwt   # _shared/trafego/fiacao.ts mudou (headers/rotulo)
supabase functions list                                        # conferir as versões novas
```

`_shared/ads/*` só é importado por `coletar-ads-ml`; `_shared/trafego/fiacao.ts` também por
`coletar-trafego-ml` (mudança compatível, mas a regra do projeto é redeployar quem importa `_shared/` alterado).

Conferir `verify_jwt = false`:

```bash
curl -s -i -X POST https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/coletar-ads-ml
# esperado: HTTP 401 com corpo "Invalid signature"
# errado:   401 JSON "Missing authorization header" → redeployar com --no-verify-jwt
```

## 3. Schedule QStash (one-time)

Cron **`17 14 * * *` (UTC) = 11:17 BRT**: depois das 10:00 BRT em que o ML atualiza as métricas, fora da
virada da hora e do `renovar-tokens-ml` (`:40`). **Sem body.** Retries 1.

```bash
curl -s -X POST \
  "https://qstash.upstash.io/v2/schedules/https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/coletar-ads-ml" \
  -H "Authorization: Bearer $QSTASH_TOKEN" \
  -H "Upstash-Cron: 17 14 * * *" \
  -H "Upstash-Retries: 1"
```

Anotar o `scheduleId` e acrescentar a linha na tabela de schedules de
`docs/reference/edge-functions.md`. `scheduleId` em produção: `scd_7c8F3D7T64XecBkStgxwpDNuho1R`.

## 4. Teste ponta a ponta

1. Disparar uma execução (publish sem body na mesma URL, ou "Trigger" no schedule).
2. Fan-out: `{ "ok": true, "orgs": N }`.
3. Por org (Logs do QStash): `{ "ok": true, "resultado": "ok" | "continua" | "sem_acesso" }`. Carga inicial
   da Avil: ~134 grupos com gasto em 90 dias ≈ 1 série + membros por grupo, em 1–3 mensagens.
4. `ml_ads_sync.custo_resumo` (metrics_summary do ML) × `custo_listado` (Σ dos grupos listados), da última
   janela ok. Diferença > 0 = gasto fora de grupo listado (spike: ~2,6 %, provável `deleted`): o dossiê mostra a
   despesa, mas deixa o "Lucro após Ads" indisponível com esse motivo. O log `[ads] custo da janela` só traz a razão.
5. SQL (read-only, Management API):

```sql
select org_id, estado, advertiser_id, carga_inicial_ok, cobertura_desde, ultimo_ok_em, cursor, posse_ate, erro,
       round(100 * (custo_resumo - custo_listado) / nullif(custo_resumo, 0), 2) as pct_fora_dos_grupos
  from ml_ads_sync;
select tipo, status, count(*) from ml_ads_grupo group by 1, 2 order by 1, 2;
select min(dia), max(dia), count(*), sum(cost) from ml_ads_grupo_dia;
```

Esperado ao fim: `estado = 'ok'`, `carga_inicial_ok = true`, `cobertura_desde` = hoje − 90 da 1ª carga,
`max(dia)` = ontem (hoje nunca é gravado), `posse_ate` e `cursor` nulos.

## 5. Como ler `ml_ads_sync`

| `estado` | Significa | O que fazer |
|---|---|---|
| `sincronizando` | Cadeia em andamento (`posse_ate` > agora). | Nada. Posse vencida há muito = cadeia morta; a execução seguinte assume e, na carga inicial, retoma do `cursor`. |
| `ok` | Rodada concluída. | Nada. |
| `sem_permissao` | ML devolveu 403 PolicyAgent: sem permissão de Publicidade **ou** conexão recusada (o ML usa o mesmo corpo para bearer malformado). Não é tratado como token expirado. | Conferir a permissão funcional "Publicidade" do app no portal do ML e reconectar a conta em Canais. |
| `sem_advertiser` | 404 no advertiser ou conta sem anunciante MLB. | O vendedor ativa em *Meu perfil → Publicidade* (reputação amarela ou melhor, 15 dias de cadastro, sem fatura vencida). |
| `sem_acesso` | Org sem conexão ML, ou 401 que se repetiu depois de reler o token uma vez em `getValidAccessTokenConexao`. | Reconectar a conta em Canais. |
| `erro` | Falha real (banco, resposta fora do contrato — inclusive série diária com dia faltando —, 5xx esgotado, ou grupos não lidos depois de 5 adiamentos). A mensagem devolveu 500 e o QStash tentou 1 vez. `ultimo_ok_em` não avança. | Ver logs pelo `org_id`. A execução do dia seguinte recomeça. |

Outros sinais:
- `{ "resultado": "obsoleta" }` (HTTP 200) é normal: rodada que perdeu a posse.
- 429/5xx que não cabe no orçamento de 90 s → continuação no mesmo cursor com `delay` = `Retry-After`;
  depois de 5 adiamentos os grupos não lidos viram falha, o cursor anda e a rodada fecha em `erro` (os dias já
  gravados ficam; o dossiê marca "desatualizado" depois de 48 h sem ok).
- Membros de FAMILY/CATALOG: lidos sempre na janela de 90 dias. Lista vazia ou menor que o vínculo gravado
  não substitui o vínculo (conservador: o grupo nunca vira "exclusivo" por uma leitura parcial).
- Grupo que some do search (provável `deleted`) **não** é apagado: se ainda tem gasto gravado na janela, é
  relido por id; 404 → os dias ficam. Só a retenção apaga.
- Atribuição: `direct/indirect/total_amount` mudam por 14 dias; cada execução relê D-1 + 14 dias e a
  leitura mais recente vence (inclusive para baixo).
- Retenção: depois do fan-out, apaga dias anteriores a hoje − 13 meses e grupos sem dia retido, e avança
  `cobertura_desde` para o corte. Falha só aparece no log, nunca como 500.

## 5b. Série diária da conta (ADR-0179, v12)

Além dos grupos, o worker lê a série diária do anunciante e grava em `ml_ads_conta_dia` (`gravar_ads_conta_dias`);
`ml_ads_sync.conta_cobertura_desde` é o início da cobertura. Conferência (read-only):

```sql
select org_id, count(*), min(dia), max(dia), sum(cost) from ml_ads_conta_dia group by 1;
select org_id, conta_cobertura_desde, ultimo_ok_em from ml_ads_sync;
```

Esperado: 90 linhas por org após a carga, `max(dia)` = ontem, Σ igual ao `metrics_summary` do ML.

**Disparo manual direto:** se o fan-out do dia já foi deduplicado (`deduplicationId` `ads:<org>:<dia BRT>`),
republicar no QStash uma mensagem `{org_id, primeira:true}` por org direto na URL do worker (o que o fan-out
publicaria). A rodada extra só move `ultimo_ok_em`; a janela seguinte continua D-1 + 14.

## 6. Pausar / retomar

- **Pausar:** QStash → Schedules → `coletar-ads-ml` → **Pause** (ou `…/v2/schedules/<scheduleId>/pause`).
- **Retomar:** **Resume**. A janela estende até o último dia ok − 14 (limite de 90 dias). Parada > 90 dias
  deixa buraco irrecuperável (o ML só aceita 90 dias por chamada): `cobertura_desde` avança para o início da
  janela relida e a tela mostra "sem dado" (nunca zero) antes dele.
- **Parar de vez:** apagar o schedule. Os dados ficam até a retenção.
