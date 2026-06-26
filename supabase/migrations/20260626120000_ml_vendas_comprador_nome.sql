-- Adiciona nome real do comprador (ADR-0037 complemento).
-- O ML retorna first_name + last_name em /orders; antes só armazenávamos o nickname.
alter table ml_vendas add column if not exists comprador_nome text;
