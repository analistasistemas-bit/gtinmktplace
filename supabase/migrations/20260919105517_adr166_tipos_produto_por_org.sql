-- ADR-0166: tipo de produto (roupa / calcado) por organizacao.
--
-- NUMERO: o plano desta entrega dizia ADR-0165, mas a main ja publicou 0165 (faixas regressivas
-- por organizacao) enquanto esta branch estava aberta. Quem ja esta na main nao renumera — daqui
-- em diante esta entrega e ADR-0166.
--
-- Coluna SEPARADA de modulos_habilitados de proposito. Modulo e acesso pago a uma tela inteira
-- (Estoque/Pulse/Fiscal, ADR-0047) e entra na regua de cobranca do ADR-0155. Tipo de produto nao
-- e cobrado: ele muda a ESTRUTURA do cadastro (o SKU passa a ser cor x tamanho). Misturar os dois
-- faria o super-admin ligar um "modulo" que nao gera fatura.
--
-- INVARIANTE: lista vazia e o estado de TODA org existente hoje e significa "nada muda". Nao ha
-- default diferente de '{}' e nao ha backfill. Toda leitura no codigo e condicional.
--
-- Valores validos: 'roupa', 'calcado' (combinaveis — quem vende roupa costuma vender sapato).
-- A trava de valor fica na edge `usuarios` (whitelist, como em set_modulos_org) e nao em CHECK
-- constraint: modulos_habilitados/canais_habilitados seguem o mesmo padrao, e um CHECK sobre
-- array obrigaria migration a cada valor novo.

alter table public.organizations
  add column if not exists tipos_produto_habilitados text[] not null default '{}';

comment on column public.organizations.tipos_produto_habilitados is
  'ADR-0166: tipos de produto habilitados (roupa/calcado), combinaveis. Vazio = comportamento padrao (so cor como eixo de variacao).';

-- Leitura pelo frontend. Copia EXATA da forma de modulos_habilitados_da_org
-- (20260729124711_e6b_origem_lote_e_modulos.sql): security definer + stable + search_path vazio,
-- ancorada em current_org_id() (ADR-0027), com revoke/grant explicitos.
create or replace function public.tipos_produto_da_org()
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(tipos_produto_habilitados, '{}')
  from public.organizations
  where id = public.current_org_id()
$$;

revoke all on function public.tipos_produto_da_org() from public;
grant execute on function public.tipos_produto_da_org() to authenticated;
