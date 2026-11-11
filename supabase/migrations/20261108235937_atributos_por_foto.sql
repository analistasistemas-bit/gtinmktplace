-- ADR-0202: atributos visuais preenchidos pela foto (IA), exibidos na Revisão para conferência.
-- Formato: [{ "id": "SLEEVE_TYPE", "nome": "Tipo de manga", "valores": [{ "id": "...", "nome": "..." }] }]
alter table public.familias add column if not exists atributos_por_foto jsonb;
