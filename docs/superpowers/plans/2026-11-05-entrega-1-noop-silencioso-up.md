# Entrega 1 — Fim do no-op silencioso em família UP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Família com filhos UP sem item no ML nunca mais termina `publicado`: vira erro visível, sem escrita no ML; e a Fita N.2 volta a receber estoque.

**Architecture:** Duas travas. Uma no roteamento de `update-familia-ml` (raiz com filhos e nenhum item real), outra em `atualizarComposicao` (em somente-estoque, filho não ativo ou zero alvos). Ambas geram `erro` em `familias`, que `Progresso` e `Relatorio` já exibem, e avisam pela categoria `estoque`. Depois, limpeza de dados em produção e reenvio pelo app.

**Tech Stack:** Deno edge functions (TS), Vitest, Supabase CLI, Management API só para leitura e para a limpeza autorizada.

**Spec:** `docs/superpowers/specs/2026-11-05-confirmacao-ml-e-divisao-por-estoque-design.md` (Entrega 1)

## Global Constraints

- Escrita no ML só pelo fluxo do app. Nenhum PUT manual.
- Nenhuma família termina `publicado` sem ter enviado o que foi pedido.
- Cor sem linha filha em somente-estoque segue ignorada enquanto houver alvo (ADR-0104 §4).
- Deploy: mudança em `_shared/` redeploya todas as funções afetadas, conferindo versão e `verify_jwt` (`update-familia-ml`, `reconciliar-convergencia-up` são `verify_jwt=false` no `supabase/config.toml`; reconferir o bloco de cada uma).
- Worktree: usar `/usr/bin/git` em comandos simples; copiar `.env.local` antes de subir dev.

## Review Focus

1. Família UP legítima em que parte dos filhos está ativa e parte `criado`/`criacao_incerta` por crash, em "Atualizar estoque": deve dar erro listando os SKUs, sem escrever nos ativos. Teste na Task 2.
2. `reconciliar-convergencia-up` chamando a saga: a trava não pode prender uma convergência que precisa retomar criação. Conferir se passa `somenteEstoque`; teste na Task 2.
3. Família com filhos todos `retirado`: não é criação pendente. Teste na Task 1.
4. Reentrega do QStash depois do erro: família já `erro` não reprocessa; aviso não repete (chave). Teste na Task 3.
5. Raiz sem filhos: segue Legacy como hoje (`processar.test.ts:278`). Teste existente, não pode quebrar.

---

### Task 1: ADR-0195 e trava de criação UP pendente no roteamento

**Files:**
- Create: `docs/decisions/0195-confirmacao-no-canal-e-divisao-por-estoque.md`
- Modify: `supabase/functions/update-familia-ml/processar.ts:238-246`
- Test: `supabase/functions/update-familia-ml/__tests__/processar.test.ts`

**Interfaces:**
- Produces: mensagem de erro de `familias.erro_mensagem` começando com `Criação em User Products pendente`.

- [ ] **Step 1: Escrever o ADR-0195**

Status proposto. Registra: `publicado` exige escrita real; confirmação no canal (Entrega 2); divisão por estoque com exceção à ancoragem do ADR-0048 (Entrega 3). Contexto com os números do lote #68. Atualizar `docs/decisions/README.md` e o índice em `obsidian-vault/04-Decisões/`. Conferir com `/usr/bin/git fetch origin main` que 0195 segue livre.

- [ ] **Step 2: Ajustar fixtures e escrever os testes**

Nos fixtures `itensUP: [{ id: 'it-1' }]` do arquivo, acrescentar `item_externo_id: 'MLB-IT1'` (o select passa a ler a coluna). Novos testes em `describe('processarAtualizacaoFamilia — roteamento UP vs Legacy')`:

```ts
it('raiz com filhos e nenhum item real → erro; nada no ML; nunca publicado', async () => {
  const { admin, writes } = fakeAdmin({
    raizUP: { id: 'root-1', titulo: 'T', criado_em: null },
    itensUP: [{ id: 'a', item_externo_id: null, retirado: false }, { id: 'b', item_externo_id: null, retirado: false }],
  });
  const r = await processarAtualizacaoFamilia(/* mesmo arranjo dos vizinhos, somenteEstoque: true */);
  expect(r.tipo).toBe('erro');
  // atualizarAnuncio e atualizarFamiliaUP não chamados
  // writes contém familias.status 'erro' com erro_mensagem começando 'Criação em User Products pendente'
  // writes não contém status 'publicado'
});
it('mesma raiz em "Atualizar tudo" (somenteEstoque false) → mesmo erro, zero criação', ...);
it('filhos todos retirados e sem item → segue o caminho UP de hoje, sem a trava', ...);
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test -- supabase/functions/update-familia-ml/__tests__/processar.test.ts`
Expected: os 2 primeiros FAIL (hoje vai para UP e termina `ok`).

- [ ] **Step 4: Implementar a trava**

Trocar o select de `.select('id').limit(1)` por `.select('id, item_externo_id, retirado')`, sem `limit`. Regra: `vivos = itens.filter(!retirado)`; se `vivos.length > 0` e nenhum tem `item_externo_id`, grava `familias.status='erro'` com `erro_mensagem`, chama `finalizarLote(job.lote_id)` e retorna `{ tipo: 'erro', mensagem }`. Caso contrário, mantém `rodarUP`. Texto fixo:

`Criação em User Products pendente: ${vivos.length} cor(es) sem anúncio no Mercado Livre. Nada foi enviado. Este produto precisa de correção manual antes de atualizar.`

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test -- supabase/functions/update-familia-ml/__tests__/processar.test.ts`
Expected: PASS, inclusive `processar.test.ts:278` (raiz sem filhos segue Legacy).

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add docs/decisions supabase/functions/update-familia-ml obsidian-vault/04-Decisões
/usr/bin/git commit -m "fix(update): trava criação UP pendente antes de escrever no ML (ADR-0195)"
```

### Task 2: Somente-estoque sem alvo vira erro na composição

**Files:**
- Modify: `supabase/functions/_shared/user-products/atualizar-composicao.ts:129-132,240-244`
- Modify: `supabase/functions/_shared/user-products/atualizar-familia-up.ts:660-670`
- Test: `supabase/functions/_shared/user-products/__tests__/atualizar-composicao.test.ts`

**Interfaces:**
- Produces: membro `{ tipo: 'erro'; codigo: 'reposicao_sem_item'; skus: string[] }` em `ResultadoComposicao`.

- [ ] **Step 1: Escrever os testes, em `describe('atualizarComposicao — somenteEstoque nunca muda composição')`**

```ts
it('regressão Fita: 77 filhos sem item → erro, zero PUT, nunca sem_mudanca', async () => {
  const skus = Array.from({ length: 77 }, (_, i) => `S${i}`);
  const seed = skus.map((sku) => ({ sku, status: 'pendente', retirado: false, itemExternoId: null, familyId: null }));
  const w = fakeMundo({ seed });
  const r = await atualizarComposicao(w.portas, entrada({
    skusDesejados: skus, estoquePorSku: Object.fromEntries(skus.map((s) => [s, 5])), somenteEstoque: true,
  }));
  expect(r).toMatchObject({ tipo: 'erro', codigo: 'reposicao_sem_item' });
  expect((r as { skus: string[] }).skus).toHaveLength(77);
  expect(w.chamadas.repor).toEqual([]);
  expect(w.chamadas.criarPlano).toEqual([]);
  expect(w.db.get('S0')).toMatchObject({ status: 'pendente' }); // reserva preservada
});
it('parcial: A ativo, B criacao_incerta → erro com [B], e A NÃO recebe PUT', ...);
it('zero linhas filhas para os SKUs desejados → erro, não sem_mudanca', ...);
it('cor NOVA sem linha filha com outra ativa → segue sem_mudanca (contrato ADR-0104 §4)', ...); // teste existente, não alterar
it('fora de somenteEstoque, filho pendente segue retomável (concluido)', ...);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- supabase/functions/_shared/user-products/__tests__/atualizar-composicao.test.ts`
Expected: FAIL nos 3 primeiros (`sem_mudanca` recebido).

- [ ] **Step 3: Implementar em `atualizarComposicao`, depois do laço de `BLOQUEIO_REATIVACAO`**

Só com `soRepor`: `naoProntos` = SKUs desejados com filho não retirado e sem (`status === 'ativo'` e `itemExternoId`). `temAlvo` = algum SKU desejado com filho ativo com item. Se `naoProntos.length > 0`, retorna erro com `naoProntos`. Se `!temAlvo && desejados.length > 0`, retorna erro com `desejados`. Antes de `reposicao`, portanto sem nenhum PUT.

- [ ] **Step 4: Conferir o reconciliador**

Ler `supabase/functions/reconciliar-convergencia-up/processar.ts:95-125`. Se passar `somenteEstoque: true`, parar e reavaliar a trava com o Review Focus 2. Se passar `false`, registrar no commit que não é afetado e somar teste de não regressão no arquivo dele.

- [ ] **Step 5: Traduzir o erro em `atualizar-familia-up.ts`**

Antes da cadeia de `resultado.codigo`, tratar `reposicao_sem_item`: `UPDATE bloqueado: ${n} cor(es) sem anúncio confirmado no Mercado Livre (${primeiros 10 SKUs}${n>10 ? '…' : ''}). Nada foi enviado.`, gravando `familias.status='erro'`. Mantém o tipo discriminado em membro próprio, como o comentário em `atualizar-composicao.ts:125-128` exige.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm test -- supabase/functions/_shared/user-products`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add supabase/functions/_shared/user-products supabase/functions/reconciliar-convergencia-up
/usr/bin/git commit -m "fix(up): somente-estoque sem filho ativo vira erro, nunca publicado (ADR-0195)"
```

### Task 3: Aviso no sino e Telegram

**Files:**
- Modify: `supabase/functions/_shared/notificacoes/estoque.ts`
- Modify: `supabase/functions/update-familia-ml/processar.ts`
- Modify: `supabase/functions/_shared/user-products/atualizar-familia-up.ts`
- Test: `supabase/functions/update-familia-ml/__tests__/processar.test.ts`, `supabase/functions/_shared/notificacoes/__tests__/` (arquivo do estoque, se houver)

**Interfaces:**
- Consumes: `notificarCategoria(admin, orgId, 'estoque', texto, { chave })` de `_shared/notificacoes/config.ts:108`.
- Produces: `montarMensagemFamiliaSemItem(a: { produto: string | null; codigoPai: string; qtdCores: number }): string`.

- [ ] **Step 1: Testes**

Em `processar.test.ts`, no caso de raiz órfã: `notificarCategoriaSpy` chamado uma vez com categoria `'estoque'` e `{ chave: 'up-sem-item:<familia_id>' }`; o texto contém o `codigo_pai`. Spy que rejeita não muda o resultado (`tipo: 'erro'`). Reentrega com família já `erro` não chama o spy (guard de status do worker).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- supabase/functions/update-familia-ml/__tests__/processar.test.ts`
Expected: FAIL (spy não chamado).

- [ ] **Step 3: Implementar**

Montador em `estoque.ts`, primeira linha `⚠️ Estoque não enviado ao Mercado Livre: ${nome}`. Chamada best-effort (try/catch com `console.error`, igual aos vizinhos) nos dois pontos de erro novos.

- [ ] **Step 4: Rodar a suíte completa do escopo e o portão**

Run: `pnpm test -- supabase/functions/update-familia-ml supabase/functions/_shared/user-products supabase/functions/_shared/notificacoes`, depois `pnpm preflight:static`
Expected: PASS nos dois.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add supabase/functions
/usr/bin/git commit -m "feat(update): avisa no sino quando família fica sem item no ML (ADR-0195)"
```

### Task 4: Revisão, merge, deploy e correção da Fita

**Files:**
- Modify: `docs/TASKS.md`, `docs/project-status.md`, `docs/reference/edge-functions.md` (conforme skill `docs-update-checklist`)

- [ ] **Step 1: Revisão do diff pelo Codex** (`gpt-6.1-sol`, high, read-only, `< /dev/null`), rodada única; corrigir achados.

- [ ] **Step 2: Docs, push da branch, CI verde (`frontend`, `backend-lint`), merge fast-forward** via `/usr/bin/git push origin <sha>:main`, depois `git pull --ff-only` no checkout principal.

- [ ] **Step 3: Deploy**

`supabase functions deploy update-familia-ml reconciliar-convergencia-up --project-ref txvncrgkoynoxwopfkbp` mais toda função que importe `_shared/user-products/atualizar-familia-up.ts` ou `_shared/notificacoes/estoque.ts` (listar com grep antes). Expected: versão nova ativa e `verify_jwt` igual ao `config.toml`.

- [ ] **Step 4: Limpeza (autorizada por Diego em 05/11), com a sequência do desenho**

Confirmar `familias.status='publicado'` em `2dce54a0-e81d-4e53-810e-6c63150bc2b4`, salvar as 78 linhas em JSON fora do repositório, apagar `anuncios_externos` id `73690294-642a-43c8-a36b-0ac540497834` com filtro de `org_id`, conferir 0 linhas restantes, e `update familias set status='pronto', erro_mensagem=null where id=...`.
Expected: lote #68 mostra `Atualizar estoque (1)`.

- [ ] **Step 5: Diego clica; conferir**

Reusar a leitura por SKU (`/items/bulk`, GET). Expected: 77/77 iguais à planilha, descontadas vendas do ledger, e `last_updated` de `MLB6937855624` de hoje. Registrar em `docs/TASKS.md`.
