# E6 — Orquestração Multicanal — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar 1 família em N canais a partir da fonte única, com falha de um canal **nunca** afetando outro — e com o caminho ML que fatura hoje **intocado**.

**Architecture:** Strangler fig sobre a infraestrutura que já existe (`ChannelConnector` + registry + `anuncios_externos` N-canais × N-partições + fila QStash serial): o `canal` vira parâmetro do fan-out; cada `(família, canal)` é seu próprio job QStash com claim e idempotência próprios em `anuncios_externos`; o canal `mercado_livre` continua no worker atual (`publish-familia-ml`/`update-familia-ml`/`publicar-split-ml`) sem nenhuma mudança de rota; canais novos entram pelo worker genérico `publicar-anuncio`. Validação plena com conector fake (testes) + regressão ML real; o E2E de 2 canais reais fica bloqueado pelo E5 (Shopee) por definição.

**Tech Stack:** Supabase Edge Functions (Deno), QStash (fila serial por org+canal), `_shared/canais/*` (contrato/registry), React+TS+TanStack Query, vitest.

**Dependência:** executa **depois do E7** (multi-tenancy) — as conexões de canal são por org (`marketplace_connections`, `resolverConexao`, `getValidAccessTokenConexao`), e `anuncios_externos` já terá identidade `(org_id, canal, codigo_pai, particao)`. Ordem E7→E6 registrada no ADR-0027.

## Global Constraints

- **ADR-0043:** schema só via `supabase migration new` + `db push` + `npm run db:check`.
- **Deploy nunca defasado:** deploy CLI completo; `verify_jwt` do `config.toml` preservado; worker novo `publicar-anuncio` entra com `verify_jwt = false` (QStash) + `verificarAssinatura`.
- **Caminho que fatura é intocável:** nenhuma task altera a rota ML atual (`publicar-familias` → `enfileirarPublicacao/Atualizacao/Split` → workers ML). Mudanças no fluxo ML são só aditivas (parâmetro com default).
- **Baseline em todo checkpoint:** `pnpm test` + `npx tsc --noEmit` + `deno check` + `pnpm lint` + `pnpm build`; browser-use no fim (regressão da publicação ML real).
- **TDD** em toda função pura nova; **cada canal isolado** (princípio 6 do doc mestre): erro de um job `(família, canal)` nunca marca erro em outro canal.
- **Nomes fixos deste plano:** worker `publicar-anuncio`; helpers `garantirAnuncioExterno`, `claimAnuncioExterno`, `montarAnuncioCanonico`; enfileirador `enfileirarPublicacaoCanal`; conector de teste `fakeConnector` (`_shared/canais/fake.ts`); ADR novo `0053-orquestracao-multicanal.md`.

## Estado atual (mapeado em 2026-07-02)

- **Contrato:** `_shared/canais/contrato.ts` — `ChannelConnector` (8 métodos: `subirFoto`, `criarAnuncio`, `garantirDescricao`, `aplicarAtacado`, `atualizarAnuncio`, `sincronizarDescricao`, `lerStatus`, `lerMetricasVendas`), `CanalId = 'mercado_livre'` (linha 7, ponto único de expansão), `Capabilities` (declarado, **nunca consultado**), `ResultadoCanal`/`ErroCanal` (15 códigos; `classificarErroCanal` em `mapeamento.ts:34-40` só emite `FOTO`/`DESCONHECIDO`). **Vazamento ML:** `AtributoItem`/`DimensoesPacote`/`FaixaAtacado` importados de `../ml/*` (linhas 2-4); `categoriaId`/`atributos` chegam em formato ML (canonicalização plena = E3, fora deste épico).
- **Registry:** `_shared/canais/registry.ts` — `CONECTORES = { mercado_livre: mercadoLivreConnector }` + `getConnector(canal)`.
- **Canal hard-coded** (`getConnector('mercado_livre')` literal): `publish-familia-ml:60`, `update-familia-ml:40`, `publicar-split-ml:89`, `status-publicados:32`, `metricas-vendas:54`.
- **Roteador:** `publicar-familias/index.ts` — body `{ familia_ids, listing_type_id }`; claim atômico em `familias.status → 'publicando'` (CREATE: `ml_item_id is null`; UPDATE: `not null`); fila serial `publish-ml-${userId}` (`queue.ts:43-47`, parallelism 1); roteia >100 variações → split (ADR-0048).
- **Identidade CREATE/UPDATE atada a `familias.ml_item_id`** (mono-canal); por-canal a identidade correta é `anuncios_externos(org_id, canal, codigo_pai, particao)` com `item_externo_id` (pós-E7).
- **`anuncios_externos`:** colunas `id, user_id, org_id, canal (enum canal_externo), codigo_pai, item_externo_id, permalink, status (default 'publicado'), erro_mensagem, variacoes_externas jsonb, metadados_canal jsonb, preco_override, publicado_em, particao, titulo, criado_em, atualizado_em`; escrito por `espelharAnuncioExterno` (`_shared/anuncios/espelhar.ts`, upsert best-effort); dual-write: `familias.ml_*` ainda é fonte de verdade do ML.
- **Front:** `publicarFamilias(familiaIds, listingTypeId)` (`src/lib/publicar.ts:19`); `fetchStatusPublicados` (`queries.ts:570`, tipo `StatusPublicadoItem` linha 556); seleção na Revisão (`src/pages/Revisao.tsx:72,241`); dedupe por `ml_item_id` em `fetchPublicados` (`queries.ts:517-554`).

## Decisões travadas (para o ADR-0053, Task 1)

| # | Decisão | Racional |
|---|---|---|
| D-E6.1 | **ML não migra para o worker genérico neste épico** — `publicar-anuncio` atende só canais ≠ ML; cutover do ML fica para depois do E5 validar o genérico com um 2º canal real | Strangler: o caminho auditado que fatura não se move por elegância. Risco ~zero. |
| D-E6.2 | **Estado por canal vive em `anuncios_externos.status`** (`pendente → publicando → publicado | erro`), com claim atômico por linha — `familias.status` continua sendo a visão do fluxo ML/ingest | 1 família × N canais exige N máquinas de estado; a tabela já é a identidade por canal (ADR-0025/0048). |
| D-E6.3 | **CREATE vs UPDATE por canal** = `anuncios_externos.item_externo_id` nulo/preenchido — `familias.operacao` segue sendo a decisão do ingest para o ML | Um produto pode ser UPDATE no ML e CREATE na Shopee. |
| D-E6.4 | **Fila serial por `(canal, org)`**: `publish-{canal}-{orgId}` | Rate limit é por conta de vendedor por canal (precedente ADR-0034 + lição do lote #28); canais em paralelo entre si, serial dentro do canal. |
| D-E6.5 | **Conector fake** (`fake.ts`) instalável no registry só em teste, via `registrarConectorParaTeste()` | Prova o worker genérico de ponta a ponta sem canal real; some do bundle de produção por não ser importado fora de testes. |
| D-E6.6 | `Capabilities` passa a ser **consultado** no worker genérico (descrição separada, atacado, catálogo); `classificarErroCanal` ganha só `AUTENTICACAO` e `RATE_LIMIT` além dos atuais | O genérico não pode assumir os recursos do ML; códigos extras só os que mudam decisão de retry hoje (YAGNI nos outros 9). |
| D-E6.7 | Critério de saída **ajustado com honestidade**: infraestrutura provada com fake + regressão ML real; "ML + Shopee simultâneos" fecha no encerramento do E5 | O critério original do doc mestre pressupõe E5 pronto. |

## Estrutura de arquivos

**Criar:**
- `docs/decisions/0053-orquestracao-multicanal.md`
- `supabase/migrations/<ts>_e6_anuncios_externos_estado.sql`
- `supabase/functions/_shared/anuncios/estado.ts` (+ `__tests__/estado.test.ts`) — garantir/claim por (canal, produto)
- `supabase/functions/_shared/anuncios/montar-canonico.ts` (+ teste) — builder compartilhado do `AnuncioCanonico`
- `supabase/functions/_shared/canais/fake.ts`
- `supabase/functions/publicar-anuncio/index.ts` (+ entrada `verify_jwt = false` no `config.toml`)

**Modificar:**
- `_shared/canais/contrato.ts` + `_shared/ml/{atributos,dimensoes,atacado}` (donos dos tipos movidos) · `_shared/canais/registry.ts` · `_shared/canais/mapeamento.ts` · `_shared/queue.ts` · `publicar-familias/index.ts` · `status-publicados/index.ts` · `remover-publicado/index.ts` · `publish-familia-ml/index.ts` (só extração do builder) · front: `src/lib/publicar.ts`, `src/lib/queries.ts`, `src/pages/Revisao.tsx`, tela Publicados (chip por canal)

---

### Task 1: ADR-0053 — Orquestração multicanal

**Files:** Create: `docs/decisions/0053-orquestracao-multicanal.md`

- [ ] **Step 1:** Escrever o ADR: Status Aceito; Contexto (1 canal literal em 5 workers; identidade mono-canal `ml_item_id`; E6 do doc mestre); Decisão = tabela D-E6.1..D-E6.7 + diagrama do fan-out (`publicar-familias` → por canal: ML→workers atuais; outros→`publicar-anuncio`); Alternativas rejeitadas (migrar ML para o genérico já — risco sem 2º canal; estado por canal em colunas de `familias` — repete o erro que o ADR-0025 corrigiu); Consequências (E5 Shopee vira "preencher a interface"; dívida explícita: cutover ML para o genérico pós-E5).
- [ ] **Step 2: Commit** — `git commit -m "docs(adr-0053): orquestração multicanal — fan-out por (família, canal)"`

### Task 2: Dessacoplar os tipos do contrato (inversão de dependência)

**Files:** Modify: `_shared/canais/contrato.ts` · `_shared/ml/*` (donos atuais de `AtributoItem`, `DimensoesPacote`, `FaixaAtacado`)

**Interfaces:** Produces: os 3 tipos definidos **em** `contrato.ts` e re-exportados dos módulos ML atuais (imports existentes não quebram).

- [ ] **Step 1:** Mover as definições de `AtributoItem`/`DimensoesPacote`/`FaixaAtacado` para `contrato.ts`; nos arquivos ML de origem, substituir a definição por `export type { AtributoItem } from '../canais/contrato.ts'` (idem os outros dois). Nenhum outro arquivo muda.
- [ ] **Step 2:** `npx tsc --noEmit` + `deno check` + `pnpm test` → tudo verde (mudança 100% mecânica; os testes atuais são a rede).
- [ ] **Step 3: Commit** — `git commit -m "refactor(e6): tipos canônicos são donos no contrato; ml/* re-exporta"`

### Task 3: Migration + máquina de estado por canal em `anuncios_externos`

**Files:** Create: `supabase/migrations/<ts>_e6_anuncios_externos_estado.sql` · `_shared/anuncios/estado.ts` · Test: `_shared/anuncios/__tests__/estado.test.ts`

**Interfaces:**
- Produces (consumido pelas Tasks 5 e 6):

```ts
// _shared/anuncios/estado.ts
export type StatusAnuncioExterno = 'pendente' | 'publicando' | 'publicado' | 'erro';
/** Garante a linha (org, canal, codigo_pai, particao=0) sem sobrescrever estado existente. */
export function garantirAnuncioExterno(admin: SupabaseClient, p: {
  orgId: string; userId: string; canal: string; codigoPai: string;
}): Promise<void>
/** Claim atômico do job (família, canal): pendente|erro -> publicando.
 *  Retorna a operação decidida pelo canal, ou null se já está publicando/publicado (idempotência). */
export function claimAnuncioExterno(admin: SupabaseClient, p: {
  orgId: string; canal: string; codigoPai: string;
}): Promise<{ operacao: 'CREATE' | 'UPDATE' } | null>
```

- [ ] **Step 1: Migration**

```sql
-- E6 (ADR-0053): status de anuncios_externos vira máquina de estado por canal.
-- Linhas existentes (espelho ML) já estão 'publicado' (default histórico) — nada muda p/ elas.
alter table public.anuncios_externos
  add constraint anuncios_externos_status_chk
  check (status in ('pendente','publicando','publicado','erro'));
alter table public.anuncios_externos add column qstash_message_id text;
```

Run: `supabase db push && npm run db:check` → OK.

- [ ] **Step 2: Teste RED** da decisão pura (extrair a regra CREATE/UPDATE para função pura testável):

```ts
// __tests__/estado.test.ts
import { decidirOperacaoCanal } from '../estado.ts';
it('sem item externo -> CREATE', () =>
  expect(decidirOperacaoCanal({ item_externo_id: null })).toBe('CREATE'));
it('com item externo -> UPDATE', () =>
  expect(decidirOperacaoCanal({ item_externo_id: 'MLB123' })).toBe('UPDATE'));
```

- [ ] **Step 3: Implementar `estado.ts`:** `decidirOperacaoCanal` pura; `garantirAnuncioExterno` = upsert `{ org_id, user_id, canal, codigo_pai, particao: 0, status: 'pendente' }` com `onConflict: 'org_id,canal,codigo_pai,particao'` e `ignoreDuplicates: true` (nunca rebaixa um `publicado`); `claimAnuncioExterno` = `update({ status: 'publicando' }).eq('org_id',...).eq('canal',...).eq('codigo_pai',...).eq('particao',0).in('status',['pendente','erro']).select('item_externo_id')` → 0 linhas = null (outro job ativo/concluído); 1 linha = `{ operacao: decidirOperacaoCanal(linha) }`. Mesmo padrão de claim do `publicar-familias:25-45`, por canal.
- [ ] **Step 4:** `pnpm test estado` PASS + baseline. **Commit** — `git commit -m "feat(e6): estado por canal em anuncios_externos + claim atômico (TDD)"`

### Task 4: Conector fake para testes

**Files:** Create: `_shared/canais/fake.ts` · Modify: `_shared/canais/registry.ts`

**Interfaces:** Produces: `fakeConnector: ChannelConnector` (id `'fake'` via cast em teste; capabilities `descricaoSeparada:false, catalogo:false, atacado:false, variacoes:true, ...`); métodos gravam chamadas em `fakeConnector.chamadas[]` e devolvem sucesso determinístico (`criarAnuncio` → `{ ok:true, valor:{ itemExternoId:'FAKE-<codigoPai>', variacoesExternas:{...} } }`); `fakeConnector.falharProximo(codigo: ErroCanalCodigo, retentavel: boolean)` arma uma falha. Registry ganha:

```ts
// registry.ts
const extras = new Map<string, ChannelConnector>();
export function registrarConectorParaTeste(c: ChannelConnector): void { extras.set(c.id, c); }
export function getConnector(canal: string): ChannelConnector {
  return extras.get(canal) ?? CONECTORES[canal as CanalId] ?? (() => { throw new Error(`Canal não suportado: ${canal}`); })();
}
```

- [ ] **Step 1:** Implementar `fake.ts` + ajuste do registry (assinatura `getConnector(canal: string)` — os callers atuais passam literal, zero quebra).
- [ ] **Step 2:** Baseline verde. **Commit** — `git commit -m "test(e6): conector fake + registry injetável para testes"`

### Task 5: Extrair `montarAnuncioCanonico` (builder compartilhado)

**Files:** Create: `_shared/anuncios/montar-canonico.ts` + `__tests__/montar-canonico.test.ts` · Modify: `publish-familia-ml/index.ts`

**Interfaces:**
- Produces: `montarAnuncioCanonico(admin, conn, ctx, familia, variacoes): Promise<AnuncioCanonico>` — exatamente a montagem que hoje vive inline no `publish-familia-ml` (fotos idempotentes via `conn.subirFoto` reaproveitando `capa_ml_picture_id`/`ml_picture_id` persistidos, título/descrição/categoria/atributos/dimensões/desconto/variações filtradas por `excluida_da_publicacao=false`).
- Consumes: nada novo — é **extração**, não reescrita.

- [ ] **Step 1:** Mover o bloco de montagem do `publish-familia-ml` para a função nova, parametrizando o que era fechado sobre variáveis locais; o worker ML passa a chamá-la. **Nenhuma linha de lógica muda** — só endereço.
- [ ] **Step 2:** Teste de caracterização: com um `fakeConnector` e uma família fixture, o `AnuncioCanonico` retornado tem os campos esperados (título, nº de variações excluindo `excluida_da_publicacao`, capas na ordem 1/2/3).
- [ ] **Step 3:** Baseline completo (os testes atuais do fluxo CREATE são a rede da extração) + `deno check publish-familia-ml`. **Commit** — `git commit -m "refactor(e6): extrai montarAnuncioCanonico compartilhado (caracterização)"`

### Task 6: Worker genérico `publicar-anuncio`

**Files:** Create: `supabase/functions/publicar-anuncio/index.ts` · Modify: `_shared/queue.ts` · `supabase/config.toml`

**Interfaces:**
- Consumes: `claimAnuncioExterno`/`garantirAnuncioExterno` (Task 3), `montarAnuncioCanonico` (Task 5), `getConnector` (Task 4), `resolverConexao`/`getValidAccessTokenConexao` (E7 Task 11), `espelharAnuncioExterno`, `classificarErroCanal`.
- Produces: worker QStash `POST publicar-anuncio` com payload `PublicarAnuncioJob`; enfileirador em `queue.ts`:

```ts
// _shared/queue.ts
export interface PublicarAnuncioJob { familia_id: string; lote_id: string; canal: string; }
export function filaCanal(canal: string, orgId: string): string { return `publish-${canal}-${orgId}`; }
export async function enfileirarPublicacaoCanal(job: PublicarAnuncioJob, orgId: string): Promise<string> {
  await garantirFilaSerialCanal(filaCanal(job.canal, orgId)); // mesmo corpo do garantirFilaSerial atual, parametrizado o nome
  const r = await qstashClient().queue({ queueName: filaCanal(job.canal, orgId) })
    .enqueueJSON({ url: urlWorker('publicar-anuncio'), body: job, retries: 3, retryDelay: '10000' });
  return r.messageId;
}
```

- [ ] **Step 1:** `config.toml`: adicionar `[functions.publicar-anuncio]` com `verify_jwt = false` (worker QStash — não alterar nenhuma outra entrada).
- [ ] **Step 2: Implementar o worker** (esqueleto completo — espelha a estrutura do `publish-familia-ml`, por canal):

```ts
// publicar-anuncio/index.ts
Deno.serve(async (req) => {
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) return new Response('assinatura inválida', { status: 401 });
  const { familia_id, lote_id, canal } = JSON.parse(body) as PublicarAnuncioJob;
  const admin = adminClient();

  const { data: familia } = await admin.from('familias').select('*').eq('id', familia_id).single();
  if (!familia) return Response.json({ skip: 'familia inexistente' });

  const claim = await claimAnuncioExterno(admin, { orgId: familia.org_id, canal, codigoPai: familia.codigo_pai });
  if (!claim) return Response.json({ skip: 'sem claim (já publicando/publicado)' }); // idempotência de re-entrega

  const conexao = await resolverConexao(admin, familia.org_id, canal);
  if (!conexao) { await marcarErro(admin, familia, canal, 'canal não conectado', false); return Response.json({ erro: 'sem conexao' }); }

  const conn = getConnector(canal);
  const ctx = { getToken: () => getValidAccessTokenConexao(conexao) };
  try {
    const { data: variacoes } = await admin.from('variacoes').select('*')
      .eq('familia_id', familia_id).eq('excluida_da_publicacao', false);
    const anuncio = await montarAnuncioCanonico(admin, conn, ctx, familia, variacoes ?? []);
    const r = claim.operacao === 'CREATE'
      ? await conn.criarAnuncio(ctx, anuncio)
      : await conn.atualizarAnuncio(ctx, montarAtualizacao(familia, variacoes ?? [], /* itemExternoId da linha claimada */));
    if (!r.ok) return await tratarErroCanal(admin, familia, canal, r.erro!); // retentavel -> 500 (QStash retenta); senão persiste 'erro'
    if (conn.capabilities.descricaoSeparada) await conn.garantirDescricao(ctx, refDe(r).itemExternoId, familia.descricao_ml ?? '');
    await persistirSucesso(admin, familia, canal, refDe(r)); // update anuncios_externos: publicado + item_externo_id + variacoes_externas + permalink
    return Response.json({ ok: true });
  } catch (e) {
    return await tratarExcecao(admin, familia, canal, e); // classificarErroCanal -> mesmo contrato retentável/definitivo
  }
});
```

`marcarErro`/`tratarErroCanal`/`persistirSucesso` são helpers locais pequenos que escrevem **apenas** na linha `(org_id, canal, codigo_pai, particao 0)` de `anuncios_externos` — **nunca** em `familias.status` (D-E6.2: canais não se contaminam; `familias.status` pertence ao fluxo ML).

- [ ] **Step 3: Teste de integração com o fake** (vitest, sem rede): registrar `fakeConnector`, simular o handler com um claim real mockado — casos: CREATE feliz (linha vira `publicado`, `item_externo_id = FAKE-*`); erro retentável (resposta 500, linha continua `publicando`? **não** — retentável mantém claim e retorna 500 p/ QStash retentar, igual ao padrão ML); erro definitivo (linha `erro` + mensagem); re-entrega (claim null → skip). Extrair o miolo do handler para função testável `processarJob(deps)` se necessário para injetar mocks.
- [ ] **Step 4:** Baseline + `deno check`. **Commit** — `git commit -m "feat(e6): worker genérico publicar-anuncio + fila serial por (canal, org)"`

### Task 7: `publicar-familias` aceita `canais[]` (ML intocado)

**Files:** Modify: `supabase/functions/publicar-familias/index.ts` · `src/lib/publicar.ts`

**Interfaces:**
- Body novo: `{ familia_ids: string[], listing_type_id?: string, canais?: string[] }` — `canais` default `['mercado_livre']` (chamadas atuais 100% compatíveis).
- Front: `publicarFamilias(familiaIds, listingTypeId = 'gold_special', canais: string[] = ['mercado_livre'])`.

- [ ] **Step 1:** No roteador, após o fluxo ML atual (que permanece **byte a byte** o mesmo quando `canais` inclui `'mercado_livre'`), adicionar o fan-out dos demais canais:

```ts
const canaisExtras = (canais ?? ['mercado_livre']).filter((c) => c !== 'mercado_livre');
for (const canal of canaisExtras) {
  const conexao = await resolverConexao(admin, orgId, canal);
  if (!conexao) continue; // canal não conectado pela org: ignora silencioso? NÃO — devolve no response: { canaisIgnorados: [...] }
  for (const familia of familiasAlvo) {           // as mesmas famílias claimadas p/ ML? Não: canais extras têm claim próprio
    await garantirAnuncioExterno(admin, { orgId, userId: user.id, canal, codigoPai: familia.codigo_pai });
    const claim = await claimAnuncioExterno(admin, { orgId, canal, codigoPai: familia.codigo_pai });
    if (claim) await enfileirarPublicacaoCanal({ familia_id: familia.id, lote_id: familia.lote_id, canal }, orgId);
  }
}
```

`familiasAlvo` = famílias do body elegíveis (status `pronto|erro|publicado` — por canal a elegibilidade é do claim da linha do canal, não do `familias.status`); resposta ganha `{ enfileiradas, porCanal: Record<canal, number>, canaisIgnorados: string[] }`.

- [ ] **Step 2:** Teste (função pura extraída `separarCanais(canais)` trivial + caso de resposta com `canaisIgnorados`); baseline.
- [ ] **Step 3: Commit** — `git commit -m "feat(e6): publicar-familias com fan-out por canal (default ML inalterado)"`

### Task 8: `status-publicados` e `remover-publicado` por canal

**Files:** Modify: `status-publicados/index.ts` · `remover-publicado/index.ts` · `src/lib/queries.ts`

- [ ] **Step 1: `status-publicados`:** em vez de `getConnector('mercado_livre')` fixo (linha 32), agrupar os `anuncios_externos` da org por `canal` e, para cada canal com conexão, chamar `conn.lerStatus(ctx, ids)`; resposta: cada item ganha `canal`. Tipo no front (`queries.ts:556`): `StatusPublicadoItem` ganha `canal: string` (default `'mercado_livre'` na leitura para compat).
- [ ] **Step 2: `remover-publicado`:** body ganha `canal?: string` default `'mercado_livre'`; o delete do espelho usa o canal do body (linha 61 deixa de ser literal). Comportamento atual = default → zero mudança para o caller existente.
- [ ] **Step 3:** Baseline + deploy CLI (com OK do Diego) + browser-use: Publicados carrega status ao vivo idêntico ao de hoje.
- [ ] **Step 4: Commit** — `git commit -m "feat(e6): status e remoção parametrizados por canal"`

### Task 9: UI — seleção de canais na Revisão + chip por canal em Publicados

**Files:** Modify: `src/pages/Revisao.tsx` · `src/lib/queries.ts` (nova `fetchConexoes`) · tela Publicados (componente da linha)

- [ ] **Step 1:** `fetchConexoes(): Promise<{ canal: string; contaLabel: string | null }[]>` — select em `marketplace_connections` (RLS da org já filtra). Query key `QK.conexoes = ['conexoes']`.
- [ ] **Step 2: Revisão:** ao lado do seletor Clássico/Premium existente, grupo de checkboxes "Publicar em:" com um item por conexão da org (ML pré-marcado; com 1 conexão o grupo **não renderiza** — zero mudança visual hoje). `publicarFamilias(ids, listingType, canaisSelecionados)`.
- [ ] **Step 3: Publicados:** chip do canal na linha (badge com o nome do canal) — renderizado **somente quando** a org tem >1 canal com anúncios (dedupe atual por `ml_item_id` já convive com partições; o chip lê `canal` do item).
- [ ] **Step 4:** Testes de lógica pura (visibilidade do grupo/chip por nº de conexões) + light/dark; baseline; browser-use (com 1 conexão: telas idênticas às atuais).
- [ ] **Step 5: Commit** — `git commit -m "feat(e6): seleção de canais na Revisão + chip por canal (aparece só multi-canal)"`

### Task 10: `classificarErroCanal` — códigos que mudam decisão

**Files:** Modify: `_shared/canais/mapeamento.ts` + teste existente do módulo

- [ ] **Step 1:** TDD: HTTP 401/403 do canal → `AUTENTICACAO` (não retentável — reconectar); 429 → `RATE_LIMIT` (retentável — já era, agora com código próprio); mantém `FOTO`/`DESCONHECIDO`. Nenhum outro código novo (YAGNI D-E6.6).
- [ ] **Step 2:** Baseline. **Commit** — `git commit -m "feat(e6): classificarErroCanal distingue AUTENTICACAO e RATE_LIMIT (TDD)"`

### Task 11: Gate final do épico

- [ ] **Step 1:** Suite completa + tsc + deno check + lint + build verdes; teste de integração do worker genérico com `fakeConnector` cobrindo os 4 caminhos (CREATE, UPDATE, erro retentável, erro definitivo) + isolamento entre canais (erro no fake **não** toca `familias.status` nem a linha ML).
- [ ] **Step 2:** Regressão ML real (browser-use): publicar 1 família de teste no fluxo controlado → idêntico ao pré-E6; remover ao final.
- [ ] **Step 3:** Re-rodar `scripts/verificar-isolamento-tenant.ts` (E7) — o fan-out não pode ter aberto furo cross-org.
- [ ] **Step 4: Docs:** `edge-functions.md` (`publicar-anuncio`), `modelo-de-dados.md` (status/qstash_message_id em `anuncios_externos`), `arquitetura.md` (diagrama fan-out), `project-status.md` + `TASKS.md`, obsidian-vault, Graphify re-ingest.
- [ ] **Step 5: Commit final + registro do critério de saída.**

---

## Critério de saída do E6 (ajustado — D-E6.7)

1. ✅ `publicar-familias` fan-out por `(família, canal)`; claim/estado/erro **por canal** em `anuncios_externos`; falha de um canal nunca toca outro (provado por teste com fake).
2. ✅ Canal ML real: comportamento **idêntico** ao pré-épico (regressão browser-use + suite).
3. ✅ Worker genérico `publicar-anuncio` pronto para o E5: adicionar Shopee = implementar `ShopeeConnector` + registrar no registry + adicionar valor no enum `canal_externo`.
4. ⏳ **Diferido para o fechamento do E5:** "1 família publica em ML + Shopee simultaneamente" — bloqueado por não existir 2º canal real; a infraestrutura fica provada por fake.

## Self-review (executado na escrita do plano)

- **Cobertura vs doc mestre:** E6.1 (canais no body) → Task 7; E6.2 (worker genérico) → Tasks 3, 6; E6.3 (fan-out escalonado) → fila serial por (canal, org) na Task 6 (o delay escalonado do lote #28 já vive na fila serial — nada novo necessário); E6.4 (reconciliação por canal) → Task 8; E6.5 (UI) → Task 9. Extras: dessacople de tipos (Task 2), fake (Task 4), extração do builder (Task 5), erros (Task 10).
- **Placeholders:** nenhum "TBD"; os dois pontos de adaptação em execução (nome exato de variáveis locais na extração da Task 5; forma do `montarAtualizacao` no UPDATE genérico) estão ancorados em código existente citado (`publish-familia-ml`, `update-familia-ml`) — a Task 6 usa o mesmo contrato `AtualizacaoCanonica` já definido no contrato.
- **Tipos consistentes entre tasks:** `PublicarAnuncioJob`/`claimAnuncioExterno`/`garantirAnuncioExterno`/`montarAnuncioCanonico`/`fakeConnector`/`registrarConectorParaTeste` conferidos task a task.
- **Dependência E7:** Tasks 6-9 consomem `org_id`/`resolverConexao`/`marketplace_connections` — o plano **não executa** antes do E7 concluído.
