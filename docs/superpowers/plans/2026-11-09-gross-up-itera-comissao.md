# Gross-up itera a comissão no preço final — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O preço de publicação do ramo "próprio" (sem concorrência) usa a comissão do ML **no preço calculado**, não a comissão lida a R$ 20.

**Architecture:** Hoje `process-familia` lê a comissão uma vez em `PRECO_REF_COMISSAO = 20` e só itera o frete (`freteEstavelGrossUp`, ADR-0076). Em categorias cuja comissão percentual muda com o preço, o gross-up sai errado. Caso real: Avil, código 02994445, MLB277368, piso R$ 143,50, frete R$ 23,25, imposto 16%. O ML cobra 12% até ~R$ 100 e 11% a partir de R$ 150. O preço saiu R$ 231,60, quando o correto é R$ 228,45. Nova função pura `precoProprioEstavel` itera **comissão + frete** juntos no preço candidato até chegar a um ponto fixo. Ela só devolve um preço cujo líquido, conferido com a tarifa **daquele** preço, é ≥ piso: mesmo padrão de `ateQuantoDescer` em `_shared/promocoes/projecao.ts`.

**Tech Stack:** Deno edge function (Supabase), TypeScript, vitest.

**Spec:** este documento (bug fix; diagnóstico na conversa: listing_prices de MLB277368 com o token da Avil: 12% a R$ 20/50/79/100, 11% a R$ 150/200/228,45/231,60, `fixed_fee` 0).

## Global Constraints

- Nunca vender abaixo do piso: o líquido no Clássico (`liquidoClassico`) do preço final, com a comissão e o frete **desse** preço, é ≥ piso.
- Preço sempre múltiplo de R$ 0,05 arredondado para cima (`grossUp`), nunca < R$ 12,55 (ADR-0023).
- Comissão sem `sale_fee_details` oficial não vale (emenda ADR-0020, `buscarComissaoParaPreco` lança).
- Ramo competitivo, re-âncora (ADR-0065) e preço editado pelo operador: **inalterados**.
- Falha de rede/ML na iteração → comportamento atual (comissão@R$20 + frete família), como já é feito hoje com o frete (ADR-0050).

## Review Focus

1. **Oscilação na fronteira de faixa:** P com 11% cai abaixo do limiar T, onde a comissão é 12%; P com 12% fica ≥ T. Não há ponto fixo. Esperado: devolve o menor preço visitado que foi verificado seguro, nunca um preço não verificado. Teste em Task 1.
2. **Comissão sobe com o preço** (ou frete salta de faixa em ~R$79): esperado convergir para cima como hoje. Teste em Task 1.
3. **Nenhum preço visitado verificado seguro após maxIter:** esperado fallback conservador `grossUp` com a maior comissão %, a maior fixa e o maior frete vistos. Teste em Task 1.
4. **Tarifa falha no meio da iteração:** esperado fallback para o cálculo antigo (comissão@20 + frete família), sem derrubar a família. Coberto por `.catch` em Task 2 (sem teste de integração: o worker não tem harness; registrado como limite).
5. **Custo de chamadas ao ML:** até `maxIter` × (listing_prices + frete) por variação. Memoização por preço (comissão) e por (preço, dimensões) (frete) dentro da família, como o `freteMemo` atual.

---

### Task 1: `precoProprioEstavel` (pura, em `sugerir.ts`)

**Files:**
- Modify: `supabase/functions/_shared/preco/sugerir.ts` (nova função após `freteEstavelGrossUp`)
- Test: `supabase/functions/_shared/preco/__tests__/sugerir.test.ts` (novo `describe`)

**Interfaces:**
- Produces:
  ```ts
  export interface TarifaNoPreco { comissao: Comissao; frete: number }
  export async function precoProprioEstavel(
    piso: number,
    aliquotaPct: number,
    inicial: Comissao,                 // comissão@R$20 já lida (1º palpite)
    tarifaEm: (preco: number) => Promise<TarifaNoPreco>,
    maxIter = 6,
  ): Promise<number>
  ```

**Algoritmo** (não determinado pela assinatura):
```
P = grossUp(piso, inicial.percentual, inicial.fixa, 0, aliq)
visitados = []                         // {preco, tarifa, seguro}
repete até maxIter:
  t = await tarifaEm(P)
  seguro = liquidoClassico(P, t.comissao, t.frete, aliq) >= piso - 1e-9
  visitados.push({P, t, seguro})
  novo = grossUp(piso, t.comissao.percentual, t.comissao.fixa, t.frete, aliq)
  se novo === P → return P              // ponto fixo (seguro por construção)
  se novo já visitado → break           // ciclo
  P = novo
seguros = visitados.filter(seguro)
se seguros → return min(seguros.preco)
senão → return grossUp(piso, max %, max fixa, max frete vistos, aliq)   // conservador
```

- [ ] **Step 1: testes que falham** (`describe('precoProprioEstavel')`), com `tarifaEm` sintética:
  - `caso Avil: comissão 12% até R$100 e 11% acima; frete 23,25; imposto 16; piso 143,50 → 228.45` (inicial `{percentual:12, fixa:0}`).
  - `comissão constante = grossUp com frete`: tarifa fixa 13%/frete 10 → igual a `grossUp(piso,13,0,10,aliq)`.
  - `frete salta em R$79 (ADR-0076) continua convergindo para cima`: piso 60, comissão 12%, frete 0 abaixo de 79 e 20 a partir de 79, aliq 0 → resultado com líquido ≥ 60 na tarifa do próprio preço, e ≥ 79.
  - `oscilação na fronteira`: comissão 12% abaixo de T e 11% a partir de T, com T entre P11 e P12. Esperado: um preço visitado, ≥ T, com líquido(preço, 11%) ≥ piso, e nunca P11.
  - `sem preço seguro → fallback conservador`: tarifa que alterna de forma a nenhum visitado ser seguro (ex.: frete cresce sempre com o preço, maxIter=2). Esperado: igual a `grossUp` com os máximos vistos.
- [ ] **Step 2:** `pnpm vitest run supabase/functions/_shared/preco/__tests__/sugerir.test.ts` → FAIL (função não existe).
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS (todos os testes do arquivo).
- [ ] **Step 5:** commit `fix(preco): gross-up itera comissão + frete no preço candidato`.

### Task 2: `process-familia` usa `precoProprioEstavel` no ramo próprio

**Files:**
- Modify: `supabase/functions/process-familia/index.ts:496-541` (`freteDaVariacao` + loop de `preco_publicacao`)
- Modify: `docs/decisions/0076-gross-up-itera-frete-por-variacao.md` (emenda 2026-11-09: a comissão também é iterada; motivo e caso Avil)

**Interfaces:**
- Consumes: `precoProprioEstavel`, `TarifaNoPreco` (Task 1); `buscarComissaoParaPreco(token, preco, categoria)` (`_shared/ml/listing-prices.ts`); `buscarFreteVendedor(token, conta, preco, categoria, dim)`.

Mudança:
- Substituir `freteDaVariacao` por `precoDaVariacao(v): Promise<number | null>`. Devolve `null` quando não se aplica: `competitivo`, `!comissao`, `!token` ou `!categoriaMlId`. Nesse caso segue `sugerirPrecoVenda(... frete família ...)` como hoje.
- Quando aplica: `precoProprioEstavel(Number(v.preco), aliquotaPct, comissao, tarifaEm)`, com `tarifaEm(p) = { comissao: await comissaoEm(p), frete: conta ? await buscarFreteVendedor(token, conta, p, categoriaMlId, dimV) : 0 }`.
- `comissaoEm` memoizado por preço na família (`Map<number, Promise<Comissao>>`).
- O memo por `(piso, dimensões)` continua como hoje.
- `.catch(() => grossUp(Number(v.preco), comissao.percentual, comissao.fixa, frete, aliquotaPct))`: comportamento antigo quando o ML falha.
- `estrategiaFamilia` (só estratégia/motivo) e o ramo competitivo/re-âncora: sem mudança.
- Remover `freteEstavelGrossUp` do import se ficar sem uso no worker. A função e o teste dela continuam em `sugerir.ts`, pois não tem outros chamadores e a remoção sai do escopo (mencionar).

- [ ] **Step 1:** editar o worker.
- [ ] **Step 2:** `deno check supabase/functions/process-familia/index.ts` → sem erro (ou o lint de backend que o CI roda: `pnpm preflight`).
- [ ] **Step 3:** `pnpm test` → verde.
- [ ] **Step 4:** emenda no ADR-0076.
- [ ] **Step 5:** commit `fix(process-familia): preço próprio usa a comissão do preço final (emenda ADR-0076)`.

### Task 3: Entrega

- [ ] Grok 4.7 xhigh revisa o diff da branch.
- [ ] `pnpm preflight` verde → push → CI verde → merge fast-forward na main.
- [ ] `supabase functions deploy process-familia --project-ref txvncrgkoynoxwopfkbp --no-verify-jwt` e conferir a versão e `verify_jwt=false`.
- [ ] Validação real: reprocessar a família `e799dcb2-…` (02994445, Avil) e conferir `preco_publicacao = 228.45`. Ela ainda não foi publicada e o preço não foi editado pelo operador.

---

## Revisão do plano — Grok 4.7 xhigh (REVISAR) e ajustes aplicados

1. **Só devolver preço verificado na tarifa dele.** Aceito. `precoProprioEstavel` devolve `number | null`. Sem preço verificado após `maxIter`, devolve `null` e a família fica sem preço com erro (emenda ADR-0020). O fallback "máximos vistos" saiu.
2. **Frete 0 de erro não é frete real.** Aceito. `tarifaEm` = `criarTarifaEm` (`_shared/promocoes/deps.ts`): comissão e frete `estimated` lançam `TarifaEstimada`.
3. **Falha do ML no meio da iteração.** Aceito em parte. Com preço já verificado, devolve esse preço. Sem preço verificado, relança e o worker mantém o cálculo atual (comissão@R$20 + frete família, ADR-0050). Recusar aqui travaria a publicação inteira de orgs cujo frete o ML devolve sem `coverage` (`estimated` permanente): seria regressão, não correção.
4. **Quota.** Aceito via `criarTarifaEm`: cache Redis `promo:lp`/`promo:frete` por preço (8 h), disjuntor no 1º 429/5xx e comissão + frete em paralelo. O retorno vai direto para `preco_publicacao`, sem segundo `sugerirPrecoVenda`.
5. **Teste da faixa R$79.** Aceito. Piso 60, comissão 12%, alíquota 8%, frete 6,75 (<79) / 16,15 (≥79) → **95,20**.

Opcionais: 4 (kit virtual/re-âncora) fica fora de escopo; 5 (reprocessar a Avil) só com a org confirmada. Os demais ficam para depois.
