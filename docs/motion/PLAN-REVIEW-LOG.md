# Plan Review Log: Motion Design System Premium — PubliAI

Act 1 (grill-with-docs) completo — plano travado em `docs/motion/PLAN.md`. Nenhum termo de
domínio novo (`CONTEXT.md` não criado). MAX_ROUNDS=5 (padrão, não sobrescrito).

## Round 1 — Codex

Achados completos em anexo à sessão (18 pontos). Resumo dos críticos/altos:
1. `custo_centavos` tratado como custo de produto no P4 do contrato — bate na regra financeira
   inegociável do projeto.
2. Estados de progresso propostos sem confirmação de evento real correspondente.
3/5/6/7. Handoff Fable→Sonnet frágil: relatório da seção 19 não basta como dossiê de aprovação;
   "um subagente por fase" quebra continuidade do arco auditoria→fundação→piloto; orquestrador
   ainda toma decisões implícitas; sem ledger durável das aprovações humanas.
4. Fase 4 (Validação) não é puramente mecânica — atribuí-la só ao executor contradiz a lógica do
   próprio split.
8/9/10. Segurança de git em worktree compartilhado, "PR por lote" conflita com regra de nunca
   abrir PR sem autorização, ordem relatório/commit/GATE ambígua.
11-14. Mecanismo de fonte única TS/CSS não é executável ainda; `tw-animate-css` avaliado por
   presença, não por requisito; QA pode aprovar em silêncio sem ferramenta; baseline de
   performance sem método congelado.
15/16. Lote 5A grande demais; sem caminho de reabertura quando a Fase 4 encontra problema na
   fundação aprovada.
17/18. Reduced-motion tratado como "quase resolvido" antes da auditoria; nomes genéricos dentro
   de `docs/motion/`.

VERDICT: REVISE

### Claude's response

Aceito e incorporado ao `PLAN.md` (seção "Guardrails" + "Continuidade e handoff" + item 5/6 do
Approach): achados 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17.

- **Achado 4 (Fase 4 misassigned):** aceito parcialmente — não revertido o split Fable(1-3)/
  Sonnet(4-5) que o Diego travou explicitamente nesta sessão (não é meu para reabrir sozinho),
  mas incorporada a salvaguarda do achado 16: Sonnet executa a Fase 4, e qualquer achado que
  exija mudar tokens/primitivas/decisão de fundação reabre o escopo com a mesma sessão Fable 5 e
  um GATE novo — não corrige arquitetura por conta própria. Resolve a preocupação de fundo sem
  reabrir a decisão do Diego; será mencionado no fechamento com ele por transparência.
- **Achado 15 (Lote 5A grande):** não travado agora — é decisão da Fase 5, ainda distante; nota
  adicionada para o responsável da Fase 5 considerar subdividir 5A no próprio GATE daquele lote.
- **Achado 18 (nomes genéricos em `docs/motion/`):** baixo risco, não alterado — os caminhos já
  são sempre passados completos (`docs/motion/PLAN.md`, `docs/motion/contrato-motion-v5.md`) em
  todos os prompts desta sessão.

## Round 2 — Codex

VERDICT: REVISE. 9 achados, nenhum crítico ao ponto de travar a decisão do Diego. Resumo:
1. Crítico — sem regra de precedência explícita entre `PLAN.md` (guardrails) e o texto do
   contrato quando conflitam.
2. Alto — continuidade de sessão via `SendMessage` não é garantida entre turnos/sessões.
3. Alto — ciclo de commit do ledger pós-GATE não definido (podia sujar o worktree ou misturar
   aprovação com o commit funcional seguinte).
4. Médio — SHA no relatório conflita com os "exatamente 13 títulos" da seção 19 do contrato.
5. Médio — guardrail de fonte única TS/CSS mencionado no log mas nunca escrito no `PLAN.md`.
6. Médio — seção Risks ainda afirmava o conflito de reduced-motion como fato, contradizendo o
   guardrail que o chama de hipótese.
7. Médio — "1 subagente = 1 fase" ficou obsoleto com o modelo de sessão contínua.
8. Médio — subdivisão do lote 5A só existia no review log, não no `PLAN.md` (não normativo pro
   executor da Fase 5).
9. Baixo — papel do orquestrador descrito como "puro" de um jeito que soava passivo demais.

### Claude's response

Todos os 9 aceitos e incorporados diretamente ao `PLAN.md` (árbitro final — nenhum reabre a
decisão do Diego sobre construtor×executor):
- Bloco de precedência explícita no topo de "Guardrails", listando os overrides conhecidos.
- Continuidade via `SendMessage` reclassificada como preferência, com fallback explícito (novo
  Fable 5 + dossiê completo) se a sessão original não estiver disponível.
- Novo parágrafo "Ciclo de commit do ledger": commit isolado `docs(motion): registra aprovação
  GATE N` após cada aprovação humana, antes de iniciar a fase seguinte.
- Precedência esclarece onde o SHA entra: dentro de "## 1. Resumo" do relatório, não como título
  novo — os 13 títulos da seção 19 do contrato continuam intactos.
- Guardrail novo: GATE 1 aprova mecanismo executável de fonte única TS/CSS (não só intenção) antes
  da Fase 2 começar.
- Risks reescrito para tratar o bloco de reduced-motion como hipótese a verificar, consistente com
  o guardrail.
- "1 subagente = 1 fase" trocado por "1 fase = 1 relatório = 1 GATE" em Key decisions.
- Lote 5A: guardrail novo no `PLAN.md` (não só no log) instruindo o GATE que abrir 5A a avaliar
  blast radius e subdividir se necessário.
- Papel do orquestrador reescrito: mantém ledger, confere allowlist do commit, valida dossiê de
  handoff — nunca edita arquivo de produto.

## GATE 1 — Fase 1 (Auditoria) — aprovado

**Data:** 2026-07-18. **Decisão do Diego:** aprovado o pacote completo como recomendado pelo
Fable 5 (relatório completo na sessão de auditoria), sem ajuste técnico. Respostas às 8 perguntas
da seção 12 do relatório:

1. Nenhuma dependência nova nas Fases 2–3 (tw-animate-css + CSS + Radix); `Motion` adiado como
   decisão condicional da Fase 5 — **aprovado**.
2. Mecanismo de fonte única TS→CSS (TS primário, gerador sem dependência nova, `motion.css`
   versionado, drift test em vitest) — **aprovado**.
3. Piloto da Fase 3: **fluxo de Revisão** (`Revisao.tsx` + `familia-row` + `familia-expanded`) —
   **aprovado**, não a alternativa de importação.
4. Tabela estado-visual→evento-real da seção 11 do relatório como limite do que pode ser animado
   como progresso real (subetapas de ingest e de publicação sem sinal ficam indeterminadas) —
   **aprovado**.
5. Método de baseline de performance (rotas `#/revisao/:loteId` etc., dataset ≥20 famílias/≥60
   variações, CPU 4×, métricas long tasks/INP/CLS/FPS, 3 amostras/mediana) — **aprovado** como
   método oficial das Fases 3–5.
6. Manter o bloco global `prefers-reduced-motion` como rede de segurança (hipótese verificada:
   não quebra feedback funcional hoje), com fallback explícito por token nas animações novas —
   **aprovado**.
7. Sincronizar a branch com a `main` (2 commits, `docs/TASKS.md` +
   `src/components/dashboard-publicados.tsx`) antes da Fase 2 — **aprovado e executado**
   (merge sem conflito, commit de merge na branch).
8. Allowlist da Fase 2 (`src/motion/*` novos, `src/index.css`, `src/pages/StyleGuide.tsx`) —
   **aprovado**.

**SHA no fim do GATE:** commit de merge (sync com main) na branch `feat/motion-design-system`,
antes de despachar a Fase 2. **Pendências carregadas para a Fase 2/3:** ADR sobre o mecanismo de
geração TS→CSS (o Diego ainda não respondeu se quer o ADR mesmo sem lib nova — Claude vai propor
no relatório da Fase 2 e perguntar de novo no GATE 2, já que não foi uma das 8 perguntas
respondidas diretamente).

**Próxima fase autorizada:** Fase 2 — Fundação, mesma sessão Fable 5 (retomada via SendMessage).

## Mudança de modo de aprovação (2026-07-18)

Diego avisou que ficará ausente do computador e instruiu: seguir sempre a opção recomendada em
cada GATE daqui em diante até finalizar o que foi pedido, testando e validando tudo antes de
devolver a ele. **Isso não suspende o GATE 3.** O próprio contrato define GATE 3 como aprovação
humana de qualidade visual subjetiva ("testes automatizados não aprovam qualidade subjetiva de
motion") — a opção "recomendada" nesse GATE específico é justamente reservá-lo para o Diego, não
autoaprová-lo. Confirmado com o advisor antes de prosseguir. Consequência prática: Claude segue
autoaprovando GATEs objetivos/mecânicos (como o 2) com a opção recomendada, documentando aqui, mas
**para no fim da Fase 3 (piloto)** com um pacote de evidência (testes + QA visual/temporal via
automação de navegador) para o sign-off humano do GATE 3 — não avança para Fase 4/5 sozinho.

## GATE 2 — Fase 2 (Fundação) — aprovado (opção recomendada, autoaprovado)

**Data:** 2026-07-18. Respostas (opção recomendada em todas, conforme instrução acima):
1. Fundação aprovada sem checagem visual síncrona agora — testes (1595 aprovados, incluindo drift
   test novo), lint e build ok; `/style-guide` fica disponível pra conferência posterior.
2. ADR: **sim** — `docs/decisions/0079-fonte-unica-tokens-motion-ts-css.md` criado e commitado
   (`956a217`), com entrada em `obsidian-vault/04-Decisões/Índice de ADRs.md`.
3. Allowlist da Fase 3 confirmado: `src/pages/Revisao.tsx`, `src/components/familia-row.tsx`,
   `src/components/familia-expanded.tsx` (+ `painel-analise.tsx` só se necessário, a reportar).

**Próxima fase autorizada:** Fase 3 — Piloto (Revisão), mesma sessão Fable 5. **GATE 3 permanece
reservado para aprovação humana do Diego** — Claude prepara o pacote de evidência e para ali.

## Fase 3 concluída — GATE 3 aberto, aguardando Diego

**Data:** 2026-07-18. Commit `fb266d7` (`feat(motion): fase 3 - piloto no fluxo de revisão`),
exatamente o allowlist do GATE 2. Relatório completo do Fable 5 recebido; Claude revisou o diff
independentemente (spot-check dos 3 arquivos) e confirma que bate com o relatório — sem valor
mágico, sem mudança de regra de negócio/dado/navegação.

**Pacote de evidência objetiva reunido por Claude:**
- Suíte completa: 1595 testes aprovados (inclui drift test + smoke estrutural do Collapsible,
  removido antes do commit por estar fora do allowlist).
- Lint/build limpos; bundle: Revisão +0,99 kB gzip, CSS +0,2 kB gzip — sem lib nova.
- Diff revisado linha a linha por Claude — consistente com o relatório da Fase 3.

**O que NÃO foi possível capturar:** evidência temporal/visual ao vivo (roteiro de 7 interações
da seção 9 do relatório da Fase 3). Motivo: sem sessão autenticada disponível — Docker não está
rodando (sem Supabase local), sem credencial de teste para o Supabase de produção, e a sessão já
logada do Diego no Chrome é do site de **produção** (origem diferente de `localhost`, não
transferível). Claude decidiu **não** iniciar o Docker Desktop nem tentar contornar login sem
autorização — fora do escopo de uma captura de evidência. Isso não bloqueia o GATE 3 em si: a
aprovação de qualidade visual subjetiva sempre exigiria o olhar do Diego ao vivo, mesmo com
evidência pré-capturada; só significa que o pacote entregue é testes objetivos + revisão de
código, sem vídeo/screenshot.

**Como o Diego roda o QA temporal quando voltar (~10-15min):** no worktree
`.claude/worktrees/feat+motion-design-system` (branch `feat/motion-design-system`, `.env.local`
já copiado), `pnpm dev`, login normal, abrir lote real em `#/revisao/:loteId`, seguir o roteiro de
7 interações da seção 9 do relatório da Fase 3 (entrada única, expansão + interrupção, foco em
crítica, seleção, publicação, reduced-motion, screenshots). Perguntas objetivas do GATE 3 (seção
12 do relatório) também aguardam resposta dele.

**Nenhuma fase seguinte (4/5) foi despachada.** Parado aqui, conforme combinado com o Diego antes
de ele ficar ausente.

## Evidência temporal/visual coletada (2026-07-18, Diego de volta)

Diego voltou e autorizou testar com o próprio Chrome (`agent-browser --profile Default`, sessão
já autenticada). QA ao vivo no lote real #35 (7 famílias), `pnpm dev` no worktree, commit `fb266d7`.

- **Entrada única:** confirmada visualmente (screenshot dark+light).
- **Expansão + interrupção (5 cliques rápidos):** estado final limpo, sem duplicação de conteúdo
  (`get count` do texto interno = 0 no estado fechado), sem erro no console.
- **Foco em crítica:** clicar no selo "📷 1 sem foto" rolou até a família certa e expandiu, com
  destaque na borda esquerda.
- **Seleção:** barra de ação entrou só na 1ª seleção; ao desmarcar, sumiu imediatamente
  (`get count` = 0 logo após o clique).
- **Diálogo de publicação:** abriu corretamente; **cancelado sem confirmar** — Claude decidiu não
  publicar de verdade um anúncio real do Mercado Livre como parte do teste (fora do escopo de uma
  verificação de UI).
- **Reduced-motion (`set media reduced-motion`):** confirmado via `eval` que os elementos com
  classes `motion-safe:*` ficam com `animationName: none` e opacidade 1 imediata; expansão abre
  instantânea (screenshot). O bloco global de segurança (`transition-duration` ~0) segue ativo.
- **Tema claro:** verificado, sem quebra visual.
- **Achado novo (pré-existente, fora do escopo do piloto):** warning de console "Function
  components cannot be given refs" + "Missing Description/aria-describedby" no `DialogOverlay`
  (`src/components/ui/dialog.tsx`), disparado ao abrir o diálogo de publicação. Não introduzido
  por este piloto (arquivo não tocado pelo commit `fb266d7`) — registrado como erro preexistente,
  não corrigido (fora de escopo).

Screenshots salvos em `/Users/diego/.claude/jobs/ba6d74c9/tmp/gate3-*.png` (fora do repo, não
commitados).

**GATE 3 aguarda a resposta subjetiva do Diego às 5 perguntas do relatório da Fase 3** — evidência
objetiva/estrutural pronta, mas a aprovação de qualidade continua sendo dele.

## GATE 3 — Fase 3 (Piloto) — aprovado

**Data:** 2026-07-18. **Decisão do Diego:** "aprovo tudo como está, segue pra fase 4" — aprovação
integral, sem ressalva, às 5 perguntas do relatório da Fase 3 (acabamento de
expansão/entrada/seleção, chevron/fundo de linha selecionada, `role="status"` na contagem de
seleção mantido como está, smoke test do Collapsible aprovado como arquivo permanente, sem
regressão de performance reportada).

**Pendência fechada por essa aprovação:** adicionar `tests/` do Collapsible como cobertura
permanente — Claude vai pedir ao Fable 5 (mesma sessão, ainda dentro do bloco 1–3) pra recriar o
arquivo antes de fechar a Fase 3 de vez, já que ele escreveu a versão temporária e sabe exatamente
o que cobrir.

**Próxima fase autorizada:** Fase 4 — Validação, **Sonnet 5 ("executor")**, primeira vez trocando
de agente nesta iniciativa — dossiê de handoff completo (este ledger inteiro) será passado no
despacho, conforme o guardrail de continuidade do `PLAN.md`. Lembrete que vai junto: qualquer
achado da Fase 4 que exija mudar tokens/primitivas/decisão de fundação ou piloto reabre o escopo
com o Fable 5 (mesma sessão) e um GATE novo — Sonnet não corrige arquitetura aprovada sozinho.

## Fase 4 (Validação) — resultado, GATE 4 ainda NÃO decidido

**Data:** 2026-07-18. Sonnet 5 executou a Fase 4 (consistência, acessibilidade — teclado/toque/
reduced-motion, regressões, estados extremos, listas grandes, console, bundle). **Nenhum arquivo
alterado** — zero achado exigiu correção ou reabertura de escopo com Fable 5. Suíte completa:
1596 testes aprovados, lint 0 erros (8 warnings pré-existentes), build limpo. Bundle idêntico ao
aprovado no GATE 3 (nada mudou). QA ao vivo reconfirmada (teclado, interrupção, crítica, estado
vazio, mobile 390×844, reduced-motion) sem problema novo.

**Incidente operacional (sem impacto em código/dado):** ao encerrar, o Sonnet rodou `pkill -f
"vite"` pra derrubar o próprio `pnpm dev` e acabou matando **todos** os processos Vite da máquina
— incluindo o `pnpm dev` que Claude tinha subido na porta 5173 pro QA do GATE 3 (explica a
notificação "pnpm dev completed exit code 0" recebida antes da Fase 4 terminar). Nenhum arquivo
ou commit afetado; só precisa subir `pnpm dev` de novo se for usar.

**Por que o GATE 4 NÃO está marcado como aprovado aqui:** a aprovação do GATE 4 no contrato
(seção 17) É a liberação para a Fase 5 — e a Fase 5 é a expansão em lotes por todo o app (5A-5E),
o maior raio de alteração desta iniciativa, com GATE próprio por lote exigido pelo próprio
contrato ("nunca mais de um domínio funcional por lote sem aprovação"). A autorização "siga sempre
o recomendado" foi dada explicitamente condicionada à ausência do Diego ("estarei ausente...") —
ele já voltou e está respondendo a cada turno, então essa autorização não se estende
automaticamente a decidir começar o rollout de app inteiro. Registrando os FATOS da validação
aqui; a DECISÃO de liberar a Fase 5 (e como subdividir o lote 5A) fica para o Diego.

## GATE 4 — aprovado (decisão do Diego, presente)

**Data:** 2026-07-18. Diego respondeu diretamente (não via "siga o recomendado" — ele está
presente e decidindo turno a turno):
1. Aceita não remedir performance formalmente na Fase 4 (zero código mudou desde o GATE 3).
2. **Libera a Fase 5**, começando pelo **lote 5A subdividido** — primeiro sub-lote:
   **feedback/overlays**. Segundo sub-lote (navegação/formulário: tabs, botões, inputs,
   navegação) fica para depois, com GATE próprio.

**Escopo do sub-lote 5A-1 (Feedback/Overlays), definido por Claude a partir da lista da seção 17
do contrato ("modal, drawer, toast, tooltip, accordion"):** `src/components/ui/dialog.tsx`,
`src/components/ui/alert-dialog.tsx` (modal), `src/components/ui/sheet.tsx` (drawer),
`src/components/ui/sonner.tsx` (toast), `src/components/ui/tooltip.tsx`. **Accordion: não existe
componente próprio no codebase hoje** (grep por "Accordion" em `src/` = 0 resultados) — fora de
escopo, nada a fazer. `popover.tsx`, `dropdown-menu.tsx`, `select.tsx` **não estão na lista 5A do
contrato** — propositalmente fora deste sub-lote, não tocar.

**Próxima fase autorizada:** Fase 5A-1 (Feedback/Overlays), Sonnet 5, mesma sessão retomada
(bloco Fases 4-5).

## Sub-lote 5A-1 (Feedback/Overlays) — aprovado

**Data:** 2026-07-18. Commit `3734bae` (`feat(motion): fase 5a-1 - feedback e overlays globais`,
3 arquivos: `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx` — só `duration-100` mágico tokenizado
para `duration-(--motion-duration-instant)`, valor idêntico, zero mudança de comportamento).
`tooltip.tsx`/`sonner.tsx` sem valor mágico, não tocados. 1596 testes ok.

**Decisão do Diego** (presente, respondendo direto) às 3 perguntas do relatório:
1. `SheetContent` (200ms/`ease-in-out`, sem token exato): **mantém como está** — não migrar para
   `overlay`/`enter`+`exit`. Risco zero preferido a mudança perceptível no drawer mobile.
2. **Autoriza o fix pontual de acessibilidade** em `DetalheVendas.tsx` (tooltip de "Taxas" sem
   `tabIndex`, não navegável por teclado) — fora do escopo de motion, mas autorizado agora.
3. **Segue pro próximo sub-lote de 5A**: navegação/tabs/botões/inputs.

**Próxima fase autorizada:** (a) fix de acessibilidade em `DetalheVendas.tsx` (commit separado,
não é `feat(motion)`); (b) sub-lote 5A-2 (Navegação/Formulário) — escopo proposto por Claude:
`src/components/ui/tabs.tsx`, `src/components/ui/button.tsx`, `src/components/ui/input.tsx`,
`src/components/sidebar.tsx` (navegação lateral). Sonnet 5, mesma sessão.

## Fix a11y DetalheVendas — commitado

Commit `9dc31f7` (`fix(a11y): tooltip de taxas navegável por teclado em DetalheVendas`) —
`<span>` → `<button type="button">` no trigger do tooltip. Testes/lint/build ok, layout visual
idêntico.

## Sub-lote 5A-2 (Navegação e Formulário) — resultado, GATE aguardando decisão

**Data:** 2026-07-18. Sonnet 5 auditou `tabs.tsx`, `button.tsx`, `input.tsx`, `sidebar.tsx` —
**nenhum valor mágico de duration/easing encontrado** (diferente do 5A-1: aqui os `transition-*`
não têm número explícito, dependem do default do Tailwind). **Nenhum arquivo alterado.**

**2 achados de acessibilidade fora do escopo de motion, não corrigidos:**
1. `sidebar.tsx`: `NavLink` sem `focus-visible:ring-*` — foco por teclado invisível no menu
   lateral. Fix trivial, mesmo padrão do fix de `DetalheVendas.tsx`.
2. `button.tsx`: usa `translateY(1px)` no active em vez do `scale ≈ distance.pressScale` que o
   contrato recomenda (§7) — divergência de padrão pré-existente (repaginação premium, Tarefa 1),
   não um "valor mágico perdido". E o `disabled` só usa `opacity-50` (contrato pede reforço além
   de opacity) — redesenho visual, não tokenização.

Testes/lint/build inalterados (baseline).

**Decisão do Diego** às 3 perguntas:
1. **Autoriza o fix de `focus-visible`** em `sidebar.tsx` (mesmo padrão do fix de
   `DetalheVendas.tsx`).
2. Os 2 achados de `button.tsx` (translateY vs `pressScale`, disabled só com opacity) **ficam só
   documentados** — sem lote dedicado por ora.
3. **Pula o resto de 5A e segue pro 5B.** (Nota: 5A na prática já está coberto — modal/drawer/
   toast/tooltip no 5A-1, tabs/botões/inputs/navegação no 5A-2, accordion não existe no
   codebase — não há "resto" de 5A pendente, a decisão de pular equivale a considerá-lo completo.)

**Próxima fase autorizada:** (a) fix de `focus-visible` em `sidebar.tsx` (commit `fix(a11y)`
separado); (b) **Fase 5B — Importação e catálogo** (upload, parsing, validação, lotes, famílias,
produtos, variações). Escopo proposto por Claude: `src/pages/Lotes.tsx`, `src/pages/Progresso.tsx`,
`src/components/dropzone.tsx`, `src/components/jornada-lote.tsx`, `src/components/stepper.tsx`.
Sonnet 5, mesma sessão (bloco Fase 5).

## Sessão do Sonnet expirou — retomada com dossiê completo

A sessão anterior (Fase 4, 5A-1, 5A-2) não pôde ser retomada via `SendMessage` (transcript não
encontrado) — fallback do guardrail de continuidade aplicado: novo agente Sonnet 5, dossiê
completo (contrato + PLAN.md + este ledger inteiro) passado via prompt, conforme previsto no
`PLAN.md` para o caso de a sessão original não estar disponível.

## Fix a11y sidebar — commitado

Commit `80152d3` (`fix(a11y): indicador de foco no NavLink da navegação lateral`).
Testes/lint/build ok.

## Fase 5B (Importação e catálogo) — resultado, GATE aguardando decisão

**Data:** 2026-07-18. Commit `b3b26d7` (`feat(motion): fase 5b - importacao e catalogo`):
`jornada-lote.tsx` (círculo/rótulo/conector ganharam transição tokenizada), `dropzone.tsx`
(hover tokenizado), `Lotes.tsx` (4 estados de validação de planilha + progresso de upload +
bloco de erro ganharam entrada tokenizada), `Progresso.tsx` (bloco de anomalias ganhou entrada
tokenizada). Todos os padrões replicados do piloto já aprovado (mesmas classes de
`familia-expanded.tsx`/`familia-row.tsx`), nenhum valor novo. 1596 testes ok, lint/build limpos.
Bundle: +0,07 kB gzip no chunk `Lotes`.

**Nota do próprio Sonnet:** a auditoria inicial concluiu "zero valor mágico = zero mudança" (como
em 5A-2), mas o Sonnet usou o `advisor` e se autocorrigiu — o fluxo de importação nunca tinha
passado por tratamento de motion nenhum (diferente de 5A-2, onde os primitivos já vinham
tratados pela repaginação premium), então a tarefa certa era aplicar os padrões do piloto aos
pontos de mudança de estado real, não só caçar número solto.

**Risco documentado (não é achado novo, é atenção):** `jornada-lote.tsx` é usado também pelo
`Revisao.tsx` (piloto já aprovado no GATE 3) — mudança é só tokenização de transição já
existente/adicionada onde faltava, mesmo risco/escopo do que 5A-1 fez em `dialog.tsx`.

**3 perguntas do relatório:**
1. `stepper.tsx` (zero uso confirmado no codebase) — deletar numa limpeza futura, ou deixar?
2. QA visual ao vivo do 5B (upload real, Diego presente) agora, ou aceitar testes+lint+build como
   suficiente, igual 5A-1/5A-2?
3. Segue para 5C (Revisão e validação) ou pausa?

**Decisão do Diego:** deixa `stepper.tsx` como está (não deletar); roda QA visual agora; segue
pro 5C.

**QA visual ao vivo (Claude, via agent-browser, Chrome autenticado):**
- `Lotes.tsx`: jornada do lote (`JornadaLote`) renderiza igual a antes, sem regressão visual.
- Dropzone: `getComputedStyle` confirma `transition-colors duration-(--motion-duration-micro)
  ease-reversible` computado como `0.15s` / `cubic-bezier(0.45, 0, 0.55, 1)` — exatamente o
  token, sem valor perdido na tradução Tailwind→CSS.
- Círculos da `JornadaLote`: confirmado `0.19s` / `cubic-bezier(0.45, 0, 0.55, 1)` — token
  `state`/`reversible` exato.
- Reduced-motion: reconfirmado — duração cai para ~0 nos círculos da jornada também.
- Console limpo em toda a navegação (Lotes → Revisão).
- **Não testado ao vivo:** os 4 estados de validação de planilha e o bloco de anomalias de
  `Progresso.tsx`/`Lotes.tsx` — exigiriam upload real de uma planilha (criaria lote real,
  consumiria enriquecimento por IA) ou um lote em processamento agora; mesma cautela de não
  publicar de verdade aplicada aqui — não fiz upload de teste. Classes replicam exatamente o
  padrão já validado no piloto (`familia-expanded.tsx`), risco residual baixo.

**Próxima fase autorizada:** Fase 5C — Revisão e validação, Sonnet 5 (mesma sessão se disponível,
senão nova com dossiê completo).

## Fase 5C (Revisão e validação) — resultado, GATE aguardando decisão

**Data:** 2026-07-18. Sessão do Sonnet ainda estava disponível (retomada com sucesso). Commit
`3c29fab`: `painel-analise.tsx` (alertas de preço abaixo do mínimo e sem dimensões ganharam
entrada tokenizada), `viabilidade-linha.tsx` (detalhe expansível), e **`card-categoria.tsx`**
— adicionado pelo próprio Sonnet além do escopo nomeado (categoria indefinida, categoria
genérica, atributos faltantes — bloqueios reais de publicação, renderizado ao lado do painel de
análise na mesma família expandida). Nenhuma função de cálculo tocada, só `className`. 1596
testes ok, lint/build limpos. Bundle: +0,04/+0,05/+0,01 kB gzip nos 3 chunks afetados.

**Nota do próprio Sonnet:** primeira leitura foi conservadora demais (deixar `card-categoria.tsx`
só documentado por sensibilidade financeira) — usou `advisor`, recalibrou: a cautela pedida era
sobre lógica de cálculo, não sobre motion visual; deixar de fora criaria inconsistência entre
dois alertas irmãos no mesmo painel.

**2 perguntas do relatório:**
1. `config-grupos-preco.tsx`/`editor-atributos-faltantes.tsx` (ramo secundário, não animados) —
   incluir num 5C-2, ou deixar de fora da iniciativa?
2. Segue para 5D (Publicação e sincronização) ou pausa?

**Decisão do Diego:** deixa `config-grupos-preco.tsx`/`editor-atributos-faltantes.tsx` de fora
da iniciativa (sem 5C-2); segue pro 5D.

**Próxima fase autorizada:** Fase 5D — Publicação e sincronização. Escopo proposto por Claude:
`src/pages/Publicados.tsx`, `src/components/dashboard-publicados.tsx`,
`src/components/status-badge.tsx`, `src/components/status-inline.tsx`,
`src/components/canal-badge.tsx`. Sonnet 5, mesma sessão se disponível.

## Fase 5D (Publicação e sincronização) — resultado, GATE aguardando decisão

**Data:** 2026-07-18. Commit `8c252b9`: `Publicados.tsx` (chevron de linha + 4 alertas reais —
sem credencial ML, moderados, erro ao remover/pausar — ganharam entrada tokenizada),
`dashboard-publicados.tsx` (banner de erro + 3 cards com `duration-200` mágico corrigido para
`duration-(--motion-duration-state)`, não `micro` — o Sonnet errou pra `micro` na 1ª tentativa,
`advisor` corrigiu: 200ms cai na faixa `state` do contrato, não `micro`). `status-badge.tsx`/
`canal-badge.tsx` (escopo nomeado): **zero alteração** — wrappers finos sem CSS próprio.
`status-inline.tsx` excluído do escopo pelo próprio Sonnet (pertence a 5A/5C, não a 5D — já
existe sem motion dentro do piloto aprovado, decisão implícita já tomada no GATE 3). Confirmado:
nenhum estado sintético de fila/sincronização existe nos arquivos do escopo (a Fase 1 tinha
citado subetapas "na fila→enviando→confirmando" que na prática só existem como texto estático em
`Revisao.tsx`, já coberto pelo piloto). 1596 testes ok.

**Achado novo:** `status-pill.tsx` (átomo compartilhado por trás de `StatusBadge`, fan-in altíssimo)
não tem transição de cor própria — nenhum lote até agora cobriu isso por causa do fan-in.

**2 perguntas do relatório:**
1. `status-pill.tsx` — vale um lote/GATE dedicado só pra essa transição (fan-in muito alto), ou
   fica fora da iniciativa como está?
2. Segue para 5E ou pausa?

**Decisão do Diego (combinando com as perguntas gerais de status feitas fora do fluxo por
lote):**
1. `status-pill.tsx` **fica fora** da iniciativa — sem lote dedicado.
2. **Resolve agora** a pendência do `aria-describedby` (críticas de variação → campos do
   `VariacaoCard`, adiada desde a Fase 3, esquecida no escopo do 5C).
3. **Segue pro 5E.**
4. **Documentação da camada `motion/` + `docs/explanation/arquitetura.md`/`obsidian-vault`:
   depois do 5E**, não bloqueante agora.

**Próxima fase autorizada:** (a) fix `aria-describedby` em `VariacaoCard.tsx`/
`familia-expanded.tsx` (commit `fix(a11y)` separado); (b) **Fase 5E — Demais áreas** (financeiro,
pós-venda, configurações, administrativas, secundárias) — lote potencialmente grande, Sonnet
deve avaliar subdividir. Sonnet 5, mesma sessão se disponível.

## Fix a11y aria-describedby — commitado

Commit `2a3825c` (`fix(a11y): liga críticas de variação aos campos via aria-describedby`) —
`id="criticas-${codigo}"` em `familia-expanded.tsx` ligado seletivamente (por tipo de crítica:
sem cor→input de cor, sem foto→botão de trocar foto, sem preço→input de preço) aos campos em
`variacao-card.tsx`/`botao-trocar-foto.tsx`. Testes/lint/build ok. Pendência da Fase 3 fechada.

## Fase 5E (Demais áreas) — resultado, GATE aguardando decisão final

**Data:** 2026-07-18. **Último lote nomeado do contrato.** Subdividido pelo próprio Sonnet:
- **5E-1 (Financeiro e pós-venda)** — commit `9384674`: banners de erro reais em `Financeiro.tsx`,
  `DetalheFinanceiro.tsx` (+ accordion de detalhe de pedido, `ease-reversible`), `DetalheVendas.tsx`,
  `Viabilidade.tsx`; `duration-200` mágico corrigido em `aba-vendas.tsx` (mesmo fix do 5D).
- **5E-2 (Dashboard e Canais)** — commit `2adb865`: banner de erro + bloco "Precisa de atenção"
  em `Dashboard.tsx`; 4 banners reais (conexão ML, erros) em `Canais.tsx`.
- **`Configurações`, `Usuários`, `Organizações`: auditados, zero alteração** — nada a tokenizar,
  não forçado (nenhum valor mágico, nenhum banner condicional).
- Nenhuma função de cálculo tocada em todo o lote (confirmado arquivo por arquivo:
  `calcularResumo`, `custoDaVenda`, `custoDoItem`, resolvers de alíquota intactos). Nenhum texto
  de erro tocado menciona `custo_centavos`/`custo` — guardrail financeiro sem violação.
- 1596 testes ok em 3 rodadas (a11y, 5E-1, 5E-2).

**Pergunta única do relatório:** confirma que a Fase 5 (Expansão) está completa — este era o
último lote nomeado da seção 17 do contrato? Resta só a documentação da camada `motion/`
(explicitamente adiada, não é tarefa do Sonnet).

**Todos os lotes nomeados do contrato (5A–5E) estão agora fechados e commitados.** Falta:
documentação da camada `motion/` + atualização de `docs/explanation/arquitetura.md`/
`obsidian-vault` (regra do `CLAUDE.md`) + `docs/TASKS.md` — nenhum é tarefa do Sonnet, ficam para
Claude (orquestrador) ou Fable 5, a decidir com o Diego.
