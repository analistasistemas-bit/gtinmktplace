# Runbook — reposicao-diaria

Edge `reposicao-diaria` (ADR-0207 §17–§18). QStash schedule `30 11 * * *` (08:30 BRT, depois do `resumo-diario`), sem body.

## O que faz

- Sem body: publica um job `{orgId, dia}` por org com o módulo `reposicao` (`dia` = hoje em BRT; dedup `reposicao-diaria-<org>-<dia>`).
- Com `{orgId, dia}`: calcula a sugestão do dia, grava a foto em `reposicao_fotos` (upsert pela pk `org_id, dia, codigo`) e notifica a categoria `reposicao` com chave `reposicao:<org>:<dia>`.
- O resumo só lista SKUs que **pioraram** para ruptura / vai faltar / pedir agora em relação à foto mais recente com `dia < hoje` (não necessariamente ontem), mais pedidos atrasados. Sem novidade e sem atrasado: não envia.

## Reexecutar uma org/dia

Idempotente: foto por upsert, notificação por chave. Publicar o job pelo QStash para `https://<projeto>.supabase.co/functions/v1/reposicao-diaria` com body `{"orgId":"<uuid>","dia":"YYYY-MM-DD"}` (assinatura QStash obrigatória; chamada direta dá 401). Dia diferente de hoje (BRT) é ignorado (`ignorado: 'dia passado'`, 200): recalcular com o estoque de hoje reescreveria a foto histórica. Vale também para retentativa do QStash que cruze a meia-noite.

Rascunho de pedido sozinho não dispara aviso (ADR §17: sem novidade, sem aviso); o app já avisa ao salvar. A mensagem lista até 15 produtos, pior urgência primeiro.

## Verificar

- `select dia, count(*) from reposicao_fotos where org_id = '<org>' group by dia order by dia desc limit 3;` (uma linha por SKU não-kit).
- `select criado_em, texto from notificacoes where org_id = '<org>' and categoria = 'reposicao' order by criado_em desc limit 3;`
- Logs da edge: erro vira 500 (QStash tenta 3×); `{ok:true, ignorado}` = org sem módulo ou sem configuração.
