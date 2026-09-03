-- ADR-0151: Kit vinculado — família derivada de um produto existente, publicada como
-- SALE_FORMAT=Kit, com estoque 100% calculado a partir da família-base.
--
-- A chave de referência é (org_id, kit_base_codigo_pai), NUNCA familias.id: a base ganha
-- linhas novas de `familias` a cada lote de UPDATE, e só `codigo_pai` é estável.
-- `kit_multiplicador is not null` é o predicado "esta família é um kit vinculado".

alter table public.familias
  add column kit_base_codigo_pai text,
  add column kit_multiplicador smallint;

alter table public.familias
  add constraint familias_kit_multiplicador_faixa
    check (kit_multiplicador is null or kit_multiplicador between 2 and 6);

-- As duas colunas andam juntas: uma sem a outra é estado impossível (kit sem base, ou
-- base sem multiplicador) que o resolvedor de estoque interpretaria errado em silêncio.
alter table public.familias
  add constraint familias_kit_par_completo
    check (num_nulls(kit_base_codigo_pai, kit_multiplicador) in (0, 2));

-- Fan-out do push e as guards varrem "kits vivos desta base" a cada evento de estoque.
create index familias_kit_base_idx
  on public.familias (org_id, kit_base_codigo_pai)
  where kit_multiplicador is not null;

-- Auditoria de origem no ledger (ADR-0151 Decisão 6). NÃO é um motivo novo: um motivo
-- novo quebraria `estornar_estoque`, que só repõe `where motivo = 'venda'`. São colunas
-- nuláveis, preenchidas depois da RPC pelo chamador.
alter table public.estoque_movimentos
  add column origem_kit_codigo_pai text,
  add column origem_kit_multiplicador smallint;

-- NÃO existe coluna de "anúncio de origem" aqui, de propósito. A Decisão 7 foi revisada
-- (simplificação escolhida pelo Diego): com kit vinculado, o push simplesmente NÃO aplica
-- exclusão nenhuma — reempurra base + todos os tamanhos, sempre. Push é ABSOLUTO e o valor
-- é recalculado do zero, então o resultado é idêntico ao de uma exclusão fina; a diferença
-- é 1-2 chamadas de API a mais por evento, contra o custo de uma coluna no ledger e de
-- plumbing por todo o outbox. Não reintroduza a coluna "por eficiência".
