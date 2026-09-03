-- ADR-0151 D-9, D-10, D-14: três invariantes de banco que impedem o kit vinculado de
-- criar um SEGUNDO número de estoque dessincronizado — a mesma classe de risco do
-- incidente do ADR-0129.
--
-- `create or replace` PRESERVA owner e ACL (a assinatura não muda), mas EXIGE ser o dono da
-- função. `registrar_entrada` e `ajustar_estoque` pertencem a `estoque_rpc_executor`, e as
-- três migrations anteriores que as tocaram terminam com `revoke estoque_rpc_executor from
-- postgres cascade` (20260804113000:47, 20260811201026:103, 20260811203500:49) — hoje
-- `postgres` NÃO é membro do role. Sem o grant abaixo, o `create or replace` falha.
--
-- `db push` não é transacional: se esta migration morrer entre o grant e o revoke, o
-- membership fica pendurado. Confira com
--   select 1 from pg_auth_members m join pg_roles r on r.oid = m.roleid
--    join pg_roles g on g.oid = m.member
--    where r.rolname = 'estoque_rpc_executor' and g.rolname = 'postgres';
-- e limpe à mão antes de repetir o push.
grant estoque_rpc_executor to postgres;

-- ---------------------------------------------------------------------------
-- D-9: entrada e ajuste recusam SKU de kit vinculado.
--
-- Sem isto, `registrar_entrada`/`ajustar_estoque` criariam um saldo REAL numa linha que o
-- resto do sistema trata como "sempre 0/irrelevante" — um segundo número dessincronizado.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_entrada(
  p_org uuid, p_codigo text, p_qtd integer, p_custo numeric,
  p_doc text, p_obs text, p_criado_por uuid, p_ref text
) returns integer language plpgsql security definer set search_path = ''
as $$
declare v_var uuid; v_pai text; v_antes integer; v_novo integer; v_mov uuid; v_kit smallint;
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

  select v.id, f.codigo_pai, f.kit_multiplicador into v_var, v_pai, v_kit
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo
  order by f.criado_em desc
  limit 1;

  if v_var is null then
    raise exception 'registrar_entrada: SKU % não encontrado na organização', p_codigo;
  end if;

  -- ADR-0151 D-9: kit vinculado não tem saldo próprio. Dar entrada aqui criaria um saldo
  -- real que o push, a publicação e a tela ignoram — dessincronização silenciosa.
  if v_kit is not null then
    raise exception 'registrar_entrada: % é um kit vinculado e não tem estoque próprio. Dê entrada no produto-base.', p_codigo
      using errcode = '23514';
  end if;

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

create or replace function public.ajustar_estoque(
  p_org uuid, p_codigo text, p_novo_saldo integer, p_obs text,
  p_criado_por uuid, p_ref text
) returns integer language plpgsql security definer set search_path = ''
as $$
declare v_var uuid; v_pai text; v_antes integer; v_novo integer; v_mov uuid; v_kit smallint;
begin
  if p_novo_saldo is null or p_novo_saldo < 0 then
    raise exception 'ajustar_estoque: novo saldo deve ser inteiro >= 0 (recebeu %)', p_novo_saldo;
  end if;
  if p_novo_saldo > 99999 then
    raise exception 'ajustar_estoque: novo saldo acima do teto do canal (99999): %', p_novo_saldo;
  end if;
  if p_ref is null or btrim(p_ref) = '' then
    raise exception 'ajustar_estoque: referência de idempotência é obrigatória';
  end if;

  select v.id, f.codigo_pai, f.kit_multiplicador into v_var, v_pai, v_kit
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo
  order by f.criado_em desc
  limit 1;

  if v_var is null then
    raise exception 'ajustar_estoque: SKU % não encontrado na organização', p_codigo;
  end if;

  -- ADR-0151 D-9, mesma razão da entrada.
  if v_kit is not null then
    raise exception 'ajustar_estoque: % é um kit vinculado e não tem estoque próprio. Ajuste o produto-base.', p_codigo
      using errcode = '23514';
  end if;

  begin
    insert into public.estoque_movimentos
      (org_id, codigo, codigo_pai, quantidade, motivo, observacao, criado_por,
       referencia_externa, push_canal_origem)
    values (p_org, p_codigo, v_pai, 0, 'ajuste', p_obs, p_criado_por, p_ref, null)
    returning id into v_mov;
  exception when unique_violation then
    return null;
  end;

  select estoque into v_antes from public.variacoes where id = v_var for update;

  if p_novo_saldo > v_antes then
    raise exception 'ajustar_estoque: ajuste só reduz saldo (atual %, pedido %). Para aumentar, use Entrada de mercadoria.', v_antes, p_novo_saldo;
  end if;

  update public.variacoes set estoque = p_novo_saldo
  where id = v_var
  returning estoque into v_novo;

  update public.estoque_movimentos
  set quantidade = v_novo - v_antes, estoque_anterior = v_antes, estoque_resultante = v_novo
  where id = v_mov;

  return v_novo;
end $$;

-- Devolve o privilégio elevado assim que as duas redefinições terminam. Mesmo fecho das
-- migrations 20260804113000:47, 20260811201026:103 e 20260811203500:49.
revoke estoque_rpc_executor from postgres cascade;

-- ---------------------------------------------------------------------------
-- D-10: adicionar variação/cor NOVA a uma base com kit vinculado vivo é recusado.
--
-- `estoque_base` viraria ambíguo entre variações: o resolvedor derivaria o kit de um
-- número que o operador não reconhece.
--
-- O predicado é "este `codigo` é NOVO sob este `codigo_pai`", e NÃO "esta família já tem
-- variação". Duas razões:
--   1) Reposição por planilha (UPDATE) cria uma família NOVA e reinsere as MESMAS variações
--      — o saldo do produto com kit tem de continuar podendo subir. Contar linhas da família
--      nova barraria a partir da segunda variação de um produto que sempre teve duas, e
--      deixaria passar a cor nova de um produto que só tinha uma.
--   2) `adicionar-variacoes-familia` insere clones + cores novas num ÚNICO `.insert()`
--      multi-linha (index.ts:231). Um guard que conta linhas da própria família depende da
--      ordem dos elementos do array e da visibilidade de linhas da mesma instrução —
--      comportamento que ninguém deveria precisar raciocinar para entender uma trava.
--      Perguntar "este código já existe sob este pai?" é imune às duas coisas.
-- ---------------------------------------------------------------------------
create or replace function public.bloquear_variacao_extra_com_kit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_pai text; v_org uuid;
begin
  select f.codigo_pai, f.org_id into v_pai, v_org
  from public.familias f where f.id = new.familia_id;
  if v_pai is null then return new; end if;

  -- SKU que já existe sob este produto = reposição/clone. Sempre permitido.
  if exists (
    select 1 from public.variacoes v
    join public.familias f2 on f2.id = v.familia_id
    where f2.org_id = v_org and f2.codigo_pai = v_pai
      and v.codigo = new.codigo and v.familia_id <> new.familia_id
  ) then
    return new;
  end if;

  -- SKU novo: só passa se o produto ainda não tinha NENHUMA variação (produto nascendo)…
  if not exists (
    select 1 from public.variacoes v
    join public.familias f3 on f3.id = v.familia_id
    where f3.org_id = v_org and f3.codigo_pai = v_pai
  ) then
    return new;
  end if;

  -- …ou se o produto não tem kit vinculado ativo.
  if exists (
    select 1 from public.familias k
    where k.org_id = v_org
      and k.kit_base_codigo_pai = v_pai
      and k.kit_multiplicador is not null
      and k.status in ('pronto', 'publicando', 'publicado')
  ) then
    raise exception 'Produto % tem kit vinculado ativo: remova os kits antes de adicionar variação/cor.', v_pai
      using errcode = '23514';
  end if;

  return new;
end $$;

create trigger variacoes_bloquear_extra_com_kit
  before insert on public.variacoes
  for each row execute procedure public.bloquear_variacao_extra_com_kit();

-- ---------------------------------------------------------------------------
-- D-14: apagar a família-base com kit vinculado vivo é recusado.
--
-- Kit órfão venderia contra uma base que não existe mais: a venda não teria onde debitar
-- e a Decisão 6 inteira quebraria. A guard fica no banco porque `remover-publicado` faz
-- DELETE direto na tabela — o app é a primeira linha (Step 3), esta é a última.
-- ---------------------------------------------------------------------------
create or replace function public.bloquear_remocao_base_com_kit()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  -- A própria família de kit sendo apagada nunca é bloqueada.
  if old.kit_multiplicador is not null then return old; end if;

  -- Só bloqueia quando esta é a ÚLTIMA linha de `familias` daquele codigo_pai: cada lote de
  -- UPDATE cria uma linha nova, e apagar uma delas não desfaz o produto.
  if exists (
    select 1 from public.familias o
    where o.org_id = old.org_id and o.codigo_pai = old.codigo_pai and o.id <> old.id
  ) then
    return old;
  end if;

  if exists (
    select 1 from public.familias k
    where k.org_id = old.org_id
      and k.kit_base_codigo_pai = old.codigo_pai
      and k.kit_multiplicador is not null
      and k.status in ('pronto', 'publicando', 'publicado')
  ) then
    raise exception 'Produto % tem kit vinculado ativo: remova os kits antes de remover o produto-base.', old.codigo_pai
      using errcode = '23514';
  end if;

  return old;
end $$;

create trigger familias_bloquear_remocao_com_kit
  before delete on public.familias
  for each row execute procedure public.bloquear_remocao_base_com_kit();
