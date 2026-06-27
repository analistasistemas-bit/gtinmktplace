ALTER TABLE familias ADD COLUMN IF NOT EXISTS categoria_nome text;
ALTER TABLE familias ADD COLUMN IF NOT EXISTS atributos_faltantes jsonb;;
