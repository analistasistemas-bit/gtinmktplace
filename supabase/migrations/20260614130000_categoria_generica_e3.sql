-- E3 (ADR-0026): categoria genérica via preditor nativo do ML + schema dinâmico de atributos.
-- Aditiva. 'preditor' = categoria resolvida pelo domain_discovery (entre 'regex' e 'ia'/'manual').
ALTER TYPE tipo_origem ADD VALUE IF NOT EXISTS 'preditor';

-- categoria_nome: nome humano da categoria (rótulo do override OU category_name do preditor),
-- p/ a Revisão mostrar algo legível em vez do código MLB.
ALTER TABLE familias ADD COLUMN IF NOT EXISTS categoria_nome text;

-- atributos_faltantes: nomes dos atributos required ainda não preenchidos (snapshot do
-- processamento); o E4 preenche os valores por IA.
ALTER TABLE familias ADD COLUMN IF NOT EXISTS atributos_faltantes jsonb;
