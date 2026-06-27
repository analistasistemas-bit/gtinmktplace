ALTER TABLE public.variacoes
  ADD COLUMN IF NOT EXISTS excluida_da_publicacao boolean NOT NULL DEFAULT false;;
