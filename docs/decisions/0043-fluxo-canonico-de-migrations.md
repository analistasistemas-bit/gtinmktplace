# ADR-0043: Canal único para mudanças de schema (migrations)

**Status:** Aceito
**Data:** 2026-06-26
**Decisores:** Diego

## Contexto

Em 2026-06-26 o histórico de migrations estava divergente: `supabase migration list --linked`
mostrava 28 arquivos locais e 39 registros remotos, nenhum alinhado. **Não havia drift de
schema** — produção estava correta. A divergência era puramente de *registro*.

Causa raiz: schema entrava por **dois canais incompatíveis**.

1. Arquivos de migration escritos à mão localmente, com timestamps "redondos" (`...120000`,
   `...130000`) inventados manualmente.
2. DDL aplicado direto em produção via MCP `apply_migration` ou pelo painel do Supabase — que
   registra no histórico (`supabase_migrations.schema_migrations`) com **timestamp e nome
   próprios**, precisos.

Como os timestamps nunca coincidiam, `migration list` cruzava as duas listas e mostrava tudo
desencontrado. Pior: parte das colunas (ex. `familias.atacado*`, `ml_vendas.estorno`) foi
criada "fora de migration", sem registro nenhum no histórico.

## Decisão

**Toda mudança de schema nasce de `supabase migration new <nome>` e é aplicada com
`supabase db push`.** O mesmo arquivo gera o mesmo registro local e remoto (mesmo timestamp e
nome) → histórico sempre alinhado.

**Proibido para DDL:** MCP `apply_migration`, SQL via painel, ou criar arquivo de migration com
timestamp escrito à mão. O MCP `execute_sql` continua liberado **apenas para leitura/inspeção**.

Verificação: `npm run db:check` (script `scripts/db-check.sh`) roda `migration list --linked` e
falha se houver divergência. Rodar após mudança de schema e antes de considerar trabalho pronto.

## Alternativas consideradas

- **Manter status quo (dois canais + reconciliar quando doer):** rejeitado — a reconciliação
  custou uma sessão inteira e o problema reincide a cada DDL aplicado por fora.
- **Hook de pre-push que bloqueia push divergente:** rejeitado por ora — exige token/rede a cada
  push, atrito alto para dev solo. O check manual via `npm run db:check` cobre o caso sem fricção.

## Consequências

- **Boas:** histórico local = remoto sempre; `db push` futuro funciona sem reaplicar; cada coluna
  tem migration rastreável com o "porquê" (cultura documentation-first).
- **Tradeoffs:** aplicar schema fica um passo mais lento que um `apply_migration` rápido — aceito,
  é o que evita a bagunça.
- **Reverter:** se um dia voltar a divergir, `supabase migration fetch --linked` reespelha o
  histórico de prod localmente (backup dos arquivos antes — ver reconciliação de 2026-06-26).
