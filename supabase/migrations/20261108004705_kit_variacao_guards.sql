-- ADR-0197 (Task 7): saldo e composição duráveis do SKU que participa de kit com variação.
--
-- Participante = código em `kit_variacao_skus` ou `kit_variacao_componentes` da org.
-- 1. Nova cópia (planilha, adicionar variação, CREATE depois de republicar): trigger em `variacoes` grava o
--    saldo da canônica, lido sob o lock dela, no lugar do ESTOQUE da planilha ou do snapshot. Recusa com
--    transferência aberta. Org sem o módulo segue como hoje.
--    Mutação de saldo que resolveu a canônica antiga antes da troca recebe `canonica_trocou` (40001,
--    retentável) em vez de baixar a cópia que deixou de valer.
-- 2. Exclusão de cor: a última cópia de um participante não sai; apagar a canônica com outra sobrando leva o
--    saldo para a próxima canônica (senão o saldo voltaria mudo ao valor da cópia velha). Marcar a cor como
--    fora da publicação (`excluida_da_publicacao`) também é recusado.
-- 3. `preparar_republicacao` disputa a exclusão (`kit_exclusoes`) dos participantes, como a transferência:
--    transferência, ativação ou publicação pendente recusa. Fora disso incrementa a versão da política,
--    invalidando trabalhos antigos (publicação compara `versoes_kit`, saga compara a soma).
-- 4. `limpar_movimentos_orfaos` preserva movimento de participante e de transferência.
-- 5. `kit_variacao_base_em_kit`: base com kit vinculado ou Kit Virtual vivo (validação da Task 10).
--
-- Transferência aberta = `kit_sku_em_transferencia` (estado ativa ou travada), a mesma das RPCs da Task 2.
-- `db push` não roda em transação: cada statement é re-executável.

-- Exigidos pela troca de dono e pelo grant em função do executor (mesma receita de 20261107192458).
grant estoque_rpc_executor to postgres;
grant usage, create on schema public to estoque_rpc_executor;

-- Republicação disputa a exclusão por SKU durante a própria transação (insere e apaga na mesma RPC).
alter table public.kit_exclusoes drop constraint if exists kit_exclusoes_dono_tipo_check;
alter table public.kit_exclusoes add constraint kit_exclusoes_dono_tipo_check
  check (dono_tipo in ('transferencia', 'publicacao', 'ativacao', 'republicacao'));

-- preparar_republicacao (dono postgres) usa a mesma noção de transferência aberta.
grant execute on function public.kit_sku_em_transferencia(uuid, text) to postgres;

-- 1. Saldo da nova cópia. Dono executor: o lock e a releitura usam `kit_sku_travado`. Serializa com toda
-- mutação de saldo pelo lock da linha canônica antiga: quem a resolveu antes e esperou o lock cai na
-- conferência do update abaixo (`canonica_trocou`).
create or replace function public.kit_variacao_saldo_copia()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_modulos text[]; v_sku record; v_canonica uuid;
begin
  if not exists (select 1 from public.kit_variacao_skus s where s.org_id = new.org_id and s.codigo = new.codigo)
     and not exists (select 1 from public.kit_variacao_componentes c where c.org_id = new.org_id and c.codigo = new.codigo) then
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
    where v.org_id = new.org_id and v.codigo = new.codigo order by f.criado_em desc limit 1;
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

-- Antes de `variacoes_validar_tenant_insert` (ordem alfabética): a validação vê o saldo já trocado.
drop trigger if exists variacoes_kit_saldo_copia on public.variacoes;
create trigger variacoes_kit_saldo_copia
  before insert on public.variacoes
  for each row execute procedure public.kit_variacao_saldo_copia();

-- Toda mutação de saldo (baixar/estornar_estoque, registrar_entrada, ajustar_estoque, kit_aplicar_movimento)
-- termina num UPDATE da linha que resolveu e travou. Para participante, sob esse lock: a linha ainda é a
-- canônica? Se uma cópia nova commitou enquanto esperava, recusa a transação inteira (o movimento já gravado
-- volta junto) com erro retentável; a repetição resolve a cópia nova. Também recusa tirar o participante
-- da publicação (`excluida_da_publicacao`): seria remover a cor do anúncio por fora da saga.
-- `kit.carregando_saldo` libera só o transporte de saldo da exclusão (a linha apagada ainda é visível).
create or replace function public.kit_variacao_conferir_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_modulos text[]; v_canonica uuid;
begin
  if coalesce(current_setting('kit.carregando_saldo', true), '') = '1' then
    return new;
  end if;
  if not exists (select 1 from public.kit_variacao_skus s where s.org_id = new.org_id and s.codigo = new.codigo)
     and not exists (select 1 from public.kit_variacao_componentes c where c.org_id = new.org_id and c.codigo = new.codigo) then
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
    where v.org_id = new.org_id and v.codigo = new.codigo order by f.criado_em desc limit 1;
    if v_canonica is distinct from new.id then
      raise exception 'canonica_trocou: a cópia canônica de % mudou durante a operação. Repita.', new.codigo
        using errcode = '40001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists variacoes_kit_conferir_update on public.variacoes;
create trigger variacoes_kit_conferir_update
  before update of estoque, excluida_da_publicacao on public.variacoes
  for each row
  when (old.estoque is distinct from new.estoque
        or (new.excluida_da_publicacao and not old.excluida_da_publicacao))
  execute procedure public.kit_variacao_conferir_update();

-- 2. Exclusão. Só conta cópia de família viva: no cascade, a família já saiu e a variação dela ainda não.
create or replace function public.kit_variacao_sair(p_org uuid, p_codigo text, p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_estoque integer; v_canonica uuid; v_prox uuid;
begin
  select estoque into v_estoque from public.variacoes where id = p_id for update;

  select v.id into v_canonica from public.variacoes v join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo order by f.criado_em desc limit 1;
  select v.id into v_prox from public.variacoes v join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo and v.id <> p_id order by f.criado_em desc limit 1;

  if v_prox is null then
    raise exception 'SKU % está na composição de kit com variação e não pode ser excluído.', p_codigo
      using errcode = '23514';
  end if;

  if v_canonica = p_id then
    perform set_config('kit.carregando_saldo', '1', true);
    update public.variacoes set estoque = v_estoque where id = v_prox;
    perform set_config('kit.carregando_saldo', '', true);
  end if;
end $$;

create or replace function public.kit_variacao_preservar_variacao()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  -- Cascade: a família já saiu e o trigger dela tratou estas linhas.
  if not exists (select 1 from public.familias where id = old.familia_id) then
    return old;
  end if;
  if exists (select 1 from public.kit_variacao_skus s where s.org_id = old.org_id and s.codigo = old.codigo)
     or exists (select 1 from public.kit_variacao_componentes c where c.org_id = old.org_id and c.codigo = old.codigo) then
    perform public.kit_variacao_sair(old.org_id, old.codigo, old.id);
  end if;
  return old;
end $$;

create or replace function public.kit_variacao_preservar_familia()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in
    select v.id, v.codigo from public.variacoes v
    where v.familia_id = old.id
      and (exists (select 1 from public.kit_variacao_skus s where s.org_id = v.org_id and s.codigo = v.codigo)
        or exists (select 1 from public.kit_variacao_componentes c where c.org_id = v.org_id and c.codigo = v.codigo))
    order by v.codigo
  loop
    perform public.kit_variacao_sair(old.org_id, r.codigo, r.id);
  end loop;
  return old;
end $$;

drop trigger if exists variacoes_kit_preservar_composicao on public.variacoes;
create trigger variacoes_kit_preservar_composicao
  before delete on public.variacoes
  for each row execute procedure public.kit_variacao_preservar_variacao();

drop trigger if exists familias_kit_preservar_composicao on public.familias;
create trigger familias_kit_preservar_composicao
  before delete on public.familias
  for each row execute procedure public.kit_variacao_preservar_familia();

-- 3. Corpo de 20261018131329 (ADR-0185) mais o guard do ADR-0197, depois dos locks e da recusa de
-- processamento e antes de qualquer escrita.
create or replace function public.preparar_republicacao(
  p_org uuid, p_canal text, p_codigo_pai text, p_familia_alvo uuid
) returns table (familia_id uuid, lote_id uuid, lotes_afetados uuid[])
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_vigente uuid;
  v_lote uuid;
  v_status text;
  v_tem_raiz boolean;
  v_lotes uuid[];
  v_modulos text[];
  v_kit text[];
  v_codigo text;
  v_dono text;
  v_exclusao uuid := gen_random_uuid();
begin
  -- Serializa republicações concorrentes do mesmo produto (e contra quem mexe nas mesmas linhas).
  perform 1 from familias f where f.org_id = p_org and f.codigo_pai = p_codigo_pai for update;
  perform 1 from anuncios_externos a
   where a.org_id = p_org and a.canal = p_canal::canal_externo and a.codigo_pai = p_codigo_pai for update;

  -- D-1 (republicar): a cópia mais nova com vínculo — inclui UPDATE ainda não publicado e CREATE
  -- de split parcial; é a que traz os dados mais novos.
  select f.id, f.lote_id, f.status into v_vigente, v_lote, v_status
    from familias f
   where f.org_id = p_org and f.codigo_pai = p_codigo_pai and f.ml_item_id is not null
   order by f.criado_em desc, f.id desc
   limit 1;

  if v_vigente is null then
    -- Sem vínculo nenhum: ou UP com saga interrompida (raiz ainda existe → preserva a pedida),
    -- ou uma republicação anterior já rodou (raízes apagadas) → recusa, nunca um 2º CREATE.
    select exists (
      select 1 from anuncios_externos a
       where a.org_id = p_org and a.canal = p_canal::canal_externo and a.codigo_pai = p_codigo_pai
    ) into v_tem_raiz;
    if not v_tem_raiz then
      raise exception 'republicar:nao_publicada' using errcode = 'P0001';
    end if;
    select f.id, f.lote_id, f.status into v_vigente, v_lote, v_status
      from familias f
     where f.id = p_familia_alvo and f.org_id = p_org and f.codigo_pai = p_codigo_pai;
    if v_vigente is null then
      raise exception 'republicar:nao_encontrada' using errcode = 'P0001';
    end if;
  end if;

  if v_status in ('pendente', 'processando', 'publicando') then
    raise exception 'republicar:em_processamento' using errcode = 'P0001';
  end if;

  -- ADR-0197: participante de kit com variação (qualquer cópia do pai). Disputa a mesma exclusão que
  -- transferência, publicação e ativação, em ordem de código, até o fim desta transação: transferência que
  -- começa depois espera o commit e só então pega a exclusão. Dono atual recusa — transferência/ativação
  -- (o vínculo que ela usa não pode sumir) ou publicação pendente (a exclusão dela tem a raiz antiga como
  -- dono e não é liberada às cegas: pode ser criação remota incerta). Fora disso, política e composição
  -- ficam (são por código) e a versão sobe: job enfileirado antes é recusado. Sem linha nasce com 1.
  select modulos_habilitados into v_modulos from organizations o where o.id = p_org;
  if coalesce('kit_variacao' = any(v_modulos), false) then
    select coalesce(array_agg(distinct v.codigo order by v.codigo), '{}') into v_kit
      from variacoes v join familias f on f.id = v.familia_id
     where f.org_id = p_org and f.codigo_pai = p_codigo_pai
       and (exists (select 1 from kit_variacao_skus s where s.org_id = p_org and s.codigo = v.codigo)
         or exists (select 1 from kit_variacao_componentes c where c.org_id = p_org and c.codigo = v.codigo));
    foreach v_codigo in array v_kit loop
      insert into kit_exclusoes (org_id, codigo, dono_tipo, dono_id)
      values (p_org, v_codigo, 'republicacao', v_exclusao)
      on conflict (org_id, codigo) do nothing;
      if not found then
        select x.dono_tipo into v_dono from kit_exclusoes x where x.org_id = p_org and x.codigo = v_codigo;
        if v_dono = 'publicacao' then
          raise exception 'republicar:kit_publicacao_pendente' using errcode = 'P0001';
        end if;
        raise exception 'republicar:kit_em_transferencia' using errcode = 'P0001';
      end if;
    end loop;
    if exists (select 1 from unnest(v_kit) k(codigo) where public.kit_sku_em_transferencia(p_org, k.codigo)) then
      raise exception 'republicar:kit_em_transferencia' using errcode = 'P0001';
    end if;
    insert into sku_politica_kit as p (org_id, codigo, versao)
    select p_org, k.codigo, 1 from unnest(v_kit) k(codigo) order by k.codigo
    on conflict (org_id, codigo) do update set versao = p.versao + 1;
  end if;

  -- SKU que só existe numa cópia anterior (UPDATE parcial: o ingest não clona os ausentes) é parte
  -- do produto: muda para a vigente a linha mais nova de cada um, com preço/estoque/foto, antes do
  -- DELETE abaixo — senão o cascade levaria a variação e o saldo dela.
  update variacoes v set familia_id = v_vigente
   where v.id in (
     select distinct on (v2.codigo) v2.id
       from variacoes v2 join familias f on f.id = v2.familia_id
      where f.org_id = p_org and f.codigo_pai = p_codigo_pai
        and f.ml_item_id is not null and f.id <> v_vigente
        and not exists (select 1 from variacoes v3 where v3.familia_id = v_vigente and v3.codigo = v2.codigo)
      order by v2.codigo, f.criado_em desc, f.id desc
   );

  -- Cópias anteriores do mesmo pai: apagadas (mesmo corte do Remover). Mantidas como `publicado`
  -- sem vínculo virariam zumbis contados como kit vivo pelos guards.
  select coalesce(array_agg(distinct f.lote_id), '{}') into v_lotes
    from familias f
   where f.org_id = p_org and f.codigo_pai = p_codigo_pai
     and f.ml_item_id is not null and f.id <> v_vigente;
  delete from familias f
   where f.org_id = p_org and f.codigo_pai = p_codigo_pai
     and f.ml_item_id is not null and f.id <> v_vigente;

  update variacoes v set ml_variation_id = null, preco_publicado_ml = null, ml_picture_id = null
   where v.familia_id = v_vigente;

  update familias f set
      ml_item_id = null, ml_permalink = null, publicado_em = null,
      capa_ml_picture_id = null, capa2_ml_picture_id = null, capa3_ml_picture_id = null,
      operacao = 'CREATE'::operacao_ml,
      status = (case when f.status = 'erro' then 'erro' else 'pronto' end)::familia_status,
      erro_mensagem = case when f.status = 'erro' then f.erro_mensagem else null end
   where f.id = v_vigente;

  delete from anuncios_externos a
   where a.org_id = p_org and a.canal = p_canal::canal_externo and a.codigo_pai = p_codigo_pai;

  update lotes l set status = 'revisao'::lote_status where l.id = v_lote;

  delete from kit_exclusoes x where x.org_id = p_org and x.dono_id = v_exclusao;

  return query select v_vigente, v_lote, v_lotes;
end;
$$;

revoke all on function public.preparar_republicacao(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.preparar_republicacao(uuid, text, text, uuid) to service_role;

-- 4. Corpo de 20260801092323 (ADR-0097 D-1.1) mais o ADR-0197: movimento de SKU em composição e de
-- transferência nunca é órfão. Apagar o de transferência liberaria o índice único e a reserva repetiria.
create or replace function public.limpar_movimentos_orfaos(p_org uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_removidos integer;
begin
  if p_org is null then
    raise exception 'limpar_movimentos_orfaos: org é obrigatória';
  end if;

  delete from public.estoque_movimentos m
  where m.org_id = p_org
    and m.motivo not in (
      'cancelamento_sem_baixa',      -- guarda D-19, não histórico
      'venda_sku_nao_encontrado',
      'estorno_sku_nao_encontrado',
      'venda_cancelada_antes'
    )
    and m.transferencia_id is null
    and not exists (
      select 1 from public.variacoes v
      where v.org_id = m.org_id and v.codigo = m.codigo
    )
    and not exists (select 1 from public.kit_variacao_skus s where s.org_id = m.org_id and s.codigo = m.codigo)
    and not exists (select 1 from public.kit_variacao_componentes c where c.org_id = m.org_id and c.codigo = m.codigo);

  get diagnostics v_removidos = row_count;
  return v_removidos;
end $$;

revoke execute on function public.limpar_movimentos_orfaos(uuid)
  from public, anon, authenticated;
grant execute on function public.limpar_movimentos_orfaos(uuid)
  to service_role;

-- 5. Validação reversa (Task 10): motivo para recusar kit com variação sobre estes SKUs, ou null.
-- Conservador nos dois: só o encerramento seguro libera.
-- Kit vinculado: o SKU é de uma base com família de kit em qualquer status (`erro` é retomável pelo reenvio
-- da chave; só a exclusão da família encerra) ou é ele mesmo kit vinculado.
-- Kit Virtual em qualquer status menos `encerrado`: `erro` não distingue recusa definitiva do ML de resposta
-- perdida com o kit criado, então conta como ocupado. `codigo` do componente é best-effort (D-12): também
-- casa pelo user product ou item do anúncio local do SKU, como `bloquear_remocao_componente_kit_virtual`.
create or replace function public.kit_variacao_base_em_kit(p_org uuid, p_codigos text[])
returns text language sql stable security definer set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.variacoes v join public.familias f on f.id = v.familia_id
      where v.org_id = p_org and v.codigo = any(p_codigos)
        and (f.kit_multiplicador is not null or exists (
          select 1 from public.familias k
          where k.org_id = p_org and k.kit_base_codigo_pai = f.codigo_pai and k.kit_multiplicador is not null))
    ) then 'SKU com kit vinculado: kit com variação não pode usar esta base.'
    when exists (
      select 1 from public.kits_virtuais k
      join public.kits_virtuais_componentes c on c.kit_id = k.id
      where k.org_id = p_org and k.status <> 'encerrado'
        and (c.codigo = any(p_codigos) or exists (
          select 1 from public.anuncios_externos_itens i
          where i.org_id = p_org and i.sku = any(p_codigos)
            and (i.user_product_id = c.user_product_id or i.item_externo_id = c.item_externo_id)))
    ) then 'SKU em Kit Virtual: kit com variação não pode usar esta base.'
  end
$$;

-- ACL antes da troca de dono (20260811203500).
revoke all on function public.kit_variacao_base_em_kit(uuid, text[]) from public, anon, authenticated;
grant execute on function public.kit_variacao_base_em_kit(uuid, text[]) to service_role;
revoke all on function public.kit_variacao_saldo_copia() from public, anon, authenticated;
revoke all on function public.kit_variacao_conferir_update() from public, anon, authenticated;
revoke all on function public.kit_variacao_preservar_variacao() from public, anon, authenticated;
revoke all on function public.kit_variacao_preservar_familia() from public, anon, authenticated;
revoke all on function public.kit_variacao_sair(uuid, text, uuid) from public, anon, authenticated, service_role;

-- Dono executor: único papel que escreve `variacoes.estoque` (bloquear_escrita_direta_estoque).
alter function public.kit_variacao_saldo_copia() owner to estoque_rpc_executor;
alter function public.kit_variacao_conferir_update() owner to estoque_rpc_executor;
alter function public.kit_variacao_sair(uuid, text, uuid) owner to estoque_rpc_executor;
alter function public.kit_variacao_preservar_variacao() owner to estoque_rpc_executor;
alter function public.kit_variacao_preservar_familia() owner to estoque_rpc_executor;

revoke create on schema public from estoque_rpc_executor;

do $$
begin
  revoke estoque_rpc_executor from postgres;
exception when others then
  raise warning 'membership de postgres em estoque_rpc_executor nao revogada: %', sqlerrm;
end $$;
