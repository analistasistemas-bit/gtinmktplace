# Publicação Legacy e User Products — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar uma família com uma ou N cores como um único anúncio lógico por faixa de preço, usando `variations[]` no Legacy ou itens planos agrupados por `family_id` em User Products.

**Architecture:** `anuncios_externos` continua representando a partição comercial. A nova tabela `anuncios_externos_itens` registra os itens técnicos UP. A detecção ADR-0087 vira um resultado tipado para o orquestrador, que persiste o formato por conexão+categoria e executa uma saga idempotente: cria ou retoma todos os itens, confirma o mesmo `family_id`, pausa o conjunto em falha e só então ativa e publica a família.

**Tech Stack:** TypeScript, Deno Edge Functions, Supabase/PostgreSQL, Vitest, API REST Mercado Livre.

## Global Constraints

- `anuncios_externos.particao` continua significando faixa de preço/anúncio lógico, nunca cor.
- Preços iguais permanecem em uma família; preços diferentes continuam gerando partições distintas.
- Legacy permanece com `variations[]`; anúncios existentes não são convertidos preventivamente.
- UP usa um item plano por SKU e o mesmo `family_name` dentro da partição.
- A família só recebe `status='publicado'` depois que todos os itens esperados estiverem confirmados e ativos.
- Retry reutiliza `item_externo_id` persistido e nunca repete POST de SKU já criado.
- O cache de formato é chaveado por conexão+categoria e orienta apenas CREATE.
- Compensação pausa; nunca encerra ou apaga automaticamente.
- Nenhuma dependência nova.

## File Structure

**Create:**

- `supabase/migrations/20260722190000_ml_user_products_itens.sql` — tabelas, constraints, índices e RLS.
- `supabase/functions/_shared/ml/formato-publicacao.ts` — tipos e cache conta+categoria.
- `supabase/functions/_shared/ml/__tests__/formato-publicacao.test.ts` — decisão e cache.
- `supabase/functions/_shared/user-products/publicar-grupo.ts` — saga idempotente.
- `supabase/functions/_shared/user-products/__tests__/publicar-grupo.test.ts` — atomicidade e retry.
- `supabase/functions/reconciliar-user-products/index.ts` — backfill remoto controlado.

**Modify:**

- `supabase/functions/_shared/canais/contrato.ts`
- `supabase/functions/_shared/canais/mercado-livre.ts`
- `supabase/functions/_shared/ml/publicar.ts`
- `supabase/functions/_shared/ml/criar-item.ts`
- `supabase/functions/_shared/ml/atualizar-item.ts`
- `supabase/functions/publicar-split-ml/index.ts`
- `supabase/functions/publish-familia-ml/index.ts`
- `supabase/functions/update-familia-ml/index.ts`
- `supabase/functions/_shared/anuncios/espelhar.ts`
- consumidores de IDs em faturamento, vendas, pedidos, moderação e exclusão
- ADR-0084, ADR-0087, referência de edge functions e TASKS

---

### Task 0: Preparar worktree atualizado

**Files:** nenhum arquivo de produto.

- [ ] **Step 1: Criar isolamento a partir do código implantado**

Usar `superpowers:using-git-worktrees`. Atualizar referências e criar o worktree a partir de
`origin/main`, que já contém o ADR-0087 (`4ed9437`) e os commits de deploy; não implementar sobre o
`main` local defasado.

Run: `rtk git fetch origin && rtk git worktree add .worktrees/user-products-definitivo -b feat/user-products-definitivo origin/main`

Expected: worktree limpo em `feat/user-products-definitivo`, contendo `supabase/functions/_shared/ml/erro-ml.ts` e o retry ADR-0087 atual.

- [ ] **Step 2: Levar os documentos aprovados ao branch de execução**

Run: `rtk git cherry-pick d5edf46 29b8429`

Expected: especificação e plano presentes no worktree, sem conflito.

---

### Task 1: Persistência de itens UP e formato detectado

**Files:**
- Create: `supabase/migrations/20260722190000_ml_user_products_itens.sql`

**Interfaces:**
- Produces: `anuncios_externos_itens` e `ml_formato_publicacao`.

- [ ] **Step 1: Criar a migration**

```sql
create table public.anuncios_externos_itens (
  id uuid primary key default gen_random_uuid(),
  anuncio_externo_id uuid not null references public.anuncios_externos(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  variacao_id uuid not null references public.variacoes(id) on delete restrict,
  sku text not null,
  item_externo_id text,
  user_product_id text,
  family_id text,
  permalink text,
  status text not null default 'pendente'
    check (status in ('pendente','criado','pausado','ativo','erro')),
  erro_mensagem text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (anuncio_externo_id, variacao_id)
);
create unique index anuncios_externos_itens_org_item_uidx
  on public.anuncios_externos_itens(org_id, item_externo_id)
  where item_externo_id is not null;

create table public.ml_formato_publicacao (
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,
  categoria_id text not null,
  formato text not null check (formato in ('legacy','user_products')),
  detectado_em timestamptz not null default now(),
  ultima_confirmacao_em timestamptz not null default now(),
  primary key (connection_id, categoria_id)
);
```

Habilitar RLS nas duas tabelas. Copiar a política org-scoped de `anuncios_externos`; em `ml_formato_publicacao`, permitir leitura somente quando a conexão pertencer a `public.current_org_id()`. Escrita fica restrita a `service_role`.

- [ ] **Step 2: Aplicar e validar**

Run: `rtk supabase db reset`

Expected: migration aplicada sem erro.

Run: `rtk supabase db lint`

Expected: nenhum erro novo de schema ou RLS.

- [ ] **Step 3: Commit**

```bash
rtk git add supabase/migrations/20260722190000_ml_user_products_itens.sql
rtk git commit -m "feat(db): modela itens técnicos de user products"
```

---

### Task 2: Contrato de formato e cache conta+categoria

**Files:**
- Create: `supabase/functions/_shared/ml/formato-publicacao.ts`
- Create: `supabase/functions/_shared/ml/__tests__/formato-publicacao.test.ts`
- Modify: `supabase/functions/_shared/canais/contrato.ts`

**Interfaces:**
- Produces: `FormatoPublicacaoML`, `lerFormatoPublicacao`, `confirmarFormatoPublicacao`.
- Produces: `AnuncioCanonico.formato?: 'legacy' | 'user_products'`.
- Produces: código de erro `FORMATO_INCOMPATIVEL`.

- [ ] **Step 1: Escrever teste RED**

```ts
it('isola o formato por conexão e categoria', async () => {
  const repo = repoFake();
  expect(await lerFormatoPublicacao(repo, 'c1', 'MLB419782')).toBe('desconhecido');
  await confirmarFormatoPublicacao(repo, 'c1', 'MLB419782', 'user_products');
  expect(await lerFormatoPublicacao(repo, 'c1', 'MLB419782')).toBe('user_products');
  expect(await lerFormatoPublicacao(repo, 'c2', 'MLB419782')).toBe('desconhecido');
});
```

Run: `rtk test pnpm vitest run supabase/functions/_shared/ml/__tests__/formato-publicacao.test.ts`

Expected: FAIL por módulo ausente.

- [ ] **Step 2: Implementar contrato mínimo**

```ts
export type FormatoPublicacaoML = 'legacy' | 'user_products';
export type FormatoConhecidoML = FormatoPublicacaoML | 'desconhecido';

export interface FormatoRepo {
  buscar(connectionId: string, categoriaId: string): Promise<FormatoPublicacaoML | null>;
  salvar(connectionId: string, categoriaId: string, formato: FormatoPublicacaoML): Promise<void>;
}
export async function lerFormatoPublicacao(
  repo: FormatoRepo, connectionId: string, categoriaId: string,
): Promise<FormatoConhecidoML> {
  return (await repo.buscar(connectionId, categoriaId)) ?? 'desconhecido';
}
export async function confirmarFormatoPublicacao(
  repo: FormatoRepo, connectionId: string, categoriaId: string, formato: FormatoPublicacaoML,
): Promise<void> {
  await repo.salvar(connectionId, categoriaId, formato);
}
```

Adicionar `formato?: FormatoPublicacaoML` a `AnuncioCanonico` e `FORMATO_INCOMPATIVEL` a `ErroCanalCodigo`.

- [ ] **Step 3: Provar teste e tipo**

Run: `rtk test pnpm vitest run supabase/functions/_shared/ml/__tests__/formato-publicacao.test.ts && rtk tsc --noEmit`

Expected: PASS e zero erros de tipo.

- [ ] **Step 4: Commit**

```bash
rtk git add supabase/functions/_shared/ml/formato-publicacao.ts supabase/functions/_shared/ml/__tests__/formato-publicacao.test.ts supabase/functions/_shared/canais/contrato.ts
rtk git commit -m "feat(ml): tipa formato legacy e user products"
```

---

### Task 3: Conector cria exatamente o formato solicitado

**Files:**
- Modify: `supabase/functions/_shared/canais/mercado-livre.ts`
- Modify: `supabase/functions/_shared/canais/contrato.ts`
- Modify: `supabase/functions/_shared/ml/publicar.ts`
- Modify: `supabase/functions/_shared/ml/criar-item.ts`
- Test: `supabase/functions/_shared/canais/__tests__/mercado-livre.test.ts`
- Test: `supabase/functions/_shared/ml/__tests__/publicar.test.ts`
- Test: `supabase/functions/_shared/ml/__tests__/criar-item.test.ts`

**Interfaces:**
- Consumes: `AnuncioCanonico.formato`.
- Produces: `RefAnuncio.userProductId?`, `familyId?`, `statusRemoto?`.
- Produces: `FORMATO_INCOMPATIVEL` sem retry interno.

- [ ] **Step 1: Escrever testes RED**

```ts
expect(await criar(base9Cores, 'legacy')).toMatchObject({
  ok: false, erro: { codigo: 'FORMATO_INCOMPATIVEL' },
});
expect(postBodies).toHaveLength(1);

expect(await criar(base1Cor, 'user_products')).toMatchObject({
  ok: true,
  valor: { itemExternoId: 'MLB1', userProductId: 'MLBU1', familyId: 'F1' },
});
expect(postBodies[0].variations).toBeUndefined();

expect(await criar(base2Cores, 'user_products')).toMatchObject({
  ok: false, erro: { codigo: 'VARIACAO' },
});
expect(postBodies).toHaveLength(0);
```

Run: `rtk test pnpm vitest run supabase/functions/_shared/canais/__tests__/mercado-livre.test.ts supabase/functions/_shared/ml/__tests__/publicar.test.ts supabase/functions/_shared/ml/__tests__/criar-item.test.ts`

Expected: FAIL nos novos contratos.

- [ ] **Step 2: Remover retry plano interno**

No catch do CREATE Legacy:

```ts
if (a.formato !== 'user_products' && precisaItemPlano(status, mlCauses)) {
  return {
    ok: false,
    erro: {
      codigo: 'FORMATO_INCOMPATIVEL',
      mensagemOperador: 'A conta e a categoria exigem publicação por User Products.',
      retentavel: false,
      status,
      raw: mlCauses,
    },
  };
}
```

Para `user_products`, exigir exatamente uma variação antes do POST e chamar
`montarPayloadItem(..., 'plano')`. Não sintetizar `ml_variation_id`.

- [ ] **Step 3: Mapear resposta UP**

```ts
export interface ItemCriadoML {
  id: string;
  permalink: string;
  variations: Array<{ id: number; seller_custom_field?: string }>;
  user_product_id?: string;
  family_id?: string | number;
  status?: string;
}
```

Normalizar `family_id` com `String(value)` quando presente.

- [ ] **Step 4: Rodar testes**

Run: `rtk test pnpm vitest run supabase/functions/_shared/canais/__tests__/mercado-livre.test.ts supabase/functions/_shared/ml/__tests__/publicar.test.ts supabase/functions/_shared/ml/__tests__/criar-item.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add supabase/functions/_shared/canais supabase/functions/_shared/ml/publicar.ts supabase/functions/_shared/ml/criar-item.ts supabase/functions/_shared/ml/__tests__
rtk git commit -m "fix(ml): entrega incompatibilidade UP ao orquestrador"
```

---

### Task 4: Saga idempotente de uma partição UP

**Files:**
- Create: `supabase/functions/_shared/user-products/publicar-grupo.ts`
- Create: `supabase/functions/_shared/user-products/__tests__/publicar-grupo.test.ts`

**Interfaces:**
- Produces: `publicarGrupoUP(input, portas): Promise<ResultadoGrupoUP>`.

- [ ] **Step 1: Escrever matriz RED**

Cobrir cinco testes com asserts exatos:

```ts
it('9 SKUs: cria, confirma um family_id e ativa todos', async () => {
  expect(post).toHaveBeenCalledTimes(9);
  expect(confirmar).toHaveBeenCalledTimes(9);
  expect(ativar).toHaveBeenCalledTimes(9);
});
it('falha no SKU 8: pausa os 7 criados e retorna erro', async () => {
  expect(pausar).toHaveBeenCalledTimes(7);
});
it('retry reutiliza 7 IDs e cria somente 2', async () => {
  expect(post).toHaveBeenCalledTimes(2);
});
it('family_id divergente pausa todos', async () => {
  expect(resultado).toMatchObject({ ok: false, codigo: 'familia_up_desagrupada' });
});
it('falha de ativação pausa o conjunto', async () => {
  expect(resultado).toMatchObject({ ok: false, codigo: 'familia_up_ativacao_falhou' });
});
```

Run: `rtk test pnpm vitest run supabase/functions/_shared/user-products/__tests__/publicar-grupo.test.ts`

Expected: FAIL por módulo ausente.

- [ ] **Step 2: Definir portas**

```ts
export interface ItemUP {
  variacaoId: string;
  sku: string;
  itemExternoId: string | null;
  userProductId: string | null;
  familyId: string | null;
  status: 'pendente' | 'criado' | 'pausado' | 'ativo' | 'erro';
}
export interface PortasUP {
  listar(anuncioExternoId: string): Promise<ItemUP[]>;
  reservar(anuncioExternoId: string, variacaoId: string, sku: string): Promise<ItemUP>;
  salvarCriado(item: ItemUP): Promise<void>;
  salvarStatus(itemExternoId: string, status: ItemUP['status'], erro?: string): Promise<void>;
  criarPlano(sku: string): Promise<{
    itemExternoId: string;
    userProductId: string | null;
    familyId: string | null;
  }>;
  confirmar(itemExternoId: string): Promise<{ userProductId: string; familyId: string; status: string }>;
  mudarStatus(itemExternoId: string, status: 'pausado' | 'ativo'): Promise<void>;
}
```

- [ ] **Step 3: Implementar transições**

Algoritmo obrigatório:

1. reservar linha por `(anuncio_externo_id, variacao_id)`;
2. pular POST se já existir `item_externo_id`;
3. persistir cada POST antes de qualquer outra chamada;
4. pausar imediatamente o item recém-criado antes de criar o próximo SKU;
5. confirmar todos por GET e persistir `user_product_id`/`family_id` retornados;
6. exigir que todos tenham `family_id` e que exista um único valor no conjunto;
7. ativar todos somente depois da confirmação completa;
8. em qualquer falha, pausar todos os IDs conhecidos;
9. agregar erro de compensação sem ocultar a causa inicial.

O teste de sucesso deve exigir 9 pausas de staging e 9 ativações; antes da primeira ativação, os nove
itens precisam estar persistidos, confirmados e pausados. Isso implementa a semântica “todos ou erro”
sem depender de suporte transacional do endpoint externo.

- [ ] **Step 4: Rodar matriz**

Run: `rtk test pnpm vitest run supabase/functions/_shared/user-products/__tests__/publicar-grupo.test.ts`

Expected: 5 testes PASS com contagens exatas.

- [ ] **Step 5: Commit**

```bash
rtk git add supabase/functions/_shared/user-products
rtk git commit -m "feat(ml): adiciona saga idempotente de user products"
```

---

### Task 5: Integrar CREATE de uma ou N variações

**Files:**
- Modify: `supabase/functions/publicar-split-ml/index.ts`
- Modify: `supabase/functions/publish-familia-ml/index.ts`
- Modify: `supabase/functions/_shared/anuncios/espelhar.ts`
- Test: `supabase/functions/publicar-split-ml/__tests__/user-products.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: uma partição lógica por faixa e N itens técnicos UP.

- [ ] **Step 1: Escrever testes RED**

```ts
expect(gruposMesmoPreco).toHaveLength(1);
expect(itensDoGrupo).toHaveLength(9);
expect(new Set(itensDoGrupo.map((i) => i.familyId))).toEqual(new Set(['F1']));

expect(gruposDoisPrecos.map((g) => g.variacoes.length)).toEqual([7, 2]);
expect(new Set(gruposDoisPrecos.map((g) => g.familyName)).size).toBe(2);

expect(cache.salvar).toHaveBeenCalledWith(connectionId, 'MLB419782', 'user_products');
expect(saga.publicar).toHaveBeenCalledTimes(1);
```

Run: `rtk test pnpm vitest run supabase/functions/publicar-split-ml/__tests__/user-products.test.ts`

Expected: FAIL antes da integração.

- [ ] **Step 2: Criar raiz lógica antes dos filhos**

Fazer upsert de `anuncios_externos` por `(org_id, canal, codigo_pai, particao)` com
`status='publicando'`, `titulo=familyName` e `item_externo_id=null`. Recuperar o `id` e entregá-lo à saga.

- [ ] **Step 3: Roteamento por formato**

```ts
const conhecido = await lerFormatoPublicacao(repo, connectionId, categoriaId);
if (conhecido === 'user_products') return publicarGrupoUP(...);
const legado = await conn.criarAnuncio(ctx, { ...anuncio, formato: 'legacy' });
if (legado.erro?.codigo !== 'FORMATO_INCOMPATIVEL') return persistirLegado(legado);
await confirmarFormatoPublicacao(repo, connectionId, categoriaId, 'user_products');
return publicarGrupoUP(...);
```

A detecção ocorre antes de avançar para outra partição.

- [ ] **Step 4: Unificar o caso de uma variação**

Quando `publish-familia-ml` receber `FORMATO_INCOMPATIVEL`, usar a mesma orquestração UP, sem retry
plano dentro do conector.

- [ ] **Step 5: Persistir sucesso final**

Depois do sucesso de todas as sagas:

- `anuncios_externos.status='publicado'`;
- `item_externo_id` recebe o primeiro item técnico da partição por compatibilidade;
- `familias.ml_item_id` recebe o primeiro item da partição 0;
- `variacoes.ml_variation_id=null` em UP;
- `familias.status='publicado'` somente após todas as partições.

- [ ] **Step 6: Rodar testes**

Run: `rtk test pnpm vitest run supabase/functions/publicar-split-ml/__tests__/user-products.test.ts supabase/functions/_shared/canais/__tests__/mercado-livre.test.ts`

Expected: PASS para 1 cor, 9 cores, duas faixas, falha parcial e retry.

- [ ] **Step 7: Commit**

```bash
rtk git add supabase/functions/publicar-split-ml supabase/functions/publish-familia-ml supabase/functions/_shared/anuncios/espelhar.ts
rtk git commit -m "feat(ml): publica grupos UP sem alterar split comercial"
```

---

### Task 6: UPDATE por item técnico UP

**Files:**
- Modify: `supabase/functions/_shared/ml/atualizar-item.ts`
- Modify: `supabase/functions/_shared/canais/mercado-livre.ts`
- Modify: `supabase/functions/update-familia-ml/index.ts`
- Test: `supabase/functions/update-familia-ml/__tests__/user-products.test.ts`

**Interfaces:**
- Consumes: itens filhos da Task 1.
- Produces: estoque/preço por SKU, nova cor idempotente e pausa de cor retirada.

- [ ] **Step 1: Escrever testes RED**

Cobrir com fixtures completas de item filho, variação e fetch mockado:

```ts
expect(await atualizar({ sku: 'B', estoque: 8, preco: 14.89 })).toMatchObject({ ok: true });
expect(puts).toEqual([{ itemId: 'MLB-B', body: { available_quantity: 8, price: 14.89 } }]);
await atualizar({ sku: 'B', estoque: 9, preco: 15.99, somenteEstoque: true });
expect(puts.at(-1)?.body).toEqual({ available_quantity: 9 });
expect(await adicionarCor({ sku: 'C', familyName: 'Agulha Matte' })).toMatchObject({ familyId: 'F1' });
await retirarCor('B');
expect(statusCalls.at(-1)).toEqual({ itemId: 'MLB-B', status: 'pausado' });
expect(await atualizarLegado(fixtureLegacy)).toMatchObject({ ok: true });
expect(putsLegado[0].body.variations).toHaveLength(fixtureLegacy.existentes.length);
```

Run: `rtk test pnpm vitest run supabase/functions/update-familia-ml/__tests__/user-products.test.ts`

Expected: FAIL nos casos UP.

- [ ] **Step 2: Ler metadados remotos**

Estender `buscarItemML` para retornar `user_product_id`, `family_id`, `family_name`, `status`,
`price` e `available_quantity`. Definir item UP como `variations.length === 0 && family_name != null`.

- [ ] **Step 3: Atualizar membros existentes**

Para cada item filho enviar:

```ts
{
  available_quantity: estoqueCapado,
  ...(somenteEstoque ? {} : { price: precoPublicacao }),
}
```

Persistir `preco_publicado_ml` somente após sucesso.

- [ ] **Step 4: Tratar inclusão e retirada**

Nova cor usa CREATE plano com o `family_name` da partição e precisa retornar o mesmo `family_id`.
Cor retirada chama `atualizarStatus(..., 'pausado')` e mantém sua linha filha.

- [ ] **Step 5: Rodar testes**

Run: `rtk test pnpm vitest run supabase/functions/update-familia-ml/__tests__/user-products.test.ts supabase/functions/_shared/canais/__tests__/mercado-livre.test.ts`

Expected: PASS, incluindo regressão Legacy.

- [ ] **Step 6: Commit**

```bash
rtk git add supabase/functions/_shared/ml/atualizar-item.ts supabase/functions/_shared/canais/mercado-livre.ts supabase/functions/update-familia-ml
rtk git commit -m "feat(ml): atualiza membros de famílias user products"
```

---

### Task 7: Adaptar consumidores de IDs externos

**Files:**
- Modify: `supabase/functions/_shared/faturamento/io.ts`
- Modify: `supabase/functions/_shared/ml/vendas.ts`
- Modify: `supabase/functions/_shared/ml/pedidos.ts`
- Modify: `supabase/functions/_shared/moderacao/diff.ts`
- Modify: `supabase/functions/_shared/lote/exclusao.ts`
- Test: testes irmãos desses módulos

**Interfaces:**
- Consumes: mapa `item_externo_id → variacao_id/sku`.
- Produces: resolução híbrida Legacy/UP.

- [ ] **Step 1: Escrever testes RED**

```ts
const filhos = [
  { item_externo_id: 'MLB-A', variacao_id: 'var-a', sku: 'A' },
  { item_externo_id: 'MLB-B', variacao_id: 'var-b', sku: 'B' },
];
expect(resolverVenda('MLB-B', null)).toMatchObject({ sku: 'B', is_publiai: true });
expect(idsGerenciados).toEqual(expect.arrayContaining(['MLB-A', 'MLB-B']));
expect(podeExcluirFamiliaComFilhoPublicado).toBe(false);
```

Também afirmar que um item externo sem linha filha continua seguindo o fallback existente por
`(ml_item_id, variation_id)` e que uma linha filha pendente sem `item_externo_id` não bloqueia exclusão.

Run: `rtk test pnpm vitest run supabase/functions/_shared/faturamento supabase/functions/_shared/ml/__tests__/vendas.test.ts supabase/functions/_shared/ml/__tests__/pedidos.test.ts supabase/functions/_shared/moderacao supabase/functions/_shared/lote/__tests__/exclusao.test.ts`

Expected: FAIL porque filhos ainda não entram nos mapas.

- [ ] **Step 2: Montar mapas híbridos**

```ts
itemParaSku.set(filho.item_externo_id, filho.sku);
idsPubliai.add(filho.item_externo_id);
```

Resolver primeiro pelo item filho UP; depois manter o caminho atual por
`(ml_item_id, variation_id)` e o fallback por GTIN.

- [ ] **Step 3: Preservar qualquer item publicado**

Exclusão/moderação considera a família gerenciada quando houver `familias.publicado_em`,
`anuncios_externos.item_externo_id` ou item filho com ID e status criado/pausado/ativo. Linha pendente
sem ID não conta como publicação.

- [ ] **Step 4: Rodar testes**

Run: `rtk test pnpm vitest run supabase/functions/_shared/faturamento supabase/functions/_shared/ml/__tests__/vendas.test.ts supabase/functions/_shared/ml/__tests__/pedidos.test.ts supabase/functions/_shared/moderacao supabase/functions/_shared/lote/__tests__/exclusao.test.ts`

Expected: PASS para Legacy e UP.

- [ ] **Step 5: Commit**

```bash
rtk git add supabase/functions/_shared/faturamento supabase/functions/_shared/ml/vendas.ts supabase/functions/_shared/ml/pedidos.ts supabase/functions/_shared/moderacao supabase/functions/_shared/lote/exclusao.ts
rtk git commit -m "feat(ml): resolve vendas e estados de itens user products"
```

---

### Task 8: Backfill idempotente dos itens planos existentes

**Files:**
- Create: `supabase/functions/reconciliar-user-products/index.ts`
- Create: `supabase/functions/reconciliar-user-products/__tests__/index.test.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Produces: itens filhos confirmados por GET, sem POST ou PUT.

- [ ] **Step 1: Escrever testes RED**

```ts
const primeira = await reconciliar(fixturePlano);
expect(primeira).toEqual({ inspecionados: 1, inseridos: 1, ignorados: 0, erros: 0 });
const segunda = await reconciliar(fixturePlano);
expect(segunda).toEqual({ inspecionados: 1, inseridos: 0, ignorados: 1, erros: 0 });
expect(await reconciliar(fixtureLegacy)).toEqual({ inspecionados: 1, inseridos: 0, ignorados: 1, erros: 0 });
expect(fetchCalls.filter((c) => c.method === 'POST' || c.method === 'PUT')).toHaveLength(0);
```

Run: `rtk test pnpm vitest run supabase/functions/reconciliar-user-products/__tests__/index.test.ts`

Expected: FAIL por função ausente.

- [ ] **Step 2: Implementar endpoint administrativo**

Fluxo completo:

1. autenticar operador e resolver `org_id`;
2. buscar famílias com `ml_item_id` e sem filho;
3. GET do item;
4. ignorar item com `variations.length > 0` ou sem `family_name`;
5. localizar a única variação local;
6. upsert de anúncio lógico partição 0;
7. upsert do filho com item, UP, família, permalink e status;
8. devolver `inspecionados`, `inseridos`, `ignorados`, `erros`.

- [ ] **Step 3: Provar endpoint**

Run: `rtk test pnpm vitest run supabase/functions/reconciliar-user-products/__tests__/index.test.ts && rtk deno check --config supabase/functions/deno.json supabase/functions/reconciliar-user-products/index.ts`

Expected: PASS e zero erros Deno.

- [ ] **Step 4: Commit**

```bash
rtk git add supabase/functions/reconciliar-user-products supabase/config.toml
rtk git commit -m "feat(ml): reconcilia itens planos existentes"
```

---

### Task 9: Verificação, documentação e deploy controlado

**Files:**
- Modify: `docs/decisions/0084-family-name-categoria-zipper.md`
- Modify: `docs/decisions/0087-family-name-deteccao-reativa.md`
- Modify: `docs/reference/edge-functions.md`
- Modify: `docs/TASKS.md`

- [ ] **Step 1: Rodar verificação focada**

Run: `rtk test pnpm vitest run supabase/functions/_shared/user-products supabase/functions/_shared/ml supabase/functions/_shared/canais supabase/functions/publicar-split-ml supabase/functions/update-familia-ml supabase/functions/reconciliar-user-products`

Expected: todos os testes direcionados PASS.

Run: `rtk npm run check:functions && rtk npm run lint:functions`

Expected: zero erros.

- [ ] **Step 2: Rodar regressão**

Run: `rtk test pnpm test && rtk npm run build`

Expected: suíte completa e build PASS.

- [ ] **Step 3: Atualizar documentação**

Registrar: handoff ADR-0087 ao orquestrador, partição como faixa de preço, itens UP na tabela filha,
compensação por pausa, retry idempotente e UPDATE baseado no remoto.

- [ ] **Step 4: Commit de documentação**

```bash
rtk git add docs/decisions/0084-family-name-categoria-zipper.md docs/decisions/0087-family-name-deteccao-reativa.md docs/reference/edge-functions.md docs/TASKS.md
rtk git commit -m "docs(ml): registra fluxo definitivo de user products"
```

- [ ] **Step 5: Aplicar e publicar**

Run: `rtk supabase db push`

Expected: somente a migration desta feature aplicada.

Run: `rtk supabase functions deploy atualizar-status-publicado metricas-vendas monitorar-moderados process-familia publicar-split-ml publish-familia-ml status-publicados update-familia-ml reconciliar-user-products`

Expected: nove functions publicadas sem erro, garantindo que todos os consumidores dos módulos
compartilhados usem o mesmo contrato.

- [ ] **Step 6: Backfill controlado**

Executar o reconciliador e confirmar os dois itens planos do Lote #36 e o PAI `02638290` do Lote #37.
A segunda execução deve retornar `inseridos=0`; nenhum item Legacy pode ser alterado.

- [ ] **Step 7: Validar PAI 03103331**

Reprocessar somente o PAI e registrar:

1. uma linha lógica, partição 0;
2. nove linhas filhas;
3. nove item IDs;
4. um único `family_id`;
5. nove opções de cor na mesma UPP;
6. preço R$ 14,89 em todos;
7. família e lote publicados somente depois dos nove ativos;
8. retry sem POST adicional.

- [ ] **Step 8: Validar UPDATE reversível**

Aumentar o estoque de uma cor em 1, executar UPDATE, confirmar por GET, reverter e confirmar novamente.
Validar o resolvedor com fixture de pedido contendo o item ID dessa cor; não fabricar venda real.

- [ ] **Step 9: Commit das evidências**

```bash
rtk git add docs/TASKS.md docs/decisions/0084-family-name-categoria-zipper.md docs/decisions/0087-family-name-deteccao-reativa.md
rtk git commit -m "docs(ml): registra validação real do lote 37"
```

## Final Review Checklist

- [ ] Uma cor funciona em Legacy e UP.
- [ ] N cores com mesmo preço formam um anúncio lógico e uma UPP.
- [ ] Preços diferentes continuam formando partições comerciais distintas.
- [ ] Falha parcial nunca deixa a família local como publicada.
- [ ] Compensação pausa todos os itens conhecidos.
- [ ] Retry não duplica POST nem item remoto.
- [ ] `family_id` divergente bloqueia ativação.
- [ ] Vendas e pedidos resolvem SKU pelo item filho.
- [ ] Legacy não sofre mudança observável.
- [ ] Backfill é idempotente e não modifica o remoto.
