# Trava da oferta no UPDATE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recusar, antes de enfileirar, o UPDATE de um produto que levaria o preço base a igual ou abaixo de uma oferta vigente ou agendada do Mercado Livre.

**Architecture:** Uma checagem em `publicar-familias`, antes da reserva, para famílias com anúncio no ar e sem "somente estoque". Lê o preço vivo em lote, e só para o MLB cujo preço novo fica abaixo do vivo lê as ofertas. O produto reprovado volta em `recusadas`, que a tela já mostra, e nada é escrito nem reservado. Reaproveita `lerOfertas`, `unirOfertas`, `motivoTravaOferta` e `ofertasBanco` do ADR-0196.

**Por que aqui, e não nos workers:** o desenho anterior foi reprovado pelo Codex: os workers têm várias formas de escrever preço, recusar dentro deles prende retomadas de saga, e a migração para User Products só é descoberta no meio. Como o UPDATE herda o preço no ar (ADR-0016, adendo 2026-10-16), só preço editado para baixo cria o risco, e isso se decide antes de enfileirar.

**Tech Stack:** Deno Edge Functions, vitest.

**Spec:** decisão do Diego em 2026-11-07: recusar com motivo; só esse produto, os demais do lote seguem; "somente estoque" continua disponível. Emenda o item 9 do ADR-0174, que só avisava.

## Global Constraints

- A checagem roda antes de `reservarFamilias`: produto recusado não muda de status e não tem foto enviada.
- Motivo: `Preço igual ou abaixo da oferta de R$ X — ajuste a oferta antes`. Leitura inconclusiva recusa o produto com `Não foi possível conferir promoções — tente de novo`, sem retry automático.
- Só compara MLB onde `preço novo < preço vivo`. Preço igual ou maior que o vivo não cria risco.
- Valores em centavos via `alvo.ts`. Sem migration.
- Limite aceito e documentado: oferta nova, ou preço editado inline, entre o clique e o worker normal não é detectado. A fila é curta; o reconciliador, que roda depois, tem checagem própria.
- Orçamento total de 20 s para a checagem de uma requisição. O que não for conferido a tempo é recusado com `Não foi possível conferir promoções — tente de novo`, e os demais seguem para reserva e fila.
- Testes: `pnpm exec vitest run <caminho>`; portão: `pnpm preflight:static`.

## Review Focus

1. Família UP com preços diferentes por cor: cada MLB compara com o preço da própria cor, por SKU.
2. Família em partições: cada partição compara com o preço das suas cores.
3. Lote com CREATE e UPDATE misturados: CREATE nunca é barrado.
4. MLB encerrado sai dos alvos, sem recusa: não há oferta a perder, e o worker procura o sucessor. MLB sem resposta do ML: recusa com motivo, sem derrubar o lote.
5. `somente_estoque_overrides` por família: vale a mesma resolução de `resolverSomenteEstoque`.

---

### Task 1: Checagem pura e dependências

**Files:**
- Create: `supabase/functions/_shared/publicacao/trava-oferta.ts`
- Modify: `supabase/functions/_shared/operacoes/reajuste/deps.ts` (exportar a consulta de `ofertasBanco`, se ainda presa a `depsPreview`)
- Test: `supabase/functions/_shared/publicacao/__tests__/trava-oferta.test.ts`

**Interfaces:**
- Produces:
  - `AlvoFamilia { familia_id: string; itens: { ml_item_id: string; preco: number }[] }`
  - `DepsTravaOferta { precosVivos(ids: string[]): Promise<Map<string, number | null | typeof ENCERRADO>>; lerOfertas(id: string): Promise<OfertaVigente[] | null>; ofertasBanco(ids: string[]): Promise<Map<string, OfertaVigente[]>> }`
  - `recusasPorOferta(alvos: AlvoFamilia[], deps: DepsTravaOferta): Promise<{ familia_id: string; motivo: string }[]>`: nunca lança por item; `precosVivos` usa `/items/bulk`; preço vivo nulo em item alvo = inconclusivo.

- [ ] **Step 1: Escrever os testes**

```ts
// preço novo ≥ vivo → não lê ofertas, sem recusa
// preço novo < vivo e > oferta → sem recusa
// preço novo < vivo e ≤ oferta → recusa com o valor da oferta
// oferta só no banco → recusa
// lerOfertas null → recusa 'Não foi possível conferir promoções — tente de novo'
// oferta sem preço → recusa inconclusiva
// preço vivo nulo → recusa inconclusiva
// 2 famílias, 1 reprovada → só ela volta
// família com 2 MLBs, 1 reprovado → 1 recusa
// exceção em precosVivos → recusa inconclusiva para as famílias, sem lançar
// orçamento vencido no meio → conferidas seguem a regra, não conferidas recusam 'tente de novo'; resolve dentro do orçamento
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar**, com `pool(5, …)` só sobre os MLBs que descem, timeout de 10 s por leitura e `orcamentoMs` (padrão 20000) em `recusasPorOferta`: ao vencer, não inicia novas leituras e recusa o que faltou.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(publicacao): checagem de preço contra oferta antes do UPDATE`

---

### Task 2: Ligar em publicar-familias

**Files:**
- Modify: `supabase/functions/publicar-familias/index.ts`, `supabase/functions/reconciliar-convergencia-up/processar.ts`, `supabase/functions/_shared/user-products/atualizar-familia-up.ts`, `src/pages/Revisao.tsx`
- Test: teste de `publicar-familias`, teste de `reconciliar-convergencia-up`, `src/pages/__tests__/Revisao.test.tsx`

**Interfaces:**
- Consumes: `recusasPorOferta`.

- [ ] **Step 1: Escrever os testes**

```ts
// produto reprovado não é reservado nem enfileirado e volta em `recusadas`; o outro do lote segue
// somente_estoque_global e override → checagem não roda para ele
// CREATE (sem ml_item_id) → checagem não roda
// família Legacy: alvo { familia.ml_item_id, preço da família }
// família UP: um alvo por item com `item_externo_id` e SKU desejado, em qualquer status (`ativo`, `criado`, retirado que será readicionado), preço da cor; preço nulo não entra; item que sai da composição não entra
// chamada de Adicionar variação, que preserva preços publicados: checagem não roda
// família em partições: alvo por partição, com o menor preço das cores dela
// sem conexão ML → comportamento atual, sem recusa nova (o worker já trata)
// reconciliador: alvo reprovado ou inconclusivo → chama a saga com `semPrecoPara` (SKUs reprovados), conclui a composição e registra o motivo em `familias`
// saga: SKU em `semPrecoPara` não tem `price` no payload real de reposição, inclusive filho `criado` e readicionado
// reconciliador: alvo aprovado → comportamento atual
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Antes de `reservarFamilias`, carregar `familias` de `familia_ids` com `ml_item_id` e `codigo_pai`, resolver `resolverSomenteEstoque`, montar os alvos a partir de `variacoes` não excluídas e de `anuncios_externos`/`anuncios_externos_itens`, chamar `recusasPorOferta`, tirar os ids reprovados da lista passada às duas reservas e somar os motivos em `recusadas`. Tudo atrás de `incluiML`. Em `reconciliar-convergencia-up/processar.ts`, antes da saga, montar os mesmos alvos e chamar `recusasPorOferta`; os SKUs reprovados vão em `semPrecoPara: string[]`, argumento novo de `atualizarFamiliaUP`, que anula o preço desses SKUs em `precoPorSku` em qualquer status (`preservarPublicadas` só cobre filhos já ativos). Extrair a montagem dos alvos para `trava-oferta.ts`, usada pelos dois. `Revisao.tsx`: o aviso diz que preço igual ou abaixo da oferta será recusado.
- [ ] **Step 4: Rodar e ver passar.** `pnpm test`, `pnpm preflight:static`.
- [ ] **Step 5: Commit.** `feat(publicacao): UPDATE recusa preço igual ou abaixo da oferta`

---

### Task 3: Documentação e entrega

**Files:** `docs/decisions/0196-…`, `docs/decisions/0174-…`, `docs/reference/edge-functions.md`, `docs/TASKS.md`, `obsidian-vault/03-Módulos/Promoções.md`, `obsidian-vault/09-Logs/Changelog.md`

- [ ] **Step 1: Emendar ADR-0196 e o item 9 do ADR-0174; atualizar as referências.**
- [ ] **Step 2: Revisão do diff pelo Codex `gpt-6.1-sol` high.**
- [ ] **Step 3: Deploy só com o OK do Diego:** `publicar-familias`, `reconciliar-convergencia-up` e o que o grafo de imports apontar; depois merge fast-forward com CI verde.
