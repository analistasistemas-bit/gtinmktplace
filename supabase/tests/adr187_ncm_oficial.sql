\set ON_ERROR_STOP on
-- ADR-0187 Migration A: tabela oficial de NCM + ncm_consultar + `ncm_vigente` no resumo do Estoque.
-- Nenhuma linha de domínio é tocada: só um código fictício em ncm_oficial (resolução futura).
begin;

do $$
declare n int;
begin
  select count(*) into n from public.ncm_oficial;
  if n <> 10516 then raise exception 'ncm_oficial tem % linhas, esperado 10516', n; end if;
end $$;

-- Código fictício com vigência só daqui a 10 dias: existe, mas ainda não vale.
insert into public.ncm_oficial (codigo, descricao, data_inicio, data_fim)
values ('99999901', 'Teste ADR-0187 — vigência futura', current_date + 10, '9999-12-31');

-- Usuário real (perfil ativo) de uma org com produto canônico que tem NCM preenchido.
select set_config('request.jwt.claims', json_build_object('sub', p.id, 'role', 'authenticated')::text, true)
from public.profiles p
where p.is_active
  and exists (select 1 from public.familias f
              where f.org_id = p.org_id and f.kit_multiplicador is null and f.ncm is not null)
limit 1;

set local role authenticated;

do $$
declare r record; n int; p json; esperado boolean;
  -- Chaves que produtos_estoque_resumo devolvia antes desta migration (20260924141352).
  chaves_antigas text[] := array['familia_id','codigo_pai','nome_pai','descricao_pai','saldo_total',
    'qtd_skus','tem_tamanho','capa_storage_path','capa_ml_picture_id','fornecedor','unidade','origem',
    'ml_item_id','criado_em','gtins','codigos','cores','nomes','sku_unico','ncm','cest','origem_nfe',
    'fci','tributacao_icms','tributacao_icms_regime','can_invoice'];
  chaves text[];
begin
  if current_setting('request.jwt.claims', true) is null then
    raise exception 'nenhum usuário real com produto com NCM encontrado';
  end if;

  -- Só códigos existentes: 75937727 não está na tabela.
  select count(*) into n from public.ncm_consultar(array['62034900','75937727']);
  if n <> 1 then raise exception 'ncm_consultar devolveu % linhas, esperado 1', n; end if;
  select * into r from public.ncm_consultar(array['62034900']);
  if r.codigo is distinct from '62034900' or r.vigente is distinct from true or r.descricao is null then
    raise exception 'ncm_consultar(62034900) errado: %', r;
  end if;
  select * into r from public.ncm_consultar(array['99999901']);
  if r.vigente is distinct from false then raise exception 'vigência futura deveria ser false: %', r; end if;

  -- Resumo: todo produto tem `ncm_vigente`, mantém as chaves antigas e só ganha essa.
  n := 0;
  for p in select x from json_array_elements(public.produtos_estoque_resumo()->'produtos') x loop
    n := n + 1;
    select array_agg(k order by k) into chaves from json_object_keys(p) k;
    if chaves is distinct from (select array_agg(k order by k) from unnest(chaves_antigas || 'ncm_vigente'::text) k) then
      raise exception 'chaves do produto divergem: %', chaves;
    end if;
    esperado := case
      when p->>'ncm' is null then null
      else coalesce((select current_date between o.data_inicio and o.data_fim
                     from public.ncm_oficial o where o.codigo = p->>'ncm'), false)
    end;
    if (p->>'ncm_vigente')::boolean is distinct from esperado then
      raise exception 'ncm_vigente errado (esperado %): %', esperado, p;
    end if;
  end loop;
  -- Sem esta contagem, um resumo VAZIO (org não resolvida) passaria calado.
  if n = 0 then raise exception 'produtos_estoque_resumo devolveu 0 produtos'; end if;
  select count(*) into n from json_array_elements(public.produtos_estoque_resumo()->'produtos') x
  where x->>'ncm' is not null;
  if n = 0 then raise exception 'nenhum produto com NCM no resumo: o caso preenchido não foi exercitado'; end if;
end $$;
rollback;
