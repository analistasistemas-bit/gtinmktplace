-- ADR-0013: contadores de anomalias da planilha descartadas no ingest (não-bloqueantes).
-- jsonb único: { codigos_duplicados: [], filhos_orfaos: [], familias_sem_filho: [] }
ALTER TABLE public.lotes
  ADD COLUMN IF NOT EXISTS anomalias_planilha jsonb NOT NULL DEFAULT '{}'::jsonb;;
