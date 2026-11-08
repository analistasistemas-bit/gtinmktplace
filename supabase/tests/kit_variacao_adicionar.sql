\set ON_ERROR_STOP on
-- ADR-0200 (Task 13, ajuste): Montar mais em kit existente com combinação/tamanho nunca publicado. SKU novo no MESMO
-- kit, numa transferência `montar` só, com alvo `criar` para o novo e alvo normal para o já publicado.
-- Fixtures só dentro da transação desfeita (scripts/teste-sql-desfeito.py), em org própria.
begin;

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97300000-0000-0000-0000-000000000001', 'Kit adicionar', 'kit-adicionar-teste', array['kit_variacao'], true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('97300000-0000-0000-0000-000000000101', 'kit-adicionar@teste.local',
   '{"org_id":"97300000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97300000-0000-0000-0000-000000000101', '97300000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('97300000-0000-0000-0000-000000000201', '97300000-0000-0000-0000-000000000101',
   '97300000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro) values
  ('97300000-0000-0000-0000-000000000301', '97300000-0000-0000-0000-000000000201',
   '97300000-0000-0000-0000-000000000101', '97300000-0000-0000-0000-000000000001',
   '09800000', 'Blusa adicionar', 'CREATE', 'nacional', gen_random_uuid()),
  ('97300000-0000-0000-0000-000000000302', '97300000-0000-0000-0000-000000000201',
   '97300000-0000-0000-0000-000000000101', '97300000-0000-0000-0000-000000000001',
   '09810000', 'Kit blusa adicionar', 'CREATE', 'nacional', gen_random_uuid());
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
select f, '97300000-0000-0000-0000-000000000101', '97300000-0000-0000-0000-000000000001', c, c, c, 'M', 50, 0
from (values
  ('97300000-0000-0000-0000-000000000301'::uuid, '09800001'),   -- preto
  ('97300000-0000-0000-0000-000000000301'::uuid, '09800002'),   -- branco
  ('97300000-0000-0000-0000-000000000301'::uuid, '09800003'),   -- azul
  ('97300000-0000-0000-0000-000000000302'::uuid, '09810001')    -- kit preto e branco (já publicado)
) x(f, c);

create temp table ctx on commit drop as
select '97300000-0000-0000-0000-000000000001'::uuid as org,
       '97300000-0000-0000-0000-000000000101'::uuid as usuario,
       gen_random_uuid() as chave_kit, gen_random_uuid() as chave;
grant select on ctx to service_role;

create function pg_temp.afirmar(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALHA: %', p_msg; end if;
end $$;

create function pg_temp.linhas(p_org uuid) returns text language sql as $$
  select (select count(*) from public.kit_variacao_skus where org_id = p_org) || '/'
      || (select count(*) from public.kit_marca_ml where org_id = p_org) || '/'
      || (select count(*) from public.kit_transferencias where org_id = p_org) || '/'
      || (select count(*) from public.kit_exclusoes where org_id = p_org) || '/'
      || (select count(*) from public.variacoes where org_id = p_org)
$$;

do $$
declare f text := 'public.kit_variacao_adicionar(uuid, uuid, integer, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb)';
begin
  perform pg_temp.afirmar(not has_function_privilege('anon', f, 'execute'), f || ' exposta a anon');
  perform pg_temp.afirmar(not has_function_privilege('authenticated', f, 'execute'), f || ' exposta a authenticated');
  perform pg_temp.afirmar(not has_function_privilege('public', f, 'execute'), f || ' exposta a public');
  perform pg_temp.afirmar(has_function_privilege('service_role', f, 'execute'), f || ' sem service_role');
end $$;

-- Kit existente: criado pela RPC da Task 10 com Preto e Branco M, montagem já concluída.
set local role service_role;
do $$
declare c record; r jsonb;
begin
  select * into c from ctx;
  perform public.registrar_entrada(c.org, '09800001', 5, null, null, null, c.usuario, 'kit-adicionar:p');
  perform public.registrar_entrada(c.org, '09800002', 5, null, null, null, c.usuario, 'kit-adicionar:b');
  perform public.registrar_entrada(c.org, '09800003', 5, null, null, null, c.usuario, 'kit-adicionar:a');
  r := public.kit_variacao_criar(c.org, c.chave_kit,
    '{"codigo_pai_base":"09800000","codigo_pai_kit":"09810000","pecas_por_kit":2,"preco":99.9,"meta":0,"pedido_hash":"HK"}',
    '[{"codigo":"09810001","tamanho":"M","cores":["Preto","Branco"],"rotulo_cor":"Preto e Branco","quantidade":1,
       "componentes":[{"codigo":"09800001","quantidade":1},{"codigo":"09800002","quantidade":1}]}]',
    '[{"codigo":"09800001","ml":5},{"codigo":"09800002","ml":5}]',
    '[{"codigo":"09800001","up_id":"UP-P","item_ids":["MLB-P"]},{"codigo":"09800002","up_id":"UP-B","item_ids":["MLB-B"]}]');
  perform pg_temp.afirmar((r->>'ok')::boolean, 'fixture do kit: ' || r::text);
end $$;
reset role;
update public.kit_transferencias set estado = 'concluida' where org_id = (select org from ctx);
delete from public.kit_exclusoes where org_id = (select org from ctx);
update public.kits_variacao set status = 'publicado' where org_id = (select org from ctx);

set local role service_role;
do $$
declare
  c record; r jsonb; r2 jsonb; t uuid; k uuid; v integer;
  FK constant uuid := '97300000-0000-0000-0000-000000000302';
  P constant text := '09800001'; B constant text := '09800002'; A constant text := '09800003';
  K1 constant text := '09810001'; K2 constant text := '09810002';
  novos jsonb := '[{"codigo":"09810002","tamanho":"M","cores":["Preto","Azul"],"rotulo_cor":"Preto e Azul","quantidade":1,
                    "componentes":[{"codigo":"09800001","quantidade":1},{"codigo":"09800003","quantidade":1}],
                    "variacao":{"user_id":"97300000-0000-0000-0000-000000000101","nome":"Preto e Azul","cor":"Preto e Azul",
                                "tamanho":"M","preco":99.9,"custo":40,"imagem_path":"ORG/pa.jpg","ml_picture_id":"PIC-PA"}}]';
  existentes jsonb := '[{"codigo":"09810001","quantidade":1}]';
  baseline jsonb := '[{"codigo":"09800003","ml":5}]';
  alvos jsonb := '[{"codigo":"09800001","up_id":"UP-P","item_ids":["MLB-P"]},{"codigo":"09800002","up_id":"UP-B","item_ids":["MLB-B"]},
                   {"codigo":"09800003","up_id":"UP-A","item_ids":["MLB-A"]},{"codigo":"09810001","up_id":"UP-K1","item_ids":["MLB-K1"]}]';
begin
  select * into c from ctx;
  select id, versao into k, v from public.kits_variacao where org_id = c.org;

  -- Kit de outra org (ou inexistente): recusa sem gravar.
  r := public.kit_variacao_adicionar(c.org, gen_random_uuid(), v, FK, c.chave, 'H1', novos, existentes, baseline, alvos);
  perform pg_temp.afirmar(r->>'motivo' = 'kit_nao_encontrado', 'kit inexistente: ' || r::text);
  perform pg_temp.afirmar(pg_temp.linhas(c.org) = '1/3/1/0/4', 'recusa gravou algo: ' || pg_temp.linhas(c.org));

  -- Combinação já publicada, com as cores em outra ordem: é a mesma (conjunto), recusa.
  r := public.kit_variacao_adicionar(c.org, k, v, FK, c.chave, 'H1',
    '[{"codigo":"09810002","tamanho":"M","cores":["Branco","Preto"],"rotulo_cor":"Branco e Preto","quantidade":1,
       "componentes":[{"codigo":"09800001","quantidade":1},{"codigo":"09800002","quantidade":1}],"variacao":{"nome":"x"}}]',
    '[]', '[]', alvos);
  perform pg_temp.afirmar(r->>'motivo' = 'combinacao_existente', 'duplicada por conjunto passou: ' || r::text);
  perform pg_temp.afirmar(pg_temp.linhas(c.org) = '1/3/1/0/4', 'duplicada gravou algo');

  -- Peça nova sem baseline: recusa.
  r := public.kit_variacao_adicionar(c.org, k, v, FK, c.chave, 'H1', novos, existentes, '[]', alvos);
  perform pg_temp.afirmar(r->>'motivo' = 'baseline_incompleto', 'baseline incompleto: ' || r::text);

  -- Versão velha e família que não é a canônica do kit: recusam sem gravar.
  r := public.kit_variacao_adicionar(c.org, k, v - 1, FK, c.chave, 'H1', novos, existentes, baseline, alvos);
  perform pg_temp.afirmar(r->>'motivo' = 'versao', 'versão velha passou: ' || r::text);
  r := public.kit_variacao_adicionar(c.org, k, v, '97300000-0000-0000-0000-000000000301', c.chave, 'H1', novos, existentes, baseline, alvos);
  perform pg_temp.afirmar(r->>'motivo' = 'familia_divergente', 'família errada passou: ' || r::text);

  -- Baseline divergente (recusa dentro do bloco): nem a variação nova fica na família publicada.
  r := public.kit_variacao_adicionar(c.org, k, v, FK, c.chave, 'H1', novos, existentes, '[{"codigo":"09800003","ml":4}]', alvos);
  perform pg_temp.afirmar(r->>'motivo' = 'baseline_divergente', 'baseline divergente: ' || r::text);
  perform pg_temp.afirmar(pg_temp.linhas(c.org) = '1/3/1/0/4', 'recusa deixou variação órfã: ' || pg_temp.linhas(c.org));

  -- Caminho feliz, com "Vender só em kit" ligado e reposição DESLIGADA pelo operador: a peça nova é reivindicada antes
  -- da transferência, e a reposição continua desligada.
  update public.kits_variacao set so_em_kit = true, reposicao_auto = false where id = k;
  r := public.kit_variacao_adicionar(c.org, k, v, FK, c.chave, 'H1', novos, existentes, baseline, alvos);
  perform pg_temp.afirmar((r->>'ok')::boolean and r->>'transferencia_id' is not null, 'adicionar falhou: ' || r::text);
  t := (r->>'transferencia_id')::uuid;
  perform pg_temp.afirmar(pg_temp.linhas(c.org) = '2/5/2/5/5', 'linhas: ' || pg_temp.linhas(c.org));
  perform pg_temp.afirmar((select reposicao_auto = false and versao = v + 1 from public.kits_variacao where id = k),
    'reposição religada ou versão não incrementada');
  perform pg_temp.afirmar((select familia_id = FK and estoque = 0 and imagem_path = 'ORG/pa.jpg' and ml_picture_id = 'PIC-PA'
                           and not excluida_da_publicacao
                           from public.variacoes where org_id = c.org and codigo = K2), 'variação nova na família do kit');
  perform pg_temp.afirmar((select tipo = 'montar' and kit_id = k and chave_cadastro = c.chave and pedido_hash = 'H1'
                           from public.kit_transferencias where id = t), 'transferência com chave e hash');
  perform pg_temp.afirmar((select criar and delta = 1 from public.kit_transferencia_alvos where transferencia_id = t and codigo = K2),
    'alvo criar do SKU novo');
  perform pg_temp.afirmar((select not criar and up_id = 'UP-K1' and delta = 1
                           from public.kit_transferencia_alvos where transferencia_id = t and codigo = K1), 'SKU publicado só aumenta');
  perform pg_temp.afirmar((select delta = -2 from public.kit_transferencia_alvos where transferencia_id = t and codigo = P), 'origem P');
  perform pg_temp.afirmar((select delta = -1 from public.kit_transferencia_alvos where transferencia_id = t and codigo = A), 'origem A');
  perform pg_temp.afirmar((select ordem = 0 from public.kit_marca_ml where org_id = c.org and codigo = K2), 'marca do SKU novo');
  perform pg_temp.afirmar(exists (select 1 from public.kit_marca_ml where org_id = c.org and codigo = A), 'marca da peça nova');
  perform pg_temp.afirmar((select status = 'publicando' from public.kits_variacao where id = k), 'kit volta a publicando');
  perform pg_temp.afirmar(exists (select 1 from public.sku_reivindicacoes_kit where org_id = c.org and codigo = A and kit_id = k),
    'peça nova reivindicada');
  perform pg_temp.afirmar((select cores = '{Preto,Azul}' and rotulo_cor = 'Preto e Azul'
                           from public.kit_variacao_skus where org_id = c.org and codigo = K2), 'SKU novo no mesmo kit');

  -- Mesma chave: a mesma transferência, nada novo.
  r2 := public.kit_variacao_adicionar(c.org, k, v, FK, c.chave, 'H1', novos, existentes, baseline, alvos);
  perform pg_temp.afirmar((r2->>'existente')::boolean and r2->>'transferencia_id' = t::text, 'idempotência: ' || r2::text);
  perform pg_temp.afirmar((r->>'versao')::integer = v + 1 and (r2->>'versao')::integer = v + 1,
    'versão autoritativa no sucesso e na repetição: ' || r::text || ' ' || r2::text);
  perform pg_temp.afirmar(pg_temp.linhas(c.org) = '2/5/2/5/5', 'repetição gravou de novo');
  -- Mesma chave, outro pedido: recusa.
  r2 := public.kit_variacao_adicionar(c.org, k, v, FK, c.chave, 'H2', novos, existentes, baseline, alvos);
  perform pg_temp.afirmar(r2->>'motivo' = 'pedido_diferente', 'pedido diferente aceito: ' || r2::text);
end $$;
