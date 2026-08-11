-- E6b (ADR-0110): ajuste de estoque pelo PubliAI. Só REDUZ ou zera — aumentar continua
-- sendo Entrada de mercadoria, que exige custo e alimenta markup/preço (ADR-0055).
--
-- Motivação: sem este caminho o operador zerava a cor direto no Mercado Livre, e o push
-- absoluto (`sincronizar-estoque`) mais o cron `reconciliar-estoque` restauravam o número
-- antigo em até 24h — `reconciliar-estoque/index.ts:93` enfileira com `canal_origem: null`,
-- descartando o `push_canal_origem` que o `sync-venda` grava justamente para não ecoar ao ML.

-- Check constraint não aceita append: derruba e recria com o motivo novo.
alter table public.estoque_movimentos
  drop constraint estoque_movimentos_motivo_check;

alter table public.estoque_movimentos
  add constraint estoque_movimentos_motivo_check check (motivo in (
    'venda', 'entrada', 'estorno_venda',
    'venda_sku_nao_encontrado', 'estorno_sku_nao_encontrado',
    'cancelamento_sem_baixa', 'venda_cancelada_antes',
    -- ADR-0110: redução manual de saldo (venda física, perda, fim de estoque).
    'ajuste'
  ));

create or replace function public.ajustar_estoque(
  p_org uuid, p_codigo text, p_novo_saldo integer, p_obs text,
  p_criado_por uuid, p_ref text
) returns integer language plpgsql security definer set search_path = ''
as $$
declare v_var uuid; v_pai text; v_antes integer; v_novo integer; v_mov uuid;
begin
  -- Caminho que alimenta saldo falha LOUD (regra da casa, ADR-0055): nada de default silencioso.
  if p_novo_saldo is null or p_novo_saldo < 0 then
    raise exception 'ajustar_estoque: novo saldo deve ser inteiro >= 0 (recebeu %)', p_novo_saldo;
  end if;
  -- Teto do ML (ADR-0048, capar-estoque.ts). O ajuste só reduz, então isto é trava barata.
  if p_novo_saldo > 99999 then
    raise exception 'ajustar_estoque: novo saldo acima do teto do canal (99999): %', p_novo_saldo;
  end if;
  if p_ref is null or btrim(p_ref) = '' then
    raise exception 'ajustar_estoque: referência de idempotência é obrigatória';
  end if;

  -- Mesma âncora de registrar_entrada/baixar_estoque e do push: a família MAIS RECENTE.
  select v.id, f.codigo_pai into v_var, v_pai
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo
  order by f.criado_em desc
  limit 1;

  if v_var is null then
    raise exception 'ajustar_estoque: SKU % não encontrado na organização', p_codigo;
  end if;

  -- INSERT-FIRST, como baixar_estoque: a idempotência precisa vir antes do lock da linha de
  -- `variacoes`. Se o lock viesse primeiro, um retry duplicado seguraria a variação só para
  -- descobrir que era no-op, bloqueando `baixar_estoque` concorrente à toa.
  -- `codigo_pai` entra já aqui: sem ele o movimento fica fora do índice de outbox
  -- (estoque_movimentos_push_pendente_idx) e o push nunca seria recuperado.
  begin
    insert into public.estoque_movimentos
      (org_id, codigo, codigo_pai, quantidade, motivo, observacao, criado_por,
       referencia_externa, push_canal_origem)
    values (p_org, p_codigo, v_pai, 0, 'ajuste', p_obs, p_criado_por, p_ref, null)
    returning id into v_mov;
  exception when unique_violation then
    return null;   -- mesma submissão já aplicada
  end;

  select estoque into v_antes from public.variacoes where id = v_var for update;

  -- Aumento é caminho da Entrada (que exige custo e alimenta markup). A exceção derruba
  -- também o insert acima — a função inteira é uma transação, então não sobra movimento órfão.
  if p_novo_saldo > v_antes then
    raise exception 'ajustar_estoque: ajuste só reduz saldo (atual %, pedido %). Para aumentar, use Entrada de mercadoria.', v_antes, p_novo_saldo;
  end if;

  update public.variacoes set estoque = p_novo_saldo
  where id = v_var
  returning estoque into v_novo;

  -- Delta negativo (ou 0 quando o saldo já era o pedido). Mesma convenção da venda, então as
  -- somas do histórico continuam corretas.
  update public.estoque_movimentos
  set quantidade = v_novo - v_antes, estoque_anterior = v_antes, estoque_resultante = v_novo
  where id = v_mov;

  return v_novo;
end $$;

-- O trigger `bloquear_escrita_direta_estoque` (guard de 2026-08-04, incidente de escrita
-- direta com service_role) só libera UPDATE de `variacoes.estoque` quando
-- `current_user = 'estoque_rpc_executor'`. As três RPCs do Bloco A pertencem a esse role;
-- sem o mesmo tratamento, esta função falharia com 42501 no primeiro ajuste real.
-- Mesma dança da migration 20260804113000: virar membro do role, transferir o dono,
-- devolver os privilégios elevados.
grant estoque_rpc_executor to postgres;
-- PostgreSQL exige CREATE no schema apenas durante o ALTER OWNER.
grant usage, create on schema public to estoque_rpc_executor;

alter function public.ajustar_estoque(uuid, text, integer, text, uuid, text)
  owner to estoque_rpc_executor;

revoke create on schema public from estoque_rpc_executor;
revoke estoque_rpc_executor from postgres cascade;

-- Sem o revoke, uma função `security definer` fica chamável pelo browser via PostgREST e
-- contorna tanto o trigger de bloqueio quanto a RLS. Mesmo padrão das RPCs do Bloco A.
revoke execute on function public.ajustar_estoque(uuid, text, integer, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.ajustar_estoque(uuid, text, integer, text, uuid, text)
  to service_role;
