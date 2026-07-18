# Plan: Motion Design System Premium — PubliAI

_Locked via grill-with-docs — por Claude + Diego. Termos de domínio: nenhum termo novo nesta sessão
(vocabulário de produto já coberto por `docs/reference/glossario.md`; `CONTEXT.md` não foi criado —
esta sessão não introduziu conceito de domínio novo, apenas papéis operacionais de execução)._

> Nota: os artefatos desta iniciativa (`PLAN.md`, `PLAN-REVIEW-LOG.md`) ficam em `docs/motion/`
> em vez da raiz do repo porque já existe um `PLAN.md`/`PLAN-REVIEW-LOG.md` commitado na main de
> uma sessão de grill anterior não relacionada (retry de catálogo ML) — evitar sobrescrever esse
> registro histórico.

## Goal

Implementar motion e microinterações no frontend do PubliAI seguindo o contrato técnico e
operacional em [`docs/motion/contrato-motion-v5.md`](./contrato-motion-v5.md) (v5, 17/07/2026) —
sistema centralizado de tokens/easings/springs, aplicado por fases com GATE de aprovação humana
explícita em cada uma, sem alterar regra de negócio, dados, contratos de API ou identidade visual
já definida (repaginação visual premium, Tarefa 1, já concluída).

## Approach

1. **Camada de orquestração (esta sessão / Claude, sem codar):**
   - Claude nunca escreve código diretamente nesta iniciativa. Cada fase do contrato (seção 17)
     é despachada como subagente via `Agent` tool, com o relatório padrão (seção 19) trazido para
     Diego no GATE correspondente. Só avança para a fase seguinte com aprovação explícita
     (ausência de resposta ≠ aprovação, regra 1 do contrato).
   - Pode acontecer em turnos/sessões separadas — Diego revisa cada GATE com calma.

2. **Divisão construtor × executor por fase:**
   - **Fable 5 ("construtor"), Fases 1–3:** Auditoria (Fase 1), Fundação da camada `motion/`
     (Fase 2 — tokens, easings, springs, primitivas), Piloto (Fase 3 — fluxo de revisão,
     preferencialmente). Fases com decisão de arquitetura/gosto e onde o GATE 3 exige aprovação
     humana de qualidade visual subjetiva.
   - **Sonnet 5 ("executor"), Fases 4–5:** Validação (Fase 4) e Expansão em lotes (Fase 5A–5E).
     Aplicação mecânica do padrão já aprovado no piloto, sobre muitos componentes/telas.
   - Justificativa: alinhado ao roteamento de modelos do `CLAUDE.md` do projeto (arquitetura/gosto
     → modelo mais forte; implementação padrão repetida → sonnet), com Fable 5 no lugar de Opus
     porque foi pedido explicitamente pelo Diego e é o modelo dos demais skills de design/gosto já
     usados no projeto (`frontend-design-fable5`, `ui-ux-pro-max-fable5`).

3. **Branch/isolamento:** já criado — worktree `.claude/worktrees/feat+motion-design-system`,
   branch `feat/motion-design-system` (nome exigido pela seção 16 do contrato). Nenhum arquivo de
   produto alterado ainda; só documentos de planejamento.

4. **Execução (após aprovação deste plano + revisão do Codex):**
   - Despachar subagente Fable 5 para Fase 1 (Auditoria) → relatório seção 19 → GATE 1 com Diego.
   - Repetir por fase, sempre com o relatório completo e pausa obrigatória no GATE.
   - ADR: se a Fase 1 recomendar biblioteca de animação (ex.: Motion/ex-Framer Motion) e ela for
     aprovada no GATE 1, registrar decisão em `docs/decisions/` (convenção já existente no
     projeto — não criar `docs/adr/` paralelo) antes de iniciar a Fase 2, seguindo a regra geral
     do `CLAUDE.md` ("decisão nova e não-trivial → ADR antes da implementação").

5. **Segurança de git por fase (refinado após revisão do Codex):** cada commit de fase usa
   staging por caminho explícito (nunca `git add -A`/`git add .`), com `git status`/HEAD
   verificados antes e depois; se o diff a commitar incluir qualquer arquivo fora do escopo
   aprovado no GATE, aborta e reporta em vez de commitar. Sequência fixa por fase que altera
   arquivo: validar (testes/QA) → stage por caminho → commit isolado → relatório (seção 19) com
   o SHA do commit → registrar a aprovação humana em `docs/motion/PLAN-REVIEW-LOG.md` só depois
   da resposta explícita do Diego.
6. **"Commit/PR por lote" (seção 17 do contrato) é reinterpretado como "commit isolado por
   lote"** — abrir/atualizar PR continua exigindo autorização explícita e separada, mesmo por
   lote (regra 8 do contrato + regra permanente do projeto: nunca abrir PR sem pedido).

## Guardrails (adicionados após revisão adversarial do Codex — rounds 1–2)

**Precedência:** quando qualquer trecho de `docs/motion/contrato-motion-v5.md` conflitar com um
guardrail abaixo, **este `PLAN.md` prevalece** — o contrato não é editado, mas nenhuma fase pode
seguir seu texto literal onde houver override registrado aqui. Overrides conhecidos até agora:
distinção `custo_centavos`/`variacoes.custo` (P4, seção 11); "commit/PR por lote" (seção 17) →
commit isolado + PR só com autorização separada; formato do relatório (seção 19) mantém os 13
títulos exatos, mas o SHA do commit entra dentro de "## 1. Resumo", não como título novo.

- **`familias.custo_centavos` ≠ custo de produto.** O contrato (seção 11, P4) lista
  `custo_centavos` ao lado de `variacoes.custo` como exemplos de "erros de domínio" sem
  distinguir tabela — risco real de motion/mensagem de erro tratar os dois como
  intercambiáveis. Regra do projeto (`CLAUDE.md`): custo real de produto é **só**
  `variacoes.custo` (R$); `familias.custo_centavos` é custo de tokens de IA e **nunca** entra em
  markup/preço/margem. Qualquer feedback visual de erro em P4 sobre custo deve citar
  `variacoes.custo`, nunca `custo_centavos`, e a Fase 1 deve confirmar essa distinção
  explicitamente no relatório.
- **Estados visuais de loading/progresso (seção 9) precisam de tabela estado→evento real antes
  da Fase 2.** A Fase 1 entrega, além do resto, um mapeamento explícito de cada etapa visual
  proposta (ex.: "interpretando colunas", "publicação parcial") para o evento/campo real do
  backend que a dispara. Etapa sem sinal real vira estado indeterminado honesto ou proposta de
  instrumentação separada — nunca é implementada como se fosse real (regra 6 do contrato).
- **Reduced-motion global atual é hipótese, não fato resolvido.** `src/index.css:214-217` zera
  duração mas mantém indicadores estáticos — a Fase 1 mede se isso realmente quebra feedback
  funcional (regra 12) antes de decidir migrar; não tratar como problema já confirmado.
- **`tw-animate-css` avaliado por requisito, não por presença.** A Fase 1 verifica se cobre
  entrada/saída no unmount, interrupção, layout transitions, springs e hook de reduced-motion —
  não conclui "já resolve" só porque está instalado.
- **Baseline de performance metodologicamente congelado no GATE 1.** Rota(s), dataset, dispositivo/
  throttling, métricas e nº de amostras usados pela Fase 1 viram o método oficial que Fases 3–5
  reutilizam — evita resultados incomparáveis entre construtor e executor.
- **QA visual da Fase 3 (piloto) não pode aprovar em silêncio por falta de ferramenta.** Sem
  Playwright/gravador, o GATE 3 exige evidência temporal reproduzível manual (gravação de tela,
  trace do DevTools) OU um waiver humano explícito registrado em `PLAN-REVIEW-LOG.md` — nunca
  aprovação tácita por ausência de evidência.
- **Fonte única TS/CSS precisa de mecanismo executável, não só de intenção.** O GATE 1 aprova
  explicitamente: qual formato é a fonte primária (TS ou CSS), como o outro é gerado a partir
  dela, e um teste (unit ou script) que falha se os dois divergirem — antes de a Fase 2 começar a
  escrever `motion/tokens.ts` e as CSS vars.
- **Lote 5A (seção 17, Fase 5) pode precisar ser subdividido.** Navegação, modal, drawer, toast,
  tooltip, accordion, tabs, botões e inputs num lote só é blast radius grande demais para reverter
  com segurança. O GATE que abrir 5A avalia isso e subdivide (ex.: feedback/overlay/navegação/
  formulário) se o escopo não for pequeno e revertível.

## Continuidade e handoff entre fases (adicionado após revisão adversarial — round 1)

- **Fable 5 é preferencialmente UMA sessão de agente contínua para as Fases 1–3**, retomada via
  `SendMessage` a cada GATE aprovado — preserva o contexto de auditoria/fundação ao decidir o
  piloto, sem depender só do relatório escrito. Continuidade de sessão de agente **não é
  garantida** entre turnos muito espaçados; se a sessão original não estiver mais disponível,
  Claude despacha um novo Fable 5 e compensa com o dossiê completo abaixo (não com o relatório
  da última fase isolado) — a continuidade via `SendMessage` é preferência, o dossiê durável é a
  garantia real.
- **Handoff — dentro do bloco Fable (entre Fases 1→2→3) e para Sonnet (Fase 3→4) — é sempre via
  dossiê durável em `docs/motion/PLAN-REVIEW-LOG.md`, nunca só o relatório da seção 19.** Ledger
  append-only, mantido por Claude, contendo por GATE: decisão humana literal/resumida, SHA do
  commit da fase (quando houver), desvios aprovados, pendências e critérios de regressão. Cada
  fase nova (mesmo agente retomado ou não) começa lendo esse ledger.
- **Ciclo de commit do ledger:** depois da aprovação humana de um GATE, Claude registra a entrada
  no `PLAN-REVIEW-LOG.md` e commita **isoladamente** (`docs(motion): registra aprovação GATE N`),
  separado do commit funcional da fase seguinte — nunca mistura os dois nem deixa o worktree sujo
  ao iniciar a próxima fase.
- **Fase 4 (Validação) não é puramente mecânica — Codex apontou corretamente que pode exigir
  diagnóstico arquitetural.** Sonnet executa a Fase 4, mas qualquer achado que exija mudar tokens,
  primitivas ou decisão já aprovada em Fundação/Piloto **reabre o escopo com Fable 5** (mesma
  sessão retomada) e um GATE novo só sobre a parte afetada — Sonnet nunca corrige arquitetura
  aprovada por conta própria.

## Key decisions & tradeoffs

- **Fable 5 vs Opus como "construtor":** decisão do Diego, não uma recomendação técnica minha —
  registrado explicitamente para não ser revertido silenciosamente numa sessão futura.
- **Split de fases 1–3 vs 4–5** (não 1–2 vs 3–5, nem tudo num agente só): o piloto (Fase 3) fica
  com o "construtor" porque é onde a qualidade visual subjetiva é decidida e aprovada — a
  expansão (Fase 5) é replicação do padrão já validado, não nova decisão de design.
- **Claude nunca edita arquivo de produto nesta iniciativa — mas não é passivo.** Mantém o ledger
  (`PLAN-REVIEW-LOG.md`), confere que cada commit de fase respeita o allowlist aprovado no GATE,
  e valida que o handoff (dossiê) está completo antes de despachar a fase seguinte. Decisão de
  arquitetura/gosto continua sendo de Fable 5/Sonnet, não de Claude. Rastreabilidade: 1 fase = 1
  relatório = 1 GATE (o mesmo agente pode cobrir várias fases seguidas, ver "Continuidade").
- **`docs/motion/` em vez da raiz para os artefatos de plano:** ver nota no topo — colisão com
  `PLAN.md` já commitado de outra iniciativa.
- **`docs/decisions/` em vez de `docs/adr/`:** o projeto já tem convenção de ADR própria
  (numeração sequencial); não duplicar.
- **Sem `CONTEXT.md`:** nenhum termo de domínio novo surgiu nesta sessão; criar um glossário vazio
  seria trabalho especulativo (o contrato já é auto-contido em terminologia de motion).

## Risks / open questions

Achados da exploração desta sessão que **não foram resolvidos aqui** — ficam para a Fase 1
(Auditoria) reportar objetivamente no GATE 1, conforme o próprio contrato prevê:

- `src/index.css` já tem tokens parciais de motion (`--ease-out`, `--ease-emph`,
  `--duration-fast/base/slow`) e um bloco global `prefers-reduced-motion` que zera
  `animation-duration`/`transition-duration` em `*` — **hipótese a verificar na Fase 1** (não fato
  confirmado, ver Guardrails): pode ou não estar de fato quebrando feedback funcional (indicadores
  estáticos continuam visíveis mesmo com duração zerada). Se confirmado que quebra a regra 12 do
  contrato, a Fase 1 propõe migrar esses tokens para a nova camada `motion/` (fonte única) e
  tornar o bloco reduced-motion seletivo em vez de global.
- `tw-animate-css` já está instalado (não citado no contrato) — a Fase 1 precisa avaliar se cobre
  parte das necessidades antes de considerar instalar `Motion` (ex-Framer Motion), conforme a
  ordem de prioridade da seção 4.
- Sem Playwright/E2E no projeto (só `vitest` + Testing Library) — a seção 18.1 do contrato
  pressupõe "smoke E2E"; a Fase 1 deve reportar a ausência no GATE 1 em vez de instalar
  automaticamente (regra 18, "não instalar automaticamente").
- Existe rota `/style-guide` (`src/pages/StyleGuide.tsx`) — candidata natural para validar tokens
  da Fase 2 antes de aplicar em telas reais.

## Out of scope

- Qualquer alteração de regra de negócio, dado, contrato de API, integrações ML/Shopee,
  autenticação, permissões, precificação, margem, identidade visual, tipografia, textos de
  negócio, navegação ou hierarquia de informação (regra 7 do contrato).
- A "Tarefa 2" mencionada no spec de 2026-06-20 (reestruturação de UX/fluxos — navegação,
  organização de telas, nº de cliques) é iniciativa separada e não faz parte deste plano.
- Merge, rebase, force push, reset destrutivo, push ou PR sem autorização explícita (regra 8 do
  contrato + regra permanente do projeto).
- Fases 2 em diante (qualquer alteração de arquivo de produto) só começam após aprovação explícita
  deste `PLAN.md` + revisão do Codex (Act 2) + GATE 1 da própria Fase 1.
