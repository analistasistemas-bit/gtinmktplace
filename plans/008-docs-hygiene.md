# Plan 008: Higiene de docs — índice de ADRs completo, stack correto e marcadores de staleness

> **Executor instructions**: Follow step by step. Run every verification command. If
> anything in "STOP conditions" occurs, stop and report. When done, update the status
> row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7222675..HEAD -- docs/README.md docs/ROADMAP.md docs/project-status.md docs/decisions/`
> Se algum mudou desde `7222675`, compare os excerpts abaixo com o atual; divergência = STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `7222675`, 2026-06-26

## Why this matters

`CLAUDE.md` manda ler `docs/README.md` como passo #1. Hoje esse índice está incompleto e
parcialmente errado, então quem segue a documentação é mal-informado logo na entrada:

1. **Índice de ADRs trunca em 0011** (árvore) e em 0028 (tabela "Onde encontrar o quê"). Faltam
   ADRs 0029–0043 — incluindo **todos os de dinheiro** (Faturamento, Financeiro, líquido econômico
   0042, PxQ atacado 0041, migrations canônicas 0043), que são o caminho de maior risco do projeto.
2. **Stack diz "IA: OpenAI GPT-4o-mini + OpenAI Vision"** (`docs/README.md:89`) — contradiz o
   ADR-0010 e o `CLAUDE.md` ("OpenRouter com modelos OpenAI").
3. **`ROADMAP.md` está congelado** ("última atualização 2026-05-29", M4 "Não iniciado") e lista
   features **já em produção** (análise de vendas, IA respondendo perguntas) como "fora do MVP".
   Ele se declara "documento vivo", então engana.
4. **`docs/project-status.md:15` afirma que `resumo-financeiro` / `lib/financeiro.ts` /
   `useResumoFinanceiro` foram "removidos"** — mas os três **ainda existem e estão em uso** (a tela
   Financeiro chama a edge `resumo-financeiro`). Afirmação factualmente errada.
5. **Dois pares de ADRs com número duplicado** (0035 e 0037). Isso é tratado como **decisão**
   abaixo (renumerar violaria a regra documentada "nunca renumerar"), não como edit automático.

## Current state

- `docs/README.md:23-33` — árvore lista ADRs só até `0011-redirect-uri-via-edge-function.md`.
- `docs/README.md:52-75` — tabela "Onde encontrar o quê"; última linha de ADR é `0028`.
- `docs/README.md:89` — `- **IA:** OpenAI GPT-4o-mini (copy) + OpenAI Vision (detecção de cor por foto)`
- `docs/README.md:85` — Stack frontend não menciona Zustand (usado no projeto, ver `CLAUDE.md`).
- `docs/ROADMAP.md:3` declara "Documento vivo"; header (~:5-6) diz última att 2026-05-29 / M4 em andamento.
- `docs/project-status.md:15` (trecho): "Caminho morto do MP ao vivo (`lib/financeiro.ts`,
  `useResumoFinanceiro`, edge `resumo-financeiro`) removido." → **FALSO**: `src/lib/financeiro.ts:42`
  chama a edge `resumo-financeiro`, `src/hooks/useResumoFinanceiro.ts` existe e a rota `/financeiro`
  os usa.
- `docs/decisions/README.md:44` — regra: "ADRs são numerados sequencialmente e **nunca são renumerados**."
- Pares duplicados: `docs/decisions/0035-cor-no-titulo-mono-cor.md` + `0035-monitoramento-anuncios-moderados.md`;
  `0037-modulo-faturamento-webhooks-ml.md` + `0037-vendas-catalogo-match-ean.md`.
- Lista real de ADRs em `docs/decisions/`: 0001–0043 (com os dois pares duplicados acima).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Listar ADRs | `ls docs/decisions/*.md` | confere os arquivos a indexar |
| Achar cross-refs | `grep -rn "ADR-0035\|ADR-0037" --include=*.ts --include=*.md .` | mapeia citações ambíguas |

## Scope

**In scope**:
- `docs/README.md` (reconstruir índice de ADRs + corrigir linha de Stack)
- `docs/ROADMAP.md` (adicionar banner de staleness no topo — NÃO reescrever o conteúdo)
- `docs/project-status.md` (corrigir a linha 15 sobre `resumo-financeiro`)

**Out of scope**:
- **NÃO renumerar nenhum ADR** (ver STOP conditions — é decisão do operador).
- NÃO editar o conteúdo interno de nenhum ADR.
- NÃO reescrever o corpo do ROADMAP (só banner no topo).

## Git workflow

- Worktree isolado. Commit, ex.: `docs: completa índice de ADRs, corrige stack IA e marca staleness (#008)`
- NÃO push/PR sem o operador pedir.

## Steps

### Step 1: Reconstruir o índice de ADRs em `docs/README.md`

Na tabela "Onde encontrar o quê" (ou numa nova subseção "ADRs (0001–0043)"), liste **todos** os ADRs
de `docs/decisions/`, um por linha, com link e título. Para os dois pares duplicados, liste as
**duas** entradas com o nome de arquivo completo, deixando claro que `0035` e `0037` colidem (ex.:
`ADR-0035 (cor-no-titulo-mono-cor)` e `ADR-0035 (monitoramento-anuncios-moderados)`).

Gere a lista a partir do diretório (não invente títulos):
```
node -e "const fs=require('fs');fs.readdirSync('docs/decisions').filter(f=>/^\d{4}.*\.md$/.test(f)).sort().forEach(f=>console.log('| '+f.replace('.md','')+' | [link](decisions/'+f+') |'))"
```

**Verify**: `grep -c "decisions/00\|decisions/01\|decisions/02\|decisions/03\|decisions/04" docs/README.md`
→ número ≥ 44 (todos os ADRs referenciados).

### Step 2: Corrigir a linha de Stack (IA) e Zustand

Em `docs/README.md:89`, troque a linha de IA para refletir o ADR-0010:
```
- **IA:** OpenRouter (gateway compatível com OpenAI SDK) com modelos OpenAI — GPT-4o-mini (copy) + GPT-4o Vision (detecção de cor) — ver ADR-0010
```
Em `:85`, acrescente Zustand à lista de frontend (`... + TanStack Query + Zustand`).

**Verify**: `grep -n "OpenRouter" docs/README.md` → mostra a linha; `grep -n "OpenAI GPT-4o-mini (copy)" docs/README.md` → vazio.

### Step 3: Banner de staleness no `ROADMAP.md`

Adicione, logo abaixo do título (antes do conteúdo), um bloco curto:
```
> ⚠️ **Documento estratégico, não operativo.** O estado real e atual do produto está em
> [project-status.md](project-status.md) e [TASKS.md](TASKS.md). Itens marcados aqui como
> "não iniciado" / "fora do MVP" podem já estar em produção (ex.: análise de vendas, IA
> respondendo perguntas no ML). Consulte `project-status.md` antes de usar este roadmap como
> fotografia do presente.
```

**Verify**: `head -15 docs/ROADMAP.md | grep -c "project-status"` → ≥ 1.

### Step 4: Corrigir a afirmação errada em `project-status.md`

Substitua o trecho da linha 15 que diz que `resumo-financeiro`/`lib/financeiro.ts`/
`useResumoFinanceiro` foram "removidos" por uma redação correta — eles **continuam em uso** pela tela
Financeiro (a edge `resumo-financeiro` lê do Mercado Pago para o caixa/A-receber). Mantenha o resto
da frase sobre o líquido econômico (ADR-0042) intacto.

**Verify**: `grep -n "removido" docs/project-status.md` → a linha sobre resumo-financeiro não diz mais "removido".

## Test plan

Sem testes de código. Verificação = os greps dos Steps 1–4 + leitura humana do diff.

## Done criteria

- [ ] `docs/README.md` referencia todos os ADRs 0001–0043 (Step 1).
- [ ] Linha de IA cita OpenRouter; não diz mais "OpenAI GPT-4o-mini (copy)" (Step 2).
- [ ] `ROADMAP.md` tem banner apontando para `project-status.md` (Step 3).
- [ ] `project-status.md` não afirma mais que `resumo-financeiro` foi removido (Step 4).
- [ ] **Nenhum ADR foi renumerado** (`ls docs/decisions/` inalterado).
- [ ] Linha de status atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte (não improvise) se:

- Você concluir que a forma correta de resolver a colisão `0035`/`0037` é **renumerar**. Renumerar
  viola a regra `docs/decisions/README.md:44` ("nunca renumerar") **e** exige um sweep das citações
  `ADR-0035`/`ADR-0037` em código (`supabase/functions/process-familia/index.ts:237`, runbooks) e na
  memória do projeto. É **decisão do operador** — reporte o trade-off e pare; não renumere por conta própria.
- A lista de ADRs gerada no Step 1 vier vazia ou com contagem muito diferente de ~44.

## Maintenance notes

- **Decisão pendente (operador)**: resolver a colisão de número 0035/0037 — renumerar os mais
  recentes para 0044/0045 (e varrer cross-refs) OU formalizar uma exceção à regra "nunca renumerar".
  Enquanto não decidido, o índice do Step 1 ao menos torna a colisão explícita.
- Idealmente o índice de ADRs do README seria gerado por script (evita re-truncar). Fica como melhoria.
- Revisor deve checar: nenhuma renumeração de ADR; a linha de IA agora bate com ADR-0010/CLAUDE.md.
