-- ADR-0201 (Galeria da cor por IA), Task 8: pedido de geração e despachante.
--
-- 1. galeria_reservar_pedido: corpo idêntico ao de 20261109093335, exceto o insert — recorte nasce `gerada`, sem
--    cena e com alertas [] (vem da foto real; nunca vai ao worker nem à visão). `create or replace` mantém os grants.
--    Revisão geral (11/11, editada no lugar: nada da galeria aplicado em produção): `falhou` com erro
--    `imagem_invalida` (reportada pelo cliente) ocupa vaga no teto e na numeração. Espelho TS: pedido.ts.
-- 2. Consultas do despachante (service_role): galeria_trabalho_pendente, galeria_visao_pendente,
--    galeria_trabalho_pendente_aplicacao e galeria_escritas_adiadas_pendentes; galeria_manter_aplicacao executa as
--    ações de nível da aplicação (abortar por prazo, compensar aplicados, agregar) sob lock.
--
-- Sem begin/commit: o db push já envolve a migration numa transação.

-- ───────────────────────── 1. Recorte nasce gerado ─────────────────────────

create or replace function public.galeria_reservar_pedido(p_pedido jsonb)
returns setof public.galeria_imagens language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_org uuid;
  v_anuncio uuid;
  v_familia uuid;
  v_roteiro uuid;
  v_item jsonb;
  v_cor text;
  v_missao smallint;
  v_origem text;
  v_geracao smallint;
  v_linha public.galeria_imagens%rowtype;
begin
  begin
    v_id := (p_pedido->>'id')::uuid;
    v_org := (p_pedido->>'org_id')::uuid;
    v_anuncio := (p_pedido->>'anuncio_externo_id')::uuid;
    v_familia := (p_pedido->>'familia_id')::uuid;
    v_roteiro := (p_pedido->>'roteiro_id')::uuid;
  exception when others then
    raise exception 'pedido inválido' using errcode = '22023';
  end;
  if v_id is null or v_org is null or v_anuncio is null or v_familia is null or v_roteiro is null
    or jsonb_typeof(p_pedido->'itens') is distinct from 'array' or jsonb_array_length(p_pedido->'itens') = 0
    or jsonb_typeof(p_pedido->'elegivel') is distinct from 'boolean'
    or jsonb_typeof(p_pedido->'unit_cents') is distinct from 'number' then
    raise exception 'pedido inválido' using errcode = '22023';
  end if;
  -- Serializa pedidos do mesmo anúncio (vaga e teto sem corrida).
  perform pg_advisory_xact_lock(hashtextextended('galeria_pedido:' || v_anuncio::text, 0));

  if exists (select 1 from public.galeria_pedidos p where p.id = v_id) then
    if not exists (select 1 from public.galeria_pedidos p where p.id = v_id and p.org_id = v_org
                    and p.anuncio_externo_id = v_anuncio) then
      raise exception 'pedido de outro anúncio' using errcode = '42501';
    end if;
    return query select * from public.galeria_imagens g where g.pedido_id = v_id order by g.cor, g.missao, g.geracao;
    return;
  end if;

  if not exists (select 1 from public.galeria_roteiros r where r.id = v_roteiro and r.org_id = v_org
                  and r.anuncio_externo_id = v_anuncio) then
    raise exception 'roteiro de outro anúncio' using errcode = '42501';
  end if;

  insert into public.galeria_pedidos (id, org_id, anuncio_externo_id, familia_id, roteiro_id, itens, unit_cents,
    terms_id, elegivel, criado_por)
  values (v_id, v_org, v_anuncio, v_familia, v_roteiro, p_pedido->'itens', (p_pedido->>'unit_cents')::bigint,
    (p_pedido->>'terms_id')::uuid, (p_pedido->>'elegivel')::boolean, (p_pedido->>'criado_por')::uuid);

  for v_item in select value from jsonb_array_elements(p_pedido->'itens') loop
    v_cor := v_item->>'cor';
    v_missao := (v_item->>'missao')::smallint;
    v_origem := coalesce(v_item->>'origem', 'gerador');
    if v_cor is null or v_missao is null then
      raise exception 'pedido inválido' using errcode = '22023';
    end if;
    if exists (select 1 from public.galeria_imagens g where g.org_id = v_org and g.anuncio_externo_id = v_anuncio
                and g.cor = v_cor and g.missao = v_missao and g.status in ('pendente', 'submetendo', 'gerando')) then
      raise exception 'em_andamento' using errcode = 'P0001';
    end if;
    -- Ocupa vaga: tudo fora de `falhou` + a reportada inválida pelo cliente (`falhou` com erro `imagem_invalida`,
    -- revisão geral): foi paga ao provedor e não pode reabrir geração sem limite. Falha técnica não ocupa.
    if v_origem = 'gerador' and (select count(*) from public.galeria_imagens g
        where g.org_id = v_org and g.roteiro_id = v_roteiro and g.cor = v_cor and g.missao = v_missao
          and g.origem = 'gerador' and (g.status <> 'falhou' or g.erro = 'imagem_invalida')) >= 3 then
      raise exception 'teto' using errcode = 'P0001';
    end if;
    select coalesce(max(g.geracao), 0) + 1 into v_geracao from public.galeria_imagens g
     where g.org_id = v_org and g.roteiro_id = v_roteiro and g.cor = v_cor and g.missao = v_missao
       and (g.status <> 'falhou' or g.erro = 'imagem_invalida');
    -- Recorte (missão 7, lupas, Moda 5) vem da foto real: nasce gerada, sem cena e com alertas [] (não passa pela
    -- visão nem pelo worker).
    insert into public.galeria_imagens (org_id, anuncio_externo_id, familia_id, pedido_id, roteiro_id, cor, missao,
      geracao, request_id, origem, referencia_id, modelo, provedor, status, alertas)
    values (v_org, v_anuncio, v_familia, v_id, v_roteiro, v_cor, v_missao, v_geracao,
      extensions.uuid_generate_v5(v_id, v_cor || ':' || v_missao || ':' || v_geracao), v_origem,
      (v_item->>'referencia_id')::uuid, v_item->>'modelo', v_item->>'provedor',
      case when v_origem = 'recorte' then 'gerada' else 'pendente' end,
      case when v_origem = 'recorte' then '[]'::jsonb end)
    returning * into v_linha;
    return next v_linha;
  end loop;
end;
$$;

-- ───────────────────────── 2. Consultas do despachante (galeria-despachante, 1 min) ─────────────────────────
-- Só linhas acionáveis, cabeça por prazo, sem cursor; cada consulta com a sua cota (a visão nunca disputa as vagas da
-- geração, a aplicação nunca disputa com as imagens). Linha com anúncio nulo é só histórico (nunca é selecionada).
-- Espelho TS: imagemAcionavel / visaoAcionavel / itemAcionavel / acaoDaAplicacao (_shared/galeria/despacho.ts).

-- Geração não terminal sem lease vigente (queda entre gravar estado e publicar, ou logo após o claim).
create function public.galeria_trabalho_pendente(p_limite integer)
returns setof public.galeria_imagens language sql stable security definer set search_path = '' as $$
  select g.* from public.galeria_imagens g
   where g.origem = 'gerador' and g.status in ('pendente', 'submetendo', 'gerando')
     and (g.lease_ate is null or g.lease_ate < now()) and g.anuncio_externo_id is not null
   order by g.prazo_ate nulls last, g.criado_em
   limit p_limite
$$;

-- Cena gravada e ainda sem alertas ("verificando"), em qualquer status.
create function public.galeria_visao_pendente(p_limite integer)
returns setof public.galeria_imagens language sql stable security definer set search_path = '' as $$
  select g.* from public.galeria_imagens g
   where g.origem = 'gerador' and g.cena_path is not null and g.alertas is null
     and (g.lease_ate is null or g.lease_ate < now()) and g.anuncio_externo_id is not null
   order by g.criado_em
   limit p_limite
$$;

-- Itens (tipo 'item') e ações de nível da aplicação (tipo 'aplicacao': prazo vencido, aplicados a compensar, todos
-- terminais = rede de segurança da agregação). Só aplicação em execução dentro do ciclo — nunca `preparada`. Item só
-- sem mensagem em voo: publicado_em nulo ou de 3 min atrás (o worker zera ao concluir cada fase). user_id = dono da
-- fila publish-ml-* (o mesmo de publicar-familias).
-- Ações de aplicação vêm antes dos itens: são no máximo uma por aplicação e são elas que abortam, compensam e
-- soltam a trava; itens vencidos de muitas sagas nunca podem ocupar a cota inteira e travar o encerramento.
create function public.galeria_trabalho_pendente_aplicacao(p_limite integer)
returns table (tipo text, id uuid, aplicacao_id uuid, aplicacao_status text, prazo_ate timestamptz, ciclo_ate timestamptz,
  user_id uuid, item_status text, fase integer, despacho_seq integer, lease_ate timestamptz, publicado_em timestamptz,
  fotos_novas jsonb, itens_abertos integer, itens_aplicados integer)
language sql stable security definer set search_path = '' as $$
  with apl as (
    select a.id, a.status, a.prazo_ate, a.ciclo_ate, f.user_id,
      (select count(*) from public.galeria_aplicacao_itens i where i.aplicacao_id = a.id
        and not i.status = any(case when a.status = 'em_andamento'
          then array['aplicado', 'falhou', 'pulado', 'reversao_incompleta']
          else array['compensado', 'falhou', 'pulado', 'reversao_incompleta'] end))::integer as abertos,
      (select count(*) from public.galeria_aplicacao_itens i where i.aplicacao_id = a.id and i.status = 'aplicado')::integer as aplicados
      from public.galeria_aplicacoes a left join public.familias f on f.id = a.familia_id
     where a.status in ('em_andamento', 'abortando', 'revertendo') and a.ciclo_ate > now() and a.anuncio_externo_id is not null
  )
  select x.* from (
    select 'item'::text, i.id, a.id, a.status, a.prazo_ate, a.ciclo_ate, a.user_id, i.status, i.fase, i.despacho_seq,
           i.lease_ate, i.publicado_em, i.fotos_novas, null::integer, null::integer
      from apl a join public.galeria_aplicacao_itens i on i.aplicacao_id = a.id
     where i.status in ('pendente', 'subindo', 'aplicando', 'compensando')
       and (i.lease_ate is null or i.lease_ate < now())
       and (i.publicado_em is null or i.publicado_em <= now() - interval '3 minutes')
    union all
    select 'aplicacao'::text, a.id, a.id, a.status, a.prazo_ate, a.ciclo_ate, a.user_id, null::text, 0, 0,
           null::timestamptz, null::timestamptz, null::jsonb, a.abertos, a.aplicados
      from apl a
     where (a.status = 'em_andamento' and a.prazo_ate < now())
        or (a.status <> 'em_andamento' and a.aplicados > 0)
        or a.abertos = 0
  ) x (tipo, id, aplicacao_id, aplicacao_status, prazo_ate, ciclo_ate, user_id, item_status, fase, despacho_seq,
       lease_ate, publicado_em, fotos_novas, itens_abertos, itens_aplicados)
  order by (x.tipo = 'aplicacao') desc, x.prazo_ate nulls last
  limit p_limite
$$;

-- Ações de nível da aplicação, sob o lock dela (mesma ordem da saga: anúncio → aplicação → itens → travas):
-- prazo vencido (em_andamento) → abortando + abortar_em, itens pendente|subindo livres → pulado (sem PUT);
-- abortando/revertendo → itens aplicado → compensando (compensar_ate = now() + 60 min, nunca renovado);
-- depois a agregação (todos terminais → estado terminal + travas soltas com a quarentena do último PUT).
-- Fora do ciclo não mexe: o relógio no banco encerra.
create function public.galeria_manter_aplicacao(p_aplicacao uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_apl public.galeria_aplicacoes%rowtype;
  v_anuncio uuid;
begin
  select a.anuncio_externo_id into v_anuncio from public.galeria_aplicacoes a where a.id = p_aplicacao;
  if not found then
    raise exception 'aplicacao_inexistente' using errcode = 'P0002';
  end if;
  perform 1 from public.anuncios_externos x where x.id = v_anuncio for key share;
  select * into v_apl from public.galeria_aplicacoes a where a.id = p_aplicacao for update;
  if v_apl.status not in ('em_andamento', 'abortando', 'revertendo') or v_apl.ciclo_ate is null or v_apl.ciclo_ate <= now() then
    return v_apl.status;
  end if;
  if v_apl.status = 'em_andamento' and v_apl.prazo_ate < now() then
    update public.galeria_aplicacoes a set status = 'abortando', abortar_em = coalesce(a.abortar_em, now()), atualizado_em = now()
     where a.id = p_aplicacao;
    update public.galeria_aplicacao_itens i set status = 'pulado', erro = coalesce(i.erro, 'prazo_vencido'),
      posse = null, lease_ate = null, publicado_em = null, atualizado_em = now()
     where i.aplicacao_id = p_aplicacao and i.status in ('pendente', 'subindo')
       and (i.lease_ate is null or i.lease_ate < now());
    v_apl.status := 'abortando';
  end if;
  if v_apl.status in ('abortando', 'revertendo') then
    update public.galeria_aplicacao_itens i set status = 'compensando', compensar_ate = now() + interval '60 minutes',
      publicado_em = null, atualizado_em = now()
     where i.aplicacao_id = p_aplicacao and i.status = 'aplicado';
  end if;
  return public.galeria_agregar_aplicacao(p_aplicacao);
end;
$$;

-- Escritas adiadas dos escritores comuns vencidas e não assumidas (o despachante faz o mesmo que a mensagem de acordar).
create function public.galeria_escritas_adiadas_pendentes(p_limite integer)
returns setof public.ml_escritas_adiadas language sql stable security definer set search_path = '' as $$
  select e.* from public.ml_escritas_adiadas e
   where e.proxima_em <= now() and (e.assumida_ate is null or e.assumida_ate < now())
   order by e.proxima_em
   limit p_limite
$$;

revoke all on function public.galeria_trabalho_pendente(integer) from public, anon, authenticated;
revoke all on function public.galeria_visao_pendente(integer) from public, anon, authenticated;
revoke all on function public.galeria_trabalho_pendente_aplicacao(integer) from public, anon, authenticated;
revoke all on function public.galeria_manter_aplicacao(uuid) from public, anon, authenticated;
revoke all on function public.galeria_escritas_adiadas_pendentes(integer) from public, anon, authenticated;
grant execute on function public.galeria_trabalho_pendente(integer) to service_role;
grant execute on function public.galeria_visao_pendente(integer) to service_role;
grant execute on function public.galeria_trabalho_pendente_aplicacao(integer) to service_role;
grant execute on function public.galeria_manter_aplicacao(uuid) to service_role;
grant execute on function public.galeria_escritas_adiadas_pendentes(integer) to service_role;
