-- ADR-0201 (Galeria da cor por IA), Task 12: aprovar o arquivo final de uma imagem.
-- Uma aprovada por (cor, missão, roteiro): índice único parcial; o manifesto da aplicação (Task 14) tem no máximo uma
-- imagem por missão. O índice não é adiável: a aprovada anterior da mesma (cor, missão, roteiro) volta a `gerada`
-- (continua cobrada; arquivo e `aprovado_em` ficam — a retenção nunca apaga o que já foi aprovado) ANTES de promover a
-- nova, na mesma transação. A edge (`galeria-aprovar`) já conferiu o arquivo (JPEG 1200×1540 ≤1 MB não branco) e a
-- referência; aqui só o que precisa ser atômico com a gravação:
--   - imagem da org e do anúncio, `gerada` (repetição já `aprovada` com o mesmo arquivo → ok, sem gravar);
--   - `final_upload_path` ainda é o arquivo que a edge conferiu (um `preparar_upload` concorrente troca o caminho);
--   - imagem `gerador` com `alertas` nulo → a verificação por visão ainda não rodou (recorte nasce com `[]`);
--   - roteiro da imagem ainda é o aprovado.
-- Devolve código, nunca levanta por estado:
--   ok | nao_encontrada | desatualizada | nao_aprovavel | upload_trocado | verificacao_pendente | aprovacao_concorrente.
-- A anterior volta a `gerada` mesmo se citada em manifesto `preparada`/em andamento/`aplicada`: a Task 14 trata
-- (galeria_confirmar_aplicacao já devolve `desatualizada` para manifesto com imagem que deixou de ser aprovada).
create unique index galeria_imagens_uma_aprovada_uidx
  on public.galeria_imagens (org_id, roteiro_id, cor, missao) where status = 'aprovada';

create function public.galeria_aprovar_imagem(
  p_org uuid, p_anuncio uuid, p_imagem uuid, p_upload_path text, p_sha256 text, p_usuario uuid
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_i public.galeria_imagens%rowtype;
begin
  select * into v_i from public.galeria_imagens
    where id = p_imagem and org_id = p_org and anuncio_externo_id = p_anuncio for update;
  if not found then return 'nao_encontrada'; end if;
  if v_i.status = 'aprovada' then
    return case when v_i.final_path = p_upload_path and v_i.final_sha256 = p_sha256 then 'ok' else 'nao_aprovavel' end;
  end if;
  if v_i.status = 'desatualizada' then return 'desatualizada'; end if;
  if v_i.status <> 'gerada' then return 'nao_aprovavel'; end if;
  if v_i.final_upload_path is distinct from p_upload_path then return 'upload_trocado'; end if;
  if v_i.origem = 'gerador' and v_i.alertas is null then return 'verificacao_pendente'; end if;
  if not exists (select 1 from public.galeria_roteiros r where r.id = v_i.roteiro_id and r.status = 'aprovado') then
    return 'desatualizada';
  end if;

  -- Aprovação simultânea de outra geração da mesma (cor, missão) estoura o índice: código, sem efeito (subtransação).
  begin
    update public.galeria_imagens set status = 'gerada', atualizado_em = now()
      where org_id = p_org and roteiro_id = v_i.roteiro_id and cor = v_i.cor and missao = v_i.missao
        and status = 'aprovada' and id <> p_imagem;

    update public.galeria_imagens
      set status = 'aprovada', final_path = p_upload_path, final_sha256 = p_sha256,
          aprovado_em = now(), aprovado_por = p_usuario, atualizado_em = now()
      where id = p_imagem;
  exception when unique_violation then
    return 'aprovacao_concorrente';
  end;
  return 'ok';
end;
$$;
revoke all on function public.galeria_aprovar_imagem(uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.galeria_aprovar_imagem(uuid, uuid, uuid, text, text, uuid) to service_role;
