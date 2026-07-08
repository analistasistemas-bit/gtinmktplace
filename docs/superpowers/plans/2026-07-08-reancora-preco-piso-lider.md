# Preço ancorado no piso dos MercadoLíderes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No import (CREATE), quando o preço competitivo de uma família dá prejuízo real (líquido Clássico < custo), re-ancorar o preço no menor preço entre os concorrentes **MercadoLíder** (× o mesmo desconto configurável), em vez do menor preço global (que costuma ser undercut de vendedor sem nota) — sinalizando que a re-âncora aconteceu e nunca subindo acima do mercado legítimo.

**Architecture:** Estende o ramo **competitivo** de `sugerirPrecoVenda` com uma re-âncora condicional, gated por toggle em Configurações. Requer (1) preservar o par `{seller_id, preço}` por oferta na captura de concorrência, (2) computar o **piso-líder** (menor preço entre concorrentes MercadoLíder) reusando as reputações já buscadas, e (3) computar o **líquido Clássico** no backend para detectar o prejuízo — o que reintroduz, de forma controlada, a busca de comissão/frete no caminho competitivo. Preserva o ADR-0020: fora do 🔴 o preço segue mercado puro, e a re-âncora nunca ultrapassa o menor preço dos líderes.

**Tech Stack:** Deno edge functions (Supabase), TypeScript, vitest. Frontend React/TS. Migrations via `supabase migration new` + `db push` (ADR-0043).

---

## Contexto obrigatório antes de codar

Leia, nesta ordem: `docs/decisions/0020-estrategia-de-preco-liquido-minimo.md`, `docs/decisions/0050-frete-no-gross-up-preco-proprio.md`, `docs/decisions/0059-desconto-concorrencia-configuravel.md`, e o commit de revert `e6dee14` (`git show e6dee14`).

**Risco #1 — não repetir o revert.** Em 2026-07-06 (`e6dee14`) um "piso viável" foi adicionado ao ramo competitivo e **revertido** porque forçava o preço *acima de todo o mercado* (R$34,40 vs concorrente R$19,47) com selo "vale a pena" mentiroso. Esta feature é diferente: ancora num preço **real de um concorrente legítimo** (o piso dos MercadoLíderes), sempre `≤` esse piso, e **mantém 🔴 honesto** se ainda houver prejuízo. **Nunca** aplicar gross-up nem forçar acima do piso-líder no ramo competitivo. O ADR novo (Task 12) deve deixar essa distinção explícita.

**Risco #2 — reintrodução de comissão/frete no caminho competitivo.** O revert removeu a busca de comissão/frete do ramo competitivo. O gatilho desta feature (líquido Clássico < custo) exige recomputar o líquido no backend → precisamos buscar comissão (listing_prices) + frete no caminho competitivo **de novo**, mas só para DETECTAR prejuízo e re-ancorar, nunca para forçar preço. Gated pelo toggle (custo de API só quando ligado).

**Fatos do código atual (verificados):**
- `sugerirPrecoVenda` (`_shared/preco/sugerir.ts`): ramo competitivo hoje é `arredondar5Proximo(preco_min × (1 − desc%))`, puro, sem custo/comissão.
- `parseItensProduto` (`_shared/concorrencia/parse.ts`): devolve `preco_min/max`, `seller_ids[]` e `precos[]` **em listas separadas** — o par `{seller_id, preço}` é descartado.
- `agregarConcorrencia` (`_shared/concorrencia/agregar.ts`): agrega ofertas de todas as cores; hoje une `seller_ids` e min/max de preço, sem os pares.
- `reputacaoVendedor` (`_shared/ml/mercado.ts`): **privada**; devolve `{lider, vendas}` por seller, cacheada no Redis 24h (`cache:seller:{id}`). `lider = power_seller_status != null` (= MercadoLíder).
- `process-familia/index.ts`: preço é aplicado nas **linhas 304-314** (`sugerirPrecoVenda` por variação → `preco_publicacao`; e uma vez família-level em `estrategiaFamilia`). A reputação (`analisarMercado`) só roda na **linha 317**, DEPOIS do preço. Comissão/frete só são buscados no ramo `!competitivo` (linha ~276).

**Decisões travadas (grilling 2026-07-08):**
- Âncora = menor preço entre concorrentes **MercadoLíder** (`lider === true`); depois `× (1 − desconto_concorrencia_pct/100)` (reusa o mesmo parâmetro configurável, sem % próprio — 3% na org de teste; default do schema/ADR-0059 é 5%).
- Gatilho = **só 🔴** (líquido Clássico < custo), no CREATE, por família (pior caso = maior custo).
- Sem MercadoLíder → mantém comportamento atual. Piso-líder − desc ainda < custo → usa a âncora mesmo assim, **🔴 honesto**.
- Como piso-líder ≥ menor_preço, a re-âncora **sempre sobe ou mantém** o preço (nunca abaixa).
- Sinal = selo distinto + motivo + **flag booleana salva** (`preco_reancorado_lider`). Editável pelo operador; respeita `preco_editado_pelo_operador`.
- Gated por **toggle** em Configurações (`reancora_lider_ativa`, default false), por org.

---

## Estrutura de arquivos

**Captura (par preço↔vendedor):**
- `_shared/concorrencia/tipos.ts` — `DadosOfertas` ganha `ofertas_detalhe: OfertaVendedor[]` (`{ seller_id: number | null; preco: number | null }`).
- `_shared/concorrencia/parse.ts` — `parseItensProduto` preenche `ofertas_detalhe`.
- `_shared/concorrencia/agregar.ts` — concatena `ofertas_detalhe` de todas as cores.

**Piso-líder:**
- `_shared/ml/mercado.ts` — exportar `reputacaoVendedor` (ou movê-la p/ `_shared/ml/reputacao.ts` e reexportar).
- `_shared/preco/piso-lider.ts` (novo) — `pisoLiderDeOfertas` (pura) + `calcularPisoLider` (busca reputações, reusa cache).

**Estratégia + líquido:**
- `_shared/preco/liquido.ts` (novo) — `liquidoClassico(preco, comissao, frete, aliquotaPct)` pura (espelha o "Você recebe" Clássico).
- `_shared/preco/sugerir.ts` — `sugerirPrecoVenda` ganha ramo de re-âncora; retorna `reancorado: boolean`.

**Wiring / persistência:**
- `process-familia/index.ts` — buscar comissão/frete no competitivo (gated), computar piso-líder + líquido, aplicar re-âncora, persistir flag.
- `supabase/migrations/<ts>_reancora_lider.sql` — `configuracoes.reancora_lider_ativa`, `familias.preco_reancorado_lider` (flag família-level).

**UI:**
- `src/pages/Configuracoes.tsx` (+ hook `useConfiguracoes`) — toggle.
- `src/components/painel-analise.tsx` — selo distinto quando `reancorado`.
- `src/lib/tipos-dominio.ts` — mapear a flag.

**Docs:**
- `docs/decisions/0065-reancora-preco-piso-lider.md` (ADR novo, estende 0020).
- `docs/reference/glossario.md`, `docs/reference/edge-functions.md`, `docs/reference/modelo-de-dados.md`.

---

## Task 1: `ofertas_detalhe` no tipo e no parse

**Files:**
- Modify: `supabase/functions/_shared/concorrencia/tipos.ts`
- Modify: `supabase/functions/_shared/concorrencia/parse.ts`
- Test: `supabase/functions/_shared/concorrencia/__tests__/parse.test.ts`

- [ ] **Step 1: Teste falhando** — em `parse.test.ts`, `parseItensProduto` com results `[{seller_id:1,price:30},{seller_id:2,price:25}]` deve devolver `ofertas_detalhe` = `[{seller_id:1,preco:30},{seller_id:2,preco:25}]`. Cobrir: `price` ausente → `preco:null`; `seller_id` ausente → `seller_id:null`.
- [ ] **Step 2: Rodar** `pnpm test -- parse` → FAIL (campo inexistente).
- [ ] **Step 3: Implementar** — em `tipos.ts` adicionar `export interface OfertaVendedor { seller_id: number | null; preco: number | null }` e o campo `ofertas_detalhe: OfertaVendedor[]` em `DadosOfertas`. Em `parse.ts`, montar `ofertas_detalhe = results.map(r => ({ seller_id: r.seller_id != null ? Number(r.seller_id) : null, preco: typeof r.price === 'number' && r.price > 0 ? r.price : null }))`. Incluir `ofertas_detalhe: []` no objeto `vazio`.
- [ ] **Step 4: Rodar** `pnpm test -- parse` → PASS.
- [ ] **Step 5: Commit** `feat(concorrencia): captura par {seller_id, preco} por oferta (ofertas_detalhe)`.

## Task 2: Agregar `ofertas_detalhe` entre cores

**Files:**
- Modify: `supabase/functions/_shared/concorrencia/agregar.ts`
- Test: `supabase/functions/_shared/concorrencia/__tests__/agregar.test.ts`

- [ ] **Step 1: Teste falhando** — 2 produtos, cada um com `ofertas_detalhe` de 2 ofertas → o resultado agregado deve ter `ofertas.ofertas_detalhe` com as 4 ofertas concatenadas.
- [ ] **Step 2: Rodar** `pnpm test -- agregar` → FAIL.
- [ ] **Step 3: Implementar** — em `agregarConcorrencia`, `ofertas_detalhe = produtos.flatMap(p => p.ofertas.ofertas_detalhe)`; incluir no `DadosOfertas` agregado. (`concorrencia.ts` já carrega `ofertas` inteiro — verificar que `ofertas_detalhe` trafega no cache: o `CacheConcorrenciaEntrada.ofertas` é o mesmo tipo, então já persiste.)
- [ ] **Step 4: Rodar** `pnpm test -- agregar` → PASS.
- [ ] **Step 5: Commit** `feat(concorrencia): agrega ofertas_detalhe de todas as cores`.

## Task 3: `pisoLiderDeOfertas` (pura)

**Files:**
- Create: `supabase/functions/_shared/preco/piso-lider.ts`
- Test: `supabase/functions/_shared/preco/__tests__/piso-lider.test.ts`

- [ ] **Step 1: Teste falhando** — cobrir:
  1. sellers 1,2 líderes (preços 30, 28), seller 3 não-líder (preço 22) → piso-líder = 28.
  2. nenhum líder → `null`.
  3. líder com `preco:null` é ignorado.
  4. mesmo seller-líder em 2 ofertas (cores) preços 30 e 26 → 26.

```ts
// contrato
export function pisoLiderDeOfertas(
  ofertas: { seller_id: number | null; preco: number | null }[],
  ehLider: (sellerId: number) => boolean,
): number | null
```
- [ ] **Step 2: Rodar** `pnpm test -- piso-lider` → FAIL.
- [ ] **Step 3: Implementar** — filtrar ofertas com `seller_id != null && preco != null && ehLider(seller_id)`, `Math.min` dos preços; `null` se vazio.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat(preco): pisoLiderDeOfertas — menor preço entre concorrentes MercadoLíder`.

## Task 4: Expor `reputacaoVendedor` + `calcularPisoLider`

**Files:**
- Modify: `supabase/functions/_shared/ml/mercado.ts` (exportar `reputacaoVendedor`)
- Modify: `supabase/functions/_shared/preco/piso-lider.ts` (fetcher)
- Test: `supabase/functions/_shared/preco/__tests__/piso-lider.test.ts` (fetcher com fakes)

- [ ] **Step 1: Teste falhando** — `calcularPisoLider(ofertas_detalhe, repLookup)` onde `repLookup(sellerId) => {lider, vendas}` (injetado p/ teste) devolve o piso-líder aplicando `pisoLiderDeOfertas`. Testar com lookup fake (sem rede).
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** — `export` em `reputacaoVendedor`. Em `piso-lider.ts`, `calcularPisoLider(token, ofertas_detalhe)`: coletar `seller_ids` distintos, `Promise.all(reputacaoVendedor(token,id))` (reusa cache Redis 24h → barato mesmo que `analisarMercado` refaça depois), montar `Set` de líderes, chamar `pisoLiderDeOfertas`. Manter a versão pura injetável para teste.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat(preco): calcularPisoLider reusando reputações (cache Redis)`.

## Task 5: `liquidoClassico` (pura)

**Files:**
- Create: `supabase/functions/_shared/preco/liquido.ts`
- Test: `supabase/functions/_shared/preco/__tests__/liquido.test.ts`

- [ ] **Step 1: Teste falhando** — `liquidoClassico(preco, comissao, frete, aliquotaPct)` = `preco − (preco*pct/100 + fixa) − frete − preco*aliquota/100`. Casar com o exemplo da tela (preço 21,70, ver "Você recebe" Clássico). Cobrir frete=0 e imposto=0.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** a fórmula pura (espelha `CardVoceRecebe`/`viabilidade` do front, mas no backend). Manter simples; sem arredondar (comparação com custo).
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat(preco): liquidoClassico p/ detectar prejuízo no backend`.

## Task 6: Re-âncora em `sugerirPrecoVenda`

**Files:**
- Modify: `supabase/functions/_shared/preco/sugerir.ts`
- Test: `supabase/functions/_shared/preco/__tests__/sugerir.test.ts`

- [ ] **Step 1: Teste falhando** — nova assinatura recebe contexto de re-âncora. Casos (ramo competitivo):
  1. Toggle OFF → comportamento atual (base = preco_min), `reancorado:false`.
  2. Toggle ON, líquido(competitivo) ≥ custo (não é 🔴) → sem re-âncora, `reancorado:false`.
  3. Toggle ON, 🔴, pisoLider=null → sem re-âncora, `reancorado:false` (mantém atual).
  4. Toggle ON, 🔴, pisoLider > preco_min → base = pisoLider, preço = `arredondar5Proximo(pisoLider × (1−desc%))`, `reancorado:true`, motivo cita a âncora.
  5. Toggle ON, 🔴, pisoLider − desc AINDA < custo → ainda re-ancora (usa pisoLider), `reancorado:true` (🔴 honesto permanece; NÃO faz gross-up).
  6. `estrategia` continua `'competitivo'` (a flag `reancorado` diferencia; sem novo valor de enum).
  7. **Borda:** `pisoLider === preco_min` (nenhum ganho — o menor preço já é de um líder) → `reancorado:false`, preço **idêntico** ao caminho sem re-âncora. (A condição usa `>` estrito; este teste trava isso contra um refactor futuro que troque `>` por `>=`.)
- [ ] **Step 2: Rodar** `pnpm test -- sugerir` → FAIL.
- [ ] **Step 3: Implementar** — estender o retorno com `reancorado: boolean` (os ramos `proprio`/gross-up e fallback também passam a retornar `reancorado:false` — o TypeScript força isso). Adicionar params opcionais: `reancora?: { ativa: boolean; pisoLider: number | null; custo: number; comissao: Comissao | null }`. No ramo competitivo: computar `precoBase = preco_min`; se `reancora?.ativa && pisoLider != null && pisoLider > preco_min` (estrito) e `liquidoClassico(precoBase*(1-desc/100), comissao, frete, aliquotaPct) < custo` (🔴) → `precoBase = pisoLider`, `reancorado = true`, `motivo = 'menor preço dava prejuízo; ancorado no piso dos MercadoLíderes (R$'+pisoLider+')'`. **Nunca** exceder `pisoLider`; nunca gross-up aqui. Retornar `arredondar5Proximo(precoBase*(1-desc/100))`.
- [ ] **Step 4: Rodar** → PASS. Rodar suíte `pnpm test -- preco` inteira.
- [ ] **Step 5: Commit** `feat(preco): re-âncora competitiva no piso-líder quando há prejuízo (🔴)`.

## Task 7: Migration — toggle + flag

**Files:**
- Create: `supabase/migrations/<timestamp>_reancora_lider.sql` (via `supabase migration new reancora_lider`)
- Modify: `docs/reference/modelo-de-dados.md`

- [ ] **Step 1** `supabase migration new reancora_lider`.
- [ ] **Step 2** SQL: `ALTER TABLE configuracoes ADD COLUMN reancora_lider_ativa boolean NOT NULL DEFAULT false;` e `ALTER TABLE familias ADD COLUMN preco_reancorado_lider boolean NOT NULL DEFAULT false;`. (Flag **família-level** — a re-âncora é uma decisão da família, ver Task 8; sem tocar RLS existente.)
- [ ] **Step 3** `supabase db push` e `npm run db:check`.
- [ ] **Step 4** Atualizar `modelo-de-dados.md`.
- [ ] **Step 5: Commit** `feat(db): toggle reancora_lider_ativa + flag preco_reancorado_lider`.

## Task 8: Wiring em `process-familia`

**Files:**
- Modify: `supabase/functions/process-familia/index.ts`
- Test: (integração leve — a lógica pura já está coberta; validar via reprocesso ao vivo no fim)

**Decisão é FAMÍLIA-level (pior caso), aplicada igual a todas as cores.** Hoje o preço competitivo é `preco_min × (1−desc%)` — o MESMO para todas as variações (não depende do custo de cada cor); o 🔴 é que é por variação. Para não fazer cores da mesma família divergirem de preço, a re-âncora decide UMA vez pelo **pior caso** (maior custo da família, como o semáforo do ADR-0020) e aplica o mesmo preço a todas.

- [ ] **Step 1** Ler o toggle: no bloco que lê `configuracoes` (linha ~263), incluir `reancora_lider_ativa`.
- [ ] **Step 2** Quando `competitivo && reancora_lider_ativa`, na **ordem**: (a) `comissao = comissaoDe(await buscarListingPrice(token, PRECO_REF_COMISSAO, categoriaMlId, 'gold_special'))`; (b) `pisoLider = await calcularPisoLider(token, concorrencia.ofertas.ofertas_detalhe)`; (c) **frete estimado no preço competitivo** — `precoEstimado = arredondar5Proximo(conc.preco_min * (1 - descontoConcorrenciaPct/100))` (o preço que a família teria SEM re-âncora), usado só para escolher a faixa de frete: `frete = await buscarFreteVendedor(token, conexao.contaExternaId, precoEstimado, categoriaMlId, dimRep)` — `dimRep` = dimensões da variação representativa (menor preço), igual ao ramo `!competitivo`. Tudo **antes** das linhas 304-314. Resiliente: qualquer falha → `pisoLider=null`/sem re-âncora (nunca derruba a família). Racional: o gatilho 🔴 avalia o líquido do preço competitivo, então comissão e faixa de frete são estimadas nesse preço, não no da âncora.
- [ ] **Step 3** `maiorCustoFamilia = Math.max(...resolvidas.map(v => Number(v.custo)))`. Chamar `sugerirPrecoVenda(..., reancora = { ativa: reancora_lider_ativa, pisoLider, custo: maiorCustoFamilia, comissao })` — **com o mesmo `custo` (pior caso) em TODAS as chamadas por variação e no `estrategiaFamilia`**, para que todas as cores recebam o mesmo `preco_publicacao`. Respeitar `preco_editado_pelo_operador`.
- [ ] **Step 4** Persistir `familias.preco_reancorado_lider = estrategiaFamilia.reancorado` e `estrategia_motivo` (já vêm de `sugerirPrecoVenda`).
- [ ] **Step 5: Commit** `feat(process-familia): aplica re-âncora no piso-líder (gated por toggle)`.

## Task 9: Frontend — toggle em Configurações

**Files:**
- Modify: `src/pages/Configuracoes.tsx`, `src/hooks/useConfiguracoes.ts`, `src/lib/tipos-dominio.ts`
- Test: teste do componente/hook conforme padrão de `tests/`

- [ ] **Step 1** Teste do toggle (render + persist), espelhando o de `desconto_concorrencia_pct`.
- [ ] **Step 2** Rodar → FAIL.
- [ ] **Step 3** Adicionar o switch "Ancorar preço no piso dos MercadoLíderes quando der prejuízo" perto do desconto %; mapear `reancora_lider_ativa` no hook/tipos.
- [ ] **Step 4** Rodar → PASS.
- [ ] **Step 5: Commit** `feat(config): toggle da re-âncora no piso dos MercadoLíderes`.

## Task 10: Frontend — selo distinto

**Files:**
- Modify: `src/components/painel-analise.tsx`, `src/lib/tipos-dominio.ts`
- Test: `tests/` (semáforo/painel)

- [ ] **Step 1** Teste: **família** com `precoReancoradoLider=true` → o card Estratégia mostra selo distinto ("COMPETITIVO · âncora líder") e o motivo da âncora. (Flag é família-level — `PainelAnalise` já é um componente de família e lê `familia.*`; não há mistura variação↔família.)
- [ ] **Step 2** Rodar → FAIL.
- [ ] **Step 3** Mapear `preco_reancorado_lider` → `familia.precoReancoradoLider` em `tipos-dominio.ts`; no `PainelAnalise`, quando `familia.precoReancoradoLider`, trocar o rótulo/tom do `StatusPill` de Estratégia e exibir o motivo (já vem em `estrategiaMotivo`). (O `variacao-card.tsx` não precisa de selo — todas as cores compartilham o mesmo preço e a mesma decisão.)
- [ ] **Step 4** Rodar → PASS.
- [ ] **Step 5: Commit** `feat(ui): selo distinto quando o preço foi reancorado no piso-líder`.

## Task 11: Docs + ADR

**Files:**
- Create: `docs/decisions/0065-reancora-preco-piso-lider.md`
- Modify: `docs/reference/glossario.md`, `docs/reference/edge-functions.md`

- [ ] **Step 1** ADR-0065 (estende 0020, NÃO substitui): contexto (undercut sem nota), decisão (âncora piso-líder só no 🔴, toggle, sinal), e **a distinção explícita vs. o revert `e6dee14`** (nunca acima do piso-líder, nunca gross-up no competitivo, 🔴 honesto).
- [ ] **Step 2** Glossário: "piso-líder", "re-âncora", "preço reancorado". Edge-functions: nota no `process-familia`.
- [ ] **Step 3: Commit** `docs: ADR-0065 re-âncora no piso dos MercadoLíderes + glossário`.

## Verificação final (ao vivo)

- [ ] `pnpm lint` + `pnpm test` verdes.
- [ ] Deploy: `process-familia` **e `analisar-viabilidade`** (este importa `_shared/ml/concorrencia.ts` → cadeia `_shared/concorrencia/{parse,agregar,tipos}.ts` alterada; a mudança é aditiva e ele não lê `ofertas_detalhe`, mas redeployar cumpre a regra do CLAUDE.md "mudança em `_shared/` → redeployar afetadas"). Conferir demais importadores de `_shared/preco/*`.
- [ ] Ligar o toggle na org de teste, reprocessar uma família 🔴 (ex.: Anne 500m do lote #28), conferir no banco: `preco_publicacao` subiu para `pisoLider × (1−3%)`, `preco_reancorado_lider=true`, `estrategia_motivo` cita a âncora; e uma família 🟢 permanece intocada.
- [ ] Conferir com toggle OFF que nada muda (comportamento atual).

## Riscos & notas
- **Custo de API:** comissão + frete no competitivo só quando o toggle está ON (gated). Reputações reusam cache Redis 24h.
- **Ordenação:** piso-líder deve ser computado ANTES das linhas 304-314; `analisarMercado` (linha 317) segue igual (cache absorve a 2ª leitura de reputação).
- **Não repetir o revert:** ramo competitivo nunca faz gross-up nem ultrapassa o piso-líder; 🔴 permanece 🔴.
- **Reprocesso:** re-aplica; respeita `preco_editado_pelo_operador`.
