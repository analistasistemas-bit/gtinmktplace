ALTER TABLE public.variacoes
  ADD COLUMN IF NOT EXISTS estoque_anterior integer;

COMMENT ON COLUMN public.variacoes.estoque_anterior IS
  'Snapshot do estoque publicado por ultimo (UPDATE). Usado no diff da Revisao. Null em CREATE ou cor nova.';;
