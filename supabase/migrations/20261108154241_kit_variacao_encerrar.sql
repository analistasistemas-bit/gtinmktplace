-- ADR-0200, emenda 2026-11-08: Encerrar kit. Fecha os itens do kit no ML (saga, tipo `encerrar`), tira o kit de
-- Publicados e devolve as peças da base a Normal, sem apagar variação, composição, ledger nem histórico.
--
-- 1. Tipo `encerrar` em `kit_transferencias`.
-- 2. `kit_participante`: regra única de participação. SKU de kit participa sempre (itens fechados, identidade da
--    venda e recusa de excluir a última cópia preservadas); peça da base só enquanto um kit NÃO encerrado a usa.
--    `kit_skus_participantes` (guardas das edges) e os triggers da Task 7 passam a usá-la: edge e banco não divergem.
-- 3. A transferência `encerrar` segura só os SKUs do kit: `kit_sku_em_transferencia` e `kit_reposicao_pendente` não
--    expandem os componentes dela (entrada e ajuste das peças seguem durante o encerramento).
-- 4. Triggers de rede: kit `encerrando`/`encerrado` não volta, não liga "Vender só em kit"/reposição e não recebe
--    outra transferência.
-- 5. `kit_variacao_encerrar` (tela), `kit_encerrar_aplicar` (efeito local) e `kit_encerrar_finalizar` (saga).
--
-- `db push` não roda em transação: cada statement é re-executável.

-- Exigidos para redefinir funções do executor (mesma receita de 20261108004705).
grant estoque_rpc_executor to postgres;
grant usage, create on schema public to estoque_rpc_executor;

-- 1. Tipo. O check inline tem o nome gerado `kit_transferencias_tipo_check` (conferido no dump de produção).
alter table public.kit_transferencias drop constraint if exists kit_transferencias_tipo_check;
alter table public.kit_transferencias add constraint kit_transferencias_tipo_check
  check (tipo in ('montar', 'desmontar', 'repor', 'cancelamento', 'sair_sobra', 'entrada', 'encerrar'));

alter table public.kits_variacao add column if not exists encerrado_em timestamptz;
-- Aviso de conclusão enviado (`avisarKitsEncerrados`): a varredura diária reenvia, com a mesma chave, o que faltou.
alter table public.kits_variacao add column if not exists encerrado_avisado_em timestamptz;

-- 2. Participação. Security definer: os triggers do executor chamam, e o executor não lê `kits_variacao`.
-- Peça da base segue participante depois do encerramento enquanto a política persistida a restringe ou há pausa da
-- automação a desfazer: o push comum reativaria sem olhar os bloqueios, e a reposição desfaz a pausa com exclusão e CAS.
create or replace function public.kit_participante(p_org uuid, p_codigo text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.kit_variacao_skus s where s.org_id = p_org and s.codigo = p_codigo)
      or exists (
        select 1 from public.kit_variacao_componentes c
        where c.org_id = p_org and c.codigo = p_codigo and (
          exists (select 1 from public.kit_variacao_skus s join public.kits_variacao k on k.id = s.kit_id and k.org_id = s.org_id
                  where s.id = c.kit_sku_id and s.org_id = c.org_id and k.status <> 'encerrado')
          or exists (select 1 from public.sku_politica_kit p
                     where p.org_id = p_org and p.codigo = p_codigo
                       and (p.estado <> 'normal' or p.bloqueio_operador or p.bloqueio_moderacao or p.bloqueio_retirada))
          or exists (select 1 from public.kit_pausas_automaticas a where a.org_id = p_org and a.codigo = p_codigo)))
$$;
revoke all on function public.kit_participante(uuid, text) from public, anon, authenticated;
grant execute on function public.kit_participante(uuid, text) to service_role, estoque_rpc_executor;

-- Triagem diária (reconciliar-estoque): participantes que ainda têm oferta. SKU de kit encerrado fica de fora (itens
-- fechados, não "sem user product"); o saldo preso nele vai pelo aviso de `avisarKitsEncerrados`.
create or replace function public.kit_codigos_triagem(p_org uuid)
returns text[] language sql stable set search_path = ''
as $$
  select coalesce(array_agg(distinct c order by c), '{}') from (
    select s.codigo c from public.kit_variacao_skus s join public.kits_variacao k on k.id = s.kit_id and k.org_id = s.org_id
    where s.org_id = p_org and k.status <> 'encerrado'
    union
    select x.codigo from public.kit_variacao_componentes x
    where x.org_id = p_org and public.kit_participante(p_org, x.codigo)
  ) t
$$;
revoke all on function public.kit_codigos_triagem(uuid) from public, anon, authenticated;
grant execute on function public.kit_codigos_triagem(uuid) to service_role;

-- Corpo de 20261108105448 com a regra de `kit_participante` (mesmo formato: códigos distintos num escalar).
create or replace function public.kit_skus_participantes(p_org uuid, p_codigos text[])
returns text[] language sql stable set search_path = ''
as $$
  select coalesce(array_agg(distinct c order by c), '{}')
  from unnest(p_codigos) c
  where public.kit_participante(p_org, c);
$$;
revoke all on function public.kit_skus_participantes(uuid, text[]) from public, anon, authenticated;
grant execute on function public.kit_skus_participantes(uuid, text[]) to service_role;

-- Corpo vigente de 20261108105448 (kit_variacao_saldo_copia), só com a regra de `kit_participante` no início.
create or replace function public.kit_variacao_saldo_copia()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_modulos text[]; v_sku record; v_canonica uuid;
begin
  if not public.kit_participante(new.org_id, new.codigo) then
    return new;
  end if;

  select modulos_habilitados into v_modulos from public.organizations where id = new.org_id;
  if not coalesce('kit_variacao' = any(v_modulos), false) then
    return new;
  end if;

  -- `kit_sku_travado` resolve o id antes de esperar o lock. Se outra cópia commitou (ou a canônica foi
  -- apagada) nessa espera, a linha travada já não é a canônica: recusa com o erro retentável, sem pegar
  -- outro lock — travar a nova aqui segurando a velha faria ciclo com o transporte de saldo da exclusão
  -- (que trava a apagada e depois a próxima). Sem a recusa, a cópia copiaria o saldo velho e, sendo a mais
  -- recente, apagaria uma venda já baixada na cópia intermediária. Os chamadores do INSERT repetem.
  select * into v_sku from public.kit_sku_travado(new.org_id, new.codigo);
  if v_sku.p_id is not null then
    select v.id into v_canonica from public.variacoes v join public.familias f on f.id = v.familia_id
    where v.org_id = new.org_id and v.codigo = new.codigo order by f.criado_em desc, f.id desc limit 1;
    if v_canonica is distinct from v_sku.p_id then
      raise exception 'canonica_trocou: a cópia canônica de % mudou durante a operação. Repita.', new.codigo
        using errcode = '40001';
    end if;
  end if;
  if public.kit_sku_em_transferencia(new.org_id, new.codigo) then
    raise exception 'sku_em_transferencia: % está em transferência de kit com variação. Repita depois que ela terminar.', new.codigo
      using errcode = '23514';
  end if;

  new.estoque := coalesce(v_sku.p_estoque, 0);
  return new;
end $$;

-- Corpo vigente de 20261108105448 (kit_variacao_conferir_update), só com a regra de `kit_participante`.
create or replace function public.kit_variacao_conferir_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_modulos text[]; v_canonica uuid;
begin
  if coalesce(current_setting('kit.carregando_saldo', true), '') = '1' then
    return new;
  end if;
  if not public.kit_participante(new.org_id, new.codigo) then
    return new;
  end if;
  select modulos_habilitados into v_modulos from public.organizations where id = new.org_id;
  if not coalesce('kit_variacao' = any(v_modulos), false) then
    return new;
  end if;

  if new.excluida_da_publicacao and not old.excluida_da_publicacao then
    raise exception 'SKU % está em kit com variação e não pode sair da publicação.', new.codigo
      using errcode = '23514';
  end if;

  if new.estoque is distinct from old.estoque then
    select v.id into v_canonica from public.variacoes v join public.familias f on f.id = v.familia_id
    where v.org_id = new.org_id and v.codigo = new.codigo order by f.criado_em desc, f.id desc limit 1;
    if v_canonica is distinct from new.id then
      raise exception 'canonica_trocou: a cópia canônica de % mudou durante a operação. Repita.', new.codigo
        using errcode = '40001';
    end if;
  end if;
  return new;
end $$;

-- Corpo vigente de 20261108004705 (kit_variacao_preservar_variacao), só com a regra de `kit_participante`.
create or replace function public.kit_variacao_preservar_variacao()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  -- Cascade: a família já saiu e o trigger dela tratou estas linhas.
  if not exists (select 1 from public.familias where id = old.familia_id) then
    return old;
  end if;
  if public.kit_participante(old.org_id, old.codigo) then
    perform public.kit_variacao_sair(old.org_id, old.codigo, old.id);
  end if;
  return old;
end $$;

-- Corpo vigente de 20261108004705 (kit_variacao_preservar_familia), só com a regra de `kit_participante`.
create or replace function public.kit_variacao_preservar_familia()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in
    select v.id, v.codigo from public.variacoes v
    where v.familia_id = old.id and public.kit_participante(v.org_id, v.codigo)
    order by v.codigo
  loop
    perform public.kit_variacao_sair(old.org_id, r.codigo, r.id);
  end loop;
  return old;
end $$;

-- 3. Corpo de 20261107192458 (kit_sku_em_transferencia): a transferência `encerrar` não expande componentes.
create or replace function public.kit_sku_em_transferencia(p_org uuid, p_codigo text)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1
    from public.kit_transferencias t
    cross join lateral jsonb_array_elements(t.itens) e
    where t.org_id = p_org and t.estado in ('ativa', 'travada')
      and (e->>'codigo' = p_codigo or (t.tipo <> 'encerrar' and exists (
        select 1
        from public.kit_variacao_skus s
        join public.kit_variacao_componentes c on c.kit_sku_id = s.id
        where s.org_id = p_org and s.kit_id = t.kit_id
          and s.codigo = e->>'codigo' and c.codigo = p_codigo)))
  )
$$;

-- Corpo de 20261108052338 (kit_reposicao_pendente): mesmo predicado de kit_sku_em_transferencia.
create or replace function public.kit_reposicao_pendente(p_org uuid, p_codigo text)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1
    from public.kit_transferencias t
    cross join lateral jsonb_array_elements(t.itens) e
    where t.org_id = p_org and t.estado in ('ativa', 'travada')
      and (e->>'codigo' = p_codigo or (t.tipo <> 'encerrar' and exists (
        select 1
        from public.kit_variacao_skus s
        join public.kit_variacao_componentes c on c.kit_sku_id = s.id
        where s.org_id = p_org and s.kit_id = t.kit_id
          and s.codigo = e->>'codigo' and c.codigo = p_codigo)))
  )
$$;

-- 4. Redes. Kit encerrando/encerrado não volta nem liga política de reposição.
create or replace function public.kits_variacao_guarda_encerrado()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.status in ('encerrando', 'encerrado') and (
    (new.status is distinct from old.status and not (old.status = 'encerrando' and new.status = 'encerrado'))
    or (new.so_em_kit and not old.so_em_kit)
    or (new.reposicao_auto and not old.reposicao_auto)
  ) then
    raise exception 'kit_encerrado: o kit % foi encerrado e não muda mais.', old.codigo_pai_kit using errcode = 'KX030';
  end if;
  return new;
end $$;

drop trigger if exists kits_variacao_guarda_encerrado on public.kits_variacao;
create trigger kits_variacao_guarda_encerrado
  before update on public.kits_variacao
  for each row execute procedure public.kits_variacao_guarda_encerrado();

-- Transferência de kit encerrando/encerrado: só a `encerrar`, e ela só com o kit em `encerrando`. O kit vem de
-- `kit_id` ou dos SKUs de kit em `itens` (`entrada`, `sair_sobra` e snapshot antigo têm `kit_id` nulo). Serializa com o
-- encerramento: trava os kits (`for share`, em ordem de id) ANTES de ler o status, então quem esperou o
-- `for update` de `kit_variacao_encerrar` lê o status já commitado. Security definer: `kit_criar_transferencia`
-- insere como executor, que não lê `kits_variacao`.
create or replace function public.kit_transferencias_guarda_encerrado()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_kits uuid[];
begin
  v_kits := array(
    select distinct k from (
      select new.kit_id k where new.kit_id is not null
      union
      select s.kit_id from jsonb_array_elements(new.itens) e
      join public.kit_variacao_skus s on s.org_id = new.org_id and s.codigo = e->>'codigo'
    ) x order by 1);
  perform 1 from public.kits_variacao where org_id = new.org_id and id = any(v_kits) order by id for share;
  if new.tipo = 'encerrar' then
    if not exists (select 1 from public.kits_variacao k
                   where k.id = new.kit_id and k.org_id = new.org_id and k.status = 'encerrando') then
      raise exception 'kit_encerrado: transferência encerrar sem kit em encerramento' using errcode = 'KX030';
    end if;
    return new;
  end if;
  if exists (select 1 from public.kits_variacao k
             where k.org_id = new.org_id and k.id = any(v_kits) and k.status in ('encerrando', 'encerrado')) then
    raise exception 'kit_encerrado: kit encerrado não recebe transferência %.', new.tipo using errcode = 'KX030';
  end if;
  return new;
end $$;

drop trigger if exists kit_transferencias_guarda_encerrado on public.kit_transferencias;
create trigger kit_transferencias_guarda_encerrado
  before insert on public.kit_transferencias
  for each row execute procedure public.kit_transferencias_guarda_encerrado();

-- Exclusão de SKU de kit encerrando/encerrado: só para transferência (a `encerrar`; as outras o trigger acima recusa).
-- Publicação, ativação e republicação (`preparar_republicacao` insere a exclusão antes de apagar vínculos e virar
-- CREATE) são recusadas e desfazem a operação inteira.
create or replace function public.kit_exclusoes_guarda_encerrado()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.dono_tipo = 'transferencia' then
    return new;
  end if;
  -- Mesmo lock da guarda de transferência: espera o encerramento em curso e lê o status commitado.
  perform 1 from public.kits_variacao k
  where k.org_id = new.org_id
    and k.id in (select s.kit_id from public.kit_variacao_skus s where s.org_id = new.org_id and s.codigo = new.codigo)
  order by k.id for share;
  if exists (
    select 1 from public.kit_variacao_skus s join public.kits_variacao k on k.id = s.kit_id and k.org_id = s.org_id
    where s.org_id = new.org_id and s.codigo = new.codigo and k.status in ('encerrando', 'encerrado')
  ) then
    raise exception 'kit_encerrado: % é de kit encerrado (%).', new.codigo, new.dono_tipo using errcode = 'KX030';
  end if;
  return new;
end $$;

drop trigger if exists kit_exclusoes_guarda_encerrado on public.kit_exclusoes;
create trigger kit_exclusoes_guarda_encerrado
  before insert on public.kit_exclusoes
  for each row execute procedure public.kit_exclusoes_guarda_encerrado();

-- 5a. Efeito local do encerramento. Interna: quem chama travou a org e o kit e já fechou os itens no ML (ou o kit
-- nunca chegou ao ML). Não apaga variação, composição, ledger nem venda.
create or replace function public.kit_encerrar_aplicar(p_org uuid, p_kit uuid)
returns jsonb language plpgsql set search_path = ''
as $$
declare v_skus text[]; v_normais text[];
begin
  v_skus := array(select codigo from public.kit_variacao_skus where org_id = p_org and kit_id = p_kit order by codigo);
  -- Reivindicações do kit saem; peça sem outra volta a Normal (versão + 1); `so_em_kit` desliga.
  v_normais := coalesce(public.kit_reposicao_desligar(p_org, p_kit), '{}');
  -- Itens do kit estão fechados: a pausa da automação deles não tem mais o que desfazer.
  delete from public.kit_pausas_automaticas where org_id = p_org and codigo = any(v_skus);
  -- Padrão de "retirar" (`atualizar-familia-up`): o check de status não tem "encerrado".
  update public.anuncios_externos_itens set retirado = true, status = 'pausado'
  where org_id = p_org and sku = any(v_skus);
  update public.kits_variacao set status = 'encerrado', encerrado_em = now(), reposicao_auto = false, versao = versao + 1
  where id = p_kit and org_id = p_org;
  -- Saldo preso (crédito durante o encerramento) e o aviso de conclusão: `avisarKitsEncerrados`, depois do commit.
  return jsonb_build_object('normais', to_jsonb(v_normais));
end $$;

-- 5b. Tela (Gerenciar kit, admin). Ver ADR-0200, emenda "Encerrar kit", item 2.
create or replace function public.kit_variacao_encerrar(p_org uuid, p_kit uuid, p_versao integer)
returns jsonb language plpgsql set search_path = ''
as $$
declare v_kit public.kits_variacao%rowtype; v_skus text[]; v_alvos jsonb; v_sem_alvo text[]; v_cod text;
        v_t jsonb; v_id uuid; v_r jsonb;
begin
  perform 1 from public.organizations where id = p_org and 'kit_variacao' = any(modulos_habilitados) for share;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'modulo_desligado');
  end if;
  select * into v_kit from public.kits_variacao where id = p_kit and org_id = p_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'kit_nao_encontrado');
  end if;
  -- Repetição: devolve o estado atual, sem efeito.
  if v_kit.status = 'encerrado' then
    return jsonb_build_object('ok', true, 'existente', true, 'encerrado', true, 'versao', v_kit.versao);
  end if;
  if v_kit.status = 'encerrando' then
    return jsonb_build_object('ok', true, 'existente', true, 'versao', v_kit.versao, 'transferencia_id',
      (select t.id from public.kit_transferencias t where t.org_id = p_org and t.kit_id = p_kit and t.tipo = 'encerrar'
       order by t.criado_em desc limit 1));
  end if;
  if p_versao is distinct from v_kit.versao then
    return jsonb_build_object('ok', false, 'motivo', 'versao', 'versao_atual', v_kit.versao);
  end if;

  v_skus := array(select codigo from public.kit_variacao_skus where org_id = p_org and kit_id = p_kit order by codigo);
  if exists (select 1 from public.kit_transferencias t
             where t.org_id = p_org and t.kit_id = p_kit and t.estado in ('ativa', 'travada'))
     or exists (select 1 from unnest(v_skus) c where public.kit_reposicao_pendente(p_org, c)) then
    return jsonb_build_object('ok', false, 'motivo', 'transferencia_aberta');
  end if;

  -- Saldo da variação canônica de cada SKU, travado contra baixa/estorno em voo (que travam a mesma linha).
  select c into v_cod from unnest(v_skus) c
  where coalesce((select v.estoque from public.variacoes v join public.familias f on f.id = v.familia_id
                  where v.org_id = p_org and v.codigo = c order by f.criado_em desc, f.id desc limit 1
                  for share of v), 0) <> 0
  order by c limit 1;
  if v_cod is not null then
    return jsonb_build_object('ok', false, 'motivo', 'saldo', 'codigo', v_cod);
  end if;

  -- Alvos do vínculo local, nunca da edge: um por SKU com UP, item + cópia de catálogo.
  v_alvos := coalesce((
    select jsonb_agg(jsonb_build_object('codigo', i.sku, 'up_id', i.user_product_id,
             'item_ids', to_jsonb(array_remove(array[i.item_externo_id, i.catalog_listing_id], null))) order by i.sku)
    from (select distinct on (x.sku) x.sku, x.user_product_id, x.item_externo_id, x.catalog_listing_id
          from public.anuncios_externos_itens x
          where x.org_id = p_org and x.sku = any(v_skus) and x.user_product_id is not null and x.item_externo_id is not null
          order by x.sku, x.retirado, x.atualizado_em desc) i), '[]'::jsonb);
  v_sem_alvo := array(select c from unnest(v_skus) c
                      where not exists (select 1 from jsonb_array_elements(v_alvos) a where a->>'codigo' = c) order by c);

  begin
    update public.kits_variacao set status = 'encerrando', reposicao_auto = false, versao = versao + 1
    where id = p_kit returning * into v_kit;

    if jsonb_array_length(v_alvos) = 0 then
      -- Nada chegou ao ML: encerra aqui mesmo. A exclusão de todos os SKUs (dono só desta transação) recusa
      -- publicação em curso, que a segura até confirmar o resultado; a nova espera o lock do kit (guarda acima).
      v_id := gen_random_uuid();
      v_r := public.kit_adquirir_exclusao(p_org, v_skus, 'transferencia', v_id);
      if not coalesce((v_r->>'ok')::boolean, false) then
        raise exception 'up_ocupado:%', coalesce(v_r->>'codigo', v_r->>'motivo') using errcode = 'KX040';
      end if;
      v_r := public.kit_encerrar_aplicar(p_org, p_kit);
      delete from public.kit_exclusoes where org_id = p_org and dono_id = v_id;
      return jsonb_build_object('ok', true, 'encerrado', true, 'normais', v_r->'normais',
        'versao', (select versao from public.kits_variacao where id = p_kit));
    end if;

    v_t := public.kit_criar_transferencia(p_org, p_kit, 'encerrar',
      (select jsonb_agg(jsonb_build_object('codigo', a->>'codigo', 'quantidade', 0) order by a->>'codigo')
       from jsonb_array_elements(v_alvos) a),
      v_alvos);
    if not coalesce((v_t->>'ok')::boolean, false) then
      raise exception '%', coalesce(v_t->>'motivo', 'transferencia') || coalesce(':' || (v_t->>'codigo'), '') using errcode = 'KX040';
    end if;
    v_id := (v_t->>'id')::uuid;
    -- SKU sem UP: fora dos alvos, mas com a exclusão do mesmo dono (nenhuma publicação o cria no meio).
    if cardinality(v_sem_alvo) > 0 then
      v_r := public.kit_adquirir_exclusao(p_org, v_sem_alvo, 'transferencia', v_id);
      if not coalesce((v_r->>'ok')::boolean, false) then
        raise exception 'up_ocupado:%', coalesce(v_r->>'codigo', v_r->>'motivo') using errcode = 'KX040';
      end if;
    end if;
    update public.kit_transferencias set passo = 'fechar' where id = v_id;
  exception when sqlstate 'KX040' then
    -- Tudo desta operação é desfeito (status, versão, transferência e exclusões).
    return jsonb_build_object('ok', false, 'motivo', split_part(sqlerrm, ':', 1), 'codigo', nullif(split_part(sqlerrm, ':', 2), ''));
  end;

  return jsonb_build_object('ok', true, 'transferencia_id', v_id, 'versao', v_kit.versao);
end $$;

-- 5c. Conclusão pela saga, numa transação: efeito local, exclusões e transferência. Locks: org, transferência, kit.
create or replace function public.kit_encerrar_finalizar(p_org uuid, p_transferencia uuid, p_token uuid)
returns jsonb language plpgsql set search_path = ''
as $$
declare v_t public.kit_transferencias%rowtype; v_kit public.kits_variacao%rowtype; v_r jsonb;
begin
  perform 1 from public.organizations where id = p_org for share;
  perform public.kit_saga_validar(p_org, p_transferencia, p_token);
  select * into v_t from public.kit_transferencias where id = p_transferencia and org_id = p_org;
  if v_t.tipo <> 'encerrar' then
    raise exception 'kit_encerrar_finalizar: transferência % não é encerrar', p_transferencia;
  end if;
  if exists (select 1 from public.kit_transferencia_alvos
             where transferencia_id = p_transferencia and org_id = p_org and escrita_em is null) then
    raise exception 'kit_encerrar_pendente: transferência % tem item sem fechamento confirmado', p_transferencia
      using errcode = 'KX041';
  end if;
  select * into v_kit from public.kits_variacao where id = v_t.kit_id and org_id = p_org for update;
  if v_kit.status <> 'encerrando' then
    raise exception 'kit_encerrar_finalizar: kit % em %', v_t.kit_id, v_kit.status;
  end if;
  v_r := public.kit_encerrar_aplicar(p_org, v_t.kit_id);
  perform public.kit_saga_finalizar(p_org, p_transferencia, p_token, 'concluida', null, '[]'::jsonb);
  return v_r || jsonb_build_object('kit_id', v_kit.id, 'codigo_pai_kit', v_kit.codigo_pai_kit);
end $$;

revoke all on function public.kit_encerrar_aplicar(uuid, uuid) from public, anon, authenticated;
revoke all on function public.kit_variacao_encerrar(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.kit_encerrar_finalizar(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.kits_variacao_guarda_encerrado() from public, anon, authenticated;
revoke all on function public.kit_transferencias_guarda_encerrado() from public, anon, authenticated;
revoke all on function public.kit_exclusoes_guarda_encerrado() from public, anon, authenticated;
grant execute on function public.kit_encerrar_aplicar(uuid, uuid) to service_role;
grant execute on function public.kit_variacao_encerrar(uuid, uuid, integer) to service_role;
grant execute on function public.kit_encerrar_finalizar(uuid, uuid, uuid) to service_role;

revoke create on schema public from estoque_rpc_executor;

do $$
begin
  revoke estoque_rpc_executor from postgres;
exception when others then
  raise warning 'membership de postgres em estoque_rpc_executor nao revogada: %', sqlerrm;
end $$;
