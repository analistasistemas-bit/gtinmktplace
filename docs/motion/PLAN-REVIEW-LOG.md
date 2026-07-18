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
