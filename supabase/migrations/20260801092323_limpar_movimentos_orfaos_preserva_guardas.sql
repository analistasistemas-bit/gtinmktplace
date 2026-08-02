-- ============================================================================
-- ADR-0097 D-1.1 — a varredura NÃO pode tocar os motivos que existem justamente
-- SEM variação correspondente.
--
-- O anti-join de 20260801091410 identifica "produto excluído" corretamente, mas
-- casa também com quatro motivos que nascem órfãos por construção — um deles é
-- guarda funcional, não histórico:
--
--   cancelamento_sem_baixa  TOMBSTONE do D-19. `baixar_estoque` (passo 3) lê esta
--                           linha para RECUSAR a baixa de um pedido já cancelado.
--                           Varrer = perder a guarda: cancelamento grava tombstone
--                           → produto excluído → varredura apaga → mesmo CODIGO
--                           reimportado (padrão normal de planilha, ADR-0019) →
--                           webhook `paid` re-entregue → baixa silenciosa de um
--                           pedido cancelado. Decremento mudo em caminho
--                           financeiro é exatamente o que não pode acontecer.
--   venda_sku_nao_encontrado / estorno_sku_nao_encontrado
--                           Gravados porque o SKU NÃO existe — é o alarme de que
--                           chegou venda de produto não cadastrado. A migration
--                           do E6b diz isso em letra: "Preserva a trilha … estorno
--                           de SKU sumido é evento que alguém precisa ver."
--                           Apagá-los também libera a `referencia_externa`, então
--                           uma re-entrega voltaria a aplicar a baixa.
--   venda_cancelada_antes   Venda recusada pelo tombstone. Preservada por simetria
--                           com ele: ocupa a referência da venda e é registro de
--                           evento anômalo, não estoque de produto vivo.
--
-- Estes quatro nunca foram "lixo da exclusão" — não pertencem a nenhum produto.
-- ============================================================================
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
    and m.motivo not in (
      'cancelamento_sem_baixa',      -- guarda D-19, não histórico
      'venda_sku_nao_encontrado',
      'estorno_sku_nao_encontrado',
      'venda_cancelada_antes'
    )
    and not exists (
      select 1 from public.variacoes v
      where v.org_id = m.org_id and v.codigo = m.codigo
    );

  get diagnostics v_removidos = row_count;
  return v_removidos;
end $$;

-- `create or replace` preserva grants e revokes da 20260801091410; repetidos aqui
-- porque uma restauração que rode só esta migration precisa do mesmo resultado.
revoke execute on function public.limpar_movimentos_orfaos(uuid)
  from public, anon, authenticated;
grant execute on function public.limpar_movimentos_orfaos(uuid)
  to service_role;
