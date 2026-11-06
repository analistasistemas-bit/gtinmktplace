# Alterar preço em Publicados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir definir o preço base de um ou vários anúncios em Publicados, inclusive em promoção e com atacado, sem o ML remover a oferta e sem faixa de atacado acima do base.

**Architecture:** Estende o handler `reajustar` do motor de operações (ADR-0178), sem ação nova. Cada item vira uma lista ordenada de **passos** duráveis (`saida`, `oferta`, `faixas`, `base`) gravada em `operacoes_massa_itens.passos`. A ordem é calculada por uma função pura que prova as invariantes em cada estado intermediário. `etapa='ml_confirmado'` passa a significar "todos os passos confirmados", então a retomada existente segue correta. O ML fica atrás de `ClienteReajusteML`.

**Tech Stack:** Deno Edge Functions, Postgres (Supabase), React + TanStack Query, vitest.

**Spec:** `docs/decisions/0196-alterar-preco-em-publicados-com-oferta-e-atacado.md` (e `docs/decisions/0178-reajuste-de-preco-em-massa.md`, que este plano emenda).

## Global Constraints

- Nunca deixar preço base igual ou abaixo de oferta vigente ou agendada em nenhum estado intermediário (ADR-0196, decisão 3). Oferta com saída confirmada deixa de contar.
- Nenhuma faixa de atacado igual ou acima do preço base em nenhum estado intermediário (decisão 7).
- Todo preço que será escrito (base, cada faixa, cada oferta) passa pela trava financeira, inclusive "só faixas" e Reverter.
- Valores monetários em centavos half-up via `alvo.ts`; nunca comparar `number` de reais direto.
- Leitura inconclusiva do ML = não escreve.
- Executar e Reverter: só admin e suporte full. Teto `MAX_MLBS = 500`.
- Migrations só por `supabase migration new` + `supabase db push`; validar com `npm run db:check`. Toda migration consumida pelo código atualiza `src/lib/database.types.ts` na mesma task.
- Campo novo em item ou confirmação percorre o contrato inteiro: `CamposItem`, `linhasDoRascunho`, `lerConfirmar`, `Confirmacao`, hooks de `useOperacoes`, RPC.
- Tela nova ou alterada: `Select` de `src/components/ui/select.tsx`, nunca `<select>` nativo.
- Modelo de execução: tasks com migration, escrita no ML ou dinheiro não descem de `opus`.
- Testes: `pnpm test -- <caminho>`; portão de pré-push: `pnpm preflight:static`.
- Nenhuma escrita em anúncio real fora do app, exceto os testes da Task 0, com MLB aprovado pelo Diego.

## Review Focus

1. Anúncio entra em promoção entre o preview e a execução (ML reconvida SMART sozinho): a execução reavalia e termina `mudou`, sem escrita. Teste na Task 7.
2. Adesão recém-aplicada ainda propagando (`aplicado` no motor, `candidate` no ML): conta como oferta por 30 min. Teste na Task 2.
3. Crash depois do ML aplicar e antes de gravar o passo: a retomada reconcilia por GET antes de qualquer trava. Teste na Task 7.
4. Reverter depois que alguém editou o atacado ou surgiu oferta nova: item fica `fora`. Teste na Task 7.
5. Família com % editado em que um anúncio falha: a configuração da família não muda e a operação diz isso. Teste na Task 8.

## Fatias e portões

| Fatia | Tasks | Depende de |
|---|---|---|
| 1. Base acima da oferta + atacado | 1–9 | Testes 1 e 2 da Task 0 |
| 2. DEAL baixa a oferta antes | 10 | Teste 3 |
| 3. SMART/Relâmpago saem e recolocam | 11 | Teste 4 |
| 4. Catálogo e Kit | 12 | Testes 5 e 6 + plano complementar |

Cada fatia é entregável sozinha, com a Task 13 ao fim de cada uma. Resultado que contrarie o ADR volta ao Diego. Sem o Teste 2 concluído, Relâmpago `started` fica `fora`.

---

### Task 0: Testes reais no ML (portão)

**Files:** Modify: `docs/decisions/0196-alterar-preco-em-publicados-com-oferta-e-atacado.md` (seção de medição).

Cada teste exige o MLB aprovado pelo Diego antes da escrita, e restaura o estado original ao fim.

- [ ] **Step 1: Reler os anúncios do teste de 06/11 depois de horas,** sem escrita: oferta segue ativa, e qual "de" aparece no anúncio público depois de mudar o base.
- [ ] **Step 2: Teste 1 — Legacy com variações em promoção.** `PUT {variations:[{id, price}]}` ±R$ 1. Esperado: oferta intacta.
- [ ] **Step 3: Teste 2 — Relâmpago `started`.** Base ±R$ 1 durante a janela. Esperado: oferta intacta.
- [ ] **Step 4: Teste 3 — `PUT deal_price` em DEAL `pending`, e descida da oferta seguida da descida do base em DEAL `started`.** Mede aceite, reflexo e `ERROR_CREDIBILITY_DISCOUNTED_PRICE`.
- [ ] **Step 5: Teste 4 — Sair de SMART e de Relâmpago `pending`, baixar o base, ler o convite e readerir.** Mede tempo de saída, prova de saída por tipo, reconvite, faixa nova e âncora.
- [ ] **Step 6: Teste 5 — Par de catálogo:** base no item normal e no de catálogo, com e sem oferta.
- [ ] **Step 7: Teste 6 — Kit Virtual:** mudar o desconto com e sem oferta, e o base de um componente.
- [ ] **Step 8: Registrar no ADR e commitar.** `docs(adr): medições pré-implementação do ADR-0196`

---

### Task 1: Modo "Definir preço"

**Files:**
- Modify: `supabase/functions/_shared/operacoes/reajuste/tipos.ts`, `alvo.ts`, `pedido.ts`
- Modify: `src/lib/reajuste.ts`, `src/components/operacoes/dialog-reajuste.tsx`, `src/components/operacoes/barra-selecao-publicados.tsx`
- Test: `reajuste/__tests__/alvo.test.ts`, `pedido.test.ts`, `src/components/operacoes/__tests__/dialog-reajuste.test.tsx`

**Interfaces:**
- Produces: `TipoAjuste = 'pct' | 'reais' | 'definir'`; em `definir`, `sentido` é ignorado e `calcularAlvo(base, a)` devolve `reais(centavos(a.valor))`, ou `null` se ≤ 0.

- [ ] **Step 1: Escrever os testes**

```ts
expect(calcularAlvo(56.45, { tipo: 'definir', sentido: '+', valor: 49.9 })).toBe(49.9);
expect(calcularAlvo(56.45, { tipo: 'definir', sentido: '+', valor: 0 })).toBeNull();
expect(lerPreview({ acao: 'reajustar', ml_item_ids: ['MLB1'], ajuste: { tipo: 'definir', sentido: '+', valor: 10 } })?.ajuste?.tipo).toBe('definir');
expect(formatarAjuste({ tipo: 'definir', sentido: '+', valor: 49.9 })).toBe('Definir R$ 49,90');
// Diálogo: chip "Definir R$" esconde Aumentar/Diminuir e envia { tipo: 'definir', sentido: '+', valor }
```

- [ ] **Step 2: Rodar e ver falhar.** `pnpm test -- reajuste/__tests__/alvo` → FAIL.
- [ ] **Step 3: Implementar.** Diálogo: chips `%`, `R$` e `Definir R$`; título "Alterar preço". Barra: "Alterar preço ({total})".
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(reajuste): modo definir preço (ADR-0196)`

---

### Task 2: Leitura de ofertas

**Files:**
- Create: `reajuste/ofertas.ts`
- Modify: `reajuste/ml.ts`, `reajuste/tipos.ts`, `reajuste/deps.ts`
- Test: `reajuste/__tests__/ofertas.test.ts`, `reajuste/__tests__/ml.test.ts`

**Interfaces:**
- Produces:
  - `OfertaVigente { chave: string; promocao_id: string; tipo: string; status: 'started' | 'pending'; preco: number | null; offer_id: string | null; inicio: string | null; fim: string | null }`. `chave = offer_id ?? ${promocao_id}:${inicio ?? status}`: Relâmpago pode ter várias ofertas na mesma campanha.
  - `ClienteReajusteML.lerOfertas(itemId): Promise<OfertaVigente[] | null>`, substitui `participaPromocaoML`; `null` = inconclusivo. Mantém a checagem de candidate na visão da campanha; 409 repete uma vez.
  - `unirOfertas(fontes: (OfertaVigente[] | null)[]): OfertaVigente[] | null`: `null` se alguma fonte é `null`; união por `chave`, mantendo o **maior** preço; preço nulo vence.
  - `maiorOferta(ofertas): number | null`: `null` se alguma oferta tem preço nulo.
  - `DepsPreview.ofertasBanco(mlItemIds): Promise<Map<string, OfertaVigente[]>>`: une `ml_promocao_itens` em campanhas `started|pending` (inclusive por `anuncio_normal_id`) e itens de `aderir`/`alterar_preco` dos últimos 30 min, que cobrem a propagação do ML. Item `aplicado` entra com o preço gravado; item com `etapa='escrita_pedida'` em qualquer status (a mesma proteção de `_shared/operacoes/deps.ts`) entra com `preco: null`, o que bloqueia a escrita enquanto a participação não for comprovada.

- [ ] **Step 1: Escrever os testes**

```ts
expect(unirOfertas([null, [o('A', 39.9)]])).toBeNull();
expect(unirOfertas([[], [o('A', 39.9)]])).toEqual([o('A', 39.9)]);            // sync vê, ML ainda não
expect(unirOfertas([[o('A', 38)], [o('A', 39.9)]])).toEqual([o('A', 39.9)]);  // o maior vence
expect(unirOfertas([[o('A', 19)], [o('B', 24)]])?.length).toBe(2);            // mesma campanha, ofertas distintas
expect(maiorOferta([o('A', 19), o('B', 24.22)])).toBe(24.22);
expect(maiorOferta([o('A', null)])).toBeNull();
// ofertasBanco: aderir 'aplicado' há 5 min entra; há 40 min não; campanha 'finished' não entra
// ofertasBanco: aderir 'erro' com etapa 'escrita_pedida' há 5 min → oferta com preço null → maiorOferta null
// ml.test: LGH pending → preço 131.97; 409 depois 200 → sucesso; 500 → null
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Banco desatualizado bloqueia a mais, e isso é aceito: a saída é o "Atualizar agora" da Central. O próprio espelho do motor mantém o banco certo depois de escritas do app.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(reajuste): leitura de ofertas vigentes (ADR-0196)`

---

### Task 3: Passos do item, migration e barreiras

**Files:**
- Create: `reajuste/passos.ts`; migration via `supabase migration new reajuste_passos`
- Modify: `reajuste/tipos.ts`, `_shared/operacoes/tipos.ts` (`CamposItem`), `reajuste/deps.ts`, `src/lib/database.types.ts`
- Test: `reajuste/__tests__/passos.test.ts`; SQL com `scripts/teste-sql-desfeito.py`

**Interfaces:**
- Produces:
  - Colunas em `operacoes_massa_itens`: `passos jsonb`, `lease_token uuid`, `lease_ate timestamptz`, `avaliacoes jsonb`.
  - `EstadoPasso = 'pendente' | 'escrita_pedida' | 'confirmado' | 'volta_pendente' | 'volta_pedida' | 'compensado'`. Item com passo em estado de volta nunca retoma a ida.
  - `Passo` (união por `tipo`): `{tipo:'saida'; oferta: OfertaVigente; estado}`, `{tipo:'oferta'; oferta; anterior: number; alvo: number; estado}`, `{tipo:'faixas'; anterior: FaixaPreco[]; alvo: FaixaPreco[]; estado}`, `{tipo:'base'; anterior: number; alvo: number; estado}`.
  - `planejarPassos(e: EntradaPassos): Passo[]`, com `EntradaPassos { base; alvo; ofertas: OfertaVigente[]; ofertasNovas: Record<chave, number>; sair: chave[]; faixasAntes: FaixaPreco[]; faixasAlvo: FaixaPreco[] | null }`. Descendo: saídas, ofertas, faixas, base. Subindo: base, ofertas, faixas. Sem mudança de base: só faixas.
  - `estadosIntermediarios(base, ofertas, faixas, passos): Estado[]` e `violacao(estado): string | null`; `planejarPassos` lança se algum estado viola as invariantes.
  - Sem compatibilidade com itens antigos: o deploy exige zero reajustes `executando` (Task 13), e `reajuste_confirmar` recusa rascunho sem `passos` como `expirado`.
  - `reajuste_reivindicar` passa a gerar `lease_token` e `lease_ate` (agora + 2 min) atomicamente no claim e devolve o token.
  - Toda transição exige o token: RPC `reajuste_passo_marcar(p_org, p_operacao, p_ml_item, p_token, p_indice int, p_estado text) returns boolean` para cada mudança de estado de passo, e renova o lease; RPC `reajuste_item_gravar(p_org, p_operacao, p_ml_item, p_token, p_campos jsonb) returns boolean` substitui `gravarItem` e `agendarConferenciaItem` no reajuste; `reajuste_persistir` ganha `p_token`. `false` = o worker perdeu a posse e para sem escrever mais nada.
  - `reajuste_passo_marcar` grava `etapa='escrita_pedida'` ao marcar `escrita_pedida` ou `volta_pedida`.
  - `reajuste_reivindicar` e `operacoes_massa_reivindicar` substituídas: barreira mútua com `aderir`, `sair` e `alterar_preco` (`sair` entra no ramo com advisory lock); `reajuste_reivindicar` recusa item de promoção `aplicado` nos últimos 2 min, ou com `etapa='escrita_pedida'` nos últimos 30 min.

- [ ] **Step 1: Escrever os testes**

```ts
const tipos = (p: Passo[]) => p.map((x) => x.tipo);
expect(tipos(planejarPassos({ ...e, base: 100, alvo: 80, faixasAlvo: f(70) }))).toEqual(['faixas', 'base']);
expect(tipos(planejarPassos({ ...e, base: 100, alvo: 120, faixasAlvo: f(110) }))).toEqual(['base', 'faixas']);
expect(tipos(planejarPassos({ ...e, base: 100, alvo: 100, faixasAlvo: f(90) }))).toEqual(['faixas']);
expect(tipos(planejarPassos({ ...e, base: 100, alvo: 40, ofertas: [o('A', 50)], ofertasNovas: { A: 30 } }))).toEqual(['oferta', 'base']);
expect(tipos(planejarPassos({ ...e, base: 40, alvo: 100, ofertas: [o('A', 30)], ofertasNovas: { A: 50 } }))).toEqual(['base', 'oferta']);
expect(() => planejarPassos({ ...e, base: 100, alvo: 40, ofertas: [o('A', 50)] })).toThrow(/oferta/);
expect(() => planejarPassos({ ...e, base: 100, alvo: 100, faixasAlvo: f(100) })).toThrow(/faixa/);
// SQL: token antigo depois de novo claim → passo_marcar, item_gravar e persistir devolvem false e não gravam nada
// SQL: lease vencido permite novo claim; item 'aplicado' → false
// SQL: 'sair' pendente barra reajuste; reajuste ativo barra 'sair'; aderir 'aplicado' há 1 min barra reajuste
// SQL: aderir 'erro' com etapa 'escrita_pedida' há 5 min barra reajuste
// SQL: confirmar rascunho sem passos → 'expirado'
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Reescrever as RPCs a partir da versão mais recente em `20261103151129_promo_alterar_preco.sql`; manter a ordem de locks produto → MLB.
- [ ] **Step 4: Validar.** Testes PASS; `npm run db:check`; teste SQL `raise TESTE_OK` desfeito.
- [ ] **Step 5: Commit.** `feat(reajuste): passos duráveis e barreiras (ADR-0196)`

---

### Task 4: Trava da oferta no preview

**Files:**
- Modify: `reajuste/elegibilidade.ts`, `reajuste/preview.ts`, `reajuste/pedido.ts`, `reajuste/deps.ts`
- Test: `reajuste/__tests__/elegibilidade.test.ts`, `preview.test.ts`

**Interfaces:**
- Consumes: `lerOfertas`, `unirOfertas`, `maiorOferta`, `planejarPassos`.
- Produces:
  - `FatosElegibilidade` perde `promocaoBanco`, `promocaoML` e `temAtacado`; ganha `ofertas: OfertaVigente[] | null`.
  - `motivoTravaOferta(alvo, ofertas): string | null`: `Preço igual ou abaixo da oferta de R$ X — ajuste a oferta antes`.
  - `ItemPreview.ofertas`, `ItemPreview.passos`; `linhasDoRascunho` grava `passos`.

- [ ] **Step 1: Escrever os testes**

```ts
expect(motivoInelegivel({ ...base, ofertas: [o('P', 39.9)] })).toBeNull();     // promoção deixa de excluir
expect(motivoInelegivel({ ...base, ofertas: null })).toMatch(/conferir promoções/);
expect(motivoInelegivel({ ...base, ofertas: [{ ...o('L', 100), tipo: 'LIGHTNING', status: 'started' }] })).toMatch(/Relâmpago/); // até o Teste 2
expect(motivoTravaOferta(39.9, [o('P', 39.9)])).toMatch(/igual ou abaixo/);
expect(motivoTravaOferta(39.91, [o('P', 39.9)])).toBeNull();
// preview: alvo abaixo da oferta → 'fora'; item com oferta e alvo acima → 'elegivel' com passos ['base']
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Remover a exclusão de Relâmpago `started` quando o Teste 2 passar.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(reajuste): trava do base contra a maior oferta (ADR-0196)`

---

### Task 5: Atacado — regras, cliente ML e UPDATE por item

**Files:**
- Create: `reajuste/faixas.ts`
- Modify: `reajuste/ml.ts`, `reajuste/preview.ts`, `reajuste/deps.ts`, `_shared/user-products/atualizar-familia-up.ts`
- Test: `reajuste/__tests__/faixas.test.ts`, `ml.test.ts`, `preview.test.ts`, teste existente de `atualizar-familia-up`

**Interfaces:**
- Produces:
  - `FaixaPreco { min_unidades: number; preco: number }`
  - `lerFaixas(itemId): Promise<FaixaPreco[] | null>`: `GET /items/{id}/prices` com `show-all-prices: TRUE`, filtra `user_type_business`.
  - `gravarFaixas(itemId, faixas): Promise<ResultadoPut>`: `POST /items/{id}/prices/standard/quantity`, full-replace; não alterar `aplicarPxQ`.
  - `faixasDoAlvo(alvo, config: FaixaAtacado[]): FaixaPreco[]`, em centavos half-up.
  - `faixasValidas(base, faixas): boolean`: cada faixa `< base` e `> 0`, `min_unidades` ≥ 2 crescente, no máximo 5.
  - `mesmasFaixas(a, b): boolean`: em centavos, sem depender da ordem.
  - `configDoMlb(variacoes, familia): { faixas: FaixaAtacado[] | null; divergente: boolean }`: `null` herda, `[]` = sem atacado.
  - `decidirFaixas(alvo, vivas, config): { acao: 'nenhuma' | 'recalcular'; faixas_alvo: FaixaPreco[] | null } | { acao: 'fora'; motivo: string }`

- [ ] **Step 1: Escrever os testes**

```ts
expect(faixasDoAlvo(100, [{ min_unidades: 2, desconto_pct: 5 }])).toEqual([{ min_unidades: 2, preco: 95 }]);
expect(faixasValidas(100, [{ min_unidades: 2, preco: 100 }])).toBe(false);
expect(decidirFaixas(90, [], null)).toEqual({ acao: 'nenhuma', faixas_alvo: null });
expect(decidirFaixas(90, [{ min_unidades: 2, preco: 95 }], { faixas: [{ min_unidades: 2, desconto_pct: 5 }], divergente: false }))
  .toEqual({ acao: 'recalcular', faixas_alvo: [{ min_unidades: 2, preco: 85.5 }] });
// faixa viva sem config: subir mantém; descer cruzando → fora 'Faixa de atacado ficaria acima do preço base'
// config divergente entre cores → fora 'Atacado diferente entre cores — ajuste na Revisão'
// atualizar-familia-up: cores com preços diferentes → cada item recebe faixas sobre o próprio preço, sem atacado_status 'erro'
// atualizar-familia-up: configuração por cor continua recusada
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Em `atualizar-familia-up.ts`, retirar a trava `precosDistintos.size > 1` e chamar `conn.aplicarAtacado(ctx, id, precoDoItem, faixas)`, com o preço do próprio item (saída prevista no comentário da trava e no ADR-0160). Atualizar o ADR-0160 com a referência.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(reajuste): regras de atacado e faixas por item no UPDATE (ADR-0196)`

---

### Task 6: Trava financeira de todos os preços

**Files:**
- Modify: `reajuste/avaliacao.ts`, `reajuste/preview.ts`, `reajuste/tipos.ts`
- Test: `reajuste/__tests__/avaliacao.test.ts`, `preview.test.ts`

**Interfaces:**
- Produces:
  - `PrecoAvaliado { tipo: 'base' | 'faixa' | 'oferta'; chave: string; preco: number; avaliacao: Avaliacao }`
  - `avaliarPassos(passos, avaliar): Promise<PrecoAvaliado[]>`: avalia o alvo do base, de cada faixa e de cada oferta; "só faixas" não avalia o base.
  - `resumirPrecos(precos: PrecoAvaliado[]): Avaliacao`: `pior`, `tem_vermelho` e `tem_sem_dado` agregados; é o que vai em `ItemPreview.avaliacao`, então `reajuste_confirmar` exige as mesmas confirmações.
  - `mudouPrecos(antes, agora): boolean`: mesma regra de `mudouAvaliacao`, por `tipo:chave`.
  - `ItemPreview.precos_avaliados`, gravado em `avaliacoes`.

- [ ] **Step 1: Escrever os testes**

```ts
expect(resumirPrecos([p('base', 'verde'), p('faixa', 'vermelho')]).tem_vermelho).toBe(true);
expect(resumirPrecos([p('base', 'verde'), p('oferta', 'indisponivel')]).tem_sem_dado).toBe(true);
// preview: base verde com faixa em prejuízo → item vem desmarcado, exige confirmação
// preview: só faixas em prejuízo → exige confirmação
// preview: Reverter também avalia base e faixas restauradas
expect(mudouPrecos([p('faixa', 'verde', 'custo 10')], [p('faixa', 'verde', 'custo 12')])).toBe(true);
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** A faixa usa o mesmo avaliador do base, por unidade; o aviso na tela diz "lucro por unidade".
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(reajuste): trava financeira em faixas e ofertas (ADR-0196)`

---

### Task 7: Executor por passos

**Files:**
- Modify: `reajuste/executar.ts`, `reajuste/decidir.ts`, `reajuste/deps.ts`, `reajuste/preview.ts`
- Test: `reajuste/__tests__/executar.test.ts`, `decidir.test.ts`, `preview.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces:
  - `processar` usa o token do claim em toda transição (Task 3); qualquer `false` encerra o item sem nova escrita.
  - `reconciliarPasso(passo, vivo): 'alvo' | 'anterior' | 'indefinido'`. Na ida (`escrita_pedida`): alvo → `confirmado`, anterior → `pendente`. Na volta (`volta_pedida`): anterior → `compensado`, alvo → `volta_pendente`.
  - `etapa` fica `escrita_pedida` da primeira escrita até todos os passos confirmados; só então `ml_confirmado` → `persistir`. A retomada de `ml_confirmado` continua indo direto a `persistir`.
  - Ordem de `processar`: (1) reconciliar por GET todo passo `escrita_pedida` ou `volta_pedida`, antes de qualquer trava; (2) com passo em estado de volta, só continuar a compensação; (3) antes de **cada** nova escrita, inclusive numa retomada parcial: `revalidarPasso(indice)` relê ofertas e faixas vivas, aplica os passos próprios já confirmados, exige `violacao(próximo estado) === null`, e confere elegibilidade e `mudouPrecos` dos passos restantes; (4) escrever e confirmar por GET.
  - Revalidação reprovada sem base confirmado: compensa e termina `mudou`. Com base confirmado: segue a regra das faixas abaixo.
  - Compensação: só depois de reconciliar tudo e com o base provado igual ao `anterior`, marca os passos `confirmado` como `volta_pendente` e desfaz em ordem inversa. Base já confirmado não compensa: falha de faixas depois dele, após 3 tentativas, conclui `aplicado` com `MSG_FAIXAS_PENDENTES = 'Preço aplicado, mas as faixas de atacado não foram atualizadas'`.
  - Reconciliação `indefinido` ou compensação falhando: item `conferindo`, com reserva mantida, e botão "Retomar" já existente.
  - Reverter: `Origem` passa a trazer `passos`. Preview e execução exigem faixas vivas e configuração iguais às deixadas pela origem; senão `fora`/`mudou` com `Não revertível: o atacado mudou depois da alteração`. Operação "só faixas" é identificada por não ter passo `base`: não compara `restaurar` e não mexe em `preco_publicacao` nem na marca do operador.

- [ ] **Step 1: Escrever os testes**

```ts
// oferta nova acima do alvo surgiu → 'mudou', nenhuma escrita
// lerOfertas null sem passo escrito → 'bloqueado', nenhuma escrita
// faixas vivas ≠ preview → 'mudou'
// mudouPrecos → 'mudou' com MSG_FINANCEIRO
// passo_marcar false → para sem escrever; item_gravar false → não sobrescreve o sucessor
// retomada parcial: faixas confirmadas, SMART nova acima do alvo → compensa faixas, 'mudou', base intacto
// retomada parcial: custo mudou → mudouPrecos reprova antes do base
// crash antes da escrita de volta (volta_pedida, vivo no alvo) → volta_pendente, reescreve a volta
// crash depois da escrita de volta (volta_pedida, vivo no anterior) → compensado, sem retomar a ida
// crash com faixas 'escrita_pedida' e vivo no alvo → confirmado, sem novo POST, segue para base
// crash com faixas 'escrita_pedida' e vivo no anterior → volta a pendente e regrava
// crash com faixas 'escrita_pedida' e vivo em terceiro valor → 'conferindo', nada escrito
// crash depois do base confirmado, subindo, faixas pendentes → grava faixas, depois persiste
// SemAcesso com etapa → 'conferindo', reserva mantida
// descendo: faixas confirmadas, base recusado (sem_escrita) → compensa faixas, 'erro'
// descendo: faixas confirmadas, base 'desconhecido' → NÃO compensa, 'conferindo'
// subindo: gravarFaixas falha 3x → 'aplicado' + MSG_FAIXAS_PENDENTES
// Reverter: oferta nova acima do alvo antigo → 'fora'
// Reverter: faixas editadas depois da origem → 'fora'
// Reverter de só faixas: ida e volta sem alterar preco_publicacao nem preco_editado_pelo_operador
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** `decidirReajuste` segue valendo para o passo `base`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(reajuste): execução por passos com reconciliação (ADR-0196)`

---

### Task 8: Edição do % do atacado por família

**Files:**
- Create: migration via `supabase migration new reajuste_atacado_familia`
- Modify: `reajuste/pedido.ts`, `reajuste/preview.ts`, `reajuste/executar.ts`, `reajuste/deps.ts`, `operacoes-massa/index.ts`, `src/lib/database.types.ts`
- Test: `reajuste/__tests__/pedido.test.ts`, `preview.test.ts`, `executar.test.ts`; SQL com `scripts/teste-sql-desfeito.py`

**Interfaces:**
- Produces:
  - `PedidoPreview.atacado?: Record<familiaId, FaixaAtacado[]>`, validado em `lerPreview`: até 5 faixas, `min_unidades` ≥ 2 crescente, `desconto_pct` entre 0 e 100 exclusivos.
  - Coluna `operacoes_massa.atacado_familias jsonb`: `[{ familia_id, novo, esperado, status: 'pendente' | 'aplicado' | 'nao_aplicado', motivo }]`.
  - Unidade de execução = família: o preview expande todos os MLBs dela. Se algum fica `fora`, a edição é recusada para a família inteira. `reajuste_confirmar` devolve `familia_parcial:<id>` se algum MLB da família vier desmarcado.
  - RPC `reajuste_atacado_concluir(p_org uuid, p_operacao uuid) returns jsonb`: no fim da operação, sob o lock do produto, grava `familias.atacado` com compare-and-set só se **todos** os itens da família terminaram `aplicado` com o passo `faixas` `confirmado`; `MSG_FAIXAS_PENDENTES` reprova. Senão marca `nao_aplicado`. Idempotente, chamada em `finalizar` e no Retomar.
  - Reserva: `reajuste_ativo_produto`, `familia_reservar_publicacao`, `familia_reservar_migracao_pxv`, `reajuste_confirmar` e `reajuste_reivindicar` passam a considerar ativa a família com entrada `pendente` em `atacado_familias`, sob o mesmo lock do produto; só a operação dona da entrada passa. `reajuste_atacado_concluir` libera na mesma transação.
  - A execução revalida `variacoes.atacado` sob a reserva; cor com config própria → `mudou`.
  - Reverter usa a configuração que a origem deixou. Origem `aplicado`: exige família igual a `novo` e restaura `esperado`. Origem `nao_aplicado`: exige família igual a `esperado`, desfaz só os passos aplicados e não grava configuração.

- [ ] **Step 1: Escrever os testes**

```ts
expect(lerPreview({ ...p, atacado: { [uuid]: [{ min_unidades: 1, desconto_pct: 5 }] } })).toBeNull();
// preview: família com variacoes.atacado não nula → família inteira 'fora' 'Atacado por cor: ajuste na Revisão'
// preview: 1 MLB da família 'fora' → edição recusada para a família, sem rascunho parcial
// confirmar: MLB da família desmarcado → 400 com motivo
// SQL: 1 item 'erro' → familias.atacado inalterado e status 'nao_aplicado'
// SQL: item 'aplicado' com passo faixas não confirmado → 'nao_aplicado'
// SQL: todos confirmados → grava; repetir → idempotente; configuração mudou → 'nao_aplicado' com motivo
// SQL: entrada 'pendente' com todos os itens encerrados → publicação da família recusada; depois de concluir → aceita
// SQL: operação B em MLB já 'aplicado' da família de A, com entrada 'pendente' → confirmar e reivindicar de B recusam; os de A passam
// Reverter de 'nao_aplicado': exige família em 'esperado', desfaz faixas aplicadas, familias.atacado intacto
// executar: anúncio irmão entra como 'só faixas', sem fixar preço
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Com `nao_aplicado`, faixas novas ficam nos anúncios que deram certo, sempre abaixo do base; o próximo UPDATE volta a seguir a configuração da família.
- [ ] **Step 4: Validar.** Testes PASS; `npm run db:check`; teste SQL desfeito.
- [ ] **Step 5: Commit.** `feat(reajuste): percentual de atacado por família (ADR-0196)`

---

### Task 9: Tela

**Files:**
- Modify: `src/components/operacoes/preview-reajuste.tsx`, `src/components/operacoes/lista-operacoes.tsx`, `src/hooks/useOperacoes.ts`, `src/lib/operacoes.ts` (`tituloOperacao`)
- Modify: aviso de promoção da Revisão
- Test: `src/components/operacoes/__tests__/preview-reajuste.test.tsx`, `lista-operacoes.test.tsx`

**Interfaces:**
- Consumes: `ItemPreview.ofertas`, `passos`, `precos_avaliados`; `operacoes_massa.atacado_familias`.

- [ ] **Step 1: Escrever os testes**

```tsx
// item com oferta: "Em promoção por R$ 39,90 · 11.11 da Black" por oferta, inclusive 2+ ofertas
// item com faixas: "2+ un.: R$ 146,52 → R$ 138,90" com semáforo por faixa e campo de % por família
// mudar o %: novo preview, confirmações zeradas, aviso "Vale para os N anúncios desta família"
// 'fora' por trava: motivo com o valor da oferta
// só faixas: "Só atacado", sem input de preço
// aviso em item com oferta: "O preço riscado pode não acompanhar o novo preço base"
// detalhe da operação: 'nao_aplicado' mostra "Atacado da família não confirmado" e o motivo
// MSG_FAIXAS_PENDENTES aparece no item
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Título "Alterar preço de N anúncios"; botão "Alterar N anúncios". Aviso da Revisão: "Mudar o preço para igual ou abaixo da oferta tira o anúncio da promoção." A Central continua mostrando o original da campanha: é o "de" que o ML mantém, conforme o Step 1 da Task 0 confirmar.
- [ ] **Step 4: Rodar e ver passar.** Skill `frontend-design`; screenshot real pela skill `playwright-cli`.
- [ ] **Step 5: Commit.** `feat(publicados): tela de alterar preço com ofertas e atacado (ADR-0196)`

---

### Task 10: Fatia 2 — DEAL baixa a oferta antes

**Suspensa até decisão do Diego.** Medição de 06/11: o ML recusa subir oferta DEAL (`PRICE_GT_CURRENT`), então compensar ou reverter oferta como descrito abaixo pode ser impossível. `top_deal_price` também precisa entrar na trava e no PUT. Revisar esta task e passar pelo Codex antes de executar.

**Files:**
- Modify: `reajuste/ofertas.ts`, `reajuste/ml.ts`, `reajuste/pedido.ts`, `reajuste/preview.ts`, `reajuste/executar.ts`, `reajuste/deps.ts`, `src/components/operacoes/preview-reajuste.tsx`
- Test: `reajuste/__tests__/ofertas.test.ts`, `preview.test.ts`, `executar.test.ts`, `preview-reajuste.test.tsx`

**Interfaces:**
- Consumes: `Passo` tipo `oferta`, `planejarPassos`, `avaliarPassos`.
- Produces:
  - `sugerirOferta(baseAtual, ofertaAtual, alvo): number`: mesmo % de desconto, em centavos, arredondando para baixo.
  - `PedidoPreview.ofertas?: Record<mlItemId, Record<chave, number>>`.
  - `putOferta(itemId, oferta, preco): Promise<ResultadoPut>`: `PUT /seller-promotions/items/{id}?app_version=v2`, `{promotion_id, promotion_type:'DEAL', deal_price}`.
  - `lerOferta(itemId, oferta): Promise<OfertaVigente | null>`: visão da campanha, usada na reconciliação.
  - `espelharPrecoSeguro` reaproveitado de `_shared/operacoes/executar.ts` (extrair para módulo próprio se a importação criar ciclo).

- [ ] **Step 1: Escrever os testes**

```ts
expect(sugerirOferta(56.45, 39.9, 39)).toBe(27.56);
// preview: todas as ofertas ≥ alvo são DEAL → 'elegivel', passos ['oferta','base'], oferta sugerida
// preview: oferta editada ≥ alvo → 'fora' 'A oferta precisa ficar abaixo do novo preço'
// preview: oferta não-DEAL ≥ alvo → 'fora' (a Fatia 3 muda isto)
// executar: oferta viva ≠ anterior → 'mudou', nada escrito
// executar: 2 campanhas, a 2ª recusa → compensa a 1ª, 'erro', base intacto
// executar: base 'desconhecido' depois das ofertas → 'conferindo', sem compensar
// executar: base recusado provado por GET → compensa ofertas, 'erro'
// executar: compensação falha → 'conferindo' com reserva, mensagem 'Oferta alterada e preço base mantido'
// executar: ERROR_CREDIBILITY_DISCOUNTED_PRICE → passo falha com a mensagem do ML, sem PUT do base
// Reverter: passos ['base','oferta']
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Tela: campo "Oferta" por campanha só quando o alvo fica igual ou abaixo dela.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(reajuste): baixa a oferta DEAL antes do base (ADR-0196)`

---

### Task 11: Fatia 3 — SMART e Relâmpago saem e recolocam

Só começa com o Teste 4 concluído. Se sair não evitar a âncora de credibilidade, a task volta ao Diego.

**Files:**
- Create: migration via `supabase migration new reajuste_saida_oferta`
- Modify: `reajuste/ml.ts`, `reajuste/executar.ts`, `reajuste/preview.ts`, `reajuste/pedido.ts`, `reajuste/deps.ts`, `reajuste/ofertas.ts`, `src/hooks/useOperacoes.ts`, `src/components/operacoes/preview-reajuste.tsx`, `src/components/operacoes/lista-operacoes.tsx`, `src/lib/database.types.ts`
- Test: `reajuste/__tests__/executar.test.ts`, `pedido.test.ts`, `ofertas.test.ts`, `src/components/operacoes/__tests__/lista-operacoes.test.tsx`

**Interfaces:**
- Consumes: `decidir('sair', …)` e `lerNaCampanha` de `_shared/operacoes/`, que devolvem `ItemNaCampanha` com o `offer_id` participante.
- Produces:
  - `Confirmacao.saida: boolean`, percorrendo `lerConfirmar`, `useConfirmarReajuste` e `reajuste_confirmar`; coluna `confirmado_saida boolean`; falta dela devolve `confirmacao_faltando:<ml>`.
  - `sairOferta(itemId, fresco: ItemNaCampanha): Promise<ResultadoPut>`
  - `saidaProvada(tipo, fresco: ItemNaCampanha | null): boolean`: SMART = ausente ou `candidate`; `LIGHTNING` e `SMART_LIGHTNING` = `candidate`; `PRICE_MATCHING` conforme o Teste 4. Regra final vem do teste.
  - Passo `saida` fica `escrita_pedida` até a prova, com item `conferindo` e backoff de `agendarConferenciaItem`; mais de 24 h → `erro`, sem tocar no base.
  - Na prova, espelha `ml_promocao_itens.status` e `unirOfertas` ignora as chaves com passo `saida` confirmado. Antes do passo `base`, relê todas as demais ofertas.
  - Item aplicado expõe `recolocar: [{ promocao_id, tipo, preco_anterior }]`.

- [ ] **Step 1: Escrever os testes**

```ts
// lerConfirmar preserva saida; ausente em item de saída → 'confirmacao_faltando'
// preview: oferta SMART ≥ alvo → 'elegivel', aviso 'Sai da campanha; a volta depende do ML', desmarcado
// tipo sem caminho de saída (PRICE_DISCOUNT, DOD, desconhecido) → 'fora' 'Tipo de oferta não suportado — use o Seller Center'
// executar: oferta ainda ativa → 'conferindo', putPreco não chamado
// executar: 24 h sem sair → 'erro', putPreco não chamado
// executar: saiu, mas outra oferta ≥ alvo apareceu → 'mudou'
// lista-operacoes: "Recolocar na promoção" abre o preview de aderir com min(preco_anterior, faixa.max)
// sem convite: "O ML ainda não reconvidou este anúncio"
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** O Aderir existente faz a recolocação, com piso de R$ 19 e faixa. Reverter não recoloca.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(reajuste): saída de SMART e Relâmpago para baixar o base (ADR-0196)`

---

### Task 12: Fatia 4 — Plano complementar de catálogo e Kit

O comportamento de escrita desses dois casos não foi medido. Decidir agora seria inventar contrato do ML.

**Files:**
- Create: `docs/superpowers/plans/AAAA-MM-DD-alterar-preco-catalogo-kit.md`

- [ ] **Step 1: Com os Testes 5 e 6 concluídos, escrever o plano complementar.** Catálogo: em qual item do par escrever, e se a oferta do item de catálogo entra na trava. Kit: identidade própria (Kit Virtual não é família nem anúncio externo, ADR-0154), autorização por org, reserva concorrente, snapshot do desconto, recuperação e Reverter, sem exigir `codigo_pai`. Retirada de `ehKit`, `catalog_listing` e `tem_relacoes` de `motivoInelegivel`, e de `ehKitVirtual` só para esta ação em `motivoNaoSelecionavel`.
- [ ] **Step 2: Revisão do plano pelo Codex `gpt-6.1-sol` high.**
- [ ] **Step 3: Aprovação do Diego e execução.**

---

### Task 13: Entrega de cada fatia

**Files:** `docs/reference/edge-functions.md`, `docs/reference/modelo-de-dados.md`, `docs/reference/glossario.md`, `docs/project-status.md`, `docs/TASKS.md`, `obsidian-vault/03-Módulos/Promoções.md`, `obsidian-vault/09-Logs/Changelog.md`, status do ADR-0196.

- [ ] **Step 1: Validar.** `pnpm preflight` passa.
- [ ] **Step 2: Atualizar a documentação** com a skill `docs-update-checklist`.
- [ ] **Step 3: Revisão do diff pelo Codex `gpt-6.1-sol` high,** rodada única; corrigir achados.
- [ ] **Step 4: Deploy em ordem:** conferir por SQL zero operações `reajustar` em `executando` (senão esperar ou retomar até concluir) → `supabase db push` → funções que importam `_shared/operacoes/` ou `_shared/user-products/atualizar-familia-up.ts`, listadas por grep (inclui `operacoes-massa` e `update-familia-ml`) → conferir versão ativa de cada uma → merge do front.
- [ ] **Step 5: Validar em produção com um anúncio aprovado pelo Diego,** pela tela: em promoção, com atacado, Reverter e um UPDATE depois; conferir ML e banco.
- [ ] **Step 6: Merge fast-forward com CI verde, pull do main local, remover branch e worktree.**
