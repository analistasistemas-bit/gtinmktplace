-- ADR-0201 (Galeria da cor por IA), adendo "lupa pela caixa do produto" (plano 2026-11-11, v3):
-- a visão localiza na referência `frente` a caixa do produto e até 2 caixas de detalhe; o recorte da lupa é feito
-- por código sobre a foto real (R3.3). A leitura fica na própria referência (imutável por sha):
--   null (nunca lida) | {estado:'falhou'} (relê após 5 min) | {estado:'sem_detalhe'} (definitivo na versão)
--   | {estado:'ok', produto, detalhes, ref_w, ref_h, hash}; todas com `versao` (modelo + prompt) e `tentado_em`.
-- Escrita só pelo servidor (service_role), condicional: dois `montar` concorrentes → uma única gravação final.
alter table public.galeria_referencias add column detalhes jsonb
  check (detalhes is null or (jsonb_typeof(detalhes) = 'object'
    and detalhes->>'estado' in ('ok', 'sem_detalhe', 'falhou') and detalhes ? 'versao'));

-- Grava a leitura só se a gravada ainda permite (nula, `falhou` ou de outra versão) e devolve a vigente depois da
-- tentativa (relida do banco: quem perdeu a corrida devolve a do vencedor). null = referência não encontrada na org.
create or replace function public.galeria_gravar_detalhes(p_org uuid, p_referencia uuid, p_detalhes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_atual jsonb;
begin
  update public.galeria_referencias r set detalhes = p_detalhes
   where r.id = p_referencia and r.org_id = p_org
     and (r.detalhes is null or r.detalhes->>'estado' = 'falhou'
          or r.detalhes->>'versao' is distinct from p_detalhes->>'versao');
  select r.detalhes into v_atual from public.galeria_referencias r where r.id = p_referencia and r.org_id = p_org;
  return v_atual;
end;
$$;
revoke all on function public.galeria_gravar_detalhes(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.galeria_gravar_detalhes(uuid, uuid, jsonb) to service_role;
