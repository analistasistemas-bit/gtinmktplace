-- ADR-0022: novo tipo de aviamento "cola" (Bastões de Cola, categoria ML MLB277319).
-- Aditiva: estende o enum tipo_aviamento sem tocar nas linhas existentes.
ALTER TYPE tipo_aviamento ADD VALUE IF NOT EXISTS 'cola';
