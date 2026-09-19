-- ADR-0166: genero da familia e tamanho/numeracao da variacao.
--
-- Guardamos o VALOR DO OPERADOR ('masculino', 'P', '42'), nunca o value_id do ML. O id do ML e
-- detalhe do canal, muda por categoria e e resolvido na publicacao — mesmo padrao ja usado para
-- cor (ADR-0004: o dicionario do ML reescreve value_name ao publicar e o banco nao sabe disso).
--
-- AS DUAS COLUNAS SAO NULLABLE E NASCEM NULL EM TODA LINHA EXISTENTE. Nao ha backfill e nao ha
-- default: null e o estado de quem nao tem tipo de produto habilitado (INV-1). Familia vinda de
-- planilha (ingest-lote) continua nascendo com as duas nulas — e isso e deliberado, ver o
-- comentario de feature futura no topo de supabase/functions/ingest-lote/index.ts.
--
-- Por que CHECK em genero e nao em tamanho:
--   genero tem 3 valores fechados e o ML exige que o genero do anuncio bata com o da tabela de
--   medidas — valor errado ali derruba a publicacao inteira, entao a trava fica no banco.
--   tamanho e lista de PICK do operador (P/M/G/GG/Tamanho Unico para roupa, numeracao para
--   calcado) e a lista de numeracao ainda sera calibrada contra a categoria real do ML
--   (spike 051). Um CHECK aqui obrigaria migration a cada ajuste de lista; a trava vive na UI
--   (multi-select sobre lista fixa) e na validacao da edge.

-- CHECK NOMEADO de proposito (`familias_genero_valido`): a prova do Step 4 e read-only e
-- localiza o constraint por nome em pg_constraint. Constraint anonimo obrigaria a adivinhar o
-- nome gerado pelo Postgres, ou a escrever numa tabela de producao so para "provar" a trava.
alter table public.familias
  add column if not exists genero text
  constraint familias_genero_valido
  check (genero is null or genero in ('masculino', 'feminino', 'unissex'));

comment on column public.familias.genero is
  'ADR-0166: genero da peca (masculino/feminino/unissex). NULL = nao informado (org sem tipo de produto habilitado). O ML exige que o genero do anuncio bata com o da tabela de medidas.';

alter table public.variacoes
  add column if not exists tamanho text;

comment on column public.variacoes.tamanho is
  'ADR-0166: tamanho (roupa: P/M/G/GG/Tamanho Unico) ou numeracao (calcado). NULL = variacao sem eixo de tamanho, o caso de toda org sem tipo de produto habilitado. Nunca guarda value_id do ML.';
