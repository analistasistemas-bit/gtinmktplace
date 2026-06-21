# Fatia 1 — Jornada do lote (visível + retomável)

> Tarefa 2 / Onda 1 / Fatia 1 de 4. Torna o lifecycle do lote visível ("você está aqui") e retomável ("continuar de onde parei"). Sem tocar backend/lifecycle — pura leitura de status.

**Goal:** o operador enxerga em que etapa cada lote está e retoma o trabalho de qualquer tela em 1 clique.

**Tech:** React 18 + TS + Vite + Tailwind v4 + shadcn + TanStack Query. Leitura de `Lote.status` (já existe).

## Modelo da jornada

4 etapas visíveis; `erro` é estado lateral (não 5ª etapa):

| Índice | Etapa visível | `LoteStatus` |
|---|---|---|
| 0 | Enviado | `importando` |
| 1 | Processando | `processando` |
| 2 | Revisão | `revisao` |
| 3 | Publicado | `publicando` (em curso) / `concluido` (4 = tudo concluído) |

`erro` → `{ indiceAtual: 1, erro: true }` (falha global de ingest/processamento; o badge vermelho marca a etapa Processando). Erros por-família são tratados na própria Revisão/Relatório, fora do escopo desta função.

### `src/lib/jornada.ts` (função pura, testável)
```ts
export type EtapaJornada = { chave: string; label: string };
export const ETAPAS_JORNADA: EtapaJornada[]; // 4 etapas
export interface EstadoJornada { indiceAtual: number; erro: boolean }
export function jornadaDoLote(status: LoteStatus): EstadoJornada;
// destino de retomada (movido de lote-card.tsx p/ reuso — DRY)
export function destinoDoLote(status: LoteStatus, id: string): string;
```

Mapeamento `indiceAtual`: importando→0, processando→1, revisao→2, publicando→3, concluido→4, erro→1(erro:true).

## Componentes

### `src/components/jornada-lote.tsx` — `<JornadaLote status compact? />`
Stepper **horizontal** compacto, tokens (sem cores hardcoded). Cada etapa: concluída (i<atual, check + cor success), atual (i===atual, primary + label destacado), pendente (i>atual, muted), erro (i===atual && erro → destructive). Conectores entre etapas. `compact` = versão menor (para o card do Dashboard).

O `stepper.tsx` atual (vertical, cores hardcoded, **sem uso no app**) não é tocado — fica como candidato a remoção futura (anotado, não removido).

### `src/components/dashboard-lotes-andamento.tsx` — `<LotesEmAndamento lotes />`
Bloco no **topo do Dashboard** (acima dos KPIs). Filtra `status !== 'concluido'`. Para cada lote: `Lote #N` + `<JornadaLote compact />` + CTA contextual:
- `revisao` → "Revisar" · `erro` → "Corrigir" · demais → "Acompanhar"
- destino via `destinoDoLote(status, id)`

Quando **nenhum** lote em curso: o bloco não renderiza (evita ruído; "Novo lote" já está no header). Decisão pragmática — sem empty-state aqui.

## Telas que recebem `<JornadaLote>`
- `Progresso.tsx` — acima da `<Progress>` atual (não a remove).
- `Revisao.tsx` — acima das tabs de filtro.
- `Relatorio.tsx` — acima dos cards de resumo.

## Escopo de arquivos
- **Criar:** `lib/jornada.ts`, `lib/jornada.test.ts`, `components/jornada-lote.tsx`, `components/dashboard-lotes-andamento.tsx`.
- **Modificar:** `Dashboard.tsx` (montar bloco no topo), `Progresso.tsx`, `Revisao.tsx`, `Relatorio.tsx` (montar jornada), `lote-card.tsx` (importar `destinoDoLote` da lib em vez da função local).

## Testes
- **Unit (Vitest):** `jornadaDoLote()` nos 6 status (índice correto + erro). `destinoDoLote()` por status.
- **Visual (navegador, light+dark):** Dashboard (bloco em andamento), Progresso, Revisão, Relatório.

## Não-objetivos (outras fatias)
Pendências pós-publicação (encalhados/financeiro) → Fatia #2 · Revisão por exceção → #3 · Pré-validação upload → #4. Sem mudança de backend/lifecycle.
