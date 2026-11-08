-- ADR-0199 (Task 9): inventário (ADR-0181) em peças com kit com variação. Corpo de
-- 20261016233218 (inventario_calcular) mais o kit; assinatura e retorno iguais (a foto grava as colunas).
--
-- Invariante 2: o total de um componente C é individual + Σ (saldo do kit K × peças de C em K) + trânsito.
-- - SKU de kit não vira linha: a unidade dele é kit, e as peças já contam nos componentes.
-- - `kit_saida`/`kit_entrada` (montar, repor, desmontar, cancelar transferência) não mudam esse total: no
--   replay viram passo neutro (res = ant), então quantidade valorizada, custo e nota atravessam intactos.
-- - Venda, estorno e ajuste do kit mudam o total de C em delta × composição, como venda/estorno de peça.
-- Cada passo do grupo de C (movimentos de C e dos kits que o contêm, na `ordem` global) recebe ant/res em
-- peças: nível do grupo antes do passo (soma acumulada por janela) trocando o nível do membro pelo `ant`
-- dele, + o próprio movimento × peso. Lacuna em qualquer membro aparece como ant ≠ res anterior, igual a
-- hoje. Marco e corte são os de C.
-- SKU fora de qualquer composição passa pelo ramo original, sem nenhum termo novo: resultado idêntico.
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
  -- ADR-0199: componente C → membros do grupo (o próprio C com peso 1 e cada SKU de kit com C, com o
  -- número de peças de C por kit). Org sem kit: vazio.
  grupo as (
    select c.codigo as alvo, s.codigo as membro, c.quantidade as w
      from public.kit_variacao_componentes c
      join public.kit_variacao_skus s on s.id = c.kit_sku_id and s.org_id = c.org_id
     where c.org_id = p_org
    union all
    select distinct c.codigo, c.codigo, 1
      from public.kit_variacao_componentes c where c.org_id = p_org
  ),
  -- Saldo de hoje de cada membro na variação canônica (mesma âncora de kit_sku_travado).
  saldo_membro as (
    select distinct on (v.codigo) v.codigo, v.estoque
      from public.variacoes v join public.familias f on f.id = v.familia_id
     where v.org_id = p_org and v.codigo in (select g.membro from grupo g)
     order by v.codigo, f.criado_em desc
  ),
  -- Peças de C fora do individual hoje: dentro de kits + em trânsito (o que transferência tirou de um lado
  -- e ainda não pôs no outro = −Σ dos movimentos kit_* do grupo, com peso).
  fora as (
    select g.alvo,
           coalesce(sum(g.w * sm.estoque) filter (where g.membro <> g.alvo), 0)
           - coalesce(sum((select sum(m.quantidade) from public.estoque_movimentos m
                            where m.org_id = p_org and m.codigo = g.membro
                              and m.motivo in ('kit_saida', 'kit_entrada')) * g.w), 0) as pecas
      from grupo g left join saldo_membro sm on sm.codigo = g.membro
     group by g.alvo
  ),
  sku as (
    select v.codigo, c.codigo_pai, c.descricao, c.ncm, c.unidade, v.cor, v.tamanho,
           v.estoque + coalesce(fo.pecas, 0)::int as saldo
      from canonica c join public.variacoes v on v.familia_id = c.id
      left join fora fo on fo.alvo = v.codigo
     where not exists (select 1 from public.kit_variacao_skus ks where ks.org_id = p_org and ks.codigo = v.codigo)
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
  -- Movimentos do grupo de cada componente. prev_res = nível do membro antes do passo (resultante do
  -- movimento anterior dele; no primeiro, o próprio anterior). Lacuna = ant ≠ prev_res.
  gmov as (
    select g.alvo, g.w, m.codigo as membro, m.ordem, m.id, m.referencia_externa as ref, m.motivo, m.criado_em,
           m.estoque_anterior as ant, m.estoque_resultante as res,
           coalesce(lag(m.estoque_resultante) over (partition by g.alvo, g.membro order by m.ordem, m.id),
                    m.estoque_anterior) as prev_res,
           m.motivo in ('kit_saida', 'kit_entrada') as transf
      from grupo g
      join public.estoque_movimentos m on m.org_id = p_org and m.codigo = g.membro
     where g.alvo in (select s.codigo from sku s)
       and m.estoque_anterior is not null and m.estoque_resultante is not null
  ),
  -- Nível em peças do grupo antes do primeiro passo: anterior do 1º movimento de cada membro, ou o saldo
  -- de hoje de membro sem movimento.
  g0 as (
    select g.alvo, sum(g.w * coalesce(i.ant, sm.estoque, 0)) as nivel
      from grupo g
      left join (select distinct on (x.alvo, x.membro) x.alvo, x.membro, x.ant
                   from gmov x order by x.alvo, x.membro, x.ordem, x.id) i
             on i.alvo = g.alvo and i.membro = g.membro
      left join saldo_membro sm on sm.codigo = g.membro
     group by g.alvo
  ),
  -- Variação do nível do grupo em cada passo: o membro sai de prev_res para res; transferência devolve o
  -- próprio delta ao trânsito (neutra). Acumulada por `ordem` numa janela só: linear no histórico.
  gnivel as (
    select x.*, g0.nivel + coalesce(sum(x.w * (x.res - x.prev_res)
                                        - case when x.transf then x.w * (x.res - x.ant) else 0 end)
                                      over (partition by x.alvo order by x.ordem, x.id
                                            rows between unbounded preceding and 1 preceding), 0) as antes_do_passo
      from gmov x join g0 on g0.alvo = x.alvo
  ),
  gpassos as (
    select gn.alvo, gn.ordem, gn.id, gn.ref,
           (gn.antes_do_passo - gn.w * gn.prev_res + gn.w * gn.ant)::int as ant,
           (gn.antes_do_passo - gn.w * gn.prev_res + gn.w * gn.ant
              + case when gn.transf then 0 else gn.w * (gn.res - gn.ant) end)::int as res,
           nt.q, nt.u,
           coalesce(gn.criado_em <= mc.marco, false) or coalesce(gn.ordem <= cb.ate_ordem, false) as antes
      from gnivel gn
      left join nota nt on nt.ref = gn.ref and nt.codigo = gn.membro and gn.motivo = 'entrada'
      left join marco mc on mc.codigo = gn.alvo
      left join public.inventario_corte_backfill cb on cb.org_id = p_org and cb.codigo = gn.alvo
  ),
  mov as (
    -- SKU comum: corpo de 20261016233218 sem mudança.
    select m.codigo, m.ordem, m.id, m.referencia_externa as ref, m.estoque_anterior as ant,
           m.estoque_resultante as res, nt.q, nt.u,
           coalesce(m.criado_em <= mc.marco, false) or coalesce(m.ordem <= cb.ate_ordem, false) as antes
      from public.estoque_movimentos m
      left join nota nt on nt.ref = m.referencia_externa and nt.codigo = m.codigo and m.motivo = 'entrada'
      left join marco mc on mc.codigo = m.codigo
      left join public.inventario_corte_backfill cb on cb.org_id = m.org_id and cb.codigo = m.codigo
     where m.org_id = p_org and m.codigo in (select s.codigo from sku s)
       and m.codigo not in (select g.alvo from grupo g)
       and m.estoque_anterior is not null and m.estoque_resultante is not null
    union all
    -- Componente de kit: passos do grupo em peças (gpassos).
    select gp.alvo, gp.ordem, gp.id, gp.ref, gp.ant, gp.res, gp.q, gp.u, gp.antes
      from gpassos gp
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
