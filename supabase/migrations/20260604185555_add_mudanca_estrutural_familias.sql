ALTER TABLE public.familias
  ADD COLUMN IF NOT EXISTS mudanca_estrutural jsonb;

COMMENT ON COLUMN public.familias.mudanca_estrutural IS
  'UPDATE: { novas: string[], removidas: {codigo,cor}[] } — cores detectadas mas nao aplicadas no ML.';;
