-- ADR-0196 — reajuste por passos duráveis: colunas do item, posse por token e barreiras com promoção.
-- Posse: o claim gera `lease_token` e o lease dura 2 min, renovado a cada transição. Sem o token, nada grava: a
-- transição devolve false (`sem_posse` no persistir) e o worker para. Lease vencido sem novo claim mantém a posse,
-- porque o token só muda sob o lock do item.

alter table public.operacoes_massa_itens
  add column passos jsonb,
  add column lease_token uuid,
  add column lease_ate timestamptz,
  add column avaliacoes jsonb;

-- Claim: 'ok:<token>' | 'ocupado' | motivo da recusa (já gravada no item).
-- A barreira com promoção vale também para o que acabou de sair dela: `aplicado` há até 2 min (a visão do ML atrasa) e
-- `escrita_pedida` há até 30 min (a escrita pode ter ocorrido, em qualquer status).
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
    if exists (select 1 from public.familias f
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

-- Aderir, sair e alterar_preco não reivindicam anúncio com reajuste em andamento (mesma barreira).
CREATE OR REPLACE FUNCTION public.operacoes_massa_reivindicar(p_org uuid, p_operacao uuid, p_ml_item text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_acao text;
  v_it public.operacoes_massa_itens%rowtype;
begin
  select o.acao into v_acao from public.operacoes_massa o where o.org_id = p_org and o.id = p_operacao;

  if v_acao in ('aderir','sair','alterar_preco') then
    perform pg_advisory_xact_lock(hashtextextended('rm:' || p_org || ':' || p_ml_item, 0));
    select * into v_it from public.operacoes_massa_itens i
    where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item
    for update;
    if not found or not (v_it.status = 'pendente'
                         or (v_it.status = 'enviando' and v_it.atualizado_em < now() - interval '2 minutes')) then
      return false;
    end if;
    -- Só `pendente`: `enviando` parado pode já ter escrito no ML sem etapa. Virar `mudou` soltaria a reserva antes da
    -- reconciliação. Ele só convive com reajuste `pendente`, que segue barrado por este item.
    if v_it.status = 'pendente' and exists (select 1 from public.operacoes_massa_itens i
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
$function$;

-- Mudança de estado de um passo. false = o worker perdeu a posse e para sem escrever mais nada.
create function public.reajuste_passo_marcar(p_org uuid, p_operacao uuid, p_ml_item text, p_token uuid,
                                             p_indice integer, p_estado text)
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
  set passos = jsonb_set(i.passos, array[p_indice::text, 'estado'], to_jsonb(p_estado)),
      etapa = case when p_estado in ('escrita_pedida','volta_pedida') then 'escrita_pedida' else i.etapa end,
      lease_ate = now() + interval '2 minutes', atualizado_em = now()
  where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item;
  return true;
end;
$$;

-- Substitui gravarItem e agendarConferenciaItem no reajuste: grava só as chaves enviadas (null explícito limpa).
-- Passos mudam só por reajuste_passo_marcar.
create function public.reajuste_item_gravar(p_org uuid, p_operacao uuid, p_ml_item text, p_token uuid, p_campos jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from jsonb_object_keys(p_campos) k
             where k not in ('status','mensagem','etapa','conferencias','proxima_conferencia')) then
    raise exception 'reajuste_item_gravar: campo não permitido em %', p_campos;
  end if;

  update public.operacoes_massa_itens i
  set status = case when p_campos ? 'status' then p_campos->>'status' else i.status end,
      mensagem = case when p_campos ? 'mensagem' then p_campos->>'mensagem' else i.mensagem end,
      etapa = case when p_campos ? 'etapa' then p_campos->>'etapa' else i.etapa end,
      conferencias = case when p_campos ? 'conferencias' then (p_campos->>'conferencias')::integer else i.conferencias end,
      proxima_conferencia = case when p_campos ? 'proxima_conferencia'
                                 then (p_campos->>'proxima_conferencia')::timestamptz else i.proxima_conferencia end,
      lease_ate = now() + interval '2 minutes', atualizado_em = now()
  where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item
    and i.status = 'enviando' and i.lease_token = p_token;
  return found;
end;
$$;

-- Executar o rascunho (C1/C5). Fase 1 só lê; fase 2 grava em ordem de ml_item_id (sem deadlock entre
-- rascunhos sobrepostos). Colisão no índice de reserva → P0001 'ocupado:<ml>' e tudo é desfeito.
-- Item incluído sem `passos` é preview anterior ao ADR-0196: `expirado` obriga a refazer.
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

-- Persistência atômica (C3): confere o esperado de TODAS as cores do item e só então grava as
-- variações e o item `aplicado`. Qualquer divergência → nenhuma cor alterada, item `erro`.
-- `sem_posse` = token diferente do item: nada foi gravado. O token fica no item: repetir devolve `ja_aplicado`.
drop function public.reajuste_persistir(uuid, uuid, text, numeric, jsonb);
create function public.reajuste_persistir(p_org uuid, p_operacao uuid, p_ml_item text, p_token uuid,
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
  if not coalesce(v_it.lease_token = p_token, false) then return 'sem_posse'; end if;
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

revoke execute on function public.reajuste_passo_marcar(uuid, uuid, text, uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.reajuste_item_gravar(uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.reajuste_persistir(uuid, uuid, text, uuid, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.reajuste_passo_marcar(uuid, uuid, text, uuid, integer, text) to service_role;
grant execute on function public.reajuste_item_gravar(uuid, uuid, text, uuid, jsonb) to service_role;
grant execute on function public.reajuste_persistir(uuid, uuid, text, uuid, numeric, jsonb) to service_role;
