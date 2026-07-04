-- Origem 'generico' (ADR-0058): categoria genérica ("Outros") aplicada como fallback
-- visível quando o preditor do ML só encontra candidatos genéricos, em vez de bloquear
-- a família em 'manual'.
ALTER TYPE tipo_origem ADD VALUE IF NOT EXISTS 'generico';
