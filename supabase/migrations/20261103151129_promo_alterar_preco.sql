-- Emenda ADR-0174 (2026-11-03): ação `alterar_preco` — PUT do deal_price de item DEAL já participando.
-- Checks de ação e as duas barreiras com o reajuste (copiadas da definição viva; só a lista de ações muda).

alter table public.operacoes_massa drop constraint operacoes_massa_acao_check;
alter table public.operacoes_massa add constraint operacoes_massa_acao_check
  check (acao in ('aderir','sair','pausar','reativar','reajustar','alterar_preco'));

alter table public.operacoes_massa drop constraint operacoes_massa_acao_promocao_check;
alter table public.operacoes_massa add constraint operacoes_massa_acao_promocao_check check (
  (acao in ('aderir','sair','alterar_preco') and promocao_id is not null and promocao_tipo is not null)
  or (acao in ('pausar','reativar','reajustar') and promocao_id is null and promocao_tipo is null)
);

-- Reajuste não reivindica anúncio com operação de promoção (agora inclui alterar_preco) em andamento.
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
                  where i.org_id = p_org and i.ml_item_id = p_ml_item and o.acao in ('aderir','sair','alterar_preco')
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
$function$;

-- Aderir e alterar_preco não reivindicam anúncio com reajuste em andamento (mesma barreira).
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

  if v_acao in ('aderir','alterar_preco') then
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
$function$;
