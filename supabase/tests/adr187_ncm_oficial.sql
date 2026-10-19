\set ON_ERROR_STOP on
-- ADR-0187 Migrations A e B: tabela oficial de NCM + ncm_consultar + `ncm_vigente` no resumo do Estoque;
-- FK NOT VALID de familias.ncm. Linhas reais de domínio não são escritas: só fixtures (um código fictício
-- em ncm_oficial, um lote e uma família de teste), tudo dentro da transação desfeita.
begin;

do $$
declare n int;
  -- 10516 = carga real. A Migration A inteira estoura o runner (HTTP 413); a versão reduzida usada nos
  -- testes (só um lote do seed) declara a própria contagem via este setting, que nada mais grava.
  esperado int := coalesce(nullif(current_setting('adr187.qtd_ncm_esperada', true), ''), '10516')::int;
begin
  select count(*) into n from public.ncm_oficial;
  if n <> esperado then raise exception 'ncm_oficial tem % linhas, esperado %', n, esperado; end if;
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

-- Migration B (FK NOT VALID): escrita nova em familias.ncm só com código da tabela oficial.
-- Exercitada numa família fixture (lote fixture próprio, sob um usuário/org reais): nenhuma linha
-- real de familias/lotes é escrita, nem pelo trigger de contadores do lote.
reset role;
do $$
declare v_user uuid; v_org uuid; v_lote uuid; v_id uuid;
begin
  select p.id, p.org_id into v_user, v_org from public.profiles p
  where p.is_active and p.org_id is not null limit 1;
  if v_user is null then raise exception 'nenhum perfil ativo para a fixture'; end if;
  insert into public.lotes (user_id, org_id, numero)
  values (v_user, v_org, (select coalesce(max(numero), 0) + 1 from public.lotes))
  returning id into v_lote;
  insert into public.familias (lote_id, user_id, org_id, codigo_pai, nome_pai, operacao)
  values (v_lote, v_user, v_org, 'TESTE-ADR187', 'Teste ADR-0187 FK', 'CREATE')
  returning id into v_id;
  begin
    update public.familias set ncm = '75937727' where id = v_id;
    raise exception 'FK ausente: familias aceitou NCM 75937727 fora da tabela oficial';
  exception when foreign_key_violation then null;  -- 23503: esperado
  end;
  update public.familias set ncm = '62034900' where id = v_id;
end $$;
rollback;
