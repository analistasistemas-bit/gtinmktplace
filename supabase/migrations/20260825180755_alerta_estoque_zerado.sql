-- ADR-0134 — alerta de estoque zerado e de volta ao ar.

-- Marca de alerta por MOVIMENTO: o push é idempotente e o QStash reentrega, então a dedup precisa
-- estar na linha que representa a transição (>0 → 0), não no estado atual do saldo.
-- Mesmo padrão de ml_moderacao.alertado_em (ADR-0035).
alter table public.estoque_movimentos add column if not exists alertado_em timestamptz;

comment on column public.estoque_movimentos.alertado_em is
  'Quando o alerta de estoque zerado deste movimento foi emitido (ADR-0134). Null = ainda não alertado.';

-- Só os candidatos a alerta interessam: movimento que zerou e ainda não foi avisado.
create index if not exists estoque_movimentos_zerados_nao_alertados
  on public.estoque_movimentos (org_id, codigo_pai)
  where estoque_resultante = 0 and estoque_anterior > 0 and alertado_em is null;

-- Backfill: o histórico inteiro está com alertado_em null e viraria uma avalanche no primeiro push
-- de cada produto. Fecha tudo que já existe; só transição nova alerta.
update public.estoque_movimentos set alertado_em = now() where alertado_em is null;

-- Categoria de notificação 'estoque' (sincronia manual com os dois categorias.ts).
alter table public.notificacoes drop constraint notificacoes_categoria_check;
alter table public.notificacoes add constraint notificacoes_categoria_check
  check (categoria in ('vendas','perguntas','pos_venda','financeiro','moderacao','mensagens','integracao','pulse','estoque'));

-- O CHECK de contenção precisa aceitar 'estoque' ANTES do backfill de assinatura abaixo.
alter table public.profiles
  drop constraint if exists profiles_telegram_categorias_validas;
alter table public.profiles
  add constraint profiles_telegram_categorias_validas
  check (telegram_categorias <@ array['vendas','perguntas','pos_venda','financeiro','moderacao','mensagens','integracao','pulse','estoque']::text[]);

-- Backfill de assinatura: quem já acompanha 'moderacao' é o mesmo público que quer saber de
-- anúncio fora do ar. Sem assinante, lerAssinantes devolve vazio e o alerta não chega a ninguém.
update public.profiles set telegram_categorias = array_append(telegram_categorias, 'estoque')
  where is_active
    and 'moderacao' = any(coalesce(telegram_categorias, '{}'))
    and not ('estoque' = any(coalesce(telegram_categorias, '{}')));
