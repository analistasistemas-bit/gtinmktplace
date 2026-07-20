-- ADR-0083: novo tipo de aviamento "cursor" (deslizador de zíper, categoria ML MLB271227 "Zíperes").
-- Aditiva: estende o enum tipo_aviamento sem tocar nas linhas existentes.
ALTER TYPE tipo_aviamento ADD VALUE IF NOT EXISTS 'cursor';
