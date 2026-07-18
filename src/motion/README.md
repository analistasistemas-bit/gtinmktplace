# `motion/` — camada de motion design do PubliAI

Fonte única de verdade para tudo relacionado a motion no frontend. Contrato completo em
[`docs/motion/contrato-motion-v5.md`](../../docs/motion/contrato-motion-v5.md); decisões e
histórico de aprovação em [`docs/motion/PLAN.md`](../../docs/motion/PLAN.md) e
[`PLAN-REVIEW-LOG.md`](../../docs/motion/PLAN-REVIEW-LOG.md); mecanismo de derivação TS→CSS em
[ADR-0079](../../docs/decisions/0079-fonte-unica-tokens-motion-ts-css.md).

## Princípios (as 6 funções do motion)

Motion só existe para: **feedback · mudança de estado · continuidade espacial · direcionamento
de atenção · percepção de espera · confirmação**. Sem uma dessas funções, não anime. O PubliAI é
ferramenta operacional — produtividade e clareza vêm antes de impacto visual.

## Arquitetura

```
motion/
├── tokens.ts          # durações, distâncias, stagger, seconds()
├── easings.ts          # curvas nomeadas + easingCss derivado
├── reduced-motion.ts   # hook/util de prefers-reduced-motion
├── index.ts             # barrel export
├── motion.css           # GERADO por scripts/gen-motion-css.ts — nunca editar à mão
└── __tests__/tokens-drift.test.ts  # falha o CI se motion.css divergir de tokens.ts/easings.ts
```

**Sem `springs.ts`, `variants.ts`, `transitions.ts` nem `primitives/`** — decisão da Fase 1/2
(auditoria): `tw-animate-css` + Radix + CSS puro cobrem todas as necessidades identificadas até
agora, então não há biblioteca de animação instalada e essas peças da arquitetura de referência
do contrato (pensada para quando há uma lib como Motion/Framer) não têm uso concreto. Se um caso
real precisar de spring/orquestração JS (ex.: FLIP verdadeiro), a decisão de instalar uma lib
passa por um novo GATE (ver seção 4 do contrato) e essas peças voltam a fazer sentido.

**TS é a fonte primária.** `motion.css` é gerado por `node scripts/gen-motion-css.ts` e
commitado (não gerado no build). Depois de mudar `tokens.ts`/`easings.ts`, rode o gerador e
rode `pnpm test` — o drift test falha se você esquecer de regenerar.

## Tokens

```ts
import { durationMs, distance, staggerMs, seconds, easing, easingCss, useReducedMotion } from '@/motion';
```

- `durationMs.instant/micro/state/enter/overlay/page` (100–320ms) — nunca escreva um número de
  duração direto num componente; use `duration-(--motion-duration-X)` no Tailwind ou `seconds(durationMs.X)`
  se algum dia houver uma lib JS que exija segundos.
- `distance.enterY/cardLift/pressScale` — deslocamento de entrada, elevação de card, scale de
  active/press.
- `easing.enter/exit/reversible/success` — curvas nomeadas por função, não por "como eu queria
  que ficasse". `success` **nunca** em tabelas, formulários densos, erros, exclusões ou ações
  destrutivas (contrato §6.4) — banido em todos os lotes de expansão até agora.
- `useReducedMotion()` (hook) / `prefersReducedMotion()` (leitura pontual) — só necessário quando
  a animação carrega informação funcional e precisa de um fallback explícito em JS (ex.: trocar
  ícone em vez de rotacionar). Para a maioria dos casos, o variant nativo `motion-safe:`/
  `motion-reduce:` do Tailwind já resolve sem tocar em JS.

## Reduced motion — duas camadas

1. **Rede de segurança global** (`src/index.css`): zera `animation-duration`/`transition-duration`
   em `*` sob `prefers-reduced-motion: reduce`. Verificado (Fase 1/GATE 1) que não quebra feedback
   funcional — indicadores ficam estáticos mas visíveis, nunca somem.
2. **Fallback explícito por token, animação nova/modificada:** use `motion-safe:` nas classes de
   `animate-in`/`transition-*` novas (é o padrão usado em 100% dos lotes de expansão). Só use o
   hook `useReducedMotion()` quando `motion-safe:` sozinho não bastar (ex.: a animação em si é a
   única forma de comunicar um estado).

## Integração CSS/componentes (Tailwind v4)

- Duração: `duration-(--motion-duration-state)` (sintaxe de var arbitrária do Tailwind v4 — não
  existe namespace de tema para duração).
- Easing: `ease-enter`/`ease-exit`/`ease-reversible`/`ease-success` — utilitários de tema gerados
  a partir de `--motion-ease-*` (namespace `--ease-*` do Tailwind, ver `src/index.css`).
- Entrada: `motion-safe:animate-in fade-in-0 [slide-in-from-bottom-2] duration-(--motion-duration-X) ease-enter`
  (utilitários do pacote `tw-animate-css`, já instalado — não instale outra lib sem passar pelo
  GATE 1 de novo).
- Accordion/toggle: `motion-safe:data-[state=open]:animate-collapsible-down motion-safe:data-[state=closed]:animate-collapsible-up`
  com Radix `Collapsible` (mede altura real, mantém conteúdo montado só durante a animação).
- Press/active: `active:scale-(--motion-press-scale)` — nunca em inputs ou linhas de
  tabela.

## Regras por área (resumo — ver contrato §7–10 para o texto completo)

- **Tabelas/listas:** só fundo/borda/estado muda de cor; nunca scale em linha, nunca stagger em
  conjuntos grandes ou virtualizados, nunca reanimar a cada re-render/paginação/filtro.
- **Entrada:** anima só no mount real (transição loading→dados), nunca a cada re-render.
- **Loading/progresso:** só anima como determinístico um estado com evento/campo real de backend
  por trás. Sem sinal real → indeterminado honesto (`.track-indeterminate`, `animate-pulse`
  skeleton) ou proposta de instrumentação — nunca `setTimeout` fingindo progresso.
- **Feedback de sucesso/erro:** entrada suave + `role="status"`/`role="alert"` conforme o caso;
  `shake` só em falha direta e imediata de ação do usuário, nunca em erro automático/em lote.

## Exemplo de uso (entrada de bloco condicional real)

```tsx
{error && (
  <div role="alert" className="motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-enter">
    {error.message}
  </div>
)}
```

## Exemplo do que NÃO fazer

```tsx
// ERRADO — valor mágico fora da fonte única, easing errado pro contexto
<div style={{ transition: 'opacity 240ms cubic-bezier(0.34, 1.3, 0.64, 1)' }}>
```
```tsx
// ERRADO — anima em toda paginação/filtro, não só no mount real
<div className="motion-safe:animate-in fade-in-0">{itensDaPaginaAtual.map(...)}</div>
```

## Processo para uma animação nova

1. A animação serve a uma das 6 funções (topo deste doc)? Se não, não anime.
2. Existe token/utilitário que já cobre? Reutilize — não crie duração/curva nova.
3. Se realmente faltar um token, proponha no PR/relatório da fase, com justificativa — nunca
   escreva o valor direto no componente "só desta vez".
4. `motion-safe:` (ou `useReducedMotion()` se a informação for funcional) desde o primeiro commit.
5. `pnpm test`/`lint`/`build` antes de fechar. Se mexeu em `tokens.ts`/`easings.ts`, rode
   `node scripts/gen-motion-css.ts` e confirme que o drift test passa.

## Checklist de revisão (para quem revisa um PR/commit de motion)

- [ ] Zero valor de duração/distância/easing escrito direto no componente.
- [ ] `easing.success` não aparece em tabela, formulário denso, erro ou ação destrutiva.
- [ ] `motion-safe:` presente em toda animação nova (ou `useReducedMotion()` com fallback real).
- [ ] Nenhum estado de progresso animado como determinístico sem evento real de backend por trás.
- [ ] Nenhuma função de cálculo/regra de negócio foi tocada — só `className`/estrutura visual.
- [ ] `pnpm test && pnpm lint && pnpm build` passam.
