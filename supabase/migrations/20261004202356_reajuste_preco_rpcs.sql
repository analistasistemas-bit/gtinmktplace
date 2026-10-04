-- ADR-0178 — reajuste de preço em massa: RPCs de reserva (C2), confirmação (C1/C5) e persistência (C3).
-- Identidade de serialização = (org_id, codigo_pai). Ordem de locks: produto → MLB.
-- Todas as funções são VOLATILE de propósito: cada comando depois do advisory lock tira um snapshot
-- novo (READ COMMITTED) e enxerga o que a outra sessão gravou antes de soltar o lock.

-- Produto do MLB: Legacy (familias.ml_item_id), partição (anuncios_externos.item_externo_id) ou UP
-- (anuncios_externos_itens.item_externo_id → raiz). null = não achou nesta org.
create function public.reajuste_codigo_pai(p_org uuid, p_ml_item text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pai text;
begin
  select f.codigo_pai into v_pai from public.familias f
  where f.org_id = p_org and f.ml_item_id = p_ml_item
  order by f.criado_em desc limit 1;
  if v_pai is not null then return v_pai; end if;

  select a.codigo_pai into v_pai from public.anuncios_externos a
  where a.org_id = p_org and a.item_externo_id = p_ml_item
  limit 1;
  if v_pai is not null then return v_pai; end if;

  select a.codigo_pai into v_pai
  from public.anuncios_externos_itens i
  join public.anuncios_externos a on a.id = i.anuncio_externo_id and a.org_id = p_org
  where i.org_id = p_org and i.item_externo_id = p_ml_item
  limit 1;
  return v_pai;
end;
$$;

-- Reserva de reajuste ativa no produto: ml_item_id de um item `reajustar` em andamento, ou null.
create function public.reajuste_ativo_produto(p_org uuid, p_codigo_pai text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ml text;
begin
  select i.ml_item_id into v_ml
  from public.operacoes_massa_itens i
  join public.operacoes_massa o on o.id = i.operacao_id and o.org_id = p_org and o.acao = 'reajustar'
  where i.org_id = p_org and i.codigo_pai = p_codigo_pai
    and i.status in ('pendente','enviando','conferindo')
  order by i.ml_item_id
  limit 1;
  return v_ml;
end;
$$;

-- Lock do produto: advisory + TODAS as famílias do codigo_pai (uma família criada depois do preview
-- também entra). Sempre antes do lock do MLB.
create function public.reajuste_trava_produto(p_org uuid, p_codigo_pai text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('rp:' || p_org || ':' || p_codigo_pai, 0));
  perform 1 from public.familias f where f.org_id = p_org and f.codigo_pai = p_codigo_pai for update;
end;
$$;

-- Claim do item de reajuste (C2/C3). 'ok' | 'ocupado' | motivo da recusa (já gravada no item).
create function public.reajuste_reivindicar(p_org uuid, p_operacao uuid, p_ml_item text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pai text;
  v_it public.operacoes_massa_itens%rowtype;
  v_origem uuid;
  v_motivo text;
  v_e jsonb;
  v_etapa text;
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
    or (v_it.status = 'enviando' and v_it.atualizado_em < now() - interval '2 minutes')) then
    return 'ocupado';
  end if;

  if v_it.etapa is not null then
    -- A etapa apareceu entre a leitura e o lock: o lock foi tirado com o produto resolvido; tenta de novo.
    if v_it.codigo_pai is not null and v_it.codigo_pai is distinct from v_pai then return 'ocupado'; end if;
  elsif v_pai is null then
    v_motivo := 'Anúncio não encontrado nesta organização';
  else
    -- Recusas só antes da escrita: retomada (etapa preenchida) segue, a escrita já aconteceu.
    if exists (select 1 from public.familias f
               where f.org_id = p_org and f.codigo_pai = v_pai and f.status = 'publicando') then
      v_motivo := 'Família em publicação/atualização — tente depois';
    elsif exists (select 1 from public.anuncios_externos a
                  where a.org_id = p_org and a.canal = 'mercado_livre' and a.codigo_pai = v_pai
                    and a.migracao_pxv_status in ('solicitada','em_andamento')) then
      v_motivo := 'Migração para preço por variação em curso';
    elsif exists (select 1 from public.operacoes_massa_itens i
                  join public.operacoes_massa o on o.id = i.operacao_id and o.org_id = p_org
                  where i.org_id = p_org and i.ml_item_id = p_ml_item and o.acao in ('aderir','sair')
                    and i.status in ('pendente','enviando','saida_solicitada')) then
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

  update public.operacoes_massa_itens i
  set status = 'enviando', codigo_pai = coalesce(v_pai, i.codigo_pai), atualizado_em = now()
  where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item;
  return 'ok';
end;
$$;

-- Cores do MLB → variações do banco. Legacy: por ml_variation_id entre TODAS as famílias do produto
-- (a de maior publicado_em vence). Sem ids: UP (anuncios_externos_itens) ou plano (exatamente 1
-- variação publicada na família canônica do MLB). variacao_id null = sem casamento.
create function public.reajuste_variacoes_do_mlb(p_org uuid, p_codigo_pai text, p_ml_item text, p_ml_variation_ids text[])
returns table(ml_variation_id text, variacao_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_var uuid;
  v_sku text;
  v_familia uuid;
  v_achou boolean := false;
begin
  if coalesce(cardinality(p_ml_variation_ids), 0) > 0 then
    return query
    select x.id, (
      select v.id from public.variacoes v
      join public.familias f on f.id = v.familia_id and f.org_id = p_org and f.codigo_pai = p_codigo_pai
      where v.org_id = p_org and v.ml_variation_id = x.id
      order by f.publicado_em desc nulls last, f.criado_em desc, v.id
      limit 1)
    from unnest(p_ml_variation_ids) with ordinality as x(id, n)
    order by x.n;
    return;
  end if;

  -- UP: o item técnico é a cor.
  select i.variacao_id, i.sku, true into v_var, v_sku, v_achou
  from public.anuncios_externos_itens i
  join public.anuncios_externos a on a.id = i.anuncio_externo_id and a.org_id = p_org and a.codigo_pai = p_codigo_pai
  where i.org_id = p_org and i.item_externo_id = p_ml_item;
  if v_achou then
    if v_var is null then
      select v.id into v_var from public.variacoes v
      join public.familias f on f.id = v.familia_id and f.org_id = p_org and f.codigo_pai = p_codigo_pai
      where v.org_id = p_org and v.codigo = v_sku
      order by f.publicado_em desc nulls last, f.criado_em desc
      limit 1;
    end if;
    return query select null::text, v_var;
    return;
  end if;

  -- Plano: família canônica do MLB com exatamente 1 variação publicada.
  select f.id into v_familia from public.familias f
  where f.org_id = p_org and f.codigo_pai = p_codigo_pai and f.ml_item_id = p_ml_item
  order by f.publicado_em desc nulls last, f.criado_em desc
  limit 1;
  select case when count(*) = 1 then min(v.id::text)::uuid end into v_var
  from public.variacoes v
  where v.org_id = p_org and v.familia_id = v_familia and not coalesce(v.excluida_da_publicacao, false);
  return query select null::text, v_var;
end;
$$;

-- Executar o rascunho (C1/C5). Fase 1 só lê; fase 2 grava em ordem de ml_item_id (sem deadlock entre
-- rascunhos sobrepostos). Colisão no índice de reserva → P0001 'ocupado:<ml>' e tudo é desfeito.
create function public.reajuste_confirmar(p_org uuid, p_operacao uuid, p_confirmacoes jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.operacoes_massa%rowtype;
  v_it record;
  v_c jsonb;
  v_incl boolean;
  v_risco boolean;
  v_sem boolean;
  v_pai text;
  v_algum boolean := false;
begin
  select * into v_op from public.operacoes_massa o
  where o.org_id = p_org and o.id = p_operacao and o.acao = 'reajustar'
  for update;
  if not found then return 'nenhum'; end if;
  if v_op.status = 'executando' then return 'ja_confirmada'; end if;
  if v_op.status <> 'rascunho' then return 'nenhum'; end if;
  if v_op.expira_em < now() then return 'expirado'; end if;

  -- Fase 1: só leitura.
  for v_it in select i.ml_item_id, i.incluido, i.avaliacao from public.operacoes_massa_itens i
              where i.org_id = p_org and i.operacao_id = p_operacao and i.status = 'rascunho'
              order by i.ml_item_id loop
    v_c := (select e from jsonb_array_elements(coalesce(p_confirmacoes, '[]'::jsonb)) e
            where e->>'ml_item_id' = v_it.ml_item_id limit 1);
    v_incl := coalesce((v_c->>'incluir')::boolean, v_it.incluido);
    if v_incl then
      if coalesce((v_it.avaliacao->>'tem_vermelho')::boolean, false) and not coalesce((v_c->>'risco')::boolean, false)
         or coalesce((v_it.avaliacao->>'tem_sem_dado')::boolean, false) and not coalesce((v_c->>'sem_dado')::boolean, false) then
        return 'confirmacao_faltando:' || v_it.ml_item_id;
      end if;
      v_algum := true;
    end if;
  end loop;
  if not v_algum then return 'nenhum'; end if;

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
$$;

-- Persistência atômica (C3): confere o esperado de TODAS as cores do item e só então grava as
-- variações e o item `aplicado`. Qualquer divergência → nenhuma cor alterada, item `erro`.
create function public.reajuste_persistir(p_org uuid, p_operacao uuid, p_ml_item text,
                                          p_preco_confirmado numeric, p_restaurar jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_it public.operacoes_massa_itens%rowtype;
  v_pai text;
  v_e jsonb;
  v_pub numeric;
  v_edit boolean;
  v_ids uuid[];
  v_conflito text;
begin
  select i.codigo_pai into v_pai from public.operacoes_massa_itens i
  where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item;
  if not found then raise exception 'item de reajuste não encontrado: %', p_ml_item; end if;
  if v_pai is not null then
    perform public.reajuste_trava_produto(p_org, v_pai);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rm:' || p_org || ':' || p_ml_item, 0));

  select * into v_it from public.operacoes_massa_itens i
  where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item
  for update;
  if v_it.status = 'aplicado' then return 'ja_aplicado'; end if;
  -- Só persiste quem detém a reserva; repetir depois de `erro`/`mudou` não pode gravar.
  if v_it.status not in ('enviando','conferindo') then return 'estado_invalido'; end if;

  -- Completude: conjunto de variacao_id de p_restaurar = item.variacao_ids, sem duplicata, não vazio.
  if jsonb_typeof(p_restaurar) = 'array' then
    select array_agg((e->>'variacao_id')::uuid) into v_ids from jsonb_array_elements(p_restaurar) e;
  end if;
  if coalesce(cardinality(v_ids), 0) = 0
     or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x)
     or not (v_ids @> coalesce(v_it.variacao_ids, '{}') and v_ids <@ coalesce(v_it.variacao_ids, '{}')) then
    v_conflito := 'Conjunto de variações do anúncio não confere com o preview — nada foi gravado no banco';
  else
    -- Fase 1: só leitura (com lock das linhas, em ordem de id).
    for v_e in select e from jsonb_array_elements(p_restaurar) e order by (e->>'variacao_id')::uuid loop
      select v.preco_publicacao, v.preco_editado_pelo_operador into v_pub, v_edit
      from public.variacoes v
      where v.org_id = p_org and v.id = (v_e->>'variacao_id')::uuid
      for update;
      if not found
         or v_pub is distinct from (v_e->'esperado'->>'preco_publicacao')::numeric
         or v_edit is distinct from (v_e->'esperado'->>'preco_editado_pelo_operador')::boolean then
        v_conflito := 'Conflito: o preço de uma cor foi alterado por outro fluxo durante o reajuste — ML ficou com o preço novo; o próximo UPDATE publicará o valor do banco';
        exit;
      end if;
    end loop;
  end if;

  if v_conflito is not null then
    update public.operacoes_massa_itens i
    set status = 'erro', etapa = null, atualizado_em = now(), mensagem = v_conflito
    where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item;
    return 'conflito';
  end if;

  -- Fase 2: escrita.
  for v_e in select e from jsonb_array_elements(p_restaurar) e loop
    update public.variacoes v
    set preco_publicacao = (v_e->'novo'->>'preco_publicacao')::numeric,
        preco_editado_pelo_operador = (v_e->'novo'->>'preco_editado_pelo_operador')::boolean,
        preco_publicado_ml = p_preco_confirmado
    where v.org_id = p_org and v.id = (v_e->>'variacao_id')::uuid;
  end loop;
  update public.operacoes_massa_itens i
  set status = 'aplicado', etapa = null, mensagem = null, atualizado_em = now()
  where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item;
  return 'ok';
end;
$$;

-- Claim de `publicando` (substitui o update direto de publicar-familias, CREATE e UPDATE), sob o lock
-- do produto. Família com reajuste ativo no produto volta com motivo e não é alterada.
create function public.familia_reservar_publicacao(p_org uuid, p_familia_ids uuid[], p_operacao text)
returns table(id uuid, lote_id uuid, user_id uuid, codigo_pai text, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_pai text;
  v_f record;
  v_ml text;
begin
  for v_pai in select distinct f.codigo_pai from public.familias f
               where f.org_id = p_org and f.id = any(p_familia_ids) order by 1 loop
    perform public.reajuste_trava_produto(p_org, v_pai);
  end loop;

  for v_f in select f.id, f.lote_id, f.user_id, f.codigo_pai from public.familias f
             where f.org_id = p_org and f.id = any(p_familia_ids)
               and f.operacao = p_operacao::public.operacao_ml
               and f.status in ('pronto','erro')
               and (case when p_operacao = 'CREATE' then f.ml_item_id is null else f.ml_item_id is not null end)
             order by f.codigo_pai, f.id loop
    v_ml := public.reajuste_ativo_produto(p_org, v_f.codigo_pai);
    if v_ml is not null then
      return query select v_f.id, v_f.lote_id, v_f.user_id, v_f.codigo_pai,
        'Há reajuste de preço em massa em andamento no anúncio ' || v_ml;
    else
      update public.familias f set status = 'publicando', erro_mensagem = null
      where f.org_id = p_org and f.id = v_f.id;
      return query select v_f.id, v_f.lote_id, v_f.user_id, v_f.codigo_pai, null::text;
    end if;
  end loop;
end;
$$;

-- Entrada na migração PxV (substitui o update direto de migrar-preco-por-variacao). p_campos = o mesmo
-- objeto que a edge grava hoje, chave a chave.
create function public.familia_reservar_migracao_pxv(p_org uuid, p_codigo_pai text, p_campos jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ml text;
begin
  -- Sem isto um p_campos sem status gravaria null e devolveria 'ok' (o `is null` deixaria de ser trava).
  if p_campos->>'migracao_pxv_status' is distinct from 'solicitada' then
    raise exception 'familia_reservar_migracao_pxv: migracao_pxv_status tem de ser solicitada';
  end if;
  perform public.reajuste_trava_produto(p_org, p_codigo_pai);
  v_ml := public.reajuste_ativo_produto(p_org, p_codigo_pai);
  if v_ml is not null then
    return 'Há reajuste de preço em massa em andamento no anúncio ' || v_ml;
  end if;

  update public.anuncios_externos a
  set migracao_pxv_status        = p_campos->>'migracao_pxv_status',
      migracao_pxv_solicitada_em = (p_campos->>'migracao_pxv_solicitada_em')::timestamptz,
      migracao_pxv_snapshot      = p_campos->'migracao_pxv_snapshot',
      migracao_pxv_erro          = p_campos->>'migracao_pxv_erro',
      migracao_pxv_tentativa     = (p_campos->>'migracao_pxv_tentativa')::integer,
      ml_item_id_anterior        = p_campos->>'ml_item_id_anterior'
  where a.org_id = p_org and a.canal = 'mercado_livre' and a.codigo_pai = p_codigo_pai
    and a.particao = 0 and a.migracao_pxv_status is null;
  if not found then return 'Migração já solicitada'; end if;
  return 'ok';
end;
$$;

-- Claim genérico do motor (era language sql, sem definer). `aderir` ganha o lock do MLB e a barreira
-- do reajuste; as demais ações mantêm o corpo anterior.
create or replace function public.operacoes_massa_reivindicar(p_org uuid, p_operacao uuid, p_ml_item text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acao text;
  v_it public.operacoes_massa_itens%rowtype;
begin
  select o.acao into v_acao from public.operacoes_massa o where o.org_id = p_org and o.id = p_operacao;

  if v_acao = 'aderir' then
    perform pg_advisory_xact_lock(hashtextextended('rm:' || p_org || ':' || p_ml_item, 0));
    select * into v_it from public.operacoes_massa_itens i
    where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item
    for update;
    if not found or not (v_it.status = 'pendente'
                         or (v_it.status = 'enviando' and v_it.atualizado_em < now() - interval '2 minutes')) then
      return false;
    end if;
    if exists (select 1 from public.operacoes_massa_itens i
               join public.operacoes_massa o on o.id = i.operacao_id and o.org_id = p_org and o.acao = 'reajustar'
               where i.org_id = p_org and i.ml_item_id = p_ml_item
                 and i.status in ('pendente','enviando','conferindo')) then
      update public.operacoes_massa_itens i
      set status = 'mudou', mensagem = 'Reajuste de preço em andamento neste anúncio', atualizado_em = now()
      where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item;
      return false;
    end if;
  end if;

  update public.operacoes_massa_itens set status = 'enviando', atualizado_em = now()
  where org_id = p_org and operacao_id = p_operacao and ml_item_id = p_ml_item
    and (status = 'pendente' or (status = 'enviando' and atualizado_em < now() - interval '2 minutes'));
  return found;
end;
$$;

revoke execute on function public.reajuste_codigo_pai(uuid, text) from public, anon, authenticated;
revoke execute on function public.reajuste_ativo_produto(uuid, text) from public, anon, authenticated;
revoke execute on function public.reajuste_trava_produto(uuid, text) from public, anon, authenticated;
revoke execute on function public.reajuste_reivindicar(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.reajuste_variacoes_do_mlb(uuid, text, text, text[]) from public, anon, authenticated;
revoke execute on function public.reajuste_confirmar(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.reajuste_persistir(uuid, uuid, text, numeric, jsonb) from public, anon, authenticated;
revoke execute on function public.familia_reservar_publicacao(uuid, uuid[], text) from public, anon, authenticated;
revoke execute on function public.familia_reservar_migracao_pxv(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.operacoes_massa_reivindicar(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reajuste_codigo_pai(uuid, text) to service_role;
grant execute on function public.reajuste_ativo_produto(uuid, text) to service_role;
grant execute on function public.reajuste_trava_produto(uuid, text) to service_role;
grant execute on function public.reajuste_reivindicar(uuid, uuid, text) to service_role;
grant execute on function public.reajuste_variacoes_do_mlb(uuid, text, text, text[]) to service_role;
grant execute on function public.reajuste_confirmar(uuid, uuid, jsonb) to service_role;
grant execute on function public.reajuste_persistir(uuid, uuid, text, numeric, jsonb) to service_role;
grant execute on function public.familia_reservar_publicacao(uuid, uuid[], text) to service_role;
grant execute on function public.familia_reservar_migracao_pxv(uuid, text, jsonb) to service_role;
grant execute on function public.operacoes_massa_reivindicar(uuid, uuid, text) to service_role;
