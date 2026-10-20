-- ADR-0135 emenda (auditoria fiscal A3, 19/10/2026): mudar regime_tributario ou origin_type em
-- empresa_fiscal (o front grava direto, Configurações › Fiscal) não reenviava o fiscal ao ML.
-- Marca o push como pendente nas famílias publicadas da org — a recuperação C4 (monitorar-moderados,
-- 6/6h) reenfileira. `atualizado_em` também avança: o worker conclui só se `atualizado_em` não mudou,
-- então um push em voo com o dado antigo não apaga a pendência.
-- security definer: o UPDATE roda como owner, fora do guard A6 (familias_proteger_fiscal barra o
-- papel authenticated, que é quem grava empresa_fiscal pelo front).
create or replace function public.empresa_fiscal_marcar_push_pendente()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.familias
     set fiscal_sincronizado_em = null, atualizado_em = now()
   where org_id = new.org_id
     and status = 'publicado'
     and fiscal_sincronizado_em is not null;
  return null;
end $$;
revoke all on function public.empresa_fiscal_marcar_push_pendente() from public, anon, authenticated;

create trigger empresa_fiscal_marcar_push_pendente
  after update of regime_tributario, origin_type on public.empresa_fiscal
  for each row
  when (old.regime_tributario is distinct from new.regime_tributario
        or old.origin_type is distinct from new.origin_type)
  execute function public.empresa_fiscal_marcar_push_pendente();
