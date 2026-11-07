-- ADR-0197 (Task 6): pausa e reativação do operador na política do SKU de kit com variação.
-- Pausar grava `bloqueio_operador` e incrementa `versao` (SKU sem linha nasce com versão 1, então a
-- soma que a saga capturou muda): a reativação de uma saga em curso deixa de valer.
-- Reativar só limpa o bloqueio se a versão vigente for a que o chamador leu ao decidir
-- (`podeReativar`); outra versão recusa sem mudar nada. As linhas são travadas antes da conferência.
-- Só muda o que de fato muda: a reentrega não incrementa de novo.
create or replace function public.kit_politica_operador(
  p_org uuid, p_codigos text[], p_bloquear boolean, p_versoes jsonb default null
) returns jsonb language plpgsql set search_path = ''
as $$
declare v_codigo text;
begin
  perform 1 from public.sku_politica_kit
  where org_id = p_org and codigo = any(p_codigos) order by codigo for update;

  if p_bloquear then
    insert into public.sku_politica_kit as p (org_id, codigo, bloqueio_operador)
    select distinct p_org, c, true from unnest(p_codigos) c
    on conflict (org_id, codigo) do update set bloqueio_operador = true, versao = p.versao + 1
    where not p.bloqueio_operador;
    return jsonb_build_object('ok', true);
  end if;

  for v_codigo in select distinct c from unnest(p_codigos) c order by 1 loop
    if coalesce((select versao from public.sku_politica_kit where org_id = p_org and codigo = v_codigo), 0)
       <> coalesce((p_versoes ->> v_codigo)::integer, -1) then
      return jsonb_build_object('ok', false, 'codigo', v_codigo);
    end if;
  end loop;

  update public.sku_politica_kit set bloqueio_operador = false, versao = versao + 1
  where org_id = p_org and codigo = any(p_codigos) and bloqueio_operador;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.kit_politica_operador(uuid, text[], boolean, jsonb) from public, anon, authenticated;
grant execute on function public.kit_politica_operador(uuid, text[], boolean, jsonb) to service_role;
