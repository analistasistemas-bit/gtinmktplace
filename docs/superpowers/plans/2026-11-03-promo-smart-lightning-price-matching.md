# SMART_LIGHTNING + PRICE_MATCHING + aviso de tipo novo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** aderir/sair de SMART_LIGHTNING e PRICE_MATCHING pelo motor de operações em massa (ADR-0174) e avisar quando o ML trouxer um tipo que o app não sabe aderir.

**Architecture:** os dois viram tipos de **oferta de preço fixo** do motor (como SMART: o POST manda `offer_id`, o preço é o do ML), com travas extras que a SMART não tem: preço revalidado na execução, piso R$ 19, saída só provada por `candidate`. SMART_LIGHTNING ainda exige `stock`.

**Tech Stack:** Deno Edge Functions, Postgres, React + Vite, vitest.

## Spike (03/11/2026, autorizado, desfeito) — fonte de verdade

- **SMART_LIGHTNING** (Avil `MLB5048402257`, `P-MLB18055120`). Visão da campanha do convidado: `{status:'candidate', price:64, original_price:69.9, offer_id:'CANDIDATE-…', meli_percentage, seller_percentage, stock:{min:5,max:197}}`, sem min/max/sugerido. `POST {promotion_id, promotion_type:'SMART_LIGHTNING', offer_id:<CANDIDATE>, stock:5}` → 201 `{offer_id:'OFFER-…', price:64, original_price, start_date:'2026-11-04T12:00:00', end_date:'2026-11-04T23:59:59'}` (janela de 12 h do ML, horário de Brasília). Vira `pending` com `start_date`/`end_date` em UTC (`…Z`).
- **PRICE_MATCHING** (DSA `MLB5114275523`, `P-MLB18099366`). Convidado: `{status:'candidate', price:69.98, offer_id:'CANDIDATE-…', start_date, end_date}`, sem stock. `POST {promotion_id, promotion_type:'PRICE_MATCHING', offer_id}` → 201 `{offer_id, price, original_price}`; fica **`started` na hora** (no ar por 7 dias).
- **Atraso:** nos dois, logo após o POST as duas visões seguem `candidate` com `CANDIDATE-…`; em ~2 min mostram `OFFER-…`.
- **Saída:** `DELETE /seller-promotions/items/{id}?promotion_type=<T>&promotion_id=<P>&offer_id=<OFFER-…>&app_version=v2` → 200 vazio; ≤ 5 min volta a `candidate` (inclusive PRICE_MATCHING já `started`). A linha NÃO some da campanha.

## Global Constraints

- DEAL, SMART e LIGHTNING não mudam de comportamento. Só ajustar asserções existentes onde o contrato cresce.
- **Piso R$ 19 vale também para SMART_LIGHTNING e PRICE_MATCHING** (mesmo motivo do frete grátis; preço fixo → o item é recusado/bloqueado). Independe de `confirmado_risco`. Mensagem: `'Abaixo de R$ 19 o comprador perde o frete grátis'`.
- `stock` enviado = `stock.min` da leitura fresca (só SMART_LIGHTNING); ausente → erro sem POST.
- Sem alterar preço e sem simulação nesses tipos.
- Testes: `pnpm exec vitest run <paths>`; portão final `pnpm preflight`. Migrations só via `supabase migration new` + `db push`.

## Review Focus

1. Preço da oferta mudou no ML entre o preview e a execução → `mudou`, sem POST (Task 2).
2. Preço fresco < 19 com `confirmado_risco: true` → `bloqueado`, sem POST (Task 2).
3. `sair` logo após aderir (atraso de 2 min: ML ainda diz `candidate`) → `mudou` com pedido para tentar de novo; **nunca** `ja_estava` nem espelho de saída. Retry após crash pós-POST/pós-DELETE nunca repete a escrita (Task 2).
4. `alertas_promocoes_ativo = false` (está assim nas 6 orgs) → aviso de tipo novo sai mesmo assim, 1x por org+tipo (Task 3).
5. Convidado com `preco_promo` null → recusado, nunca POST às cegas (Task 2).

---

### Task 1: Migration + emenda do ADR-0174

- `supabase migration new operacoes_massa_tipos_oferta`: drop/add `operacoes_massa_promocao_tipo_check` com `'DEAL','SMART','LIGHTNING','SMART_LIGHTNING','PRICE_MATCHING'`.
- ADR-0174: "## Emenda 2026-11-03 — SMART_LIGHTNING e PRICE_MATCHING": spike acima (resumo), decisões, aviso de tipo novo.
- `npm run db:check`. Commit `feat(operacoes): migration aceita SMART_LIGHTNING e PRICE_MATCHING + emenda ADR-0174`.

### Task 2: Motor (`_shared/operacoes/`)

**Files:** `tipos.ts`, `ml.ts`, `decidir.ts`, `validar.ts`, `executar.ts`; testes em `__tests__/`.

**Interfaces:**
- `TipoPromocao` ganha `'SMART_LIGHTNING' | 'PRICE_MATCHING'`.
- `tipos.ts`: `export const ofertaFixaNova = (t: string): t is 'SMART_LIGHTNING'|'PRICE_MATCHING'`.
- `ml.ts`: `lerNaCampanha` lê `stock.min` também em SMART_LIGHTNING. `ClienteML.post` devolve `{ offer_id, inicio: string|null, fim: string|null }` (`start_date`/`end_date` da resposta).

**`decidir` (aderir, depois dos checks de participando/candidate/par catálogo)**, função `aderirOfertaFixa(tipo, promocaoId, pedido.preco, fresco, relacoes)`:
1. `fresco.offer_id` não começa com `CANDIDATE-` → `fim('erro','O ML não informou a oferta deste convite')`.
2. `fresco.preco == null` → `fim('erro','O ML não informou o preço da oferta')`.
3. `pedido.preco == null` ou centavos(`fresco.preco`) ≠ centavos(`pedido.preco`) → `fim('mudou', 'O preço da oferta mudou: agora X')`.
4. `fresco.preco < PRECO_MIN_RELAMPAGO` → `fim('bloqueado','Abaixo de R$ 19 o comprador perde o frete grátis')`.
5. Só SMART_LIGHTNING: `fresco.estoque_min == null` → `fim('erro','O ML não informou o estoque mínimo da oferta')`; `relacoes?.disponivel == null` → `fim('bloqueado','O ML não informou o estoque disponível do anúncio')`; `disponivel < estoque_min` → `fim('bloqueado','Estoque disponível (N) menor que o mínimo da oferta (M)')`.
6. → `{tipo:'post', body:{promotion_id, promotion_type:tipo, offer_id, ...(SMART_LIGHTNING ? {stock} : {})}}`.

**`decidir` (sair)**, função `sairOfertaFixa(tipo, promocaoId, fresco)`:
- `fresco?.status === 'candidate'` → `fim('mudou','O ML ainda mostra este anúncio como convidado. Se aderiu agora há pouco, aguarde 2 minutos e tente de novo.')`. Não é `ja_estava`: logo após aderir a visão atrasa e `candidate` não prova saída; `ja_estava` espelharia saída falsa.
- `fresco === null` ou não participando → `fim('erro','O ML não mostra este anúncio na campanha. Confira no Seller Center.')`.
- participando sem `OFFER-` → `fim('erro','O ML não informou a oferta deste anúncio')`.
- senão → `delete` com a query do spike.

**`validarPedido`:** `TIPOS` inclui os dois; mensagem de tipo inválido `'Este tipo de promoção ainda não aceita operação em massa.'`. Aderir nos dois tipos novos: `l.preco_promo == null` → recusa `'O ML não informou o preço da oferta'`; `it.preco` (preço exibido no preview) ausente ou diferente em centavos de `l.preco_promo` → recusa `'O preço da oferta mudou: agora X'`; `< 19` → recusa R$ 19, antes do semáforo. O preço gravado é o do pedido, que `decidir` compara com a leitura fresca.

**`executar.ts` — idempotência (revisão Codex P1/P2; reusar o padrão `etapa='escrita_pedida'` + `FalhaPosEscrita` de `alterarPreco`, `executar.ts:83-127`):**
- Só nos tipos novos, ANTES do POST e do DELETE: gravar `etapa:'escrita_pedida'` (no DELETE, também o `offer_id` OFFER observado). `itensPendentes`/leitura dos itens em `deps.ts:23` passa a carregar `offer_id`.
- Timeout/erro ambíguo depois da etapa gravada = retorno normal: fica `enviando` com a etapa e `finalizar` publica `continuar(150)` (500 mataria a mensagem com 4 timeouts seguidos). 4xx claro do ML = `erro` com a mensagem do ML.
- **Retomada de aderir** (`etapa==='escrita_pedida'`): NUNCA posta de novo. Participando → `aplicado` com o `offer_id` lido + espelho. Ainda `candidate`, fora da campanha ou leitura falha → conta em `conferencias` e retorna sem lançar (fica `enviando`; `finalizar` publica `continuar(150)` com 200; revisão Codex final). Na 5ª, `erro` `'Não foi possível confirmar a adesão no ML. Confira no Seller Center.'` mantendo a etapa.
- **Retomada de sair** (`etapa==='escrita_pedida'`): `candidate` → saída concluída (`aplicado` + espelho `saiu`); participando → `saida_solicitada` com a escada de conferência (sem novo DELETE).
- Sem evidência anterior, sair com `candidate` segue a regra de `sairOfertaFixa` (`mudou`, pede para tentar de novo).
- Etapa por transição atômica (`adquirirEscrita`: `status='enviando'` e `etapa IS NULL`); só quem adquiriu escreve. Antes do POST, `adesaoRecente` (outra operação `aderir` do item com etapa `escrita_pedida` ou `aplicado`/`ja_estava` nos últimos 30 min; depois disso `candidate` é aceito como verdade) → `mudou` `'Adesão recente ainda propagando no ML. Aguarde alguns minutos e tente de novo.'`. Recusa clara do POST limpa a etapa. Todo desfecho antes da escrita (mudou, bloqueado, erro, exceção) passa pela mesma condição: worker que perdeu a posse não altera a linha.

**`executar.ts` — demais:**
- `conferir`: `ofertaFixaNova` segue a regra da Relâmpago (só `candidate` confirma; `null` reagenda). Confirmada a saída, se `fresco.preco != null`, `espelharPreco(promocao, id, fresco.preco)` best-effort: o novo convite pode ter outro preço e o sync agora é 1x/dia.
- Espelho pós-aderir nos tipos novos, com a releitura ainda `candidate`: SMART_LIGHTNING → `'pending'`, PRICE_MATCHING → `'started'` (status da campanha não vale para o item).
- Após POST SMART_LIGHTNING: se `inicio`/`fim` vierem na resposta, `mensagemJanela` → grava no item (best-effort).
- `espelharPreco` pós-POST roda nos tipos novos (a condição atual `tipo !== 'SMART'` já cobre; a exceção financeira da SMART não se estende).
- Espelho `saiu` → `candidate` (já é o caminho não-SMART de `deps.ts`).

- [ ] Testes que falham (decidir/validar/executar/ml) cobrindo cada regra acima e o Review Focus 1, 2, 3, 5, com os payloads do spike.
- [ ] Implementar; `pnpm exec vitest run supabase/functions/_shared/operacoes` verde; `pnpm lint:functions`, `pnpm check:functions`.
- [ ] Commit `feat(operacoes): SMART_LIGHTNING e PRICE_MATCHING no motor`.

### Task 3: Aviso de tipo novo (`_shared/promocoes/alertas.ts`)

- `export const TIPOS_SUPORTADOS = new Set(['DEAL','SMART','LIGHTNING','SMART_LIGHTNING','PRICE_MATCHING','SELLER_COUPON_CAMPAIGN'])` (cupom é criado pelo vendedor: não é tipo a aderir).
- `PromoAlerta` ganha `tipo`; `lerPromocoes` seleciona `tipo`.
- `export function tiposNovos(promos: PromoAlerta[]): { tipo: string; nome: string | null }[]` — puro, um por tipo fora de `TIPOS_SUPORTADOS`.
- `DepsAlertas`: novo `notificarTipoNovo(texto, tipo)` = `notificarCategoria(admin, orgId, 'integracao', texto, { chave: `promo_tipo_novo:${tipo}` })`. Usa `opcoes.chave`: entrega persistente no sino, leitura estrita, Telegram só 1x por usuário+chave. **Sem `reservar` antes** (revisão Codex: reserva consumida sem entrega calaria o aviso para sempre).
- `avisarPromocoes`: **antes** do gate `ativo()`, para cada tipo novo chama `notificarTipoNovo` com: `🆕 Promoções: o ML trouxe um tipo de campanha que o PubliAI ainda não ativa\nTipo: <TIPO>\nCampanha: <nome>\nPor enquanto, adira pelo Seller Center.` Falha no aviso não pode impedir os outros alertas nem o sync (try/catch + `console.warn`).
- [ ] Testes em `__tests__/alertas.test.ts`: `tipo novo avisa com alertas desligados`, `usa chave promo_tipo_novo:<tipo>`, `falha numa rodada é reenviada na seguinte`, `tipo suportado não avisa`, `erro no aviso não derruba`.
- [ ] Commit `feat(promocoes): aviso de tipo de campanha novo`.

### Task 4: Front

- `src/lib/promocoes.ts`: `TipoPromocaoOperavel`/`ehTipoOperavel` com os dois; `TIPOS` ganha `SMART_LIGHTNING: 'Relâmpago co-participação'`; `export const ehTipoSoSellerCenter = (t) => !ehTipoOperavel(t) && t !== 'SELLER_COUPON_CAMPAIGN'`.
- `src/lib/operacoes.ts` `montarPreview`: aderir usa `preco_sugerido` só em DEAL/LIGHTNING; os demais `preco_promo` (hoje é `tipo !== 'SMART'` — pegaria o sugerido null).
- `preview-operacao.tsx`: preço não editável nos tipos novos, mas **enviado no pedido** (o preço exibido; hoje o não editável vai `null`, `:183`); bloqueio de `preco == null` ou `< 19` **só em aderir**, com `'Mínimo R$ 19,00 (frete grátis)'` (sair continua livre); `Reserva N un.` também em SMART_LIGHTNING; PRICE_MATCHING aderir mostra aviso `'Entra no ar assim que você confirmar.'`.
- `src/lib/promocao-simulacao.ts`: sem mudança (`podeSimular` já restringe).
- `lista-operacoes.tsx:108` (retentativa): preço do log só em DEAL/LIGHTNING e `alterar_preco`; nos tipos de oferta fixa a retentativa usa o preço atual da Central.
- `PromocaoDetalhe.tsx`: com `ehTipoSoSellerCenter(promo.tipo)`, aviso `'Este tipo de campanha ainda não pode ser ativado pelo PubliAI. Use o Seller Center.'`.
- [ ] Testes: `montarPreview` dos dois tipos; preview (preço travado, 18,99 bloqueia, reserva, aviso PRICE_MATCHING); PromocaoDetalhe (checkbox nos dois; aviso em `VOLUME`; o teste atual de não operável com `PRICE_DISCOUNT` continua); lista-operacoes (Reverter com tipo mantido; retentativa não injeta preço antigo nos tipos novos); pedido enviado leva o preço exibido.
- [ ] `pnpm lint`, `pnpm exec tsc -b`. Commit `feat(promocoes): SMART_LIGHTNING e Preço competitivo selecionáveis`.

### Task 5: Portão, revisão, deploy

- `pnpm preflight`; docs (`TASKS.md`, `edge-functions.md`, vault Promoções/Changelog/índice ADR).
- Revisão Codex gpt-6.1-sol high da branch; corrigir (rodada única).
- Push → CI verde → `supabase db push` → conferir constraint → deploy das edges que importam `_shared/operacoes` e `_shared/promocoes/alertas.ts` (descobrir por grep de imports; incluir transitivos) → conferir versões → merge ff → `pull --ff-only`, limpar branch/worktree.
