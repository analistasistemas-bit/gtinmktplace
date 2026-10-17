# Distribuição da nota com custo e quantidades do cadastro — plano definitivo

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** na importação de nota (ADR-0181), a etapa 3 "Distribuição" deixa de pedir de novo o que o operador já digitou: (A) o custo padrão de cada SKU é o custo cadastrado quando é a 1ª entrada do produto; (B) as quantidades por cor×tamanho digitadas no cadastro feito pela nota ficam gravadas como sugestão e chegam preenchidas na etapa 3, mesmo fechando e reabrindo a nota.

**Contexto factual (investigação + banco, 2026-10-17):** etapa 3 semeia todo SKU com o custo de aquisição da nota (`importar-nota/estado.ts:169-171,184`, `etapa-distribuicao.tsx:31,58`) e ignora `variacoes.custo`, que `fetchVariacoesProduto` já devolve (`src/lib/produtos-saldo.ts:195`). Ao confirmar, a RPC chama `registrar_entrada` com `custo = coalesce(p_custo, custo)` (`supabase/migrations/20260903002527_kit_vinculado_guards.sql:75`) → o custo real digitado (ex. 17) é sobrescrito pelo da nota (10) sem aviso — contra D-9. Quantidade: com `origemNota` não existe campo (aba Estoque escondida — `dialog-cadastro-grade.tsx:791`, `matriz-grade.tsx:69`; `use-cadastro-produto.ts:64` apaga `estoqueInicial`) — intencional (D-4), nada é capturado. Produção: short `00000010` (32 SKUs, custo 17, saldo 0, sem `refNota`, cadastrado antes da retomada → chega por escolha manual) e conjunto `00000043` (20 SKUs, custo 14,50, saldo 0, `refNota` item 2). Nenhum movimento de estoque na org.

**Decisões (Diego):** carregar custo e quantidades; a etapa 3 vira conferência; quantidades gravadas para sobreviver a fechar/reabrir. **Calls minhas:** regra de custo por "1ª entrada" (não por origem do vínculo) para cobrir o short; sugestão gravada pela edge a partir dos códigos que ela gera (o front não mapeia códigos).

## Global Constraints

- **Custo padrão (A):** por SKU, `custoPrecificacao` inicial = `variacoes.custo` quando `> 0` **e** o produto nunca teve estoque (todos os SKUs com saldo 0 **e** nenhuma linha travada de entrada prévia para ele); senão = custo de aquisição da nota (hoje). Vale para qualquer origem (`nota`, `manual`, `vinculo`, `gtin`). Ao lado do campo, texto "Aquisição R$ X,XX/un" (custo da nota). Nada é gravado em silêncio: o valor do campo é o enviado, como hoje.
- **Quantidade da nota (B):** no diálogo de cadastro em grade com `origemNota`, a aba "Estoque" continua escondida e entra a aba **"Quantidade da nota"** (inteiros ≥ 0 por linha), com contador **"X de Q"** e "faltam R" (Q = `quantidadeEmEstoque(item.qCom, fator).quantidade` do item da nota; se inválido, sem contador). Payload: cada variação leva `quantidadeNota?: number` **só com** `origemNota === true` e `refNota` válido; **nunca** `estoqueInicial` (D-4).
- **Edge `cadastrar-produto`:** valida `quantidadeNota` (inteiro ≥ 0; recusa sem `origemNota`/`refNota` → 400) e grava `familias.mudanca_estrutural = { refNota, sugestaoDistribuicao: [{ codigo, quantidade }] }` usando os códigos que **ela** gerou para cada variação (mesma ordem de `montarLinhasProduto`); só itens com `quantidade > 0`. Retry idempotente: a sugestão entra na comparação (como `refNota`/`grade_tamanho`) → divergência = 409 antes de efeitos. Nunca toca `variacoes.estoque` nem movimentos.
- **Leitura:** `produtosCadastradosDaNota` devolve também `sugestao: Array<{ codigo; quantidade }>` por `nItem` (da versão encontrada; versões da mesma família com sugestões diferentes → usa a mais recente por `criado_em`). `aplicarCadastradosDaNota` semeia `distribuicao` do item com a sugestão **somente** quando aplica o produto `nota` ao item (sem escolha manual, sem linhas não travadas já editadas); linhas travadas sempre vencem; linhas "SKU de outro produto" preservadas.
- **Sessão:** ao cadastrar (`aoCadastrar`), o front aplica a mesma sugestão imediatamente (sem esperar reabrir), a partir do que acabou de enviar + códigos devolvidos pela edge (a resposta passa a incluir `sugestaoDistribuicao`).
- **Etapa 3:** soma continua validada contra a nota (D-7); sugestão que não soma Q aparece como está, com a mensagem de bloqueio atual. `definirFator`/`definirProduto` (Trocar) descartam a sugestão (como já fazem com linhas não travadas).
- Sem migration (jsonb existente). Edge alterada → redeploy de `cadastrar-produto` + o que o grafo transitivo (`deno info`) apontar. Componentes só de `src/components/ui/` (`ui/select` etc.). pt-BR.
- Emenda datada 2026-10-17 no ADR-0181 (D-4: quantidade da nota no cadastro = sugestão gravada, não estoque; D-9: custo padrão da 1ª entrada).
- Git em worktree: `/usr/bin/git` simples, `commit -F`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Portão: `pnpm preflight`.

## Review Focus

1. Recompra (produto com saldo > 0 e custo antigo): custo padrão continua o da nota.
2. Short `00000010` (manual, saldo 0, custo 17): etapa 3 abre com 17 em todos os SKUs, quantidades 0.
3. Reabrir a nota após cadastrar o conjunto pela nota com quantidades: etapa 3 abre preenchida; trocar o produto do item descarta a sugestão.
4. Payload/edge nunca grava estoque com a sugestão (saldo continua 0 até confirmar).
5. Retry da mesma `chaveCadastro` com quantidades diferentes → 409.

---

### Task 1: Edge grava e compara a sugestão

**Files:** `supabase/functions/_shared/produto/validar.ts` (tipo `VariacaoEntrada.quantidadeNota?`, validação), `supabase/functions/cadastrar-produto/processar.ts` (`montarSugestaoDistribuicao(entrada, codigos)`, `sugestaoDiverge(gravada, entrada)`), `supabase/functions/cadastrar-produto/index.ts` (grava em `mudanca_estrutural`, retry 409, resposta inclui `sugestaoDistribuicao`); Test: `cadastrar-produto/__tests__/processar.test.ts`, `_shared/produto/__tests__/validar.test.ts`.
- [ ] RED: quantidadeNota sem origemNota → erro; negativo/fração → erro; montar com códigos `['A','B','C']` e quantidades `[5,0,3]` → `[{A,5},{C,3}]`; diverge true/false casos; sem quantidades → `mudanca_estrutural` só com `refNota` (igual a hoje).
- [ ] GREEN; `pnpm check:functions`; `pnpm lint:functions`; commit.

### Task 2: Leitura, estado e custo padrão (front)

**Files:** `src/lib/notas-compra.ts` (`produtosCadastradosDaNota` com `sugestao`), `src/components/estoque/importar-nota/estado.ts` (`aplicarCadastradosDaNota` semeia; função pura `custoPadraoSku(sku: { custo: number | null; saldo: number }, produtoNuncaTeveEstoque: boolean, custoNota: number)`; `linhasIniciais`/`semearDistribuicao` usam), `etapa-distribuicao.tsx` (passa custo/saldo dos SKUs; texto "Aquisição R$ X,XX/un"), `dialog-importar-nota.tsx` (`aoCadastrar` recebe `sugestaoDistribuicao` e aplica); Test: `importar-nota/__tests__/estado.test.ts`, `linhas-distribuicao.test.ts`, `notas-compra-cadastrados.test.ts`, teste do diálogo.
- [ ] RED: casos do Review Focus 1–3; travadas intactas; outro produto preservado; fator muda descarta; soma ≠ Q bloqueia; versões com sugestões diferentes → mais recente.
- [ ] GREEN; `tsc -b --force`; commit.

### Task 3: Aba "Quantidade da nota" no cadastro em grade

**Files:** `src/components/estoque/matriz-grade.tsx` (modo `quantidadeNota` quando `origemNota`), `dialog-cadastro-grade.tsx` (estado por linha, contador "X de Q · faltam R", recebe Q do prefill), `prefill-cadastro.ts`/`CadastroInicial` (Q), `use-cadastro-produto.ts` `montarPayload` (envia `quantidadeNota` só com origemNota+refNota; nunca `estoqueInicial`), `onCadastrado` devolve `sugestaoDistribuicao`; Test: `dialog-cadastro-grade.test.tsx`, `use-cadastro-produto.test.ts`.
- [ ] RED: com origemNota aba "Quantidade da nota" visível e "Estoque" ausente; contador; payload com `quantidadeNota` e sem `estoqueInicial`; sem origemNota nada muda.
- [ ] GREEN; `pnpm preflight:static`; commit.

### Task 4: Emenda ADR, validação, deploy, merge

- [ ] Emenda ADR-0181; `pnpm preflight` verde; revisão final Codex gpt-6.1-sol; browser real (playwright, sem gravar em prod): cadastro pela nota com quantidades → etapa 3 preenchida → fechar/reabrir (com `produtosCadastradosDaNota` interceptado devolvendo a sugestão) → preenchida; short manual com custo 17.
- [ ] Deploy das edges (grafo transitivo), conferir versão/verify_jwt; docs vivos; merge ff com CI verde; Graphify se houver módulo novo; limpar.
