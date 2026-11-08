\set ON_ERROR_STOP on
-- ADR-0199 (migration kit_variacao_guards): saldo e composição duráveis do SKU participante.
-- Fixtures só dentro da transação desfeita (scripts/teste-sql-desfeito.py), em org própria.
begin;

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97300000-0000-0000-0000-000000000001', 'Kit guards', 'kit-guards-teste', array['kit_variacao'], true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('97300000-0000-0000-0000-000000000101', 'kit-guards@teste.local',
   '{"org_id":"97300000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97300000-0000-0000-0000-000000000101', '97300000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('97300000-0000-0000-0000-000000000201', '97300000-0000-0000-0000-000000000101',
   '97300000-0000-0000-0000-000000000001', 'processando', 'planilha');

-- F1: base publicada (A, B componentes; C comum). FK: família do kit (KA). Ambas de 2 dias atrás:
-- a canônica é a família mais recente por `criado_em`, e numa transação só `now()` empata.
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro,
                             criado_em, ml_item_id, status) values
  ('97300000-0000-0000-0000-000000000301', '97300000-0000-0000-0000-000000000201',
   '97300000-0000-0000-0000-000000000101', '97300000-0000-0000-0000-000000000001',
   '09900000', 'Blusa guards', 'CREATE', 'nacional', gen_random_uuid(), now() - interval '2 days', 'MLB973', 'publicado'),
  ('97300000-0000-0000-0000-000000000302', '97300000-0000-0000-0000-000000000201',
   '97300000-0000-0000-0000-000000000101', '97300000-0000-0000-0000-000000000001',
   '09910000', 'Kit blusa guards', 'CREATE', 'nacional', gen_random_uuid(), now() - interval '2 days', null, 'pronto');
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, preco, estoque)
select f, '97300000-0000-0000-0000-000000000101', '97300000-0000-0000-0000-000000000001', c, c, c, 50, e
from (values
  ('97300000-0000-0000-0000-000000000301'::uuid, '09900001', 5),
  ('97300000-0000-0000-0000-000000000301'::uuid, '09900002', 4),
  ('97300000-0000-0000-0000-000000000301'::uuid, '09900003', 3),
  ('97300000-0000-0000-0000-000000000302'::uuid, '09910001', 2)
) x(f, c, e);

insert into public.kits_variacao (id, org_id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, preco) values
  ('97300000-0000-0000-0000-000000000401', '97300000-0000-0000-0000-000000000001', '09900000', '09910000', 2, 90);
insert into public.kit_variacao_skus (id, org_id, kit_id, codigo, tamanho, cores, rotulo_cor) values
  ('97300000-0000-0000-0000-000000000501', '97300000-0000-0000-0000-000000000001',
   '97300000-0000-0000-0000-000000000401', '09910001', 'M', array['Preto', 'Branco'], 'Preto + Branco');
-- 09900009: componente sem variação nenhuma (só para a limpeza do ledger).
insert into public.kit_variacao_componentes (kit_sku_id, org_id, codigo, quantidade) values
  ('97300000-0000-0000-0000-000000000501', '97300000-0000-0000-0000-000000000001', '09900001', 1),
  ('97300000-0000-0000-0000-000000000501', '97300000-0000-0000-0000-000000000001', '09900002', 1),
  ('97300000-0000-0000-0000-000000000501', '97300000-0000-0000-0000-000000000001', '09900009', 1);
insert into public.sku_politica_kit (org_id, codigo, versao) values
  ('97300000-0000-0000-0000-000000000001', '09900001', 3);

create function pg_temp.erro(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function pg_temp.afirmar(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALHA: %', p_msg; end if;
end $$;

-- Saldo na variação canônica (família mais recente), como baixar_estoque e o push a resolvem.
create function pg_temp.saldo(p_codigo text) returns integer language sql as $$
  select v.estoque from public.variacoes v join public.familias f on f.id = v.familia_id
  where v.org_id = '97300000-0000-0000-0000-000000000001' and v.codigo = p_codigo
  order by f.criado_em desc limit 1
$$;

-- Um lote por cópia (unique lote_id + codigo_pai), com o mesmo id da família.
create function pg_temp.nova_familia(p_id uuid, p_idade interval, p_ml text) returns void language sql as $$
  insert into public.lotes (id, user_id, org_id, status, origem)
  values (p_id, '97300000-0000-0000-0000-000000000101', '97300000-0000-0000-0000-000000000001', 'processando', 'planilha');
  insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro,
                               criado_em, ml_item_id, status)
  values (p_id, p_id, '97300000-0000-0000-0000-000000000101',
          '97300000-0000-0000-0000-000000000001', '09900000', 'Blusa guards', 'UPDATE', 'nacional', gen_random_uuid(),
          now() - p_idade, p_ml, 'publicado')
$$;

create function pg_temp.nova_variacao(p_familia uuid, p_codigo text, p_estoque integer) returns void language sql as $$
  insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, preco, estoque)
  values (p_familia, '97300000-0000-0000-0000-000000000101', '97300000-0000-0000-0000-000000000001',
          p_codigo, p_codigo, p_codigo, 50, p_estoque)
$$;

-- Embeds novos de `organizations(modulos_habilitados)`: exatamente 1 FK, senão o PostgREST recusa o embed.
do $$
begin
  perform pg_temp.afirmar((select count(*) from pg_constraint
    where conrelid = 'public.kits_virtuais'::regclass and confrelid = 'public.organizations'::regclass
      and contype = 'f') = 1, 'kits_virtuais: 1 FK para organizations');
  perform pg_temp.afirmar((select count(*) from pg_constraint
    where conrelid = 'public.familias'::regclass and confrelid = 'public.organizations'::regclass
      and contype = 'f') = 1, 'familias: 1 FK para organizations');
  perform pg_temp.afirmar(has_function_privilege('service_role', 'public.kit_variacao_base_em_kit(uuid, text[])', 'execute'),
    'service_role chama kit_variacao_base_em_kit');
  perform pg_temp.afirmar(not has_function_privilege('authenticated', 'public.kit_variacao_base_em_kit(uuid, text[])', 'execute'),
    'authenticated não chama kit_variacao_base_em_kit');
end $$;

set local role service_role;

-- 1. Planilha com ESTOQUE diferente não altera o saldo do participante; SKU comum segue a planilha.
do $$
begin
  perform pg_temp.nova_familia('97300000-0000-0000-0000-000000000303', interval '1 day', 'MLB973');
  perform pg_temp.nova_variacao('97300000-0000-0000-0000-000000000303', '09900001', 999);
  perform pg_temp.nova_variacao('97300000-0000-0000-0000-000000000303', '09900003', 77);
  perform pg_temp.afirmar(pg_temp.saldo('09900001') = 5, 'participante herda o saldo: ' || pg_temp.saldo('09900001'));
  perform pg_temp.afirmar(pg_temp.saldo('09900003') = 77, 'SKU comum segue a planilha: ' || pg_temp.saldo('09900003'));
end $$;

-- 1b. Fix 1: troca de canônica. Venda depois da cópia baixa a nova (sequencial). Mutação que resolveu a cópia
-- antiga antes da troca (o caso das duas sessões, ver kit_variacao_guards_concorrencia.sh) é simulada pelo
-- UPDATE direto na linha antiga como o executor: recusa retentável, sem baixar.
do $$
declare r jsonb;
begin
  r := public.baixar_estoque('97300000-0000-0000-0000-000000000001', '09900001', 1, 'mercado_livre', 'pedido-t7-1');
  perform pg_temp.afirmar((r->>'aplicado')::boolean and pg_temp.saldo('09900001') = 4, 'venda baixa a canônica nova: ' || r::text);
end $$;
reset role;
grant estoque_rpc_executor to postgres;
set local role estoque_rpc_executor;
do $$
declare v_erro text;
begin
  v_erro := pg_temp.erro($q$update public.variacoes set estoque = estoque - 1
    where familia_id = '97300000-0000-0000-0000-000000000301' and codigo = '09900001'$q$);
  perform pg_temp.afirmar(v_erro like 'canonica_trocou:%', 'cópia antiga recusa: ' || coalesce(v_erro, 'baixou'));
  -- SKU comum: caminho de hoje, sem conferência.
  update public.variacoes set estoque = estoque - 1
  where familia_id = '97300000-0000-0000-0000-000000000301' and codigo = '09900003';
end $$;
reset role;
set local role service_role;

-- 1c. Tirar o participante da publicação é remover a cor por fora da saga: recusa.
do $$
declare v_erro text;
begin
  v_erro := pg_temp.erro($q$update public.variacoes set excluida_da_publicacao = true
    where familia_id = '97300000-0000-0000-0000-000000000303' and codigo = '09900001'$q$);
  perform pg_temp.afirmar(v_erro like '%não pode sair da publicação%', 'excluir da publicação recusa: ' || coalesce(v_erro, 'gravou'));
  update public.variacoes set excluida_da_publicacao = true
  where familia_id = '97300000-0000-0000-0000-000000000303' and codigo = '09900003';
  update public.variacoes set excluida_da_publicacao = false
  where familia_id = '97300000-0000-0000-0000-000000000303' and codigo = '09900003';
end $$;

-- 2. Org sem o módulo: comportamento de hoje (planilha manda).
reset role;
update public.organizations set modulos_habilitados = '{}' where id = '97300000-0000-0000-0000-000000000001';
set local role service_role;
do $$
begin
  perform pg_temp.nova_familia('97300000-0000-0000-0000-000000000304', interval '12 hours', null);
  perform pg_temp.nova_variacao('97300000-0000-0000-0000-000000000304', '09900001', 50);
  perform pg_temp.afirmar(pg_temp.saldo('09900001') = 50, 'sem módulo: planilha manda: ' || pg_temp.saldo('09900001'));
end $$;
reset role;
update public.organizations set modulos_habilitados = array['kit_variacao'] where id = '97300000-0000-0000-0000-000000000001';
set local role service_role;

-- 3. Apagar a cópia canônica com outra sobrando leva o saldo para a próxima canônica.
do $$
begin
  delete from public.variacoes
  where familia_id = '97300000-0000-0000-0000-000000000304' and codigo = '09900001';
  perform pg_temp.afirmar(pg_temp.saldo('09900001') = 50, 'saldo vai para a próxima canônica: ' || pg_temp.saldo('09900001'));
  delete from public.familias where id = '97300000-0000-0000-0000-000000000304';
end $$;

-- 4. Transferência aberta: nova cópia do participante (adicionar variação, planilha) recusa.
do $$
declare v_erro text;
begin
  insert into public.kit_transferencias (id, org_id, kit_id, tipo, versao_politica, itens) values
    ('97300000-0000-0000-0000-000000000601', '97300000-0000-0000-0000-000000000001',
     '97300000-0000-0000-0000-000000000401', 'montar', 0, '[{"codigo": "09910001", "quantidade": 1}]');
  perform pg_temp.nova_familia('97300000-0000-0000-0000-000000000305', interval '6 hours', 'MLB973');
  -- Componente da transferência pelo SKU de kit listado.
  v_erro := pg_temp.erro($q$select pg_temp.nova_variacao('97300000-0000-0000-0000-000000000305', '09900002', 9)$q$);
  perform pg_temp.afirmar(v_erro like 'sku_em_transferencia:%', 'nova cópia em transferência recusa: ' || coalesce(v_erro, 'gravou'));
  -- SKU comum na mesma família segue.
  perform pg_temp.nova_variacao('97300000-0000-0000-0000-000000000305', '09900003', 8);
  delete from public.familias where id = '97300000-0000-0000-0000-000000000305';
end $$;

-- 5. Republicar com trânsito recusa, sem mexer em nada.
do $$
declare v_erro text;
begin
  v_erro := pg_temp.erro($q$select public.preparar_republicacao('97300000-0000-0000-0000-000000000001',
    'mercado_livre', '09900000', '97300000-0000-0000-0000-000000000301')$q$);
  perform pg_temp.afirmar(v_erro like '%republicar:kit_em_transferencia%', 'republicar com trânsito recusa: ' || coalesce(v_erro, 'passou'));
  perform pg_temp.afirmar((select versao from public.sku_politica_kit
    where org_id = '97300000-0000-0000-0000-000000000001' and codigo = '09900001') = 3, 'recusa não incrementa');
end $$;

-- 5b. Fix 2/3: a republicação disputa a exclusão do SKU. Exclusão de transferência (mesmo antes de a
-- transferência aparecer como aberta) recusa; exclusão de publicação pendente (raiz antiga) recusa com
-- motivo próprio e NÃO é liberada.
reset role;
update public.kit_transferencias set estado = 'concluida' where id = '97300000-0000-0000-0000-000000000601';
set local role service_role;
do $$
declare o uuid := '97300000-0000-0000-0000-000000000001'; v_erro text;
begin
  insert into public.kit_exclusoes (org_id, codigo, dono_tipo, dono_id) values (o, '09900002', 'transferencia', gen_random_uuid());
  v_erro := pg_temp.erro($q$select public.preparar_republicacao('97300000-0000-0000-0000-000000000001',
    'mercado_livre', '09900000', '97300000-0000-0000-0000-000000000301')$q$);
  perform pg_temp.afirmar(v_erro like '%republicar:kit_em_transferencia%', 'exclusão de transferência recusa: ' || coalesce(v_erro, 'passou'));
  delete from public.kit_exclusoes where org_id = o;

  insert into public.kit_exclusoes (org_id, codigo, dono_tipo, dono_id) values (o, '09900001', 'publicacao', gen_random_uuid());
  v_erro := pg_temp.erro($q$select public.preparar_republicacao('97300000-0000-0000-0000-000000000001',
    'mercado_livre', '09900000', '97300000-0000-0000-0000-000000000301')$q$);
  perform pg_temp.afirmar(v_erro like '%republicar:kit_publicacao_pendente%', 'publicação pendente recusa: ' || coalesce(v_erro, 'passou'));
  perform pg_temp.afirmar(exists (select 1 from public.kit_exclusoes where org_id = o and dono_tipo = 'publicacao'),
    'exclusão de publicação não é liberada');
  perform pg_temp.afirmar((select versao from public.sku_politica_kit where org_id = o and codigo = '09900001') = 3,
    'recusa não incrementa');
  delete from public.kit_exclusoes where org_id = o;
end $$;

-- 6. Republicar sem trânsito: preserva composição e saldo, incrementa a versão dos participantes (job velho
-- com a versão anterior é recusado na publicação, Task 5).
do $$
declare o uuid := '97300000-0000-0000-0000-000000000001';
begin
  perform public.preparar_republicacao(o, 'mercado_livre', '09900000', '97300000-0000-0000-0000-000000000301');
  perform pg_temp.afirmar((select versao from public.sku_politica_kit where org_id = o and codigo = '09900001') = 4,
    'A: versão 3 → 4');
  perform pg_temp.afirmar((select versao from public.sku_politica_kit where org_id = o and codigo = '09900002') = 1,
    'B sem linha nasce com versão 1');
  perform pg_temp.afirmar(not exists (select 1 from public.sku_politica_kit where org_id = o and codigo = '09900003'),
    'SKU comum não ganha política');
  perform pg_temp.afirmar((select count(*) from public.kit_variacao_componentes where org_id = o) = 3
    and (select count(*) from public.kit_variacao_skus where org_id = o) = 1, 'composição preservada');
  perform pg_temp.afirmar(pg_temp.saldo('09900001') = 50 and pg_temp.saldo('09900002') = 4,
    'saldo preservado: ' || pg_temp.saldo('09900001') || '/' || pg_temp.saldo('09900002'));
  perform pg_temp.afirmar((select ml_item_id is null from public.familias
    where id = '97300000-0000-0000-0000-000000000303'), 'vigente desvinculada (comportamento ADR-0185)');
  perform pg_temp.afirmar(not exists (select 1 from public.kit_exclusoes where org_id = o),
    'exclusão da republicação solta no fim da RPC');
end $$;

-- 7. Excluir cor em composição falha (última cópia); SKU comum sai normalmente.
do $$
declare v_erro text;
begin
  v_erro := pg_temp.erro($q$delete from public.variacoes
    where org_id = '97300000-0000-0000-0000-000000000001' and codigo = '09900002'$q$);
  perform pg_temp.afirmar(v_erro like '%composição de kit com variação%', 'componente não some: ' || coalesce(v_erro, 'apagou'));
  v_erro := pg_temp.erro($q$delete from public.familias where id = '97300000-0000-0000-0000-000000000302'$q$);
  perform pg_temp.afirmar(v_erro like '%composição de kit com variação%', 'SKU de kit não some pelo cascade: ' || coalesce(v_erro, 'apagou'));
  delete from public.variacoes where org_id = '97300000-0000-0000-0000-000000000001' and codigo = '09900003';
end $$;

-- 8. limpar_movimentos_orfaos preserva movimento de SKU em composição e de transferência.
do $$
declare o uuid := '97300000-0000-0000-0000-000000000001';
begin
  insert into public.estoque_movimentos (org_id, codigo, quantidade, motivo) values
    (o, '09900009', 1, 'entrada'),     -- componente sem variação
    (o, '09900099', 1, 'entrada');     -- órfão comum
  insert into public.estoque_movimentos (org_id, codigo, quantidade, motivo, transferencia_id) values
    (o, '09900098', -1, 'kit_saida', '97300000-0000-0000-0000-000000000601');
  perform public.limpar_movimentos_orfaos(o);
  perform pg_temp.afirmar(exists (select 1 from public.estoque_movimentos where org_id = o and codigo = '09900009'),
    'movimento de componente preservado');
  perform pg_temp.afirmar(exists (select 1 from public.estoque_movimentos where org_id = o and codigo = '09900098'),
    'movimento de transferência preservado');
  perform pg_temp.afirmar(not exists (select 1 from public.estoque_movimentos where org_id = o and codigo = '09900099'),
    'órfão comum apagado');
end $$;

-- 9. kit_variacao_base_em_kit (validação reversa da Task 10): kit vinculado e Kit Virtual na base.
reset role;
do $$
declare o uuid := '97300000-0000-0000-0000-000000000001'; u uuid := '97300000-0000-0000-0000-000000000101';
        a uuid := gen_random_uuid(); k uuid := gen_random_uuid();
begin
  perform pg_temp.afirmar(public.kit_variacao_base_em_kit(o, array['09920001']) is null, 'sem kit: livre');

  -- Kit vinculado vivo sobre a base 09920000.
  insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, status) values
    ('97300000-0000-0000-0000-000000000310', '97300000-0000-0000-0000-000000000201', u, o,
     '09920000', 'Base vinculada', 'CREATE', 'nacional', gen_random_uuid(), 'publicado');
  perform pg_temp.nova_variacao('97300000-0000-0000-0000-000000000310', '09920001', 1);
  insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, status,
                               kit_base_codigo_pai, kit_multiplicador) values
    ('97300000-0000-0000-0000-000000000311', '97300000-0000-0000-0000-000000000201', u, o,
     '09930000', 'Kit 2un', 'CREATE', 'nacional', gen_random_uuid(), 'pronto', '09920000', 2);
  perform pg_temp.nova_variacao('97300000-0000-0000-0000-000000000311', '09930001', 0);
  perform pg_temp.afirmar(public.kit_variacao_base_em_kit(o, array['09920001']) like '%kit vinculado%', 'base de kit vinculado recusa');
  perform pg_temp.afirmar(public.kit_variacao_base_em_kit(o, array['09930001']) like '%kit vinculado%', 'SKU do kit vinculado recusa');
  -- Fix 4: kit em `erro` é retomável pelo reenvio da chave — segue ocupando a base.
  update public.familias set status = 'erro' where id = '97300000-0000-0000-0000-000000000311';
  perform pg_temp.afirmar(public.kit_variacao_base_em_kit(o, array['09920001']) like '%kit vinculado%', 'kit vinculado em erro recusa');

  -- Kit Virtual com componente de `codigo`/`codigo_pai` nulos: casa pelo user product do item local.
  insert into public.anuncios_externos (id, user_id, org_id, canal, codigo_pai) values (a, u, o, 'mercado_livre', '09940000');
  insert into public.anuncios_externos_itens (anuncio_externo_id, org_id, sku, status, item_externo_id, user_product_id)
  values (a, o, '09940001', 'ativo', 'MLB9731', 'MLBU9731');
  insert into public.kits_virtuais (id, org_id, chave_cadastro, titulo, desconto_pct, status) values
    (k, o, 'chave-guards', 'Kit virtual', 0.1, 'publicando');
  insert into public.kits_virtuais_componentes (kit_id, org_id, ordem, user_product_id, item_externo_id, quantidade) values
    (k, o, 0, 'MLBU9731', null, 1), (k, o, 1, 'MLBU9739', null, 1);
  perform pg_temp.afirmar(public.kit_variacao_base_em_kit(o, array['09940001']) like '%Kit Virtual%', 'componente de Kit Virtual recusa');
  -- Fix 5: `erro` não distingue recusa definitiva de criação remota incerta: ocupado.
  update public.kits_virtuais set status = 'erro' where id = k;
  perform pg_temp.afirmar(public.kit_variacao_base_em_kit(o, array['09940001']) like '%Kit Virtual%', 'Kit Virtual em erro recusa');
  update public.kits_virtuais set status = 'encerrado' where id = k;
  perform pg_temp.afirmar(public.kit_variacao_base_em_kit(o, array['09940001']) is null, 'Kit Virtual encerrado libera');
end $$;

rollback;
