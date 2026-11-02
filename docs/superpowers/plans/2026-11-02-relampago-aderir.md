# Aderir/sair da Relâmpago (LIGHTNING) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** permitir aderir/sair de promoções Relâmpago do ML pelo motor de operações em massa (ADR-0174), com travas de faixa, R$ 19 e estoque, e corrigir o semáforo da Relâmpago na Central.

**Architecture:** LIGHTNING vira o 3º `TipoPromocao` do motor. A leitura fresca combina a visão da campanha (status/`ref_id`) com a visão por item (faixa, sugerido, `stock.min`). O sync da Central enriquece convidados LIGHTNING pela visão por item, degradando a linha em falha. Front só repassa o tipo e trata preço editável/R$ 19/"reserva N un.".

**Tech Stack:** Deno Edge Functions (TypeScript), Supabase Postgres, React + Vite, vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-relampago-aderir-design.md` (ler inteiro, inclusive "Respostas do builder check" e "Ajustes obrigatórios").

## Global Constraints

- Preço mínimo da Relâmpago: **R$ 19,00** (`deal_price < 19` → recusa). Só LIGHTNING.
- Estoque enviado = `stock.min` da leitura fresca; nunca ausente, nunca acima do mínimo.
- Payload aderir: `{promotion_id, promotion_type:'LIGHTNING', deal_price, stock}`; sair: query `promotion_type=LIGHTNING&promotion_id={pid}&offer_id={OFFER-…}&app_version=v2`.
- DEAL e SMART não mudam de comportamento (todos os testes existentes continuam verdes sem edição de asserções).
- Testes: `pnpm test -- <arquivo>`; portão final: `pnpm preflight` (ver memória: não remontar checklist à mão).
- Migrations só por `supabase migration new` + `supabase db push` (ADR-0043). Dropdown sempre `ui/select`.
- Comentários e mensagens em pt-BR; mensagens de usuário exatas como neste plano.

## Review Focus

1. Convidado LIGHTNING cuja visão por item falhou no sync → `preco_max`/`preco_sugerido`/`preco_promo` null → semáforo `indisponivel`, validação recusa "O ML não informou a faixa de preço deste anúncio" (Task 3, teste `LIGHTNING sem faixa`).
2. Pedido LIGHTNING com `confirmado_risco: true` e preço 18,99 → ainda recusado (R$ 19 fora do atalho de risco) (Task 3 e Task 4).
3. Conferência de saída LIGHTNING com visão da campanha devolvendo `null` (item sumiu) → **não** confirma, reagenda (Task 4).
4. Estoque disponível 3 com `stock.min` 5 → `bloqueado`, sem POST (Task 3/4).
5. Linha de campanha com o mesmo MLB 2× (CANDIDATE + OFFER) → leitor escolhe a OFFER (Task 2).

---

### Task 1: Migration + emenda do ADR-0174

**Files:**
- Create: `supabase/migrations/<timestamp>_operacoes_massa_lightning.sql` (via `supabase migration new operacoes_massa_lightning`)
- Modify: `docs/decisions/0174-operacoes-em-massa-promocoes-v2.md` (nova seção no fim)

- [ ] **Step 1:** Migration: `alter table public.operacoes_massa drop constraint operacoes_massa_promocao_tipo_check;` + `add constraint operacoes_massa_promocao_tipo_check check (promocao_tipo is null or promocao_tipo = any (array['DEAL','SMART','LIGHTNING']));`
- [ ] **Step 2:** `npm run db:check` → sem erro. (Não fazer `db push` aqui — Task 7.)
- [ ] **Step 3:** Emenda "## Emenda 2026-11-02 — 3º tipo de promoção: Relâmpago (LIGHTNING)" no ADR-0174: resultado do spike (seção "Spike" do spec, resumida), decisões (R$ 19, estoque mínimo, leitura em duas visões, janela na mensagem, sync enriquecido) e referência ao spec.
- [ ] **Step 4:** Commit `feat(operacoes): migration aceita LIGHTNING + emenda ADR-0174`.

### Task 2: Cliente ML do motor (`_shared/operacoes/ml.ts`)

**Files:**
- Modify: `supabase/functions/_shared/operacoes/ml.ts`, `supabase/functions/_shared/operacoes/tipos.ts`
- Test: `supabase/functions/_shared/operacoes/__tests__/ml.test.ts`

**Interfaces — Produces:**
- `TipoPromocao = 'DEAL' | 'SMART' | 'LIGHTNING'`
- `ItemNaCampanha` ganha `estoque_min: number | null` (de `stock.min`; null fora de LIGHTNING ou ausente).
- `ItemNaCampanha.offer_id` = `offer_id ?? ref_id` (só strings `OFFER-`/`CANDIDATE-`).
- `interface OfertaNoItem { preco_min: number | null; preco_max: number | null; preco_sugerido: number | null; estoque_min: number | null; inicio: string | null; fim: string | null }`
- `ClienteML.lerOfertaNoItem(promocaoId: string, itemId: string): Promise<OfertaNoItem | null>` — `GET /seller-promotions/items/{id}?app_version=v2`, filtra `id === promocaoId && type === 'LIGHTNING'`; null = não aparece; 5xx com as mesmas 3 tentativas de `lerNaCampanha`; outro erro lança.
- `Relacoes` ganha `disponivel: number | null` (`available_quantity` do item, pedido no mesmo multiget: atributos `id,catalog_listing,item_relations,available_quantity`).
- `lerNaCampanha` com várias linhas do mesmo item: preferir a de status participando (`ehParticipando`), senão a primeira.

- [ ] **Step 1: testes que falham** em `ml.test.ts`:
  - `lerNaCampanha LIGHTNING lê ref_id e stock.min` — resposta `{results:[{id,ref_id:'OFFER-X-1',status:'pending',price:24.65,stock:{remaining_stock:5}}]}` → `{status:'pending', offer_id:'OFFER-X-1', estoque_min:null, ...}`; e candidate com `stock:{min:5,max:180}` → `estoque_min:5`, `offer_id:'CANDIDATE-…'`.
  - `lerNaCampanha prefere a linha participando` — 2 linhas (candidate, pending) → status `pending`.
  - `lerOfertaNoItem filtra a Relâmpago` — lista com SMART + LIGHTNING de outro id + LIGHTNING certo `{min_discounted_price:5.8,max_discounted_price:26.1,suggested_discounted_price:24.65,stock:{min:5,max:180}}` → `{preco_min:5.8, preco_max:26.1, preco_sugerido:24.65, estoque_min:5, inicio:null, fim:null}`; ausente → `null`.
  - `lerRelacoes devolve disponivel` — `available_quantity: 180` → `disponivel: 180`; ausente → `null`.
- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/operacoes/__tests__/ml.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; `pnpm test -- supabase/functions/_shared/operacoes` → tudo verde.
- [ ] **Step 5:** commit `feat(operacoes): leitura fresca da Relâmpago (ref_id, visão por item, estoque)`.

### Task 3: Decisão e validação (`decidir.ts`, `validar.ts`)

**Files:**
- Modify: `supabase/functions/_shared/operacoes/decidir.ts`, `supabase/functions/_shared/operacoes/validar.ts`
- Test: `__tests__/decidir.test.ts`, `__tests__/validar.test.ts`

**Interfaces:**
- Consumes: `ItemNaCampanha`, `OfertaNoItem`, `Relacoes` (Task 2).
- Produces: `decidir(acao, tipo, promocaoId, pedido, fresco, relacoes, oferta?: OfertaNoItem | null): Decisao` (novo 7º parâmetro opcional; só LIGHTNING usa). `export const PRECO_MIN_RELAMPAGO = 19` em `validar.ts`.

Regras LIGHTNING em `decidir` (aderir, após os checks atuais de participando/candidate/par catálogo):
1. `oferta == null` → `fim('erro', 'O ML não informou a oferta deste anúncio na Relâmpago')`.
2. `min = max(fresco.preco_min, oferta.preco_min)` (ignorando null); `max = oferta.preco_max`. Qualquer um null → `fim('erro', 'O ML não informou a faixa de preço deste anúncio')`.
3. `p == null || p < min || p > max` → `fim('mudou', 'A faixa de preço mudou: agora X a Y')` (mesmo texto da DEAL).
4. `p < 19` → `fim('bloqueado', 'Abaixo de R$ 19 o comprador perde o frete grátis')`.
5. Estoque: `e1 = fresco.estoque_min`, `e2 = oferta.estoque_min`; ambos null, ou ambos não-null e diferentes → `fim('erro', 'O ML não informou o estoque mínimo da oferta')`; `stock = e1 ?? e2`.
6. `relacoes?.disponivel == null` → `fim('bloqueado', 'O ML não informou o estoque disponível do anúncio')`; `< stock` → `fim('bloqueado', 'Estoque disponível (N) menor que o mínimo da Relâmpago (M)')`.
7. → `{tipo:'post', body:{promotion_id, promotion_type:'LIGHTNING', deal_price:p, stock}}`.
Sair LIGHTNING: `fresco.offer_id` começa com `OFFER-` → delete com a query do Global Constraints; senão `fim('erro', 'O ML não informou a oferta deste anúncio')`.

`validarPedido`: `TIPOS` inclui `'LIGHTNING'`; mensagem de tipo inválido vira `'Só promoções DEAL, SMART e Relâmpago aceitam operação em massa.'` (atualizar o teste existente). Aderir LIGHTNING reusa o ramo de preço da DEAL (preço do pedido, faixa fechada, mesma mensagem) **e** depois `p < 19` → recusa `'Abaixo de R$ 19 o comprador perde o frete grátis'` — antes do semáforo, independe de `confirmado_risco`.

- [ ] **Step 1: testes que falham:**
  - decidir: `LIGHTNING aderir monta POST com stock` (fresco candidate `preco_min 8.7, estoque_min 5`, oferta `5.8/26.1/24.65/5`, disponivel 180, preço 24.65) → `{tipo:'post', body:{promotion_id:'LGH-1', promotion_type:'LIGHTNING', deal_price:24.65, stock:5}}`; `min efetivo é o maior` (preço 8 → `mudou`); `sem oferta → erro`; `faixa null → erro`; `18.99 → bloqueado`; `estoque divergente 5×6 → erro`; `disponivel null → bloqueado`; `disponivel 3 < 5 → bloqueado`; `sair com OFFER → delete query exata`; `sair com CANDIDATE → erro`.
  - validar: `LIGHTNING aderir preço fora da faixa → motivo`; `LIGHTNING sem faixa → 'O ML não informou a faixa de preço deste anúncio'`; `LIGHTNING 18.99 com confirmado_risco → recusa R$ 19`; `LIGHTNING válido → ok com preco`; teste de tipo inválido usa `'OUTRO'`.
- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/operacoes/__tests__/decidir.test.ts supabase/functions/_shared/operacoes/__tests__/validar.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; suíte `_shared/operacoes` verde.
- [ ] **Step 5:** commit `feat(operacoes): decisão e validação da Relâmpago (faixa, R$ 19, estoque)`.

### Task 4: Executor e conferência (`executar.ts`)

**Files:**
- Modify: `supabase/functions/_shared/operacoes/executar.ts`
- Test: `__tests__/executar.test.ts`

**Interfaces — Consumes:** Task 2 (`lerOfertaNoItem`, `Relacoes.disponivel`), Task 3 (`decidir` 7º parâmetro, `PRECO_MIN_RELAMPAGO`).

Mudanças:
1. `processarItem`: se `op.promocao_tipo === 'LIGHTNING' && op.acao === 'aderir' && fresco?.status === 'candidate'` → `oferta = await ml.lerOfertaNoItem(...)` e passa a `decidir`.
2. O atalho `if (!it.confirmado_risco)` continua só para o semáforo; R$ 19 e faixa já estão em `decidir` (antes dele) — teste garante.
3. Após POST LIGHTNING: reler `lerOfertaNoItem` (catch → null); com `inicio`/`fim` → `mensagem: 'Agendada: dd/mm hh:mm–hh:mm'` (fuso `America/Sao_Paulo`, formato `pt-BR`), gravada no mesmo `gravarItem` do `aplicado` (gravar `aplicado` primeiro sem mensagem, depois atualizar mensagem — best-effort). Ajuste: `lerOfertaNoItem` também devolve `inicio`/`fim` de `start_date`/`finish_date` (Task 2 já define os campos).
4. `conferir`: para LIGHTNING, `fresco === null` **não** confirma (reagenda como "ainda não saiu"); só `fresco.status === 'candidate'` confirma. DEAL/SMART inalterados.
5. Espelho `saiu` de LIGHTNING → `candidate` (já é o comportamento de não-SMART em `deps.ts:141`; teste no executor/deps garante).

- [ ] **Step 1: testes que falham:** `LIGHTNING aderir: POST com stock e mensagem de janela` (oferta pós-POST `inicio '2026-11-06T00:00:00', fim '2026-11-06T11:59:59'` → mensagem `'Agendada: 06/11 00:00–11:59'`); `LIGHTNING 18.99 com confirmado_risco não posta`; `conferir LIGHTNING null reagenda`; `conferir LIGHTNING candidate confirma e espelha saiu`.
  - Nota: o spike mostrou `start_date` sem fuso (`2026-11-06T00:00:00`); tratar como horário local de Brasília (não converter).
- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/operacoes/__tests__/executar.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS; suíte `_shared/operacoes` verde.
- [ ] **Step 5:** commit `feat(operacoes): executor e conferência da Relâmpago`.

### Task 5: Sync da Central enriquece a Relâmpago (`_shared/promocoes`)

**Files:**
- Modify: `supabase/functions/_shared/promocoes/ml.ts`, `supabase/functions/_shared/promocoes/sincronizar.ts`, `supabase/functions/_shared/promocoes/deps.ts`
- Test: `__tests__/ml.test.ts`, `__tests__/sincronizar.test.ts`

**Interfaces — Produces:**
- `promocoes/ml.ts`: `lerOfertaRelampago(get: GetJson, promocaoId: string, itemId: string): Promise<{ preco_min: number | null; preco_max: number | null; preco_sugerido: number | null } | null>` (mesmo filtro id+type da Task 2).
- `DepsLeitura.ofertaRelampago(itemId: string): Promise<{ preco_min; preco_max; preco_sugerido } | null>` (fiação em `deps.ts`).
- `sincronizar.ts`: `export function comOfertaRelampago(it: ItemPromocaoML, o: {...} | null): ItemPromocaoML` — puro: convidado (`candidate`): `preco_promo = null`, `preco_min = max(it.preco_min, o.preco_min)` (ignorando null), `preco_max = o?.preco_max ?? null`, `preco_sugerido = o?.preco_sugerido ?? null`; participando: inalterado.

Em `sincronizarPromocao`, só quando `msg.tipo === 'LIGHTNING'`: dentro do callback de `emParalelo` (antes de `projetarItem`), `const o = it.status === 'candidate' ? await deps.ofertaRelampago(it.ml_item_id).catch((e) => { console.warn(...); return null; }) : null` e usar `comOfertaRelampago(it, o)`. Nunca deixa a exceção chegar ao `catch` que chama `falhar`.

- [ ] **Step 1: testes que falham:** `comOfertaRelampago convidado` (it `preco_promo 28.13, preco_min 8.7` + o `5.8/26.1/24.65` → `preco_promo null, preco_min 8.7, preco_max 26.1, preco_sugerido 24.65`); `comOfertaRelampago null degrada` (→ max/sugerido/promo null); `participando inalterado`; `sincronizarPromocao LIGHTNING: ofertaRelampago lança → rodada conclui e linha sem faixa`; `DEAL não chama ofertaRelampago`; `lerOfertaRelampago filtra id+type`.
- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/promocoes` → FAIL nos novos.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS; suíte `_shared/promocoes` verde.
- [ ] **Step 5:** commit `fix(promocoes): Central da Relâmpago usa faixa e sugerido da visão por item`.

### Task 6: Front

**Files:**
- Modify: `src/pages/PromocaoDetalhe.tsx` (`:90`, `:265`), `src/components/promocoes/preview-operacao.tsx`, `src/lib/operacoes.ts` (`montarPreview`), `src/lib/promocoes.ts:81` (`operavel`), `src/components/promocoes/lista-participando.tsx:83`, `src/components/operacoes/lista-operacoes.tsx:310`
- Test: `src/lib/__tests__/operacoes.test.ts`, `src/components/promocoes/__tests__/preview-operacao.test.tsx`, `src/pages/__tests__/PromocaoDetalhe.test.tsx`

**Interfaces:**
- `export type TipoPromocaoOperavel = 'DEAL' | 'SMART' | 'LIGHTNING'` em `src/lib/operacoes.ts`; `export const ehTipoOperavel = (t: string | null | undefined): t is TipoPromocaoOperavel`.
- `montarPreview(acao, tipo: TipoPromocaoOperavel, itens)`: aderir LIGHTNING usa `preco_sugerido` (como DEAL).
- `PreviewOperacao` prop `tipo: TipoPromocaoOperavel`; `podeEditarPreco = acao === 'aderir' && (tipo === 'DEAL' || tipo === 'LIGHTNING')`; `precoInvalido` também `tipo === 'LIGHTNING' && preco < 19`, com texto sob o input `'Mínimo R$ 19,00 (frete grátis)'`; LIGHTNING aderir mostra por linha `Reserva {estoque_min} un.` quando `estoque_min != null`.
- Os 3 call sites trocam `x === 'SMART' ? 'SMART' : 'DEAL'` por `ehTipoOperavel(x) ? x : 'DEAL'`; `podeSelecionar` e `operavel` usam `ehTipoOperavel`.

- [ ] **Step 1: testes que falham:** `montarPreview LIGHTNING usa sugerido`; preview: `LIGHTNING preço editável`, `LIGHTNING 18,99 bloqueia envio e mostra 'Mínimo R$ 19,00 (frete grátis)'`, `mostra 'Reserva 5 un.'`; PromocaoDetalhe: `Relâmpago tem checkbox de seleção`.
- [ ] **Step 2:** `pnpm test -- src/lib/__tests__/operacoes.test.ts src/components/promocoes/__tests__/preview-operacao.test.tsx src/pages/__tests__/PromocaoDetalhe.test.tsx` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS; `pnpm test -- src/components/promocoes src/components/operacoes src/lib src/pages` verde.
- [ ] **Step 5:** commit `feat(promocoes): Relâmpago selecionável no app (preço, R$ 19, reserva)`.

### Task 7: Portão, revisão, merge e deploy

- [ ] **Step 1:** `pnpm preflight` → verde (inclui `deno lint`, `check:functions`, build, todos os testes).
- [ ] **Step 2:** docs: `docs/TASKS.md` + `docs/reference/edge-functions.md` (contrato LIGHTNING em operacoes-massa) — ver skill `docs-update-checklist`.
- [ ] **Step 3:** revisão do diff da branch pelo Codex `gpt-6.1-sol` high (read-only, `< /dev/null`); corrigir achados (rodada única), re-rodar preflight.
- [ ] **Step 4:** push da branch → CI verde (`frontend`, `backend-lint`).
- [ ] **Step 5:** `supabase db push` (migration) → conferir constraint no `pg_constraint`.
- [ ] **Step 6:** `supabase functions deploy operacoes-massa sincronizar-promocoes ads-campanhas coletar-ads-ml coletar-trafego-ml` → conferir versões novas.
- [ ] **Step 7:** merge fast-forward na `main` (`push origin <sha>:main`), `git pull --ff-only` no checkout principal, remover worktree/branch.
- [ ] **Step 8:** verificação em produção (só leitura): disparar sync de promoções da Avil e conferir em `ml_promocao_itens` da `LGH-MLB1000` que convidados têm `preco_sugerido`/`preco_max` preenchidos e `preco_promo` null.
