-- ADR-0200 (Task 14): "Vender só em kit". Estados por SKU (Normal, Guardado, Sobra) e reposição automática.
--
-- 1. `kit_pausas_automaticas`: pausa que a automação fez e ainda não desfez. Gravada só pela saga, ao finalizar,
--    com os itens que ela pausou e a política deixou pausados (validados contra `pausado_pela_saga`). A reposição
--    desfaz só estas, e só fora de Guardado. Pausa anterior (manual) nunca entra: a saga não a pausou.
-- 2. Decisões versionadas: Guardado → Sobra, Sobra → Guardado (com os parceiros reservados pela exclusão da
--    transferência `sair_sobra`, na mesma transação, antes da pausa) e `repor` só com origens Guardadas. Todas
--    travam a política dos SKUs envolvidos em ordem de código e recusam se a versão difere da fotografia.
-- 3. Ligar e desligar: reivindicação por kit; SKU só volta a Normal sem nenhuma reivindicação. Toda mudança de
--    estado incrementa `versao` (a saga em curso perde a reativação, por versão exata).
--
-- `db push` não roda em transação: cada statement é re-executável.

create table if not exists public.kit_pausas_automaticas (
  org_id           uuid not null references public.organizations(id),
  codigo           text not null,
  item_id          text not null,
  transferencia_id uuid not null,
  criado_em        timestamptz not null default now(),
  primary key (org_id, item_id)
);
alter table public.kit_pausas_automaticas enable row level security;
drop policy if exists "kit_pausas_automaticas: select org" on public.kit_pausas_automaticas;
create policy "kit_pausas_automaticas: select org" on public.kit_pausas_automaticas for select to authenticated
  using (org_id = (select public.current_org_id()));
revoke all on public.kit_pausas_automaticas from anon;
revoke insert, update, delete, truncate, references, trigger on public.kit_pausas_automaticas from authenticated;
grant select on public.kit_pausas_automaticas to authenticated;
grant all on public.kit_pausas_automaticas to service_role;

-- Aviso de Sobra pendente: nasce na mesma transação da transição (kit_reposicao_sobra) e só sai depois do envio.
-- `resultado` (reativado | ativo | pausado | inexistente | sem_pausa) é gravado antes do envio: a retomada repete o mesmo texto.
create table if not exists public.kit_avisos_sobra (
  org_id    uuid not null references public.organizations(id),
  codigo    text not null,
  versao    integer not null,
  resultado text check (resultado in ('reativado', 'ativo', 'pausado', 'inexistente', 'sem_pausa')),
  criado_em timestamptz not null default now(),
  primary key (org_id, codigo, versao)
);
alter table public.kit_avisos_sobra enable row level security;
drop policy if exists "kit_avisos_sobra: select org" on public.kit_avisos_sobra;
create policy "kit_avisos_sobra: select org" on public.kit_avisos_sobra for select to authenticated
  using (org_id = (select public.current_org_id()));
revoke all on public.kit_avisos_sobra from anon;
revoke insert, update, delete, truncate, references, trigger on public.kit_avisos_sobra from authenticated;
grant select on public.kit_avisos_sobra to authenticated;
grant all on public.kit_avisos_sobra to service_role;

-- Corpo de 20261107212019 mais `p_pausas`. Assinatura nova: a antiga sai.
drop function if exists public.kit_saga_finalizar(uuid, uuid, uuid, text, text);
create or replace function public.kit_saga_finalizar(
  p_org uuid, p_transferencia uuid, p_token uuid, p_estado text, p_alerta text, p_pausas jsonb default '[]'::jsonb
) returns void language plpgsql set search_path = ''
as $$
begin
  if p_estado not in ('concluida', 'abortada') then
    raise exception 'kit_saga_finalizar: estado inválido %', p_estado;
  end if;
  perform public.kit_saga_validar(p_org, p_transferencia, p_token);
  if exists (select 1 from public.kit_transferencia_alvos
             where transferencia_id = p_transferencia and org_id = p_org and cardinality(repausar) > 0) then
    raise exception 'kit_repausa_pendente: transferência % tem item a repausar', p_transferencia using errcode = 'KX005';
  end if;
  -- Só item que esta saga pausou (no alvo do próprio código): o chamador não cria pausa alheia.
  insert into public.kit_pausas_automaticas (org_id, codigo, item_id, transferencia_id)
  select p_org, a.codigo, p->>'itemId', p_transferencia
  from jsonb_array_elements(coalesce(p_pausas, '[]'::jsonb)) p
  join public.kit_transferencia_alvos a
    on a.transferencia_id = p_transferencia and a.org_id = p_org and a.codigo = p->>'codigo'
   and (p->>'itemId') = any(a.pausado_pela_saga)
  on conflict (org_id, item_id) do nothing;
  delete from public.kit_exclusoes where org_id = p_org and dono_tipo = 'transferencia' and dono_id = p_transferencia;
  update public.kit_transferencias
  set estado = p_estado, passo = 'fim', alerta = coalesce(p_alerta, alerta), passo_em = now(),
      execucao_token = null, execucao_ate = null
  where id = p_transferencia and org_id = p_org;
end $$;

-- Saldo local da variação canônica (família mais recente), sem lock: só para a fotografia.
create or replace function public.kit_reposicao_saldo(p_org uuid, p_codigo text)
returns integer language sql stable set search_path = ''
as $$
  select v.estoque from public.variacoes v join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo order by f.criado_em desc limit 1
$$;

-- Mesmo predicado de kit_sku_em_transferencia (20261107192458), que é só das RPCs de estoque e fica fora do
-- service_role: SKU listado em transferência aberta, direto ou como componente de um SKU de kit listado.
create or replace function public.kit_reposicao_pendente(p_org uuid, p_codigo text)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1
    from public.kit_transferencias t
    cross join lateral jsonb_array_elements(t.itens) e
    where t.org_id = p_org and t.estado in ('ativa', 'travada')
      and (e->>'codigo' = p_codigo or exists (
        select 1
        from public.kit_variacao_skus s
        join public.kit_variacao_componentes c on c.kit_sku_id = s.id
        where s.org_id = p_org and s.kit_id = t.kit_id
          and s.codigo = e->>'codigo' and c.codigo = p_codigo))
  )
$$;

-- Fotografia consistente (uma consulta, um snapshot) para `planejarReposicao`: kits com "Vender só em kit" da org
-- mais o kit do job, seus SKUs e componentes, a política de cada componente e as pausas da automação.
create or replace function public.kit_reposicao_foto(p_org uuid, p_kit uuid)
returns jsonb language sql stable set search_path = ''
as $$
  with kits as (
    select k.id, k.meta, k.reposicao_auto, k.so_em_kit from public.kits_variacao k
    where k.org_id = p_org and (k.so_em_kit or k.id = p_kit)
  ), ks as (
    select s.kit_id, s.id, s.codigo from public.kit_variacao_skus s join kits on kits.id = s.kit_id
    where s.org_id = p_org
  ), pausas as (
    select codigo, item_id from public.kit_pausas_automaticas where org_id = p_org
  ), cods as (
    select c.codigo from ks join public.kit_variacao_componentes c on c.kit_sku_id = ks.id and c.org_id = p_org
    union
    select codigo from pausas
  )
  select jsonb_build_object(
    'kits', coalesce((select jsonb_agg(jsonb_build_object(
        'id', k.id, 'meta', k.meta, 'reposicaoAuto', k.reposicao_auto, 'soEmKit', k.so_em_kit,
        'skus', coalesce((select jsonb_agg(jsonb_build_object(
            'codigo', ks.codigo,
            'saldo', coalesce(public.kit_reposicao_saldo(p_org, ks.codigo), 0),
            'publicado', exists (select 1 from public.anuncios_externos_itens i
                                 where i.org_id = p_org and i.sku = ks.codigo and i.user_product_id is not null),
            'pendente', public.kit_reposicao_pendente(p_org, ks.codigo),
            'componentes', coalesce((select jsonb_agg(jsonb_build_object('codigo', c.codigo, 'quantidade', c.quantidade)
                                                      order by c.codigo)
                                     from public.kit_variacao_componentes c where c.kit_sku_id = ks.id and c.org_id = p_org),
                                    '[]'::jsonb)
          ) order by ks.codigo) from ks where ks.kit_id = k.id), '[]'::jsonb)
      ) order by k.id) from kits k), '[]'::jsonb),
    'skus', coalesce((select jsonb_agg(jsonb_build_object(
        'codigo', x.codigo, 'saldo', coalesce(public.kit_reposicao_saldo(p_org, x.codigo), 0),
        'estado', coalesce(p.estado, 'normal'), 'versao', coalesce(p.versao, 0),
        'pendente', public.kit_reposicao_pendente(p_org, x.codigo)) order by x.codigo)
      from cods x left join public.sku_politica_kit p on p.org_id = p_org and p.codigo = x.codigo), '[]'::jsonb),
    'pausas', coalesce((select jsonb_agg(jsonb_build_object('codigo', codigo, 'itemId', item_id) order by codigo, item_id)
                        from pausas), '[]'::jsonb),
    'avisos', coalesce((select jsonb_agg(jsonb_build_object('codigo', a.codigo, 'versao', a.versao, 'resultado', a.resultado)
                                         order by a.codigo, a.versao)
                        from public.kit_avisos_sobra a where a.org_id = p_org), '[]'::jsonb)
  )
$$;

-- Trava a política dos códigos (linha ausente nasce com versão 0, como em kit_politica_operador) em ordem de
-- código e devolve o primeiro cuja versão difere da fotografia; null = decisão atual.
create or replace function public.kit_reposicao_conferir(p_org uuid, p_versoes jsonb)
returns text language plpgsql set search_path = ''
as $$
declare v_cod text;
begin
  insert into public.sku_politica_kit (org_id, codigo, versao)
  select p_org, k, 0 from jsonb_object_keys(p_versoes) k order by k
  on conflict (org_id, codigo) do nothing;
  perform 1 from public.sku_politica_kit
  where org_id = p_org and codigo in (select jsonb_object_keys(p_versoes)) order by codigo for update;
  select p.codigo into v_cod from public.sku_politica_kit p
  where p.org_id = p_org and p.codigo in (select jsonb_object_keys(p_versoes))
    and p.versao <> (p_versoes->>p.codigo)::integer
  order by p.codigo limit 1;
  return v_cod;
end $$;

-- Guardado → Sobra. Só Guardado, sem transferência pendente, e com toda a política na versão da fotografia.
create or replace function public.kit_reposicao_sobra(p_org uuid, p_codigos text[], p_versoes jsonb)
returns jsonb language plpgsql set search_path = ''
as $$
declare v_cod text;
begin
  perform 1 from public.organizations where id = p_org and 'kit_variacao' = any(modulos_habilitados) for share;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'modulo_desligado');
  end if;
  if cardinality(p_codigos) = 0 or exists (select unnest(p_codigos) except select jsonb_object_keys(p_versoes)) then
    return jsonb_build_object('ok', false, 'motivo', 'versao_ausente');
  end if;
  v_cod := public.kit_reposicao_conferir(p_org, p_versoes);
  if v_cod is not null then
    return jsonb_build_object('ok', false, 'motivo', 'versao', 'codigo', v_cod);
  end if;
  select c into v_cod from unnest(p_codigos) c
  where not exists (select 1 from public.sku_politica_kit p where p.org_id = p_org and p.codigo = c and p.estado = 'guardado')
     or public.kit_reposicao_pendente(p_org, c)
  order by c limit 1;
  if v_cod is not null then
    return jsonb_build_object('ok', false, 'motivo', 'estado', 'codigo', v_cod);
  end if;
  with u as (
    update public.sku_politica_kit set estado = 'sobra', versao = versao + 1
    where org_id = p_org and codigo = any(p_codigos)
    returning codigo, versao
  )
  insert into public.kit_avisos_sobra (org_id, codigo, versao)
  select p_org, codigo, versao from u
  on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- Sobra → Guardado: estado e transferência `sair_sobra` (os códigos e os parceiros) numa transação. A exclusão
-- da transferência reserva os parceiros antes da pausa: nenhuma outra transferência os consome no meio. A montagem
-- só vem depois, com a pausa confirmada (o planejador ignora SKU pendente). Qualquer recusa desfaz tudo.
create or replace function public.kit_reposicao_guardar(
  p_org uuid, p_codigos text[], p_parceiros text[], p_versoes jsonb, p_alvos jsonb
) returns jsonb language plpgsql set search_path = ''
as $$
declare v_cod text; v_t jsonb;
begin
  perform 1 from public.organizations where id = p_org and 'kit_variacao' = any(modulos_habilitados) for share;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'modulo_desligado');
  end if;
  if cardinality(p_codigos) = 0
     or exists (select unnest(p_codigos || p_parceiros) except select jsonb_object_keys(p_versoes)) then
    return jsonb_build_object('ok', false, 'motivo', 'versao_ausente');
  end if;
  v_cod := public.kit_reposicao_conferir(p_org, p_versoes);
  if v_cod is not null then
    return jsonb_build_object('ok', false, 'motivo', 'versao', 'codigo', v_cod);
  end if;
  select c into v_cod from unnest(p_codigos) c
  where not exists (select 1 from public.sku_politica_kit p where p.org_id = p_org and p.codigo = c and p.estado = 'sobra')
     or not exists (select 1 from public.sku_reivindicacoes_kit r where r.org_id = p_org and r.codigo = c)
  order by c limit 1;
  if v_cod is null then
    select c into v_cod from unnest(p_parceiros) c
    where not exists (select 1 from public.sku_politica_kit p
                      where p.org_id = p_org and p.codigo = c and p.estado in ('guardado', 'sobra'))
    order by c limit 1;
  end if;
  if v_cod is not null then
    return jsonb_build_object('ok', false, 'motivo', 'estado', 'codigo', v_cod);
  end if;

  begin
    update public.sku_politica_kit set estado = 'guardado', versao = versao + 1
    where org_id = p_org and codigo = any(p_codigos);
    v_t := public.kit_criar_transferencia(p_org, null, 'sair_sobra',
      (select jsonb_agg(jsonb_build_object('codigo', c, 'quantidade', 0) order by c)
       from (select distinct unnest(p_codigos || p_parceiros) c) x),
      p_alvos);
    if not coalesce((v_t->>'ok')::boolean, false) then
      raise exception '%', coalesce(v_t->>'motivo', 'transferencia') || coalesce(':' || (v_t->>'codigo'), '')
        using errcode = 'KX011';
    end if;
  exception when sqlstate 'KX011' then
    return jsonb_build_object('ok', false, 'motivo', split_part(sqlerrm, ':', 1), 'codigo', nullif(split_part(sqlerrm, ':', 2), ''));
  end;
  return jsonb_build_object('ok', true, 'transferencia_id', v_t->>'id');
end $$;

-- Reposição automática: só kit com "Vender só em kit" e reposição ligadas, origens todas Guardadas e na versão da
-- fotografia. Meta e peça suficiente seguem conferidas na reserva (kit_reservar_transferencia).
create or replace function public.kit_reposicao_repor(
  p_org uuid, p_kit uuid, p_itens jsonb, p_versoes jsonb, p_alvos jsonb
) returns jsonb language plpgsql set search_path = ''
as $$
declare v_cod text; v_t jsonb;
begin
  perform 1 from public.organizations where id = p_org and 'kit_variacao' = any(modulos_habilitados) for share;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'modulo_desligado');
  end if;
  perform 1 from public.kits_variacao where id = p_kit and org_id = p_org and so_em_kit and reposicao_auto for share;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'kit_sem_reposicao');
  end if;
  if exists (
    select c.codigo from jsonb_array_elements(p_itens) e
    join public.kit_variacao_skus s on s.org_id = p_org and s.kit_id = p_kit and s.codigo = e->>'codigo'
    join public.kit_variacao_componentes c on c.kit_sku_id = s.id and c.org_id = p_org
    except select jsonb_object_keys(p_versoes)
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'versao_ausente');
  end if;
  v_cod := public.kit_reposicao_conferir(p_org, p_versoes);
  if v_cod is not null then
    return jsonb_build_object('ok', false, 'motivo', 'versao', 'codigo', v_cod);
  end if;
  select c.codigo into v_cod from jsonb_array_elements(p_itens) e
  join public.kit_variacao_skus s on s.org_id = p_org and s.kit_id = p_kit and s.codigo = e->>'codigo'
  join public.kit_variacao_componentes c on c.kit_sku_id = s.id and c.org_id = p_org
  left join public.sku_politica_kit p on p.org_id = p_org and p.codigo = c.codigo
  where coalesce(p.estado, 'normal') <> 'guardado'
  order by c.codigo limit 1;
  if v_cod is not null then
    return jsonb_build_object('ok', false, 'motivo', 'origem_nao_guardada', 'codigo', v_cod);
  end if;
  v_t := public.kit_criar_transferencia(p_org, p_kit, 'repor', p_itens, p_alvos);
  if not coalesce((v_t->>'ok')::boolean, false) then
    return v_t;
  end if;
  return jsonb_build_object('ok', true, 'transferencia_id', v_t->>'id');
end $$;

-- Reivindica os componentes para o kit e liga as duas opções. Normal → Guardado (versão + 1); Guardado e Sobra
-- só ganham a reivindicação. Devolve os que mudaram para Guardado (os individuais a pausar). Interna: quem chama
-- já travou a org e o kit.
create or replace function public.kit_reposicao_reivindicar(p_org uuid, p_kit uuid)
returns text[] language plpgsql set search_path = ''
as $$
declare v_comp text[]; v_guardados text[];
begin
  v_comp := array(select distinct c.codigo from public.kit_variacao_skus s
                  join public.kit_variacao_componentes c on c.kit_sku_id = s.id and c.org_id = p_org
                  where s.org_id = p_org and s.kit_id = p_kit order by 1);
  insert into public.sku_reivindicacoes_kit (org_id, codigo, kit_id)
  select p_org, c, p_kit from unnest(v_comp) c
  on conflict do nothing;
  insert into public.sku_politica_kit (org_id, codigo, versao)
  select p_org, c, 0 from unnest(v_comp) c order by c
  on conflict (org_id, codigo) do nothing;
  perform 1 from public.sku_politica_kit where org_id = p_org and codigo = any(v_comp) order by codigo for update;
  with u as (
    update public.sku_politica_kit set estado = 'guardado', versao = versao + 1
    where org_id = p_org and codigo = any(v_comp) and estado = 'normal'
    returning codigo
  ) select coalesce(array_agg(codigo order by codigo), '{}') into v_guardados from u;
  update public.kits_variacao set so_em_kit = true, reposicao_auto = true where id = p_kit and org_id = p_org;
  return v_guardados;
end $$;

-- Ligar num kit existente (Gerenciar kit): os que viraram Guardado entram numa transferência `sair_sobra`, que
-- pausa e confere pedidos; até ela terminar, o planejador não usa as peças (SKU pendente). SKU ocupado recusa tudo.
create or replace function public.kit_reposicao_ligar(p_org uuid, p_kit uuid, p_alvos jsonb)
returns jsonb language plpgsql set search_path = ''
as $$
declare v_g text[]; v_t jsonb;
begin
  perform 1 from public.organizations where id = p_org and 'kit_variacao' = any(modulos_habilitados) for share;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'modulo_desligado');
  end if;
  perform 1 from public.kits_variacao where id = p_kit and org_id = p_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'kit_nao_encontrado');
  end if;
  begin
    v_g := public.kit_reposicao_reivindicar(p_org, p_kit);
    if cardinality(v_g) > 0 then
      v_t := public.kit_criar_transferencia(p_org, null, 'sair_sobra',
        (select jsonb_agg(jsonb_build_object('codigo', c, 'quantidade', 0) order by c) from unnest(v_g) c),
        (select coalesce(jsonb_agg(a), '[]'::jsonb) from jsonb_array_elements(p_alvos) a where a->>'codigo' = any(v_g)));
      if not coalesce((v_t->>'ok')::boolean, false) then
        raise exception '%', coalesce(v_t->>'motivo', 'transferencia') || coalesce(':' || (v_t->>'codigo'), '')
          using errcode = 'KX011';
      end if;
    end if;
  exception when sqlstate 'KX011' then
    return jsonb_build_object('ok', false, 'motivo', split_part(sqlerrm, ':', 1), 'codigo', nullif(split_part(sqlerrm, ':', 2), ''));
  end;
  return jsonb_build_object('ok', true, 'transferencia_id', v_t->>'id');
end $$;

-- Desligar: remove só a reivindicação deste kit. SKU sem nenhuma volta a Normal (versão + 1); com outro kit
-- reivindicando, fica como está. Devolve os que voltaram a Normal; a reposição desfaz as pausas da automação deles.
create or replace function public.kit_reposicao_desligar(p_org uuid, p_kit uuid)
returns text[] language plpgsql set search_path = ''
as $$
declare v_comp text[]; v_normais text[];
begin
  perform 1 from public.kits_variacao where id = p_kit and org_id = p_org for update;
  if not found then
    raise exception 'kit_reposicao_desligar: kit % não encontrado na organização', p_kit;
  end if;
  v_comp := array(select codigo from public.sku_reivindicacoes_kit where org_id = p_org and kit_id = p_kit order by 1);
  perform 1 from public.sku_politica_kit where org_id = p_org and codigo = any(v_comp) order by codigo for update;
  delete from public.sku_reivindicacoes_kit where org_id = p_org and kit_id = p_kit;
  with u as (
    update public.sku_politica_kit p set estado = 'normal', versao = versao + 1
    where p.org_id = p_org and p.codigo = any(v_comp) and p.estado <> 'normal'
      and not exists (select 1 from public.sku_reivindicacoes_kit r where r.org_id = p_org and r.codigo = p.codigo)
    returning p.codigo
  ) select coalesce(array_agg(codigo order by codigo), '{}') into v_normais from u;
  update public.kits_variacao set so_em_kit = false where id = p_kit and org_id = p_org;
  return v_normais;
end $$;

-- Corpo de 20261108040001 mais "Vender só em kit" na criação (kit_reposicao_reivindicar antes da montagem).
create or replace function public.kit_variacao_criar(
  p_org uuid, p_chave uuid, p_kit jsonb, p_skus jsonb, p_baseline jsonb, p_alvos jsonb
) returns jsonb language plpgsql set search_path = ''
as $$
declare v_kit uuid; v_sku uuid; v_id uuid; v_estoque integer; v_motivo text; v_comp text[]; v_t jsonb;
        v_s jsonb; v_b record;
begin
  perform 1 from public.organizations where id = p_org and 'kit_variacao' = any(modulos_habilitados) for share;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'modulo_desligado');
  end if;

  select id into v_kit from public.kits_variacao where org_id = p_org and chave_cadastro = p_chave;
  if found then
    if (select pedido_hash from public.kits_variacao where id = v_kit) is distinct from p_kit->>'pedido_hash' then
      return jsonb_build_object('ok', false, 'motivo', 'pedido_diferente');
    end if;
    return jsonb_build_object('ok', true, 'existente', true, 'kit_id', v_kit, 'transferencia_id',
      (select id from public.kit_transferencias where org_id = p_org and kit_id = v_kit and tipo = 'montar'
       order by criado_em limit 1));
  end if;

  v_comp := array(select distinct c->>'codigo' from jsonb_array_elements(p_skus) s
                  cross join lateral jsonb_array_elements(s->'componentes') c);
  v_motivo := public.kit_variacao_base_em_kit(p_org, v_comp);
  if v_motivo is not null then
    return jsonb_build_object('ok', false, 'motivo', 'base_em_kit', 'mensagem', v_motivo);
  end if;
  if exists (select unnest(v_comp) except select b->>'codigo' from jsonb_array_elements(p_baseline) b) then
    return jsonb_build_object('ok', false, 'motivo', 'baseline_incompleto');
  end if;

  begin
    insert into public.kits_variacao
      (org_id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, preco, meta, status, chave_cadastro, listing_type_id, pedido_hash)
    values (p_org, p_kit->>'codigo_pai_base', p_kit->>'codigo_pai_kit', (p_kit->>'pecas_por_kit')::smallint,
            (p_kit->>'preco')::numeric, coalesce((p_kit->>'meta')::integer, 0), 'publicando', p_chave,
            coalesce(p_kit->>'listing_type_id', 'gold_special'), p_kit->>'pedido_hash')
    returning id into v_kit;

    for v_s in select * from jsonb_array_elements(p_skus) loop
      insert into public.kit_variacao_skus (org_id, kit_id, codigo, tamanho, cores, rotulo_cor)
      values (p_org, v_kit, v_s->>'codigo', v_s->>'tamanho',
              array(select jsonb_array_elements_text(v_s->'cores')), v_s->>'rotulo_cor')
      returning id into v_sku;
      insert into public.kit_variacao_componentes (kit_sku_id, org_id, codigo, quantidade)
      select v_sku, p_org, c->>'codigo', (c->>'quantidade')::integer from jsonb_array_elements(v_s->'componentes') c;
    end loop;

    for v_b in
      select x.codigo, max(x.ml) as ml from (
        select e->>'codigo' as codigo, (e->>'ml')::integer as ml from jsonb_array_elements(p_baseline) e
        where e->>'codigo' = any(v_comp)
        union all
        select s->>'codigo', 0 from jsonb_array_elements(p_skus) s
      ) x group by x.codigo order by x.codigo
    loop
      select v.id into v_id from public.variacoes v join public.familias f on f.id = v.familia_id
      where v.org_id = p_org and v.codigo = v_b.codigo order by f.criado_em desc limit 1;
      if v_id is null then
        raise exception '%', v_b.codigo using errcode = 'KX007';
      end if;
      select estoque into v_estoque from public.variacoes where id = v_id for update;
      continue when exists (select 1 from public.kit_marca_ml where org_id = p_org and codigo = v_b.codigo);
      if v_estoque is distinct from v_b.ml then
        raise exception '%', v_b.codigo || ': local ' || v_estoque || ', ML ' || v_b.ml using errcode = 'KX006';
      end if;
      insert into public.kit_marca_ml (org_id, codigo, ordem)
      select p_org, v_b.codigo, coalesce(max(m.ordem), 0) from public.estoque_movimentos m
      where m.org_id = p_org and m.codigo = v_b.codigo;
    end loop;

    -- Task 14: "Vender só em kit" já na criação. Normal → Guardado antes da transferência: a soma de versões dela
    -- inclui a mudança, e a montagem pausa os individuais e os deixa pausados (pausa da automação).
    if coalesce((p_kit->>'so_em_kit')::boolean, false) then
      perform public.kit_reposicao_reivindicar(p_org, v_kit);
    end if;

    v_t := public.kit_criar_transferencia(p_org, v_kit, 'montar',
      (select jsonb_agg(jsonb_build_object('codigo', s->>'codigo', 'quantidade', (s->>'quantidade')::integer))
       from jsonb_array_elements(p_skus) s),
      p_alvos || (select jsonb_agg(jsonb_build_object('codigo', s->>'codigo', 'criar', true))
                  from jsonb_array_elements(p_skus) s));
    if not coalesce((v_t->>'ok')::boolean, false) then
      raise exception '%', coalesce(v_t->>'motivo', 'transferencia') || coalesce(':' || (v_t->>'codigo'), '')
        using errcode = 'KX008';
    end if;
  exception
    when sqlstate 'KX006' then
      return jsonb_build_object('ok', false, 'motivo', 'baseline_divergente', 'codigo', sqlerrm);
    when sqlstate 'KX007' then
      return jsonb_build_object('ok', false, 'motivo', 'sku_nao_encontrado', 'codigo', sqlerrm);
    when sqlstate 'KX008' then
      return jsonb_build_object('ok', false, 'motivo', split_part(sqlerrm, ':', 1), 'codigo', nullif(split_part(sqlerrm, ':', 2), ''));
  end;

  return jsonb_build_object('ok', true, 'kit_id', v_kit, 'transferencia_id', v_t->>'id');
end $$;

revoke all on function public.kit_variacao_criar(uuid, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.kit_variacao_criar(uuid, uuid, jsonb, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.kit_saga_finalizar(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.kit_saga_finalizar(uuid, uuid, uuid, text, text, jsonb) to service_role;
revoke all on function public.kit_reposicao_saldo(uuid, text) from public, anon, authenticated;
revoke all on function public.kit_reposicao_pendente(uuid, text) from public, anon, authenticated;
revoke all on function public.kit_reposicao_foto(uuid, uuid) from public, anon, authenticated;
revoke all on function public.kit_reposicao_conferir(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.kit_reposicao_sobra(uuid, text[], jsonb) from public, anon, authenticated;
revoke all on function public.kit_reposicao_guardar(uuid, text[], text[], jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.kit_reposicao_repor(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.kit_reposicao_reivindicar(uuid, uuid) from public, anon, authenticated;
revoke all on function public.kit_reposicao_ligar(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.kit_reposicao_desligar(uuid, uuid) from public, anon, authenticated;
grant execute on function public.kit_reposicao_saldo(uuid, text) to service_role;
grant execute on function public.kit_reposicao_pendente(uuid, text) to service_role;
grant execute on function public.kit_reposicao_foto(uuid, uuid) to service_role;
grant execute on function public.kit_reposicao_conferir(uuid, jsonb) to service_role;
grant execute on function public.kit_reposicao_sobra(uuid, text[], jsonb) to service_role;
grant execute on function public.kit_reposicao_guardar(uuid, text[], text[], jsonb, jsonb) to service_role;
grant execute on function public.kit_reposicao_repor(uuid, uuid, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.kit_reposicao_reivindicar(uuid, uuid) to service_role;
grant execute on function public.kit_reposicao_ligar(uuid, uuid, jsonb) to service_role;
grant execute on function public.kit_reposicao_desligar(uuid, uuid) to service_role;
