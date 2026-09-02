# Kit vinculado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o operador crie, a partir de um produto existente, anúncios "Kit com N unidades" (N de 2 a 6) publicados no ML como `SALE_FORMAT=Kit`, cujo estoque é sempre `floor(estoque_base / N)` calculado ao vivo a partir do produto-base, e cuja venda debita `N ×` no ledger da base.

**Architecture:** Uma família nova por tamanho de kit (`codigo_pai` próprio gerado por `proximo_codigo_produto()`), vinculada à base por `familias.kit_base_codigo_pai` + `familias.kit_multiplicador`. Nenhum saldo próprio: um resolvedor único (`resolverOrigemEstoque`) redireciona baixa, estorno, publicação e push para o `(org_id, codigo)` da base, com multiplicador. O `variacoes.estoque` do kit fica permanentemente em 0 e é excluído de todo "estoque canônico". Guards no banco impedem que qualquer caminho crie um segundo número dessincronizado (mesma classe do incidente ADR-0129).

**Tech Stack:** Supabase (Postgres + migrations SQL + Edge Functions em Deno/TypeScript), QStash (fila serial `estoque-{orgId}`), React + TypeScript + TanStack Query + shadcn/ui no frontend (`src/`), Vitest (`src/**/__tests__/` e `tests/`), Deno test (`supabase/functions/**/__tests__/`).

**Spec:** `docs/decisions/0151-kit-vinculado-a-partir-de-produto-existente.md` (16 decisões numeradas + Consequências). Leia o ADR inteiro antes da Task 1. Ele é a fonte única do "o quê"; este plano é o "como".

---

## Global Constraints

Valores exatos, copiados do ADR-0151 e do código real. Valem para **todas** as tasks.

- **N (`kit_multiplicador`)**: inteiro de **2 a 6**, inclusive. `smallint`, `check (kit_multiplicador between 2 and 6)`.
- **Saldo do kit**: `floor(estoque_base / N)`, sempre calculado ao vivo. **Nunca** persistido em `variacoes.estoque` do kit, que fica sempre em `0`.
- **Chave de vínculo**: `(org_id, kit_base_codigo_pai)` — **nunca** `familias.id`. A base ganha linhas novas de `familias` a cada lote de UPDATE; só `codigo_pai` é estável.
- **Predicado "esta família é um kit vinculado"**: `familias.kit_multiplicador is not null`. Use exatamente este predicado em todo lugar.
- **Âncora de família canônica**: `order by f.criado_em desc limit 1` sobre `variacoes v join familias f on f.id = v.familia_id where v.org_id = $1 and v.codigo = $2`. É a âncora que `baixar_estoque`, `registrar_entrada` e `ajustar_estoque` já usam (migration `20260729084329`). O resolvedor novo **tem de usar a mesma**, senão o saldo diverge entre resolvedor e ledger.
- **Módulo obrigatório**: `'estoque'` em `organizations.modulos_habilitados`. Gate por `exigirModulo(admin, orgId, 'estoque')` (`supabase/functions/_shared/produto/modulo.ts:8`), aplicado **na edge**, não só na UI (ADR-0047).
- **Códigos**: `codigo_pai` e `codigo` do kit são gerados por `proximo_codigo_produto(p_org, p_qtd, p_resync default false)` + `derivarCodigos(ultimoDaFaixa, qtd)` (`_shared/produto/codigos.ts`). Formato obrigatório: **8 dígitos** (`^[0-9]{8}$`) — imposto pelo trigger `validar_familia_no_tenant` / `validar_variacao_no_tenant`.
- **`chave_cadastro` obrigatória**: toda família em lote `origem='manual'` exige `familias.chave_cadastro` não-nula (trigger `validar_familia_no_tenant`, migration `20260804113000`). É também a idempotência por submissão (unique parcial `familias_org_chave_cadastro_key`).
- **Título**: `TITULO_MAX = 60` (`supabase/functions/_shared/ai/titulo-montar.ts:4`). O título do kit **tem de** respeitar 60 caracteres.
- **GTIN**: kit publica **sem GTIN** por padrão. **Nunca** herda o GTIN da base.
- **Escopo v1**: só família-base com **exatamente 1 variação** (sem cor).
- **`create or replace function` preserva owner e ACL** enquanto a assinatura não muda. Só mude assinatura se for inevitável — mudar exige repetir a dança `grant estoque_rpc_executor to postgres` → `grant usage, create on schema public` → `alter function ... owner to estoque_rpc_executor` → `revoke create` → `revoke ... cascade` → `revoke execute from public, anon, authenticated` → `grant execute to service_role`. Neste plano **nenhuma assinatura de RPC muda**.
- **Push de estoque com kit: sem exclusão nenhuma** (Decisão 7, revisada). Quando o produto do evento tem kit vinculado, `resolverAlvosPush` recebe `canalOrigem = null` e base + todos os tamanhos recebem o push, **inclusive o anúncio que originou o evento**. Push é absoluto e recalculado do zero, então reempurrar é inofensivo. Não existe coluna, campo de job nem lógica de "anúncio de origem" em lugar nenhum deste plano — foi deliberadamente descartado pelo Diego por ser código a mais para um resultado idêntico. Produto **sem** kit mantém a exclusão por canal de hoje, intocada.
- **Enums (verificados em `src/lib/database.types.ts:2479-2493`)**: `familia_status` = `pendente|processando|pronto|publicando|publicado|erro`; `lote_status` = `importando|processando|revisao|publicando|concluido|erro`; `operacao_ml` = `CREATE|UPDATE`. Um rótulo digitado errado num `in (...)` **não dá erro** — só faz a lista nunca casar e a guard virar um no-op que passa em todo teste que não exercite um status real.
- **Migrations**: só via `supabase migration new` + `supabase db push` (ADR-0043). Validar com `npm run db:check`. Nunca `apply_migration`/painel.
- **`supabase db push` não roda em transação** — cada statement é independente.
- **Deploy de Edge Functions não sai no merge.** Mudança em `_shared/**` obriga redeploy de **todas** as funções afetadas (Task 11).

### Riscos aceitos pelo ADR — não resolver neste plano

Estão aqui para não serem "consertados" por engano por um executor:

1. **Oversell intra-canal** (Decisão 6): o saldo é recalculado *depois* da venda, não reservado antes. Base e kits podem vender além do saldo físico na janela venda→webhook→baixa→push. **Nenhuma reserva/trava prévia é implementada.** Mitigação única: o alerta da Task 10.
2. **Pausa silenciosa do ML por falta de catálogo** (Decisão 5): sem GTIN, o kit é sempre divergente no catálogo. Em categorias onde o ML exige vínculo de catálogo, o ML pode pausar o anúncio sem aviso nosso. **Não coberto na v1.**
3. **Buraco na sequência de `proximo_codigo_produto`** (ADR-0096): kit que falha depois de reservar a faixa queima números. Esperado, não defeito.

### Fatos verificados do código (não re-investigar)

- `_shared/estoque/alvos.ts:57-58`: quando `variacoes_externas` é vazio/null, `resolverAlvosPush` faz fallback para **todos** os SKUs do mapa. Por isso a Task 3 chama `resolverAlvosPush` **uma vez por família**, com o mapa só daquela família — nunca um mapa único contendo base + kits.
- `_shared/ml/atualizar.ts` **não** lê `v.estoque`: `montarVariacoesUpdate` recebe `desejados: EstoqueDesejado[]`. Quem lê a coluna no UPDATE é `update-familia-ml/processar.ts:146`. No CREATE, quem lê é `_shared/ml/publicar.ts:184` e `:196` (`available_quantity: v.estoque`), alimentado por `_shared/anuncios/montar-canonico.ts:128-131`.
- `estornar_estoque` resolve a variação pelo `codigo` **do movimento de venda** (`v_codigo`), não pelo `p_codigo` recebido. Por isso o estorno funciona sem nenhuma mudança na RPC.
- O trigger `validar_variacao_no_tenant` (migration `20260820143736`) **já força** `estoque = 0` no INSERT de variação de lote manual com `operacao = 'CREATE'`. A Decisão 8 ("`variacoes.estoque` do kit nasce em 0") não precisa de código novo.
- `reconciliar-estoque/index.ts:89-98` enfileira por `codigo_pai` com movimento recente e `canal_origem: null`. Movimento de kit é gravado no `codigo_pai` **da base**. Com o fan-out da Task 3 dentro de `processarSincronizacao`, a reconciliação já alcança base + kits. **`reconciliar-estoque` não muda em nada** (Decisão 13, terceiro bullet) — não "conserte".
- `forcarSaleFormatKit` (`_shared/categoria/atributos.ts:253`) **não é exportada** hoje.
- **O outbox do ledger não é tocado por esta feature.** `MovimentoPendente`, `lerPushPendente` e `despacharPushPendente` (`_shared/estoque/baixa.ts:216-331`) ficam como estão, e `SincronizarEstoqueJob` (`_shared/queue.ts:189`) não ganha campo nenhum. Uma versão anterior deste plano plumbava um `item_externo_id` por todo esse caminho para sustentar a exclusão fina do push; a Decisão 7 revisada eliminou a necessidade. Se você se pegar acrescentando um campo ali, parou de seguir o plano.

---

## File Structure

**Migrations novas (3):**
- `supabase/migrations/<ts>_kit_vinculado_schema.sql` (Task 1) — colunas de vínculo em `familias`, colunas de auditoria em `estoque_movimentos`, índices.
- `supabase/migrations/<ts>_kit_vinculado_guards.sql` (Task 5) — guards de escrita direta, de adicionar-cor e de remoção.
- `supabase/migrations/<ts>_estoque_rpc_exclui_kit.sql` (Task 9) — as três RPCs de leitura da tela Estoque deixam de listar kit como produto/SKU próprio.

**Backend novo:**
- `supabase/functions/_shared/estoque/kit.ts` — resolvedor único + derivação de saldo. Módulo pequeno e puro-quando-possível; é a peça que todo o resto consome.
- `supabase/functions/_shared/estoque/__tests__/kit.test.ts` — testes do resolvedor.
- `supabase/functions/criar-kit-vinculado/index.ts` — edge de criação (HTTP, auth, gates).
- `supabase/functions/criar-kit-vinculado/processar.ts` — miolo testável (clone, derivação, inserts).
- `supabase/functions/criar-kit-vinculado/__tests__/processar.test.ts`.

**Backend modificado:**
- `_shared/estoque/baixa.ts` — resolve kit antes da RPC; anota o movimento.
- `_shared/categoria/atributos.ts` — exporta `forcarSaleFormatKit` + `aplicarKitNosAtributos`.
- `sincronizar-estoque/processar.ts` — fan-out por família.
- `publish-familia-ml/processar.ts` — saldo derivado no CREATE + encadeamento dos kits pendentes.
- `update-familia-ml/processar.ts` — saldo derivado no UPDATE.
- `vincular-catalogo/` — exclui kit do alerta no-match.
- `remover-publicado/processar.ts` — guard de base com kit vivo.

**Frontend novo:**
- `src/components/kit/dialog-criar-kit.tsx` — diálogo de seleção de tamanhos + preview editável por kit.
- `src/components/kit/preview-kit.tsx` — um bloco de preview (título/descrição/foto/dimensões/preço/atacado/GTIN).
- `src/lib/kit.ts` — chamada da edge + derivações puras (custo, peso, preço sugerido, título).
- `src/lib/__tests__/kit.test.ts`.

**Frontend modificado:**
- `src/pages/Revisao.tsx` + `src/components/familia-expanded.tsx` — gatilho pré-publicação.
- `src/pages/Publicados.tsx` — gatilho pós-publicação.
- `src/pages/Estoque.tsx` + `src/components/estoque/produto-card.tsx` — kits sob o produto-base.
- `src/lib/queries.ts` — query key nova.

**Docs:**
- `docs/reference/modelo-de-dados.md`, `docs/reference/edge-functions.md`, `docs/TASKS.md`, `obsidian-vault/`.
  (`docs/reference/glossario.md` **já** tem "Kit" e "Kit vinculado" — Decisão 16 está feita, conferir e não duplicar.)

---

## Sequenciamento da publicação (Decisão 2) — desenho travado

O ADR exige: na Revisão, o CREATE dos kits só é enfileirado **depois** que o CREATE da base confirma (`status='publicado'` + `ml_item_id`). Se a base falhar, nenhum kit publica.

Mecanismo escolhido (durável, sem polling no browser):

1. A edge `criar-kit-vinculado` **sempre** cria as famílias de kit na hora, em **lote dedicado** (`origem='manual'`), com `status='pronto'`, `operacao='CREATE'`, `ml_item_id null`.
2. Se a base **já tem** `ml_item_id` (caminho Publicados) → a edge encadeia `publicar-familias` imediatamente (padrão `encadearPublicacao` de `adicionar-variacoes-familia/index.ts:35-48`).
3. Se a base **não tem** `ml_item_id` (caminho Revisão) → a edge **não** encadeia nada. Quem enfileira é `publish-familia-ml/processar.ts`, no fim de um CREATE bem-sucedido: ele procura famílias de kit `pronto`/`ml_item_id null` cujo `kit_base_codigo_pai` é o `codigo_pai` que acabou de publicar, e as enfileira com `enfileirarPublicacoes` (`_shared/queue.ts:126`) — o worker não precisa de JWT.
4. Base falhou → os kits ficam `pronto`, sem publicar. O operador corrige e reenvia o lote da base; no sucesso, o passo 3 dispara.

Lote dedicado (e não o lote manual aberto) pelo mesmo motivo do desvio 2 do ADR-0129, e porque assim os kits **não aparecem como card na Revisão da base** (Decisão 4: "sem card por kit").

---

## Task 1: Schema do vínculo + resolvedor de origem de estoque

**Files:**
- Create: `supabase/migrations/<timestamp>_kit_vinculado_schema.sql`
- Create: `supabase/functions/_shared/estoque/kit.ts`
- Create: `supabase/functions/_shared/estoque/__tests__/kit.test.ts`
- Modify: `src/lib/database.types.ts` (regenerado, não editado à mão)

**Interfaces:**
- Consumes: nada (primeira task).
- Produces:
  - `familias.kit_base_codigo_pai text` (nullable), `familias.kit_multiplicador smallint` (nullable, check 2–6).
  - `estoque_movimentos.origem_kit_codigo_pai text` (nullable), `estoque_movimentos.origem_kit_multiplicador smallint` (nullable).
  - `export interface OrigemEstoque { codigoCanonico: string; multiplicador: number; kitCodigoPai: string | null }`
  - `export async function resolverOrigemEstoque(admin: SupabaseClient, orgId: string, codigo: string): Promise<OrigemEstoque>`
  - `export function saldoDoKit(estoqueBase: number, multiplicador: number): number`
  - `export interface FamiliaKit { id: string; codigo_pai: string; kit_multiplicador: number }`
  - `export async function listarKitsVivos(admin: SupabaseClient, orgId: string, codigoPaiBase: string): Promise<FamiliaKit[]>`

- [ ] **Step 1: Criar a migration de schema**

Gere o arquivo com o CLI (nunca escreva o timestamp à mão):

```bash
cd "<repo>" && supabase migration new kit_vinculado_schema
```

Conteúdo do arquivo criado:

```sql
-- ADR-0151: Kit vinculado — família derivada de um produto existente, publicada como
-- SALE_FORMAT=Kit, com estoque 100% calculado a partir da família-base.
--
-- A chave de referência é (org_id, kit_base_codigo_pai), NUNCA familias.id: a base ganha
-- linhas novas de `familias` a cada lote de UPDATE, e só `codigo_pai` é estável.
-- `kit_multiplicador is not null` é o predicado "esta família é um kit vinculado".

alter table public.familias
  add column kit_base_codigo_pai text,
  add column kit_multiplicador smallint;

alter table public.familias
  add constraint familias_kit_multiplicador_faixa
    check (kit_multiplicador is null or kit_multiplicador between 2 and 6);

-- As duas colunas andam juntas: uma sem a outra é estado impossível (kit sem base, ou
-- base sem multiplicador) que o resolvedor de estoque interpretaria errado em silêncio.
alter table public.familias
  add constraint familias_kit_par_completo
    check (num_nulls(kit_base_codigo_pai, kit_multiplicador) in (0, 2));

-- Fan-out do push e as guards varrem "kits vivos desta base" a cada evento de estoque.
create index familias_kit_base_idx
  on public.familias (org_id, kit_base_codigo_pai)
  where kit_multiplicador is not null;

-- Auditoria de origem no ledger (ADR-0151 Decisão 6). NÃO é um motivo novo: um motivo
-- novo quebraria `estornar_estoque`, que só repõe `where motivo = 'venda'`. São colunas
-- nuláveis, preenchidas depois da RPC pelo chamador.
alter table public.estoque_movimentos
  add column origem_kit_codigo_pai text,
  add column origem_kit_multiplicador smallint;

-- NÃO existe coluna de "anúncio de origem" aqui, de propósito. A Decisão 7 foi revisada
-- (simplificação escolhida pelo Diego): com kit vinculado, o push simplesmente NÃO aplica
-- exclusão nenhuma — reempurra base + todos os tamanhos, sempre. Push é ABSOLUTO e o valor
-- é recalculado do zero, então o resultado é idêntico ao de uma exclusão fina; a diferença
-- é 1-2 chamadas de API a mais por evento, contra o custo de uma coluna no ledger e de
-- plumbing por todo o outbox. Não reintroduza a coluna "por eficiência".
```

- [ ] **Step 2: Aplicar e validar a migration**

```bash
cd "<repo>" && supabase db push && npm run db:check
```

Esperado: `db push` aplica sem erro; `db:check` passa.
Se `db push` reclamar de projeto não linkado, rode `supabase link` antes (worktree novo nunca vem linkado).

- [ ] **Step 3: Regenerar os tipos do banco**

```bash
cd "<repo>" && pnpm db:types
```

(Se o script não existir com esse nome, ache-o em `package.json` — é o que gera `src/lib/database.types.ts`.)
Esperado: `src/lib/database.types.ts` passa a conter `kit_base_codigo_pai`, `kit_multiplicador`, `origem_kit_codigo_pai` e `origem_kit_multiplicador`.

- [ ] **Step 4: Escrever o teste do resolvedor (falhando)**

Crie `supabase/functions/_shared/estoque/__tests__/kit.test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert';
import { resolverOrigemEstoque, saldoDoKit } from '../kit.ts';

/** Stub mínimo do supabase-js: só o encadeamento que `resolverOrigemEstoque` usa. */
function fakeAdmin(linhas: Array<{ codigo_pai: string; kit_base_codigo_pai: string | null; kit_multiplicador: number | null }>) {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: () => Promise.resolve({ data: linhas[0] ?? null, error: null }),
  };
  // deno-lint-ignore no-explicit-any
  return { from: () => q } as any;
}

Deno.test('saldoDoKit arredonda para baixo', () => {
  assertEquals(saldoDoKit(7, 2), 3);
  assertEquals(saldoDoKit(1, 2), 0);
  assertEquals(saldoDoKit(0, 6), 0);
  assertEquals(saldoDoKit(12, 6), 2);
});

Deno.test('saldoDoKit nunca devolve negativo', () => {
  assertEquals(saldoDoKit(-5, 2), 0);
});

Deno.test('resolverOrigemEstoque: SKU comum devolve ele mesmo, multiplicador 1', async () => {
  const admin = fakeAdmin([{ codigo_pai: '00000010', kit_base_codigo_pai: null, kit_multiplicador: null }]);
  const r = await resolverOrigemEstoque(admin, 'org-1', '00000011');
  assertEquals(r, { codigoCanonico: '00000011', multiplicador: 1, kitCodigoPai: null });
});

Deno.test('resolverOrigemEstoque: SKU de kit devolve o codigo_pai da base e o multiplicador', async () => {
  const admin = fakeAdmin([{ codigo_pai: '00000020', kit_base_codigo_pai: '00000010', kit_multiplicador: 3 }]);
  const r = await resolverOrigemEstoque(admin, 'org-1', '00000021');
  assertEquals(r, { codigoCanonico: '00000010', multiplicador: 3, kitCodigoPai: '00000020' });
});

Deno.test('resolverOrigemEstoque: SKU inexistente degrada para o próprio código', async () => {
  const admin = fakeAdmin([]);
  const r = await resolverOrigemEstoque(admin, 'org-1', '00009999');
  assertEquals(r, { codigoCanonico: '00009999', multiplicador: 1, kitCodigoPai: null });
});
```

- [ ] **Step 5: Rodar o teste e confirmar que falha**

```bash
cd "<repo>/supabase/functions" && deno test --allow-env --allow-net _shared/estoque/__tests__/kit.test.ts
```

Esperado: FALHA com "Module not found" / `../kit.ts` inexistente.

- [ ] **Step 6: Implementar `_shared/estoque/kit.ts`**

```ts
// ADR-0151: resolvedor ÚNICO de origem de estoque. Todo site que lê ou escreve
// `variacoes.estoque` por `codigo` passa por aqui antes.
//
// O kit NÃO tem saldo próprio: `variacoes.estoque` dele fica em 0 para sempre e o saldo
// real é `floor(estoque_base / N)`, recalculado ao vivo. Sem esta resolução, `baixar_estoque`
// acharia a linha do próprio kit (saldo 0) e aplicaria delta 0 em silêncio — a base nunca
// seria debitada.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface OrigemEstoque {
  /** SKU cujo saldo é a verdade. Para kit, é o `codigo_pai` da base. */
  codigoCanonico: string;
  /** Quantas unidades da base uma unidade de venda deste SKU consome. 1 para SKU comum. */
  multiplicador: number;
  /** `codigo_pai` da família de kit, quando o SKU é de kit. `null` para SKU comum. */
  kitCodigoPai: string | null;
}

/** Saldo virtual do kit. Nunca negativo — o resto do sistema não aguenta negativo (D-8). */
export function saldoDoKit(estoqueBase: number, multiplicador: number): number {
  if (multiplicador <= 0) return 0;
  return Math.max(0, Math.floor(estoqueBase / multiplicador));
}

/**
 * ATENÇÃO — a âncora é a MESMA das RPCs de estoque (`order by f.criado_em desc limit 1`,
 * migration 20260729084329). Usar outra ordenação faria o resolvedor e o ledger discordarem
 * sobre qual família é canônica, e o saldo divergiria sem nenhum erro visível.
 *
 * Falha de leitura degrada para "SKU comum": pior é abortar a baixa de uma venda (a venda é
 * sagrada). O efeito de degradar é a baixa cair no próprio SKU do kit, que tem saldo 0 —
 * visível no ledger como `quantidade = 0`, não como saldo errado na base.
 */
export async function resolverOrigemEstoque(
  admin: SupabaseClient, orgId: string, codigo: string,
): Promise<OrigemEstoque> {
  const neutro: OrigemEstoque = { codigoCanonico: codigo, multiplicador: 1, kitCodigoPai: null };
  const { data, error } = await admin
    .from('variacoes')
    .select('familias!inner(codigo_pai, kit_base_codigo_pai, kit_multiplicador, criado_em)')
    .eq('org_id', orgId).eq('codigo', codigo)
    .order('criado_em', { referencedTable: 'familias', ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('resolver_origem_estoque_falhou', { orgId, codigo, erro: error.message });
    return neutro;
  }
  // deno-lint-ignore no-explicit-any
  const f = (data as any)?.familias;
  const fam = Array.isArray(f) ? f[0] : f;
  if (!fam || fam.kit_multiplicador == null || !fam.kit_base_codigo_pai) return neutro;
  return {
    codigoCanonico: fam.kit_base_codigo_pai as string,
    multiplicador: Number(fam.kit_multiplicador),
    kitCodigoPai: fam.codigo_pai as string,
  };
}

export interface FamiliaKit {
  id: string;
  codigo_pai: string;
  kit_multiplicador: number;
}

/**
 * Famílias de kit vinculadas a uma base — canônica por `codigo_pai` (a mais recente de cada),
 * do jeito que o resto do sistema já resolve produto. Usada pelo fan-out do push (Task 3) e
 * pelas guards de remoção/adição de cor.
 */
export async function listarKitsVivos(
  admin: SupabaseClient, orgId: string, codigoPaiBase: string,
): Promise<FamiliaKit[]> {
  const { data, error } = await admin
    .from('familias')
    .select('id, codigo_pai, kit_multiplicador, criado_em')
    .eq('org_id', orgId).eq('kit_base_codigo_pai', codigoPaiBase)
    .not('kit_multiplicador', 'is', null)
    .order('criado_em', { ascending: false });
  if (error) {
    console.error('listar_kits_vivos_falhou', { orgId, codigoPaiBase, erro: error.message });
    return [];
  }
  // Uma linha por `codigo_pai`, a mais recente — mesma regra de canonicidade do resto.
  const porPai = new Map<string, FamiliaKit>();
  for (const r of data ?? []) {
    const pai = r.codigo_pai as string;
    if (porPai.has(pai)) continue;
    porPai.set(pai, {
      id: r.id as string, codigo_pai: pai, kit_multiplicador: Number(r.kit_multiplicador),
    });
  }
  return [...porPai.values()];
}
```

- [ ] **Step 7: Rodar o teste e confirmar que passa**

```bash
cd "<repo>/supabase/functions" && deno test --allow-env --allow-net _shared/estoque/__tests__/kit.test.ts
```

Esperado: PASS, 5 testes.

- [ ] **Step 8: Verificar o resolvedor contra o Postgres real**

Mock não basta em caminho de estoque (incidente 2026-08-21, ADR-0129). Rode este SQL read-only pela Management API contra a base de dev/prod e confirme que a consulta do resolvedor devolve o que o teste presume:

```sql
-- Deve devolver 0 linhas hoje (nenhum kit existe ainda) e NÃO deve dar erro de sintaxe/coluna.
select v.codigo, f.codigo_pai, f.kit_base_codigo_pai, f.kit_multiplicador
from public.variacoes v
join public.familias f on f.id = v.familia_id
where f.kit_multiplicador is not null
order by f.criado_em desc
limit 5;

-- Confirma que os checks pegam valor fora da faixa.
-- Deve FALHAR com familias_kit_multiplicador_faixa:
-- update public.familias set kit_base_codigo_pai='x', kit_multiplicador=9 where false;
```

Esperado: a primeira consulta roda e devolve 0 linhas.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations supabase/functions/_shared/estoque/kit.ts \
        supabase/functions/_shared/estoque/__tests__/kit.test.ts src/lib/database.types.ts
git commit -m "feat(kit): schema do vínculo kit→base e resolvedor de origem de estoque (ADR-0151 D-1)"
```

---

## Task 2: Baixa de venda e estorno pelo ledger da base

**Files:**
- Modify: `supabase/functions/_shared/estoque/baixa.ts`
- Modify: `supabase/functions/_shared/estoque/__tests__/baixa.test.ts` (existente)
- Test: `supabase/functions/_shared/estoque/__tests__/baixa-kit.test.ts` (novo)

**Interfaces:**
- Consumes: `resolverOrigemEstoque`, `OrigemEstoque` de `_shared/estoque/kit.ts` (Task 1); as colunas `origem_kit_codigo_pai` e `origem_kit_multiplicador` (Task 1).
- Produces:
  - `ResultadoBaixaVenda.vendaAcimaSaldo` ganha `kitCodigoPai: string | null` e `multiplicador: number` em cada entrada.
  - **`MovimentoPendente`, `lerPushPendente` e `despacharPushPendente` NÃO mudam** — o outbox continua agrupando por `(codigoPai, canalOrigem, reposicao)`. Não acrescente nada de kit ali (Decisão 7 revisada).

### Contexto obrigatório antes de editar

`refBaixa(canal, orderId, codigo)` continua sendo construída com o **SKU vendido** (o código do kit), e **não** com o da base. Motivo: `estornar_estoque` procura o movimento por `referencia_externa` sozinho e repõe na variação resolvida a partir do `codigo` **gravado no movimento** — não do `p_codigo` que recebe. Se a `ref` mudasse para o código da base, a `ref` da venda e a do estorno divergiriam e o cancelamento nunca acharia a baixa. Com a `ref` no SKU vendido e `p_codigo = base`, o estorno repõe `N ×` na base sem nenhuma mudança na RPC.

A anotação do movimento (`origem_kit_codigo_pai`, `origem_kit_multiplicador`) é um UPDATE **separado e não-atômico** depois da RPC, feito com `service_role` (que já escreve direto em `estoque_movimentos` — ver `registrarVendaSemSku`). Foi escolhido assim para **não** mudar a assinatura de `baixar_estoque` (mudar assinatura obrigaria repetir toda a dança de owner/grants do `estoque_rpc_executor`).

A anotação é **puramente de auditoria** (Decisão 6): serve para o operador entender, no ledger e no alerta da Task 10, que o débito veio da venda de um kit e não de uma venda direta. **Nada de push depende dela.** Se ela falhar, o único efeito é uma linha de ledger sem atribuição de kit e um alerta com o texto genérico — o saldo e a propagação seguem corretos.

- [ ] **Step 1: Escrever os testes falhando**

Crie `supabase/functions/_shared/estoque/__tests__/baixa-kit.test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert';
import { registrarBaixaVenda, refBaixa } from '../baixa.ts';

interface ChamadaRpc { fn: string; args: Record<string, unknown> }

function fakeAdmin(opts: {
  kits: Record<string, { base: string; n: number }>;
  chamadas: ChamadaRpc[];
  updates: Array<Record<string, unknown>>;
}) {
  const variacaoQuery = (codigo: string) => ({
    select: () => variacaoQuery(codigo),
    eq: () => variacaoQuery(codigo),
    order: () => variacaoQuery(codigo),
    limit: () => variacaoQuery(codigo),
    maybeSingle: () => {
      const k = opts.kits[codigo];
      return Promise.resolve({
        data: k
          ? { familias: { codigo_pai: `KIT-${codigo}`, kit_base_codigo_pai: k.base, kit_multiplicador: k.n } }
          : { familias: { codigo_pai: 'PAI-1', kit_base_codigo_pai: null, kit_multiplicador: null } },
        error: null,
      });
    },
  });
  let codigoAtual = '';
  const movimentosQuery = {
    select: () => movimentosQuery,
    eq: () => movimentosQuery,
    is: () => movimentosQuery,
    neq: () => movimentosQuery,
    in: () => Promise.resolve({ data: [], error: null }),
    lt: () => movimentosQuery,
    order: () => movimentosQuery,
    limit: () => Promise.resolve({ data: [], error: null }),
    insert: () => Promise.resolve({ error: null }),
    update: (patch: Record<string, unknown>) => {
      opts.updates.push(patch);
      return { eq: () => Promise.resolve({ error: null }) };
    },
  };
  return {
    from: (tabela: string) => (tabela === 'variacoes' ? variacaoQuery(codigoAtual) : movimentosQuery),
    rpc: (fn: string, args: Record<string, unknown>) => {
      opts.chamadas.push({ fn, args });
      return Promise.resolve({
        data: {
          aplicado: true, motivo: 'venda', movimento_id: 'mov-1', codigo_pai: 'PAI-BASE',
          estoque_anterior: 100, quantidade_pedida: args.p_qtd, quantidade_aplicada: args.p_qtd,
        },
        error: null,
      });
    },
    // helper do próprio fake: o resolvedor consulta `variacoes` pelo código do item
    _setCodigo: (c: string) => { codigoAtual = c; },
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test('venda de kit baixa N× no codigo_pai da BASE, não no SKU do kit', async () => {
  const chamadas: ChamadaRpc[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const admin = fakeAdmin({ kits: { '00000021': { base: '00000010', n: 3 } }, chamadas, updates });

  await registrarBaixaVenda(admin, {
    orgId: 'org-1', canal: 'mercado_livre', orderId: 777,
    itens: [{ codigo: '00000021', quantity: 2, ml_item_id: 'MLB-KIT' }],
  });

  assertEquals(chamadas.length, 1);
  assertEquals(chamadas[0].fn, 'baixar_estoque');
  // Código canônico da base, quantidade multiplicada.
  assertEquals(chamadas[0].args.p_codigo, '00000010');
  assertEquals(chamadas[0].args.p_qtd, 6);
  // A referência continua no SKU VENDIDO — é o que o estorno procura.
  assertEquals(chamadas[0].args.p_ref, refBaixa('mercado_livre', 777, '00000021'));
});

Deno.test('venda de kit anota a origem no movimento (auditoria, D-6)', async () => {
  const chamadas: ChamadaRpc[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const admin = fakeAdmin({ kits: { '00000021': { base: '00000010', n: 3 } }, chamadas, updates });

  await registrarBaixaVenda(admin, {
    orgId: 'org-1', canal: 'mercado_livre', orderId: 777,
    itens: [{ codigo: '00000021', quantity: 1, ml_item_id: 'MLB-KIT' }],
  });

  const anotacao = updates.find((u) => 'origem_kit_multiplicador' in u);
  assertEquals(anotacao?.origem_kit_multiplicador, 3);
  assertEquals(anotacao?.origem_kit_codigo_pai, 'KIT-00000021');
});

Deno.test('venda de SKU comum não resolve nada e não anota origem de kit', async () => {
  const chamadas: ChamadaRpc[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const admin = fakeAdmin({ kits: {}, chamadas, updates });

  await registrarBaixaVenda(admin, {
    orgId: 'org-1', canal: 'mercado_livre', orderId: 888,
    itens: [{ codigo: '00000011', quantity: 4, ml_item_id: 'MLB-BASE' }],
  });

  assertEquals(chamadas[0].args.p_codigo, '00000011');
  assertEquals(chamadas[0].args.p_qtd, 4);
  const anotacao = updates.find((u) => 'origem_kit_multiplicador' in u);
  assertEquals(anotacao?.origem_kit_multiplicador, null);
  assertEquals(anotacao?.origem_kit_codigo_pai, null);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
cd "<repo>/supabase/functions" && deno test --allow-env --allow-net _shared/estoque/__tests__/baixa-kit.test.ts
```

Esperado: FALHA — `p_codigo` vem `00000021` (o SKU do kit) e `p_qtd` vem `2`, e nenhum update de anotação é feito.

- [ ] **Step 3: Implementar a resolução na baixa**

Em `_shared/estoque/baixa.ts`, importe o resolvedor e altere o laço de `registrarBaixaVenda`:

```ts
import { resolverOrigemEstoque } from './kit.ts';
```

Substitua o corpo do `for (const b of baixas)` (hoje em `baixa.ts:105-139`) por:

```ts
  // O SKU vendido pode ser de um kit vinculado (ADR-0151 D-6): nesse caso quem tem saldo é a
  // BASE, e cada unidade de venda consome N unidades dela. Sem esta resolução, `baixar_estoque`
  // acha a linha do próprio kit (saldo 0) e aplica delta 0 em silêncio — a base nunca desce.
  for (const b of baixas) {
    const origem = await resolverOrigemEstoque(admin, p.orgId, b.codigo);
    // A REFERÊNCIA continua no SKU VENDIDO, nunca no da base: `estornar_estoque` procura o
    // movimento só por `referencia_externa` e repõe na variação resolvida a partir do `codigo`
    // GRAVADO no movimento. Trocar a ref faria venda e estorno nunca se encontrarem.
    const ref = refBaixa(p.canal, p.orderId, b.codigo);
    const { data, error } = await admin.rpc('baixar_estoque', {
      p_org: p.orgId,
      p_codigo: origem.codigoCanonico,
      p_qtd: b.quantity * origem.multiplicador,
      p_canal: p.canal,
      p_ref: ref,
    });
    if (error) {
      console.error('baixar_estoque_falhou', { orderId: p.orderId, codigo: b.codigo, erro: error.message });
      falhas.push({ codigo: b.codigo, mensagem: error.message });
      continue;
    }
    const r = data as {
      aplicado: boolean; motivo: string; codigo_pai?: string; movimento_id?: string;
      estoque_anterior?: number; quantidade_pedida?: number; quantidade_aplicada?: number;
    };
    if (!r.aplicado) {
      if (r.motivo === 'sku_nao_encontrado') skuDesconhecido.push({ codigo: b.codigo, quantidade: b.quantity });
      continue;
    }
    await anotarOrigemDoMovimento(admin, r.movimento_id ?? null, {
      kitCodigoPai: origem.kitCodigoPai,
      multiplicador: origem.kitCodigoPai ? origem.multiplicador : null,
    });
    const classe = classificarBaixaSemSaldo(r, b.quantity * origem.multiplicador);
    if (classe === 'desync') {
      desyncMl.push({ codigo: b.codigo, pedido: b.quantity });
    } else if (classe === 'parcial') {
      vendaAcimaSaldo.push({
        codigo: b.codigo,
        pedido: b.quantity * origem.multiplicador,
        anterior: r.estoque_anterior ?? 0,
        aplicado: r.quantidade_aplicada ?? 0,
        kitCodigoPai: origem.kitCodigoPai,
        multiplicador: origem.multiplicador,
      });
    }
  }
```

Adicione a função de anotação no mesmo arquivo:

```ts
/**
 * Anota, DEPOIS da RPC, que o débito veio da venda de um kit vinculado.
 *
 * Não vai por parâmetro da RPC de propósito: mudar a assinatura de `baixar_estoque` obrigaria
 * repetir a dança de owner/grants do `estoque_rpc_executor` (migration 20260804113000) num
 * caminho que já funciona. O preço é que a anotação NÃO é atômica com a baixa.
 *
 * É PURAMENTE auditoria (D-6): o ledger e o alerta de venda-acima-do-saldo passam a dizer
 * "3 kits de 3 = 9 unidades da base" em vez de um 9 sem explicação. Nenhuma decisão de push
 * depende disto — a Decisão 7 foi simplificada justamente para não haver plumbing de kit no
 * outbox. Falhar aqui custa uma linha de ledger sem atribuição, nada mais.
 */
async function anotarOrigemDoMovimento(
  admin: SupabaseClient,
  movimentoId: string | null,
  p: { kitCodigoPai: string | null; multiplicador: number | null },
): Promise<void> {
  if (!movimentoId) return;
  const { error } = await admin.from('estoque_movimentos').update({
    origem_kit_codigo_pai: p.kitCodigoPai,
    origem_kit_multiplicador: p.multiplicador,
  }).eq('id', movimentoId);
  if (error) console.error('anotar_origem_movimento_falhou', { movimentoId, erro: error.message });
}
```

Amplie **só** `ResultadoBaixaVenda`:

```ts
  vendaAcimaSaldo: Array<{
    codigo: string; pedido: number; anterior: number; aplicado: number;
    /** `codigo_pai` do kit quando a venda foi de kit; null em venda direta (ADR-0151). */
    kitCodigoPai: string | null;
    multiplicador: number;
  }>;
```

- [ ] **Step 4: Confirmar que o outbox NÃO precisa mudar**

`MovimentoPendente`, `lerPushPendente` (`baixa.ts:216-238`) e `despacharPushPendente` (`baixa.ts:285-331`) ficam **exatamente como estão**. A versão original deste plano plumbava um `itemExternoId` por todo esse caminho para sustentar a exclusão fina do push; a Decisão 7 revisada eliminou a necessidade — a decisão de exclusão passou a ser tomada dentro do worker (Task 3), a partir de "esta família tem kit vinculado?", sem nenhum dado extra vindo do ledger.

Confirme que nada foi tocado ali:

```bash
cd "<repo>" && git diff --stat supabase/functions/_shared/estoque/baixa.ts
```

Esperado: o diff cobre só `registrarBaixaVenda`, `anotarOrigemDoMovimento` e `ResultadoBaixaVenda`. Se aparecer mudança em `lerPushPendente` ou `despacharPushPendente`, reverta essa parte.

- [ ] **Step 5: Rodar os testes e confirmar que passam**

```bash
cd "<repo>/supabase/functions" && deno test --allow-env --allow-net _shared/estoque/__tests__/
```

Esperado: PASS, incluindo `baixa.test.ts` (existente) **sem nenhuma alteração** — nada do outbox mudou, então nenhum fixture dele precisa de campo novo. Se ele quebrar, você mexeu em algo que não devia (ver Step 4).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/estoque/
git commit -m "feat(kit): baixa de venda e estorno resolvem o ledger da base (ADR-0151 D-6)"
```

---

## Task 3: Push de estoque — fan-out por família, sem exclusão quando há kit

**Files:**
- Modify: `supabase/functions/sincronizar-estoque/processar.ts`
- Test: `supabase/functions/sincronizar-estoque/__tests__/processar-kit.test.ts` (novo)

**Interfaces:**
- Consumes: `listarKitsVivos`, `saldoDoKit` de `_shared/estoque/kit.ts` (Task 1).
- Produces: nenhuma interface nova. **`_shared/queue.ts` não muda** (nenhum campo novo em `SincronizarEstoqueJob`) e **`_shared/estoque/alvos.ts` não muda**.

### Contexto obrigatório antes de editar

Duas regras, e as duas importam.

**(a) Um `resolverAlvosPush` por família, nunca um mapa único.** Não amplie `estoquePorSku` para conter base + kits e chame `resolverAlvosPush` uma vez só. `alvos.ts:57-58` faz fallback para **todos** os SKUs do mapa quando `variacoes_externas` está vazio — e o anúncio de kit é um item plano de 1 SKU. O resultado seria o anúncio do kit recebendo os SKUs da base e dos outros kits, e vice-versa. O desenho correto é uma passada **por família** (base, depois cada kit), cada uma com o mapa de SKUs só daquela família.

**(b) Com kit vinculado, a exclusão por canal de origem simplesmente não se aplica** (Decisão 7, revisada). Hoje `resolverAlvosPush` recebe `canalOrigem` e pula o canal onde a venda ocorreu — uma otimização que evita devolver ao ML o número que ele já sabe. Base e kits dividem o mesmo canal em anúncios diferentes, então essa exclusão pularia todos eles. A decisão do Diego foi **não** tentar identificar o anúncio de origem: quando a família do evento tem vínculo de kit, passa-se `canalOrigem = null` para todo mundo e reempurra-se tudo. Push é **absoluto** e o valor é recalculado do zero, então o resultado final é idêntico ao de uma exclusão fina — custa 1-2 chamadas de API a mais por evento, e economiza uma coluna no ledger mais plumbing por todo o outbox.

Produto **sem** kit continua com o comportamento de hoje, intocado: `canalOrigem = job.canal_origem`.

**Por que o `codigo_pai` do job é sempre o da base:** `baixar_estoque` recebe `p_codigo` já resolvido para a base (Task 2) e grava `codigo_pai` da base no movimento; entrada e ajuste em SKU de kit são recusados no banco (Task 5); o estorno resolve pelo `codigo` gravado no movimento. Nenhum caminho grava o `codigo_pai` de um kit no ledger. Mesmo assim o worker redireciona defensivamente (Step 4): um job com o `codigo_pai` de um kit empurraria a coluna crua `variacoes.estoque = 0` para um anúncio vivo, e zerar um anúncio no ML por engano não é um risco que vale economizar quatro linhas.

- [ ] **Step 1: Escrever o teste falhando**

Crie `supabase/functions/sincronizar-estoque/__tests__/processar-kit.test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert';
import { processarSincronizacao } from '../processar.ts';

/** Fake do supabase-js cobrindo só as tabelas que `processarSincronizacao` consulta. */
function fakeAdmin(dados: {
  familias: Array<Record<string, unknown>>;
  variacoes: Record<string, Array<Record<string, unknown>>>;
  anuncios: Array<Record<string, unknown>>;
}) {
  function q(tabela: string) {
    const filtros: Record<string, unknown> = {};
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (col: string, val: unknown) => { filtros[col] = val; return api; },
      in: () => api,
      not: () => api,
      order: () => api,
      is: () => api,
      gt: () => api,
      limit: () => api,
      maybeSingle: () => {
        if (tabela === 'familias') {
          const f = dados.familias.find((x) =>
            (!filtros.codigo_pai || x.codigo_pai === filtros.codigo_pai));
          return Promise.resolve({ data: f ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (res: (v: unknown) => unknown) => {
        if (tabela === 'variacoes') {
          return Promise.resolve({ data: dados.variacoes[String(filtros.familia_id)] ?? [], error: null }).then(res);
        }
        if (tabela === 'anuncios_externos') {
          return Promise.resolve({
            data: dados.anuncios.filter((a) => a.codigo_pai === filtros.codigo_pai), error: null,
          }).then(res);
        }
        if (tabela === 'familias') {
          return Promise.resolve({
            data: dados.familias.filter((f) => f.kit_base_codigo_pai === filtros.kit_base_codigo_pai),
            error: null,
          }).then(res);
        }
        return Promise.resolve({ data: [], error: null }).then(res);
      },
      update: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
    };
    return api;
  }
  // deno-lint-ignore no-explicit-any
  return { from: (t: string) => q(t) } as any;
}

const DADOS = {
  familias: [
    { id: 'f-base', codigo_pai: '00000010', nome_pai: 'Produto', ml_permalink: null, criado_em: '2026-09-01', kit_base_codigo_pai: null, kit_multiplicador: null },
    { id: 'f-kit3', codigo_pai: '00000020', nome_pai: 'Kit 3', ml_permalink: null, criado_em: '2026-09-02', kit_base_codigo_pai: '00000010', kit_multiplicador: 3 },
  ],
  variacoes: {
    'f-base': [{ codigo: '00000011', estoque: 7, nome: 'Produto', cor: null }],
    'f-kit3': [{ codigo: '00000021', estoque: 0, nome: 'Kit 3', cor: null }],
  },
  anuncios: [
    { id: 'a-base', canal: 'mercado_livre', codigo_pai: '00000010', item_externo_id: 'MLB-BASE', variacoes_externas: null, status: 'publicado' },
    { id: 'a-kit3', canal: 'mercado_livre', codigo_pai: '00000020', item_externo_id: 'MLB-KIT3', variacoes_externas: null, status: 'publicado' },
  ],
};

function depsQueRegistram(chamadas: Array<{ item: string; estoques: unknown }>) {
  return {
    admin: fakeAdmin(DADOS),
    resolverConexao: () => Promise.resolve({ id: 'c1' }),
    getConnector: () => ({
      capabilities: { atualizarEstoque: true },
      atualizarEstoque: (_ctx: unknown, item: string, estoques: unknown) => {
        chamadas.push({ item, estoques });
        return Promise.resolve({ ok: true });
      },
      lerStatus: () => Promise.resolve({}),
      atualizarStatus: () => Promise.resolve({ ok: true }),
    }),
    fabricarToken: () => () => Promise.resolve('tok'),
    notificar: () => Promise.resolve(),
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test('push da base alcança o anúncio do kit com floor(base/N)', async () => {
  const chamadas: Array<{ item: string; estoques: unknown }> = [];
  await processarSincronizacao(depsQueRegistram(chamadas), {
    org_id: 'org-1', codigo_pai: '00000010', canal_origem: null,
  });
  assertEquals(chamadas.length, 2);
  assertEquals(chamadas.find((c) => c.item === 'MLB-BASE')?.estoques, [{ sku: '00000011', estoque: 7 }]);
  // 7 unidades da base = 2 kits de 3.
  assertEquals(chamadas.find((c) => c.item === 'MLB-KIT3')?.estoques, [{ sku: '00000021', estoque: 2 }]);
});

Deno.test('com kit vinculado, venda no canal NÃO exclui nada — base e kit recebem push', async () => {
  // ADR-0151 D-7 (revisada): a exclusão por canal de origem deixa de valer quando há kit.
  // Push absoluto + recálculo do zero = mesmo resultado da exclusão fina, sem coluna nova.
  const chamadas: Array<{ item: string; estoques: unknown }> = [];
  await processarSincronizacao(depsQueRegistram(chamadas), {
    org_id: 'org-1', codigo_pai: '00000010', canal_origem: 'mercado_livre',
  });
  assertEquals(chamadas.map((c) => c.item).sort(), ['MLB-BASE', 'MLB-KIT3']);
});

Deno.test('produto SEM kit mantém a exclusão por canal de hoje', async () => {
  const chamadas: Array<{ item: string; estoques: unknown }> = [];
  const semKit = {
    familias: [DADOS.familias[0]],
    variacoes: { 'f-base': DADOS.variacoes['f-base'] },
    anuncios: [DADOS.anuncios[0]],
  };
  await processarSincronizacao(depsQueRegistram(chamadas, semKit), {
    org_id: 'org-1', codigo_pai: '00000010', canal_origem: 'mercado_livre',
  });
  // O canal da venda já se decrementou sozinho: nada é empurrado de volta.
  assertEquals(chamadas.length, 0);
});

Deno.test('job com o codigo_pai de um KIT é redirecionado para a base', async () => {
  // Nenhum caminho grava o codigo_pai de um kit no ledger, mas se acontecesse, empurrar
  // a coluna crua (`estoque` = 0) zeraria um anúncio vivo no ML.
  const chamadas: Array<{ item: string; estoques: unknown }> = [];
  await processarSincronizacao(depsQueRegistram(chamadas), {
    org_id: 'org-1', codigo_pai: '00000020', canal_origem: null,
  });
  assertEquals(chamadas.map((c) => c.item).sort(), ['MLB-BASE', 'MLB-KIT3']);
  assertEquals(chamadas.find((c) => c.item === 'MLB-KIT3')?.estoques, [{ sku: '00000021', estoque: 2 }]);
});
```

Ajuste `depsQueRegistram(chamadas, dados = DADOS)` para aceitar o conjunto de dados como segundo parâmetro.

- [ ] **Step 2: Rodar e confirmar falha**

```bash
cd "<repo>/supabase/functions" && deno test --allow-env --allow-net sincronizar-estoque/__tests__/processar-kit.test.ts
```

Esperado: FALHA — hoje só o anúncio da base é alcançado, e a exclusão por canal pularia os dois.

- [ ] **Step 3: Estender o tipo do job**

`supabase/functions/_shared/queue.ts` **não muda**. `SincronizarEstoqueJob` continua com `{ org_id, codigo_pai, canal_origem, reativar? }` exatamente como está hoje (linha ~189). A Decisão 7 revisada não precisa de nenhum dado novo no job: a decisão "excluir ou não o canal de origem" é tomada dentro do worker, a partir de `listarKitsVivos`.

Confirme antes de seguir:

```bash
cd "<repo>" && git diff --stat supabase/functions/_shared/queue.ts
```

Esperado: vazio.

- [ ] **Step 4: Reescrever a montagem de alvos em `sincronizar-estoque/processar.ts`**

Importe:

```ts
import { listarKitsVivos, saldoDoKit } from '../_shared/estoque/kit.ts';
```

Extraia a leitura de uma família num helper local, no mesmo arquivo:

```ts
interface FamiliaComSaldo {
  familiaId: string;
  codigoPai: string;
  nome: string | null;
  permalink: string | null;
  estoquePorSku: Record<string, number>;
  rotuloPorSku: Map<string, { nome: string | null; cor: string | null }>;
}

/** Família canônica de um `codigo_pai` + o mapa de saldos das variações dela. */
async function lerFamiliaComSaldo(
  admin: SupabaseClient, orgId: string, codigoPai: string,
): Promise<FamiliaComSaldo | null> {
  const { data: familia } = await admin.from('familias')
    .select('id, nome_pai, ml_permalink').eq('org_id', orgId).eq('codigo_pai', codigoPai)
    .order('criado_em', { ascending: false }).limit(1).maybeSingle();
  if (!familia) return null;

  const { data: variacoes } = await admin.from('variacoes')
    .select('codigo, estoque, nome, cor').eq('familia_id', familia.id);
  const estoquePorSku: Record<string, number> = {};
  const rotuloPorSku = new Map<string, { nome: string | null; cor: string | null }>();
  for (const v of variacoes ?? []) {
    estoquePorSku[v.codigo as string] = (v.estoque as number) ?? 0;
    rotuloPorSku.set(v.codigo as string, {
      nome: (v.nome as string | null) ?? null, cor: (v.cor as string | null) ?? null,
    });
  }
  return {
    familiaId: familia.id as string, codigoPai,
    nome: (familia.nome_pai as string | null) ?? null,
    permalink: (familia.ml_permalink as string | null) ?? null,
    estoquePorSku, rotuloPorSku,
  };
}

/** Alvos de push de UMA família. `resolverAlvosPush` roda com o mapa só dela. */
async function alvosDaFamilia(
  admin: SupabaseClient, orgId: string, codigoPai: string,
  estoquePorSku: Record<string, number>, canalOrigem: string | null,
): Promise<{ alvos: AlvoPush[]; temAnuncio: boolean }> {
  const { data: anuncios } = await admin.from('anuncios_externos')
    .select('id, canal, item_externo_id, variacoes_externas')
    .eq('org_id', orgId).eq('codigo_pai', codigoPai).eq('status', 'publicado');
  const idsAnuncio = (anuncios ?? []).map((a) => a.id as string);
  const { data: itensUP } = idsAnuncio.length > 0
    ? await admin.from('anuncios_externos_itens')
      .select('anuncio_externo_id, sku, item_externo_id, retirado, status')
      .eq('org_id', orgId).in('anuncio_externo_id', idsAnuncio)
    : { data: [] };
  const alvos = resolverAlvosPush(
    (anuncios ?? []) as never, (itensUP ?? []) as never, estoquePorSku, canalOrigem,
  );
  return { alvos, temAnuncio: (anuncios ?? []).length > 0 };
}
```

Substitua os blocos 1 e 2 de `processarSincronizacao` (hoje `processar.ts:146-198`) por:

```ts
  const { org_id, codigo_pai, canal_origem } = job;
  const admin = deps.admin;

  // 1) Base: família canônica + saldo real das variações.
  //
  // Defensivo: se o job veio com o `codigo_pai` de um KIT, redireciona para a base. Nenhum
  // caminho grava o `codigo_pai` de um kit no ledger hoje (a baixa resolve para a base, e
  // entrada/ajuste em SKU de kit são recusados no banco), mas se acontecesse, o kit seria
  // tratado como produto e o push mandaria a coluna crua `estoque = 0` para um anúncio vivo.
  let codigoPaiBase = codigo_pai;
  const { data: familiaDoJob } = await admin.from('familias')
    .select('kit_base_codigo_pai, kit_multiplicador')
    .eq('org_id', org_id).eq('codigo_pai', codigo_pai)
    .order('criado_em', { ascending: false }).limit(1).maybeSingle();
  if (familiaDoJob?.kit_multiplicador != null && familiaDoJob.kit_base_codigo_pai) {
    console.log('estoque_push_job_de_kit_redirecionado', codigo_pai, '->', familiaDoJob.kit_base_codigo_pai);
    codigoPaiBase = familiaDoJob.kit_base_codigo_pai as string;
  }

  const base = await lerFamiliaComSaldo(admin, org_id, codigoPaiBase);
  if (!base) return { status: 200, body: { ok: true, skip: 'produto sem família' } };
  if (Object.keys(base.estoquePorSku).length === 0) {
    return { status: 200, body: { ok: true, skip: 'sem variações' } };
  }

  const kits = await listarKitsVivos(admin, org_id, codigoPaiBase);

  // ADR-0151 D-7 (revisada) — com kit vinculado, a exclusão por canal de origem NÃO se
  // aplica: reempurra base + todos os tamanhos, sempre. Base e kits dividem o mesmo canal em
  // anúncios diferentes, e a exclusão por canal pularia todos eles. Identificar e pular só o
  // anúncio de origem foi DESCARTADO pelo Diego: o push é ABSOLUTO e recalculado do zero,
  // então o resultado final é idêntico — custa 1-2 chamadas de API a mais por evento, e
  // poupa uma coluna no ledger mais plumbing por todo o outbox. Não "otimize" isto de volta.
  //
  // Produto sem kit segue com o comportamento de hoje, intocado.
  const exclusao = kits.length > 0 ? null : canal_origem;

  // 2) Alvos da base + de CADA kit, um `resolverAlvosPush` por família.
  //
  // ATENÇÃO: NÃO junte os SKUs de base e kits num mapa só. Quando `variacoes_externas` é
  // vazio (anúncio de kit é item plano de 1 SKU), `resolverAlvosPush` cai no fallback
  // "manda o produto inteiro" (alvos.ts:57-58) e o anúncio do kit receberia os SKUs da base.
  const { alvos: alvosBase, temAnuncio: baseTemAnuncio } =
    await alvosDaFamilia(admin, org_id, codigoPaiBase, base.estoquePorSku, exclusao);
  const alvos = [...alvosBase];
  let temAnuncio = baseTemAnuncio;

  // O saldo do kit é sempre floor(estoque_base / N), calculado ao vivo (ADR-0151 D-6). A
  // coluna `variacoes.estoque` do kit fica em 0 para sempre e NUNCA é lida aqui.
  //
  // A UMA variação da base — nunca a soma das variações. O ledger (`baixar_estoque`) resolve
  // UMA variação por `(org_id, codigo)` e decrementa AQUELA linha; derivar de uma soma faria
  // o kit e o ledger falarem de números diferentes no dia em que a trava de "só produto sem
  // cor" (D-10) for afrouxada. Com mais de uma variação, falha LOUD em vez de inventar um
  // número plausível.
  const skusBase = Object.keys(base.estoquePorSku);
  const estoqueBaseUnico = skusBase.length === 1 ? base.estoquePorSku[skusBase[0]] : null;

  for (const kit of kits) {
    if (estoqueBaseUnico === null) {
      console.error('kit_com_base_multivariacao', { org_id, codigoPaiBase, skus: skusBase.length });
      continue;   // não empurra saldo inventado para o ML
    }
    const kitComSaldo = await lerFamiliaComSaldo(admin, org_id, kit.codigo_pai);
    if (!kitComSaldo) continue;
    const derivado: Record<string, number> = {};
    for (const sku of Object.keys(kitComSaldo.estoquePorSku)) {
      derivado[sku] = saldoDoKit(estoqueBaseUnico, kit.kit_multiplicador);
    }
    // `exclusao` aqui é sempre null (só chegamos neste laço com kits.length > 0).
    const r = await alvosDaFamilia(admin, org_id, kit.codigo_pai, derivado, exclusao);
    alvos.push(...r.alvos);
    temAnuncio = temAnuncio || r.temAnuncio;
  }
```

Ajuste `ctxAlerta` para usar `codigoPaiBase`, `base.nome`, `base.permalink`, `base.rotuloPorSku`, `base.estoquePorSku` e o `temAnuncio` acumulado. O resto do arquivo (laço de push, reativação, alerta de zerado) **não muda** — em particular, `reativarSePausado` (`processar.ts:58`) não muda: ele já recebe `alvo.itemExternoId`, então a reativação por reposição (ADR-0111) passa a alcançar o anúncio de cada kit automaticamente, com `alvo.estoques.some(e => e.estoque > 0)` avaliado sobre o **saldo derivado** do kit. É a Decisão 15 inteira, sem código novo.

- [ ] **Step 5: Confirmar que nenhum chamador precisa mudar**

Todo mundo continua enfileirando `{ org_id, codigo_pai, canal_origem, reativar? }` como hoje:

```bash
cd "<repo>" && grep -rn "enfileirarSincronizacaoEstoque" supabase/functions/ --include=*.ts | grep -v __tests__
```

Esperado: `entrada-estoque` e `ajustar-estoque` passam `canal_origem: null`; `reconciliar-estoque:92-94` passa `canal_origem: null`; `despacharPushPendente` passa o `push_canal_origem` do movimento. **Nenhum deles muda.** A decisão de ignorar a exclusão é tomada só dentro do worker.

- [ ] **Step 6: Rodar e confirmar que passa**

```bash
cd "<repo>/supabase/functions" && deno test --allow-env --allow-net sincronizar-estoque/__tests__/
```

Esperado: PASS, incluindo os testes já existentes de `processar.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/sincronizar-estoque/
git commit -m "feat(kit): push com fan-out por família, sem exclusão de canal quando há kit (ADR-0151 D-7)"
```

---

## Task 4: Quantidade publicada no ML vem do saldo derivado

**Files:**
- Modify: `supabase/functions/_shared/estoque/kit.ts` (função nova)
- Modify: `supabase/functions/publish-familia-ml/processar.ts` (após carregar variações, ~linha 112)
- Modify: `supabase/functions/update-familia-ml/processar.ts` (após o select de ~linha 146)
- Test: `supabase/functions/_shared/estoque/__tests__/kit.test.ts` (estender)

**Interfaces:**
- Consumes: `resolverOrigemEstoque`, `saldoDoKit` (Task 1).
- Produces:
  - `export async function aplicarEstoqueDerivado<T extends { codigo: string; estoque: number }>(admin: SupabaseClient, orgId: string, familia: { kit_base_codigo_pai: string | null; kit_multiplicador: number | null }, variacoes: T[]): Promise<T[]>`

### Contexto obrigatório antes de editar

O ADR-0151 (Decisão 8) diz que `_shared/ml/atualizar.ts` manda `available_quantity: v.estoque` direto da coluna. **Isso não é exato.** O que o código faz:

- **CREATE**: `publish-familia-ml/processar.ts:112` carrega `variacoes` → `montarAnuncioCanonico` (`_shared/anuncios/montar-canonico.ts:128-131`) copia `estoque: v.estoque` → `_shared/ml/publicar.ts:184` e `:196` fazem `available_quantity: v.estoque`.
- **UPDATE**: `update-familia-ml/processar.ts:146` seleciona `estoque` e monta os `desejados`; `montarVariacoesUpdate` (`_shared/ml/atualizar.ts:100`) só consome esse array.

Em ambos os casos o valor entra pela **coluna `variacoes.estoque` lida no worker**. Por isso a correção mora nos dois workers, logo depois do select — não em `_shared/ml/`. Isso mantém `publicar.ts`/`atualizar.ts` intocados.

- [ ] **Step 1: Estender o teste de `kit.ts` (falhando)**

Acrescente em `supabase/functions/_shared/estoque/__tests__/kit.test.ts`:

```ts
import { aplicarEstoqueDerivado } from '../kit.ts';

function adminComSaldoDaBase(estoqueBase: number) {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: () => Promise.resolve({ data: { id: 'f-base' }, error: null }),
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [{ codigo: '00000011', estoque: estoqueBase }], error: null }).then(res),
  };
  // deno-lint-ignore no-explicit-any
  return { from: () => q } as any;
}

Deno.test('aplicarEstoqueDerivado: família comum passa direto', async () => {
  const vars = [{ codigo: '00000011', estoque: 7 }];
  const r = await aplicarEstoqueDerivado(
    adminComSaldoDaBase(7), 'org-1',
    { kit_base_codigo_pai: null, kit_multiplicador: null }, vars,
  );
  assertEquals(r, [{ codigo: '00000011', estoque: 7 }]);
});

Deno.test('aplicarEstoqueDerivado: kit publica floor(base/N), não a coluna crua', async () => {
  const vars = [{ codigo: '00000021', estoque: 0 }];
  const r = await aplicarEstoqueDerivado(
    adminComSaldoDaBase(7), 'org-1',
    { kit_base_codigo_pai: '00000010', kit_multiplicador: 3 }, vars,
  );
  assertEquals(r, [{ codigo: '00000021', estoque: 2 }]);
});

Deno.test('aplicarEstoqueDerivado: base zerada publica kit com 0', async () => {
  const vars = [{ codigo: '00000021', estoque: 0 }];
  const r = await aplicarEstoqueDerivado(
    adminComSaldoDaBase(0), 'org-1',
    { kit_base_codigo_pai: '00000010', kit_multiplicador: 2 }, vars,
  );
  assertEquals(r, [{ codigo: '00000021', estoque: 0 }]);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
cd "<repo>/supabase/functions" && deno test --allow-env --allow-net _shared/estoque/__tests__/kit.test.ts
```

Esperado: FALHA com "aplicarEstoqueDerivado is not exported".

- [ ] **Step 3: Implementar `aplicarEstoqueDerivado` em `_shared/estoque/kit.ts`**

```ts
/**
 * ADR-0151 D-8 — a quantidade que vai ao ML.
 *
 * `variacoes.estoque` do kit nasce e permanece em 0 (o trigger `validar_variacao_no_tenant`
 * força isso no INSERT de lote manual com operacao='CREATE'). Publicar a coluna crua faria
 * cada kit, sem exceção, nascer com "0 em estoque" no ML. O valor correto é
 * floor(estoque_base / N), calculado no momento do CREATE/UPDATE.
 *
 * Família comum é devolvida sem cópia nem consulta extra — o caminho quente não paga nada.
 */
export async function aplicarEstoqueDerivado<T extends { codigo: string; estoque: number }>(
  admin: SupabaseClient,
  orgId: string,
  familia: { kit_base_codigo_pai: string | null; kit_multiplicador: number | null },
  variacoes: T[],
): Promise<T[]> {
  const n = familia.kit_multiplicador;
  const base = familia.kit_base_codigo_pai;
  if (n == null || !base) return variacoes;

  const { data: famBase } = await admin.from('familias')
    .select('id').eq('org_id', orgId).eq('codigo_pai', base)
    .order('criado_em', { ascending: false }).limit(1).maybeSingle();
  if (!famBase) {
    // Base sumiu — a guard da Task 5 deveria ter impedido. Publicar 0 é o único valor
    // seguro: publicar a coluna crua daria o mesmo 0, e inventar saldo venderia o que
    // não existe. LOUD no log para o operador achar.
    console.error('kit_sem_familia_base', { orgId, base });
    return variacoes.map((v) => ({ ...v, estoque: 0 }));
  }
  const { data: varsBase } = await admin.from('variacoes')
    .select('estoque').eq('familia_id', famBase.id);
  // A UMA variação da base — nunca a soma. `baixar_estoque` decrementa UMA linha resolvida
  // por `(org_id, codigo)`; derivar de uma soma faria o publicado e o ledger falarem de
  // números diferentes no dia em que a trava de "só produto sem cor" (D-10) for afrouxada.
  if ((varsBase ?? []).length !== 1) {
    console.error('kit_com_base_multivariacao', { orgId, base, skus: (varsBase ?? []).length });
    return variacoes.map((v) => ({ ...v, estoque: 0 }));
  }
  const estoqueBase = (varsBase![0].estoque as number) ?? 0;
  const derivado = saldoDoKit(estoqueBase, n);
  return variacoes.map((v) => ({ ...v, estoque: derivado }));
}
```

- [ ] **Step 4: Chamar no worker de CREATE**

Em `supabase/functions/publish-familia-ml/processar.ts`, logo depois do select de variações (~linha 112-115), antes de `montarAnuncioCanonico` (linha 132):

```ts
import { aplicarEstoqueDerivado } from '../_shared/estoque/kit.ts';
```

```ts
  // ADR-0151 D-8: kit vinculado publica floor(estoque_base/N), nunca `variacoes.estoque`
  // (que é 0 por construção). Família comum passa intocada.
  const variacoesParaPublicar = await aplicarEstoqueDerivado(
    admin, familia.org_id as string, familia as never, variacoes,
  );
```

e passe `variacoesParaPublicar` (não `variacoes`) para `montarAnuncioCanonico`.

- [ ] **Step 5: Chamar no worker de UPDATE**

Em `supabase/functions/update-familia-ml/processar.ts`, logo depois do select da linha ~146:

```ts
import { aplicarEstoqueDerivado } from '../_shared/estoque/kit.ts';
```

```ts
  const variacoesVivas = await aplicarEstoqueDerivado(
    admin, familia.org_id as string, familia as never, variacoesDoSelect,
  );
```

Substitua **todos** os usos do array do select por `variacoesVivas` no restante da função. Confira especialmente as linhas ~275 e ~277 (`existentes:` / `novas:`), que alimentam os `desejados` de `montarVariacoesUpdate`.

```bash
cd "<repo>" && grep -n "\.estoque" supabase/functions/update-familia-ml/processar.ts
```

Esperado: nenhuma leitura de `.estoque` sobre o array original do select depois da mudança.

- [ ] **Step 6: Rodar os testes**

```bash
cd "<repo>/supabase/functions" && deno test --allow-env --allow-net _shared/estoque/__tests__/ publish-familia-ml/__tests__/ update-familia-ml/__tests__/
```

Esperado: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/estoque/kit.ts \
        supabase/functions/publish-familia-ml/processar.ts \
        supabase/functions/update-familia-ml/processar.ts \
        supabase/functions/_shared/estoque/__tests__/kit.test.ts
git commit -m "feat(kit): CREATE/UPDATE publicam floor(estoque_base/N), não a coluna crua (ADR-0151 D-8)"
```

---

## Task 5: Guards no banco — escrita direta, cor nova e remoção da base

**Files:**
- Create: `supabase/migrations/<timestamp>_kit_vinculado_guards.sql`
- Modify: `supabase/functions/remover-publicado/processar.ts` (guard de app, além da guard de banco)
- Test: `supabase/functions/remover-publicado/__tests__/processar.test.ts` (estender)

**Interfaces:**
- Consumes: `familias.kit_base_codigo_pai` / `kit_multiplicador` (Task 1); `listarKitsVivos` (Task 1).
- Produces: nenhuma interface TypeScript nova. Três invariantes de banco.

### Contexto obrigatório antes de editar

- `create or replace function` **preserva** owner e ACL enquanto a assinatura não muda. `registrar_entrada` e `ajustar_estoque` pertencem a `estoque_rpc_executor` (migrations `20260804113000` e `20260811201026`) — não repita a dança de owner/grants; ela só é necessária ao mudar assinatura.
- As duas RPCs **já** fazem o join `variacoes v join familias f` para achar a variação canônica. A guard é `f.kit_multiplicador` no mesmo `into` + um `raise` logo depois. Duas linhas em cada.
- A guard de "adicionar cor com kit vivo" é a mais sutil: é um `before insert` em `variacoes`, e só deve disparar quando a família **já tem** variação (não na primeira variação de uma família nova) **e** o `codigo_pai` dela tem kit vivo.
- Esconder na UI **não substitui** a trava (ADR-0047).

- [ ] **Step 1: Criar a migration de guards**

```bash
cd "<repo>" && supabase migration new kit_vinculado_guards
```

Conteúdo:

```sql
-- ADR-0151 D-9, D-10, D-14: três invariantes de banco que impedem o kit vinculado de
-- criar um SEGUNDO número de estoque dessincronizado — a mesma classe de risco do
-- incidente do ADR-0129.
--
-- `create or replace` preserva owner (estoque_rpc_executor) e ACL: a assinatura não muda,
-- então a dança de grants da migration 20260804113000 NÃO se repete aqui.

-- ---------------------------------------------------------------------------
-- D-9: entrada e ajuste recusam SKU de kit vinculado.
--
-- Sem isto, `registrar_entrada`/`ajustar_estoque` criariam um saldo REAL numa linha que o
-- resto do sistema trata como "sempre 0/irrelevante" — um segundo número dessincronizado.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_entrada(
  p_org uuid, p_codigo text, p_qtd integer, p_custo numeric,
  p_doc text, p_obs text, p_criado_por uuid, p_ref text
) returns integer language plpgsql security definer set search_path = ''
as $$
declare v_var uuid; v_pai text; v_antes integer; v_novo integer; v_mov uuid; v_kit smallint;
begin
  if p_qtd is null or p_qtd <= 0 then
    raise exception 'registrar_entrada: quantidade deve ser positiva (recebeu %)', p_qtd;
  end if;
  if p_custo is not null and p_custo <= 0 then
    raise exception 'registrar_entrada: custo deve ser positivo quando informado (recebeu %)', p_custo;
  end if;
  if p_ref is null or btrim(p_ref) = '' then
    raise exception 'registrar_entrada: referência de idempotência é obrigatória';
  end if;

  select v.id, f.codigo_pai, f.kit_multiplicador into v_var, v_pai, v_kit
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo
  order by f.criado_em desc
  limit 1;

  if v_var is null then
    raise exception 'registrar_entrada: SKU % não encontrado na organização', p_codigo;
  end if;

  -- ADR-0151 D-9: kit vinculado não tem saldo próprio. Dar entrada aqui criaria um saldo
  -- real que o push, a publicação e a tela ignoram — dessincronização silenciosa.
  if v_kit is not null then
    raise exception 'registrar_entrada: % é um kit vinculado e não tem estoque próprio. Dê entrada no produto-base.', p_codigo
      using errcode = '23514';
  end if;

  begin
    insert into public.estoque_movimentos
      (org_id, codigo, codigo_pai, quantidade, motivo, custo_unitario, documento,
       observacao, criado_por, referencia_externa, push_canal_origem)
    values (p_org, p_codigo, v_pai, p_qtd, 'entrada', p_custo, p_doc,
            p_obs, p_criado_por, p_ref, null)
    returning id into v_mov;
  exception when unique_violation then
    return null;
  end;

  select estoque into v_antes from public.variacoes where id = v_var for update;

  update public.variacoes
  set estoque = estoque + p_qtd,
      custo   = coalesce(p_custo, custo)
  where id = v_var
  returning estoque into v_novo;

  update public.estoque_movimentos
  set estoque_anterior = v_antes, estoque_resultante = v_novo
  where id = v_mov;

  return v_novo;
end $$;

create or replace function public.ajustar_estoque(
  p_org uuid, p_codigo text, p_novo_saldo integer, p_obs text,
  p_criado_por uuid, p_ref text
) returns integer language plpgsql security definer set search_path = ''
as $$
declare v_var uuid; v_pai text; v_antes integer; v_novo integer; v_mov uuid; v_kit smallint;
begin
  if p_novo_saldo is null or p_novo_saldo < 0 then
    raise exception 'ajustar_estoque: novo saldo deve ser inteiro >= 0 (recebeu %)', p_novo_saldo;
  end if;
  if p_novo_saldo > 99999 then
    raise exception 'ajustar_estoque: novo saldo acima do teto do canal (99999): %', p_novo_saldo;
  end if;
  if p_ref is null or btrim(p_ref) = '' then
    raise exception 'ajustar_estoque: referência de idempotência é obrigatória';
  end if;

  select v.id, f.codigo_pai, f.kit_multiplicador into v_var, v_pai, v_kit
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo
  order by f.criado_em desc
  limit 1;

  if v_var is null then
    raise exception 'ajustar_estoque: SKU % não encontrado na organização', p_codigo;
  end if;

  -- ADR-0151 D-9, mesma razão da entrada.
  if v_kit is not null then
    raise exception 'ajustar_estoque: % é um kit vinculado e não tem estoque próprio. Ajuste o produto-base.', p_codigo
      using errcode = '23514';
  end if;

  begin
    insert into public.estoque_movimentos
      (org_id, codigo, codigo_pai, quantidade, motivo, observacao, criado_por,
       referencia_externa, push_canal_origem)
    values (p_org, p_codigo, v_pai, 0, 'ajuste', p_obs, p_criado_por, p_ref, null)
    returning id into v_mov;
  exception when unique_violation then
    return null;
  end;

  select estoque into v_antes from public.variacoes where id = v_var for update;

  if p_novo_saldo > v_antes then
    raise exception 'ajustar_estoque: ajuste só reduz saldo (atual %, pedido %). Para aumentar, use Entrada de mercadoria.', v_antes, p_novo_saldo;
  end if;

  update public.variacoes set estoque = p_novo_saldo
  where id = v_var
  returning estoque into v_novo;

  update public.estoque_movimentos
  set quantidade = v_novo - v_antes, estoque_anterior = v_antes, estoque_resultante = v_novo
  where id = v_mov;

  return v_novo;
end $$;

-- ---------------------------------------------------------------------------
-- D-10: adicionar variação/cor NOVA a uma base com kit vinculado vivo é recusado.
--
-- `estoque_base` viraria ambíguo entre variações: o resolvedor derivaria o kit de um
-- número que o operador não reconhece.
--
-- O predicado é "este `codigo` é NOVO sob este `codigo_pai`", e NÃO "esta família já tem
-- variação". Duas razões:
--   1) Reposição por planilha (UPDATE) cria uma família NOVA e reinsere as MESMAS variações
--      — o saldo do produto com kit tem de continuar podendo subir. Contar linhas da família
--      nova barraria a partir da segunda variação de um produto que sempre teve duas, e
--      deixaria passar a cor nova de um produto que só tinha uma.
--   2) `adicionar-variacoes-familia` insere clones + cores novas num ÚNICO `.insert()`
--      multi-linha (index.ts:231). Um guard que conta linhas da própria família depende da
--      ordem dos elementos do array e da visibilidade de linhas da mesma instrução —
--      comportamento que ninguém deveria precisar raciocinar para entender uma trava.
--      Perguntar "este código já existe sob este pai?" é imune às duas coisas.
-- ---------------------------------------------------------------------------
create or replace function public.bloquear_variacao_extra_com_kit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_pai text; v_org uuid;
begin
  select f.codigo_pai, f.org_id into v_pai, v_org
  from public.familias f where f.id = new.familia_id;
  if v_pai is null then return new; end if;

  -- SKU que já existe sob este produto = reposição/clone. Sempre permitido.
  if exists (
    select 1 from public.variacoes v
    join public.familias f2 on f2.id = v.familia_id
    where f2.org_id = v_org and f2.codigo_pai = v_pai
      and v.codigo = new.codigo and v.familia_id <> new.familia_id
  ) then
    return new;
  end if;

  -- SKU novo: só passa se o produto ainda não tinha NENHUMA variação (produto nascendo)…
  if not exists (
    select 1 from public.variacoes v
    join public.familias f3 on f3.id = v.familia_id
    where f3.org_id = v_org and f3.codigo_pai = v_pai
  ) then
    return new;
  end if;

  -- …ou se o produto não tem kit vinculado ativo.
  if exists (
    select 1 from public.familias k
    where k.org_id = v_org
      and k.kit_base_codigo_pai = v_pai
      and k.kit_multiplicador is not null
      and k.status in ('pronto', 'publicando', 'publicado')
  ) then
    raise exception 'Produto % tem kit vinculado ativo: remova os kits antes de adicionar variação/cor.', v_pai
      using errcode = '23514';
  end if;

  return new;
end $$;

create trigger variacoes_bloquear_extra_com_kit
  before insert on public.variacoes
  for each row execute procedure public.bloquear_variacao_extra_com_kit();

-- ---------------------------------------------------------------------------
-- D-14: apagar a família-base com kit vinculado vivo é recusado.
--
-- Kit órfão venderia contra uma base que não existe mais: a venda não teria onde debitar
-- e a Decisão 6 inteira quebraria. A guard fica no banco porque `remover-publicado` faz
-- DELETE direto na tabela — o app é a primeira linha (Step 3), esta é a última.
-- ---------------------------------------------------------------------------
create or replace function public.bloquear_remocao_base_com_kit()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  -- A própria família de kit sendo apagada nunca é bloqueada.
  if old.kit_multiplicador is not null then return old; end if;

  -- Só bloqueia quando esta é a ÚLTIMA linha de `familias` daquele codigo_pai: cada lote de
  -- UPDATE cria uma linha nova, e apagar uma delas não desfaz o produto.
  if exists (
    select 1 from public.familias o
    where o.org_id = old.org_id and o.codigo_pai = old.codigo_pai and o.id <> old.id
  ) then
    return old;
  end if;

  if exists (
    select 1 from public.familias k
    where k.org_id = old.org_id
      and k.kit_base_codigo_pai = old.codigo_pai
      and k.kit_multiplicador is not null
      and k.status in ('pronto', 'publicando', 'publicado')
  ) then
    raise exception 'Produto % tem kit vinculado ativo: remova os kits antes de remover o produto-base.', old.codigo_pai
      using errcode = '23514';
  end if;

  return old;
end $$;

create trigger familias_bloquear_remocao_com_kit
  before delete on public.familias
  for each row execute procedure public.bloquear_remocao_base_com_kit();
```

- [ ] **Step 2: Aplicar e verificar as três guards contra o Postgres real**

```bash
cd "<repo>" && supabase db push && npm run db:check
```

Depois, SQL read-only pela Management API confirmando que as funções foram substituídas **sem perder o owner**:

```sql
select p.proname, r.rolname as owner
from pg_proc p join pg_roles r on r.oid = p.proowner
where p.proname in ('registrar_entrada','ajustar_estoque');
```

Esperado: as duas linhas com `owner = estoque_rpc_executor`. **Se vier `postgres`, pare** — o `create or replace` perdeu o owner e as RPCs vão falhar com 42501 no primeiro uso real; refaça a dança de owner da migration `20260811201026`.

```sql
select tgname from pg_trigger
where tgname in ('variacoes_bloquear_extra_com_kit','familias_bloquear_remocao_com_kit');
```

Esperado: 2 linhas.

**Regressão que esta guard NÃO pode causar** — confira explicitamente, porque quebrá-la tiraria do ar a reposição por planilha exatamente dos produtos que têm kit. Numa transação com `rollback`:

```sql
begin;
-- Simula o que `ingest-lote` faz num UPDATE de reposição: família NOVA, MESMAS variações.
-- Substitua <lote>, <org>, <user>, <pai>, <sku> pelos valores de um produto real COM kit vivo.
insert into public.familias (lote_id, org_id, user_id, codigo_pai, nome_pai, unidade, operacao, status, origem)
values ('<lote>', '<org>', '<user>', '<pai>', 'teste', 'UN', 'UPDATE', 'pronto', 'nacional')
returning id \gset
-- ESTA linha tem de PASSAR (mesmo `codigo` que já existe sob o pai = reposição):
insert into public.variacoes (familia_id, org_id, user_id, codigo, estoque, preco)
values (:'id', '<org>', '<user>', '<sku>', 50, 10);
-- ESTA linha tem de FALHAR com 23514 (código novo sob base com kit vivo):
insert into public.variacoes (familia_id, org_id, user_id, codigo, estoque, preco)
values (:'id', '<org>', '<user>', '99999999', 5, 10);
rollback;
```

Esperado: o primeiro insert passa, o segundo levanta `23514` com a mensagem do kit. **Se o primeiro falhar, pare** — a reposição por planilha dos produtos com kit estaria quebrada.

- [ ] **Step 3: Guard de app em `remover-publicado`**

A guard de banco é a última linha; o operador precisa de uma mensagem clara antes do DELETE. Em `supabase/functions/remover-publicado/processar.ts`, entre a checagem `em_voo` (~linha 55-58) e o início da mini-saga UP (~linha 60):

```ts
import { listarKitsVivos } from '../_shared/estoque/kit.ts';
```

```ts
  // ADR-0151 D-14: base com kit vinculado ativo não é removível — o kit venderia contra
  // uma base que não existe mais e a venda não teria onde debitar.
  if (alvo.kit_multiplicador == null) {
    const kits = await listarKitsVivos(deps.admin, alvo.org_id, alvo.codigo_pai);
    if (kits.length > 0) {
      return {
        ok: false,
        motivo: 'kit_vinculado_ativo',
        mensagem: `Este produto tem ${kits.length} kit(s) vinculado(s) (${kits.map((k) => `${k.kit_multiplicador}un`).join(', ')}). Remova os kits primeiro.`,
      };
    }
  }
```

Confira que `alvo` inclui `kit_multiplicador`, `org_id` e `codigo_pai` no select (~linha 46-52); acrescente se faltar. Adicione `'kit_vinculado_ativo'` ao union de motivos do tipo de retorno e ao mapeamento de mensagens da UI em `src/lib/excluir.ts`.

- [ ] **Step 4: Testar as guards de banco e de app**

Teste de app — acrescente em `supabase/functions/remover-publicado/__tests__/processar.test.ts`:

```ts
Deno.test('remover base com kit vinculado ativo é recusado', async () => {
  const deps = depsComFamilia({
    id: 'f-base', org_id: 'org-1', codigo_pai: '00000010',
    ml_item_id: 'MLB1', status: 'publicado', kit_multiplicador: null,
  }, { kits: [{ id: 'f-k3', codigo_pai: '00000020', kit_multiplicador: 3 }] });
  const r = await removerPublicado(deps, { familiaId: 'f-base', orgId: 'org-1' });
  assertEquals(r.ok, false);
  assertEquals(r.motivo, 'kit_vinculado_ativo');
});
```

(Adapte `depsComFamilia` ao helper já existente no arquivo.)

Teste de banco — SQL read-only, contra dados fabricados numa transação que dá rollback. Rode manualmente e registre a saída:

```sql
begin;
-- 1) entrada em SKU de kit deve falhar
-- (substitua os uuids/códigos por um kit real depois da Task 6; antes disso, valide só
--  que a função compila e que o owner está certo — o teste real vai na Task 6, Step 9.)
rollback;
```

- [ ] **Step 5: Rodar tudo e commitar**

```bash
cd "<repo>/supabase/functions" && deno test --allow-env --allow-net remover-publicado/__tests__/
cd "<repo>" && pnpm lint
```

```bash
git add supabase/migrations supabase/functions/remover-publicado src/lib/excluir.ts
git commit -m "feat(kit): guards de banco contra escrita direta, cor nova e remoção da base (ADR-0151 D-9/D-10/D-14)"
```

---

## Task 6: Edge `criar-kit-vinculado`

**Files:**
- Create: `supabase/functions/criar-kit-vinculado/index.ts`
- Create: `supabase/functions/criar-kit-vinculado/processar.ts`
- Create: `supabase/functions/criar-kit-vinculado/__tests__/processar.test.ts`
- Modify: `supabase/functions/_shared/categoria/atributos.ts` (exportar `forcarSaleFormatKit`, adicionar `aplicarKitNosAtributos`)
- Modify: `supabase/functions/publish-familia-ml/processar.ts` (encadear kits pendentes após CREATE bem-sucedido)
- Modify: `supabase/config.toml` (registrar a função nova)

**Interfaces:**
- Consumes: `exigirModulo` (`_shared/produto/modulo.ts:8`), `derivarCodigos` (`_shared/produto/codigos.ts`), `enfileirarPublicacoes` (`_shared/queue.ts:126`), `lerSchemaAtributos` (`_shared/categoria/schema.ts`), `resolverConexao` + `getValidAccessTokenConexao`, `listarKitsVivos` (Task 1).
- Produces:
  - `export function aplicarKitNosAtributos(schema: AtributoSchema[], atributos: AtributoML[], n: number): AtributoML[]` (em `_shared/categoria/atributos.ts`; lança `Error & {status:400}` quando a categoria não expõe `SALE_FORMAT=Kit`).
  - `export interface KitSolicitado { multiplicador: number; titulo: string; descricao: string; preco: number; gtin: string | null; imagemPath: string | null; alturaCm: number; larguraCm: number; comprimentoCm: number; atacado: unknown[] | null }`
  - `export interface CriarKitInput { familiaBaseId: string; chaveCadastro: string; kits: KitSolicitado[] }`
  - `export async function criarKitsVinculados(deps: CriarKitDeps, input: CriarKitInput): Promise<{ ok: boolean; motivo?: string; mensagem?: string; kits?: Array<{ familiaId: string; codigoPai: string; codigo: string; multiplicador: number }> }>`

### Contexto obrigatório antes de editar

**A armadilha número um desta task** é a mesma que derrubou `adicionar-variacoes-familia` em produção (ADR-0129, correção de 2026-08-21): o PostgREST monta um INSERT multi-linha unindo as chaves de **todos** os objetos e preenche com **NULL explícito** as que faltam em cada linha — e NULL explícito atropela o `DEFAULT` da coluna. Como o clone vem de `select('*')`, ele carrega colunas que o builder novo não monta, e cada uma vira NULL numa coluna `NOT NULL DEFAULT`.

Aqui o risco é menor (o kit insere **uma** variação por família, não um array misto), mas o mesmo bug reaparece se algum dia duas linhas forem inseridas juntas. Regra desta task, não-negociável:

1. O builder da família de kit e o builder da variação de kit têm **paridade exata de chaves** com o que o clone da base produz, após aplicar as listas de strip.
2. Um teste lê a lista real de colunas de `src/lib/database.types.ts` (nunca uma lista escrita à mão — lista fixa envelhece junto com o builder que deveria vigiar) e falha se alguma coluna `NOT NULL` de `familias`/`variacoes` não aparecer no objeto montado.

Outros pontos travados:

- `familias.chave_cadastro` é **obrigatória** em lote `origem='manual'` (trigger `validar_familia_no_tenant`). O front gera um uuid ao abrir o diálogo; a edge grava e o unique parcial `familias_org_chave_cadastro_key` dá idempotência por submissão (ADR-0096 D-9). Reenvio com a mesma chave devolve o resultado original, não cria um segundo kit.
- `codigo_pai` e `codigo` devem casar `^[0-9]{8}$` (trigger). Venham de `proximo_codigo_produto` + `derivarCodigos`, exatamente como `cadastrar-produto/index.ts:150-176`.
- `variacoes.estoque` do kit **tem de** nascer 0 — o trigger já força; não escreva outro valor.
- **Não** chame `enfileirarFamilia` / `process-familia` (Decisão 3). A família de kit nasce `status='pronto'`.
- `custo` = `custo` da base × N e `peso_gramas` = peso da base × N (Decisão 4, derivados sem tela). `custo` alimenta markup (ADR-0055): **nunca** pode nascer 0 nem null — se o custo da base for null ou ≤ 0, recuse com 400 LOUD.
- **Sem GTIN por padrão** e **nunca** herdando o da base (Decisão 5).
- Atacado **vazio por padrão** (não herda as faixas da base).

- [ ] **Step 1: Escrever os testes falhando**

Crie `supabase/functions/criar-kit-vinculado/__tests__/processar.test.ts`:

```ts
import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { criarKitsVinculados } from '../processar.ts';
import { aplicarKitNosAtributos } from '../../_shared/categoria/atributos.ts';

const SCHEMA_COM_KIT = [
  { id: 'SALE_FORMAT', values: [{ id: 'V-UN', name: 'Unidade' }, { id: 'V-KIT', name: 'Kit' }] },
  { id: 'UNITS_PER_PACK', value_type: 'number' },
];

Deno.test('aplicarKitNosAtributos sobrescreve SALE_FORMAT e UNITS_PER_PACK pelo N', () => {
  const r = aplicarKitNosAtributos(
    SCHEMA_COM_KIT as never,
    [{ id: 'SALE_FORMAT', value_id: 'V-UN' }, { id: 'BRAND', value_name: 'ACME' }],
    3,
  );
  assertEquals(r.find((a) => a.id === 'SALE_FORMAT')?.value_id, 'V-KIT');
  assertEquals(r.find((a) => a.id === 'UNITS_PER_PACK')?.value_name, '3');
  assertEquals(r.find((a) => a.id === 'BRAND')?.value_name, 'ACME');
});

Deno.test('aplicarKitNosAtributos falha LOUD quando a categoria não expõe SALE_FORMAT=Kit', () => {
  let status: number | undefined;
  try {
    aplicarKitNosAtributos([{ id: 'BRAND' }] as never, [], 3);
  } catch (e) {
    status = (e as Error & { status?: number }).status;
  }
  assertEquals(status, 400);
});

Deno.test('kit deriva custo e peso multiplicados por N', async () => {
  const { deps, inserts } = depsFake({ custo: 12.5, peso_gramas: 200 });
  const r = await criarKitsVinculados(deps, {
    familiaBaseId: 'f-base', chaveCadastro: 'uuid-1',
    kits: [kitPadrao(3)],
  });
  assertEquals(r.ok, true);
  const variacao = inserts.variacoes[0];
  assertEquals(variacao.custo, 37.5);
  assertEquals(variacao.peso_gramas, 600);
  assertEquals(variacao.estoque, 0);
  assertEquals(variacao.gtin, null);
});

Deno.test('kit nasce vinculado à base e pronto, sem passar por process-familia', async () => {
  const { deps, inserts, enfileirados } = depsFake({ custo: 10, peso_gramas: 100 });
  await criarKitsVinculados(deps, {
    familiaBaseId: 'f-base', chaveCadastro: 'uuid-2', kits: [kitPadrao(2)],
  });
  const familia = inserts.familias[0];
  assertEquals(familia.kit_base_codigo_pai, '00000010');
  assertEquals(familia.kit_multiplicador, 2);
  assertEquals(familia.status, 'pronto');
  assertEquals(familia.operacao, 'CREATE');
  assertEquals(familia.chave_cadastro, 'uuid-2');
  // Decisão 3: nada de process-familia.
  assertEquals(enfileirados.processFamilia, 0);
});

Deno.test('base já publicada encadeia publicar-familias na hora', async () => {
  const { deps, enfileirados } = depsFake({ custo: 10, peso_gramas: 100, mlItemId: 'MLB1' });
  await criarKitsVinculados(deps, {
    familiaBaseId: 'f-base', chaveCadastro: 'uuid-3', kits: [kitPadrao(2)],
  });
  assertEquals(enfileirados.publicarFamilias, 1);
});

Deno.test('base ainda não publicada NÃO encadeia — quem publica é o worker do CREATE da base', async () => {
  const { deps, enfileirados } = depsFake({ custo: 10, peso_gramas: 100, mlItemId: null });
  await criarKitsVinculados(deps, {
    familiaBaseId: 'f-base', chaveCadastro: 'uuid-4', kits: [kitPadrao(2)],
  });
  assertEquals(enfileirados.publicarFamilias, 0);
});

Deno.test('base com mais de uma variação é recusada (escopo v1)', async () => {
  const { deps } = depsFake({ custo: 10, peso_gramas: 100, qtdVariacoes: 2 });
  const r = await criarKitsVinculados(deps, {
    familiaBaseId: 'f-base', chaveCadastro: 'uuid-5', kits: [kitPadrao(2)],
  });
  assertEquals(r.ok, false);
  assertEquals(r.motivo, 'base_multivariacao');
});

Deno.test('base sem custo é recusada LOUD (custo alimenta markup, ADR-0055)', async () => {
  const { deps } = depsFake({ custo: null, peso_gramas: 100 });
  const r = await criarKitsVinculados(deps, {
    familiaBaseId: 'f-base', chaveCadastro: 'uuid-6', kits: [kitPadrao(2)],
  });
  assertEquals(r.ok, false);
  assertEquals(r.motivo, 'base_sem_custo');
});

Deno.test('reenvio com a mesma chave_cadastro devolve o kit original sem criar outro', async () => {
  const { deps, inserts } = depsFake({ custo: 10, peso_gramas: 100, chaveJaUsada: 'uuid-7' });
  const r = await criarKitsVinculados(deps, {
    familiaBaseId: 'f-base', chaveCadastro: 'uuid-7', kits: [kitPadrao(2)],
  });
  assertEquals(r.ok, true);
  assertEquals(inserts.familias.length, 0);
});

Deno.test('multiplicador fora de 2..6 é recusado', async () => {
  const { deps } = depsFake({ custo: 10, peso_gramas: 100 });
  for (const n of [1, 7, 0, -2]) {
    const r = await criarKitsVinculados(deps, {
      familiaBaseId: 'f-base', chaveCadastro: `uuid-n${n}`, kits: [kitPadrao(n)],
    });
    assertEquals(r.ok, false, `N=${n} deveria ser recusado`);
    assertEquals(r.motivo, 'multiplicador_invalido');
  }
});

Deno.test('título acima de 60 caracteres é recusado', async () => {
  const { deps } = depsFake({ custo: 10, peso_gramas: 100 });
  const r = await criarKitsVinculados(deps, {
    familiaBaseId: 'f-base', chaveCadastro: 'uuid-8',
    kits: [{ ...kitPadrao(2), titulo: 'x'.repeat(61) }],
  });
  assertEquals(r.ok, false);
  assertEquals(r.motivo, 'titulo_longo');
});
```

Implemente `depsFake` e `kitPadrao` no topo do arquivo, espelhando o fake de `adicionar-variacoes-familia/__tests__/processar.test.ts` — leia esse arquivo antes e reuse o formato dele.

- [ ] **Step 2: Escrever o teste de paridade de chaves**

No mesmo arquivo:

```ts
/**
 * ADR-0129 (correção 2026-08-21): o PostgREST une as chaves das linhas de um insert
 * multi-linha e grava NULL EXPLÍCITO nas que faltam, atropelando o DEFAULT da coluna.
 * A lista de colunas vem do snapshot de schema versionado, nunca escrita à mão — lista
 * fixa envelheceria junto com o builder que deveria vigiar.
 */
Deno.test('builders cobrem toda coluna NOT NULL sem default de familias e variacoes', async () => {
  const types = await Deno.readTextFile(
    new URL('../../../../src/lib/database.types.ts', import.meta.url),
  );
  const colunasNotNull = (tabela: string) => extrairColunasNotNull(types, tabela);
  const { deps, inserts } = depsFake({ custo: 10, peso_gramas: 100 });
  await criarKitsVinculados(deps, {
    familiaBaseId: 'f-base', chaveCadastro: 'uuid-parity', kits: [kitPadrao(2)],
  });
  for (const col of colunasNotNull('familias')) {
    assertEquals(col in inserts.familias[0], true, `familias.${col} ausente no builder do kit`);
  }
  for (const col of colunasNotNull('variacoes')) {
    assertEquals(col in inserts.variacoes[0], true, `variacoes.${col} ausente no builder do kit`);
  }
});
```

Implemente `extrairColunasNotNull(types, tabela)` lendo o bloco `Row:` da tabela em `database.types.ts` e devolvendo as chaves cujo tipo **não** inclui `| null`. Reuse a implementação que já existe em `supabase/functions/adicionar-variacoes-familia/__tests__/processar.test.ts` — leia-a e importe/copie, não reinvente.

- [ ] **Step 3: Rodar e confirmar falha**

```bash
cd "<repo>/supabase/functions" && deno test --allow-env --allow-net --allow-read criar-kit-vinculado/__tests__/
```

Esperado: FALHA — módulos inexistentes.

- [ ] **Step 4: Exportar e ampliar os helpers de atributos**

Em `supabase/functions/_shared/categoria/atributos.ts`:

```ts
// Era module-private; o kit vinculado precisa forçar o formato SEM passar pela regex de
// título (ADR-0151 D-3: nunca re-extrair por regex — mesma classe de bug do ADR-0071).
export function forcarSaleFormatKit(
```

e acrescente:

```ts
/**
 * ADR-0151 D-3 — grava no `atributos_ml` do kit o formato de venda e a contagem REAIS,
 * a partir do `kit_multiplicador`, sem tocar nos demais atributos herdados da base.
 *
 * Falha LOUD (400) quando a categoria não expõe `SALE_FORMAT` com valor "Kit": publicar
 * um kit de N unidades como "Unidade" venderia N unidades ao preço de uma para o ML, e o
 * ADR-0071 mostra que o ML rejeita a combinação incoerente de qualquer forma.
 */
export function aplicarKitNosAtributos(
  schema: AtributoSchema[], atributos: AtributoML[], n: number,
): AtributoML[] {
  const comKit = forcarSaleFormatKit(schema, atributos);
  const mudou = comKit.find((a) => a.id === 'SALE_FORMAT');
  const kitDisponivel = schema
    .find((s) => s.id === 'SALE_FORMAT')?.values?.some((v) => v.name === 'Kit');
  if (!kitDisponivel || !mudou) {
    const e = new Error(
      'Esta categoria do ML não oferece o formato de venda "Kit". Não é possível criar kit vinculado aqui.',
    ) as Error & { status?: number };
    e.status = 400;
    throw e;
  }
  const semUpp = comKit.filter((a) => a.id !== 'UNITS_PER_PACK');
  return [...semUpp, { id: 'UNITS_PER_PACK', value_name: String(n) }];
}
```

- [ ] **Step 5: Implementar `criar-kit-vinculado/processar.ts`**

Estrutura (leia `adicionar-variacoes-familia/processar.ts` antes — é o precedente direto, e os padrões de `STRIP_FAMILIA`/`STRIP_VARIACAO` são reusados aqui):

```ts
// ADR-0151: cria as famílias de kit vinculado a partir de uma família-base.
//
// NÃO roda `process-familia` (D-3): a família nasce copiando categoria/atributos/descrição
// da base, já em `status='pronto'`. Se rodasse depois, título/preço/atributos poderiam
// divergir do preview que o operador confirmou, furando a revisão humana (D-4).

const STRIP_FAMILIA_KIT = [
  // O que NÃO se copia da base: identidade, lifecycle, rastros de execução e resultado.
  'id', 'criado_em', 'atualizado_em', 'lote_id', 'status', 'chave_cadastro',
  'qstash_message_id', 'erro_mensagem', 'editado_em', 'publicado_em', 'titulo_descartes',
  'mudanca_estrutural', 'ml_item_id', 'ml_permalink', 'codigo_pai',
  'titulo_ml', 'descricao_ml', 'atributos_ml',
  'capa_storage_path', 'capa_ml_picture_id', 'capa2_storage_path', 'capa2_ml_picture_id',
  'capa3_storage_path', 'capa3_ml_picture_id',
  'atacado', 'atacado_status', 'atacado_erro',
  'kit_base_codigo_pai', 'kit_multiplicador',
] as const;

const STRIP_VARIACAO_KIT = [
  'id', 'criado_em', 'atualizado_em', 'familia_id', 'codigo',
  'gtin', 'estoque', 'estoque_anterior', 'ml_variation_id', 'ml_picture_id', 'imagem_path',
  'catalog_product_id', 'catalog_listing_id', 'catalog_status', 'catalog_erro',
  'preco_publicado_ml', 'custo', 'peso_gramas',
  'altura_cm', 'largura_cm', 'comprimento_cm', 'preco', 'preco_publicacao',
  'atacado', 'exibir_com_desconto', 'desconto_pct',
] as const;
```

Fluxo de `criarKitsVinculados`:

1. **Idempotência**: `familias.select('id, codigo_pai, kit_multiplicador').eq('org_id', orgId).eq('chave_cadastro', input.chaveCadastro)`. Se houver linha, devolve `{ ok: true, kits: <as existentes> }` sem criar nada.
2. **Validar o input**: cada `multiplicador` inteiro em 2..6 (`motivo: 'multiplicador_invalido'`); `titulo.length <= 60` (`'titulo_longo'`); `preco > 0` (`'preco_invalido'`); tamanhos não repetidos entre si nem entre os kits **já existentes** da base (`'kit_duplicado'`).
3. **Ler a base**: família canônica de `input.familiaBaseId` (`select('*')`) + variações (`select('*')`).
   - `> 1` variação → `{ ok: false, motivo: 'base_multivariacao' }` (Decisão 10).
   - `kit_multiplicador is not null` na base → `{ ok: false, motivo: 'base_e_kit' }` (kit de kit não existe).
   - `custo` da variação null ou `<= 0` → `{ ok: false, motivo: 'base_sem_custo' }` (LOUD; custo alimenta markup, ADR-0055).
   - `peso_gramas` null ou `<= 0` → `{ ok: false, motivo: 'base_sem_peso' }` (alimenta frete, ADR-0018).
   - `categoria_ml_id` null → `{ ok: false, motivo: 'base_sem_categoria' }`.
4. **Atributos**: token do ML via `resolverConexao` + `getValidAccessTokenConexao`; `lerSchemaAtributos(token, base.categoria_ml_id)`; para cada kit, `aplicarKitNosAtributos(schema, base.atributos_ml, n)`. O `status: 400` que a função lança vira `{ ok: false, motivo: 'categoria_sem_kit', mensagem: e.message }`.
5. **Códigos**: `proximo_codigo_produto(orgId, kits.length * 2)` → `derivarCodigos` (1 PAI + 1 SKU por kit). Colisão → `p_resync: true` e nova tentativa; colidiu de novo → `{ ok: false, motivo: 'falha_numeracao' }` com status 500 (ADR-0096 D-4.1/D-10).
6. **Lote dedicado**: `lotes.insert({ org_id, user_id, origem: 'manual', status: 'processando', numero: <proximo_numero_lote> })`. Valores válidos de `lote_status` (verificados): `importando`, `processando`, `revisao`, `publicando`, `concluido`, `erro`. Use `'processando'`, **não** `'revisao'` — `'revisao'` colocaria os kits na fila de Revisão e violaria D-4. Lote dedicado (não o manual aberto) pelo mesmo motivo do desvio 2 do ADR-0129.

   **Risco residual, registre no ADR (Task 11):** se a base nunca publicar, o lote dos kits fica em `'processando'` para sempre, e o `LoteCard` desabilita a exclusão nesse status (risco residual já documentado no ADR-0094). O caminho de saída para o operador é excluir as **famílias** de kit (elas nunca foram publicadas, então a exclusão é um delete simples) — `talvezFinalizarLote` recalcula do estado vivo e fecha o lote vazio. Não construa uma tela de "cancelar kits pendentes" nesta v1.
7. **Insert das famílias**: uma por kit, montada por `montarFamiliaKit(base, kit, { loteId, codigoPai, chaveCadastro, atributos })` — clone da base com `STRIP_FAMILIA_KIT` + os campos próprios:
   ```ts
   {
     ...clone,
     lote_id: loteId,
     codigo_pai: codigoPai,
     chave_cadastro: chaveCadastro,
     status: 'pronto',
     operacao: 'CREATE',
     nome_pai: kit.titulo,
     titulo_ml: kit.titulo,
     titulo_editado_pelo_operador: true,   // o operador confirmou no preview (D-4)
     descricao_pai: kit.descricao,
     descricao_ml: kit.descricao,
     descricao_editada_pelo_operador: true,
     atributos_ml: atributosDoKit,
     capa_storage_path: kit.imagemPath,     // pré-preenchida com a da base, trocável (D-4)
     capa_ml_picture_id: null,              // foto nova → picture_id é resolvido no CREATE
     atacado: kit.atacado ?? null,          // vazio por padrão, NÃO herda a base (D-4)
     atacado_status: null, atacado_erro: null,
     kit_base_codigo_pai: base.codigo_pai,
     kit_multiplicador: kit.multiplicador,
   }
   ```
   Insira **uma família por chamada** de `.insert()` (nunca um array misto) — assim o bug de união de chaves do PostgREST não tem como aparecer. A paridade de chaves continua obrigatória (Step 2).
8. **Insert da variação** (uma por família), montada por `montarVariacaoKit(baseVar, kit, { familiaId, codigo })`:
   ```ts
   {
     ...clone,
     familia_id: familiaId,
     codigo,
     gtin: kit.gtin,                        // null por padrão, NUNCA o da base (D-5)
     estoque: 0,                            // trigger força; explícito por clareza (D-8)
     estoque_anterior: 0,
     custo: Number((baseVar.custo * kit.multiplicador).toFixed(2)),   // D-4
     peso_gramas: baseVar.peso_gramas * kit.multiplicador,            // D-4
     altura_cm: kit.alturaCm, largura_cm: kit.larguraCm, comprimento_cm: kit.comprimentoCm,
     preco: kit.preco, preco_publicacao: kit.preco,
     preco_editado_pelo_operador: true,     // o operador confirmou no preview
     preco_publicado_ml: null,
     imagem_path: kit.imagemPath, ml_picture_id: null, ml_variation_id: null,
     catalog_product_id: null, catalog_listing_id: null,
     catalog_status: 'pendente', catalog_erro: null,
     cor: null, cor_hex: null, cor_origem: null, cor_editada_pelo_operador: false,
     excluida_da_publicacao: false,
     atacado: null, exibir_com_desconto: null, desconto_pct: null,
   }
   ```
9. **Rollback em falha parcial**: se o insert de variação falhar, apague a família e o lote criados nesta chamada — mesmo padrão do `varErr` de `adicionar-variacoes-familia`. Nada remoto aconteceu ainda, então não sobra resíduo.
10. **Encadeamento**: se `base.ml_item_id` **não for null**, chame `encadearPublicacao(familiaIds)` (o mesmo helper de `adicionar-variacoes-familia/index.ts:35-48`). Se for null, **não** encadeie — quem publica é o Step 7 desta task.

- [ ] **Step 6: Implementar `criar-kit-vinculado/index.ts`**

Espelhe `adicionar-variacoes-familia/index.ts`:

```
Deno.serve
  → OPTIONS / method guard
  → requireUserOrg(req, { access: 'write' })
  → admin-only (mesmo gate do ADR-0060 usado em adicionar-variacoes-familia:64)
  → exigirModulo(admin, orgId, 'estoque')            [ADR-0151 D-12]
  → parse body { familia_base_id, chave_cadastro, kits[] }
  → criarKitsVinculados(deps, input)
  → 200 { ok, kits } | 400/409/500 { motivo, mensagem }
```

Registre em `supabase/config.toml`, junto do bloco de `adicionar-variacoes-familia` (linhas 48-49). Conteúdo literal a acrescentar:

```toml
# ADR-0151: criação de kit vinculado. Chamada pelo APP com o JWT do admin.
[functions.criar-kit-vinculado]
verify_jwt = true
```

`verify_jwt = true` (e **não** `false`): a regra de `verify_jwt=false` do CLAUDE.md vale para workers chamados pelo QStash, não para edges chamadas pelo browser. Esta é chamada pelo browser.

- [ ] **Step 7: Encadear os kits pendentes após o CREATE da base**

Em `supabase/functions/publish-familia-ml/processar.ts`, depois do CREATE ter confirmado sucesso (`ml_item_id` gravado e `status='publicado'`), antes de `talvezFinalizarLote`:

```ts
import { enfileirarPublicacoes } from '../_shared/queue.ts';
```

```ts
  // ADR-0151 D-2 — sequenciamento: os kits marcados na Revisão só publicam DEPOIS que o
  // CREATE da base confirmou. Se a base falha, nenhum kit vai ao ar; o operador corrige e
  // reenvia o lote da base, e este bloco dispara no sucesso.
  //
  // Best-effort de propósito: esta chamada roda dentro do `try` do worker, e uma exceção
  // aqui marcaria como `erro` uma família JÁ publicada com sucesso no ML — o mesmo motivo
  // pelo qual `talvezFinalizarLote` não lança (ADR-0094, correção 3).
  try {
    const { data: kitsPendentes } = await admin.from('familias')
      .select('id, lote_id')
      .eq('org_id', familia.org_id).eq('kit_base_codigo_pai', familia.codigo_pai)
      .not('kit_multiplicador', 'is', null)
      .eq('status', 'pronto').is('ml_item_id', null);
    if ((kitsPendentes ?? []).length > 0) {
      await enfileirarPublicacoes(
        (kitsPendentes ?? []).map((k) => ({
          f: { id: k.id as string, lote_id: k.lote_id as string },
          alvo: 'publish' as const,
          job: { familia_id: k.id as string, lote_id: k.lote_id as string },
        })),
        familia.user_id as string,
      );
    }
  } catch (e) {
    console.error('kit_encadear_apos_base_falhou', familia.codigo_pai, String(e));
  }
```

Confira a assinatura real de `enfileirarPublicacoes` em `_shared/queue.ts:126` e adapte a forma dos itens — não invente campos.

**Confirme que o reenvio passa por aqui.** A Decisão 2 diz que, se o CREATE da base falhar, "o operador reenvia o lote inteiro depois de corrigir". Esse reenvio precisa reentrar neste worker, senão os kits ficariam `pronto` para sempre sem gatilho. Rastreie o caminho:

```bash
cd "<repo>" && grep -n "operacao.*CREATE\|status.*erro" supabase/functions/publicar-familias/index.ts | head
```

`publicar-familias/index.ts:48-56` faz o claim de CREATE com `status in ('pronto','erro')` — logo, a família em `erro` é reclamada de novo e roteada para `publish-familia-ml`, onde este bloco vive. **Confirme essa leitura** abrindo o arquivo antes de seguir; se por algum motivo o reenvio não reentrar neste worker, o gatilho tem de mudar de lugar (candidato: o próprio `publicar-familias`, depois de confirmar `ml_item_id`) — e isso é uma mudança de desenho que volta para o Diego, não uma decisão do executor.

- [ ] **Step 8: Rodar os testes**

```bash
cd "<repo>/supabase/functions" && deno test --allow-env --allow-net --allow-read criar-kit-vinculado/__tests__/ publish-familia-ml/__tests__/ _shared/categoria/__tests__/
```

Esperado: PASS.

- [ ] **Step 9: Validar as guards da Task 5 contra o Postgres real, com um kit real**

Mock não basta em caminho de estoque (incidente 2026-08-21). Faça deploy da edge nova para o projeto de trabalho, crie um kit real numa org de teste e rode, pela Management API:

```sql
-- Substitua <org>, <sku_kit>, <sku_base> pelos valores reais criados no teste.
-- 1) entrada em SKU de kit → deve levantar exceção 23514
select public.registrar_entrada('<org>'::uuid, '<sku_kit>', 1, null, null, null, null, gen_random_uuid()::text);
-- 2) ajuste em SKU de kit → deve levantar exceção 23514
select public.ajustar_estoque('<org>'::uuid, '<sku_kit>', 0, 'teste', null, gen_random_uuid()::text);
-- 3) entrada no SKU da BASE → deve funcionar
select public.registrar_entrada('<org>'::uuid, '<sku_base>', 10, 5.00, 'teste', null, null, gen_random_uuid()::text);
-- 4) saldo derivado do kit: com 10 na base e N=3, o push deve mandar 3
select v.codigo, v.estoque, f.kit_multiplicador
from public.variacoes v join public.familias f on f.id = v.familia_id
where f.kit_multiplicador is not null and v.org_id = '<org>'::uuid;
```

Esperado: (1) e (2) levantam exceção com a mensagem do kit; (3) devolve o saldo novo; (4) mostra `estoque = 0` na linha do kit (o saldo virtual não vive na coluna).

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/criar-kit-vinculado supabase/functions/_shared/categoria/atributos.ts \
        supabase/functions/publish-familia-ml/processar.ts supabase/config.toml
git commit -m "feat(kit): edge criar-kit-vinculado e sequenciamento após o CREATE da base (ADR-0151 D-1/D-2/D-3/D-4/D-5)"
```

---

## Task 7: Gatilho e preview na tela Publicados

**Files:**
- Create: `src/lib/kit.ts`
- Create: `src/lib/__tests__/kit.test.ts`
- Create: `src/components/kit/preview-kit.tsx`
- Create: `src/components/kit/dialog-criar-kit.tsx`
- Modify: `src/pages/Publicados.tsx`
- Modify: `src/lib/queries.ts`

**Interfaces:**
- Consumes: a edge `criar-kit-vinculado` (Task 6); `useModulosHabilitados` (`src/hooks/useModulosHabilitados.ts:6`); `useProfile()` para `isAdmin` (padrão ADR-0060 já usado em `Publicados.tsx:154`); `campo-foto.tsx` (`src/components/estoque/campo-foto.tsx`).
- Produces:
  - `src/lib/kit.ts`:
    - `export const TAMANHOS_KIT = [2, 3, 4, 5, 6] as const;`
    - `export const TITULO_MAX_KIT = 60;`
    - `export function tituloDoKit(tituloBase: string, n: number): string`
    - `export function precoSugeridoDoKit(precoBase: number, n: number, descontoPct?: number): number`
    - `export function descricaoDoKit(descricaoBase: string, n: number): string`
    - `export interface KitFormValues { multiplicador: number; titulo: string; descricao: string; preco: number; gtin: string | null; imagemPath: string | null; alturaCm: number; larguraCm: number; comprimentoCm: number; atacado: unknown[] | null }`
    - `export async function criarKitVinculado(p: { familiaBaseId: string; chaveCadastro: string; kits: KitFormValues[] }): Promise<{ ok: boolean; motivo?: string; mensagem?: string }>`
  - `src/components/kit/dialog-criar-kit.tsx`: `export function DialogCriarKit(props: { familiaBaseId: string; base: BaseParaKit; kitsExistentes: number[]; open: boolean; onOpenChange: (v: boolean) => void })`
- `QK.kitsDoProduto(codigoPai: string)` em `src/lib/queries.ts`.

- [ ] **Step 1: Escrever os testes das funções puras (falhando)**

Crie `src/lib/__tests__/kit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tituloDoKit, precoSugeridoDoKit, descricaoDoKit, TITULO_MAX_KIT } from '../kit';

describe('tituloDoKit', () => {
  it('acrescenta o tamanho do kit ao título da base', () => {
    expect(tituloDoKit('Fita Adesiva Transparente 45mm', 3))
      .toBe('Fita Adesiva Transparente 45mm Kit 3 Unidades');
  });

  it('nunca ultrapassa 60 caracteres — corta o título da base, não o sufixo', () => {
    const base = 'Fita Adesiva Transparente Dupla Face Extra Forte 45mm x 50m';
    const r = tituloDoKit(base, 6);
    expect(r.length).toBeLessThanOrEqual(TITULO_MAX_KIT);
    expect(r.endsWith('Kit 6 Unidades')).toBe(true);
  });

  it('não corta no meio de uma palavra', () => {
    const r = tituloDoKit('Fita Adesiva Transparente Dupla Face Extra Forte 45mm', 2);
    expect(r).not.toMatch(/\s\S+?-?\s?Kit 2 Unidades$/u.source.length ? /  / : / {2}/);
    expect(r.trim()).toBe(r);
  });
});

describe('precoSugeridoDoKit', () => {
  it('multiplica o preço unitário pelo tamanho', () => {
    expect(precoSugeridoDoKit(19.9, 3)).toBe(59.7);
  });
  it('aplica o desconto opcional sobre o total', () => {
    expect(precoSugeridoDoKit(100, 2, 10)).toBe(180);
  });
  it('arredonda a 2 casas', () => {
    expect(precoSugeridoDoKit(19.99, 3, 7)).toBe(55.77);
  });
});

describe('descricaoDoKit', () => {
  it('acrescenta a linha do tamanho ao final da descrição da base', () => {
    expect(descricaoDoKit('Fita de boa qualidade.', 4))
      .toBe('Fita de boa qualidade.\n\nKit com 4 unidades.');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
cd "<repo>" && pnpm vitest run src/lib/__tests__/kit.test.ts
```

Esperado: FALHA — `src/lib/kit.ts` não existe.

- [ ] **Step 3: Implementar `src/lib/kit.ts`**

```ts
// ADR-0151 — derivações do kit vinculado no front. Puras e testadas: o preview que o
// operador confirma É o resultado final (D-3/D-4), então não pode haver segunda derivação
// no backend divergindo desta.
import { supabase } from './supabase';

export const TAMANHOS_KIT = [2, 3, 4, 5, 6] as const;

/** Teto do ML, igual ao TITULO_MAX de `_shared/ai/titulo-montar.ts:4`. */
export const TITULO_MAX_KIT = 60;

/**
 * O sufixo do kit é a informação que NÃO pode se perder — é o que diferencia este anúncio
 * do da base na busca do ML. Quando não cabe, quem encolhe é o título da base, cortado em
 * fronteira de palavra.
 */
export function tituloDoKit(tituloBase: string, n: number): string {
  const sufixo = `Kit ${n} Unidades`;
  const folga = TITULO_MAX_KIT - sufixo.length - 1;
  const base = tituloBase.trim();
  if (base.length <= folga) return `${base} ${sufixo}`;
  const cortado = base.slice(0, folga);
  const ultimoEspaco = cortado.lastIndexOf(' ');
  const limpo = (ultimoEspaco > 0 ? cortado.slice(0, ultimoEspaco) : cortado).trim();
  return `${limpo} ${sufixo}`;
}

/** Sugestão editável: unitário × N, com desconto opcional em % sobre o total. */
export function precoSugeridoDoKit(precoBase: number, n: number, descontoPct = 0): number {
  const bruto = precoBase * n;
  const liquido = bruto * (1 - descontoPct / 100);
  return Number(liquido.toFixed(2));
}

export function descricaoDoKit(descricaoBase: string, n: number): string {
  return `${descricaoBase.trimEnd()}\n\nKit com ${n} unidades.`;
}

export interface KitFormValues {
  multiplicador: number;
  titulo: string;
  descricao: string;
  preco: number;
  gtin: string | null;
  imagemPath: string | null;
  alturaCm: number;
  larguraCm: number;
  comprimentoCm: number;
  atacado: unknown[] | null;
}

export async function criarKitVinculado(p: {
  familiaBaseId: string; chaveCadastro: string; kits: KitFormValues[];
}): Promise<{ ok: boolean; motivo?: string; mensagem?: string }> {
  const { data, error } = await supabase.functions.invoke('criar-kit-vinculado', {
    body: {
      familia_base_id: p.familiaBaseId,
      chave_cadastro: p.chaveCadastro,
      kits: p.kits.map((k) => ({
        multiplicador: k.multiplicador, titulo: k.titulo, descricao: k.descricao,
        preco: k.preco, gtin: k.gtin, imagem_path: k.imagemPath,
        altura_cm: k.alturaCm, largura_cm: k.larguraCm, comprimento_cm: k.comprimentoCm,
        atacado: k.atacado,
      })),
    },
  });
  if (error) return { ok: false, motivo: 'rede', mensagem: error.message };
  return data as { ok: boolean; motivo?: string; mensagem?: string };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd "<repo>" && pnpm vitest run src/lib/__tests__/kit.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Implementar `src/components/kit/preview-kit.tsx`**

Um bloco de preview por tamanho de kit, todos os campos editáveis, conforme Decisão 4:

| Campo | Pré-preenchido com | Editável | Nota |
|---|---|---|---|
| Título | `tituloDoKit(base.titulo_ml, n)` | sim | contador de caracteres visível, bloqueia > 60 |
| Descrição | `descricaoDoKit(base.descricao_ml, n)` | sim | |
| Foto | foto da base | sim | reusa `src/components/estoque/campo-foto.tsx` |
| Altura/Largura/Comprimento (cm) | iguais aos da base | sim | **não** multiplicar por N — empacotar N unidades não é N× linear (ADR-0018) |
| Preço | `precoSugeridoDoKit(base.preco, n)` | sim | campo de desconto opcional em % recalcula |
| Atacado | vazio | sim | **não** herda as faixas da base |
| GTIN | vazio | sim | **nunca** o GTIN da base (D-5) |

Exiba, **somente leitura**, os dois derivados sem tela própria (fórmula fixa, D-4):
- Custo: `custo_base × N`
- Peso: `peso_base × N g`

E o saldo virtual, também somente leitura: `Math.floor(estoqueBase / n)` com a legenda "calculado a partir do produto-base — o kit não tem estoque próprio".

- [ ] **Step 6: Implementar `src/components/kit/dialog-criar-kit.tsx`**

- Etapa 1: checkboxes de `TAMANHOS_KIT`, com os tamanhos já existentes desabilitados e rotulados "já criado".
- Etapa 2: um `PreviewKit` por tamanho marcado.
- `chaveCadastro` nasce com `crypto.randomUUID()` **ao abrir o diálogo** e só troca após sucesso confirmado — cópia exata do padrão de `src/components/estoque/dialog-entrada.tsx:33-45` e `dialog-cadastro-produto.tsx` (ADR-0096 D-9). É a idempotência da submissão.
- Botão "Criar kits" desabilitado enquanto qualquer título passar de 60 caracteres, qualquer preço for ≤ 0, ou nenhum tamanho estiver marcado.
- `onSuccess`: `toast.success`, invalidar `QK.publicados`, `QK.kitsDoProduto(codigoPai)`, `QK.produtosEstoqueResumo` e `['lotes']`, e fechar.
- Erros da edge por `motivo` viram mensagem específica: `base_multivariacao` → "Kit vinculado só existe para produto sem variação de cor."; `categoria_sem_kit` → a mensagem da edge; `base_sem_custo` → "Cadastre o custo do produto-base antes de criar kits (o custo do kit é derivado dele)."; `kit_duplicado` → "Já existe um kit desse tamanho para este produto."

- [ ] **Step 7: Ligar o gatilho em `src/pages/Publicados.tsx`**

Acrescente uma ação "Criar kit" ao bloco de ações por anúncio (junto de pausar/reativar/remover, ~linhas 275-336), com o mesmo padrão de `disabled` + tooltip usado lá (ADR-0060 — desabilitar e explicar, não esconder):

```tsx
disabled={!isAdmin || !temModuloEstoque || ehKitVinculado || temVariacaoDeCor}
```

Tooltips por motivo:
- sem admin → "Somente administradores podem criar kits."
- sem módulo → "Kit vinculado exige o módulo Estoque habilitado." (Decisão 12)
- é kit → "Este anúncio já é um kit vinculado."
- multi-cor → "Kit vinculado só existe para produto sem variação de cor." (Decisão 10)

`temModuloEstoque` vem de `useModulosHabilitados()` (`modulos?.includes('estoque')`, mesmo uso de `src/pages/Estoque.tsx:44`).

Mostre também, no card do produto-base, os kits vinculados existentes: `QK.kitsDoProduto(codigoPai)`, consultando `familias` por `(org_id, kit_base_codigo_pai)`.

- [ ] **Step 8: Verificar em runtime real**

Rode `pnpm dev`, abra Publicados numa org com o módulo Estoque, e confira com screenshot (snapshot de acessibilidade não pega bug de layout):
1. O botão "Criar kit" aparece desabilitado para produto com cor e habilitado para produto sem cor.
2. O diálogo abre, o preview mostra custo e peso multiplicados por N, e o contador de título bloqueia acima de 60.
3. Criar 1 kit de 3 gera o anúncio no ML com `SALE_FORMAT=Kit`, `UNITS_PER_PACK=3` e `available_quantity = floor(estoque_base/3)`.

Use a skill `playwright-cli` em sessão isolada com a conta VALIDATION — nunca dispute o Chrome do Diego via CDP.

- [ ] **Step 9: Commit**

```bash
git add src/lib/kit.ts src/lib/__tests__/kit.test.ts src/components/kit src/pages/Publicados.tsx src/lib/queries.ts
git commit -m "feat(kit): gatilho e preview de kit vinculado na tela Publicados (ADR-0151 D-2/D-4)"
```

---

## Task 8: Gatilho na tela Revisão (pré-publicação)

**Files:**
- Modify: `src/components/familia-expanded.tsx`
- Modify: `src/pages/Revisao.tsx`

**Interfaces:**
- Consumes: `DialogCriarKit` (Task 7); `useModulosHabilitados`; o sequenciamento do backend (Task 6, Step 7).
- Produces: nenhuma interface nova. Reusa 100% do diálogo da Task 7.

### Contexto obrigatório antes de editar

O gatilho da Revisão **é o mesmo diálogo** da Task 7 — a diferença é só que a base ainda não tem `ml_item_id`. A edge já trata isso (não encadeia; o worker do CREATE da base é quem enfileira). O front **não** precisa de polling nem de estado novo.

Decisão 4: os kits **não** ganham card próprio na Revisão. Eles nascem num lote dedicado (Task 6, passo 6), então já ficam fora da lista de famílias do lote da base por construção. **Não** adicione filtro na Revisão para escondê-los — confirme que eles já não aparecem, e registre isso no commit.

- [ ] **Step 1: Adicionar o gatilho no painel expandido da família**

Em `src/components/familia-expanded.tsx`, junto dos demais controles da família (perto do bloco de título/descrição, ~linha 736), acrescente um botão "Criar kits" que abre o `DialogCriarKit` com `familiaBaseId={familia.id}`.

`disabled` com as mesmas quatro condições da Task 7, Step 7, mais uma:
- `familia.status !== 'pronto'` → "A família precisa estar pronta na Revisão antes de criar kits."

Passe `kitsExistentes` consultando `familias` por `(org_id, kit_base_codigo_pai = familia.codigo_pai)`.

- [ ] **Step 2: Sinalizar o sequenciamento na Revisão**

Quando a família tiver kits vinculados `status='pronto'` e `ml_item_id is null`, mostre um badge no card:

```
🧩 2 kits aguardando a publicação deste produto
```

com tooltip: "Os kits só vão ao ar depois que este produto for publicado com sucesso. Se a publicação falhar, nenhum kit é publicado." (Decisão 2, texto verbatim do racional do ADR).

- [ ] **Step 3: Verificar em runtime real que os kits não viram card na Revisão**

Rode `pnpm dev`, crie 2 kits a partir de uma família ainda não publicada e confirme por screenshot:
1. A lista de famílias do lote da base continua com o mesmo número de cards de antes.
2. O badge "🧩 2 kits aguardando…" aparece no card da base.
3. Ao publicar a base com sucesso, os 2 kits aparecem publicados na tela Publicados poucos minutos depois, sem nenhuma ação extra.
4. Forçando falha do CREATE da base (ex.: categoria inválida), os 2 kits **continuam** sem `ml_item_id` e nenhum anúncio de kit aparece no ML.

O item 4 é o critério de aceite central da Decisão 2 — não o pule.

- [ ] **Step 4: Rodar lint e testes de front**

```bash
cd "<repo>" && pnpm lint && pnpm vitest run
```

- [ ] **Step 5: Commit**

```bash
git add src/components/familia-expanded.tsx src/pages/Revisao.tsx
git commit -m "feat(kit): gatilho de kit vinculado na Revisão, publicado só após o CREATE da base (ADR-0151 D-2)"
```

---

## Task 9: Tela Estoque — kit aparece sob a base, nunca como linha própria

**Files:**
- Create: `supabase/migrations/<timestamp>_estoque_rpc_exclui_kit.sql`
- Modify: `src/components/estoque/produto-card.tsx`
- Modify: `src/lib/produtos-saldo.ts`

**Interfaces:**
- Consumes: `familias.kit_base_codigo_pai` / `kit_multiplicador` (Task 1).
- Produces: `produtos_estoque_resumo()`, `variacoes_estoque_produto(p_codigo_pai)` e `skus_estoque_org()` deixam de listar kits como produto/SKU próprio; `variacoes_estoque_produto` passa a devolver `kits: [{ codigo_pai, multiplicador, disponivel }]` no JSON de cada produto-base.

### Contexto obrigatório antes de editar

Decisão 13: `variacoes.estoque` do kit fica em 0 para sempre e é **excluído explicitamente** de todo ponto que trata essa coluna como saldo real. As três RPCs de leitura vivem na migration `20260814181410_estoque_perf_rpc.sql` — leia-a inteira antes de reescrevê-las e **preserve** os campos que já devolve (a tela e o `dialog-entrada` dependem deles).

A alternativa de espelhar o valor calculado na coluna do kit foi **rejeitada** pelo ADR: recriaria um segundo número que pode dessincronizar da fonte de verdade — o risco do ADR-0129. Não a reintroduza "por performance".

- [ ] **Step 1: Criar a migration das RPCs de leitura**

```bash
cd "<repo>" && supabase migration new estoque_rpc_exclui_kit
```

Reescreva as três funções por `create or replace` (assinaturas idênticas — owner e ACL preservados), com estas mudanças e **nada mais**:

- `produtos_estoque_resumo()`: acrescente `and f.kit_multiplicador is null` ao filtro de famílias, tanto nos KPIs quanto na lista slim. Kit deixa de contar em `produtos`, `skus`, `unidades`, `skus_sem_estoque`, `valor_em_estoque` e `skus_sem_custo`.
- `skus_estoque_org()`: mesmo filtro. O picker do `DialogEntrada` deixa de oferecer SKU de kit — a guard da Task 5 já recusaria, mas oferecer o que sempre falha é UI ruim (e esconder na UI **não substitui** a guard; as duas coexistem, ADR-0047).
- `variacoes_estoque_produto(p_codigo_pai)`: mesmo filtro na família canônica, **mais** um campo novo no JSON de retorno, calculado ao vivo:

```sql
  -- ADR-0151 D-13: o kit não aparece como linha própria; aparece no contexto do
  -- produto-base, com o saldo virtual calculado on-the-fly. Espelhar o valor na coluna
  -- do kit foi REJEITADO: criaria um segundo número dessincronizável (risco do ADR-0129).
  -- `v.estoque` é o saldo da variação da linha corrente — kit vinculado só existe para
  -- produto de UMA variação (D-10), então é o saldo da base. NÃO some as variações: o
  -- ledger decrementa uma linha, e uma soma divergiria dele se a trava fosse afrouxada.
  'kits', coalesce((
    select jsonb_agg(jsonb_build_object(
      'codigo_pai', k.codigo_pai,
      'multiplicador', k.kit_multiplicador,
      'disponivel', floor(v.estoque::numeric / k.kit_multiplicador)
    ) order by k.kit_multiplicador)
    from (
      select distinct on (kk.codigo_pai) kk.codigo_pai, kk.kit_multiplicador
      from public.familias kk
      where kk.org_id = f.org_id and kk.kit_base_codigo_pai = p_codigo_pai
        and kk.kit_multiplicador is not null
        and kk.status in ('pronto','publicando','publicado')
      order by kk.codigo_pai, kk.criado_em desc
    ) k
  ), '[]'::jsonb)
```

`v` e `f` são os aliases de `variacoes` e `familias` já usados no corpo de `variacoes_estoque_produto` — abra a migration `20260814181410_estoque_perf_rpc.sql` e use os nomes reais; **não** renomeie nada da função existente. Valores válidos de `familia_status` (verificados): `pendente`, `processando`, `pronto`, `publicando`, `publicado`, `erro` — um rótulo digitado errado num `in (...)` não dá erro, só faz a lista nunca casar e a guard virar no-op.

- [ ] **Step 2: Aplicar e verificar contra o Postgres real**

```bash
cd "<repo>" && supabase db push && npm run db:check
```

SQL read-only confirmando owner e ACL preservados e o comportamento:

```sql
select p.proname, r.rolname as owner, p.proacl::text
from pg_proc p join pg_roles r on r.oid = p.proowner
where p.proname in ('produtos_estoque_resumo','variacoes_estoque_produto','skus_estoque_org');
```

Esperado: as três com o mesmo owner e ACL de antes (`authenticated` com execute). Se o ACL sumiu, **pare** e reconceda antes de seguir.

```sql
-- Com o kit da Task 6 criado e 10 unidades na base:
select public.variacoes_estoque_produto('<codigo_pai_base>');
```

Esperado: o JSON traz `kits: [{"codigo_pai":"...","multiplicador":3,"disponivel":3}]`, e **nenhuma** linha própria para o SKU do kit.

```sql
select public.produtos_estoque_resumo();
```

Esperado: o `codigo_pai` do kit **não** aparece na lista slim, e `produtos`/`skus` não o contam.

- [ ] **Step 3: Renderizar os kits no card do produto**

Em `src/components/estoque/produto-card.tsx`, no bloco expandido (abaixo da tabela de variações), quando `produto.kits?.length > 0`:

```
Kits vinculados
🧩 Kit de 2 — 5 disponíveis
🧩 Kit de 3 — 3 disponíveis
Calculado a partir do saldo deste produto. Os kits não têm estoque próprio.
```

Atualize o tipo de retorno em `src/lib/produtos-saldo.ts:311` para incluir `kits`.

- [ ] **Step 4: Verificar em runtime real**

`pnpm dev` → tela Estoque → confirmar por screenshot:
1. O SKU do kit **não** aparece como produto na lista nem como linha de variação.
2. O card do produto-base mostra "Kits vinculados" com a contagem correta.
3. O picker de "Dar entrada" **não** oferece o SKU do kit.
4. Dando entrada de 10 no produto-base, a contagem de kits atualiza (5 kits de 2, 3 kits de 3).

- [ ] **Step 5: Rodar tudo e commitar**

```bash
cd "<repo>" && pnpm lint && pnpm vitest run
```

```bash
git add supabase/migrations src/components/estoque/produto-card.tsx src/lib/produtos-saldo.ts
git commit -m "feat(kit): kit fora do estoque canônico, exibido sob o produto-base (ADR-0151 D-13)"
```

---

## Task 10: Alerta de oversell com atribuição de kit + exclusão do alerta de catálogo

**Files:**
- Create: `supabase/functions/_shared/notificacoes/estoque-kit.ts` (a linha do alerta vira função pura, para poder ser testada)
- Create: `supabase/functions/_shared/notificacoes/__tests__/estoque-kit.test.ts`
- Modify: `supabase/functions/sync-venda/index.ts:164-166` (o `.map()` inline que monta as linhas)
- Modify: `supabase/functions/vincular-catalogo/` (guard de kit)

**Interfaces:**
- Consumes: `vendaAcimaSaldo` com `kitCodigoPai` e `multiplicador` (Task 2); `familias.kit_multiplicador` (Task 1).
- Produces: nenhuma interface nova.

### Contexto obrigatório antes de editar

O alerta da Decisão 6 **já existe** — `vendaAcimaSaldo` e `desyncMl` são produzidos por `registrarBaixaVenda` (`_shared/estoque/baixa.ts:59,61`) e `sync-venda/index.ts:162-172` já notifica. O trabalho aqui **não é criar um alerta novo**: é fazer a mensagem dizer que a venda foi de um kit, para o operador entender por que o saldo caiu N× mais do que o número de peças que ele vê no pedido do ML.

Hoje a linha é montada inline em `sync-venda/index.ts:164-166`:

```ts
        const linhas = vendaAcimaSaldo
          .map((s) => `• ${s.codigo} — pedido de ${s.pedido} un., havia ${s.anterior}, baixou ${s.aplicado}`)
          .join('\n');
```

Extraia esse `.map()` para uma função pura em `_shared/notificacoes/estoque-kit.ts` — é a única forma de testá-la, e o `index.ts` do `sync-venda` não tem harness de teste no repo.

**Unidade da mensagem (decisão travada aqui):** `pedido` em `vendaAcimaSaldo` vem em **unidades da base** (`quantidade × multiplicador`), porque é o que `baixar_estoque` recebeu e o que `quantidade_pedida` grava no ledger. A mensagem tem de dizer as duas coisas, senão o número não bate com o pedido que o operador vê no ML.

- [ ] **Step 1: Escrever o teste da mensagem (falhando)**

Crie `supabase/functions/_shared/notificacoes/__tests__/estoque-kit.test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert';
import { linhaVendaAcimaSaldo } from '../estoque-kit.ts';

Deno.test('venda de kit acima do saldo nomeia o kit e as duas unidades', () => {
  const linha = linhaVendaAcimaSaldo({
    codigo: '00000021', pedido: 9, anterior: 4, aplicado: 4,
    kitCodigoPai: '00000020', multiplicador: 3,
  });
  // O operador vê 3 kits no pedido do ML e 9 unidades saindo do saldo da base.
  assertEquals(linha.includes('3 kit(s) de 3 un.'), true);
  assertEquals(linha.includes('9 un. do produto-base'), true);
  assertEquals(linha.includes('00000021'), true);
});

Deno.test('venda direta acima do saldo mantém exatamente o texto de hoje', () => {
  const linha = linhaVendaAcimaSaldo({
    codigo: '00000011', pedido: 9, anterior: 4, aplicado: 4,
    kitCodigoPai: null, multiplicador: 1,
  });
  assertEquals(linha, '• 00000011 — pedido de 9 un., havia 4, baixou 4');
});
```

- [ ] **Step 2: Rodar e confirmar falha, depois implementar**

```bash
cd "<repo>/supabase/functions" && deno test --allow-env --allow-net _shared/notificacoes/__tests__/estoque-kit.test.ts
```

Esperado: FALHA — `../estoque-kit.ts` não existe.

Crie `supabase/functions/_shared/notificacoes/estoque-kit.ts`:

```ts
// ADR-0151 D-6 — a linha do alerta "venda acima do saldo", ciente de kit vinculado.
//
// Oversell intra-canal é risco ACEITO nesta v1 (nenhuma reserva prévia): este alerta é toda
// a mitigação que existe. Por isso o texto precisa ser inequívoco — o operador vê N kits no
// pedido do ML e o saldo da base caiu N× mais; sem a tradução, o número parece um bug.
export interface ItemAcimaSaldo {
  codigo: string;
  /** SEMPRE em unidades da BASE (quantidade vendida × multiplicador). */
  pedido: number;
  anterior: number;
  aplicado: number;
  kitCodigoPai: string | null;
  multiplicador: number;
}

export function linhaVendaAcimaSaldo(i: ItemAcimaSaldo): string {
  if (i.kitCodigoPai == null || i.multiplicador <= 1) {
    // Texto preservado byte a byte do que sync-venda/index.ts:165 já enviava.
    return `• ${i.codigo} — pedido de ${i.pedido} un., havia ${i.anterior}, baixou ${i.aplicado}`;
  }
  const kits = Math.round(i.pedido / i.multiplicador);
  return `• ${i.codigo} (kit ${i.kitCodigoPai}) — pedido de ${kits} kit(s) de ${i.multiplicador} un. `
    + `= ${i.pedido} un. do produto-base, havia ${i.anterior}, baixou ${i.aplicado}`;
}
```

Em `sync-venda/index.ts`, substitua o `.map()` inline:

```ts
        const linhas = vendaAcimaSaldo.map(linhaVendaAcimaSaldo).join('\n');
```

com o import correspondente. **Não** mude o resto do bloco (dedupe por `reservarNotificacao`, categoria `'vendas'`, texto de rodapé).

- [ ] **Step 3: Excluir kit do alerta de catálogo no-match**

Em `supabase/functions/vincular-catalogo/`, no ponto onde a família é carregada e **antes** de qualquer opt-in ou avaliação de alerta:

```ts
  // ADR-0151 D-5: kit vinculado publica sem GTIN por design, então o catálogo SEMPRE o
  // classifica como divergente (sem_produto/nao_elegivel). Alertar aqui seria ruído
  // garantido, uma vez por publicação de kit. Risco aceito e registrado no ADR: em
  // categoria onde o ML EXIGE catálogo, ele pode pausar o kit sem aviso nosso.
  if (familia.kit_multiplicador != null) {
    return { status: 200, body: { ok: true, skip: 'kit vinculado — sem catálogo por design' } };
  }
```

**Não** mude a assinatura nem o comportamento de `deveAlertarCatalogoNoMatch` (`_shared/ml/catalogo.ts:445`) — ela é pura e usada em outros caminhos. O guard é no worker.

Adicione `kit_multiplicador` ao select da família nesse worker.

- [ ] **Step 4: Testar a exclusão**

```ts
Deno.test('vincular-catalogo pula família de kit vinculado', async () => {
  const r = await processarVinculacao(depsComFamilia({ kit_multiplicador: 3 }), { familia_id: 'f-k' });
  assertEquals(r.status, 200);
  assertEquals(String(r.body.skip).includes('kit vinculado'), true);
});
```

- [ ] **Step 5: Rodar tudo e commitar**

```bash
cd "<repo>/supabase/functions" && deno test --allow-env --allow-net _shared/notificacoes/__tests__/ vincular-catalogo/__tests__/
cd "<repo>" && pnpm lint
```

```bash
git add supabase/functions/_shared/notificacoes supabase/functions/sync-venda supabase/functions/vincular-catalogo
git commit -m "feat(kit): alerta de oversell atribui a venda ao kit e catálogo ignora kits (ADR-0151 D-5/D-6)"
```

---

## Task 11: Documentação, verificação completa e deploy

**Files:**
- Modify: `docs/reference/modelo-de-dados.md`
- Modify: `docs/reference/edge-functions.md`
- Modify: `docs/decisions/0151-kit-vinculado-a-partir-de-produto-existente.md` (seção "Implementação")
- Modify: `docs/TASKS.md`
- Modify: `obsidian-vault/04-Decisões/Índice de ADRs.md` e `obsidian-vault/06-Roadmap/Sprint Atual.md`
- Verify: `docs/reference/glossario.md` (Kit / Kit vinculado — **já existem**, só conferir)

**Interfaces:** nenhuma. Task de fechamento.

- [ ] **Step 1: Atualizar `docs/reference/modelo-de-dados.md`**

Na seção `familias`, acrescente ao grupo de colunas:

```markdown
- **Kit vinculado (ADR-0151):** `kit_base_codigo_pai text` (nullable) + `kit_multiplicador smallint`
  (nullable, check 2–6), com `check` de par completo (as duas nulas ou as duas preenchidas) e
  índice parcial `familias_kit_base_idx (org_id, kit_base_codigo_pai) where kit_multiplicador is
  not null`. A chave de vínculo é `(org_id, kit_base_codigo_pai)`, **não** `familias.id` — a base
  ganha linha nova a cada lote de UPDATE e só `codigo_pai` é estável. `kit_multiplicador is not
  null` é o predicado "esta família é um kit vinculado" em todo o código.
  *Migration `<ts>_kit_vinculado_schema.sql`.*
```

Na seção `estoque_movimentos`, acrescente às colunas:

```markdown
**`origem_kit_codigo_pai`** / **`origem_kit_multiplicador`** (ADR-0151 D-6: auditoria de que o
débito veio da venda de um kit, não de venda direta — colunas nuláveis, **não** um motivo novo,
porque motivo novo quebraria `estornar_estoque`, que só repõe `where motivo='venda'`),
Não há coluna de "anúncio de origem": a Decisão 7 foi revisada para **não** excluir anúncio nenhum
quando há kit vinculado (o push é absoluto e recalculado, então reempurrar tudo dá o mesmo
resultado por 1-2 chamadas de API a mais).
```

Na seção Estoque, acrescente às guards:

```markdown
**Kit vinculado (ADR-0151, migration `<ts>_kit_vinculado_guards.sql`):** `registrar_entrada` e
`ajustar_estoque` recusam LOUD (`23514`) SKU que resolve para família com `kit_multiplicador is not
null` — o kit não tem saldo próprio (D-9). O trigger `variacoes_bloquear_extra_com_kit` recusa
INSERT de variação adicional numa família cuja base tem kit vinculado ativo (D-10), e
`familias_bloquear_remocao_com_kit` recusa apagar a última linha de `familias` de uma base com kit
vivo (D-14). As RPCs de leitura (`produtos_estoque_resumo`, `variacoes_estoque_produto`,
`skus_estoque_org`) excluem kits e devolvem, no produto-base, o array `kits` com
`floor(estoque_base/N)` calculado ao vivo (D-13).
```

- [ ] **Step 2: Atualizar `docs/reference/edge-functions.md`**

Acrescente `criar-kit-vinculado` (POST, admin-only, `exigirModulo('estoque')`, cria as famílias de kit e encadeia `publicar-familias` só quando a base já tem `ml_item_id`) e registre as mudanças em `publish-familia-ml`, `update-familia-ml`, `sincronizar-estoque`, `vincular-catalogo`, `remover-publicado`, `sync-venda`.

- [ ] **Step 3: Acrescentar a seção "Implementação" ao ADR-0151**

Registre, no formato dos ADRs 0094/0129, os desvios conscientes deste plano em relação ao texto do ADR:

1. **Decisão 8 nomeia `_shared/ml/atualizar.ts`**, mas esse arquivo não lê `v.estoque` — `montarVariacoesUpdate` recebe `desejados`. A correção mora nos dois workers (`publish-familia-ml/processar.ts`, `update-familia-ml/processar.ts`), via `aplicarEstoqueDerivado`.
2. **Decisão 4 diz que o título "herda o slot `quantidade`" do ADR-0099**, mas os slots não são persistidos em `familias` (só `titulo_ml` e `titulo_descartes`) e o montador só roda dentro de `process-familia`, que a Decisão 3 proíbe para o kit. Implementado como composição do sufixo "Kit N Unidades" sobre o `titulo_ml` da base, com corte em fronteira de palavra respeitando `TITULO_MAX=60` e edição pelo operador no preview.
3. **`chave_cadastro`** não é mencionada no ADR, mas é obrigatória pelo trigger `validar_familia_no_tenant` em lote `origem='manual'` — e vira a idempotência da submissão (ADR-0096 D-9).
4. **Lote dedicado por submissão**, e não o lote manual aberto, para os kits não virarem card na Revisão da base (D-4) — mesmo desvio 2 do ADR-0129.
5. **`reconciliar-estoque` não mudou**: o fan-out por família dentro de `processarSincronizacao` já alcança base + kits, cumprindo o terceiro bullet da Decisão 13 sem código novo naquele worker.
6. **A anotação de origem no ledger (`origem_kit_*`) é não-atômica** (UPDATE depois da RPC), para não mudar a assinatura de `baixar_estoque` e ter de refazer a dança de owner/grants do `estoque_rpc_executor`. É só auditoria: nada de push depende dela, então falhar custa uma linha de ledger sem atribuição de kit e um alerta com texto genérico.
7. **`aplicarKitNosAtributos` falha LOUD (400)** quando a categoria do ML não expõe `SALE_FORMAT=Kit`. O ADR-0071 faz no-op nesse caso; aqui um no-op publicaria N unidades ao preço de uma.
8. **A Decisão 7 revisada custou zero linhas fora do worker.** A simplificação (reempurrar tudo em vez de excluir o anúncio de origem) tirou do plano uma coluna no `estoque_movimentos`, um campo em `SincronizarEstoqueJob` e o plumbing correspondente em `lerPushPendente`/`despacharPushPendente`. A decisão vive inteira numa linha de `sincronizar-estoque/processar.ts` (`const exclusao = kits.length > 0 ? null : canal_origem`). Registrado aqui porque a versão anterior deste plano tinha esse plumbing e alguém pode encontrá-la no histórico do git.
9. **`processarSincronizacao` redireciona job com `codigo_pai` de kit para a base.** Defensivo, não previsto no ADR: nenhum caminho grava o `codigo_pai` de um kit no ledger, mas se acontecesse o push mandaria `variacoes.estoque = 0` (a coluna crua do kit) para um anúncio vivo no ML.

- [ ] **Step 4: Atualizar `docs/TASKS.md` e o obsidian-vault**

`TASKS.md`: marcar o épico Kit vinculado como concluído, com a data e o link do plano.
`obsidian-vault/04-Decisões/Índice de ADRs.md`: acrescentar/atualizar a linha do ADR-0151 (de "design fechado" para "implementado").
`obsidian-vault/06-Roadmap/Sprint Atual.md`: refletir o épico concluído.
`docs/reference/glossario.md`: **conferir** que as entradas "Kit" e "Kit vinculado" continuam corretas — elas **já existem** (Decisão 16 já estava feita). Não duplicar.

- [ ] **Step 5: Verificação completa — os quatro passos do pré-push**

O build local não reproduz o CI se algum destes for pulado:

```bash
cd "<repo>" && pnpm lint
cd "<repo>" && pnpm vitest run
cd "<repo>" && pnpm exec tsc -b --force
cd "<repo>" && pnpm docs:links
```

Esperado: os quatro verdes. `tsc -b` **sem** `--force` usa cache incremental e já custou um ciclo de CI; `docs:links` pega link quebrado nos docs desta task.

Rode também as duas árvores de teste — grep ancorado só em `src/` é cego para metade:

```bash
cd "<repo>" && pnpm vitest run src/ tests/
cd "<repo>/supabase/functions" && deno test --allow-env --allow-net --allow-read
```

Se algo falhar fora do seu diff, **prove** que é pré-existente rodando o mesmo teste em `origin/main` — não infira do diff. Suspeite de teste com data fixa cruzando janela temporal antes de chamar de flake.

- [ ] **Step 6: Deploy das Edge Functions — obrigatório e explícito**

Push/merge na `main` **não** deploya Edge Functions. O diff desta feature toca `_shared/`, então o blast radius é grande. Deploy uma a uma pela CLI completa e confira a versão pós-deploy de cada:

```bash
cd "<repo>"
supabase functions deploy criar-kit-vinculado
supabase functions deploy sincronizar-estoque
supabase functions deploy reconciliar-estoque
supabase functions deploy publish-familia-ml
supabase functions deploy update-familia-ml
supabase functions deploy publicar-split-ml
supabase functions deploy publicar-familias
supabase functions deploy sync-venda
supabase functions deploy sync-devolucao
supabase functions deploy vincular-catalogo
supabase functions deploy retentar-catalogo
supabase functions deploy remover-publicado
supabase functions deploy entrada-estoque
supabase functions deploy ajustar-estoque
supabase functions deploy cadastrar-produto
supabase functions deploy adicionar-variacoes-familia
supabase functions deploy excluir-produto
supabase functions deploy excluir-lote
```

Antes de rodar, **recalcule a lista**: qualquer função que importe `_shared/estoque/*`, `_shared/queue.ts`, `_shared/categoria/atributos.ts` ou `_shared/ml/publicar.ts` precisa entrar.

```bash
cd "<repo>" && grep -rln "_shared/estoque/\|_shared/queue.ts\|categoria/atributos.ts\|ml/publicar.ts" supabase/functions/ --include=*.ts | grep -v "^supabase/functions/_shared" | cut -d/ -f3 | sort -u
```

Confirme a versão de cada função depois do deploy (`supabase functions list`). Uma função esquecida roda a versão antiga de `_shared/` e o kit publica com estoque 0.

- [ ] **Step 7: Commit final**

```bash
git add docs/ obsidian-vault/
git commit -m "docs(kit): modelo de dados, edge functions, ADR-0151 implementado e roadmap"
```

---

## Cobertura das 16 decisões do ADR-0151

Tabela de auto-revisão. Cada decisão do ADR aponta para a(s) task(s) que a implementam.

| # | Decisão (ADR-0151) | Task(s) |
|---|---|---|
| 1 | Mecanismo de publicação: `SALE_FORMAT=Kit` + `UNITS_PER_PACK`, família nova por tamanho, colunas `kit_base_codigo_pai`/`kit_multiplicador`, resolvedor `resolverOrigemEstoque` | **1** (schema + resolvedor), **6** (atributos, código gerado, família nova) |
| 2 | Dois pontos de entrada; CREATE da base primeiro, kits só depois de confirmar | **6** (sequenciamento no worker), **7** (Publicados), **8** (Revisão) |
| 3 | Kit não passa por `process-familia` — copia o que já foi resolvido | **6** (`status='pronto'`, sem `enfileirarFamilia`, `aplicarKitNosAtributos`) |
| 4 | Revisão em lote sem card por kit; preview editável; custo e peso derivados × N | **6** (derivação e lote dedicado), **7** (preview), **8** (sem card na Revisão) |
| 5 | GTIN: publica sem, nunca herda o da base | **6** (builder da variação), **7** (campo vazio no preview), **10** (fora do alerta de catálogo) |
| 6 | Estoque 100% vinculado: baixa e estorno no ledger da base, `× N`; alerta de oversell | **2** (baixa/estorno/anotação), **10** (alerta com atribuição de kit) |
| 7 | Push sem exclusão nenhuma quando há kit vinculado (base + todos os tamanhos, sempre) | **3** (fan-out por família + `exclusao = kits.length > 0 ? null : canal_origem`). Nada no ledger, no outbox nem no job |
| 8 | CREATE/UPDATE usam o valor calculado, não a coluna crua | **4** (`aplicarEstoqueDerivado` nos dois workers) |
| 9 | Escrita direta no SKU do kit bloqueada no banco | **5** (`registrar_entrada` e `ajustar_estoque`), **9** (picker não oferece) |
| 10 | v1: só produto sem cor + trava contra adicionar cor com kit vivo | **5** (trigger `variacoes_bloquear_extra_com_kit`), **6** (recusa `base_multivariacao`), **7** (botão desabilitado) |
| 11 | Vínculo automático é só de estoque — edição da base não propaga | **6** (kit nasce com cópia, sem nenhum caminho de propagação — nada a implementar; a ausência é a decisão) |
| 12 | Kit exige o módulo Estoque habilitado | **6** (`exigirModulo` na edge), **7**/**8** (gate na UI) |
| 13 | `variacoes.estoque` do kit fora do estoque canônico, nunca espelhado | **9** (três RPCs de leitura + card), **3** (fan-out cobre a reconciliação — `reconciliar-estoque` não muda) |
| 14 | Remover a base com kit vivo é bloqueado | **5** (trigger + guard de app em `remover-publicado`) |
| 15 | Reativação por reposição (ADR-0111) atravessa famílias | **3** (o fan-out por família faz o job com `reativar` alcançar o anúncio de cada kit; `reativarSePausado` recebe o `itemExternoId` do kit e o saldo derivado > 0 é a condição — nenhuma mudança em `reativarSePausado`) |
| 16 | Terminologia nova no glossário | **11** (conferir — as entradas "Kit" e "Kit vinculado" **já existem** em `docs/reference/glossario.md`) |

### Riscos aceitos, rastreados

| Risco | Onde aparece no plano |
|---|---|
| Oversell intra-canal (sem reserva prévia) | Global Constraints §1; mitigado só pelo alerta da Task 10 |
| Pausa silenciosa do ML por falta de catálogo | Global Constraints §2; Task 10 Step 3 (comentário no guard) |
| Buraco na sequência de `proximo_codigo_produto` | Global Constraints §3; Task 6 Step 5 |
| Push por evento passa de 1 para até 6 chamadas — inclusive para o anúncio que originou o evento, porque a Decisão 7 revisada não exclui nenhum | Task 3 (serializado pela fila `estoque-{orgId}` existente) |
| Anotação de origem no ledger não-atômica (só auditoria) | Task 2, contexto obrigatório; ADR-0151 seção Implementação item 6 |
