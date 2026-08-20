# Adicionar variação a família publicada (ADR-0128) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar N variações (cores) novas a uma família **já publicada** no ML, direto da tela Estoque, montando um lote real de UPDATE que cai no pipeline existente (`publicar-familias` → `update-familia-ml`), sem tela de Revisão.

**Architecture:** Edge nova `adicionar-variacoes-familia` clona a família publicada mais recente (+ variações vivas) para um lote novo `origem='manual'` com `operacao='UPDATE'` e `status='pronto'`, insere as variações novas digitadas (foto já no storage), registra estoque inicial pelo ledger e encadeia `publicar-familias` (server-to-server, JWT encaminhado) — que decide split vs. update e enfileira o worker via QStash. Frontend: dialog novo na tela Estoque (admin-only), badge de status no card, notificação no sino pelo worker.

**Tech Stack:** React + TanStack Query + shadcn (frontend), Supabase Edge Functions (Deno), Postgres (migration via `supabase migration new`), QStash.

**Spec:** `docs/decisions/0128-adicionar-variacao-a-familia-publicada.md` (D-1…D-11). Ler antes de qualquer task.

## Global Constraints

- Migrations **só** via `supabase migration new` + validação `npm run db:check`. **NUNCA** `supabase db push` neste worktree (fica para pós-merge).
- **NUNCA** fazer deploy de edge functions neste worktree (pós-merge).
- RLS por `org_id` — nenhuma tabela nova neste plano; a migration só altera função de trigger.
- `pnpm lint` + `pnpm test` verdes ao fim de cada task; `deno lint` + `deno check` para tasks de edge.
- Nunca editar main; commits nesta branch (`worktree-estoque-add-variacao`).
- Comentários e strings de UI em pt-BR, estilo do codebase (comentários explicam o *porquê*).
- Testes de edge: Deno tests em `supabase/functions/<fn>/__tests__/` (padrão `cadastrar-produto`); testes frontend: vitest em `__tests__/` ao lado do componente.

## Desvios conscientes do texto do ADR-0128 (decididos no planejamento — não rediscutir)

1. **`enfileirarFamilias` NÃO publica.** O sketch do ADR ("enfileira via `enfileirarFamilias`") leva a `process-familia`, que para UPDATE só resolve cor e marca `pronto` (`process-familia/index.ts:195-198`) — o lote ficaria parado esperando clique na Revisão, violando D-10. A edge nova encadeia **`publicar-familias`** (fetch com JWT encaminhado), que já faz claim, decisão split vs. update (ADR-0034/0104) e enfileira o worker. As *decisões* D-1…D-11 permanecem; só o helper do sketch muda.
2. **Lote dedicado por submissão** (não reusa o lote manual aberto do ADR-0094 D-1.1): a unique `familias_lote_id_codigo_pai_key` colidiria com a família CREATE original quando o produto nasceu por cadastro manual.
3. **Migration necessária** (o ADR previa "sem migration"): `validar_variacao_no_tenant` (20260804113000) proíbe INSERT de variação com `estoque <> 0` em lote manual. As cópias das variações vivas PRECISAM nascer com o estoque vivo (senão a família nova vira canônica na tela Estoque com saldo 0 E o worker zeraria o estoque no ML). Relaxamos o guard para só valer quando `familias.operacao = 'CREATE'`.
4. **UNIDADE/FORNECEDOR fora do formulário** (D-6 os lista): são colunas de `familias`, não de `variacoes` — não existe onde gravar por variação. São clonados inalterados da família publicada.
5. **`estoqueInicial > 0` obrigatório** no formulário e na edge: cor nova com estoque 0 nasceria `excluida_da_publicacao` (ADR-0016) e o UPDATE rodaria sem ela — submissão inútil e confusa (mesmo racional anti-zumbi do D-4).

## Fatos do codebase que as tasks assumem (verificados na investigação de 2026-08-20)

- `ingest-lote/index.ts:117-129` resolve o anúncio anterior: família mais recente com `ml_item_id not null` por `(org_id, codigo_pai)`.
- Linhas de variação de UPDATE precisam de: `familia_id, user_id, org_id, codigo, nome, gtin, custo, estoque, preco, peso_gramas, altura_cm, largura_cm, comprimento_cm, imagem_path, ml_variation_id, cor, cor_origem, ml_picture_id, estoque_anterior, preco_publicacao, excluida_da_publicacao` (ingest-lote:265-302).
- `publicar-familias/index.ts:63-71` claim: `operacao='UPDATE'`, `status in ('pronto','erro')`, `ml_item_id not null`, org do chamador; gate `requireUserOrg({access:'write'})` (não exige admin). Linha 188: lote → `publicando`.
- `update-familia-ml/processar.ts:165-174` sobe foto de cor nova a partir de `imagem_path` quando `ml_picture_id` é null (idempotente); `:105` `garantirPrecoUniforme` estoura se `preco_publicacao` divergir entre incluídas.
- Guard admin padrão: `atualizar-status-publicado/index.ts:12-24` (`requireUserOrg` + `!r.isAdmin && r.support?.scope !== 'full'` → 403 + `auditarOperacaoSuporte(..., 'denied')`).
- `codigosJaUsados` (unicidade org-wide de código, familias+variacoes) vive em `cadastrar-produto/index.ts:36-53`.
- Guards de banco (20260804113000): lote manual exige `chave_cadastro` NOT NULL e `codigo_pai ~ '^[0-9]{8}$'` na família; código de variação `^[0-9]{8}$`; INSERT de variação com `estoque <> 0` proibido (é isto que a Task 1 relaxa). `bloquear_escrita_direta_estoque` continua valendo (estoque só via RPC do ledger).
- RPC `produtos_estoque_resumo` (20260814181410) mostra a família **mais recente** por `codigo_pai` (a família de UPDATE vira canônica no INSERT). `registrar_entrada` resolve `(org_id, codigo)` também pela família mais recente.
- Enums: `familia_status`: pendente|processando|pronto|publicando|publicado|erro; `lote_status`: importando|processando|revisao|publicando|concluido|erro.
- Notificações: `notificarCategoria(admin, orgId, 'integracao', texto)` em `_shared/notificacoes/config.ts:67-81`; categoria `integracao` já existe no CHECK — zero migration. O caminho Legacy de update hoje não notifica nada.
- Frontend: `useProfile().isAdmin` (`src/hooks/useProfile.ts:6`); upload cru: `uploadFile('imagens', path, file)` + `buildStoragePath(owner, pasta, nome)` (`src/lib/storage.ts`); owner: `storageOwnerForUpload(userId, orgId, scope)` (`src/hooks/useUploadLote.ts`), primeiro segmento do path precisa ser `auth.uid()` (policy do bucket).

---

### Task 1: Migration — relaxar guard de estoque para famílias UPDATE em lote manual

**Files:**
- Create: `supabase/migrations/<timestamp>_guard_estoque_update_manual.sql` (via `supabase migration new guard_estoque_update_manual`)
- Referência: ler `supabase/migrations/20260804113000_guard_manual_product_direct_writes.sql` inteiro antes de escrever.

**Interfaces:**
- Produces: `validar_variacao_no_tenant()` passa a permitir INSERT de `variacoes` com `estoque <> 0` em lote `origem='manual'` **quando a família tem `operacao = 'UPDATE'`**. Comportamento para `operacao='CREATE'` idêntico ao atual.

- [ ] **Step 1: Criar o arquivo de migration**

Rodar: `supabase migration new guard_estoque_update_manual` (na raiz do worktree). Copiar a função `validar_variacao_no_tenant` VIGENTE de `20260804113000_guard_manual_product_direct_writes.sql` (linhas ~129-173) como base e recriá-la com `create or replace function`, mudando SÓ o bloco do guard de estoque. A consulta que hoje resolve o lote a partir de `new.familia_id` deve passar a selecionar também `f.operacao`. O guard vira:

```sql
-- ADR-0128: família de UPDATE em lote manual clona o estoque vivo das variações irmãs
-- (senão a família nova vira canônica na tela Estoque com saldo 0 e o worker de update
-- zeraria o estoque no ML). O caminho-único-pelo-ledger (ADR-0094 D-15) continua valendo
-- para CREATE (cadastro inicial) — e bloquear_escrita_direta_estoque continua bloqueando
-- UPDATE direto de estoque para todo mundo.
if v_lote_origem = 'manual' and v_familia_operacao = 'CREATE'
   and tg_op = 'INSERT' and new.estoque <> 0 then
  raise exception 'Estoque inicial de produto manual deve ser registrado pelo ledger';
end if;
```

Manter intactos: o guard de `codigo !~ '^[0-9]{8}$'` (vale para CREATE e UPDATE) e tudo mais da função. Não tocar em `validar_familia_no_tenant` nem `bloquear_escrita_direta_estoque`.

- [ ] **Step 2: Validar**

Rodar: `npm run db:check`
Expected: PASS (sem divergência de schema/migration).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(adr-0128): guard de estoque em lote manual passa a valer só para operacao=CREATE"
```

---

### Task 2: Extrair `codigosJaUsados` para `_shared`

**Files:**
- Modify: `supabase/functions/_shared/produto/codigos.ts` (adicionar a função ao fim)
- Modify: `supabase/functions/cadastrar-produto/index.ts:28-53` (remover a definição local, importar de `_shared`)

**Interfaces:**
- Produces: `export async function codigosJaUsados(admin, orgId: string, codigos: string[]): Promise<string[]>` em `_shared/produto/codigos.ts` — corpo movido byte a byte de `cadastrar-produto/index.ts:36-53` (incluindo o comentário sobre falhar alto). Task 3 importa daqui.

- [ ] **Step 1: Mover a função** (recortar de `cadastrar-produto/index.ts`, colar em `_shared/produto/codigos.ts` com o docstring; ajustar o tipo do parâmetro `admin` para o mesmo `ReturnType<typeof adminClient>` importando `adminClient` de `../supabase.ts`, ou tipar estruturalmente como o arquivo preferir). Atualizar o import em `cadastrar-produto/index.ts`.

- [ ] **Step 2: Verificar**

Rodar: `cd supabase/functions && deno lint && deno check cadastrar-produto/index.ts`
Expected: PASS. Rodar também os testes existentes: `deno test cadastrar-produto/` (se houver algum que importe index — os testes são de `processar.ts`, devem continuar verdes).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/produto/codigos.ts supabase/functions/cadastrar-produto/index.ts
git commit -m "refactor: extrair codigosJaUsados para _shared/produto/codigos.ts"
```

---

### Task 3: Edge `adicionar-variacoes-familia` (TDD)

**Files:**
- Create: `supabase/functions/adicionar-variacoes-familia/processar.ts` (lógica pura, testável)
- Create: `supabase/functions/adicionar-variacoes-familia/__tests__/processar.test.ts`
- Create: `supabase/functions/adicionar-variacoes-familia/index.ts`
- Modify: `supabase/config.toml` (registrar a função no mesmo padrão das outras edges chamadas pelo app com JWT — conferir como `cadastrar-produto` está registrada e copiar)

**Interfaces:**
- Consumes: `codigosJaUsados` (Task 2), `enfileirar…` NÃO (ver desvio 1), `requireUserOrg`/`auditarOperacaoSuporte`/`adminClient`/`corsHeaders`/`exigirModulo` dos `_shared` existentes.
- Produces (contrato HTTP, usado pela Task 6):

```
POST /functions/v1/adicionar-variacoes-familia   (JWT do usuário)
Body: {
  familia_id: string,   // família canônica que a tela Estoque conhece — usada só p/ resolver codigo_pai
  chave: string,        // uuid de idempotência (vira familias.chave_cadastro)
  variacoes: [{
    codigo: string,             // 1-8 dígitos; normalizado p/ 8 com padStart
    nome: string,               // obrigatório (vira cor, cor_origem='manual')
    gtin: string | null,
    preco: number,              // > 0 (mínimo líquido, coluna variacoes.preco)
    custo: number | null,       // > 0 se informado
    estoqueInicial: number,     // inteiro > 0 (entra pelo ledger)
    pesoGramas: number | null, alturaCm: number | null,
    larguraCm: number | null, comprimentoCm: number | null,
    imagemPath: string,         // já no bucket 'imagens'; primeiro segmento = auth.uid()
  }]
}
200: { loteId, familiaId, publicacaoOk: boolean, falhasEstoque: string[], jaExistia?: true }
400: { erros: [{campo, mensagem}] } | { error }
403: sem admin / sem módulo estoque
409: { error, conflitos?: string[] }   // codigo duplicado, lote em voo, família não publicada, corrida de chave
```

**Funções puras em `processar.ts`** (assinaturas exatas — a Task 6 e os testes dependem delas):

```ts
export interface VariacaoNovaEntrada {
  codigo: string; nome: string; gtin: string | null;
  preco: number; custo: number | null; estoqueInicial: number;
  pesoGramas: number | null; alturaCm: number | null;
  larguraCm: number | null; comprimentoCm: number | null;
  imagemPath: string;
}
export interface ErroValidacao { campo: string; mensagem: string }

/** Normaliza 1-8 dígitos para 8 com padStart; null se não for só-dígitos ou vazio/9+. */
export function normalizarCodigo8(codigo: string): string | null;

/** Valida o body inteiro (chave uuid, >=1 variação, campos por variação conforme contrato,
 *  códigos duplicados DENTRO do payload, imagemPath começando com `${userId}/` e sem '..').
 *  Espelha as mensagens de erro no estilo de _shared/produto/validar.ts. */
export function validarEntrada(
  body: { familia_id?: unknown; chave?: unknown; variacoes?: unknown }, userId: string,
): ErroValidacao[];

/** preco_publicacao da cor nova = menor preco_publicacao não-nulo entre as irmãs INCLUÍDAS
 *  (excluida_da_publicacao=false), senão fallback (preço digitado). Mesma regra do
 *  ingest-lote (linhas 254-262) — é o que mantém garantirPrecoUniforme feliz no worker Legacy. */
export function precoPublicacaoNova(
  irmas: { preco_publicacao: number | null; excluida_da_publicacao: boolean }[],
  fallback: number,
): number;

/** Clona a linha de familias (select('*')) removendo STRIP_FAMILIA e aplicando overrides. */
export const STRIP_FAMILIA: readonly string[]; // ['id','criado_em','lote_id','status','chave_cadastro','qstash_message_id','erro_mensagem'] + qualquer coluna volátil encontrada na leitura das migrations (ex.: colunas *_em de processamento) — verificar contra 20260527125643 e migrations posteriores
export function clonarFamilia(
  row: Record<string, unknown>,
  ctx: { loteId: string; userId: string; chave: string },
): Record<string, unknown>;  // + operacao:'UPDATE', status:'pronto', lote_id, user_id, chave_cadastro

/** Clona linha de variacoes removendo STRIP_VARIACAO (['id','criado_em','familia_id']) e
 *  aplicando { familia_id, user_id, estoque: estoqueCanonico ?? row.estoque,
 *  estoque_anterior: mesmo valor }. Preserva ml_variation_id/ml_picture_id/cor/preco_publicacao/
 *  excluida_da_publicacao. */
export function clonarVariacao(
  row: Record<string, unknown>,
  ctx: { familiaId: string; userId: string; estoqueCanonico: number | undefined },
): Record<string, unknown>;

/** Monta a linha nova: estoque 0 (ledger preenche), excluida_da_publicacao false,
 *  cor = nome.trim(), cor_origem 'manual', ml_variation_id/ml_picture_id/estoque_anterior null. */
export function montarVariacaoNova(
  v: VariacaoNovaEntrada,
  ctx: { familiaId: string; userId: string; orgId: string; precoPublicacao: number },
): Record<string, unknown>;
```

- [ ] **Step 1: Escrever os testes que falham** (`__tests__/processar.test.ts`, padrão dos testes Deno de `cadastrar-produto/__tests__/` — conferir imports/asserts de lá). Casos mínimos:

```ts
// normalizarCodigo8
assertEquals(normalizarCodigo8('123'), '00000123');
assertEquals(normalizarCodigo8('12345678'), '12345678');
assertEquals(normalizarCodigo8('123456789'), null);
assertEquals(normalizarCodigo8('12a'), null);
assertEquals(normalizarCodigo8(''), null);

// validarEntrada — cobre critérios de aceite 3 (parcial) e 4 (parcial)
// - variacoes vazio -> erro; nome vazio -> erro; preco 0 -> erro; estoqueInicial 0 -> erro;
// - estoqueInicial 1.5 -> erro; imagemPath 'outro-user/x.jpg' -> erro (userId 'user-1');
// - imagemPath 'user-1/../x.jpg' -> erro; codigo repetido em duas linhas -> erro;
// - payload válido -> [].

// precoPublicacaoNova
assertEquals(precoPublicacaoNova([{preco_publicacao: 30, excluida_da_publicacao: false},
  {preco_publicacao: 25, excluida_da_publicacao: false}], 99), 25);
assertEquals(precoPublicacaoNova([{preco_publicacao: 10, excluida_da_publicacao: true}], 99), 99);
assertEquals(precoPublicacaoNova([{preco_publicacao: null, excluida_da_publicacao: false}], 99), 99);

// clonarFamilia — strip + overrides
const fam = clonarFamilia({ id: 'a', criado_em: 'x', lote_id: 'l0', status: 'publicado',
  chave_cadastro: 'k0', qstash_message_id: 'q', erro_mensagem: 'e', nome_pai: 'P',
  ml_item_id: 'MLB1', operacao: 'CREATE', user_id: 'antigo', org_id: 'org' },
  { loteId: 'l1', userId: 'u1', chave: 'k1' });
assertEquals(fam.id, undefined); assertEquals(fam.lote_id, 'l1');
assertEquals(fam.status, 'pronto'); assertEquals(fam.operacao, 'UPDATE');
assertEquals(fam.chave_cadastro, 'k1'); assertEquals(fam.user_id, 'u1');
assertEquals(fam.ml_item_id, 'MLB1'); assertEquals(fam.nome_pai, 'P');

// clonarVariacao — estoque canônico vence o clonado; ml_variation_id preservado
// montarVariacaoNova — excluida_da_publicacao false, cor= nome, estoque 0, preco_publicacao do ctx
```

- [ ] **Step 2: Rodar e ver falhar**: `cd supabase/functions && deno test adicionar-variacoes-familia/` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar `processar.ts`** com as funções acima (sem I/O). Rodar de novo → PASS.

- [ ] **Step 4: Implementar `index.ts`** — fluxo (comentado no estilo do projeto, citando ADR-0128 e os desvios):

1. OPTIONS/405; `requireUserOrg(req, { access: 'write' })`.
2. **Gate admin** — copiar de `atualizar-status-publicado/index.ts:12-24`: `if (!r.isAdmin && r.support?.scope !== 'full')` → auditar `denied` + 403 (ADR-0060/0047).
3. `exigirModulo(admin, orgId, 'estoque')` → 403.
4. Parse + `validarEntrada(body, userId)` → 400 `{erros}`.
5. **Idempotência**: `familias.select('id, lote_id').eq('org_id', orgId).eq('chave_cadastro', chave).maybeSingle()` → se existe, `200 { jaExistia: true, familiaId, loteId, publicacaoOk: true, falhasEstoque: [] }` (retry de rede; não repetir efeitos).
6. Resolver `codigo_pai` da `familia_id` recebida (validar org). Resolver **anterior** = família mais recente com `ml_item_id not null` para `(org_id, codigo_pai)` (mesmo select do `ingest-lote:117-129`, incluindo `variacoes(*)` — aqui pode ser `select('*', variacoes(*))` na prática: duas queries separadas são mais simples: `familias.select('*')...` e `variacoes.select('*').eq('familia_id', anterior.id)`). Sem anterior → 409 "Família ainda não publicada no Mercado Livre.".
7. `codigo_pai` não bate `^[0-9]{8}$`, ou alguma variação viva com código fora de `^[0-9]{8}$` → 409 explicando (o guard de banco de lote manual rejeitaria com erro cru).
8. **D-8**: `familias.select('id').eq('org_id', orgId).eq('codigo_pai', codigoPai).not('status', 'in', '("publicado","erro")').limit(1)` → linha → 409 "Já existe uma atualização em andamento para este produto.".
9. **D-5**: `codigosJaUsados(admin, orgId, codigosNormalizados)` → não-vazio → 409 `{ error, conflitos }`.
10. **Estoque canônico**: família mais recente por `codigo_pai` (qualquer status — pode ser mais nova que a `anterior` se houver uma família em `erro` posterior); se for outra família, buscar `variacoes.select('codigo, estoque')` dela e montar `Map<codigo, estoque>`; senão usar as da anterior.
11. Criar lote: `insert({ user_id, org_id, status: 'publicando', origem: 'manual' })` + `proximo_numero_lote` (copiar de `cadastrar-produto/index.ts:197-203`). `status='publicando'` de propósito: o lote NUNCA aparece na fila de Revisão (critério de aceite 8); se o encadeamento do passo 15 falhar, rebaixamos para `revisao` como rota de recuperação.
12. Inserir família clonada (`clonarFamilia`); em `23505`: se existe família com `(org_id, chave_cadastro)` → 409 "Solicitação em andamento. Tente novamente." (corrida de duplo clique, padrão `cadastrar-produto:231-235`); senão devolver o erro real. Em qualquer falha posterior a este insert, NÃO tentar rollback manual além do descrito (o retry idempotente do passo 5 cobre).
13. Inserir variações: clones (`clonarVariacao`, com estoque canônico) + novas (`montarVariacaoNova`, com `precoPublicacaoNova(irmãsClonadas, v.preco)`). Falha → deletar família criada (padrão `cadastrar-produto:245-249`) e 500.
14. **Ledger**: para cada nova, `registrar_entrada` com `p_ref: 'addvar:${familiaId}:${codigo}'`, `p_doc: 'Variação adicionada'`, `p_custo: v.custo ?? null`, `p_criado_por: userId` (padrão `cadastrar-produto:280-290`). Falhas → `falhasEstoque[]`, não aborta.
15. **Encadear publicação** (desvio 1): `fetch('${Deno.env.get('SUPABASE_URL')}/functions/v1/publicar-familias', { method: 'POST', headers: { Authorization: req.headers.get('Authorization')!, 'Content-Type': 'application/json' }, body: JSON.stringify({ familia_ids: [familiaId] }) })`. **Verificar o body real que `publicar-familias` espera** (ler `publicar-familias/index.ts` — nome do campo e se existe flag `somente_estoque`; NÃO enviar somente_estoque: adicionar variação é mudança de composição, ADR-0104 §4). `publicacaoOk = resp.ok`. Se falhar: `lotes.update({ status: 'revisao' })` (rota de recuperação visível na tela Lotes) e `publicacaoOk: false`.
16. `auditarOperacaoSuporte(admin, context, { type: 'familia', id: familiaId }, 'succeeded')`; retornar 200.

- [ ] **Step 5: Registrar em `supabase/config.toml`** no mesmo formato das demais funções chamadas pelo app (conferir `cadastrar-produto`; JWT verificado — esta NÃO é worker de QStash).

- [ ] **Step 6: Verificar**: `cd supabase/functions && deno lint && deno check adicionar-variacoes-familia/index.ts && deno test adicionar-variacoes-familia/` → tudo PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/adicionar-variacoes-familia/ supabase/config.toml
git commit -m "feat(adr-0128): edge adicionar-variacoes-familia (lote UPDATE manual + encadeia publicar-familias)"
```

---

### Task 4: Notificação no sino ao concluir o UPDATE (D-11, metade sino)

**Files:**
- Modify: `supabase/functions/update-familia-ml/processar.ts` (ponto de sucesso final e caminho de erro)
- Test: `supabase/functions/update-familia-ml/__tests__/` (seguir o padrão existente do diretório; se a decisão for extraída em função pura, testá-la; se o arquivo não tiver testes hoje, criar teste para a função pura nova)

**Interfaces:**
- Consumes: `notificarCategoria(admin, orgId, 'integracao', texto)` de `_shared/notificacoes/config.ts:67`.
- Produces: função pura exportada `mensagemNotificacaoAddVariacao(resultado: 'sucesso' | 'erro', nomePai: string, erro?: string): string` (testável) + disparo condicionado.

- [ ] **Step 1: Ler `update-familia-ml/processar.ts` inteiro** e localizar: (a) o ponto único de sucesso final do UPDATE Legacy (após `talvezFinalizarLote`); (b) onde a família vai a `status='erro'` com `erro_mensagem`.

- [ ] **Step 2: Teste que falha** para a função pura:

```ts
assertEquals(
  mensagemNotificacaoAddVariacao('sucesso', 'Sandália X'),
  'Variações adicionadas: "Sandália X" atualizado no Mercado Livre.',
);
assert(mensagemNotificacaoAddVariacao('erro', 'Sandália X', 'preço divergente').includes('preço divergente'));
```

- [ ] **Step 3: Implementar.** Disparo GATED: só quando o lote do job tem `origem='manual'` E a família `operacao='UPDATE'` (uma query `lotes.select('origem').eq('id', lote_id)` no ponto de conclusão; comentário: "ADR-0128 D-11 — só o fluxo 'adicionar variação' notifica; reposição por planilha continua silenciosa como sempre foi"). Best-effort: falha de notificação NÃO derruba o worker (try/catch com console.error). Categoria `'integracao'`.

- [ ] **Step 4: Verificar**: `deno lint && deno check update-familia-ml/index.ts && deno test update-familia-ml/` → PASS. Conferir que nenhum teste existente quebrou.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/update-familia-ml/
git commit -m "feat(adr-0128): sino de notificacao ao concluir/errar UPDATE de lote manual"
```

---

### Task 5: Lib frontend — status de atualização por produto (D-11, metade card + pré-check D-8)

**Files:**
- Create: `src/lib/estoque-update-status.ts`
- Test: `src/lib/__tests__/estoque-update-status.test.ts` (padrão dos testes de `src/lib/`)
- Modify: `src/lib/queries.ts` (adicionar `QK.familiasNaoPublicadas`)

**Interfaces:**
- Produces:

```ts
export interface FamiliaStatusRow {
  codigo_pai: string; status: string; operacao: string; criado_em: string;
}
/** PostgREST (RLS de org já filtra): familias.select('codigo_pai, status, operacao, criado_em')
 *  .neq('status', 'publicado')  — ponytail: sem filtro de data até virar problema medido. */
export async function fetchFamiliasNaoPublicadas(): Promise<FamiliaStatusRow[]>;

export type StatusUpdateProduto = 'atualizando' | 'erro';
/** Família UPDATE mais recente por codigo_pai:
 *  pendente|processando|pronto|publicando -> 'atualizando'
 *  erro com criado_em < 7 dias -> 'erro'; senão ausente do mapa. Ignora operacao='CREATE'. */
export function statusUpdatePorProduto(
  rows: FamiliaStatusRow[], agora?: Date,
): Map<string, StatusUpdateProduto>;

/** Pré-check D-8 (qualquer operacao conta — é o mesmo predicado da edge). */
export function familiaEmVoo(rows: FamiliaStatusRow[], codigoPai: string): boolean;
```

- [ ] **Step 1: Testes que falham** (vitest):

```ts
// statusUpdatePorProduto
// - UPDATE publicando -> 'atualizando'; UPDATE erro de ontem -> 'erro';
// - UPDATE erro de 8 dias atrás -> ausente; CREATE pendente -> ausente;
// - duas famílias UPDATE do mesmo pai (erro antiga + publicando nova) -> 'atualizando' (a mais recente vence)
// familiaEmVoo
// - CREATE pendente -> true; UPDATE erro -> false (erro é terminal p/ D-8); nada -> false
```

Rodar: `pnpm test src/lib/__tests__/estoque-update-status.test.ts` → FAIL.

- [ ] **Step 2: Implementar** as três funções + a QK. Rodar → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/estoque-update-status.ts src/lib/__tests__/estoque-update-status.test.ts src/lib/queries.ts
git commit -m "feat(adr-0128): status de atualizacao por produto (lib + query key)"
```

---

### Task 6: Dialog "Adicionar variação" + menu no card + wiring na tela Estoque (TDD)

**Files:**
- Create: `src/components/estoque/dialog-adicionar-variacao.tsx`
- Test: `src/components/estoque/__tests__/dialog-adicionar-variacao.test.tsx`
- Modify: `src/components/estoque/linha-variacao-form.tsx` (prop nova `fotoObrigatoria?: boolean` → `CampoFoto` recebe `opcional={!fotoObrigatoria}`; default preserva comportamento atual byte a byte)
- Modify: `src/components/estoque/produto-card.tsx` (item novo no menu "⋮" + badge de status)
- Modify: `src/pages/Estoque.tsx` (estado do dialog, query de status, passes)
- Test: atualizar `src/components/estoque/__tests__/` do produto-card se existir, e `src/pages/__tests__/Estoque.test.tsx` se cobrir o card (rodar a suite para descobrir)

**Interfaces:**
- Consumes: Task 5 (`fetchFamiliasNaoPublicadas`, `statusUpdatePorProduto`, `familiaEmVoo`, `QK.familiasNaoPublicadas`); contrato HTTP da Task 3; `LinhaVariacaoForm`/`novaLinha`/`erroCampo`/`parseNum`; `CampoFoto`; `uploadFile`+`buildStoragePath` (`src/lib/storage.ts`); `storageOwnerForUpload` (`src/hooks/useUploadLote.ts`); `effectiveOrgId`/`canWrite`/`useSupportStore` (`src/stores/support-store.ts`); `useProfile`.
- Produces: `<DialogAdicionarVariacao produto={ProdutoEstoqueResumo | null} aberto={boolean} onFechar={() => void} />`; `ProdutoCard` ganha props `onAdicionarVariacao?: (p: ProdutoEstoqueResumo) => void` e `statusUpdate?: 'atualizando' | 'erro'`.

**Comportamento do dialog:**
- Ao abrir: (a) query PostgREST da família canônica p/ prefill: `familias.select('id, variacoes(codigo, peso_gramas, altura_cm, largura_cm, comprimento_cm)').eq('codigo_pai', produto.codigoPai).order('criado_em', {ascending: false}).limit(1)` — pega a primeira variação como irmã de referência; (b) `fetchFamiliasNaoPublicadas` via react-query (cache compartilhado com a tela).
- Se `familiaEmVoo(...)` → banner âmbar "Já existe uma atualização em andamento para este produto. Aguarde concluir na tela Lotes." + botão salvar travado (critério de aceite 5, lado UI).
- Linhas repetíveis: estado `Array<LinhaVariacao & { codigo: string }>`; cada linha renderiza um Input "Código (SKU)" obrigatório (validação `/^\d{1,8}$/`, sem duplicado no form) ANTES do `<LinhaVariacaoForm fotoObrigatoria …>`. Prefill de peso/dimensões da irmã em `novaLinha()` estendida. Botão "Adicionar variação" para nova linha, como no cadastro.
- `podeSalvar`: todas as linhas com codigo válido e único, nome não-vazio, `!erroCampo` nos numéricos, `preco > 0`, `estoqueInicial` inteiro > 0, `foto != null` (critérios 3 e parte do 1). Mensagens de erro por campo no padrão blur/tentouSalvar do cadastro.
- Submit: `chave` = `useState(() => crypto.randomUUID())`, regenerada só ao FECHAR o dialog (retry de falha ambígua reusa — padrão do cadastro, versão simplificada: sem estado `resultadoAmbiguo`, a idempotência da edge devolve `jaExistia`). Fluxo: `canWrite()` guard → `owner = storageOwnerForUpload(userId, orgId, scope)` → para cada linha `uploadFile('imagens', buildStoragePath(owner, chave, `${codigo}-${foto.name}`), foto)` → `supabase.functions.invoke('adicionar-variacoes-familia', { body })`.
- Sucesso: toast `✓ Variações enviadas — atualizando o anúncio`; se `publicacaoOk === false` toast de aviso "Gravado, mas a publicação não foi disparada — conclua pela tela Lotes."; se `falhasEstoque.length` avisar como no cadastro; invalidar `QK.familiasNaoPublicadas` + `QK.produtosEstoqueResumo`; fechar.
- 409 → toast com a mensagem da edge (inclui SKUs em conflito).

**Card e página:**
- `produto-card.tsx`: o bloco do DropdownMenu passa a renderizar quando `onExcluir || onAdicionarVariacao`; item novo (antes do Excluir): ícone `Plus`, texto "Adicionar variação", `disabled={produto.mlItemId == null}` com hint "Disponível após publicar no ML." (mesmo padrão do hint do Excluir). Badge: quando `statusUpdate` presente, sob o código na célula de identidade: `Atualizando…` (`text-xs text-amber-600 dark:text-amber-500`) ou `Erro na última atualização` (`text-xs text-destructive`).
- `Estoque.tsx`: `const { data: famRows } = useQuery({ queryKey: QK.familiasNaoPublicadas, queryFn: fetchFamiliasNaoPublicadas, enabled: !!modulos?.includes('estoque'), refetchInterval: 15_000 })`; `const statusMap = useMemo(() => statusUpdatePorProduto(famRows ?? []), [famRows])`; estado `produtoAddVariacao`; `onAdicionarVariacao={isAdmin ? setProdutoAddVariacao : undefined}` (critério 6, lado UI); `statusUpdate={statusMap.get(p.codigoPai)}`; render do dialog.

- [ ] **Step 1: Testes que falham** (padrões de `__tests__` existentes na pasta — mocks de supabase e react-query como os vizinhos fazem):

```
dialog-adicionar-variacao.test.tsx
- 'botão travado sem foto em alguma linha' (critério 3)
- 'botão travado com código duplicado entre linhas / código inválido'
- 'estoque inicial 0 trava e mostra erro'
- 'família em voo mostra banner e trava submit' (critério 5)
- 'submit sobe fotos e chama a edge com payload correto' (mock uploadFile + functions.invoke; verificar codigo, nome, imagemPath, estoqueInicial no body)
produto-card (novo ou existente)
- 'item Adicionar variação só aparece com onAdicionarVariacao definido' (critério 6)
- 'item desabilitado quando mlItemId é null'
- 'badge Atualizando… aparece com statusUpdate=atualizando' (critério 9, lado card)
```

Rodar: `pnpm test src/components/estoque` → FAIL.

- [ ] **Step 2: Implementar** (`linha-variacao-form` prop, dialog, card, página). Rodar de novo → PASS. Rodar a suite inteira `pnpm test` (Estoque.test.tsx e amigos não podem quebrar).

- [ ] **Step 3: `pnpm lint` + `npx tsc -b --force`** (o CI roda `tsc -b` limpo — build incremental local mente).

- [ ] **Step 4: Commit**

```bash
git add src/components/estoque/ src/pages/Estoque.tsx src/lib/
git commit -m "feat(adr-0128): dialog Adicionar variacao na tela Estoque (admin-only) + badge de status"
```

---

### Task 7: Documentação + verificação final

**Files:**
- Modify: `docs/reference/edge-functions.md` (entrada nova: `adicionar-variacoes-familia` — contrato, gates, encadeamento com publicar-familias; nota na entrada de `update-familia-ml` sobre a notificação gated)
- Modify: `docs/reference/modelo-de-dados.md` (nota no guard `validar_variacao_no_tenant`: estoque via ledger só p/ `operacao='CREATE'`)
- Modify: `docs/decisions/0128-adicionar-variacao-a-familia-publicada.md` (seção "Implementação prevista" → curto adendo "Implementação (2026-08-20)" registrando os desvios 1-5 do plano, com uma linha de racional cada; NÃO reabrir decisões)
- Modify: `docs/TASKS.md` (registrar a entrega)

- [ ] **Step 1: Escrever as quatro atualizações** (fatos, sem prosa: contrato da edge, gates, fluxo, desvios).
- [ ] **Step 2: Verificação final**: `pnpm lint && pnpm test && npx tsc -b --force && (cd supabase/functions && deno lint && deno check adicionar-variacoes-familia/index.ts update-familia-ml/index.ts cadastrar-produto/index.ts && deno test)` → tudo verde.
- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs(adr-0128): edge-functions, modelo-de-dados, adendo de implementacao e TASKS"
```

---

## Mapa critérios de aceite (ADR-0128 §Validação) → onde é coberto

| Critério | Cobertura |
|---|---|
| 1. Cor nova publicável (Legacy) | Task 3 (montarVariacaoNova excluida=false; encadeia publicar-familias); validação E2E real fica para pós-merge/deploy |
| 2. N cores → 1 lote | Task 3 passo 11-13 (um lote, um insert de família, N novas) |
| 3. Sem foto → não salva | Task 6 testes (podeSalvar) + Task 3 validarEntrada |
| 4. CODIGO duplicado → 409 | Task 3 (codigosJaUsados + duplicado in-payload) |
| 5. Lote em voo → bloqueio | Task 3 passo 8 + Task 6 banner |
| 6. Não-admin → sem menu + edge recusa | Task 6 (prop condicionada a isAdmin) + Task 3 passo 2 |
| 7. User Products migrada | Herdado do worker (nada a fazer — clone preserva ml_item_id/ml_variation_id) |
| 8. Não aparece na Revisão | Task 3 passo 11 (lote nasce `publicando`; `revisao` só como rota de recuperação em falha do encadeamento) |
| 9. Sino + status no card | Task 4 (sino) + Tasks 5/6 (badge) |
| 10. lint/test + blast radius | Task 7; blast radius: `_shared/produto/codigos.ts` → redeploy `cadastrar-produto` + `adicionar-variacoes-familia`; e `update-familia-ml` (pós-merge, não neste worktree) |
