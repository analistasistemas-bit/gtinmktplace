# ADR-0079: Fonte única TS→CSS para tokens de motion, sem biblioteca de animação

**Status:** Aceito
**Data:** 2026-07-18
**Decisores:** Diego (GATE 1/2 do Motion Design System) + Claude (orquestração) + Fable 5 (construtor)

## Contexto

A iniciativa de Motion Design System (`docs/motion/contrato-motion-v5.md`, `docs/motion/PLAN.md`)
exige que durações, distâncias, easings e derivados vivam numa única fonte, com TypeScript e CSS
derivados dela — nunca duas listas mantidas manualmente. A auditoria (Fase 1) mediu que
`tw-animate-css` (já instalado) + Radix + CSS puro cobrem as necessidades do piloto (entrada/
saída no unmount via `data-state`, accordions reversíveis via Collapsible, sem FLIP real nem
springs necessários) — então a fundação (Fase 2) não instala `Motion`/Framer nem nenhuma outra
lib de animação. Isso deixa em aberto **como** manter TS e CSS sincronizados sem lib.

## Decisão

`src/motion/tokens.ts` + `easings.ts` são a fonte primária (TypeScript, tipada). Um gerador sem
dependência nova (`scripts/gen-motion-css.ts`, roda com `node` puro — type stripping nativo desde
o Node 23.6) emite `src/motion/motion.css`, que é **commitado** (não gerado no build) e importado
por `src/index.css`. Um teste `vitest` (`src/motion/__tests__/tokens-drift.test.ts`) regenera o
CSS em memória a partir da mesma função do gerador e falha se divergir do arquivo commitado —
tornando impossível as duas fontes divergirem sem quebrar o CI.

## Alternativas consideradas

- **CSS como fonte primária + `getComputedStyle` em runtime para o TS ler os valores:** rejeitada
  — não é testável estaticamente (exige DOM real), frágil em `jsdom`, e inverte a ergonomia (TS
  quer valores tipados/numéricos para `duration`/`seconds()`, não strings CSS).
- **Gerar o CSS em tempo de build (plugin Vite) em vez de commitar o artefato:** rejeitada por ora
  — adicionaria uma etapa de build e um plugin novo para um projeto que já tem `tsc -b && vite
  build` simples; o drift test já garante a mesma invariante (TS e CSS nunca divergem) sem
  acoplar o build. Pode ser revisitado se a camada `motion/` crescer muito.
- **Manter os tokens legados de `src/index.css` como aliases (`--ease-out: var(--motion-ease-enter)`)
  em vez de removê-los:** rejeitada — confirmado por grep que não tinham consumidor em `src/`;
  manter seria uma segunda nomenclatura para os mesmos valores, o que o contrato proíbe
  explicitamente (regra 3).
- **Instalar `Motion` (ex-Framer Motion) já na Fase 2** para ganhar tokens/variants prontos:
  rejeitada — sem requisito concreto no piloto (seção 4 do contrato: só instalar com benefício
  técnico claro), custo de bundle (+15–34 kB gzip conforme relatório da Fase 1) sem uso.

## Consequências

- Boas: zero duplicação de valor (verificável mecanicamente via CI, não por revisão manual); TS
  tipado para consumo em componentes; nenhuma dependência nova; reversível linha a linha.
- Ruins / tradeoffs aceitos: o CSS gerado precisa ser regenerado manualmente (`node
  scripts/gen-motion-css.ts`) sempre que `tokens.ts`/`easings.ts` mudar — se alguém esquecer, o
  drift test falha no CI (mitigação já embutida, não um risco silencioso). `scripts/
  gen-motion-css.ts` fica fora do `tsc -b` do app (só `src/`) — coberto por lint e pela execução
  no teste, não por typecheck de build.
- Como reverter: se a camada `motion/` justificar uma lib no futuro (ex.: FLIP real na Fase 5),
  os tokens TS continuam a fonte — só o consumo muda (de CSS vars para `variants.ts`/`springs.ts`
  da lib), sem precisar desfazer este ADR.
