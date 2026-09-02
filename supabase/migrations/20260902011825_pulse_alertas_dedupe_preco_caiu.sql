-- ADR-0133 Errata 3 — idempotência do `preco_caiu` dentro do mesmo dia.
--
-- `pulse_ofertas` já é idempotente por (produto_id, item_id, dia); `pulse_alertas` nunca teve
-- chave nenhuma, então toda redetecção da MESMA queda virava linha nova. A validação de
-- 2026-09-01 mediu isso na org real: (de=71.99, para=68.99) gravado às 00:00:08 e de novo às
-- 18:00:06 do mesmo dia, sem nenhuma escrita nova em `pulse_ofertas` no intervalo.
--
-- A causa a montante (a qualificação de relevância compara visitas congeladas contra visitas ao
-- vivo, e um concorrente pode sumir/reaparecer do conjunto "antes") é decisão de ADR e NÃO é
-- mexida aqui. Esta migration trata o sintoma: a mesma queda, no mesmo dia, no mesmo produto,
-- grava uma vez só.
--
-- Escopo do dedupe: SÓ `preco_caiu`, e SÓ dentro do dia. Queda igual em dias diferentes é
-- movimento real (o preço voltou e caiu de novo) e continua gerando alerta.
--
-- Re-executável de ponta a ponta: `if not exists` nas duas DDLs e o delete é naturalmente
-- idempotente (numa 2ª passada não sobra duplicata para apagar). Importa porque `db push` não
-- roda em transação — uma parada no meio precisa poder ser retomada.

-- 1) Reemissões já gravadas. ATENÇÃO: isto APAGA linha de `pulse_alertas` — o índice único não
--    pode nascer sobre a tabela suja. A linha mantida é a MAIS ANTIGA de cada chave: a validação
--    mostrou que a primeira é a detecção real e as seguintes são a redetecção sem queda nova.
--    O `lido` que sobrevive é o da linha mantida.
delete from public.pulse_alertas a
using public.pulse_alertas b
where a.tipo = 'preco_caiu' and b.tipo = 'preco_caiu'
  and a.org_id = b.org_id
  and a.produto_id = b.produto_id
  and a.payload->>'de'   = b.payload->>'de'
  and a.payload->>'para' = b.payload->>'para'
  and (a.criado_em at time zone 'UTC')::date = (b.criado_em at time zone 'UTC')::date
  and (a.criado_em, a.id) > (b.criado_em, b.id);

-- 2) A chave de conflito como COLUNA, não como expressão: o `on_conflict` do PostgREST só aceita
--    nome de coluna, então um índice sobre `payload->>'de'` seria inalcançável pelo upsert do
--    coletor. `null` fora do `preco_caiu` (e sem produto/par de preços) mantém esses alertas fora
--    do índice — em índice único, linha com null nunca colide.
alter table public.pulse_alertas
  add column if not exists dedupe_preco_caiu text
    generated always as (
      case
        when tipo = 'preco_caiu' and produto_id is not null
             and payload->>'de' is not null and payload->>'para' is not null
        then produto_id::text || '|' || (payload->>'de') || '|' || (payload->>'para')
      end
    ) stored;

-- O dia fica em coluna própria, `date`, e não concatenado na chave acima: `date -> text` depende
-- de `DateStyle` e coluna gerada exige expressão imutável. `at time zone 'UTC'` é justamente o
-- que torna a conversão imutável (`criado_em::date` sozinho não é).
--
-- É o dia civil **UTC** — o mesmo de `inicioDoDiaUtc()` em pulse-coletar/processar.ts. Difere de
-- propósito de `pulse_ofertas.dia`/`pulse_vendedores.dia` (America/Sao_Paulo): aqui o que importa
-- é os dois lados (Deno e Postgres) concordarem sobre a mesma janela.
alter table public.pulse_alertas
  add column if not exists dedupe_dia_utc date
    generated always as ((criado_em at time zone 'UTC')::date) stored;

create unique index if not exists pulse_alertas_dedupe_preco_caiu_uniq
  on public.pulse_alertas (dedupe_preco_caiu, dedupe_dia_utc);

comment on column public.pulse_alertas.dedupe_preco_caiu is
  'ADR-0133 Errata 3: parte da chave de idempotência do preco_caiu (produto|de|para). null nos '
  'demais tipos — o índice único só vale para esses. Alvo do onConflict do coletor.';
comment on column public.pulse_alertas.dedupe_dia_utc is
  'ADR-0133 Errata 3: dia civil UTC de `criado_em`, a janela do dedupe do preco_caiu.';
