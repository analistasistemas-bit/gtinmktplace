-- ADR-0129: relaxar o guard de estoque de `validar_variacao_no_tenant` para famílias de
-- UPDATE em lote manual. O guard original (20260804113000) proibia INSERT de variação com
-- estoque <> 0 em qualquer lote manual; a família de UPDATE (ADR-0129) precisa clonar o
-- estoque vivo das variações irmãs, senão a família nova vira canônica na tela Estoque com
-- saldo 0 e o worker de update zeraria o estoque no ML.
create or replace function public.validar_variacao_no_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_familia_org uuid;
  v_lote_org uuid;
  v_lote_origem text;
  v_familia_operacao public.operacao_ml;
begin
  select f.org_id, l.org_id, l.origem, f.operacao
    into v_familia_org, v_lote_org, v_lote_origem, v_familia_operacao
  from public.familias f
  join public.lotes l on l.id = f.lote_id
  where f.id = new.familia_id;

  if v_familia_org is distinct from new.org_id
     or v_lote_org is distinct from new.org_id then
    raise exception 'Variação, família e lote precisam pertencer à mesma organização.'
      using errcode = '23514';
  end if;

  if v_lote_origem = 'manual' then
    if new.codigo !~ '^[0-9]{8}$' then
      raise exception 'Código de variação manual precisa ter 8 dígitos.'
        using errcode = '23514';
    end if;
    -- ADR-0129: família de UPDATE em lote manual clona o estoque vivo das variações irmãs
    -- (senão a família nova vira canônica na tela Estoque com saldo 0 e o worker de update
    -- zeraria o estoque no ML). O caminho-único-pelo-ledger (ADR-0094 D-15) continua valendo
    -- para CREATE (cadastro inicial) — e bloquear_escrita_direta_estoque continua bloqueando
    -- UPDATE direto de estoque para todo mundo.
    if v_familia_operacao = 'CREATE'
       and tg_op = 'INSERT' and new.estoque <> 0 then
      raise exception 'Estoque inicial de produto manual deve ser registrado pelo ledger.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
