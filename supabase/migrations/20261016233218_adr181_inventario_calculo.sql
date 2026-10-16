-- ADR-0181 D-12 (Plano 2b-2, Task 3): ordem real de aplicação no ledger + avaliação do estoque
-- pelo custo médio ponderado móvel de aquisição. Spec: docs/superpowers/specs/2026-10-16-pacote-contador-inventario-design.md
-- (§Ordem dos movimentos, §Critério de avaliação).

-- ---------------------------------------------------------------------------------------------
-- 1) `ordem`: (criado_em, id) não ordena o ledger (criado_em = início da transação, id = UUID
--    aleatório). Nullable e sem default: não reescreve a tabela. Nenhuma RPC muda: o trigger
--    numera quando estoque_resultante passa de null a valor, o que as 4 RPCs fazem DEPOIS do
--    `update variacoes`, com a variação travada até o commit.
-- ---------------------------------------------------------------------------------------------
alter table public.estoque_movimentos add column ordem bigint;
comment on column public.estoque_movimentos.ordem is
  'ADR-0181 D-12: ordem real de aplicação (sequência, atribuída sob a trava da variação). Nula em movimento sem saldo (tombstone, SKU não encontrado) criado depois da migration.';

create sequence public.estoque_movimentos_ordem_seq;
-- As RPCs rodam como estoque_rpc_executor (20260804113000) e o trigger herda essa identidade.
grant usage on sequence public.estoque_movimentos_ordem_seq to estoque_rpc_executor;
revoke all on sequence public.estoque_movimentos_ordem_seq from anon, authenticated;

-- Corte por SKU do histórico anterior à migration: lá a ordem veio de (criado_em, id) e não é
-- confiável quando transações do mesmo SKU se sobrepõem. O replay trata o corte como marco.
create table public.inventario_corte_backfill (
  org_id    uuid not null references public.organizations(id) on delete cascade,
  codigo    text not null,
  ate_ordem bigint not null,
  primary key (org_id, codigo)
);
alter table public.inventario_corte_backfill enable row level security;   -- sem policy: sem acesso
revoke all on table public.inventario_corte_backfill from anon, authenticated;

create or replace function public.estoque_movimentos_atribuir_ordem()
returns trigger language plpgsql security invoker set search_path = public, pg_temp
as $$
begin
  new.ordem := nextval('public.estoque_movimentos_ordem_seq');
  return new;
end $$;

-- Backfill atômico num bloco só (vale mesmo se o push não rodar a migration numa transação):
-- trava a escrita (leitura segue), numera TODAS as linhas por (criado_em, id) — inclusive as
-- sem saldo (Ruling 4) —, posiciona a sequência, grava o corte e SÓ ENTÃO liga o trigger.
-- Nenhum movimento novo recebe ordem antiga nem cai abaixo do corte.
do $$
begin
  lock table public.estoque_movimentos in share row exclusive mode;

  update public.estoque_movimentos m set ordem = s.rn
    from (select id, row_number() over (order by criado_em, id) as rn from public.estoque_movimentos) s
   where s.id = m.id;

  perform setval('public.estoque_movimentos_ordem_seq',
    coalesce((select max(ordem) from public.estoque_movimentos), 0) + 1, false);

  -- Código com entrada de nota e qualquer outro movimento (medição (b) da Task 2).
  insert into public.inventario_corte_backfill (org_id, codigo, ate_ordem)
  select org_id, codigo, max(ordem)
    from public.estoque_movimentos
   group by org_id, codigo
  having bool_or(referencia_externa like 'nfe:%')
     and bool_or(referencia_externa is null or referencia_externa not like 'nfe:%');

  create trigger estoque_movimentos_atribuir_ordem
    before update on public.estoque_movimentos
    for each row
    when (old.estoque_resultante is null and new.estoque_resultante is not null and new.ordem is null)
    execute function public.estoque_movimentos_atribuir_ordem();
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2) inventario_calcular: uma instrução SQL (um snapshot de saldo, notas e movimentos).
--    Universo: variações da família canônica (distinct on codigo_pai, mais recente, sem kit,
--    com ao menos uma variação). Replay por SKU, literal da spec:
--      k = unidades com nota ainda em estoque, c = custo médio (numeric(14,6));
--      lacuna na cadeia (anterior ≠ resultante esperado) → k = 0, historico_incompleto;
--      k = min(k, p(anterior)); nota: c = (k = 0) ? u : (k·c + q·u)/(k + q), k = min(k + q, p(resultante));
--      senão k = min(k, p(resultante)) — as unidades sem nota saem primeiro.
--    Marco = criado_em da família mais recente do código em lote 'planilha'; movimento com
--    criado_em <= marco ou ordem <= corte fica fora (k recomeça em 0). Entrada de nota fora do
--    replay (antes do marco/corte, ou sem movimento no ledger) marca historico_incompleto.
-- ---------------------------------------------------------------------------------------------
create or replace function public.inventario_calcular(p_org uuid)
returns table (
  codigo text, codigo_pai text, descricao text, ncm text, unidade text, cor text, tamanho text,
  quantidade_sistema int, qtd_valorizada int, qtd_sem_nota int, custo_medio numeric(14,6),
  valor_total numeric(14,2), marcas text[]
)
language sql stable security invoker set search_path = public, pg_temp
as $$
  with recursive
  canonica as (
    select distinct on (f.codigo_pai) f.id, f.codigo_pai, coalesce(f.descricao_fiscal, f.nome_pai) as descricao,
           f.ncm, f.unidade
      from public.familias f
     where f.org_id = p_org and f.kit_multiplicador is null
       and exists (select 1 from public.variacoes v where v.familia_id = f.id)
     order by f.codigo_pai, f.criado_em desc
  ),
  sku as (
    select v.codigo, c.codigo_pai, c.descricao, c.ncm, c.unidade, v.cor, v.tamanho, v.estoque as saldo
      from canonica c join public.variacoes v on v.familia_id = c.id
  ),
  marco as (
    select v.codigo, max(f.criado_em) as marco
      from public.variacoes v
      join public.familias f on f.id = v.familia_id
      join public.lotes l on l.id = f.lote_id
     where v.org_id = p_org and l.origem = 'planilha' and v.codigo in (select s.codigo from sku s)
     group by v.codigo
  ),
  -- Entradas com custo: distribuição de nota importada (desfazer só muda o status), pela ref que
  -- o ledger grava. unique (item_id, codigo) dá uma linha por ref; a soma é só defensiva.
  nota as (
    select 'nfe:' || n.chave || ':' || i.n_item || ':' || d.codigo as ref, d.codigo,
           sum(d.quantidade)::int as q,
           sum(d.quantidade * d.custo_aquisicao_unit) / sum(d.quantidade) as u
      from public.notas_compra n
      join public.notas_compra_itens i on i.nota_id = n.id
      join public.notas_compra_distribuicao d on d.item_id = i.id
     where n.org_id = p_org and n.status = 'importada' and d.codigo in (select s.codigo from sku s)
     group by 1, 2
  ),
  mov as (
    select m.codigo, m.ordem, m.id, m.referencia_externa as ref, m.estoque_anterior as ant,
           m.estoque_resultante as res, nt.q, nt.u,
           coalesce(m.criado_em <= mc.marco, false) or coalesce(m.ordem <= cb.ate_ordem, false) as antes
      from public.estoque_movimentos m
      left join nota nt on nt.ref = m.referencia_externa and nt.codigo = m.codigo and m.motivo = 'entrada'
      left join marco mc on mc.codigo = m.codigo
      left join public.inventario_corte_backfill cb on cb.org_id = m.org_id and cb.codigo = m.codigo
     where m.org_id = p_org and m.codigo in (select s.codigo from sku s)
       and m.estoque_anterior is not null and m.estoque_resultante is not null
  ),
  passos as (
    select mv.codigo, row_number() over (partition by mv.codigo order by mv.ordem, mv.id) as n,
           mv.ant, mv.res, mv.q, mv.u
      from mov mv where not mv.antes
  ),
  -- Entrada de nota que não entra no replay: antes do marco/corte, ou sem movimento no ledger.
  perdida as (
    select nt.codigo from nota nt
     where not exists (select 1 from mov mv where mv.ref = nt.ref and mv.q is not null and not mv.antes)
  ),
  replay (codigo, n, k, c, prev, hist) as (
    select s.codigo, 0::bigint, 0, null::numeric(14,6), null::int, false from sku s
    union all
    select r.codigo, p.n, x3.k, x3.c, p.res, r.hist or x1.lacuna
      from replay r
      join passos p on p.codigo = r.codigo and p.n = r.n + 1
      cross join lateral (select (r.prev is not null and p.ant <> r.prev) as lacuna) x1
      cross join lateral (select least(case when x1.lacuna then 0 else r.k end, greatest(p.ant, 0)) as k) x2
      cross join lateral (select
          case when p.q is null then least(x2.k, greatest(p.res, 0))
               else least(x2.k + p.q, greatest(p.res, 0)) end as k,
          case when p.q is null then r.c
               when x2.k = 0 then p.u::numeric(14,6)
               else ((x2.k * r.c + p.q * p.u) / (x2.k + p.q))::numeric(14,6) end as c) x3
  ),
  fim as (
    select distinct on (r.codigo) r.codigo, r.k, r.c, r.prev, r.hist from replay r order by r.codigo, r.n desc
  ),
  calc as (
    select s.*, f.c,
           f.hist or (f.prev is not null and s.saldo <> f.prev)
             or exists (select 1 from perdida pd where pd.codigo = s.codigo) as hist,
           least(case when f.prev is not null and s.saldo <> f.prev then 0 else f.k end, greatest(s.saldo, 0)) as k
      from sku s join fim f on f.codigo = s.codigo
  )
  select c.codigo, c.codigo_pai, c.descricao, c.ncm, c.unidade, c.cor, c.tamanho,
         c.saldo, c.k, greatest(c.saldo, 0) - c.k,
         case when c.k > 0 then c.c end,
         (case when c.k > 0 then round(c.k * c.c, 2) else 0 end)::numeric(14,2),
         array_remove(array[
           case when greatest(c.saldo, 0) - c.k > 0 then 'sem_nota' end,
           case when c.hist then 'historico_incompleto' end,
           case when c.ncm is null then 'ncm_ausente' end,
           case when c.saldo < 0 then 'saldo_negativo' end
         ], null)
    from calc c
   order by c.codigo_pai, c.codigo
$$;

revoke all on function public.inventario_calcular(uuid) from public, anon, authenticated;
grant execute on function public.inventario_calcular(uuid) to service_role;
