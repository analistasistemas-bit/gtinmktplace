# ADR-0053 — Marca manual de saque em `ml_vendas`

**Data:** 2026-07-02
**Status:** Aceito — implementado e em produção (migration `20260702162832_ml_vendas_saque.sql`, front na branch `feature/saque-financeiro` mesclada em `main`, deploy Render `dep-d9394pbtqb8s738rs2ag`).
**Contexto relacionado:** ADR-0040 (Financeiro impecável), ADR-0038 (fonte única `ml_vendas`), spec `2026-07-02-saque-financeiro-design.md`, plano `2026-07-02-saque-financeiro.md`.

## Contexto

A coluna `Liberação` do `Financeiro > Detalhe do líquido` derivava dois estados de
`money_release_date`: `a liberar` (ML ainda não liberou) e `liberado` (ML liberou para saque).
Faltava um terceiro estado **operacional** — `sacado` — que não vem do Mercado Livre: é marcado
manualmente pelo operador quando o dinheiro já foi efetivamente sacado.

## Decisão

1. **Marcar direto na venda** (`ml_vendas`), sem entidade `saques` nem trilha de eventos. Dois
   campos: `sacado_em timestamptz`, `sacado_por uuid → profiles`. YAGNI: não há requisito de
   histórico de saques nem de valor sacado parcial.
2. **Status derivado** por helper puro compartilhado (`status-liberacao.ts`, testado): `sacado`
   se `sacado_em` não nulo; senão `liberado`/`a liberar` conforme `money_release_date`; senão `—`.
   Tela, filtros e export usam a mesma regra (paridade com o ADR-0038).
3. **Escrita só via RPC `security definer`** — `ml_vendas` é read-only para o app via RLS. Duas
   funções estreitas tocam só esses dois campos e exigem `is_membro_operacao()`:
   - `registrar_saque_ml_vendas(uuid[])`: grava `sacado_em/sacado_por` só onde
     `money_release_date <= now()` e `sacado_em is null` (elegibilidade também no `UPDATE`, não só
     na UI, para evitar corrida entre seleção e ação).
   - `desfazer_saque_ml_vendas(uuid[])`: limpa os campos só onde `sacado_em is not null`.
   O retorno (`row_count`) alimenta o feedback `N marcados; M ignorados`.

## Consequências

- Seleção por checkbox na tabela; ações `Registrar saque` / `Desfazer saque`; filtro `Sacados`.
- Pack: os membros herdam o status do grupo (sacado só quando todos os membros estão sacados),
  evitando saque parcial escondido.
- Sem novas dependências e sem tabela nova. Reversível (desfazer saque volta ao estado anterior).
