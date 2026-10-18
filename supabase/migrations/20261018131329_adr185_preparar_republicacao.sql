-- ADR-0185 D-2: prepara a republicação de um produto numa transação só.
-- Chamada pela edge `remover-publicado` (modo republicar) DEPOIS de pausar tudo no ML.
-- Erros de negócio saem como exceção com prefixo fixo (`republicar:<motivo>`) que a edge traduz.
create or replace function public.preparar_republicacao(
  p_org uuid, p_canal text, p_codigo_pai text, p_familia_alvo uuid
) returns table (familia_id uuid, lote_id uuid, lotes_afetados uuid[])
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_vigente uuid;
  v_lote uuid;
  v_status text;
  v_tem_raiz boolean;
  v_lotes uuid[];
begin
  -- Serializa republicações concorrentes do mesmo produto (e contra quem mexe nas mesmas linhas).
  perform 1 from familias f where f.org_id = p_org and f.codigo_pai = p_codigo_pai for update;
  perform 1 from anuncios_externos a
   where a.org_id = p_org and a.canal = p_canal::canal_externo and a.codigo_pai = p_codigo_pai for update;

  -- D-1 (republicar): a cópia mais nova com vínculo — inclui UPDATE ainda não publicado e CREATE
  -- de split parcial; é a que traz os dados mais novos.
  select f.id, f.lote_id, f.status into v_vigente, v_lote, v_status
    from familias f
   where f.org_id = p_org and f.codigo_pai = p_codigo_pai and f.ml_item_id is not null
   order by f.criado_em desc, f.id desc
   limit 1;

  if v_vigente is null then
    -- Sem vínculo nenhum: ou UP com saga interrompida (raiz ainda existe → preserva a pedida),
    -- ou uma republicação anterior já rodou (raízes apagadas) → recusa, nunca um 2º CREATE.
    select exists (
      select 1 from anuncios_externos a
       where a.org_id = p_org and a.canal = p_canal::canal_externo and a.codigo_pai = p_codigo_pai
    ) into v_tem_raiz;
    if not v_tem_raiz then
      raise exception 'republicar:nao_publicada' using errcode = 'P0001';
    end if;
    select f.id, f.lote_id, f.status into v_vigente, v_lote, v_status
      from familias f
     where f.id = p_familia_alvo and f.org_id = p_org and f.codigo_pai = p_codigo_pai;
    if v_vigente is null then
      raise exception 'republicar:nao_encontrada' using errcode = 'P0001';
    end if;
  end if;

  if v_status in ('pendente', 'processando', 'publicando') then
    raise exception 'republicar:em_processamento' using errcode = 'P0001';
  end if;

  -- Cópias anteriores do mesmo pai: apagadas (mesmo corte do Remover). Mantidas como `publicado`
  -- sem vínculo virariam zumbis contados como kit vivo pelos guards.
  select coalesce(array_agg(distinct f.lote_id), '{}') into v_lotes
    from familias f
   where f.org_id = p_org and f.codigo_pai = p_codigo_pai
     and f.ml_item_id is not null and f.id <> v_vigente;
  delete from familias f
   where f.org_id = p_org and f.codigo_pai = p_codigo_pai
     and f.ml_item_id is not null and f.id <> v_vigente;

  update variacoes v set ml_variation_id = null, preco_publicado_ml = null, ml_picture_id = null
   where v.familia_id = v_vigente;

  update familias f set
      ml_item_id = null, ml_permalink = null, publicado_em = null,
      capa_ml_picture_id = null, capa2_ml_picture_id = null, capa3_ml_picture_id = null,
      operacao = 'CREATE'::operacao_ml,
      status = (case when f.status = 'erro' then 'erro' else 'pronto' end)::familia_status,
      erro_mensagem = case when f.status = 'erro' then f.erro_mensagem else null end
   where f.id = v_vigente;

  delete from anuncios_externos a
   where a.org_id = p_org and a.canal = p_canal::canal_externo and a.codigo_pai = p_codigo_pai;

  update lotes l set status = 'revisao'::lote_status where l.id = v_lote;

  return query select v_vigente, v_lote, v_lotes;
end;
$$;

revoke all on function public.preparar_republicacao(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.preparar_republicacao(uuid, text, text, uuid) to service_role;
