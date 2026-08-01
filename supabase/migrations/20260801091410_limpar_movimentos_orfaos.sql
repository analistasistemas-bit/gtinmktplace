-- ============================================================================
-- ADR-0097 — exclusão de produto/lote não deixa movimento órfão no ledger.
--
-- `estoque_movimentos` não tem FK para `variacoes` (de propósito: uma venda de SKU
-- inexistente precisa ser gravável como `venda_sku_nao_encontrado`). Por isso as
-- variações morrem por cascade ao excluir a família e o ledger sobrevive.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- limpar_movimentos_orfaos — apaga os movimentos da org cujo `codigo` não existe
-- mais em nenhuma `variacoes` viva DAQUELA org. Devolve quantas linhas removeu.
--
-- ANTI-JOIN, não "os códigos que acabei de apagar" (ADR-0097 D-1): `excluir-lote`
-- preserva famílias publicadas (ADR-0019 D-1) e o mesmo `codigo_pai` tem várias
-- famílias após ciclos de UPDATE (ADR-0019, adendo) — o SKU sobrevive em outra
-- linha e o histórico dele tem de sobreviver junto. O anti-join também é
-- auto-curativo: absorve órfão antigo sem precisar de script avulso.
--
-- Chamar SEMPRE depois do delete commitar (D-2): antes dele o cascade ainda não
-- rodou e o conjunto órfão sai vazio.
-- ----------------------------------------------------------------------------
create or replace function public.limpar_movimentos_orfaos(p_org uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_removidos integer;
begin
  if p_org is null then
    raise exception 'limpar_movimentos_orfaos: org é obrigatória';
  end if;

  delete from public.estoque_movimentos m
  where m.org_id = p_org
    and not exists (
      select 1 from public.variacoes v
      where v.org_id = m.org_id and v.codigo = m.codigo
    );

  get diagnostics v_removidos = row_count;
  return v_removidos;
end $$;

-- Rodapé padrão do E6b (20260729084329): revogar de todos e conceder ao service_role.
-- Sem o grant a RPC fica inexecutável também pelas edge functions.
revoke execute on function public.limpar_movimentos_orfaos(uuid)
  from public, anon, authenticated;
grant execute on function public.limpar_movimentos_orfaos(uuid)
  to service_role;

-- ----------------------------------------------------------------------------
-- D-4: limpa o que JÁ está órfão hoje. O pedido é no presente — só mudar o código
-- deixaria o banco sujo até a próxima exclusão.
-- ----------------------------------------------------------------------------
do $$
declare v_org uuid; v_total integer := 0;
begin
  for v_org in select id from public.organizations loop
    v_total := v_total + public.limpar_movimentos_orfaos(v_org);
  end loop;
  raise notice 'ADR-0097: % movimento(s) órfão(s) removido(s)', v_total;
end $$;
