-- ADR-0156 — corrige o "Kit / N unidades" falso nas famílias já publicadas.
--
-- A regex `RE_UNIDADES` lia "TAM 8 CORES" / "ANNE 65 CORES" como contagem de kit, gerava
-- UNITS_PER_PACK = 8/65 e o ADR-0071 forçava SALE_FORMAT = Kit. O código já foi corrigido e
-- deployado, mas `familias.atributos_ml` guarda o valor errado e o re-ingest de UPDATE o COPIA
-- (`ingest-lote/index.ts:238`, ADR-0016) — então o erro se propaga por cópia a cada republicação
-- e nunca se recalcula sozinho. Esta migration corrige a fonte.
--
-- Alcance medido antes de escrever: 9 linhas, nos 4 códigos abaixo. Nenhuma tem
-- `atributos_editados_pelo_operador = true`, então nenhuma edição manual é sobrescrita.
-- "Unidade" é o value_id 1359391 em MLB271701 e MLB270273 (as duas categorias envolvidas).
--
-- Idempotente de propósito: o conteúdo foi aplicado via Management API em 2026-09-07 porque
-- `supabase db push` estava travado por migrations remotas de outra branch. Rodar de novo é no-op,
-- e as travas conferem o ESTADO FINAL, não quantas linhas mudaram.
--
-- Tudo num único DO: `supabase db push` não abre transação por arquivo, e um bloco DO é uma
-- instrução só — se uma trava LOUD disparar, os UPDATEs revertem juntos.

do $$
declare
  restantes int;
  item_errado int;
begin
  -- 1) UNITS_PER_PACK -> 1 e SALE_FORMAT -> Unidade, preservando os demais atributos.
  with alvo as (
    select f.id
    from familias f
    where f.codigo_pai in ('02994968', '02994828', '02994771', '02829916')
      and jsonb_typeof(f.atributos_ml) = 'array'
      and exists (
        select 1 from jsonb_array_elements(f.atributos_ml) a
        where (a->>'id' = 'UNITS_PER_PACK' and a->>'value_name' <> '1')
           or (a->>'id' = 'SALE_FORMAT' and a->>'value_id' = '1359392')
      )
  )
  update familias f
  set atributos_ml = (
        select coalesce(jsonb_agg(a), '[]'::jsonb)
        from jsonb_array_elements(f.atributos_ml) a
        where a->>'id' not in ('UNITS_PER_PACK', 'SALE_FORMAT')
      ) || '[{"id":"UNITS_PER_PACK","value_name":"1"},{"id":"SALE_FORMAT","value_id":"1359391"}]'::jsonb
  from alvo
  where f.id = alvo.id;

  -- 2) A linha de UPDATE pendente do 02994968 aponta para o anúncio substituído quando o lote #39
  --    republicou a família em 2026-09-07 10:37. Sem isto o PUT iria no item antigo.
  update familias
  set ml_item_id = 'MLB5197880975'
  where codigo_pai = '02994968'
    and status = 'pronto'
    and operacao = 'UPDATE'
    and ml_item_id = 'MLB7245338658';

  -- Travas LOUD sobre o estado final.
  select count(*) into restantes
  from familias f, lateral jsonb_array_elements(f.atributos_ml) a
  where f.codigo_pai in ('02994968', '02994828', '02994771', '02829916')
    and jsonb_typeof(f.atributos_ml) = 'array'
    and ((a->>'id' = 'UNITS_PER_PACK' and a->>'value_name' <> '1')
      or (a->>'id' = 'SALE_FORMAT' and a->>'value_id' = '1359392'));
  if restantes > 0 then
    raise exception 'ADR-0156: % atributo(s) ainda marcam Kit/contagem>1 nos 4 códigos', restantes;
  end if;

  select count(*) into item_errado
  from familias
  where codigo_pai = '02994968' and ml_item_id = 'MLB7245338658';
  if item_errado > 0 then
    raise exception 'ADR-0156: ainda há família do 02994968 apontando para o item substituído';
  end if;
end $$;
