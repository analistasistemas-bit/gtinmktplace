-- Foto-capa opcional por família
-- Aparece como pictures[0] no payload ML em M4. Path no storage:
--   imagens/{user_id}/capas/{codigoPai}.jpeg

ALTER TABLE public.familias
  ADD COLUMN IF NOT EXISTS capa_storage_path text;
