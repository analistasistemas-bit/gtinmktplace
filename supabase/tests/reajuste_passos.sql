-- ADR-0196 — passos duráveis, posse do item (lease) e barreiras com promoção.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/reajuste_passos.sql supabase/migrations/<reajuste_passos>.sql
begin;

create function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FALHA: %', msg; end if;
end $$;

create function pg_temp.item(p_op uuid, p_ml text) returns public.operacoes_massa_itens language sql as $$
  select i from public.operacoes_massa_itens i where i.operacao_id = p_op and i.ml_item_id = p_ml
$$;

-- Devolve o token do claim, exigindo 'ok:<uuid>'.
create function pg_temp.claim(p_org uuid, p_op uuid, p_ml text) returns uuid language plpgsql as $$
declare v_r text := public.reajuste_reivindicar(p_org, p_op, p_ml);
begin
  if v_r not like 'ok:%' then raise exception 'FALHA: claim de % devolveu %', p_ml, v_r; end if;
  return substr(v_r, 4)::uuid;
end $$;

-- Fixture: produto por MLB (a barreira roda por MLB) e 1 variação no MLBP1.
insert into public.organizations (id, nome, slug) values ('94000000-0000-0000-0000-000000000001', 'Passos', 'reajuste-passos-test');
insert into auth.users (id, email, raw_user_meta_data) values
  ('94000000-0000-0000-0000-000000000101', 'reajuste-passos@test.local', '{"org_id":"94000000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('94000000-0000-0000-0000-000000000201', '94000000-0000-0000-0000-000000000101', '94000000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, status, origem, chave_cadastro, ml_item_id, publicado_em)
select '94000000-0000-0000-0000-000000000201', '94000000-0000-0000-0000-000000000101', '94000000-0000-0000-0000-000000000001',
       '094' || lpad(n::text, 5, '0'), 'Produto ' || n, 'CREATE', 'publicado', 'nacional', gen_random_uuid(), 'MLBP' || n, now() - interval '1 day'
from generate_series(1, 11) n;
insert into public.variacoes (id, familia_id, user_id, org_id, codigo, nome, preco, preco_publicacao, preco_editado_pelo_operador, ml_variation_id)
select '94000000-0000-0000-0000-000000000401', f.id, f.user_id, f.org_id, '09400011', 'A', 10, 100, false, 'VA'
from public.familias f where f.ml_item_id = 'MLBP1' and f.org_id = '94000000-0000-0000-0000-000000000001';

insert into public.operacoes_massa (id, org_id, acao, status) values
  ('94000000-0000-0000-0000-000000000501', '94000000-0000-0000-0000-000000000001', 'reajustar', 'executando');
insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, preco, codigo_pai, variacao_ids, passos)
select '94000000-0000-0000-0000-000000000501', '94000000-0000-0000-0000-000000000001', 'MLBP' || n, 'pendente', 110, '094' || lpad(n::text, 5, '0'),
       array['94000000-0000-0000-0000-000000000401']::uuid[],
       '[{"tipo":"faixas","anterior":[],"alvo":[],"estado":"pendente"},{"tipo":"base","anterior":100,"alvo":110,"estado":"pendente"}]'::jsonb
from generate_series(1, 11) n;

do $$
declare
  v_org uuid := '94000000-0000-0000-0000-000000000001';
  v_op uuid := '94000000-0000-0000-0000-000000000501';
  v_var uuid := '94000000-0000-0000-0000-000000000401';
  v_sair uuid := '94000000-0000-0000-0000-000000000502';
  v_aderir uuid := '94000000-0000-0000-0000-000000000503';
  v_alterar uuid := '94000000-0000-0000-0000-000000000504';
  v_rasc uuid := '94000000-0000-0000-0000-000000000505';
  v_rest jsonb := jsonb_build_array(jsonb_build_object('variacao_id', '94000000-0000-0000-0000-000000000401',
    'esperado', jsonb_build_object('preco_publicacao', 100, 'preco_editado_pelo_operador', false),
    'novo', jsonb_build_object('preco_publicacao', 110, 'preco_editado_pelo_operador', false)));
  v_motivo text := 'Anúncio em operação de promoção em andamento';
  v_t1 uuid; v_t2 uuid; v_antes public.operacoes_massa_itens; v_depois public.operacoes_massa_itens; v_erro boolean;
begin
  -- Claim gera token e lease; lease vivo = ocupado.
  v_t1 := pg_temp.claim(v_org, v_op, 'MLBP1');
  v_depois := pg_temp.item(v_op, 'MLBP1');
  perform pg_temp.ok(v_depois.status = 'enviando' and v_depois.lease_token = v_t1 and v_depois.lease_ate = now() + interval '2 minutes', 'claim grava token e lease');
  perform pg_temp.ok(public.reajuste_reivindicar(v_org, v_op, 'MLBP1') = 'ocupado', 'lease vivo → ocupado');
  update public.operacoes_massa_itens set atualizado_em = now() - interval '3 minutes' where operacao_id = v_op and ml_item_id = 'MLBP1';
  perform pg_temp.ok(public.reajuste_reivindicar(v_org, v_op, 'MLBP1') = 'ocupado', 'vale o lease, não atualizado_em');

  -- passo_marcar: estado, etapa, lease.
  update public.operacoes_massa_itens set lease_ate = now() - interval '1 minute' where operacao_id = v_op and ml_item_id = 'MLBP1';
  perform pg_temp.ok(public.reajuste_passo_marcar(v_org, v_op, 'MLBP1', v_t1, 0, 'escrita_pedida'), 'marcar com o token → true');
  v_depois := pg_temp.item(v_op, 'MLBP1');
  perform pg_temp.ok(v_depois.passos->0->>'estado' = 'escrita_pedida' and v_depois.passos->1->>'estado' = 'pendente', 'só o passo do índice muda');
  perform pg_temp.ok(v_depois.etapa = 'escrita_pedida', 'escrita_pedida grava etapa');
  perform pg_temp.ok(v_depois.lease_ate = now() + interval '2 minutes' and v_depois.atualizado_em = now(), 'marcar renova o lease');
  perform pg_temp.ok(((pg_temp.item(v_op, 'MLBP1')).passos->0->>'tentativas')::int = 1, 'escrita_pedida conta a tentativa');
  perform pg_temp.ok(public.reajuste_passo_marcar(v_org, v_op, 'MLBP1', v_t1, 0, 'pendente'), 'pendente → true');
  perform pg_temp.ok(((pg_temp.item(v_op, 'MLBP1')).passos->0->>'tentativas')::int = 1, 'pendente não conta');
  perform pg_temp.ok(public.reajuste_passo_marcar(v_org, v_op, 'MLBP1', v_t1, 0, 'escrita_pedida'), 'segunda escrita → true');
  perform pg_temp.ok(((pg_temp.item(v_op, 'MLBP1')).passos->0->>'tentativas')::int = 2 and (pg_temp.item(v_op, 'MLBP1')).passos->0->>'estado' = 'escrita_pedida', 'segunda tentativa contada');
  perform pg_temp.ok(public.reajuste_passo_marcar(v_org, v_op, 'MLBP1', v_t1, 0, 'confirmado'), 'confirmado → true');
  perform pg_temp.ok((pg_temp.item(v_op, 'MLBP1')).etapa = 'escrita_pedida', 'confirmado não limpa a etapa');

  -- Entradas inválidas são bug do chamador: lançam, não viram "perdeu a posse".
  v_erro := false;
  begin perform public.reajuste_passo_marcar(v_org, v_op, 'MLBP1', v_t1, 2, 'confirmado'); exception when raise_exception then v_erro := true; end;
  perform pg_temp.ok(v_erro, 'índice fora da lista lança');
  v_erro := false;
  begin perform public.reajuste_passo_marcar(v_org, v_op, 'MLBP1', v_t1, 0, 'feito'); exception when raise_exception then v_erro := true; end;
  perform pg_temp.ok(v_erro, 'estado desconhecido lança');
  v_antes := pg_temp.item(v_op, 'MLBP1');
  v_erro := false;
  begin perform public.reajuste_passo_marcar(v_org, v_op, 'MLBP1', v_t1, 0, null); exception when raise_exception then v_erro := true; end;
  perform pg_temp.ok(v_erro, 'estado nulo lança');
  v_erro := false;
  begin perform public.reajuste_passo_marcar(v_org, v_op, 'MLBP1', v_t1, null, 'confirmado'); exception when raise_exception then v_erro := true; end;
  perform pg_temp.ok(v_erro, 'índice nulo lança');
  perform pg_temp.ok(to_jsonb(pg_temp.item(v_op, 'MLBP1')) = to_jsonb(v_antes), 'estado e índice nulos preservam o item');

  -- Lease vencido permite novo claim; o token antigo perde a posse e nada grava.
  update public.operacoes_massa_itens set lease_ate = now() - interval '1 second' where operacao_id = v_op and ml_item_id = 'MLBP1';
  v_t2 := pg_temp.claim(v_org, v_op, 'MLBP1');
  perform pg_temp.ok(v_t2 <> v_t1, 'novo claim, novo token');
  update public.operacoes_massa_itens set atualizado_em = now() - interval '1 hour' where operacao_id = v_op and ml_item_id = 'MLBP1';
  v_antes := pg_temp.item(v_op, 'MLBP1');
  perform pg_temp.ok(not public.reajuste_passo_marcar(v_org, v_op, 'MLBP1', v_t1, 1, 'escrita_pedida'), 'token antigo: marcar false');
  perform pg_temp.ok(not public.reajuste_item_gravar(v_org, v_op, 'MLBP1', v_t1, '{"status":"erro","mensagem":"x"}'), 'token antigo: gravar false');
  perform pg_temp.ok(public.reajuste_persistir(v_org, v_op, 'MLBP1', v_t1, 110, v_rest) = 'sem_posse', 'token antigo: persistir sem_posse');
  perform pg_temp.ok(not public.reajuste_passo_marcar(v_org, v_op, 'MLBP1', null, 1, 'escrita_pedida'), 'token nulo: marcar false');
  perform pg_temp.ok(not public.reajuste_item_gravar(v_org, v_op, 'MLBP1', null, '{"status":"erro"}'), 'token nulo: gravar false');
  perform pg_temp.ok(public.reajuste_persistir(v_org, v_op, 'MLBP1', null, 110, v_rest) = 'sem_posse', 'token nulo: persistir sem_posse');
  perform pg_temp.ok(to_jsonb(pg_temp.item(v_op, 'MLBP1')) = to_jsonb(v_antes), 'token antigo não grava nada no item');
  perform pg_temp.ok((select preco_publicacao = 100 from public.variacoes where id = v_var), 'token antigo não grava variação');

  -- item_gravar: só as chaves enviadas, com null explícito; chave fora da lista lança.
  update public.operacoes_massa_itens set mensagem = 'velha', conferencias = 2, lease_ate = now() - interval '1 minute'
  where operacao_id = v_op and ml_item_id = 'MLBP1';
  perform pg_temp.ok(public.reajuste_item_gravar(v_org, v_op, 'MLBP1', v_t2, '{"mensagem":null,"conferencias":3}'), 'gravar com o token → true');
  v_depois := pg_temp.item(v_op, 'MLBP1');
  perform pg_temp.ok(v_depois.mensagem is null and v_depois.conferencias = 3 and v_depois.status = 'enviando' and v_depois.etapa = 'escrita_pedida', 'gravar parcial');
  perform pg_temp.ok(v_depois.lease_ate = now() + interval '2 minutes' and v_depois.atualizado_em = now(), 'gravar renova o lease');
  v_erro := false;
  begin perform public.reajuste_item_gravar(v_org, v_op, 'MLBP1', v_t2, '{"passos":[]}'); exception when raise_exception then v_erro := true; end;
  perform pg_temp.ok(v_erro, 'gravar não mexe em passos');

  -- Conferência agendada encerra a posse: só um novo claim retoma.
  perform pg_temp.ok(public.reajuste_item_gravar(v_org, v_op, 'MLBP1', v_t2,
    jsonb_build_object('status', 'conferindo', 'proxima_conferencia', now() - interval '1 minute', 'conferencias', 4)), 'agendar conferência');
  v_depois := pg_temp.item(v_op, 'MLBP1');
  perform pg_temp.ok(v_depois.status = 'conferindo' and v_depois.proxima_conferencia = now() - interval '1 minute', 'conferindo gravado');
  perform pg_temp.ok(not public.reajuste_passo_marcar(v_org, v_op, 'MLBP1', v_t2, 1, 'escrita_pedida'), 'conferindo: marcar false');
  v_t2 := pg_temp.claim(v_org, v_op, 'MLBP1');
  perform pg_temp.ok((pg_temp.item(v_op, 'MLBP1')).etapa = 'escrita_pedida', 'retomada preserva a etapa');

  -- Persistir com o token; item `aplicado` não aceita mais transição nem claim.
  perform pg_temp.ok(public.reajuste_persistir(v_org, v_op, 'MLBP1', v_t2, 110, v_rest, 'faixas pendentes') = 'ok', 'persistir com o token');
  perform pg_temp.ok((select preco_publicacao = 110 and preco_publicado_ml = 110 from public.variacoes where id = v_var), 'persistir grava a variação');
  v_depois := pg_temp.item(v_op, 'MLBP1');
  perform pg_temp.ok(v_depois.status = 'aplicado' and v_depois.etapa is null, 'item aplicado');
  perform pg_temp.ok(v_depois.mensagem = 'faixas pendentes', 'aplicado guarda a mensagem');
  perform pg_temp.ok(public.reajuste_persistir(v_org, v_op, 'MLBP1', v_t2, 110, v_rest) = 'ja_aplicado', 'repetir persistir → ja_aplicado');
  perform pg_temp.ok((pg_temp.item(v_op, 'MLBP1')).mensagem = 'faixas pendentes', 'repetir não apaga a mensagem');
  perform pg_temp.ok(not public.reajuste_passo_marcar(v_org, v_op, 'MLBP1', v_t2, 1, 'confirmado'), 'aplicado: marcar false');
  perform pg_temp.ok(not public.reajuste_item_gravar(v_org, v_op, 'MLBP1', v_t2, '{"status":"erro"}'), 'aplicado: gravar false');
  perform pg_temp.ok(public.reajuste_reivindicar(v_org, v_op, 'MLBP1') = 'ocupado', 'aplicado: sem claim');

  -- Estado de volta: etapa durável e nunca retoma a ida.
  v_t1 := pg_temp.claim(v_org, v_op, 'MLBP2');
  perform public.reajuste_passo_marcar(v_org, v_op, 'MLBP2', v_t1, 0, 'volta_pendente');
  perform pg_temp.ok((pg_temp.item(v_op, 'MLBP2')).etapa is null, 'volta_pendente não grava etapa');
  v_erro := false;
  begin perform public.reajuste_passo_marcar(v_org, v_op, 'MLBP2', v_t1, 1, 'escrita_pedida'); exception when raise_exception then v_erro := true; end;
  perform pg_temp.ok(v_erro, 'com passo em volta, a ida não retoma');
  perform pg_temp.ok(public.reajuste_passo_marcar(v_org, v_op, 'MLBP2', v_t1, 0, 'volta_pedida'), 'volta_pedida → true');
  perform pg_temp.ok((pg_temp.item(v_op, 'MLBP2')).etapa = 'escrita_pedida', 'volta_pedida grava etapa');
  perform pg_temp.ok(public.reajuste_passo_marcar(v_org, v_op, 'MLBP2', v_t1, 0, 'compensado'), 'compensado → true');

  -- Barreira: `sair` pendente barra o reajuste; reajuste ativo barra o `sair`.
  insert into public.operacoes_massa (id, org_id, acao, promocao_id, promocao_tipo, status) values
    (v_sair, v_org, 'sair', 'P-SAIR', 'DEAL', 'executando'),
    (v_aderir, v_org, 'aderir', 'P-ADERIR', 'DEAL', 'executando'),
    (v_alterar, v_org, 'alterar_preco', 'P-ALTERAR', 'DEAL', 'executando');
  insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id, status) values (v_sair, v_org, 'P-SAIR', 'MLBP3', 'pendente');
  perform pg_temp.ok(public.reajuste_reivindicar(v_org, v_op, 'MLBP3') = v_motivo, 'sair pendente barra reajuste');
  perform pg_temp.ok((pg_temp.item(v_op, 'MLBP3')).status = 'bloqueado', 'reajuste barrado fica bloqueado');

  insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id, status) values (v_sair, v_org, 'P-SAIR', 'MLBP4', 'pendente');
  perform pg_temp.ok(not public.operacoes_massa_reivindicar(v_org, v_sair, 'MLBP4'), 'reajuste ativo barra sair');
  perform pg_temp.ok((pg_temp.item(v_sair, 'MLBP4')).status = 'mudou', 'sair barrado fica mudou');
  perform pg_temp.ok((pg_temp.item(v_op, 'MLBP4')).status = 'pendente', 'reajuste segue pendente');

  insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id, status) values (v_sair, v_org, 'P-SAIR', 'MLB-SEM-REAJUSTE', 'pendente');
  perform pg_temp.ok(public.operacoes_massa_reivindicar(v_org, v_sair, 'MLB-SEM-REAJUSTE'), 'sair sem reajuste segue');
  perform pg_temp.ok((pg_temp.item(v_sair, 'MLB-SEM-REAJUSTE')).status = 'enviando', 'sair enviando');

  -- Retomada: a escrita pode ter saído sem etapa, então a reserva da promoção fica até a reconciliação.
  insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id, status, atualizado_em) values
    (v_sair, v_org, 'P-SAIR', 'MLBP10', 'enviando', now() - interval '3 minutes'),
    (v_aderir, v_org, 'P-ADERIR', 'MLBP11', 'enviando', now() - interval '3 minutes');
  perform pg_temp.ok(public.operacoes_massa_reivindicar(v_org, v_sair, 'MLBP10'), 'sair enviando parado retoma com reajuste pendente');
  perform pg_temp.ok((pg_temp.item(v_sair, 'MLBP10')).status = 'enviando', 'sair retomado segue enviando');
  perform pg_temp.ok(public.reajuste_reivindicar(v_org, v_op, 'MLBP10') = v_motivo, 'sair retomado barra o reajuste');
  perform pg_temp.ok(public.operacoes_massa_reivindicar(v_org, v_aderir, 'MLBP11'), 'aderir enviando parado retoma com reajuste pendente');
  perform pg_temp.ok(public.reajuste_reivindicar(v_org, v_op, 'MLBP11') = v_motivo, 'aderir retomado barra o reajuste');

  -- Barreira: promoção recém-aplicada (o ML atrasa) e escrita possível.
  insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id, status, atualizado_em)
  values (v_aderir, v_org, 'P-ADERIR', 'MLBP5', 'aplicado', now() - interval '1 minute');
  perform pg_temp.ok(public.reajuste_reivindicar(v_org, v_op, 'MLBP5') = v_motivo, 'aderir aplicado há 1 min barra');

  insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id, status, atualizado_em)
  values (v_aderir, v_org, 'P-ADERIR', 'MLBP6', 'aplicado', now() - interval '3 minutes');
  perform pg_temp.claim(v_org, v_op, 'MLBP6');

  insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id, status, etapa, atualizado_em)
  values (v_aderir, v_org, 'P-ADERIR', 'MLBP7', 'erro', 'escrita_pedida', now() - interval '5 minutes');
  perform pg_temp.ok(public.reajuste_reivindicar(v_org, v_op, 'MLBP7') = v_motivo, 'aderir erro com escrita_pedida há 5 min barra');

  insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id, status, etapa, atualizado_em)
  values (v_aderir, v_org, 'P-ADERIR', 'MLBP8', 'erro', 'escrita_pedida', now() - interval '31 minutes');
  perform pg_temp.claim(v_org, v_op, 'MLBP8');

  insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id, status)
  values (v_alterar, v_org, 'P-ALTERAR', 'MLBP9', 'enviando');
  perform pg_temp.ok(public.reajuste_reivindicar(v_org, v_op, 'MLBP9') = v_motivo, 'alterar_preco enviando barra');

  -- Confirmar: rascunho sem passos é preview antigo.
  insert into public.operacoes_massa (id, org_id, acao, status, expira_em) values (v_rasc, v_org, 'reajustar', 'rascunho', now() + interval '30 minutes');
  insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, codigo_pai, avaliacao, incluido) values
    (v_rasc, v_org, 'MLBR1', 'rascunho', '09400001', '{}', true),
    (v_rasc, v_org, 'MLBR2', 'rascunho', '09400002', '{}', false);
  perform pg_temp.ok(public.reajuste_confirmar(v_org, v_rasc, '[]') = 'expirado', 'rascunho sem passos → expirado');
  perform pg_temp.ok((select status = 'rascunho' from public.operacoes_massa where id = v_rasc), 'continua rascunho');
  update public.operacoes_massa_itens set passos = '[]' where operacao_id = v_rasc and ml_item_id = 'MLBR1';
  perform pg_temp.ok(public.reajuste_confirmar(v_org, v_rasc, '[]') = 'ok', 'com passos confirma; desmarcado sem passos não importa');

  -- Contrato das funções.
  perform pg_temp.ok(to_regprocedure('public.reajuste_persistir(uuid,uuid,text,numeric,jsonb)') is null, 'assinatura antiga de persistir removida');
  perform pg_temp.ok(to_regprocedure('public.reajuste_persistir(uuid,uuid,text,uuid,numeric,jsonb)') is null, 'assinatura sem mensagem removida');
  perform pg_temp.ok((select bool_and(not has_function_privilege(r, f, 'execute') and has_function_privilege('service_role', f, 'execute'))
    from unnest(array['anon', 'authenticated', 'public']) r,
         unnest(array['public.reajuste_persistir(uuid,uuid,text,uuid,numeric,jsonb,text)',
                      'public.reajuste_passo_marcar(uuid,uuid,text,uuid,integer,text,boolean)',
                      'public.reajuste_item_gravar(uuid,uuid,text,uuid,jsonb)',
                      'public.reajuste_reivindicar(uuid,uuid,text)',
                      'public.reajuste_confirmar(uuid,uuid,jsonb)',
                      'public.operacoes_massa_reivindicar(uuid,uuid,text)']) f), 'execute só para service_role');
  perform pg_temp.ok((select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
    from pg_proc p where p.oid in ('public.reajuste_persistir(uuid,uuid,text,uuid,numeric,jsonb,text)'::regprocedure,
      'public.reajuste_passo_marcar(uuid,uuid,text,uuid,integer,text,boolean)'::regprocedure,
      'public.reajuste_item_gravar(uuid,uuid,text,uuid,jsonb)'::regprocedure)), 'definer com search_path vazio');
end $$;
rollback;
