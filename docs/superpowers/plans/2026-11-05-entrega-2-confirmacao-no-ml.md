# Entrega 2 — Confirmação no ML e aviso na tela Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depois de cada atualização, o sistema relê o ML, compara com o valor enviado e mostra o resultado no Progresso e no relatório do lote; falha também avisa no sino e no Telegram.

**Architecture:** O worker grava por item o que enviou (`confirmacoes_ml`) e agenda um job QStash com atraso (`confirmar-publicacao-ml`, fora da fila serial). O job só lê: compara observado com enviado mais movimentos do ledger, relê com atraso crescente e fecha em `confirmado`, `falhou` ou `inconclusivo`. O front lê a tabela por RLS.

**Tech Stack:** Deno edge functions, Postgres + RLS, QStash `publishJSON` com `delay`, React + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-confirmacao-ml-e-divisao-por-estoque-design.md` (Entrega 2)

## Global Constraints

- A conferência nunca escreve no ML nem reenvia estoque.
- Compara com o valor **enviado** (depois do teto), nunca com o saldo do banco.
- Falha ao registrar ou agendar a conferência nunca derruba a publicação: `console.error` e segue. Linha sem job vira inconclusiva na tela pelo teto de 20 min; família `publicado` sem linha, em lote que tem linhas, aparece como "sem conferência".
- Regra de veredito por SKU (revisão do Codex): `observado === anterior` e `anterior !== enviado` é **escrita não aplicada**, divergente mesmo com movimento no ledger. Fora disso, ok se `observado === enviado` ou `observado === enviado + movimentos`.
- `falhou` só com divergência sem movimento do SKU na janela, ou com escrita não aplicada. Divergência com movimento na janela, ao esgotar as leituras, é `inconclusivo` (webhook atrasado).
- `enviado_em` é capturado **antes** do PUT e é a versão da escrita. Janela de movimentos: `criado_em >= enviado_em - 5 min`.
- Escrita mais nova no mesmo item fecha a confirmação antiga como `inconclusivo`.
- Estados exatos: `aguardando`, `confirmado`, `inconclusivo`, `falhou`.
- Releituras: atraso inicial 60 s, depois 180 s e 600 s. Total de 3 leituras.
- Migration só por `supabase migration new` + `supabase db push`; validar com `npm run db:check`.
- RLS por `org_id`; escrita só por service role.
- `confirmar-publicacao-ml` com `verify_jwt = false` no `config.toml`, assinatura QStash validada.
- Dropdown, se surgir, é `ui/select`. Sem cor neutra fora do padrão do sistema.

## Review Focus

1. Venda no ML entre o envio e a leitura: não pode virar falha. Teste na Task 2.
2. Entrada ou ajuste no app depois do envio, com push ainda em voo: primeira leitura diverge, releitura fecha. Teste na Task 2.
3. Saldo com teto: `enviado` é o valor cortado, sem falso alarme; aparece como aviso. Testes nas Tasks 2 e 3.
4. Reentrega do QStash do mesmo job: não duplica notificação nem reabre linha fechada. Teste na Task 4.
5. Lote antigo sem linhas na tabela: tela igual à de hoje, sem resumo vazio. Teste na Task 5.

---

### Task 1: Tabela `confirmacoes_ml`

**Files:**
- Create: `supabase/migrations/<timestamp>_adr195_confirmacoes_ml.sql` (via `supabase migration new adr195_confirmacoes_ml`)
- Modify: `src/lib/database.types.ts`
- Modify: `docs/reference/modelo-de-dados.md`

**Interfaces:**
- Produces: tabela `public.confirmacoes_ml` com `id uuid pk`, `org_id uuid not null references organizations`, `lote_id uuid not null references lotes on delete cascade`, `familia_id uuid not null references familias on delete cascade`, `codigo_pai text not null`, `item_externo_id text not null`, `modelo text not null check in ('variacoes','item')`, `enviado jsonb not null` (`{sku: {qtd: number, anterior: number | null, variacao_id: string | null}}`), `observado jsonb`, `divergentes jsonb not null default '[]'` (`[{sku, enviado, observado}]`), `capados int not null default 0`, `status text not null default 'aguardando'` com check dos 4 estados, `tentativas int not null default 0`, `enviado_em timestamptz not null`, `verificado_em timestamptz`, `unique (familia_id, item_externo_id)`, índice em `(lote_id)`.

- [ ] **Step 1:** Criar a migration. RLS como em `20261104010745_sugestoes_promocao.sql`: `enable row level security`, policy `for select to authenticated using (org_id = (select public.current_org_id()))`, `revoke all ... from anon, authenticated`, `grant select ... to authenticated`.
- [ ] **Step 2:** `npm run db:check`. Expected: sem erro.
- [ ] **Step 3:** Provar em transação desfeita (`scripts/teste-sql-desfeito.py`): insert com status inválido falha; check e unique valem. Expected: `TESTE_OK`.
- [ ] **Step 4:** Atualizar `database.types.ts` e o modelo de dados. Commit.

### Task 2: Avaliação pura

**Files:**
- Create: `supabase/functions/_shared/confirmacao/avaliar.ts`
- Test: `supabase/functions/_shared/confirmacao/__tests__/avaliar.test.ts`

**Interfaces:**
- Produces:
  - `EnviadoSku = { qtd: number; anterior: number | null; variacao_id: string | null }`
  - `avaliarConfirmacao(a: { enviado: Record<string, EnviadoSku>; observado: Record<string, number | null>; movimentos: Record<string, number> }): { ok: boolean; naoAplicada: boolean; explicavelPorMovimento: boolean; divergentes: Array<{ sku: string; enviado: number; observado: number | null }> }`. `explicavelPorMovimento` = algum divergente tem movimento na janela.
  - `proximoPasso(a: { ok: boolean; naoAplicada: boolean; explicavelPorMovimento: boolean; leituraFalhou: boolean; tentativa: number }): { status: 'confirmado' | 'falhou' | 'inconclusivo' } | { reler: number }`
  - `export const ATRASOS_RELEITURA = [180, 600]`

- [ ] **Step 1: Testes.** Casos: igual → ok; venda (`enviado 10, movimentos -2, observado 8`) → ok; observado igual ao enviado com movimento ainda não refletido (`10, -2, 10`) → ok; entrada com push em voo (`10, +5, 10`) → ok; diferença sem explicação (`10, 0, 7`) → divergente; SKU sem leitura (`null`) → divergente; teto (`enviado 1164, movimentos -1, observado 1163`) → ok. Escrita ignorada com entrada no ledger (`qtd 10, anterior 15, movimentos +5, observado 15`) → divergente com `naoAplicada`. Sem mudança pedida (`qtd 10, anterior 10, observado 10`) → ok. `anterior` null não ativa `naoAplicada`. `proximoPasso`: ok → `confirmado`; divergente na tentativa 1 → `{reler:180}`, 2 → `{reler:600}`, 3 → `falhou`; na 3 com `explicavelPorMovimento` e sem `naoAplicada` → `inconclusivo`; leitura falhou na 3 → `inconclusivo`.
- [ ] **Step 2:** `pnpm exec vitest run supabase/functions/_shared/confirmacao`. Expected: FAIL.
- [ ] **Step 3:** Implementar. Regra por SKU nas Global Constraints.
- [ ] **Step 4:** Rodar. Expected: PASS. Commit.

### Task 3: Registrar o que foi enviado

**Files:**
- Create: `supabase/functions/_shared/confirmacao/registrar.ts`
- Modify: `supabase/functions/_shared/canais/contrato.ts:197-202` (`ResultadoAtualizacao`)
- Modify: `supabase/functions/_shared/canais/mercado-livre.ts` (`atualizarAnuncio`)
- Modify: `supabase/functions/_shared/queue.ts`
- Modify: `supabase/functions/_shared/user-products/atualizar-familia-up.ts`
- Modify: `supabase/functions/update-familia-ml/processar.ts`, `supabase/functions/publicar-split-ml/index.ts`
- Test: `supabase/functions/_shared/confirmacao/__tests__/registrar.test.ts`, `supabase/functions/update-familia-ml/__tests__/processar.test.ts`, teste do conector em `_shared/canais/__tests__/`

**Interfaces:**
- Produces:
  - `ResultadoAtualizacao.enviados?: Record<string, EnviadoSku>` (depois do teto, `anterior` e `variacao_id` do GET pré-PUT que o conector já faz; ausente em `preservarPublicadas`, que não escreve estoque).
  - `ItemConfirmar = { itemExternoId: string; modelo: 'variacoes' | 'item'; enviado: Record<string, EnviadoSku>; capados: number }`
  - `registrarConfirmacao(admin, a: { orgId: string; loteId: string; familiaId: string; codigoPai: string; enviadoEm: string; itens: ItemConfirmar[] }): Promise<void>`: um upsert em lote por `(familia_id, item_externo_id)` zerando `tentativas`, `observado`, `divergentes` e voltando a `aguardando`. Nunca lança.
  - `agendarConfirmacao(familiaId: string, enviadoEm: string): Promise<void>`: um agendamento por família. Nunca lança.
  - `enfileirarConfirmacao(job: ConfirmarJob, delaySeconds = 60): Promise<string>` em `queue.ts`, no molde de `enfileirarVinculacaoCatalogo`, alvo `confirmar-publicacao-ml`, `retries: 3`.
  - `ConfirmarJob = { familia_id: string; tentativa: number; versao: string }` (`versao` = `enviado_em`).
  - `ResultadoAtualizarUP` ok ganha `enviados?: ItemConfirmar[]`.

- [ ] **Step 1: Testes.** Conector: 3 cores com soma acima de 99.999 → `enviados` traz os valores cortados. Item plano → `enviados` com o SKU único. `preservarPublicadas` → sem `enviados`. Worker Legacy: `registrarConfirmacao` chamado com `modelo:'variacoes'`, `capados` = SKUs com `estoque` maior que o enviado. Worker UP: `modelo:'item'`, um item por filho ativo. Falha do registro não muda `{tipo:'ok'}`. `registrar`: upsert com `onConflict: 'familia_id,item_externo_id'`.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar. No Legacy e no split, `modelo='variacoes'` salvo item plano. No UP, montar `enviados` a partir dos filhos ativos e `estoquePorSku` depois de `sem_mudanca`/`concluido`. `enviadoEm` capturado antes da escrita. Split: `registrarConfirmacao` logo depois de cada partição escrita, para falha parcial não perder a conferência do que já foi; `agendarConfirmacao` uma vez, no fim ou no catch se alguma partição foi escrita. Fluxo "Adicionar variação" (`preservarPublicadas`) não registra.
- [ ] **Step 4:** Rodar `pnpm exec vitest run supabase/functions/update-familia-ml supabase/functions/_shared`. Expected: PASS. Commit.

### Task 4: Worker `confirmar-publicacao-ml`

**Files:**
- Create: `supabase/functions/confirmar-publicacao-ml/index.ts`, `processar.ts`
- Modify: `supabase/config.toml`, `supabase/functions/_shared/notificacoes/estoque.ts`, `docs/reference/edge-functions.md`
- Test: `supabase/functions/confirmar-publicacao-ml/__tests__/processar.test.ts`

**Interfaces:**
- Consumes: `avaliarConfirmacao`, `proximoPasso`, `enfileirarConfirmacao`, `notificarCategoria`, `resolverConexao`, `getValidAccessTokenConexao`.
- Create também: `supabase/functions/_shared/ml/ler-estoque-itens.ts` com `lerEstoqueItens(token: string, ids: string[]): Promise<Record<string, { total: number; porVariacao: Record<string, number> } | 'erro'>>`, via `caminhoMultiget` com `attributes` `id,available_quantity,variations` em blocos de 20. Não engole falha: HTTP não-ok do bloco ou `status_code` diferente de 200 marca os itens como `'erro'`. Casa variação por `variacao_id` (bulk não garante SKU).
- Produces: `processarConfirmacao(deps, job: ConfirmarJob): Promise<{ status: number; body: unknown }>`; `montarMensagemConfirmacaoFalhou(a: { produto: string | null; codigoPai: string; divergentes: Array<{ sku: string; enviado: number; observado: number | null }> }): string`.

- [ ] **Step 1: Testes.** Claim atômico: `update ... set tentativas = job.tentativa where familia_id, enviado_em = job.versao, status = 'aguardando', tentativas = job.tentativa - 1 returning *`; zero linhas → sai sem ler, sem agendar, sem notificar (cobre reentrega, entrega dupla e job antigo depois de upsert novo). Linha com escrita mais nova no mesmo `item_externo_id` e outra família → fecha `inconclusivo` sem ler. Igual → `confirmado` com `verificado_em`. Divergente tentativa 1 → continua `aguardando`, `tentativas=1`, agenda `(familia_id, 2, 180)`. Divergente na 3 → `falhou`, `divergentes` gravado, `notificarCategoria` com `'estoque'` e `{ chave: 'confirmacao-falhou:<familia_id>:<enviado_em>' }`. 429 na 3 → `inconclusivo`, sem notificação. Movimentos somam `criado_em >= enviado_em - 5 min`, por `org_id` e SKU. Escrita não aplicada na tentativa 3 → `falhou` mesmo com movimento. Nenhuma chamada de escrita ao conector.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar; `index.ts` é casca igual à de `sincronizar-estoque` (assinatura, parse, delega). Um job cobre todos os itens da família; a mensagem cita até 10 SKUs.
- [ ] **Step 4:** Rodar. Expected: PASS. Commit.

### Task 5: Tela

**Files:**
- Create: `src/hooks/useConfirmacoesMl.ts`, `src/components/lotes/resumo-confirmacao-ml.tsx`, `src/lib/confirmacao-ml.ts`
- Modify: `src/pages/Progresso.tsx`, `src/pages/Relatorio.tsx`
- Test: `src/lib/__tests__/confirmacao-ml.test.ts`, `src/components/lotes/__tests__/resumo-confirmacao-ml.test.tsx`

**Interfaces:**
- Produces:
  - `resumirConfirmacoes(linhas: ConfirmacaoMl[], familiasPublicadas: string[], agora: Date): { confirmadas: number; aguardando: number; inconclusivas: number; semConferencia: number; falhas: ConfirmacaoMl[]; capados: number }`, contando por família (pior status entre os itens). `aguardando` com `enviado_em` há mais de 20 minutos conta como inconclusiva (job perdido). `semConferencia` só se o lote tem alguma linha.
  - `useConfirmacoesMl(loteId)`: refetch a cada 5 s enquanto houver `aguardando` dentro do teto de 20 min, depois para.
  - `<ResumoConfirmacaoMl loteId={string} />`: renderiza nada sem linhas.

- [ ] **Step 1: Testes.** Lista vazia → não renderiza. 3 confirmadas e 1 falha → "3 confirmadas no Mercado Livre" e "1 com falha", tabela com SKU, Enviado, No ML. Capados → aviso informativo "N cor(es) limitadas pelo teto de 99.999", sem tom de erro. `aguardando` velho → inconclusiva.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar; usar no `Relatorio` logo abaixo do cabeçalho e no `Progresso` acima da lista. Falha em `text-destructive`, como o erro de família. Relatório deixa de truncar `erroMensagem`.
- [ ] **Step 4:** `pnpm exec vitest run src/lib src/components/lotes`. Expected: PASS. Commit.

### Task 6: Revisão, merge, deploy e validação real

- [ ] **Step 1:** Revisão do diff pelo Codex (`gpt-6.1-sol`, high, read-only, `< /dev/null`), rodada única; corrigir achados. `pnpm preflight:static`.
- [ ] **Step 2:** Push, CI verde, `supabase db push` com link no worktree, conferir a tabela, deploy das funções alteradas e das que importam `_shared` tocado, conferindo versão e `verify_jwt`.
- [ ] **Step 3:** Merge fast-forward; `git pull --ff-only` no checkout principal.
- [ ] **Step 4:** Validação de UI com print real (skill `playwright-cli`, sessão isolada) no próximo lote real. Sem lote real, validar só com testes de componente: dado injetado em produção exige prévia e ok das linhas (AGENTS.md). Expected: resumo aparece, teto informativo, falha legível.
- [ ] **Step 5:** Docs (`docs-update-checklist`), `docs/TASKS.md`, status.
