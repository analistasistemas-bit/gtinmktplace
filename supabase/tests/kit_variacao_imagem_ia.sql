\set ON_ERROR_STOP on
-- ADR-0197 (migration kit_variacao_imagem_ia): modelo de imagem padrão aceito; geração idempotente por (org, request_id).
begin;
insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97400000-0000-0000-0000-000000000001', 'Imagem IA', 'imagem-ia-teste', array['kit_variacao', 'imagem_ia'], true);

create or replace function pg_temp.afirmar(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FALHA: %', msg; end if; end $$;

do $$
declare
  o uuid := '97400000-0000-0000-0000-000000000001';
  r uuid := gen_random_uuid();
  recusou boolean;
begin
  -- check do modelo: padrão novo aceito, lixo recusado. Só a configuração da org do fixture (nunca dado real).
  insert into public.configuracoes (org_id) values (o) on conflict (org_id) do nothing;
  -- Erro capturado com mensagem própria: o DETAIL do check_violation traria a linha inteira (inclui segredo).
  begin
    update public.configuracoes set ai_model_imagem = 'google/gemini-nano-banana-2.1'
     where org_id = o;
    perform pg_temp.afirmar(found, 'sem linha de configuracoes para testar o check');
  exception when check_violation then raise exception 'FALHA: check recusou o modelo padrão';
  end;
  begin
    update public.configuracoes set ai_model_imagem = 'google/qualquer'
     where org_id = o;
    recusou := false;
  exception when check_violation then recusou := true;
  end;
  perform pg_temp.afirmar(recusou, 'check aceitou slug fora da lista');

  insert into public.kit_variacao_imagens (org_id, request_id, familia_base_id, cores, rotulo, modelo)
  values (o, r, gen_random_uuid(), array['Preto','Branco'], 'Preto e Branco', 'google/gemini-nano-banana-2.1');
  perform pg_temp.afirmar((select status = 'pendente' from public.kit_variacao_imagens where request_id = r), 'status inicial');

  -- mesmo request_id na mesma org: recusado (a edge devolve "em andamento").
  begin
    insert into public.kit_variacao_imagens (org_id, request_id, familia_base_id, cores, rotulo, modelo)
    values (o, r, gen_random_uuid(), array['Preto','Branco'], 'Preto e Branco', 'google/gemini-nano-banana-2.1');
    recusou := false;
  exception when unique_violation then recusou := true;
  end;
  perform pg_temp.afirmar(recusou, 'request_id repetido aceito');

  -- `pendente_upload` (gerada, upload em curso; não cobrável) também exige caminho e custo > 0.
  begin
    update public.kit_variacao_imagens set status = 'pendente_upload' where request_id = r;
    recusou := false;
  exception when check_violation then recusou := true;
  end;
  perform pg_temp.afirmar(recusou, 'pendente_upload sem caminho nem custo aceito');
  update public.kit_variacao_imagens set status = 'pendente_upload', storage_path = o || '/kit-variacao-ia/x.png', custo_usd = 0.041
   where request_id = r;
  perform pg_temp.afirmar(found, 'pendente_upload completo recusado');
  update public.kit_variacao_imagens set status = 'pendente', storage_path = null, custo_usd = null where request_id = r;

  -- `gerada` (cobrável) exige imagem guardada e custo > 0.
  begin
    update public.kit_variacao_imagens set status = 'gerada' where request_id = r;
    recusou := false;
  exception when check_violation then recusou := true;
  end;
  perform pg_temp.afirmar(recusou, 'gerada sem caminho nem custo aceita');
  -- caminho preenchido e custo nulo: o CHECK não pode virar NULL (aceito).
  begin
    update public.kit_variacao_imagens set status = 'gerada', storage_path = o || '/kit-variacao-ia/x.png' where request_id = r;
    recusou := false;
  exception when check_violation then recusou := true;
  end;
  perform pg_temp.afirmar(recusou, 'gerada com custo nulo aceita');
  update public.kit_variacao_imagens set status = 'gerada', storage_path = o || '/kit-variacao-ia/x.png', custo_usd = 0.041
   where request_id = r;
  perform pg_temp.afirmar(found, 'gerada completa recusada');

  perform pg_temp.afirmar(not has_table_privilege('authenticated', 'public.kit_variacao_imagens', 'select'), 'authenticated lê a tabela');
  perform pg_temp.afirmar(not has_table_privilege('anon', 'public.kit_variacao_imagens', 'insert'), 'anon escreve na tabela');
end $$;
rollback;
