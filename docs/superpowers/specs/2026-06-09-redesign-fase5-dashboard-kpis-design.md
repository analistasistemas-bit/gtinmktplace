# Redesign PubliAI — Fase 5: Dashboard com KPIs

> Spec de design. Parte do redesign faseado. **Data:** 2026-06-09 · **Pré-requisitos:** Fases 1 (DS), 2 (shell), 3 (Revisão), 4 (telas restantes).

## Objetivo

Transformar o Dashboard — hoje apenas uma lista de lotes (`useLotes`) — num **painel com métricas** usando o `KpiCard` do design system (que existe desde a Fase 1 mas nunca foi usado numa tela real). Diferente das Fases 3–4 (re-skin presentacional), esta fase **adiciona funcionalidade**: deriva e exibe indicadores agregados. A lista de lotes existente é preservada abaixo dos KPIs.

## Estado atual

- `src/pages/Dashboard.tsx` — `PageHeader "Lotes recentes"` + ação "Novo lote" + lista de `LoteCard` (via `useLotes`) com loading/erro/empty (`EmptyState`).
- `src/components/ui/kpi-card.tsx` — componente pronto: props `label`, `value`, `icon`, `delta`, `deltaTrend`, `hint`, `loading` (skeleton), `className`. Só usado em `StyleGuide.tsx`.
- Hooks de dados existentes:
  - `useLotes()` → `Lote[]` (campos: `status`, `totalFamilias`, `totalPublicadas`, `totalErros`, `criadoEm`). Instantâneo (banco).
  - `usePublicados()` → `PublicadoItem[]` (1 por anúncio; banco). Instantâneo.
  - `useStatusPublicados()` → `{ itens: [...], semCredencialML }` (status ao vivo do ML via `GET /items?ids=`). Mais lento, pode falhar; expõe `isFetching`/`error`.

## Design

### 5 cards de KPI

| Card | Valor | Fonte | Ícone (lucide) | Tom |
|---|---|---|---|---|
| Anúncios publicados | nº de anúncios distintos publicados | banco (`usePublicados().length`) | `Package` | neutro/primary |
| Ativos | status ao vivo = `ativo` | ML (`useStatusPublicados`) | `CheckCircle2` | success |
| Com problema | `moderado` + `inativo` + `pausado` | ML (`useStatusPublicados`) | `AlertTriangle` | warning |
| Erros de publicação | Σ `totalErros` dos lotes | banco (`useLotes`) | `XCircle` | danger |
| A revisar | nº de lotes com `status === 'revisao'` | banco (`useLotes`) | `ClipboardList` | info |

**Observações de cálculo:**
- "Anúncios publicados" = `usePublicados().length` (o hook já agrupa por `mlItemId`, 1 linha por anúncio). Não somar `totalPublicadas` dos lotes (conta duplicado em ciclos de UPDATE).
- "Ativos" / "Com problema" derivam do **merge** banco+status ao vivo (mesma lógica `merged` da tela Publicados): cada `PublicadoItem` ganha `status` do mapa `ml_item_id → status`; sem match → `indisponivel`.
- `encerrado`/`indisponivel` **não** entram em "Com problema" (encerrado é estado final legítimo; indisponível = sem dado, não é problema do anúncio).

### Função pura (TDD)

`src/lib/dashboard-kpis.ts` — `calcularKpisDashboard(lotes: Lote[], publicados: PublicadoItem[]): KpisDashboard`.

```ts
interface KpisDashboard {
  publicados: number;     // publicados.length
  ativos: number;         // status === 'ativo'
  comProblema: number;    // status ∈ {moderado, inativo, pausado}
  erros: number;          // Σ lote.totalErros
  aRevisar: number;       // lotes com status === 'revisao'
}
```

Recebe os `publicados` **já mergeados** com o status ao vivo (o merge fica na página, idêntico ao de Publicados, ou extraído para um helper reutilizável). A função é determinística e testável sem mocks de rede. Testes cobrem: lista vazia, contagem por status, soma de erros, contagem de lotes em revisão, e que `encerrado`/`indisponivel` não contam como problema.

### Estados (resiliência)

- **Cards de banco** (publicados, erros, a revisar): renderizam imediatamente assim que `useLotes`/`usePublicados` resolvem.
- **Cards ao vivo** (ativos, com problema): `KpiCard loading` (skeleton) enquanto `useStatusPublicados` está `isFetching` na primeira carga. Se a chamada falhar **ou** `semCredencialML` for `true`, exibir `value="—"` com `hint="ML indisponível"` (ou "Conecte o ML"). Nunca trava a tela nem propaga erro.
- A página continua funcional mesmo sem conexão ML (os 3 cards de banco + a lista de lotes aparecem normalmente).

### Layout

- `PageHeader` muda de "Lotes recentes" para **"Dashboard"**, mantendo a ação "Novo lote".
- Faixa de KPIs: `grid` responsivo (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` ou similar), `gap` do DS, acima da lista.
- Abaixo dos KPIs: a lista de lotes atual **inalterada** (loading/erro/`EmptyState`/`LoteCard`).
- Dark + light corretos; tons semânticos via os tokens já existentes.

## Restrições

- Não criar tabela/schema/migration nem edge function nova. Tudo deriva de hooks já existentes.
- Não tocar na lógica da lista de lotes nem em `LoteCard`.
- Reusar o componente `KpiCard` como está (sem alterá-lo). Se precisar de tom semântico no ícone, passar via `className`/props existentes; não inventar props novas.
- A chamada de status ao vivo no Dashboard reusa `useStatusPublicados` (mesmo cache do hook); não criar fetch paralelo.

## Fora de escopo (YAGNI)

- **Filtro de período** — KPIs são "estado atual" (contadores), não série temporal; a escala do app não justifica. Adicionável depois.
- **Delta / "vs ontem"** nos cards — exigiria histórico não armazenado. Cards mostram só valor + label + ícone.
- **Valor em estoque publicado** (Σ preço × estoque) — descartado no brainstorming.
- Gráficos/recharts — não pedidos nesta fase.

## Testes e verificação

- `src/lib/__tests__/dashboard-kpis.test.ts` (TDD) cobrindo a função pura (casos acima).
- `pnpm test` verde, `pnpm exec tsc --noEmit`, `pnpm lint` (0 errors), `pnpm build` limpos.
- Visual: dark + light; com ML conectado (cards ao vivo preenchidos) e sem ML (fallback "—").

## Critérios de aceite

- [ ] 5 cards de KPI no topo do Dashboard via `KpiCard`, com os valores corretos.
- [ ] Cards de banco instantâneos; cards ao vivo com skeleton no loading e fallback "—" em falha/sem-ML.
- [ ] `calcularKpisDashboard` pura, testada (TDD), com a regra de "problema" correta.
- [ ] Lista de lotes preservada abaixo, sem mudança de comportamento.
- [ ] Dark e light corretos; testes/tsc/lint/build limpos.
