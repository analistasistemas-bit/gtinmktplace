-- ADR-0207 — Reposição de estoque e pedido de compra: modelo de dados, RLS, recebimento atômico, módulo e categoria.
--
-- Escrita só pela edge (service_role) e pelas RPCs; authenticated só lê a própria org.
-- ORDEM DE LOCKS (evita deadlock entre nota, entrada manual e desfazer): pedido de compra PRIMEIRO, depois
-- fornecedor, depois variações. Entrada manual: `reposicao_validar_pedido` (trava o pedido) roda antes do lançamento; a baixa, depois.
-- Nota: advisory da nota → pedido → fornecedor → variações. Desfazer nota: advisory → pedidos → variações.
-- `db push` não roda em transação: cada bloco é re-executável até onde dá (if not exists / drop if exists).
-- Ordem de deploy (Task 9): a edge `usuarios` que conhece o menu 'reposicao' e a categoria sobe ANTES desta
-- migration — senão uma edição de permissão pela edge antiga apaga a chave recém-acrescentada (lição do ADR-0134).

-- 1. Parâmetros por org e múltiplo de compra por produto ------------------------------------------------------------
create table if not exists public.reposicao_config (
  org_id          uuid primary key references public.organizations(id) on delete cascade,
  prazo_dias      int not null check (prazo_dias between 1 and 180),
  cobertura_dias  int not null check (cobertura_dias between 1 and 365),
  atualizado_por  uuid references auth.users(id),
  atualizado_em   timestamptz not null default now()
);

alter table public.familias add column if not exists multiplo_compra int not null default 1
  constraint familias_multiplo_compra_check check (multiplo_compra >= 1);

-- 2. Fornecedor como cadastro da org (nome normalizado por caixa e acento; CNPJ opcional) -------------------------
create table if not exists public.fornecedores (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  nome              text not null,
  nome_normalizado  text not null,
  cnpj              text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  criado_em         timestamptz not null default now(),
  unique (org_id, nome_normalizado),
  unique (id, org_id)   -- alvo das FKs compostas: pedido nunca aponta fornecedor de outra org
);

-- 3. Não repor por SKU, cor ou família -------------------------------------------------------------------------------
create table if not exists public.reposicao_nao_repor (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  escopo      text not null check (escopo in ('sku','cor','familia')),
  codigo_pai  text not null,
  codigo      text,
  cor         text,
  criado_por  uuid references auth.users(id),
  criado_em   timestamptz not null default now()
);
create unique index if not exists reposicao_nao_repor_unico
  on public.reposicao_nao_repor (org_id, escopo, codigo_pai, coalesce(codigo, ''), coalesce(cor, ''));

-- 4. Pedido de compra -------------------------------------------------------------------------------------------------
create table if not exists public.pedidos_compra (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  fornecedor_id  uuid not null,
  status         text not null default 'rascunho'
                 check (status in ('rascunho','aprovado','enviado','parcial','recebido','saldo_encerrado')),
  previsto_para  date,
  criado_por     uuid references auth.users(id),
  criado_em      timestamptz not null default now(),
  salvo_por      uuid references auth.users(id),
  salvo_em       timestamptz,
  aprovado_por   uuid references auth.users(id),
  aprovado_em    timestamptz,
  enviado_em     timestamptz,
  alterado_por   uuid references auth.users(id),
  alterado_em    timestamptz,
  ref_aprovacao  text unique,
  unique (id, org_id),
  foreign key (fornecedor_id, org_id) references public.fornecedores(id, org_id)
);
-- Um rascunho por fornecedor: é da org, salvo e compartilhado.
create unique index if not exists pedidos_compra_um_rascunho
  on public.pedidos_compra (org_id, fornecedor_id) where status = 'rascunho';
create index if not exists pedidos_compra_org_status on public.pedidos_compra (org_id, status);

create table if not exists public.pedidos_compra_itens (
  pedido_id   uuid not null,
  org_id      uuid not null,
  codigo      text not null,
  codigo_pai  text not null,
  quantidade  int not null check (quantidade > 0),
  sugerida    int,
  recebida    int not null default 0,
  encerrado   boolean not null default false,
  primary key (pedido_id, codigo),
  foreign key (pedido_id, org_id) references public.pedidos_compra(id, org_id) on delete cascade,
  -- Excedente entra no estoque e fecha o item; o saldo nunca fica negativo.
  check (recebida between 0 and quantidade)
);

create table if not exists public.pedidos_compra_recebimentos (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  pedido_id           uuid not null,
  codigo              text not null,
  quantidade          int not null check (quantidade > 0),   -- o que entrou no estoque (pode passar do pedido)
  referencia_externa  text not null,                         -- a do movimento de estoque: idempotência
  criado_em           timestamptz not null default now(),
  desfeito_em         timestamptz,
  unique (org_id, referencia_externa),
  foreign key (pedido_id, codigo) references public.pedidos_compra_itens(pedido_id, codigo)
);
create index if not exists pedidos_compra_recebimentos_item on public.pedidos_compra_recebimentos (pedido_id, codigo);

-- 5. Foto diária da sugestão (previsto × vendido) ---------------------------------------------------------------------
create table if not exists public.reposicao_fotos (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  dia         date not null,
  codigo      text not null,
  codigo_pai  text not null,
  estoque     int,
  velocidade  numeric,
  w           numeric,
  sugestao    int,
  urgencia    text,
  primary key (org_id, dia, codigo)
);

-- 6. RLS: leitura da própria org; escrita só service_role e RPCs ------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['reposicao_config','fornecedores','reposicao_nao_repor','pedidos_compra',
                           'pedidos_compra_itens','pedidos_compra_recebimentos','reposicao_fotos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || ': select org', t);
    execute format('create policy %I on public.%I for select to authenticated using (org_id = (select public.current_org_id()))',
                   t || ': select org', t);
    -- Default privileges do Supabase dão ALL (inclui TRUNCATE, que RLS não cobre).
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- 7. Recebimento ------------------------------------------------------------------------------------------------------
-- Status pela regra única: tudo recebido ou encerrado → recebido (saldo_encerrado continua encerrado);
-- algo recebido → parcial; nada → enviado se já foi enviado, senão aprovado. Peça interna: ninguém executa direto.
create or replace function public.reposicao_recalcular_status(p_pedido uuid)
returns text language plpgsql security invoker set search_path = ''
as $$
declare v_status text;
begin
  update public.pedidos_compra p
     set status = case
       when not exists (select 1 from public.pedidos_compra_itens i
                         where i.pedido_id = p.id and i.recebida < i.quantidade and not i.encerrado)
         then case when p.status = 'saldo_encerrado' then 'saldo_encerrado' else 'recebido' end
       when exists (select 1 from public.pedidos_compra_itens i where i.pedido_id = p.id and i.recebida > 0) then 'parcial'
       when p.enviado_em is not null then 'enviado'
       else 'aprovado' end
   where p.id = p_pedido
  returning p.status into v_status;
  return v_status;
end $$;
revoke all on function public.reposicao_recalcular_status(uuid) from public, anon, authenticated, service_role;

-- Baixa do pedido por uma entrada de estoque. Idempotente pela referência do movimento; atômica: um único UPDATE
-- com `least`, sob o lock do pedido (dois recebimentos concorrentes serializam e nunca violam o CHECK).
create or replace function public.reposicao_receber(
  p_org uuid, p_pedido uuid, p_codigo text, p_quantidade integer, p_ref text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_status text; v_id uuid; v_recebida int; v_qtd int;
begin
  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'reposicao_receber: quantidade deve ser positiva (recebeu %)', p_quantidade using errcode = '22023';
  end if;
  if p_ref is null or btrim(p_ref) = '' then
    raise exception 'reposicao_receber: referência de idempotência é obrigatória' using errcode = '22023';
  end if;

  select status into v_status from public.pedidos_compra where id = p_pedido and org_id = p_org for update;
  if not found then
    raise exception 'reposicao_receber: pedido de compra não encontrado nesta organização' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.pedidos_compra_recebimentos where org_id = p_org and referencia_externa = p_ref) then
    -- `recebido` aceita: excedente que chega depois (2ª linha da nota, bonificação) entra no estoque e só fica
    -- no ledger — `least` mantém o item fechado. Rascunho e saldo encerrado recusam.
    if v_status not in ('aprovado','enviado','parcial','recebido') then
      raise exception 'reposicao_receber: o pedido está %; só pedido aprovado, enviado, parcial ou recebido recebe mercadoria', v_status
        using errcode = '23514';
    end if;
    if not exists (select 1 from public.pedidos_compra_itens where pedido_id = p_pedido and codigo = p_codigo) then
      raise exception 'reposicao_receber: o produto % não está neste pedido', p_codigo using errcode = '23514';
    end if;

    insert into public.pedidos_compra_recebimentos (org_id, pedido_id, codigo, quantidade, referencia_externa)
    values (p_org, p_pedido, p_codigo, p_quantidade, p_ref)
    on conflict (org_id, referencia_externa) do nothing
    returning id into v_id;

    if v_id is not null then
      update public.pedidos_compra_itens
         set recebida = least(quantidade, recebida + p_quantidade)
       where pedido_id = p_pedido and codigo = p_codigo;
      v_status := public.reposicao_recalcular_status(p_pedido);
    end if;
  end if;

  select recebida, quantidade into v_recebida, v_qtd
    from public.pedidos_compra_itens where pedido_id = p_pedido and codigo = p_codigo;
  return jsonb_build_object('recebida', v_recebida, 'saldo', v_qtd - v_recebida, 'status_pedido', v_status);
end $$;

-- Desfaz recebimentos (ex.: desfazer nota). `recebida` é recalculada do ledger ativo, com teto no pedido: com
-- excedente, desfazer só a entrada que passou do pedido mantém o que as outras trouxeram (piso 0).
create or replace function public.reposicao_desfazer_recebimentos(p_org uuid, p_refs text[])
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_n int; v_pedidos uuid[]; v_p uuid;
begin
  -- Trava os pedidos tocados em ordem fixa antes de mexer nos itens.
  perform 1 from public.pedidos_compra p
   where p.org_id = p_org
     and p.id in (select pedido_id from public.pedidos_compra_recebimentos
                   where org_id = p_org and referencia_externa = any(p_refs) and desfeito_em is null)
   order by p.id for update;

  -- `desfeito_em is null`: desfazer duas vezes não subtrai duas vezes.
  with d as (
    update public.pedidos_compra_recebimentos
       set desfeito_em = now()
     where org_id = p_org and referencia_externa = any(p_refs) and desfeito_em is null
    returning pedido_id
  )
  select count(*), coalesce(array_agg(distinct pedido_id order by pedido_id), '{}') into v_n, v_pedidos from d;

  update public.pedidos_compra_itens i
     set recebida = least(i.quantidade, coalesce((
           select sum(r.quantidade) from public.pedidos_compra_recebimentos r
            where r.pedido_id = i.pedido_id and r.codigo = i.codigo and r.desfeito_em is null), 0))
   where i.pedido_id = any(v_pedidos);

  foreach v_p in array v_pedidos loop
    perform public.reposicao_recalcular_status(v_p);
  end loop;
  return v_n;
end $$;

-- Trava (for update) e valida o pedido sem gravar nada: pertence à org, status aceito e, se informado, tem o SKU.
-- Primeiro lock da entrada manual vinculada, antes de qualquer variação.
create or replace function public.reposicao_validar_pedido(p_org uuid, p_pedido uuid, p_codigo text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_status text;
begin
  select status into v_status from public.pedidos_compra where id = p_pedido and org_id = p_org for update;
  if not found then
    raise exception 'reposicao_validar_pedido: pedido de compra não encontrado nesta organização' using errcode = 'P0002';
  end if;
  if v_status not in ('aprovado','enviado','parcial','recebido') then
    raise exception 'reposicao_validar_pedido: o pedido está %; não recebe mercadoria', v_status using errcode = '23514';
  end if;
  if p_codigo is not null and not exists (
       select 1 from public.pedidos_compra_itens where pedido_id = p_pedido and codigo = p_codigo) then
    raise exception 'reposicao_validar_pedido: o produto % não está neste pedido', p_codigo using errcode = '23514';
  end if;
end $$;
revoke all on function public.reposicao_validar_pedido(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reposicao_validar_pedido(uuid, uuid, text) to service_role, estoque_rpc_executor;

-- ACL antes de qualquer troca de dono. `reposicao_receber` também é chamada de dentro de `registrar_entrada`, que
-- roda como `estoque_rpc_executor`: daí o execute para esse papel (NOLOGIN, fora de service_role).
-- EXCEÇÃO FORMAL à regra "RPC nova executável só por service_role" (ruling da Task 1, ADR-0207), que vale também
-- para `reposicao_validar_pedido` acima: o papel não tem
-- login nem é concedido a ninguém, então não abre acesso por JWT; sem ele a entrada vinculada não funciona.
revoke all on function public.reposicao_receber(uuid, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.reposicao_receber(uuid, uuid, text, integer, text) to service_role, estoque_rpc_executor;
revoke all on function public.reposicao_desfazer_recebimentos(uuid, text[]) from public, anon, authenticated;
grant execute on function public.reposicao_desfazer_recebimentos(uuid, text[]) to service_role;

-- 8. registrar_entrada ganha p_pedido_compra ---------------------------------------------------------------------------
-- Corpo vigente de 20261108105448_kit_variacao_correcoes_finais.sql + o recebimento na mesma transação. Sem o
-- parâmetro, comportamento idêntico. A assinatura antiga sai (sem sobrecarga); chamadas com 8 argumentos, nomeados
-- ou posicionais, caem nesta pelo default. Dono e ACL voltam a ser os de hoje.
grant estoque_rpc_executor to postgres;
grant usage, create on schema public to estoque_rpc_executor;

drop function if exists public.registrar_entrada(uuid, text, integer, numeric, text, text, uuid, text);
create or replace function public.registrar_entrada(
  p_org uuid, p_codigo text, p_qtd integer, p_custo numeric,
  p_doc text, p_obs text, p_criado_por uuid, p_ref text, p_pedido_compra uuid default null
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
  order by f.criado_em desc, f.id desc
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

  -- ADR-0207 §16: trava e valida o pedido ANTES de tocar a variação (ordem de locks: pedido primeiro), sem gravar.
  -- A baixa só é escrita depois do INSERT bem-sucedido do movimento: ref duplicada (inclusive de uma entrada
  -- concorrente sem pedido que confirma antes) cai no `return null` sem deixar recebimento órfão.
  if p_pedido_compra is not null then
    perform public.reposicao_validar_pedido(p_org, p_pedido_compra, p_codigo);
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

  -- ADR-0200: a exceção derruba também o insert acima.
  if public.kit_sku_em_transferencia(p_org, p_codigo) then
    raise exception 'sku_em_transferencia: % está em transferência de kit. Repita a entrada depois.', p_codigo
      using errcode = '23514';
  end if;

  update public.variacoes
  set estoque = estoque + p_qtd,
      custo   = coalesce(p_custo, custo)
  where id = v_var
  returning estoque into v_novo;

  update public.estoque_movimentos
  set estoque_anterior = v_antes, estoque_resultante = v_novo
  where id = v_mov;

  -- Movimento novo desta chamada: agora sim a baixa, na mesma transação (recusa derruba a entrada inteira).
  if p_pedido_compra is not null then
    perform public.reposicao_receber(p_org, p_pedido_compra, p_codigo, p_qtd, p_ref);
  end if;

  return v_novo;
end $$;

revoke all on function public.registrar_entrada(uuid, text, integer, numeric, text, text, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_entrada(uuid, text, integer, numeric, text, text, uuid, text, uuid)
  to service_role;
alter function public.registrar_entrada(uuid, text, integer, numeric, text, text, uuid, text, uuid)
  owner to estoque_rpc_executor;

revoke create on schema public from estoque_rpc_executor;
-- Tolerante como em 20260811203500: o membership de postgres tem grantor supabase_admin.
do $$
begin
  revoke estoque_rpc_executor from postgres;
exception when others then
  raise warning 'membership de postgres em estoque_rpc_executor nao revogada: %', sqlerrm;
end $$;

-- 9. importar_nota_compra ganha p_pedido_compra ------------------------------------------------------------------------
-- Corpo vigente de 20261108105448_kit_variacao_correcoes_finais.sql. Security invoker e dono postgres como hoje.
-- Com o pedido: fornecedor com CNPJ diferente do emitente recusa; sem CNPJ, só grava o do emitente com a confirmação
-- explícita do operador (`p_vincular_cnpj`), senão recusa. Só os SKUs que estão no pedido baixam; o resto da nota
-- entra no estoque como sempre.
drop function if exists public.importar_nota_compra(uuid, uuid, jsonb, jsonb);
create or replace function public.importar_nota_compra(
  p_org uuid, p_user uuid, p_nota jsonb, p_itens jsonb, p_pedido_compra uuid default null,
  p_vincular_cnpj boolean default false
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_chave text := p_nota->>'chave';
  v_nota uuid; v_status text; v_item jsonb; v_item_id uuid; v_d jsonb; v_doc text; v_pais jsonb;
  v_ref text; v_ret integer; v_lancada integer; v_orfas text;
  v_forn uuid; v_cnpj text; v_pst text;
begin
  -- Serializa importações concorrentes da MESMA nota: a segunda espera e cai em "duplicada"
  -- em vez de estourar a unique (org_id, chave).
  perform pg_advisory_xact_lock(hashtextextended('nfe:' || p_org::text || ':' || v_chave, 0));

  select id, status into v_nota, v_status from public.notas_compra
   where org_id = p_org and chave = v_chave;

  if v_nota is not null and v_status <> 'importada' then
    raise exception 'importar_nota_compra: a nota % está %; não pode ser reimportada', v_chave, v_status
      using errcode = '23514';
  end if;

  if v_nota is null then
    -- ADR-0207 §16: valida o pedido ANTES de lançar qualquer estoque. Locks: pedido → fornecedor → variações.
    if p_pedido_compra is not null then
      select p.status, p.fornecedor_id into v_pst, v_forn
        from public.pedidos_compra p where p.id = p_pedido_compra and p.org_id = p_org for update;
      if v_forn is null then
        raise exception 'importar_nota_compra: pedido de compra não encontrado nesta organização' using errcode = 'P0002';
      end if;
      if v_pst not in ('aprovado','enviado','parcial','recebido') then
        raise exception 'importar_nota_compra: o pedido está %; não recebe mercadoria', v_pst using errcode = '23514';
      end if;
      -- SKU fora do pedido entra sem baixa (a nota pode trazer outros produtos); nenhum no pedido = pedido errado.
      if not exists (
           select 1 from jsonb_array_elements(p_itens) it
             cross join lateral jsonb_array_elements(it->'distribuicao') d
            where exists (select 1 from public.pedidos_compra_itens pi
                           where pi.pedido_id = p_pedido_compra and pi.codigo = d->>'codigo')) then
        raise exception 'importar_nota_compra: nenhum produto da nota está neste pedido' using errcode = '23514';
      end if;
      -- Entrada do fornecedor B nunca baixa pedido do fornecedor A.
      select f.cnpj into v_cnpj from public.fornecedores f where f.id = v_forn for update;
      if v_cnpj is not null and v_cnpj <> p_nota->>'emitente_cnpj' then
        raise exception 'importar_nota_compra: pedido de outro fornecedor (CNPJ do pedido %, da nota %)',
          v_cnpj, p_nota->>'emitente_cnpj' using errcode = '23514';
      end if;
      -- Sem CNPJ: a nota de B escolhida no pedido de A amarraria o CNPJ de B em A para sempre. Só com confirmação.
      if v_cnpj is null and not coalesce(p_vincular_cnpj, false) then
        raise exception 'importar_nota_compra: fornecedor do pedido sem CNPJ; confirme que ele passa a ser identificado pelo CNPJ %',
          p_nota->>'emitente_cnpj' using errcode = '23514';
      end if;
      if v_cnpj is null then
        update public.fornecedores set cnpj = p_nota->>'emitente_cnpj' where id = v_forn;
      end if;
    end if;

    insert into public.notas_compra (org_id, chave, numero, serie, emitente_cnpj, emitente_nome,
      emitida_em, valor_total, assinada, xml_path, xml_sha256, divergencia_total_aceita, importada_por)
    values (p_org, v_chave, (p_nota->>'numero')::int, (p_nota->>'serie')::int,
      p_nota->>'emitente_cnpj', p_nota->>'emitente_nome', (p_nota->>'emitida_em')::timestamptz,
      (p_nota->>'valor_total')::numeric, (p_nota->>'assinada')::boolean, p_nota->>'xml_path',
      p_nota->>'xml_sha256', nullif(p_nota->>'divergencia_total_aceita', '')::numeric, p_user)
    returning id into v_nota;

    v_doc := 'NF-e ' || (p_nota->>'numero') || ' · ' || (p_nota->>'emitente_nome');

    for v_item in select * from jsonb_array_elements(p_itens) loop
      insert into public.notas_compra_itens (nota_id, org_id, n_item, cprod, xprod, ncm, cfop, gtin,
        ucom, qcom, fator_conversao, v_prod, v_frete, v_seg, v_desc, v_outro, v_ipi, v_st, v_fcpst, rateio,
        orig, codigo_pai)
      values (v_nota, p_org, (v_item->>'n_item')::smallint, v_item->>'cprod', v_item->>'xprod',
        v_item->>'ncm', v_item->>'cfop', v_item->>'gtin', v_item->>'ucom', (v_item->>'qcom')::numeric,
        (v_item->>'fator_conversao')::int, (v_item->>'v_prod')::numeric, (v_item->>'v_frete')::numeric,
        (v_item->>'v_seg')::numeric, (v_item->>'v_desc')::numeric, (v_item->>'v_outro')::numeric,
        (v_item->>'v_ipi')::numeric, (v_item->>'v_st')::numeric, coalesce((v_item->>'v_fcpst')::numeric, 0),
        coalesce(v_item->'rateio', '{}'::jsonb),
        (v_item->>'orig')::smallint, v_item->>'codigo_pai')
      returning id into v_item_id;

      insert into public.vinculos_fornecedor (org_id, cnpj_fornecedor, cprod, codigo_pai, fator_conversao)
      values (p_org, p_nota->>'emitente_cnpj', v_item->>'cprod', v_item->>'codigo_pai',
        (v_item->>'fator_conversao')::int)
      on conflict (org_id, cnpj_fornecedor, cprod) do update
        set codigo_pai = excluded.codigo_pai, fator_conversao = excluded.fator_conversao,
            atualizado_em = now();

      for v_d in select * from jsonb_array_elements(v_item->'distribuicao') loop
        insert into public.notas_compra_distribuicao (item_id, org_id, codigo, quantidade,
          custo_aquisicao_unit, custo_precificacao_unit)
        values (v_item_id, p_org, v_d->>'codigo', (v_d->>'quantidade')::int,
          (v_d->>'custo_aquisicao_unit')::numeric, (v_d->>'custo_precificacao_unit')::numeric);

        -- Ledger guarda o custo de PRECIFICAÇÃO (D-3); o de aquisição fica na nota.
        v_ref := 'nfe:' || v_chave || ':' || (v_item->>'n_item') || ':' || (v_d->>'codigo');
        v_ret := public.registrar_entrada(p_org, v_d->>'codigo', (v_d->>'quantidade')::int,
          (v_d->>'custo_precificacao_unit')::numeric, v_doc, null, p_user, v_ref);
        if v_ret is null then
          -- Ref já aplicada: a variação nasceu pelo fluxo existente com a referência da nota (D-8).
          -- A quantidade lançada tem de ser a da nota, senão a nota e o ledger divergem.
          select m.quantidade into v_lancada from public.estoque_movimentos m
           where m.org_id = p_org and m.referencia_externa = v_ref;
          if v_lancada is distinct from (v_d->>'quantidade')::int then
            raise exception 'importar_nota_compra: % já recebeu % unidades por esta nota; a distribuição diz %',
              v_d->>'codigo', v_lancada, v_d->>'quantidade' using errcode = '23514';
          end if;
          -- R5-I1: registrar_entrada não atualiza o custo quando a ref é duplicada. O custo confirmado
          -- na nota vai para a variação canônica (só custo; saldo e ledger intocados).
          update public.variacoes v set custo = (v_d->>'custo_precificacao_unit')::numeric
           where v.id = (select v2.id from public.variacoes v2 join public.familias f on f.id = v2.familia_id
                          where v2.org_id = p_org and v2.codigo = v_d->>'codigo' order by f.criado_em desc, f.id desc limit 1);
        end if;

        -- ADR-0207 §16: baixa do pedido com a ref do movimento, na mesma transação (idempotente pela ref).
        if p_pedido_compra is not null and exists (
             select 1 from public.pedidos_compra_itens pi
              where pi.pedido_id = p_pedido_compra and pi.codigo = v_d->>'codigo') then
          perform public.reposicao_receber(p_org, p_pedido_compra, v_d->>'codigo', (v_d->>'quantidade')::int, v_ref);
        end if;
      end loop;
    end loop;

    -- R3-B1: toda entrada já lançada com a ref desta nota (ex.: variação criada pela D-8) tem de
    -- estar na distribuição confirmada. Senão a nota de 35 viraria 40 no estoque.
    select string_agg(m.codigo, ', ' order by m.codigo) into v_orfas
      from public.estoque_movimentos m
     where m.org_id = p_org and m.referencia_externa like 'nfe:' || v_chave || ':%'
       and not exists (
         select 1 from public.notas_compra_distribuicao d
           join public.notas_compra_itens i on i.id = d.item_id
          where i.nota_id = v_nota
            and m.referencia_externa = 'nfe:' || v_chave || ':' || i.n_item || ':' || d.codigo);
    if v_orfas is not null then
      raise exception 'importar_nota_compra: já houve entrada por esta nota em % fora da distribuição', v_orfas
        using errcode = '23514';
    end if;
  end if;

  -- Produtos tocados lidos do LEDGER (distribuição pode cair em outro produto, D-7).
  select coalesce(jsonb_agg(distinct m.codigo_pai), '[]'::jsonb) into v_pais
    from public.estoque_movimentos m
   where m.org_id = p_org and m.referencia_externa like 'nfe:' || v_chave || ':%';

  return jsonb_build_object('nota_id', v_nota, 'duplicada', v_status is not null, 'codigos_pai', v_pais);
end $$;
revoke all on function public.importar_nota_compra(uuid, uuid, jsonb, jsonb, uuid, boolean) from public, anon, authenticated;
grant execute on function public.importar_nota_compra(uuid, uuid, jsonb, jsonb, uuid, boolean) to service_role;

-- 10. desfazer_nota_compra desfaz também a baixa do pedido ------------------------------------------------------------
-- Corpo vigente de 20261108105448_kit_variacao_correcoes_finais.sql + a chamada a reposicao_desfazer_recebimentos.
-- Mesma assinatura: `create or replace` mantém dono e ACL.
create or replace function public.desfazer_nota_compra(
  p_org uuid, p_user uuid, p_nota_id uuid, p_status text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare v_chave text; v_numero int; v_status text; r record; v_faltas text; v_pais jsonb;
  v_id uuid; v_saldo int;
begin
  if p_status not in ('desfeita','cancelada') then
    raise exception 'desfazer_nota_compra: status inválido %', p_status using errcode = '22023';
  end if;
  select chave into v_chave from public.notas_compra where id = p_nota_id and org_id = p_org;
  if v_chave is null then raise exception 'desfazer_nota_compra: nota não encontrada' using errcode = 'P0002'; end if;

  perform pg_advisory_xact_lock(hashtextextended('nfe:' || p_org::text || ':' || v_chave, 0));

  select numero, status into v_numero, v_status from public.notas_compra
   where id = p_nota_id and org_id = p_org for update;

  if v_status = 'importada' then
    -- ADR-0207: pedidos vinculados travados ANTES das variações (mesma ordem da entrada manual e da nota).
    perform 1 from public.pedidos_compra p
     where p.org_id = p_org
       and p.id in (select rc.pedido_id from public.pedidos_compra_recebimentos rc
                     where rc.org_id = p_org and rc.referencia_externa like 'nfe:' || v_chave || ':%' and rc.desfeito_em is null)
     order by p.id for update;

    create temp table if not exists _nfe_desfazer (codigo text, id uuid, qtd int, saldo int) on commit drop;
    truncate _nfe_desfazer;

    -- Trava a variação CANÔNICA de cada SKU (ordem determinística) e lê o saldo na mesma linha travada.
    for r in select d.codigo, sum(d.quantidade)::int as qtd
               from public.notas_compra_distribuicao d join public.notas_compra_itens i on i.id = d.item_id
              where i.nota_id = p_nota_id group by d.codigo order by d.codigo loop
      v_id := null; v_saldo := null;
      select v.id, v.estoque into v_id, v_saldo
        from public.variacoes v join public.familias f on f.id = v.familia_id
       where v.org_id = p_org and v.codigo = r.codigo
       order by f.criado_em desc, f.id desc limit 1
       for update of v;
      insert into _nfe_desfazer values (r.codigo, v_id, r.qtd, v_saldo);
    end loop;

    select string_agg(codigo || ' (saldo ' || saldo || ', nota ' || qtd || ')', ', ' order by codigo)
      into v_faltas from _nfe_desfazer where saldo < qtd;
    if v_faltas is not null then
      raise exception 'desfazer_nota_compra: saldo insuficiente em %', v_faltas using errcode = '23514';
    end if;

    for r in select * from _nfe_desfazer order by codigo loop
      perform public.ajustar_estoque(p_org, r.codigo, r.saldo - r.qtd,
        case p_status when 'desfeita' then 'Desfazer NF-e ' else 'NF-e cancelada ' end || v_numero,
        p_user, 'nfe-desfazer:' || v_chave || ':' || r.codigo);
      -- ajustar_estoque resolve o canônico de novo pelo código; se não for a linha travada
      -- (família nova inserida no meio), aborta tudo em vez de ajustar a linha errada.
      if (select v.id from public.variacoes v join public.familias f on f.id = v.familia_id
           where v.org_id = p_org and v.codigo = r.codigo
           order by f.criado_em desc, f.id desc limit 1) is distinct from r.id then
        raise exception 'desfazer_nota_compra: o produto % mudou durante o desfazer; tente de novo', r.codigo
          using errcode = '40001';
      end if;
    end loop;

    -- ADR-0207 §16: desfazer a nota desfaz a baixa do pedido.
    perform public.reposicao_desfazer_recebimentos(p_org, array(
      select m.referencia_externa from public.estoque_movimentos m
       where m.org_id = p_org and m.referencia_externa like 'nfe:' || v_chave || ':%'));

    update public.notas_compra set status = p_status, desfeita_por = p_user, desfeita_em = now()
     where id = p_nota_id;
  end if;

  -- Já desfeita/cancelada: no-op financeiro. Devolve os produtos para o retry reenfileirar o push.
  select coalesce(jsonb_agg(distinct m.codigo_pai), '[]'::jsonb) into v_pais
    from public.estoque_movimentos m
   where m.org_id = p_org and m.referencia_externa like 'nfe:' || v_chave || ':%';
  return jsonb_build_object('codigos_pai', v_pais, 'ja_estava', v_status <> 'importada');
end $$;

-- 11. Menu e categoria nova -----------------------------------------------------------------------------------------
-- Quem já vê Estoque passa a ver Reposição (o módulo 'reposicao' por org ainda decide se aparece).
update public.profiles set allowed_menus = array_append(allowed_menus, 'reposicao')
 where 'estoque' = any(allowed_menus) and not ('reposicao' = any(allowed_menus));

-- Lista vigente (20261111235456 e 20261103014103) + 'reposicao'. Sincronia manual com os dois categorias.ts.
alter table public.notificacoes drop constraint notificacoes_categoria_check;
alter table public.notificacoes add constraint notificacoes_categoria_check
  check (categoria in ('vendas','perguntas','pos_venda','financeiro','moderacao','mensagens','integracao','pulse','estoque','vendas_gerencial','resumo_diario','imagem_ia','reposicao'));

alter table public.profiles drop constraint if exists profiles_telegram_categorias_validas;
alter table public.profiles add constraint profiles_telegram_categorias_validas
  check (telegram_categorias <@ array['vendas','perguntas','pos_venda','financeiro','moderacao','mensagens','integracao','pulse','estoque','vendas_gerencial','resumo_diario','fechamento_mensal','reposicao']::text[]);
