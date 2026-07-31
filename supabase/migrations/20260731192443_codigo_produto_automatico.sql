-- Código de produto automático no cadastro manual (spec 2026-07-31).
-- Quem usa o módulo de estoque não tem ERP, logo não tem código de produto nem SKU — o
-- sistema passa a gerar os dois, numa sequência única e crescente por organização.

alter table public.organizations
  add column produto_seq bigint not null default 0;

comment on column public.organizations.produto_seq is
  'Sequência do código de produto gerado no cadastro manual (spec 2026-07-31). Só deve ser reservada via proximo_codigo_produto().';

alter table public.familias
  add column chave_cadastro uuid;

comment on column public.familias.chave_cadastro is
  'Idempotência do cadastro manual: uuid da submissão. Retry com a mesma chave devolve o cadastro original em vez de criar um segundo produto.';

-- Parcial de propósito: só o cadastro manual preenche a chave. O caminho de planilha deixa
-- null e não disputa a unique.
create unique index familias_org_chave_cadastro_key
  on public.familias (org_id, chave_cadastro) where chave_cadastro is not null;

-- Inicializa a sequência acima do que JÁ EXISTE, por org e NUMERICAMENTE.
--
-- Por que numericamente e não por string: `subirCapaFamilia` (src/lib/upload-imagens.ts:43)
-- faz padStart(8,'0') no codigo_pai antes de montar o nome do arquivo. Um codigo_pai '1' já
-- gravado e um gerado '00000001' são strings diferentes no banco — nenhum guard os relaciona —
-- mas produzem o MESMO arquivo CAPA_00000001.jpg no storage, e a capa de um sobrescreveria a
-- do outro. A comparação numérica é o que fecha esse canal.
update public.organizations o set produto_seq = greatest(
  coalesce((select max(f.codigo_pai::bigint) from public.familias f
            where f.org_id = o.id and f.codigo_pai ~ '^[0-9]{1,8}$'), 0),
  coalesce((select max(v.codigo::bigint) from public.variacoes v
            where v.org_id = o.id and v.codigo ~ '^[0-9]{1,8}$'), 0)
);

create or replace function public.proximo_codigo_produto(
  p_org uuid,
  p_qtd int,
  p_resync boolean default false
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_max bigint;
  v_ultimo bigint;
begin
  -- p_qtd <= 0 rebobinaria a sequência, e sequência rebobinada vira colisão silenciosa
  -- depois. Falha alto, como o resto do caminho de cadastro.
  if p_qtd is null or p_qtd <= 0 then
    raise exception 'p_qtd deve ser maior que zero';
  end if;

  -- Só no caminho da colisão (D-4.1): a inicialização acima é a foto de um alvo em
  -- movimento. Uma org sem o módulo hoje segue importando planilha e seus códigos crescem;
  -- ao habilitar o módulo meses depois, a sequência estaria congelada. Nada impede também
  -- usar o módulo E a planilha ao mesmo tempo. O resync paga o scan só quando colide, nunca
  -- no caminho feliz.
  if p_resync then
    select greatest(
      coalesce((select max(f.codigo_pai::bigint) from public.familias f
                where f.org_id = p_org and f.codigo_pai ~ '^[0-9]{1,8}$'), 0),
      coalesce((select max(v.codigo::bigint) from public.variacoes v
                where v.org_id = p_org and v.codigo ~ '^[0-9]{1,8}$'), 0)
    ) into v_max;
    update public.organizations set produto_seq = greatest(produto_seq, v_max)
      where id = p_org;
  end if;

  update public.organizations
    set produto_seq = produto_seq + p_qtd, atualizado_em = now()
    where id = p_org
    returning produto_seq into v_ultimo;

  if v_ultimo is null then
    raise exception 'organização % não encontrada', p_org;
  end if;

  return v_ultimo;
end $$;

-- Padrão do repo (20260729084329_e6b_estoque_movimentos.sql:350-363): revogar de todo mundo
-- E conceder explicitamente ao service_role. Sem o grant a RPC fica inexecutável também pelas
-- edge functions. O browser nunca chama esta RPC (ADR-0094 D-15).
revoke execute on function public.proximo_codigo_produto(uuid, int, boolean)
  from public, anon, authenticated;
grant execute on function public.proximo_codigo_produto(uuid, int, boolean)
  to service_role;
