# Tarefa 2 / Onda 3 — Navegação & orientação (escopo enxuto)

> Fecha a Tarefa 2 com as melhorias de navegação de maior ROI e menor risco. Light+dark.

## Escopo (decisão: priorizar valor/risco)

**Entra:**
- **Fatia 1 — Breadcrumbs** nas telas profundas (orientação hierárquica clara).
- **Fatia 2 — KPIs navegáveis** (drill-down) no Dashboard, usando o deep-link de status que a Onda 2 criou.

**Adiado (com justificativa) — vira backlog pós-Tarefa 2:**
- Busca global (custo alto, valor baixo em single-tenant; revisitar ao escalar).
- Ações em massa na Revisão (mexe no gate "revisão humana antes de publicar" — exige decisão do Diego).
- A11y aprofundada (épico próprio: navegação por teclado em tabelas, alternativa ao drag-drop).
- Período sincronizado Publicados↔Financeiro · scroll restoration · aviso global do worker.

## Fatia 1 — Breadcrumbs

### `src/components/ui/breadcrumbs.tsx`
`<Breadcrumbs items={[{ label, to? }]} />` — renderiza `A › B › C`; itens com `to` viram `Link`, o último (página atual) é texto `aria-current="page"`. Separador `ChevronRight`. Acessível (`nav aria-label`).

### Aplicação (acima do `PageHeader`, mantém o botão "Voltar" existente)
- `DetalheFinanceiro.tsx`: `Financeiro › Detalhe das vendas`.
- `DetalheVendas.tsx`: `Publicados › Detalhe de vendas`.
- `Relatorio.tsx`: `Dashboard › Lote #N`.

## Fatia 2 — KPIs navegáveis

### `src/components/ui/kpi-card.tsx`
Nova prop `to?: string`. Quando presente, o card é envolvido em `<Link>` com affordance (cursor-pointer + `hover:-translate-y-0.5` + borda primária no hover). Sem `to`, permanece informativo (como hoje).

### `Dashboard.tsx`
- "Anúncios publicados" → `/publicados`
- "Ativos" → `/publicados?status=ativo` (deep-link da Onda 2)
- "Com problema" → `/publicados`
- "Erros de publicação" e "A revisar" permanecem **informativos** (já cobertos pelo painel de pendências e pelo card "Continuar" da Onda 1 — evita redundância e destino ambíguo).

## Escopo de arquivos
- **Criar:** `components/ui/breadcrumbs.tsx` + teste.
- **Modificar:** `kpi-card.tsx` (prop `to`), `Dashboard.tsx`, `DetalheFinanceiro.tsx`, `DetalheVendas.tsx`, `Relatorio.tsx`.

## Testes
- **Unit (Vitest):** `Breadcrumbs` — itens com/sem `to` (links vs texto), `aria-current` no último.
- **Visual (navegador, light+dark):** breadcrumbs nas 3 telas; KPIs clicáveis levam ao destino certo (Ativos → Publicados já filtrado por status=ativo).
