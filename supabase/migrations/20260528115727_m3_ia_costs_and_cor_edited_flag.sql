-- M3 — captura de custo de IA + flag cor_editada_pelo_operador
-- (as flags titulo/descricao/preco_editado_pelo_operador já existem desde o M2)

ALTER TABLE public.familias
  ADD COLUMN IF NOT EXISTS tokens_input integer,
  ADD COLUMN IF NOT EXISTS tokens_output integer,
  ADD COLUMN IF NOT EXISTS custo_centavos integer;

ALTER TABLE public.variacoes
  ADD COLUMN IF NOT EXISTS cor_editada_pelo_operador boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS familias_lote_status_idx ON public.familias(lote_id, status);
