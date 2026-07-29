-- ============================================================================
-- E6b (ADR-0094) — Ledger de movimentos de estoque + operações atômicas.
--
-- Toda escrita de estoque passa por estas funções (D-15); o app só LÊ a tabela e
-- a escrita direta em `variacoes.estoque` é bloqueada por trigger (D-20).
-- ============================================================================

create table public.estoque_movimentos (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id),
  codigo             text not null,             -- SKU interno (variacoes.codigo)
  codigo_pai         text not null default '',  -- preenchido ao resolver a variação canônica
  -- ATENÇÃO: `quantidade` é o DELTA REALMENTE APLICADO ao saldo, nunca o pedido.
  -- Com saldo 2 e venda de 5, o greatest(0, …) só remove 2 → quantidade = -2.
  -- Gravar -5 aqui faria o estorno devolver 5 e CRIAR 3 unidades do nada.
  quantidade         integer not null,          -- negativo = baixa, positivo = entrada/estorno
  quantidade_pedida  integer,                   -- o que o pedido pediu (auditoria + alerta)
  motivo             text not null,
  canal_origem       text,
  referencia_externa text,                      -- idempotência; null = movimento sem referência
  custo_unitario     numeric(12,2),             -- só em 'entrada'
  documento          text,                      -- NF do fornecedor
  observacao         text,                      -- texto livre do operador
  estoque_anterior   integer,                   -- saldo ANTES do movimento
  estoque_resultante integer,
  -- Outbox NO PRÓPRIO LEDGER: marca quando o push foi de fato entregue ao QStash.
  -- Sem isso, uma RPC que commita seguida de um enfileiramento que falha vira perda
  -- permanente: o retry recebe "já aplicado" e nunca re-enfileira.
  push_enfileirado_em timestamptz,
  -- INTENÇÃO de propagação, gravada por quem criou o movimento. Sem ela, um
  -- despachante genérico aplicaria um único canal_origem ao lote inteiro e, p.ex.,
  -- uma venda no ML drenaria uma ENTRADA marcando canal_origem='mercado_livre' —
  -- deixando de atualizar exatamente o canal que precisava.
  -- Venda: o canal da venda (que já se decrementou). Entrada/estorno: NULL (todos).
  push_canal_origem  text,
  criado_por         uuid references auth.users(id),
  criado_em          timestamptz not null default now(),
  constraint estoque_movimentos_motivo_check check (motivo in (
    'venda', 'entrada', 'estorno_venda',
    'venda_sku_nao_encontrado', 'estorno_sku_nao_encontrado',
    -- Tombstone: cancelamento que chegou ANTES da baixa existir. Impede que a
    -- execução `paid` posterior baixe um pedido já cancelado.
    'cancelamento_sem_baixa', 'venda_cancelada_antes'
  ))
);

-- Idempotência: 1 movimento por referência externa.
create unique index estoque_movimentos_ref_uniq
  on public.estoque_movimentos (org_id, referencia_externa)
  where referencia_externa is not null;

create index estoque_movimentos_org_pai_idx
  on public.estoque_movimentos (org_id, codigo_pai, criado_em desc);
create index estoque_movimentos_org_codigo_idx
  on public.estoque_movimentos (org_id, codigo, criado_em desc);

-- Varredura do outbox: movimentos aplicados cujo push ainda não foi entregue.
create index estoque_movimentos_push_pendente_idx
  on public.estoque_movimentos (org_id, criado_em)
  where push_enfileirado_em is null and codigo_pai <> '';

alter table public.estoque_movimentos enable row level security;

create policy "estoque_movimentos: select org" on public.estoque_movimentos
  for select to authenticated using (org_id = (select public.current_org_id()));
-- Sem policy de escrita: só service_role, via as funções abaixo.

-- ----------------------------------------------------------------------------
-- baixar_estoque — baixa atômica e idempotente.
-- Devolve jsonb { aplicado, motivo, movimento_id?, codigo_pai?, quantidade_aplicada?,
-- quantidade_pedida?, estoque_anterior?, estoque_resultante? }.
-- `aplicado=false` significa "esta execução não mudou nada" — é o que permite ao
-- chamador enfileirar push SÓ quando de fato houve mudança.
-- ----------------------------------------------------------------------------
create or replace function public.baixar_estoque(
  p_org uuid, p_codigo text, p_qtd integer, p_canal text, p_ref text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_var uuid; v_pai text; v_antes integer; v_novo integer;
        v_mov uuid; v_aplicado integer;
begin
  if p_qtd is null or p_qtd <= 0 then
    raise exception 'baixar_estoque: quantidade deve ser positiva (recebeu %)', p_qtd;
  end if;
  -- Sem referência não há idempotência: o índice único é PARCIAL (where ref is not null),
  -- então um p_ref nulo permitiria baixar o mesmo pedido infinitas vezes.
  if p_ref is null or btrim(p_ref) = '' then
    raise exception 'baixar_estoque: referência de idempotência é obrigatória';
  end if;

  -- 1) TRAVA COMUM com o estorno. Só o índice único não serializa: venda e tombstone
  --    ocupam referências DIFERENTES, e FOR UPDATE não espera por linha ainda não
  --    commitada. Sem este lock existe o interleaving: baixa insere → consulta
  --    tombstone e não acha → cancelamento insere tombstone → baixa aplica assim mesmo.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || '|' || p_ref, 0));

  -- 2) Idempotência: a unique parcial rejeita a 2ª aplicação da mesma referência.
  --    O bloco EXCEPTION abre uma subtransação PL/pgSQL — ele NÃO aborta a transação
  --    externa. A quantidade entra 0 e é corrigida ao saber o delta REAL aplicado.
  begin
    insert into public.estoque_movimentos
      (org_id, codigo, quantidade, quantidade_pedida, motivo, canal_origem,
       referencia_externa, push_canal_origem)
    values (p_org, p_codigo, 0, p_qtd, 'venda', p_canal, p_ref, p_canal)
    returning id into v_mov;
  exception when unique_violation then
    return jsonb_build_object('aplicado', false, 'motivo', 'duplicata');
  end;

  -- 3) TOMBSTONE: o cancelamento pode ter chegado ANTES desta baixa existir. Se houver
  --    marca de cancelamento para esta referência, NÃO baixa — senão o saldo cairia e
  --    nunca seria reposto, porque o estorno já rodou e não achou nada.
  if exists (
    select 1 from public.estoque_movimentos
    where org_id = p_org and referencia_externa = 'estorno:' || p_ref
      and motivo = 'cancelamento_sem_baixa'
  ) then
    update public.estoque_movimentos
    set motivo = 'venda_cancelada_antes'
    where id = v_mov;
    return jsonb_build_object('aplicado', false, 'motivo', 'cancelada_antes_da_baixa');
  end if;

  -- 4) Variação canônica = a da família mais recente do produto (âncora ADR-0025).
  select v.id, f.codigo_pai into v_var, v_pai
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo
  order by f.criado_em desc
  limit 1;

  if v_var is null then
    update public.estoque_movimentos set motivo = 'venda_sku_nao_encontrado'
    where id = v_mov;
    return jsonb_build_object('aplicado', false, 'motivo', 'sku_nao_encontrado');
  end if;

  -- 5) FOR UPDATE trava a linha da variação: duas baixas concorrentes do mesmo SKU
  --    não podem ler o MESMO estoque_anterior (a detecção de "vendeu sem saldo" erraria).
  select estoque into v_antes from public.variacoes where id = v_var for update;

  -- 6) Baixa atômica, nunca negativa (D-8).
  update public.variacoes set estoque = greatest(0, estoque - p_qtd)
  where id = v_var
  returning estoque into v_novo;

  -- O delta REAL é o que o estorno vai devolver. Gravar o pedido aqui criaria estoque.
  v_aplicado := v_novo - v_antes;   -- negativo ou zero

  update public.estoque_movimentos
  set codigo_pai = v_pai, quantidade = v_aplicado,
      estoque_anterior = v_antes, estoque_resultante = v_novo
  where id = v_mov;

  return jsonb_build_object(
    'aplicado', true, 'motivo', 'venda', 'movimento_id', v_mov, 'codigo_pai', v_pai,
    'quantidade_aplicada', abs(v_aplicado), 'quantidade_pedida', p_qtd,
    'estoque_anterior', v_antes, 'estoque_resultante', v_novo
  );
end $$;

-- ----------------------------------------------------------------------------
-- estornar_estoque — reposição por cancelamento antes do despacho (D-7).
-- ATÔMICA e ancorada no movimento de venda original: sem venda registrada, não
-- estorna nada — grava um tombstone para a execução `paid` posterior recusar a baixa.
-- NÃO recebe quantidade: usa abs(quantidade) do movimento, que é o delta aplicado.
-- ----------------------------------------------------------------------------
create or replace function public.estornar_estoque(
  p_org uuid, p_canal text, p_ref_venda text, p_codigo text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_qtd integer; v_codigo text; v_var uuid; v_pai text;
        v_antes integer; v_novo integer; v_ref_estorno text; v_mov uuid;
begin
  if p_ref_venda is null or btrim(p_ref_venda) = '' then
    raise exception 'estornar_estoque: referência da venda é obrigatória';
  end if;
  v_ref_estorno := 'estorno:' || p_ref_venda;

  -- MESMA TRAVA da baixa, mesma chave: é o que garante que "consultar o tombstone"
  -- e "inserir o tombstone" nunca se cruzem com "inserir a venda" e "aplicar a baixa".
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || '|' || p_ref_venda, 0));

  -- 1) Só estorna o que foi DE FATO baixado — `quantidade` é o delta aplicado.
  select abs(quantidade), codigo into v_qtd, v_codigo
  from public.estoque_movimentos
  where org_id = p_org and referencia_externa = p_ref_venda and motivo = 'venda'
  for update;

  if v_qtd is null then
    -- TOMBSTONE. Ocupa a MESMA referência do estorno, então é idempotente por construção.
    begin
      insert into public.estoque_movimentos
        (org_id, codigo, codigo_pai, quantidade, motivo, canal_origem,
         referencia_externa, push_canal_origem)
      values (p_org, p_codigo, '', 0, 'cancelamento_sem_baixa',
              p_canal, v_ref_estorno, null);
    exception when unique_violation then
      null;   -- já marcado numa execução anterior
    end;
    return jsonb_build_object('aplicado', false, 'motivo', 'sem_baixa_registrada');
  end if;

  -- 2) Idempotência do próprio estorno.
  begin
    insert into public.estoque_movimentos
      (org_id, codigo, quantidade, motivo, canal_origem, referencia_externa, push_canal_origem)
    values (p_org, v_codigo, v_qtd, 'estorno_venda', p_canal, v_ref_estorno, null)
    returning id into v_mov;
  exception when unique_violation then
    return jsonb_build_object('aplicado', false, 'motivo', 'duplicata');
  end;

  select v.id, f.codigo_pai into v_var, v_pai
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = v_codigo
  order by f.criado_em desc
  limit 1;

  if v_var is null then
    -- Preserva a trilha (espelha 'venda_sku_nao_encontrado') em vez de apagar o
    -- movimento — estorno de SKU sumido é evento que alguém precisa ver.
    update public.estoque_movimentos
    set motivo = 'estorno_sku_nao_encontrado', quantidade = 0
    where id = v_mov;
    return jsonb_build_object('aplicado', false, 'motivo', 'sku_nao_encontrado');
  end if;

  select estoque into v_antes from public.variacoes where id = v_var for update;

  update public.variacoes set estoque = estoque + v_qtd
  where id = v_var
  returning estoque into v_novo;

  update public.estoque_movimentos
  set codigo_pai = v_pai, estoque_anterior = v_antes, estoque_resultante = v_novo
  where id = v_mov;

  return jsonb_build_object(
    'aplicado', true, 'motivo', 'estorno_venda', 'movimento_id', v_mov, 'codigo_pai', v_pai,
    'estoque_anterior', v_antes, 'estoque_resultante', v_novo
  );
end $$;

-- ----------------------------------------------------------------------------
-- registrar_entrada — entrada de mercadoria (D-9).
-- Custo é caminho financeiro (ADR-0055): valor inválido FALHA em vez de virar
-- default silencioso; custo ausente soma quantidade sem tocar o custo.
-- p_ref dá idempotência (obrigatório): sem ela, duplo clique na tela ou retry de
-- rede soma o saldo 2× e sobrescreve o custo 2×. Devolve null em duplicata.
-- ----------------------------------------------------------------------------
create or replace function public.registrar_entrada(
  p_org uuid, p_codigo text, p_qtd integer, p_custo numeric,
  p_doc text, p_obs text, p_criado_por uuid, p_ref text
) returns integer language plpgsql security definer set search_path = ''
as $$
declare v_var uuid; v_pai text; v_antes integer; v_novo integer; v_mov uuid;
begin
  if p_qtd is null or p_qtd <= 0 then
    raise exception 'registrar_entrada: quantidade deve ser positiva (recebeu %)', p_qtd;
  end if;
  if p_custo is not null and p_custo <= 0 then
    raise exception 'registrar_entrada: custo deve ser positivo quando informado (recebeu %)', p_custo;
  end if;
  if p_ref is null or btrim(p_ref) = '' then
    raise exception 'registrar_entrada: referência de idempotência é obrigatória';
  end if;

  select v.id, f.codigo_pai into v_var, v_pai
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo
  order by f.criado_em desc
  limit 1;

  if v_var is null then
    raise exception 'registrar_entrada: SKU % não encontrado na organização', p_codigo;
  end if;

  -- Idempotência primeiro: a unique parcial rejeita a 2ª aplicação da mesma referência.
  begin
    insert into public.estoque_movimentos
      (org_id, codigo, codigo_pai, quantidade, motivo, custo_unitario, documento,
       observacao, criado_por, referencia_externa, push_canal_origem)
    values (p_org, p_codigo, v_pai, p_qtd, 'entrada', p_custo, p_doc,
            p_obs, p_criado_por, p_ref, null)
    returning id into v_mov;
  exception when unique_violation then
    return null;
  end;

  select estoque into v_antes from public.variacoes where id = v_var for update;

  update public.variacoes
  set estoque = estoque + p_qtd,
      custo   = coalesce(p_custo, custo)
  where id = v_var
  returning estoque into v_novo;

  update public.estoque_movimentos
  set estoque_anterior = v_antes, estoque_resultante = v_novo
  where id = v_mov;

  return v_novo;
end $$;

-- ----------------------------------------------------------------------------
-- Bloqueio da escrita direta de estoque (D-20).
--
-- POR QUE UM TRIGGER, E NÃO `revoke update (estoque)`: em Postgres os privilégios de
-- tabela e de coluna são CUMULATIVOS e não existe "deny" de coluna. Como `authenticated`
-- tem UPDATE na tabela inteira (RLS do E7, 20260705165828_e7_rls_org.sql:13-21), revogar
-- só a coluna não bloqueia nada — a proteção pareceria aplicada e seria inócua. A
-- alternativa (revogar a tabela e reconceder coluna a coluna) exigiria enumerar todas as
-- colunas editáveis e quebraria a cada coluna nova. O trigger é preciso, à prova de
-- coluna nova, e preserva o service_role (auth.uid() null).
--
-- `is distinct from` de propósito: um UPDATE que inclui `estoque` no SET com o MESMO
-- valor (formulário que reenvia o objeto inteiro) passa. Só barra mudança real.
-- ----------------------------------------------------------------------------
create or replace function public.bloquear_escrita_direta_estoque()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.estoque is distinct from old.estoque and auth.uid() is not null then
    raise exception
      'Estoque não pode ser alterado diretamente. Use Entrada de estoque (ADR-0094, D-15).'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger variacoes_bloquear_escrita_direta_estoque
  before update of estoque on public.variacoes
  for each row execute procedure public.bloquear_escrita_direta_estoque();

-- ----------------------------------------------------------------------------
-- Permissões. Padrão do repo (ver 20260723215424_adr88_reconciliacao_tentativas.sql:80-81):
-- revogar de todo mundo E conceder explicitamente ao service_role. Sem o grant, as
-- RPCs ficam inexecutáveis também pelas edge functions.
-- ----------------------------------------------------------------------------
revoke execute on function public.baixar_estoque(uuid, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.baixar_estoque(uuid, text, integer, text, text)
  to service_role;

revoke execute on function public.estornar_estoque(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.estornar_estoque(uuid, text, text, text)
  to service_role;

revoke execute on function public.registrar_entrada(uuid, text, integer, numeric, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.registrar_entrada(uuid, text, integer, numeric, text, text, uuid, text)
  to service_role;
