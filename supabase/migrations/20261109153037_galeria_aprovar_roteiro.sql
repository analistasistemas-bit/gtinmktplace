-- ADR-0201 (Galeria da cor por IA), Task 7: aprovar roteiro numa transação.
-- Índice único parcial (org_id, anuncio_externo_id) where status = 'aprovado' não é adiável: primeiro todo
-- roteiro aprovado do anúncio (de qualquer família — cada UPDATE cria família nova) vai a `desatualizado`,
-- depois o rascunho vira o aprovado vigente com o fatos_hash calculado pela edge (calcularVigencia).
-- Imagens de versões anteriores (vigência editorial × execução):
--   pendente → falhou/roteiro_trocado (sem chamada paga; o claim do worker é `where status = 'pendente'`);
--   gerada|aprovada fora de manifesto de aplicação `aplicada` → desatualizada;
--   submetendo|gerando não mudam (o worker com posse conclui e grava gerada/desatualizada pela vigência).
-- Serializado por anúncio (advisory lock): duas aprovações simultâneas nunca estouram o índice.
-- Corrida salvar × aprovar: a edge valida o conteúdo que leu e o manda em p_conteudo_lido; se o rascunho mudou
-- desde a leitura, recusa (conteudo_mudou) sem gravar nada.
-- Devolve código, nunca levanta por estado: ok | nao_encontrado | nao_rascunho | familia_nao_vigente | conteudo_mudou.
create function public.galeria_aprovar_roteiro(
  p_org uuid, p_roteiro uuid, p_familia uuid, p_fatos_hash text, p_conteudo_lido jsonb, p_conteudo jsonb, p_usuario uuid
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_anuncio uuid;
  v_r public.galeria_roteiros%rowtype;
begin
  select anuncio_externo_id into v_anuncio from public.galeria_roteiros where id = p_roteiro and org_id = p_org;
  if v_anuncio is null then return 'nao_encontrado'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('galeria_roteiro:' || v_anuncio::text, 0));

  select * into v_r from public.galeria_roteiros where id = p_roteiro and org_id = p_org for update;
  if v_r.status <> 'rascunho' then return 'nao_rascunho'; end if;
  if v_r.familia_id <> p_familia then return 'familia_nao_vigente'; end if;
  if v_r.conteudo is distinct from p_conteudo_lido then return 'conteudo_mudou'; end if;

  update public.galeria_roteiros set status = 'desatualizado'
    where org_id = p_org and anuncio_externo_id = v_anuncio and status = 'aprovado';

  update public.galeria_imagens set status = 'falhou', erro = 'roteiro_trocado', atualizado_em = now()
    where org_id = p_org and anuncio_externo_id = v_anuncio and roteiro_id <> p_roteiro and status = 'pendente';

  update public.galeria_imagens i set status = 'desatualizada', atualizado_em = now()
    where i.org_id = p_org and i.anuncio_externo_id = v_anuncio and i.roteiro_id <> p_roteiro
      and i.status in ('gerada', 'aprovada')
      and not exists (
        select 1 from public.galeria_aplicacoes ap, pg_catalog.jsonb_array_elements(ap.manifesto) m
        where ap.org_id = p_org and ap.anuncio_externo_id = v_anuncio and ap.status = 'aplicada'
          and m->>'imagem_id' = i.id::text);

  update public.galeria_roteiros
    set status = 'aprovado', fatos_hash = p_fatos_hash, conteudo = p_conteudo, aprovado_por = p_usuario, aprovado_em = now()
    where id = p_roteiro;
  return 'ok';
end;
$$;
revoke all on function public.galeria_aprovar_roteiro(uuid, uuid, uuid, text, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.galeria_aprovar_roteiro(uuid, uuid, uuid, text, jsonb, jsonb, uuid) to service_role;
