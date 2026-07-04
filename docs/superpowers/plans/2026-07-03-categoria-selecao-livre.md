# Seletor de Categoria Livre — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Destravar famílias que caem em `categoria_ml_id=null` (ex.: "BAINHA INSTANTÂNEA 4MT UND", lote 51) trocando o seletor manual de 4 tipos fixos por uma busca livre no `domain_discovery` do ML, com a categoria do concorrente exibida como sugestão não-vinculante.

**Architecture:** Reaproveita 100% do código já existente (`buscarCategoriaPreditor`, `lerSchemaAtributos`, `montarAtributosBase`, `atributosFaltantesGenerico`, `preencherAtributosClosedSet`). O único código novo é: (1) extrair o branch genérico do `process-familia` para uma função compartilhada testável (mesmo padrão de injeção de deps do `resolver.ts`), (2) generalizar `definir-categoria-familia` para aceitar categoria livre em vez de só os 4 tipos, (3) uma ação nova `buscar-categoria` no edge function `atributos-familia` já existente, (4) trocar o `<Select>` de 4 opções por busca no `CardCategoria`.

**Tech Stack:** Deno edge functions (Supabase), React + TanStack Query, vitest, shadcn/ui.

## Global Constraints

- Migrations: **só** `supabase migration new` + `supabase db push`. Nunca `apply_migration`/painel (ADR-0043).
- Testes rodam em `tests/**` e `supabase/**/__tests__` (vitest). `src/lib/__tests__` **não** roda — não criar testes lá.
- Zero dependência nova (sem `cmdk`/combobox lib — busca é `<Input>` + lista de botões).
- `definir-categoria-familia` muda de contrato (`{tipo}` → `{categoria_ml_id, categoria_nome}`). App de deployment único (frontend+backend sempre no mesmo deploy) — sem consumidor externo, decisão registrada no ADR, não é regressão.
- Todo código novo mantém comentários em português, no estilo do arquivo que edita (comentário só quando o "porquê" não é óbvio — padrão já usado em `resolver.ts`/`atributos.ts`).
- Branch de trabalho: `fix-categoria-selecao-livre`, worktree em `.worktrees/fix-categoria-selecao-livre` (já criada, baseline 142 arquivos/1160 testes passando).

---

### Task 1: ADR-0057

**Files:**
- Create: `docs/decisions/0057-categoria-selecao-livre-e-sugestao-concorrente.md`

**Interfaces:** nenhuma (documento).

- [ ] **Step 1: Escrever o ADR**

```markdown
# ADR-0057 — Categoria de seleção livre (busca no preditor) + sugestão não-vinculante do concorrente

**Status:** Aceito
**Data:** 2026-07-03
**Decisores:** Diego
**Relaciona:** estende [ADR-0022](0022-categoria-cola-e-seletor-manual.md) (seletor manual — pendência nunca fechada),
[ADR-0026](0026-generalizacao-categorizacao-atributos-por-ia.md) (E3 — schema dinâmico/preditor),
[ADR-0051](0051-tipo-aviamento-derivado-da-categoria-do-preditor.md) (limite conhecido: "operador ainda não tem
seletor de categoria livre"), [ADR-0054](0054-categoria-titulo-tipo-produto-generico.md) (Fase 2 adiada: por que
a categoria do concorrente não pode ser aplicada automaticamente)

## Contexto

Investigação do caso real "BAINHA INSTANTÂNEA 4MT UND" (lote 51, mesma família do lote 50 do ADR-0054):
confirmado no banco que a família fica com `categoria_ml_id=null`, `tipo_aviamento='outro'`, `tipo_origem='manual'`
— o resolver automático está correto (nunca aceita "Outros" sozinho, ADR-0054), mas o escape hatch manual
(`CardCategoria` + `definir-categoria-familia`) só oferece 4 tipos fixos (`linha/fita/botao/cola`,
`CATEGORIAS_MANUAIS`). "Bainha" não é nenhum dos 4 — a família fica travada para sempre.

Essa lacuna está documentada desde o ADR-0022 (11/06) como pendência e nunca foi fechada: cada ADR seguinte
(0026, 0051, 0054) melhorou o resolver *automático* e deixou o escape *manual* intacto — o gargalo real sempre
foi o seletor manual.

Erro relatado em paralelo: a categoria do concorrente (já extraída em `_shared/concorrencia/parse.ts` como
`ofertas.category_id`) nunca chega ao operador — é descartada após o cálculo de preço. O ADR-0054 (Fase 2) já
testou aplicar essa categoria automaticamente **para esse mesmo produto** e o resultado foi uma categoria absurda
("Brinquedos de Pegadinhas", colisão de GTIN/catálogo entre concorrentes) — por isso nunca pode ser aplicada sem
confirmação humana.

## Decisão

1. **Busca livre substitui o seletor de 4 tipos.** `CardCategoria` ganha um campo de busca que chama
   `buscarCategoriaPreditor` (já existe, cacheado 30d no Redis) via uma nova ação `buscar-categoria` no edge
   function `atributos-familia` (já existente — reaproveita autenticação/RLS, não cria function nova). O operador
   digita, vê candidatos reais do ML e escolhe.
2. **`definir-categoria-familia` generaliza o contrato.** Passa a aceitar `{familia_id, categoria_ml_id,
   categoria_nome}` em vez de `{familia_id, tipo}`. Internamente resolve `tipoParaCategoria(categoria_ml_id)`
   (lookup reverso já existente): se a categoria escolhida bater num dos 4 tipos conhecidos, usa o caminho
   curado (`montarAtributosML`, zero mudança de comportamento); senão usa a nova função compartilhada
   `resolverAtributosGenericos` (extraída do branch genérico do `process-familia`, mesmo fluxo schema→IA→
   faltantes que já roda automaticamente hoje via preditor). **Decisão:** não manter o input `{tipo}` antigo —
   a busca livre já cobre linha/fita/botão/cola (aparecem nos resultados da própria busca) e o app tem
   frontend+backend num único deploy, sem consumidor externo do contrato antigo.
3. **Sugestão do concorrente, nunca automática.** Nova coluna `familias.concorrencia_categoria_id` persiste o
   `category_id` já obtido (hoje descartado) em `process-familia`. Na busca, se a família tiver essa coluna
   preenchida, o backend resolve o nome real da categoria (`GET /categories/{id}`, nova função
   `buscarNomeCategoria`, cacheada) e devolve como **sugestão destacada** — um card clicável junto aos
   resultados, nunca aplicado sem o operador clicar.
4. **Extração de `resolverAtributosGenericos`** evita duplicar a lógica de schema/atributos entre o fluxo
   automático (`process-familia`) e o manual (`definir-categoria-familia`) — mesmo princípio já usado no
   projeto (`definir-categoria-familia` já reusa `montarAtributosML` do `_shared` para não duplicar no
   frontend). Injeta `lerSchema`/`llm` como deps (mesmo padrão de `resolver.ts`), testável sem rede.

## Consequências

**Boas:**
- Fecha a classe de bug para **qualquer** produto fora dos 4 aviamentos conhecidos (não só bainha) — a busca
  aceita qualquer categoria real do ML, não uma lista fechada.
- Zero tabela nova além de 1 coluna aditiva; zero dependência nova.
- Sinal do concorrente deixa de ser jogado fora — vira ajuda visível, sem repetir o erro do ADR-0054 (nunca
  aceito às cegas).

**Tradeoffs aceitos:**
- Quebra de contrato do `definir-categoria-familia` (`{tipo}` → `{categoria_ml_id, categoria_nome}`) — aceitável
  por ser deploy único, sem consumidor externo.
- 1 chamada de rede a mais por busca (`domain_discovery` com a query do operador) — mesma característica das
  chamadas já existentes (cacheada, barata).
- Categorias genuinamente sem opção específica no ML (ex.: "Outros") continuam exigindo confirmação humana — não
  é regressão, é o comportamento correto já estabelecido no ADR-0054.

## Como reverter

`resolverAtributosGenericos` é só extração (mesmo comportamento do branch antigo do `process-familia` — reverter
= inline de volta). `definir-categoria-familia` e o front não têm caminho de rollback automático por não haver
consumidor do contrato antigo; reverter = checkout do commit anterior nos 2 arquivos.
```

- [ ] **Step 2: Commit**

```bash
git add docs/decisions/0057-categoria-selecao-livre-e-sugestao-concorrente.md
git commit -m "docs(adr): categoria de seleção livre + sugestão não-vinculante do concorrente (ADR-0057)"
```

---

### Task 2: Migration — `familias.concorrencia_categoria_id`

**Files:**
- Create: migration via CLI (não escrever o arquivo manualmente — usar o comando abaixo, que já cria com o
  timestamp correto).

**Interfaces:**
- Produces: coluna `familias.concorrencia_categoria_id text null`, consumida pela Task 3 (persistência) e Task 6
  (leitura na busca).

- [ ] **Step 1: Criar a migration**

```bash
cd "/Users/diego/Desktop/IA/Anuncios MktPlace/.worktrees/fix-categoria-selecao-livre"
supabase migration new concorrencia_categoria_id
```

- [ ] **Step 2: Escrever o SQL** (editar o arquivo gerado em `supabase/migrations/<timestamp>_concorrencia_categoria_id.sql`)

```sql
-- ============================================================================
-- category_id do concorrente (ADR-0057) — hoje calculado em process-familia e
-- descartado; persistido para virar sugestão não-vinculante no seletor de categoria.
-- ============================================================================

alter table public.familias
  add column if not exists concorrencia_categoria_id text;
```

- [ ] **Step 3: Aplicar e validar**

```bash
supabase db push
npm run db:check
```

Expected: push aplica sem erro; `db:check` verde.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): concorrencia_categoria_id em familias (ADR-0057)"
```

---

### Task 3: `resolverAtributosGenericos` — extrair o branch genérico (TDD)

**Files:**
- Create: `supabase/functions/_shared/categoria/resolver-atributos-genericos.ts`
- Create: `supabase/functions/_shared/categoria/__tests__/resolver-atributos-genericos.test.ts`
- Modify: `supabase/functions/process-familia/index.ts:16` (import), `:204-227` (usar a função extraída)

**Interfaces:**
- Consumes: `AtributoSchema` (`./schema.ts`), `AtributoML`, `montarAtributosBase`, `atributosFaltantesGenerico`,
  `preencherUnitsPerPack`, `FALTANTE_ATRIBUTOS_NAO_VALIDADOS` (`./atributos.ts`), `AtributoAlvo`, `InputAtributos`
  (`../ai/atributos-llm-core.ts`).
- Produces: `resolverAtributosGenericos(categoriaMlId: string, input: InputAtributosGenericos, deps:
  DepsAtributosGenericos): Promise<{ atributosMl: AtributoML[]; faltantes: string[] }>` — consumida pela Task 4
  (process-familia) e Task 5 (definir-categoria-familia).

- [ ] **Step 1: Escrever o teste (falhando)**

```typescript
// supabase/functions/_shared/categoria/__tests__/resolver-atributos-genericos.test.ts
import { describe, it, expect, vi } from 'vitest';
import { resolverAtributosGenericos } from '../resolver-atributos-genericos';
import type { AtributoSchema } from '../schema';

const A = (o: Partial<AtributoSchema> & { id: string }): AtributoSchema => ({
  nome: o.id, required: false, conditionalRequired: false, valueType: 'string', valores: [], allowedUnits: [], tags: [], ...o,
});
const SCHEMA: AtributoSchema[] = [
  A({ id: 'BRAND', nome: 'Marca', required: true }),
  A({ id: 'MODEL', nome: 'Modelo', required: true }),
  A({ id: 'VOLTAGE', nome: 'Voltagem', conditionalRequired: true, valueType: 'list', valores: [{ id: '1', nome: '110V' }] }),
];

describe('resolverAtributosGenericos', () => {
  it('monta base + fecha closed-set pela IA + calcula faltantes', async () => {
    const llm = vi.fn().mockResolvedValue({ VOLTAGE: '1' });
    const r = await resolverAtributosGenericos(
      'MLB189007',
      { nome: 'Furadeira X 650W', descricao: undefined, fornecedor: 'Bosch' },
      { lerSchema: async () => SCHEMA, llm },
    );
    expect(r.atributosMl).toEqual(expect.arrayContaining([
      { id: 'BRAND', value_name: 'Bosch' },
      { id: 'MODEL', value_name: 'Furadeira X 650W' },
      { id: 'VOLTAGE', value_id: '1' },
    ]));
    expect(r.faltantes).toEqual([]);
  });

  it('schema vazio → faltante-sentinela (bloqueio seguro, ADR-0051)', async () => {
    const r = await resolverAtributosGenericos(
      'MLB000000',
      { nome: 'Produto qualquer' },
      { lerSchema: async () => [], llm: async () => ({}) },
    );
    expect(r.atributosMl).toEqual([]);
    expect(r.faltantes).toEqual(['atributos da categoria (não validados — revise)']);
  });

  it('lerSchema lança (sem token/rede) → faltante-sentinela, não propaga o erro', async () => {
    const r = await resolverAtributosGenericos(
      'MLB189007',
      { nome: 'Furadeira X' },
      { lerSchema: async () => { throw new Error('sem token'); }, llm: async () => ({}) },
    );
    expect(r.faltantes).toEqual(['atributos da categoria (não validados — revise)']);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd "/Users/diego/Desktop/IA/Anuncios MktPlace/.worktrees/fix-categoria-selecao-livre"
pnpm vitest run supabase/functions/_shared/categoria/__tests__/resolver-atributos-genericos.test.ts
```

Expected: FAIL — `Cannot find module '../resolver-atributos-genericos'`.

- [ ] **Step 3: Implementar** (extração literal do branch `process-familia/index.ts:204-227`)

```typescript
// supabase/functions/_shared/categoria/resolver-atributos-genericos.ts
import type { AtributoSchema } from './schema.ts';
import {
  montarAtributosBase,
  atributosFaltantesGenerico,
  preencherUnitsPerPack,
  FALTANTE_ATRIBUTOS_NAO_VALIDADOS,
  type AtributoML,
} from './atributos.ts';
import type { AtributoAlvo, InputAtributos } from '../ai/atributos-llm-core.ts';
import { preencherAtributosClosedSet } from '../ai/atributos-llm.ts';

export interface InputAtributosGenericos {
  nome: string;
  descricao?: string;
  fornecedor?: string;
}

export interface DepsAtributosGenericos {
  lerSchema: (categoriaId: string) => Promise<AtributoSchema[]>;
  llm: (input: InputAtributos, alvos: AtributoAlvo[]) => Promise<Record<string, string>>;
}

export interface ResultadoAtributosGenericos {
  atributosMl: AtributoML[];
  faltantes: string[];
}

/**
 * Categoria genérica (não-aviamento): valida obrigatórios contra o schema real da API (E3/E4).
 * Regra de ouro do SaaS (ADR-0051): se não der para validar (schema indisponível/vazio/erro), não
 * publica às cegas — devolve faltante-sentinela p/ travar na Revisão. Extraído de process-familia
 * p/ ser reusado também pelo seletor manual de categoria livre (ADR-0057), sem duplicar lógica.
 */
export async function resolverAtributosGenericos(
  categoriaMlId: string,
  input: InputAtributosGenericos,
  deps: DepsAtributosGenericos,
): Promise<ResultadoAtributosGenericos> {
  try {
    const schema = await deps.lerSchema(categoriaMlId);
    if (!schema || schema.length === 0) throw new Error('schema vazio da categoria');
    const base = montarAtributosBase(schema, input.nome, input.fornecedor);
    let atributosMl = await preencherAtributosClosedSet(
      schema, base, { nome: input.nome, descricao: input.descricao }, deps.llm,
    );
    atributosMl = preencherUnitsPerPack(schema, atributosMl, input.nome, input.descricao);
    const faltantes = atributosFaltantesGenerico(atributosMl, schema);
    return { atributosMl, faltantes };
  } catch (e) {
    console.error('resolverAtributosGenericos falhou:', e);
    return { atributosMl: [], faltantes: [FALTANTE_ATRIBUTOS_NAO_VALIDADOS] };
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm vitest run supabase/functions/_shared/categoria/__tests__/resolver-atributos-genericos.test.ts
```

Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/categoria/resolver-atributos-genericos.ts supabase/functions/_shared/categoria/__tests__/resolver-atributos-genericos.test.ts
git commit -m "feat(categoria): extrai resolverAtributosGenericos p/ reuso (ADR-0057)"
```

---

### Task 4: `process-familia` usa a função extraída + persiste `concorrencia_categoria_id`

**Files:**
- Modify: `supabase/functions/process-familia/index.ts`

**Interfaces:**
- Consumes: `resolverAtributosGenericos` (Task 3), `concorrencia.ofertas?.category_id` (já existe em
  `ResultadoConcorrencia`, `_shared/concorrencia/tipos.ts`).

- [ ] **Step 1: Trocar o import da linha 16**

Old (linha 16):
```typescript
import { montarAtributosML, montarAtributosBase, atributosFaltantesGenerico, preencherUnitsPerPack, categoriaParaTipo, FALTANTE_ATRIBUTOS_NAO_VALIDADOS, type AtributoML } from '../_shared/categoria/atributos.ts';
```

New:
```typescript
import { montarAtributosML, categoriaParaTipo, type AtributoML } from '../_shared/categoria/atributos.ts';
import { resolverAtributosGenericos } from '../_shared/categoria/resolver-atributos-genericos.ts';
```

- [ ] **Step 2: Substituir o branch genérico (linhas ~204-228)**

Old:
```typescript
    } else if (categoriaMlId) {
      // Categoria genérica (não-aviamento): validar obrigatórios contra o schema da API (E3/E4).
      // Regra de ouro do SaaS: se NÃO der para validar (sem token, schema indisponível/vazio ou
      // erro da IA), não publicar às cegas — persiste faltante-sentinela p/ travar na Revisão.
      try {
        if (!token) throw new Error('sem token p/ ler schema da categoria');
        const schema = await lerSchemaAtributos(token, categoriaMlId);
        // Categoria real do ML sempre traz atributos no schema (mesmo poucos required); vazio ⇒ erro de leitura.
        if (!schema || schema.length === 0) throw new Error('schema vazio da categoria');
        const base = montarAtributosBase(schema, claimed.nome_pai, fornecedor);
        // E4: IA preenche os obrigatórios closed-set (ex.: VOLTAGE) escolhendo dentro de values[].
        atributosMl = await preencherAtributosClosedSet(
          schema, base,
          { nome: claimed.nome_pai, descricao: claimed.descricao_pai ?? undefined },
          desempatarAtributosLLM,
        );
        // UNITS_PER_PACK é numérico (sem closed-set) → a IA não cobre; extrai do nome/descrição.
        atributosMl = preencherUnitsPerPack(schema, atributosMl, claimed.nome_pai, claimed.descricao_pai ?? undefined);
        faltantes = atributosFaltantesGenerico(atributosMl, schema);
      } catch (e) {
        console.error('schema/atributos falhou:', e);
        atributosMl = [];
        faltantes = [FALTANTE_ATRIBUTOS_NAO_VALIDADOS];
      }
    }
```

New:
```typescript
    } else if (categoriaMlId) {
      // Categoria genérica (não-aviamento): _shared/categoria/resolver-atributos-genericos.ts
      // (mesmo fluxo reusado pelo seletor manual de categoria livre, ADR-0057).
      const r = await resolverAtributosGenericos(
        categoriaMlId,
        { nome: claimed.nome_pai, descricao: claimed.descricao_pai ?? undefined, fornecedor },
        {
          lerSchema: (id) => {
            if (!token) return Promise.reject(new Error('sem token p/ ler schema da categoria'));
            return lerSchemaAtributos(token, id);
          },
          llm: desempatarAtributosLLM,
        },
      );
      atributosMl = r.atributosMl;
      faltantes = r.faltantes;
    }
```

- [ ] **Step 3: Persistir `concorrencia_categoria_id`** no update final (perto de `concorrencia_classe`,
  ~linha 319)

Old:
```typescript
      concorrencia_vendedores: concorrencia.vendedores,
      concorrencia_preco_min: concorrencia.preco_min,
      concorrencia_origem: concorrencia.origem,
      concorrencia_classe: concorrencia.classe,
```

New:
```typescript
      concorrencia_vendedores: concorrencia.vendedores,
      concorrencia_preco_min: concorrencia.preco_min,
      concorrencia_origem: concorrencia.origem,
      concorrencia_classe: concorrencia.classe,
      concorrencia_categoria_id: concorrencia.ofertas?.category_id ?? null,
```

- [ ] **Step 4: Rodar a suíte inteira (garante zero regressão no fluxo automático)**

```bash
pnpm test
```

Expected: 142+ arquivos, 1160+ testes, 0 falhas (mesmo baseline + os 3 novos da Task 3).

- [ ] **Step 5: Typecheck**

```bash
pnpm build
```

Expected: sem erro de tipo (imports não utilizados removidos: `lerSchemaAtributos`, `montarAtributosBase`,
`atributosFaltantesGenerico`, `preencherUnitsPerPack`, `preencherAtributosClosedSet`,
`FALTANTE_ATRIBUTOS_NAO_VALIDADOS` continuam usados no branch curado? — conferir: `preencherUnitsPerPack` e
`preencherAtributosClosedSet` também são usados no branch curado (linhas ~196-201, tipo conhecido) — **manter**
esses 2 imports de `atributos.ts`/`ai/atributos-llm.ts`; só remover o que ficou 100% órfão).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/process-familia/index.ts
git commit -m "refactor(process-familia): usa resolverAtributosGenericos + persiste concorrencia_categoria_id"
```

---

### Task 5: Generalizar `definir-categoria-familia`

**Files:**
- Modify: `supabase/functions/definir-categoria-familia/index.ts`

**Interfaces:**
- Consumes: `resolverAtributosGenericos` (Task 3), `tipoParaCategoria`, `categoriaParaTipo`, `montarAtributosML`
  (`_shared/categoria/atributos.ts`), `getValidAccessToken` (`_shared/ml/token.ts`), `lerSchemaAtributos`
  (`_shared/categoria/schema.ts`), `desempatarAtributosLLM` (`_shared/ai/atributos-llm.ts`).
- Produces: contrato novo `{familia_id, categoria_ml_id, categoria_nome}` → `{categoria_ml_id, categoria_nome,
  tipo_aviamento, atributos_faltantes}`. Consumido pela Task 8 (frontend).

- [ ] **Step 1: Reescrever o arquivo inteiro**

```typescript
// supabase/functions/definir-categoria-familia/index.ts
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { userClient } from '../_shared/supabase.ts';
import { categoriaParaTipo, montarAtributosML, tipoParaCategoria } from '../_shared/categoria/atributos.ts';
import { resolverAtributosGenericos } from '../_shared/categoria/resolver-atributos-genericos.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { lerSchemaAtributos } from '../_shared/categoria/schema.ts';
import { desempatarAtributosLLM } from '../_shared/ai/atributos-llm.ts';

// Seletor de categoria livre (ADR-0057, estende o escape hatch do ADR-0009/0022): o operador
// escolhe qualquer categoria real do ML (busca em atributos-familia/buscar-categoria). Categoria
// conhecida (linha/fita/botao/cola) → caminho curado (montarAtributosML, zero mudança de
// comportamento). Categoria genérica → resolverAtributosGenericos (mesmo fluxo do process-familia,
// sem duplicar lógica). Contrato antigo {tipo} removido: app de deploy único, sem consumidor externo.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return new Response('Missing auth', { status: 401, headers: corsHeaders });
  }

  const sb = userClient(auth.slice(7));
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new Response('Invalid token', { status: 401, headers: corsHeaders });

  let body: { familia_id?: string; categoria_ml_id?: string; categoria_nome?: string };
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }

  const categoriaMlId = body.categoria_ml_id?.trim();
  const categoriaNome = body.categoria_nome?.trim();
  if (!body.familia_id || !categoriaMlId || !categoriaNome) {
    return new Response('familia_id, categoria_ml_id e categoria_nome obrigatórios', { status: 400, headers: corsHeaders });
  }

  // Operação compartilhada (ADR-0047/0056): a RLS is_membro_operacao já restringe à
  // operação; qualquer membro define a categoria. Sem filtro por user.id.
  const { data: familia, error } = await sb
    .from('familias')
    .select('id, user_id, nome_pai, descricao_pai, fornecedor')
    .eq('id', body.familia_id)
    .maybeSingle();

  if (error || !familia) {
    return new Response(`Família não encontrada: ${error?.message ?? ''}`, { status: 404, headers: corsHeaders });
  }

  const tipo = tipoParaCategoria(categoriaMlId);

  let atributosMl;
  let atributosFaltantes: string[];
  if (tipo !== 'outro') {
    // Categoria conhecida (linha/fita/botao/cola): caminho curado, sem chamada de rede.
    atributosMl = montarAtributosML(tipo, familia.nome_pai, familia.fornecedor ?? undefined, familia.descricao_pai ?? undefined);
    atributosFaltantes = [];
  } else {
    let token: string | null = null;
    try { token = await getValidAccessToken(familia.user_id); } catch (e) { console.error('token p/ atributos genéricos falhou:', e); }
    const r = await resolverAtributosGenericos(
      categoriaMlId,
      { nome: familia.nome_pai, descricao: familia.descricao_pai ?? undefined, fornecedor: familia.fornecedor ?? undefined },
      {
        lerSchema: (id) => {
          if (!token) return Promise.reject(new Error('sem token p/ ler schema da categoria'));
          return lerSchemaAtributos(token, id);
        },
        llm: desempatarAtributosLLM,
      },
    );
    atributosMl = r.atributosMl;
    atributosFaltantes = r.faltantes;
  }

  const { error: upErr } = await sb
    .from('familias')
    .update({
      categoria_ml_id: categoriaMlId,
      categoria_nome: categoriaNome,
      tipo_aviamento: tipo,
      tipo_origem: 'manual',
      atributos_ml: atributosMl,
      atributos_faltantes: atributosFaltantes,
    })
    .eq('id', body.familia_id);

  if (upErr) {
    return new Response(`Erro ao atualizar: ${upErr.message}`, { status: 500, headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({ categoria_ml_id: categoriaMlId, categoria_nome: categoriaNome, tipo_aviamento: tipo, atributos_faltantes: atributosFaltantes }),
    { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } },
  );
});
```

- [ ] **Step 2: Typecheck**

```bash
cd "/Users/diego/Desktop/IA/Anuncios MktPlace/.worktrees/fix-categoria-selecao-livre"
pnpm build
```

Expected: sem erro (edge functions Deno não entram no `tsc -b` do frontend — conferir se há `deno check` no
projeto; se não houver script dedicado, seguir para o teste de integração manual da Task 9).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/definir-categoria-familia/index.ts
git commit -m "feat(categoria): definir-categoria-familia aceita categoria livre (ADR-0057)"
```

---

### Task 6: `buscarNomeCategoria` + ação `buscar-categoria` em `atributos-familia`

**Files:**
- Modify: `supabase/functions/_shared/ml/domain-discovery.ts`
- Modify: `supabase/functions/atributos-familia/index.ts`

**Interfaces:**
- Produces: `buscarNomeCategoria(token: string, categoriaId: string): Promise<string | null>`.
- Produces: ação `'buscar-categoria'` em `atributos-familia` → `{ candidatos: CategoriaCandidata[];
  sugestaoConcorrente: CategoriaCandidata | null }`. Consumido pela Task 7 (frontend).

- [ ] **Step 1: Adicionar `buscarNomeCategoria` ao final de `domain-discovery.ts`**

```typescript
const TTL_NOME_S = 30 * 24 * 60 * 60; // mesmo TTL de buscarCategoriaPreditor — nome de categoria muda raro.

/**
 * Nome humano de uma categoria pelo ID (GET /categories/{id}). Usado só para a sugestão do
 * concorrente (ADR-0057) — os resultados de busca já trazem o nome via domain_discovery.
 * Resiliente: rede/4xx → null (sugestão simplesmente não aparece). Cacheado no Redis.
 */
export async function buscarNomeCategoria(token: string, categoriaId: string): Promise<string | null> {
  if (!categoriaId) return null;
  const key = `catnome:${categoriaId}`;
  const cached = await redisGet(key).catch(() => null);
  if (cached) return cached;

  const r = await fetch(`https://api.mercadolibre.com/categories/${categoriaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const json = await r.json().catch(() => null) as { name?: string } | null;
  const nome = json?.name ?? null;
  if (nome) await redisSet(key, nome, TTL_NOME_S).catch(() => {});
  return nome;
}
```

- [ ] **Step 2: Reescrever `atributos-familia/index.ts`** (guarda de `categoria_ml_id` passa a valer só
  para `faltantes`/`salvar`; nova ação não exige categoria prévia)

```typescript
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { userClient } from '../_shared/supabase.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { lerSchemaAtributos } from '../_shared/categoria/schema.ts';
import { atributosFaltantesGenerico, type AtributoML } from '../_shared/categoria/atributos.ts';
import { faltantesEditaveis, validarValorAtributo } from '../_shared/categoria/faltantes-editaveis.ts';
import { buscarCategoriaPreditor, buscarNomeCategoria, type CategoriaCandidata } from '../_shared/ml/domain-discovery.ts';

// Camada 2B (ADR-0052) + busca livre de categoria (ADR-0057). Fallback manual de atributos e
// categoria na Revisão. RLS via userClient(jwt).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return new Response('Missing auth', { status: 401, headers: corsHeaders });

  const sb = userClient(auth.slice(7));
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new Response('Invalid token', { status: 401, headers: corsHeaders });

  let body: { action?: string; familia_id?: string; atributo_id?: string; valor?: string; query?: string };
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  if (!body.familia_id) return new Response('familia_id obrigatório', { status: 400, headers: corsHeaders });

  // RLS garante que só famílias visíveis ao usuário são lidas/escritas.
  const { data: familia, error } = await sb.from('familias')
    .select('id, categoria_ml_id, atributos_ml, user_id, concorrencia_categoria_id')
    .eq('id', body.familia_id).maybeSingle();
  if (error || !familia) return new Response('Família não encontrada', { status: 404, headers: corsHeaders });

  if (body.action === 'buscar-categoria') {
    let token: string;
    try { token = await getValidAccessToken(familia.user_id); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(`Não foi possível autenticar com o ML: ${msg}`, { status: 502, headers: corsHeaders });
    }
    const query = (body.query ?? '').trim();
    const candidatos = query ? await buscarCategoriaPreditor(token, query) : [];
    let sugestaoConcorrente: CategoriaCandidata | null = null;
    if (familia.concorrencia_categoria_id) {
      const nome = await buscarNomeCategoria(token, familia.concorrencia_categoria_id).catch(() => null);
      if (nome) {
        sugestaoConcorrente = {
          categoriaId: familia.concorrencia_categoria_id, categoriaNome: nome, domainId: '', domainName: '',
        };
      }
    }
    return new Response(JSON.stringify({ candidatos, sugestaoConcorrente }),
      { headers: { ...corsHeaders, 'content-type': 'application/json' } });
  }

  // Ações abaixo (faltantes/salvar) exigem categoria já definida.
  if (!familia.categoria_ml_id) return new Response('Família sem categoria', { status: 400, headers: corsHeaders });

  let schema;
  try {
    const token = await getValidAccessToken(familia.user_id);
    schema = await lerSchemaAtributos(token, familia.categoria_ml_id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`Não foi possível carregar os atributos da categoria: ${msg}`,
      { status: 502, headers: corsHeaders });
  }
  const atuais = (familia.atributos_ml as AtributoML[] | null) ?? [];

  if (body.action === 'faltantes') {
    return new Response(JSON.stringify({ campos: faltantesEditaveis(schema, atuais) }),
      { headers: { ...corsHeaders, 'content-type': 'application/json' } });
  }

  if (body.action === 'salvar') {
    if (!body.atributo_id || body.valor == null) {
      return new Response('atributo_id e valor obrigatórios', { status: 400, headers: corsHeaders });
    }
    const validado = validarValorAtributo(schema, body.atributo_id, body.valor);
    if (!validado) return new Response('Valor inválido para o atributo', { status: 422, headers: corsHeaders });
    const merged = [...atuais.filter((a) => a.id !== validado.id), validado];
    const faltantes = atributosFaltantesGenerico(merged, schema);
    const { error: upErr } = await sb.from('familias')
      .update({ atributos_ml: merged, atributos_faltantes: faltantes, atributos_editados_pelo_operador: true })
      .eq('id', familia.id);
    if (upErr) return new Response(`Erro ao salvar: ${upErr.message}`, { status: 500, headers: corsHeaders });
    return new Response(JSON.stringify({ ok: true, atributos_faltantes: faltantes }),
      { headers: { ...corsHeaders, 'content-type': 'application/json' } });
  }

  return new Response('action inválida', { status: 400, headers: corsHeaders });
});
```

- [ ] **Step 3: Typecheck + suíte completa**

```bash
pnpm build && pnpm test
```

Expected: build ok; testes 100% verdes (nenhum teste direto desses 2 arquivos — comportamento coberto
indiretamente pelas Tasks 3/9).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/ml/domain-discovery.ts supabase/functions/atributos-familia/index.ts
git commit -m "feat(categoria): ação buscar-categoria + buscarNomeCategoria (ADR-0057)"
```

---

### Task 7: Tipos e chamadas de frontend (`tipos-dominio.ts`, `queries.ts`, `categoria.ts`)

**Files:**
- Modify: `src/lib/tipos-dominio.ts` (campo novo em `Familia` + tipo `CategoriaCandidata`)
- Modify: `src/lib/queries.ts` (mapear coluna nova + nova função `buscarCategoriaML`)
- Modify: `src/lib/categoria.ts` (trocar `definirCategoriaFamilia`/`TipoCategoriaManual` por `definirCategoriaLivre`)
- Modify: `tests/components/card-categoria.test.tsx:17-32` (helper `familiaBase`)
- Modify: `tests/components/painel-analise.test.tsx` (helper local `familiaBase` — mesma duplicação, grep
  `function familiaBase` confirma que são 2 arquivos com fixture própria, não compartilhada)

**Interfaces:**
- Consumes: `chamarAtributosFamilia` (privado em `queries.ts`, já existe).
- Produces: `Familia.concorrenciaCategoriaId: string | null`; `CategoriaCandidata { categoriaId, categoriaNome,
  domainName }`; `buscarCategoriaML(familiaId, query): Promise<{candidatos, sugestaoConcorrente}>`;
  `definirCategoriaLivre(familiaId, categoriaMlId, categoriaNome): Promise<{...}>`. Consumidos pela Task 8.

- [ ] **Step 1: `tipos-dominio.ts`** — adicionar campo à interface `Familia` (perto de `categoriaNome`, linha
  ~148) e o tipo `CategoriaCandidata` (perto de `CampoFaltante`)

```typescript
export interface CategoriaCandidata {
  categoriaId: string;
  categoriaNome: string;
  domainName: string;
}
```

E em `Familia`:
```typescript
  categoriaNome: string | null;
  tipoOrigem: TipoOrigem | null;
  /** category_id do concorrente (ADR-0057) — sugestão não-vinculante no seletor de categoria. */
  concorrenciaCategoriaId: string | null;
```

- [ ] **Step 2: `queries.ts`** — no `familiaFromRow`, mapear a coluna nova perto de `categoriaMlId: r.categoria_ml_id,`

```typescript
    categoriaMlId: r.categoria_ml_id,
    categoriaNome: r.categoria_nome,
    tipoOrigem: r.tipo_origem,
    concorrenciaCategoriaId: r.concorrencia_categoria_id,
```

Conferir o tipo `FamiliaRow` (grep `type FamiliaRow` em `src/lib/queries.ts` ou arquivo de tipos gerado do
Supabase): se for uma interface manual, adicionar `concorrencia_categoria_id: string | null;`; se for tipo
gerado (`Database['public']['Tables']['familias']['Row']`), rodar a regeneração de tipos do projeto (ver
`package.json` por um script `types`/`gen:types`; se não existir, o campo já vem tipado automaticamente pelo
Supabase client após o `db push` da Task 2 — só confirmar com `pnpm build`).

Adicionar a função de busca, perto de `salvarAtributoFamilia`:
```typescript
export async function buscarCategoriaML(
  familiaId: string, query: string,
): Promise<{ candidatos: CategoriaCandidata[]; sugestaoConcorrente: CategoriaCandidata | null }> {
  const res = await chamarAtributosFamilia({ action: 'buscar-categoria', familia_id: familiaId, query });
  return res.json();
}
```

(import `CategoriaCandidata` de `@/lib/tipos-dominio` no topo do arquivo).

- [ ] **Step 3: `categoria.ts`** — substituir `TipoCategoriaManual`/`definirCategoriaFamilia` por
  `definirCategoriaLivre`; manter `CATEGORIAS_MANUAIS` (ainda usado como rótulo de exibição em
  `nomeCategoriaAmigavel`)

```typescript
import { supabase } from './supabase';
import type { TipoAviamento } from './tipos-dominio';

// Rótulos de exibição dos tipos de aviamento conhecidos (fallback quando categoriaNome vier vazio
// de dados antigos). Não é mais a lista de opções do seletor — isso agora é busca livre (ADR-0057).
export const CATEGORIAS_MANUAIS: { tipo: Exclude<TipoAviamento, 'outro'>; rotulo: string }[] = [
  { tipo: 'linha', rotulo: 'Fios e Cadarços' },
  { tipo: 'fita', rotulo: 'Fita de Cetim' },
  { tipo: 'botao', rotulo: 'Botões' },
  { tipo: 'cola', rotulo: 'Bastões de Cola' },
];

export async function definirCategoriaLivre(
  familiaId: string,
  categoriaMlId: string,
  categoriaNome: string,
): Promise<{ categoria_ml_id: string; categoria_nome: string; tipo_aviamento: TipoAviamento; atributos_faltantes: string[] }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');

  const r = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/definir-categoria-familia`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ familia_id: familiaId, categoria_ml_id: categoriaMlId, categoria_nome: categoriaNome }),
    },
  );

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Falha ao definir categoria: ${txt || r.status}`);
  }
  return r.json();
}
```

- [ ] **Step 4: Atualizar as 2 fixtures de teste que quebram com o campo novo obrigatório**

`Familia.concorrenciaCategoriaId` é campo novo não-opcional — os 2 arquivos com helper `familiaBase()` próprio
(não compartilhado) precisam do campo ou `tsc -b` falha.

Em `tests/components/card-categoria.test.tsx`, dentro de `familiaBase()` (linha ~29, junto de
`variacoesSemCor: 0, analiseMercado: null,`):
```typescript
    variacoesSemCor: 0, analiseMercado: null,
    concorrenciaCategoriaId: null,
    ...over,
```

Em `tests/components/painel-analise.test.tsx`, localizar o `familiaBase()` local do arquivo (`grep -n
"function familiaBase" tests/components/painel-analise.test.tsx`) e adicionar a mesma linha
`concorrenciaCategoriaId: null,` antes do spread `...over`.

- [ ] **Step 5: Typecheck**

```bash
pnpm build
```

Expected: falha esperada aqui — `useFamiliaMutations.ts` e `card-categoria.tsx` ainda referenciam
`definirCategoriaFamilia`/`TipoCategoriaManual` (Tasks 8/9 corrigem). Confirmar que o ÚNICO erro é esse (não
erro de digitação nos arquivos desta task, nem erro nas 2 fixtures do Step 4).

- [ ] **Step 6: Commit**

```bash
git add src/lib/tipos-dominio.ts src/lib/queries.ts src/lib/categoria.ts tests/components/card-categoria.test.tsx tests/components/painel-analise.test.tsx
git commit -m "feat(categoria): tipos e chamadas de frontend p/ busca livre (ADR-0057)"
```

---

### Task 8: `useDefinirCategoriaLivre` (hook)

**Files:**
- Modify: `src/hooks/useFamiliaMutations.ts`

**Interfaces:**
- Consumes: `definirCategoriaLivre` (Task 7).
- Produces: `useDefinirCategoriaLivre(loteId): UseMutationResult` com `mutationFn: ({familiaId, categoriaMlId,
  categoriaNome}) => Promise<...>`. Consumido pela Task 9.

- [ ] **Step 1: Substituir o import e o hook `useDefinirCategoria`**

Old (linha 19):
```typescript
import { definirCategoriaFamilia, type TipoCategoriaManual } from '@/lib/categoria';
```
New:
```typescript
import { definirCategoriaLivre } from '@/lib/categoria';
```

Old (linhas 116-123):
```typescript
export function useDefinirCategoria(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ familiaId, tipo }: { familiaId: string; tipo: TipoCategoriaManual }) =>
      definirCategoriaFamilia(familiaId, tipo),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}
```
New:
```typescript
export function useDefinirCategoriaLivre(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ familiaId, categoriaMlId, categoriaNome }: { familiaId: string; categoriaMlId: string; categoriaNome: string }) =>
      definirCategoriaLivre(familiaId, categoriaMlId, categoriaNome),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useFamiliaMutations.ts
git commit -m "feat(categoria): useDefinirCategoriaLivre substitui useDefinirCategoria (ADR-0057)"
```

---

### Task 9: `CardCategoria` — busca livre + sugestão do concorrente

**Files:**
- Modify: `src/components/card-categoria.tsx`
- Modify: `tests/components/card-categoria.test.tsx` (o teste `'categoria indefinida ... oferece seletor'`
  cobre o `<Select>` antigo — precisa refletir a busca nova)

**Interfaces:**
- Consumes: `buscarCategoriaML` (Task 7), `useDefinirCategoriaLivre` (Task 8), `CategoriaCandidata`
  (`@/lib/tipos-dominio`).

- [ ] **Step 1: Reescrever o arquivo**

```tsx
import { useState } from 'react';
import { Tag, Sparkles, AlertTriangle, Search } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { useDefinirCategoriaLivre } from '@/hooks/useFamiliaMutations';
import { buscarCategoriaML } from '@/lib/queries';
import { CATEGORIAS_MANUAIS } from '@/lib/categoria';
import { EditorAtributosFaltantes } from '@/components/editor-atributos-faltantes';
import type { Familia, TipoAviamento, CategoriaCandidata } from '@/lib/tipos-dominio';

function nomeCategoriaAmigavel(tipo: TipoAviamento | null): string {
  return CATEGORIAS_MANUAIS.find((c) => c.tipo === tipo)?.rotulo ?? '—';
}

function BuscaCategoria({ familia }: { familia: Familia }) {
  const [query, setQuery] = useState('');
  const [candidatos, setCandidatos] = useState<CategoriaCandidata[]>([]);
  const [sugestao, setSugestao] = useState<CategoriaCandidata | null>(null);
  const [sugestaoCarregada, setSugestaoCarregada] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const definir = useDefinirCategoriaLivre(familia.loteId);

  // Carrega a sugestão do concorrente só quando o operador foca o campo (não no mount): evita 1
  // chamada de rede por card renderizado quando a Revisão lista várias famílias indefinidas de
  // uma vez. Idempotente (só a 1ª vez por card).
  const carregarSugestao = () => {
    if (sugestaoCarregada) return;
    setSugestaoCarregada(true);
    buscarCategoriaML(familia.id, '').then((r) => setSugestao(r.sugestaoConcorrente)).catch(() => {});
  };

  const buscar = async () => {
    if (!query.trim()) return;
    setBuscando(true);
    try {
      const r = await buscarCategoriaML(familia.id, query);
      setCandidatos(r.candidatos);
    } catch (e) {
      toast.error('Erro ao buscar categoria', { description: (e as Error).message });
    } finally {
      setBuscando(false);
    }
  };

  const escolher = (c: CategoriaCandidata) =>
    definir.mutate(
      { familiaId: familia.id, categoriaMlId: c.categoriaId, categoriaNome: c.categoriaNome },
      { onError: (e) => toast.error('Erro ao definir categoria', { description: (e as Error).message }) },
    );

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-destructive">Categoria indefinida — busque antes de publicar</p>
      {sugestao && (
        <button
          type="button"
          onClick={() => escolher(sugestao)}
          disabled={definir.isPending}
          className="rounded-md border border-info/40 bg-info/5 p-1.5 text-left text-xs hover:bg-info/10"
        >
          <span className="font-medium">Sugestão (concorrente):</span> {sugestao.categoriaNome}
        </button>
      )}
      <div className="flex gap-1">
        <Input
          className="h-8 text-xs"
          placeholder="Buscar categoria (ex.: bainha)"
          value={query}
          onFocus={carregarSugestao}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && buscar()}
        />
        <Button size="sm" className="h-8 px-2" onClick={buscar} disabled={buscando || definir.isPending}>
          <Search className="h-3.5 w-3.5" />
        </Button>
      </div>
      {candidatos.length > 0 && (
        <div className="flex flex-col gap-1">
          {candidatos.map((c) => (
            <button
              key={c.categoriaId}
              type="button"
              onClick={() => escolher(c)}
              disabled={definir.isPending}
              className="rounded-md border p-1.5 text-left text-xs hover:bg-accent"
            >
              {c.categoriaNome} <span className="text-muted-foreground">({c.categoriaId})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CardCategoria({ familia }: { familia: Familia }) {
  const categoriaIndefinida = !familia.categoriaMlId;

  return (
    <div
      className={cn(
        'w-[200px] shrink-0 rounded-md border bg-card p-2 shadow-sm',
        categoriaIndefinida && 'border-destructive/30 bg-destructive/5',
      )}
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Tag className="h-3.5 w-3.5" /> Categoria
      </div>
      {categoriaIndefinida ? (
        <BuscaCategoria familia={familia} />
      ) : (
        <>
          <p className="text-sm font-medium">
            {familia.categoriaNome ?? nomeCategoriaAmigavel(familia.tipoAviamento)}
          </p>
          <p className="text-xs text-muted-foreground">{familia.categoriaMlId}</p>
          {(familia.tipoOrigem === 'preditor' || familia.tipoOrigem === 'ia') && (
            <StatusPill tone="info" className="mt-1.5">
              <Sparkles className="h-3 w-3" /> Sugerida por IA — confira
            </StatusPill>
          )}
          {familia.atributosFaltantes && familia.atributosFaltantes.length > 0 && (
            <>
              <p className="mt-1.5 flex items-start gap-1 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>Faltam: {familia.atributosFaltantes.join(', ')}</span>
              </p>
              <EditorAtributosFaltantes familiaId={familia.id} loteId={familia.loteId} />
            </>
          )}
        </>
      )}
    </div>
  );
}
```

Conferir se `@/components/ui/button` exporta `Button` com prop `size="sm"` (padrão shadcn já usado no projeto —
grep rápido em outro componente que já usa `<Button size="sm">` antes de assumir a prop existe).

- [ ] **Step 2: Atualizar o teste existente que cobria o `<Select>` antigo**

Em `tests/components/card-categoria.test.tsx`, o teste `'categoria indefinida (tipo outro / sem id) alerta +
oferece seletor'` (linha ~41) espera o texto `/escolher categoria/i`, que não existe mais. Trocar por:

```typescript
  it('categoria indefinida (tipo outro / sem id) alerta + oferece busca', () => {
    renderCard(familiaBase({ tipoAviamento: 'outro', categoriaMlId: null }));
    expect(screen.getByText(/categoria indefinida/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/buscar categoria/i)).toBeInTheDocument();
  });
```

Os outros 4 testes do arquivo não tocam o branch de busca (renderizam com `categoriaMlId` definido) — não
precisam mudar além da fixture do Step 4 da Task 7.

- [ ] **Step 3: Rodar o arquivo de teste isolado**

```bash
pnpm vitest run tests/components/card-categoria.test.tsx
```

Expected: 5/5 testes passando.

- [ ] **Step 4: Typecheck + lint + suíte completa**

```bash
pnpm build && pnpm lint && pnpm test
```

Expected: 0 erros (import não utilizado `Select`/`SelectContent`/etc. removido); suíte inteira verde.

- [ ] **Step 5: Commit**

```bash
git add src/components/card-categoria.tsx tests/components/card-categoria.test.tsx
git commit -m "feat(categoria): CardCategoria com busca livre + sugestão do concorrente (ADR-0057)"
```

---

### Task 10: Deploy das edge functions + validação local (ultraqa gate)

**Files:** nenhum (deploy + verificação).

- [ ] **Step 1: Deploy completo via CLI** (mudança em `_shared/` → redeployar todas as functions afetadas:
  `process-familia`, `definir-categoria-familia`, `atributos-familia`)

```bash
cd "/Users/diego/Desktop/IA/Anuncios MktPlace/.worktrees/fix-categoria-selecao-livre"
supabase functions deploy process-familia
supabase functions deploy definir-categoria-familia
supabase functions deploy atributos-familia
```

- [ ] **Step 2: Conferir versão pós-deploy** (per regra do projeto — nunca deploy defasado)

```bash
supabase functions list | grep -E "process-familia|definir-categoria-familia|atributos-familia"
```

- [ ] **Step 3: Portão ultraqa completo**

```bash
pnpm lint && pnpm test && pnpm build
```

Expected: tudo verde.

- [ ] **Step 4: Subir o front local e entregar a URL pro Diego validar** (browser-use / validação manual —
  reproduzir a família real "BAINHA INSTANTÂNEA 4MT UND" do lote 51, buscar "bainha", confirmar que aparecem
  candidatos reais e que a sugestão do concorrente aparece se `concorrencia_categoria_id` estiver preenchido
  após reprocessar a família)

```bash
pnpm dev
```

Reportar a URL local pro Diego testar antes de qualquer merge (workflow de entrega solo — parar aqui, não
mergear sem OK explícito).

---

## Auto-Review desta plano

**Cobertura do escopo:** ADR (Task 1) ✓, migration (Task 2) ✓, extração genérica com TDD (Task 3) ✓,
process-familia persistindo + reusando (Task 4) ✓, definir-categoria-familia generalizado (Task 5) ✓, busca +
sugestão do concorrente no backend (Task 6) ✓, tipos/chamadas de frontend (Task 7) ✓, hook (Task 8) ✓, UI
(Task 9) ✓, deploy + portão ultraqa + validação local (Task 10) ✓. Docs de referência (`edge-functions.md`,
`modelo-de-dados.md`) ficam para o commit de finalização, junto com a atualização do `obsidian-vault` e do
`TASKS.md` — regra de conclusão do projeto (fazer no mesmo commit da entrega, não antes de validar localmente).

**Placeholders:** nenhum "TODO"/"implementar depois" — todo passo tem código completo ou comando exato.

**Consistência de tipos:** `resolverAtributosGenericos(categoriaMlId, input, deps)` com `deps: {lerSchema, llm}`
— mesmo nome/shape usado nas Tasks 3, 4 e 5. `CategoriaCandidata` com `{categoriaId, categoriaNome, domainName}`
— mesmo shape nas Tasks 6, 7, 9 (campo `domainId` da versão Deno é interno, não exposto ao frontend; o tipo
frontend tem só os 3 campos usados na UI).
