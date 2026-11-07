-- ADR-0196 — edição do % do atacado por família. `atacado_familias` guarda, por família, a configuração nova e a esperada:
-- [{ familia_id, novo, esperado, status: pendente|aplicado|nao_aplicado, motivo }]. A entrada `pendente` de operação
-- confirmada reserva o produto até `reajuste_atacado_concluir`, mesmo com todos os itens encerrados ou a operação concluída.
alter table public.operacoes_massa add column atacado_familias jsonb;

-- Operação dona da edição pendente no produto, ou null. Rascunho não reserva.
create function public.reajuste_atacado_dona(p_org uuid, p_codigo_pai text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op uuid;
begin
  select o.id into v_op
  from public.operacoes_massa o
  cross join lateral jsonb_array_elements(o.atacado_familias) e
  join public.familias f on f.org_id = p_org and f.id = (e->>'familia_id')::uuid
  where o.org_id = p_org and o.acao = 'reajustar' and o.status <> 'rascunho' and o.atacado_familias is not null
    and e->>'status' = 'pendente' and f.codigo_pai = p_codigo_pai
  limit 1;
  return v_op;
end;
$$;

-- Reserva de reajuste ativa no produto: ml_item_id de um item em andamento ou da operação dona da edição, ou null.
-- `familia_reservar_publicacao` e `familia_reservar_migracao_pxv` chamam esta sob o lock do produto.
create or replace function public.reajuste_ativo_produto(p_org uuid, p_codigo_pai text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ml text;
  v_dona uuid;
begin
  select i.ml_item_id into v_ml
  from public.operacoes_massa_itens i
  join public.operacoes_massa o on o.id = i.operacao_id and o.org_id = p_org and o.acao = 'reajustar'
  where i.org_id = p_org and i.codigo_pai = p_codigo_pai
    and i.status in ('pendente','enviando','conferindo')
  order by i.ml_item_id
  limit 1;
  if v_ml is not null then return v_ml; end if;

  v_dona := public.reajuste_atacado_dona(p_org, p_codigo_pai);
  if v_dona is null then return null; end if;
  select min(i.ml_item_id) into v_ml from public.operacoes_massa_itens i
  where i.org_id = p_org and i.operacao_id = v_dona and i.codigo_pai = p_codigo_pai;
  return coalesce(v_ml, p_codigo_pai);
end;
$$;

-- Claim: a família com edição pendente só aceita a operação dona. Resto igual a 20261107001726.
CREATE OR REPLACE FUNCTION public.reajuste_reivindicar(p_org uuid, p_operacao uuid, p_ml_item text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pai text;
  v_it public.operacoes_massa_itens%rowtype;
  v_origem uuid;
  v_motivo text;
  v_e jsonb;
  v_etapa text;
  v_token uuid;
  v_dona uuid;
begin
  -- Leitura sem lock (a ordem é produto → MLB → item). Retomada (etapa preenchida): o ML já pode ter o preço
  -- novo, então o produto é o codigo_pai gravado no item — o vínculo pode ter sido removido depois (Remover).
  select i.codigo_pai, i.etapa into v_pai, v_etapa from public.operacoes_massa_itens i
  where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item;
  if v_etapa is null or v_pai is null then
    v_pai := public.reajuste_codigo_pai(p_org, p_ml_item);
  end if;
  if v_pai is not null then
    perform public.reajuste_trava_produto(p_org, v_pai);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rm:' || p_org || ':' || p_ml_item, 0));

  select * into v_it from public.operacoes_massa_itens i
  where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item
  for update;
  if not found or not (
       v_it.status = 'pendente'
    or (v_it.status = 'conferindo' and v_it.proxima_conferencia <= now())
    or (v_it.status = 'enviando' and v_it.lease_ate < now())) then
    return 'ocupado';
  end if;

  if v_it.etapa is not null then
    -- A etapa apareceu entre a leitura e o lock: o lock foi tirado com o produto resolvido; tenta de novo.
    if v_it.codigo_pai is not null and v_it.codigo_pai is distinct from v_pai then return 'ocupado'; end if;
  elsif v_pai is null then
    v_motivo := 'Anúncio não encontrado nesta organização';
  else
    -- Recusas só antes da escrita: retomada (etapa preenchida) segue, a escrita já aconteceu.
    v_dona := public.reajuste_atacado_dona(p_org, v_pai);
    if v_dona is not null and v_dona <> p_operacao then
      v_motivo := 'Família com atacado em edição — tente depois';
    elsif exists (select 1 from public.familias f
               where f.org_id = p_org and f.codigo_pai = v_pai and f.status = 'publicando') then
      v_motivo := 'Família em publicação/atualização — tente depois';
    elsif exists (select 1 from public.anuncios_externos a
                  where a.org_id = p_org and a.canal = 'mercado_livre' and a.codigo_pai = v_pai
                    and a.migracao_pxv_status in ('solicitada','em_andamento')) then
      v_motivo := 'Migração para preço por variação em curso';
    elsif exists (select 1 from public.operacoes_massa_itens i
                  join public.operacoes_massa o on o.id = i.operacao_id and o.org_id = p_org
                  where i.org_id = p_org and i.ml_item_id = p_ml_item and o.acao in ('aderir','sair','alterar_preco')
                    and (i.status in ('pendente','enviando','saida_solicitada')
                         or (i.status = 'aplicado' and i.atualizado_em > now() - interval '2 minutes')
                         or (i.etapa = 'escrita_pedida' and i.atualizado_em > now() - interval '30 minutes'))) then
      v_motivo := 'Anúncio em operação de promoção em andamento';
    else
      select o.origem_id into v_origem from public.operacoes_massa o where o.org_id = p_org and o.id = p_operacao;
      if v_origem is not null then
        -- Reverter: o banco de cada cor tem de ser o que a origem gravou.
        for v_e in select * from jsonb_array_elements(coalesce(v_it.estado_anterior, '[]'::jsonb)) loop
          if not exists (
            select 1 from public.variacoes v
            where v.org_id = p_org and v.id = (v_e->>'variacao_id')::uuid
              and v.preco_publicacao is not distinct from (v_e->'esperado'->>'preco_publicacao')::numeric
              and v.preco_editado_pelo_operador is not distinct from (v_e->'esperado'->>'preco_editado_pelo_operador')::boolean) then
            v_motivo := 'Não revertível: o preço mudou depois do reajuste';
            exit;
          end if;
        end loop;
      end if;
    end if;
  end if;

  if v_motivo is not null then
    update public.operacoes_massa_itens i
    set status = case when v_motivo like 'Não revertível%' then 'mudou' else 'bloqueado' end,
        mensagem = v_motivo, atualizado_em = now()
    where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item;
    return v_motivo;
  end if;

  v_token := gen_random_uuid();
  update public.operacoes_massa_itens i
  set status = 'enviando', codigo_pai = coalesce(v_pai, i.codigo_pai), lease_token = v_token,
      lease_ate = now() + interval '2 minutes', atualizado_em = now()
  where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item;
  return 'ok:' || v_token;
end;
$function$;

-- MLBs atuais da família, pela mesma regra de `expandir` em deps.ts: UP = SKUs não retirados; Legacy = a família + partições > 0.
create function public.reajuste_mlbs_familia(p_org uuid, p_familia uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  with f as (
    select x.ml_item_id, x.codigo_pai from public.familias x where x.org_id = p_org and x.id = p_familia
  ), raizes as (
    select a.id, a.particao, a.item_externo_id from public.anuncios_externos a
    join f on f.codigo_pai = a.codigo_pai
    where a.org_id = p_org and a.canal = 'mercado_livre'
  ), up as (
    select i.item_externo_id from public.anuncios_externos_itens i
    join raizes r on r.id = i.anuncio_externo_id
    where i.org_id = p_org and not i.retirado and i.item_externo_id is not null
  )
  select item_externo_id from up
  union
  select f.ml_item_id from f where f.ml_item_id is not null and not exists (select 1 from up)
  union
  select r.item_externo_id from raizes r where r.particao > 0 and r.item_externo_id is not null and not exists (select 1 from up);
$$;

-- Confirmar: família inteira ou nada, e nenhuma operação entra em produto com edição de outra. Resto igual a 20261107001726.
CREATE OR REPLACE FUNCTION public.reajuste_confirmar(p_org uuid, p_operacao uuid, p_confirmacoes jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_op public.operacoes_massa%rowtype;
  v_it record;
  v_c jsonb;
  v_incl boolean;
  v_risco boolean;
  v_sem boolean;
  v_pai text;
  v_algum boolean := false;
  v_familia text;
  v_edicao uuid;
  v_ml text;
begin
  select * into v_op from public.operacoes_massa o
  where o.org_id = p_org and o.id = p_operacao and o.acao = 'reajustar'
  for update;
  if not found then return 'nenhum'; end if;
  if v_op.status = 'executando' then return 'ja_confirmada'; end if;
  if v_op.status <> 'rascunho' then return 'nenhum'; end if;
  if v_op.expira_em < now() then return 'expirado'; end if;

  -- Fase 1: só leitura.
  for v_it in select i.ml_item_id, i.incluido, i.avaliacao, i.passos from public.operacoes_massa_itens i
              where i.org_id = p_org and i.operacao_id = p_operacao and i.status = 'rascunho'
              order by i.ml_item_id loop
    v_c := (select e from jsonb_array_elements(coalesce(p_confirmacoes, '[]'::jsonb)) e
            where e->>'ml_item_id' = v_it.ml_item_id limit 1);
    v_incl := coalesce((v_c->>'incluir')::boolean, v_it.incluido);
    if v_incl then
      if v_it.passos is null then return 'expirado'; end if;
      if coalesce((v_it.avaliacao->>'tem_vermelho')::boolean, false) and not coalesce((v_c->>'risco')::boolean, false)
         or coalesce((v_it.avaliacao->>'tem_sem_dado')::boolean, false) and not coalesce((v_c->>'sem_dado')::boolean, false) then
        return 'confirmacao_faltando:' || v_it.ml_item_id;
      end if;
      v_algum := true;
    end if;
  end loop;
  if not v_algum then return 'nenhum'; end if;

  -- A edição do atacado vale para a família inteira: ou todos os MLBs dela, ou nada.
  select e->>'familia_id' into v_familia
  from jsonb_array_elements(coalesce(v_op.atacado_familias, '[]'::jsonb)) e
  join public.familias f on f.org_id = p_org and f.id = (e->>'familia_id')::uuid
  join public.operacoes_massa_itens i on i.org_id = p_org and i.operacao_id = p_operacao
   and i.codigo_pai = f.codigo_pai and i.status = 'rascunho'
  where not coalesce((select (c->>'incluir')::boolean from jsonb_array_elements(coalesce(p_confirmacoes, '[]'::jsonb)) c
                      where c->>'ml_item_id' = i.ml_item_id limit 1), i.incluido)
  order by 1 limit 1;
  if v_familia is not null then return 'familia_parcial:' || v_familia; end if;

  -- Reserva: produto a produto, em ordem. O índice de reserva só enxerga o mesmo MLB; a edição de atacado vale para o
  -- produto inteiro, inclusive para MLB já encerrado na operação dona.
  for v_it in select x.pai, min(x.ml_item_id) as ml_item_id
              from (select coalesce(i.codigo_pai, public.reajuste_codigo_pai(p_org, i.ml_item_id)) as pai, i.ml_item_id
                    from public.operacoes_massa_itens i
                    where i.org_id = p_org and i.operacao_id = p_operacao and i.status = 'rascunho'
                      and coalesce((select (c->>'incluir')::boolean from jsonb_array_elements(coalesce(p_confirmacoes, '[]'::jsonb)) c
                                    where c->>'ml_item_id' = i.ml_item_id limit 1), i.incluido)) x
              where x.pai is not null
              group by x.pai order by x.pai loop
    perform public.reajuste_trava_produto(p_org, v_it.pai);
    if public.reajuste_atacado_dona(p_org, v_it.pai) is not null then
      return 'ocupado:' || v_it.ml_item_id;
    end if;
    v_edicao := null;
    select f.id into v_edicao from jsonb_array_elements(coalesce(v_op.atacado_familias, '[]'::jsonb)) e
    join public.familias f on f.org_id = p_org and f.id = (e->>'familia_id')::uuid
    where f.codigo_pai = v_it.pai;
    if v_edicao is not null then
      v_ml := public.reajuste_ativo_produto(p_org, v_it.pai);
      if v_ml is not null then return 'ocupado:' || v_ml; end if;
      -- Anúncio publicado depois do preview ficaria com as faixas velhas e a família, com o % novo. O Reverter desfaz só o que
      -- a origem aplicou: gerar de novo não incluiria o anúncio.
      if v_op.origem_id is null and exists (
           select 1 from public.reajuste_mlbs_familia(p_org, v_edicao) m(ml)
           where not exists (select 1 from public.operacoes_massa_itens i
                             where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = m.ml)) then
        return 'expirado';
      end if;
    end if;
  end loop;

  -- Fase 2: escrita.
  for v_it in select i.ml_item_id, i.incluido, i.codigo_pai from public.operacoes_massa_itens i
              where i.org_id = p_org and i.operacao_id = p_operacao and i.status = 'rascunho'
              order by i.ml_item_id loop
    v_c := (select e from jsonb_array_elements(coalesce(p_confirmacoes, '[]'::jsonb)) e
            where e->>'ml_item_id' = v_it.ml_item_id limit 1);
    v_incl := coalesce((v_c->>'incluir')::boolean, v_it.incluido);
    v_risco := coalesce((v_c->>'risco')::boolean, false);
    v_sem := coalesce((v_c->>'sem_dado')::boolean, false);
    if v_incl then
      -- A reserva nasce aqui: sem codigo_pai o item ficaria invisível a reajuste_ativo_produto.
      v_pai := coalesce(v_it.codigo_pai, public.reajuste_codigo_pai(p_org, v_it.ml_item_id));
      if v_pai is null then
        raise exception using errcode = 'P0001', message = 'sem_produto:' || v_it.ml_item_id;
      end if;
      begin
        update public.operacoes_massa_itens i
        set incluido = true, confirmado_risco = v_risco, confirmado_sem_dado = v_sem,
            codigo_pai = v_pai, status = 'pendente', atualizado_em = now()
        where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = v_it.ml_item_id;
      exception when unique_violation then
        raise exception using errcode = 'P0001', message = 'ocupado:' || v_it.ml_item_id;
      end;
    else
      update public.operacoes_massa_itens i
      set incluido = false, status = 'bloqueado', mensagem = 'Desmarcado no preview', atualizado_em = now()
      where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = v_it.ml_item_id;
    end if;
  end loop;

  update public.operacoes_massa o set status = 'executando', expira_em = null
  where o.org_id = p_org and o.id = p_operacao;
  return 'ok';
end;
$function$;

-- Fim da operação: grava `familias.atacado` por compare-and-set só se todos os itens da família terminaram `aplicado` com o
-- passo `faixas` confirmado. Grava em todas as linhas do produto, inclusive as NULL: `esperado` é a configuração do produto
-- (a única não nula entre as linhas), e linha com outro valor reprova. `anteriores` guarda o valor de cada linha; no Reverter
-- ele vem em `restaurar`, para a linha NULL voltar a NULL. `MSG_FAIXAS_PENDENTES` reprova por aí: ela só existe com o passo não confirmado. Senão
-- `nao_aplicado`; as faixas novas ficam nos anúncios que deram certo e o próximo UPDATE volta a seguir a família.
-- Item em andamento mantém a entrada `pendente`. Idempotente. Devolve { pendentes, atacado_familias }.
create function public.reajuste_atacado_concluir(p_org uuid, p_operacao uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.operacoes_massa%rowtype;
  v_pai text;
  v_e jsonb;
  v_novas jsonb := '[]'::jsonb;
  v_pendentes integer := 0;
  v_motivo text;
  v_anteriores jsonb;
begin
  select * into v_op from public.operacoes_massa o
  where o.org_id = p_org and o.id = p_operacao and o.acao = 'reajustar';
  if not found or v_op.status = 'rascunho' or v_op.atacado_familias is null then
    return jsonb_build_object('pendentes', 0, 'atacado_familias', '[]'::jsonb);
  end if;

  -- Produto antes da linha da operação, como em toda transição.
  for v_pai in select distinct f.codigo_pai
               from jsonb_array_elements(v_op.atacado_familias) e
               join public.familias f on f.org_id = p_org and f.id = (e->>'familia_id')::uuid
               where e->>'status' = 'pendente' order by 1 loop
    perform public.reajuste_trava_produto(p_org, v_pai);
  end loop;
  select * into v_op from public.operacoes_massa o where o.org_id = p_org and o.id = p_operacao for update;

  for v_e in select e from jsonb_array_elements(v_op.atacado_familias) with ordinality x(e, n) order by x.n loop
    if v_e->>'status' = 'pendente' then
      select f.codigo_pai into v_pai from public.familias f where f.org_id = p_org and f.id = (v_e->>'familia_id')::uuid;
      if exists (select 1 from public.operacoes_massa_itens i
                 where i.org_id = p_org and i.operacao_id = p_operacao and i.codigo_pai = v_pai
                   and i.status in ('pendente','enviando','conferindo')) then
        v_pendentes := v_pendentes + 1;
      else
        v_motivo := null;
        if not exists (select 1 from public.operacoes_massa_itens i
                       where i.org_id = p_org and i.operacao_id = p_operacao and i.codigo_pai = v_pai)
           or exists (select 1 from public.operacoes_massa_itens i
                      where i.org_id = p_org and i.operacao_id = p_operacao and i.codigo_pai = v_pai
                        and not (i.status = 'aplicado' and exists (
                          select 1 from jsonb_array_elements(coalesce(i.passos, '[]'::jsonb)) p
                          where p->>'tipo' = 'faixas' and p->>'estado' = 'confirmado'))) then
          v_motivo := 'Nem todos os anúncios da família terminaram com o atacado aplicado';
        elsif exists (select 1 from public.variacoes v
                      join public.familias f on f.id = v.familia_id and f.org_id = p_org and f.codigo_pai = v_pai
                      where v.org_id = p_org and v.atacado is not null) then
          v_motivo := 'Atacado por cor: ajuste na Revisão';
        elsif exists (select 1 from public.familias f
                      where f.org_id = p_org and f.codigo_pai = v_pai and f.atacado is not null
                        and f.atacado is distinct from v_e->'esperado')
           -- Todas NULL com `esperado` não nulo: a Revisão desligou o atacado no meio da operação.
           or (v_e->'esperado' <> 'null'::jsonb and not exists (
                 select 1 from public.familias f
                 where f.org_id = p_org and f.codigo_pai = v_pai and f.atacado = v_e->'esperado')) then
          v_motivo := 'A configuração de atacado da família mudou durante a operação';
        end if;

        if v_motivo is null then
          select jsonb_agg(jsonb_build_object('id', f.id, 'atacado', f.atacado) order by f.id) into v_anteriores
          from public.familias f where f.org_id = p_org and f.codigo_pai = v_pai;
          -- Linha fora de `restaurar` (lote novo) recebe `novo`.
          update public.familias f
          set atacado = nullif(coalesce((select a->'atacado' from jsonb_array_elements(v_e->'restaurar') a where a->>'id' = f.id::text), v_e->'novo'), 'null'::jsonb)
          where f.org_id = p_org and f.codigo_pai = v_pai;
          v_e := v_e || jsonb_build_object('status', 'aplicado', 'anteriores', v_anteriores);
        else
          v_e := v_e || jsonb_build_object('status', 'nao_aplicado', 'motivo', v_motivo);
        end if;
      end if;
    end if;
    v_novas := v_novas || jsonb_build_array(v_e);
  end loop;

  update public.operacoes_massa o set atacado_familias = v_novas where o.org_id = p_org and o.id = p_operacao;
  return jsonb_build_object('pendentes', v_pendentes, 'atacado_familias', v_novas);
end;
$$;

-- `p_recusada`: a escrita de volta foi recusada de forma definitiva. Só isso conta em `recusas_volta`; o executor desiste no
-- limite. Volta incerta não conta: nada prova que o ML recusou. Resto igual a 20261107020152.
drop function public.reajuste_passo_marcar(uuid, uuid, text, uuid, integer, text);
create function public.reajuste_passo_marcar(p_org uuid, p_operacao uuid, p_ml_item text, p_token uuid,
                                             p_indice integer, p_estado text, p_recusada boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_it public.operacoes_massa_itens%rowtype;
begin
  select * into v_it from public.operacoes_massa_itens i
  where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item
  for update;
  if not found or v_it.status <> 'enviando' or not coalesce(v_it.lease_token = p_token, false) then
    return false;
  end if;

  -- `null not in (...)` é null e passaria; to_jsonb(null) faria o jsonb_set apagar `passos`.
  if p_estado is null or p_estado not in ('pendente','escrita_pedida','confirmado','volta_pendente','volta_pedida','compensado') then
    raise exception 'reajuste_passo_marcar: estado desconhecido: %', p_estado;
  end if;
  if p_indice is null or p_indice < 0 or p_indice >= coalesce(jsonb_array_length(v_it.passos), 0) then
    raise exception 'reajuste_passo_marcar: passo % não existe em %', p_indice, p_ml_item;
  end if;
  -- Item com passo em estado de volta nunca retoma a ida.
  if p_estado in ('pendente','escrita_pedida','confirmado') and exists (
       select 1 from jsonb_array_elements(v_it.passos) p
       where p->>'estado' in ('volta_pendente','volta_pedida','compensado')) then
    raise exception 'reajuste_passo_marcar: % em compensação não retoma a ida', p_ml_item;
  end if;

  update public.operacoes_massa_itens i
  set passos = jsonb_set(
        case when p_estado = 'escrita_pedida'
             then jsonb_set(i.passos, array[p_indice::text, 'tentativas'],
                            to_jsonb(coalesce((i.passos->p_indice->>'tentativas')::integer, 0) + 1))
             when p_recusada
             then jsonb_set(i.passos, array[p_indice::text, 'recusas_volta'],
                            to_jsonb(coalesce((i.passos->p_indice->>'recusas_volta')::integer, 0) + 1))
             else i.passos end,
        array[p_indice::text, 'estado'], to_jsonb(p_estado)),
      etapa = case when p_estado in ('escrita_pedida','volta_pedida') then 'escrita_pedida' else i.etapa end,
      lease_ate = now() + interval '2 minutes', atualizado_em = now()
  where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item;
  return true;
end;
$$;

revoke execute on function public.reajuste_passo_marcar(uuid, uuid, text, uuid, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.reajuste_passo_marcar(uuid, uuid, text, uuid, integer, text, boolean) to service_role;
revoke execute on function public.reajuste_mlbs_familia(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reajuste_mlbs_familia(uuid, uuid) to service_role;
revoke execute on function public.reajuste_atacado_dona(uuid, text) from public, anon, authenticated;
revoke execute on function public.reajuste_atacado_concluir(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reajuste_atacado_dona(uuid, text) to service_role;
grant execute on function public.reajuste_atacado_concluir(uuid, uuid) to service_role;
