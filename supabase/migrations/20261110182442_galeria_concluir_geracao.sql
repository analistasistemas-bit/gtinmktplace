-- ADR-0201 (Galeria da cor por IA), Task 9: conclusão da geração pelo worker num único update condicionado à posse.
-- Grava cena_path, prompt, custo_usd e o status pela vigência editorial (Global Constraints "Vigência editorial ×
-- execução"): `gerada` se o roteiro da linha ainda é o aprovado, senão `desatualizada`. O `for share` no roteiro fecha
-- a corrida com galeria_aprovar_roteiro (que desatualiza o roteiro antes de varrer as imagens): se o aprovar já mexeu
-- no roteiro, esperamos o commit e lemos o novo status; se chegamos antes, o aprovar espera e a varredura dele pega a
-- `gerada`. Solta posse e lease e avança a fase. Devolve o status gravado, ou null se a posse foi perdida (0 linhas).
-- Sem begin/commit: o db push já envolve a migration numa transação.
create function public.galeria_concluir_geracao(
  p_imagem uuid, p_posse uuid, p_cena_path text, p_prompt text, p_custo numeric
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_roteiro uuid;
  v_vigente boolean;
  v_status text;
begin
  if p_cena_path is null or p_custo is null then
    raise exception 'cena e custo obrigatórios' using errcode = '22023';
  end if;
  select g.roteiro_id into v_roteiro from public.galeria_imagens g where g.id = p_imagem and g.posse = p_posse;
  if v_roteiro is null then return null; end if;
  select r.status = 'aprovado' into v_vigente from public.galeria_roteiros r where r.id = v_roteiro for share;

  update public.galeria_imagens g
     set status = case when coalesce(v_vigente, false) then 'gerada' else 'desatualizada' end,
         cena_path = p_cena_path, prompt = coalesce(p_prompt, g.prompt), custo_usd = p_custo,
         posse = null, lease_ate = null, fase = g.fase + 1, atualizado_em = now()
   where g.id = p_imagem and g.posse = p_posse and g.status in ('submetendo', 'gerando')
  returning g.status into v_status;
  return v_status;
end;
$$;
revoke all on function public.galeria_concluir_geracao(uuid, uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.galeria_concluir_geracao(uuid, uuid, text, text, numeric) to service_role;
