-- Achado M1 do code-review-v6: índice redundante criado junto com a tabela (ADR-0109).
--
-- `venda_item_custo_uniq (venda_id, ml_item_id, variation_id)` já tem `venda_id` como PRIMEIRA
-- coluna, e um índice composto atende buscas pelo prefixo — inclusive o embed do frontend, que
-- filtra por venda. O índice avulso só custava escrita e espaço a cada insert.

drop index if exists public.venda_item_custo_venda_idx;
