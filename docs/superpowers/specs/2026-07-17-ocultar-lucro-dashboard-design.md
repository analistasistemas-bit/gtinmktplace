# Ocultar lucro no card do Dashboard

## Objetivo

O card "Líquido no faturamento" do Dashboard (`src/pages/Dashboard.tsx`) exibe, em texto
secundário (`hint`), o lucro do período (`lucro R$ X`). Diego quer que essa informação fique
oculta por padrão, com um toggle em Configurações para reabilitá-la por organização.

## Design

Segue 1:1 o padrão já existente de preferências booleanas em `configuracoes` (ex.:
`reancora_lider_ativa`) — nenhuma abstração nova.

- **Migration** (`supabase migration new`): `configuracoes.mostrar_lucro_dashboard boolean not
  null default false`. RLS da tabela já cobre (leitura por qualquer membro da org, escrita só
  admin) — nada novo a criar ali.
- **`src/lib/queries.ts`**: `fetchMostrarLucroDashboard` / `upsertMostrarLucroDashboard`, cópia
  do par `fetchReancoraLiderAtiva` / `upsertReancoraLiderAtiva`.
- **`src/hooks/useConfiguracoes.ts`**: `useMostrarLucroDashboard` (query) /
  `useSalvarMostrarLucroDashboard` (mutation com invalidate), mesmo padrão dos demais hooks do
  arquivo.
- **`src/pages/Configuracoes.tsx`**: novo `Card` com `Switch`, igual em estrutura ao card
  "Ancorar preço no piso dos MercadoLíderes" (linhas 166-183) — label "Mostrar lucro no card do
  Dashboard", texto explicativo curto, feedback inline "Salvando…" / "✓ Salvo".
- **`src/pages/Dashboard.tsx`**: ler `useMostrarLucroDashboard()`; o `hint` do card "Líquido no
  faturamento" (linha 287) só monta a string quando o toggle estiver ligado:
  `hint={mostrarLucro && r.margem != null ? \`lucro ${fmtBRL(r.lucro)}\` : undefined}`. Toggle
  desligado ou ainda carregando → `hint` vira `undefined` e a linha simplesmente não renderiza
  (comportamento já existente do `KpiCard` quando `hint` é `undefined`).

Sem ADR novo: é um toggle de exibição, não altera nenhum cálculo financeiro nem regra de
negócio (lucro/margem continuam calculados do mesmo jeito em `cockpit.ts`/`resumo-vendas.ts`,
só a exibição no card muda).

## Validação

- Teste (`useConfiguracoes`/`queries`) cobrindo fetch/upsert do novo campo, mirando os testes
  já existentes de `reancora_lider_ativa`.
- `pnpm lint` + `pnpm test` passando.
- Verificação manual no navegador: toggle desligado → card sem a linha "lucro"; toggle ligado →
  linha volta a aparecer com o valor correto.

## Limites

Nenhuma mudança em RLS, em cálculo de lucro/margem, ou em outros cards/páginas que também
mostram lucro (ex.: "Lucro líquido no período" em Financeiro.tsx segue sempre visível — não foi
pedido ocultar lá).
