-- ADR-0197 (Task 6): pausa e reativação do operador na política do SKU de kit com variação.

-- Quem criou o bloqueio do operador (a operação em massa que pausou). Retry da mesma origem continua
-- sendo dela; bloqueio anterior não é atribuído a outra. Reativar limpa.
alter table public.sku_politica_kit add column if not exists bloqueio_operador_origem uuid;

-- Intenção de ativação pelo operador, vinculada ao dono da exclusão `ativacao`. Só sai quando o resultado
-- no ML de todos os alvos (item e cópias de catálogo) foi confirmado. Resultado incerto mantém a linha e a
-- exclusão; a retomada (mesmo dono) ou a conferência diária confirma e libera. Nunca por idade.
create table if not exists public.kit_ativacoes (
  org_id     uuid not null references public.organizations(id),
  dono_id    uuid not null,
  ml_item_id text not null,
  alvos      text[] not null,
  codigos    text[] not null,
  criado_em  timestamptz not null default now(),
  primary key (org_id, dono_id)
);
alter table public.kit_ativacoes enable row level security;
drop policy if exists "kit_ativacoes: select org" on public.kit_ativacoes;
create policy "kit_ativacoes: select org" on public.kit_ativacoes for select to authenticated
  using (org_id = (select public.current_org_id()));
revoke all on public.kit_ativacoes from anon;
revoke insert, update, delete, truncate, references, trigger on public.kit_ativacoes from authenticated;
grant select on public.kit_ativacoes to authenticated;
grant all on public.kit_ativacoes to service_role;

-- Pausar grava `bloqueio_operador` e incrementa `versao`: a reativação de uma saga em curso deixa de valer.
-- Reativar só limpa o bloqueio se a versão vigente for a que o chamador leu ao decidir (`podeReativar`).
-- SKU sem linha é materializado com versão 0 (em ordem de código, nos dois ramos) ANTES do `for update`:
-- sem isso a reativação comparava "sem linha = 0" sem travar nada, e uma pausa concorrente que inserisse a
-- linha seria apagada pelo UPDATE. A primeira pausa vai de 0 a 1. Reentrega não incrementa de novo.
-- `criou`: esta origem (não nula) é dona do bloqueio, agora ou numa tentativa anterior.
drop function if exists public.kit_politica_operador(uuid, text[], boolean, jsonb);
create or replace function public.kit_politica_operador(
  p_org uuid, p_codigos text[], p_bloquear boolean, p_versoes jsonb default null, p_origem uuid default null
) returns jsonb language plpgsql set search_path = ''
as $$
declare v_codigo text; v_ja boolean; v_n integer;
begin
  insert into public.sku_politica_kit (org_id, codigo, versao)
  select p_org, c, 0 from (select distinct unnest(p_codigos) c) s order by c
  on conflict (org_id, codigo) do nothing;
  perform 1 from public.sku_politica_kit
  where org_id = p_org and codigo = any(p_codigos) order by codigo for update;

  if p_bloquear then
    select exists (select 1 from public.sku_politica_kit where org_id = p_org and codigo = any(p_codigos)
      and bloqueio_operador and bloqueio_operador_origem = p_origem) into v_ja;
    update public.sku_politica_kit
    set bloqueio_operador = true, bloqueio_operador_origem = p_origem, versao = versao + 1
    where org_id = p_org and codigo = any(p_codigos) and not bloqueio_operador;
    get diagnostics v_n = row_count;
    return jsonb_build_object('ok', true, 'criou', p_origem is not null and (v_n > 0 or v_ja));
  end if;

  for v_codigo in select distinct c from unnest(p_codigos) c order by 1 loop
    if (select versao from public.sku_politica_kit where org_id = p_org and codigo = v_codigo)
       <> coalesce((p_versoes ->> v_codigo)::integer, -1) then
      return jsonb_build_object('ok', false, 'codigo', v_codigo);
    end if;
  end loop;

  update public.sku_politica_kit set bloqueio_operador = false, bloqueio_operador_origem = null, versao = versao + 1
  where org_id = p_org and codigo = any(p_codigos) and bloqueio_operador;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.kit_politica_operador(uuid, text[], boolean, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.kit_politica_operador(uuid, text[], boolean, jsonb, uuid) to service_role;
