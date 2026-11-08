-- ADR-0200 (adendo de 08/11, alarme falso de "Transferência de kit bloqueada"): o alerta escalonado da saga só sai
-- depois de uma carência, contada do início do problema; o que saiu fica registrado para o aviso de fim dizer
-- "resolvido"; e a transferência concluída não guarda alerta velho.
--   alerta_desde:   início do problema que pede alerta no passo atual (null = nenhum). A saga zera quando avança.
--   alerta_enviado: último texto de alerta escalonado que a saga mandou (dedup e marca do "resolvido"). Sobrevive
--                   ao finalizar: o aviso de fim lê depois.
alter table public.kit_transferencias add column if not exists alerta_desde timestamptz;
alter table public.kit_transferencias add column if not exists alerta_enviado text;

-- Corpo de 20261107212019 mais os três parâmetros novos (default: o edge antigo segue chamando até o deploy).
-- Assinatura nova: a antiga sai, senão o PostgREST não resolve a sobrecarga.
drop function if exists public.kit_saga_salvar_transferencia(uuid, uuid, uuid, text, text, boolean);
create or replace function public.kit_saga_salvar_transferencia(
  p_org uuid, p_transferencia uuid, p_token uuid, p_passo text, p_alerta text, p_travar boolean,
  p_alerta_desde timestamptz default null, p_limpar_alerta_desde boolean default false, p_alerta_enviado text default null
) returns void language plpgsql set search_path = ''
as $$
begin
  perform public.kit_saga_validar(p_org, p_transferencia, p_token);
  update public.kit_transferencias
  set passo = coalesce(p_passo, passo), alerta = coalesce(p_alerta, alerta), passo_em = now(),
      estado = case when p_travar then 'travada' else estado end,
      -- O primeiro registro do problema vale: a carência conta dele.
      alerta_desde = case when p_limpar_alerta_desde then null else coalesce(alerta_desde, p_alerta_desde) end,
      alerta_enviado = coalesce(p_alerta_enviado, alerta_enviado)
  where id = p_transferencia and org_id = p_org;
end $$;

-- Corpo de 20261108052338 (com `p_pausas`). Concluída grava o alerta recebido (null limpa o motivo velho de
-- reagendamento); abortada segue com coalesce. `alerta_enviado` fica: é a marca do "resolvido" no aviso de fim.
create or replace function public.kit_saga_finalizar(
  p_org uuid, p_transferencia uuid, p_token uuid, p_estado text, p_alerta text, p_pausas jsonb default '[]'::jsonb
) returns void language plpgsql set search_path = ''
as $$
begin
  if p_estado not in ('concluida', 'abortada') then
    raise exception 'kit_saga_finalizar: estado inválido %', p_estado;
  end if;
  perform public.kit_saga_validar(p_org, p_transferencia, p_token);
  if exists (select 1 from public.kit_transferencia_alvos
             where transferencia_id = p_transferencia and org_id = p_org and cardinality(repausar) > 0) then
    raise exception 'kit_repausa_pendente: transferência % tem item a repausar', p_transferencia using errcode = 'KX005';
  end if;
  -- Só item que esta saga pausou (no alvo do próprio código): o chamador não cria pausa alheia.
  insert into public.kit_pausas_automaticas (org_id, codigo, item_id, transferencia_id)
  select p_org, a.codigo, p->>'itemId', p_transferencia
  from jsonb_array_elements(coalesce(p_pausas, '[]'::jsonb)) p
  join public.kit_transferencia_alvos a
    on a.transferencia_id = p_transferencia and a.org_id = p_org and a.codigo = p->>'codigo'
   and (p->>'itemId') = any(a.pausado_pela_saga)
  on conflict (org_id, item_id) do nothing;
  delete from public.kit_exclusoes where org_id = p_org and dono_tipo = 'transferencia' and dono_id = p_transferencia;
  update public.kit_transferencias
  set estado = p_estado, passo = 'fim',
      alerta = case when p_estado = 'concluida' then p_alerta else coalesce(p_alerta, alerta) end,
      alerta_desde = null, passo_em = now(), execucao_token = null, execucao_ate = null
  where id = p_transferencia and org_id = p_org;
end $$;

revoke all on function public.kit_saga_salvar_transferencia(uuid, uuid, uuid, text, text, boolean, timestamptz, boolean, text)
  from public, anon, authenticated;
grant execute on function public.kit_saga_salvar_transferencia(uuid, uuid, uuid, text, text, boolean, timestamptz, boolean, text)
  to service_role;
revoke all on function public.kit_saga_finalizar(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.kit_saga_finalizar(uuid, uuid, uuid, text, text, jsonb) to service_role;

-- Concluída sem aviso de fim que teve alerta escalonado (qualquer tipo) também entra na varredura do "resolvido".
drop index if exists public.kit_transferencias_aviso_fim_pendente_idx;
create index if not exists kit_transferencias_aviso_fim_pendente_idx
  on public.kit_transferencias (org_id)
  where estado = 'concluida' and aviso_fim_enviado_em is null
    and (tipo in ('montar', 'desmontar', 'repor') or alerta_enviado is not null);
