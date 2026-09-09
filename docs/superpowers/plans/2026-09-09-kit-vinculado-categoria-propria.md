# Kit vinculado — categoria própria Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que, ao criar um kit vinculado (ADR-0151), o operador escolha opcionalmente uma
categoria do Mercado Livre diferente da categoria do produto-base.

**Architecture:** Sem override, nada muda (categoria continua herdada da base). Com override, o
backend resolve schema + atributos-base para a categoria NOVA (mesma lógica curada/genérica+IA que
`definir-categoria-familia` já usa para produtos normais, chamada diretamente — sem extrair função
compartilhada, por ser só um if/else pequeno e não valer o acoplamento entre os dois arquivos) e só
então aplica `aplicarKitNosAtributos` por cima, como hoje. `montarFamiliaKit` grava a categoria do
override em vez de clonar da base.

**Tech Stack:** Deno Edge Functions (Supabase), TypeScript, React + Vitest/Testing Library no
front.

**Spec:** `docs/superpowers/specs/2026-09-09-kit-vinculado-categoria-propria-design.md`

## Global Constraints

- Roteamento de modelos do CLAUDE.md do projeto: nenhuma tarefa deste plano desce para o modelo
  mais barato — todas tocam o payload de publicação em marketplace (ADR-0151), e a regra do
  CLAUDE.md é "nunca rebaixar modelo em... publicação em marketplace". Todas as 4 tarefas rodam no
  modelo padrão (sonnet).
- Sem migration — `familias.categoria_ml_id`/`categoria_nome` já existem.
- Sem mudança de comportamento no caminho padrão (sem override) — todo teste existente que já
  passa continua passando sem alteração de asserção.
- `criar-kit-vinculado/processar.ts` NÃO chama `process-familia` nem qualquer reprocessamento por
  IA de título/descrição (ADR-0151 D-3) — a resolução de atributos por IA introduzida aqui é
  estritamente sobre atributos de categoria (`resolverAtributosGenericos`), nunca título/descrição.

---

### Task 1: Backend — resolver atributos para a categoria do override em `criarKitsVinculados`

**Files:**
- Modify: `supabase/functions/criar-kit-vinculado/processar.ts:11-83` (interfaces), `:342-365`
  (resolução de schema/atributos), `:386-389` (aplicação do override em `familiaObj`)
- Test: `supabase/functions/criar-kit-vinculado/__tests__/processar.test.ts`

**Interfaces:**
- Consumes: `tipoParaCategoria`, `montarAtributosML` (`_shared/categoria/atributos.ts`, já
  exportadas); `resolverAtributosGenericos` (`_shared/categoria/resolver-atributos-genericos.ts`,
  assinatura `(categoriaMlId: string, input: {nome, descricao?, fornecedor?}, deps: {lerSchema:
  (id: string) => Promise<AtributoSchema[]>, llm: (input, alvos) => Promise<Record<string,
  string>>}, marcaPadrao?: string) => Promise<{atributosMl: AtributoML[], faltantes: string[]}>`);
  `InputAtributos`, `AtributoAlvo` (`_shared/ai/atributos-llm-core.ts`, tipos).
- Produces: `CriarKitInput.categoriaOverride?: { categoriaMlId: string; categoriaNome: string } |
  null` (novo campo, consumido pela Task 2 ao montar o input a partir do body HTTP);
  `CriarKitDeps.llm?` e `CriarKitDeps.marcaPadrao?` (novos campos opcionais, consumidos pela Task 2
  ao montar os deps reais).

- [ ] **Step 1: Escrever os testes que falham**

Abrir `supabase/functions/criar-kit-vinculado/__tests__/processar.test.ts`. Primeiro, estender
`depsFake` para aceitar schemas diferentes por categoria e uma função `llm` injetável — isto NÃO
muda nenhum teste existente (todos continuam passando `opts` sem os campos novos, que têm
default). Substituir a assinatura e o corpo de `depsFake` (linhas 222-235 e a definição de `deps`
em 281-291) por:

```ts
function depsFake(opts: {
  custo?: number | null;
  peso_gramas?: number | null;
  mlItemId?: string | null;
  qtdVariacoes?: number;
  chavesJaUsadas?: string[];
  categoriaSemKit?: boolean;
  statusPorChave?: Record<string, string>;
  schemaPorCategoria?: Record<string, unknown>;
  llm?: (input: unknown, alvos: unknown) => Promise<Record<string, string>>;
  marcaPadrao?: string;
} = {}) {
  const {
    custo = 10, peso_gramas: pesoGramas = 100, mlItemId = null,
    qtdVariacoes = 1, chavesJaUsadas = [], categoriaSemKit = false,
    statusPorChave = {}, schemaPorCategoria = {},
    llm = async () => ({}),
    marcaPadrao = undefined,
  } = opts;
```

(O resto do corpo da função até a construção de `deps` fica igual — só a desestruturação acima
muda.) Trocar a definição de `deps` (hoje linhas 281-291) por:

```ts
  const deps: CriarKitDeps = {
    admin: admin as never,
    orgId: 'org-1',
    userId: 'user-1',
    resolverToken: async () => 'fake-token',
    lerSchema: async (_token: string, categoriaId: string) =>
      (schemaPorCategoria[categoriaId]
        ?? (categoriaSemKit ? SCHEMA_SEM_KIT : SCHEMA_COM_KIT)) as never,
    encadearPublicacao: async (ids: string[]) => {
      enfileirados.publicarFamilias++;
      enfileirados.publicarFamiliasIds.push(ids);
      return true;
    },
    llm: llm as never,
    marcaPadrao,
  };
```

Adicionar, no topo do arquivo (perto de `SCHEMA_SEM_KIT`), o schema da categoria de override usada
nos testes novos:

```ts
const SCHEMA_OVERRIDE_COM_KIT = [
  {
    id: 'SALE_FORMAT', nome: 'Formato de venda', valueType: 'list',
    valores: [{ id: 'V-UN', nome: 'Unidade' }, { id: 'V-KIT', nome: 'Kit' }],
  },
  { id: 'UNITS_PER_PACK', nome: 'Unidades por kit', valueType: 'number', valores: [] },
  { id: 'BRAND', nome: 'Marca', valueType: 'string', valores: [] },
];
```

Adicionar este bloco de testes ao final do `describe('criarKitsVinculados', ...)`:

```ts
  it('com categoriaOverride: resolve schema/atributos da categoria NOVA, não da base (categoria genérica)', async () => {
    const { deps, inserts } = depsFake({
      schemaPorCategoria: { 'MLB123': SCHEMA_SEM_KIT, 'MLB-OVERRIDE': SCHEMA_OVERRIDE_COM_KIT },
    });
    const input: CriarKitInput = {
      familiaBaseId: BASE_ID, kits: [kitPadrao(2)],
      categoriaOverride: { categoriaMlId: 'MLB-OVERRIDE', categoriaNome: 'Categoria Override' },
    };
    const r = await criarKitsVinculados(deps, input);
    expect(r.ok).toBe(true);
    expect(inserts.familias[0].categoria_ml_id).toBe('MLB-OVERRIDE');
    expect(inserts.familias[0].categoria_nome).toBe('Categoria Override');
    const atributos = inserts.familias[0].atributos_ml as { id: string; value_id?: string }[];
    expect(atributos.find((a) => a.id === 'SALE_FORMAT')?.value_id).toBe('V-KIT');
  });

  it('com categoriaOverride numa categoria curada (aviamento conhecido): usa montarAtributosML, não IA', async () => {
    const llmMock = vi.fn(async () => ({}));
    const { deps, inserts } = depsFake({
      schemaPorCategoria: { 'MLB123': SCHEMA_SEM_KIT, 'MLB270272': SCHEMA_OVERRIDE_COM_KIT },
      llm: llmMock,
    });
    const input: CriarKitInput = {
      familiaBaseId: BASE_ID, kits: [kitPadrao(2)],
      categoriaOverride: { categoriaMlId: 'MLB270272', categoriaNome: 'Botões' },
    };
    const r = await criarKitsVinculados(deps, input);
    expect(r.ok).toBe(true);
    expect(llmMock).not.toHaveBeenCalled();
    const atributos = inserts.familias[0].atributos_ml as { id: string }[];
    expect(atributos.some((a) => a.id === 'BRAND')).toBe(true);
  });

  it('sem categoriaOverride: continua usando a categoria e os atributos da base (comportamento intocado)', async () => {
    const { deps, inserts } = depsFake({
      schemaPorCategoria: { 'MLB123': SCHEMA_COM_KIT },
    });
    const input: CriarKitInput = { familiaBaseId: BASE_ID, kits: [kitPadrao(2)] };
    const r = await criarKitsVinculados(deps, input);
    expect(r.ok).toBe(true);
    expect(inserts.familias[0].categoria_ml_id).toBe('MLB123');
  });

  it('categoriaOverride numa categoria sem "Kit" → recusa alto (categoria_sem_kit), igual ao caminho sem override', async () => {
    const { deps } = depsFake({
      schemaPorCategoria: { 'MLB123': SCHEMA_COM_KIT, 'MLB-OVERRIDE': SCHEMA_SEM_KIT },
    });
    const input: CriarKitInput = {
      familiaBaseId: BASE_ID, kits: [kitPadrao(2)],
      categoriaOverride: { categoriaMlId: 'MLB-OVERRIDE', categoriaNome: 'Sem Kit' },
    };
    const r = await criarKitsVinculados(deps, input);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('categoria_sem_kit');
  });
```

- [ ] **Step 2: Rodar os testes novos e confirmar que falham**

Run: `cd supabase/functions && deno test --allow-none criar-kit-vinculado/__tests__/processar.test.ts 2>&1 | head -60`
(ou, se o projeto rodar esses testes via vitest: `pnpm vitest run supabase/functions/criar-kit-vinculado/__tests__/processar.test.ts`)
Expected: FAIL — `categoriaOverride` não existe em `CriarKitInput`, `depsFake` não aceita os campos
novos (erro de tipo/compilação), ou os 4 testes novos falham porque o código de produção ainda não
lê `categoriaOverride`.

- [ ] **Step 3: Implementar em `processar.ts`**

Adicionar aos imports do topo do arquivo (a lista atual começa com `import type { SupabaseClient }
...`):

```ts
import { aplicarKitNosAtributos, tipoParaCategoria, montarAtributosML, type AtributoML } from '../_shared/categoria/atributos.ts';
import { resolverAtributosGenericos } from '../_shared/categoria/resolver-atributos-genericos.ts';
import type { InputAtributos, AtributoAlvo } from '../_shared/ai/atributos-llm-core.ts';
```

(A linha `import { aplicarKitNosAtributos, type AtributoML } from '../_shared/categoria/atributos.ts';`
já existe — só adicionar `tipoParaCategoria, montarAtributosML` nela, não duplicar o import.)

Em `CriarKitInput` (hoje):
```ts
export interface CriarKitInput {
  familiaBaseId: string;
  kits: KitSolicitado[];
}
```
Trocar por:
```ts
export interface CriarKitInput {
  familiaBaseId: string;
  kits: KitSolicitado[];
  /** Categoria do ML diferente da base, escolhida pelo operador. null/ausente → herda da base. */
  categoriaOverride?: { categoriaMlId: string; categoriaNome: string } | null;
}
```

Em `CriarKitDeps` (hoje termina em `encadearPublicacao: (familiaIds: string[]) =>
Promise<boolean>;`), adicionar dois campos opcionais ao final da interface:
```ts
  /** Só usado quando categoriaOverride cai numa categoria genérica (tipoParaCategoria === 'outro'). */
  llm?: (input: InputAtributos, alvos: AtributoAlvo[]) => Promise<Record<string, string>>;
  /** Marca padrão da org, para atributos BRAND/MANUFACTURER sem marca própria. */
  marcaPadrao?: string;
```

Substituir o bloco (hoje linhas 342-365):
```ts
    // ── Atributos (força SALE_FORMAT=Kit por categoria, uma vez — schema é o mesmo p/ todos) ─
    let schema: AtributoSchema[];
    try {
      const token = await deps.resolverToken();
      schema = await deps.lerSchema(token, base.categoria_ml_id as string);
    } catch (e) {
      return { ok: false, motivo: 'sem_conexao_ml', mensagem: e instanceof Error ? e.message : String(e) };
    }
    const atributosPorMultiplicador = new Map<number, AtributoML[]>();
    for (const kit of kitsFaltando) {
      try {
        atributosPorMultiplicador.set(
          kit.multiplicador,
          aplicarKitNosAtributos(
            schema, (base.atributos_ml as AtributoML[] | null) ?? [], kit.multiplicador, pesoBase,
          ),
        );
      } catch (e) {
        const status = (e as Error & { status?: number }).status;
        if (status === 400) {
          return { ok: false, motivo: 'categoria_sem_kit', mensagem: (e as Error).message };
        }
        throw e;
      }
```
por:
```ts
    // ── Atributos (força SALE_FORMAT=Kit por categoria, uma vez — schema é o mesmo p/ todos) ─
    // Com categoriaOverride: schema e atributos-base são resolvidos pela categoria NOVA, não pela
    // da base — mesma lógica de definir-categoria-familia (curada p/ tipo de aviamento conhecido,
    // genérica+IA p/ categoria "outro"), aplicada aqui ANTES de aplicarKitNosAtributos.
    const categoriaAlvo = input.categoriaOverride?.categoriaMlId ?? (base.categoria_ml_id as string);
    let schema: AtributoSchema[];
    let token: string;
    try {
      token = await deps.resolverToken();
      schema = await deps.lerSchema(token, categoriaAlvo);
    } catch (e) {
      return { ok: false, motivo: 'sem_conexao_ml', mensagem: e instanceof Error ? e.message : String(e) };
    }
    let atributosBase: AtributoML[];
    if (!input.categoriaOverride) {
      atributosBase = (base.atributos_ml as AtributoML[] | null) ?? [];
    } else {
      const tipo = tipoParaCategoria(categoriaAlvo);
      if (tipo !== 'outro') {
        atributosBase = montarAtributosML(
          tipo, base.nome_pai as string, (base.fornecedor as string | null) ?? undefined,
          (base.descricao_pai as string | null) ?? undefined, deps.marcaPadrao,
        );
      } else {
        const llm = deps.llm ?? (() => Promise.resolve({} as Record<string, string>));
        const resolvido = await resolverAtributosGenericos(
          categoriaAlvo,
          {
            nome: base.nome_pai as string,
            descricao: (base.descricao_pai as string | null) ?? undefined,
            fornecedor: (base.fornecedor as string | null) ?? undefined,
          },
          { lerSchema: (id) => deps.lerSchema(token, id), llm },
          deps.marcaPadrao,
        );
        atributosBase = resolvido.atributosMl;
      }
    }
    const atributosPorMultiplicador = new Map<number, AtributoML[]>();
    for (const kit of kitsFaltando) {
      try {
        atributosPorMultiplicador.set(
          kit.multiplicador,
          aplicarKitNosAtributos(schema, atributosBase, kit.multiplicador, pesoBase),
        );
      } catch (e) {
        const status = (e as Error & { status?: number }).status;
        if (status === 400) {
          return { ok: false, motivo: 'categoria_sem_kit', mensagem: (e as Error).message };
        }
        throw e;
      }
```

(O `}` de fechamento do `for` e o resto da função depois desse trecho não mudam.)

Por fim, no loop de criação (hoje):
```ts
      const familiaObj = montarFamiliaKit(base as Record<string, unknown>, kit, {
        loteId, codigoPai: par.codigoPai, atributos: atributosPorMultiplicador.get(kit.multiplicador)!,
      });
```
Adicionar imediatamente depois:
```ts
      if (input.categoriaOverride) {
        familiaObj.categoria_ml_id = input.categoriaOverride.categoriaMlId;
        familiaObj.categoria_nome = input.categoriaOverride.categoriaNome;
      }
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm vitest run supabase/functions/criar-kit-vinculado/__tests__/processar.test.ts`
Expected: PASS — todos os testes, incluindo os 4 novos e todos os pré-existentes (nenhuma
asserção pré-existente deveria ter mudado).

- [ ] **Step 5: Typecheck**

Run: `pnpm tsc -b --force`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/criar-kit-vinculado/processar.ts supabase/functions/criar-kit-vinculado/__tests__/processar.test.ts
git commit -m "feat(kit): categoriaOverride resolve atributos pela categoria nova, não a da base"
```

---

### Task 2: Backend — parsear `categoria_override` do body e ligar os deps reais em `index.ts`

**Files:**
- Modify: `supabase/functions/criar-kit-vinculado/index.ts`

**Interfaces:**
- Consumes: `CriarKitInput.categoriaOverride`, `CriarKitDeps.llm`, `CriarKitDeps.marcaPadrao`
  (produzidos pela Task 1); `desempatarAtributosLLM` (`_shared/ai/atributos-llm.ts`, assinatura
  `(input: InputAtributos, alvos: AtributoAlvo[], modelo?: string) =>
  Promise<Record<string,string>>`); `resolverModeloTexto` (`_shared/ai/modelos.ts`, assinatura
  `(admin: SupabaseClient, orgId: string) => Promise<string>`).
- Produces: nada consumido por outra task — ponto de entrada HTTP.

- [ ] **Step 1: Implementar (sem teste dedicado — `index.ts` neste projeto é adaptador HTTP fino,
  testado indiretamente via `processar.test.ts`; mesmo padrão de `parseKit`, que também não tem
  teste próprio)**

Adicionar aos imports do topo:
```ts
import { desempatarAtributosLLM } from '../_shared/ai/atributos-llm.ts';
import { resolverModeloTexto } from '../_shared/ai/modelos.ts';
```

No corpo de `Deno.serve`, o parsing do body hoje é:
```ts
  let body: { familia_base_id?: unknown; kits?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
```
Trocar por:
```ts
  let body: { familia_base_id?: unknown; kits?: unknown; categoria_override?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
```

Depois de montar `kitsParseados` e antes de `const input: CriarKitInput = {...}`, adicionar:
```ts
  let categoriaOverride: CriarKitInput['categoriaOverride'] = null;
  if (body.categoria_override != null) {
    const co = body.categoria_override as Record<string, unknown>;
    if (typeof co.categoria_ml_id !== 'string' || !co.categoria_ml_id
      || typeof co.categoria_nome !== 'string' || !co.categoria_nome) {
      return json({ error: 'categoria_override inválido — categoria_ml_id e categoria_nome são obrigatórios.' }, 400);
    }
    categoriaOverride = { categoriaMlId: co.categoria_ml_id, categoriaNome: co.categoria_nome };
  }
```

Trocar a montagem de `input` (hoje):
```ts
  const input: CriarKitInput = {
    familiaBaseId: body.familia_base_id,
    kits: kitsParseados as KitSolicitado[],
  };
```
por:
```ts
  const input: CriarKitInput = {
    familiaBaseId: body.familia_base_id,
    kits: kitsParseados as KitSolicitado[],
    categoriaOverride,
  };
```

Antes da chamada a `criarKitsVinculados`, resolver `marcaPadrao` só quando há override (evita uma
query desnecessária no caminho padrão, que é o caso comum):
```ts
  let marcaPadrao: string | undefined;
  if (categoriaOverride) {
    const { data: orgRow } = await admin.from('organizations').select('marca_padrao').eq('id', orgId).maybeSingle();
    marcaPadrao = (orgRow?.marca_padrao as string | null) ?? undefined;
  }
```

Por fim, trocar a chamada a `criarKitsVinculados` (hoje):
```ts
  const resultado = await criarKitsVinculados({
    admin,
    orgId,
    userId,
    resolverToken: async () => {
      const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
      if (!conexao) throw new Error('Organização sem conexão com o Mercado Livre');
      return getValidAccessTokenConexao(conexao);
    },
    lerSchema: lerSchemaAtributos,
    encadearPublicacao: (familiaIds) => encadearPublicacao(req.headers.get('Authorization')!, familiaIds),
  }, input);
```
por:
```ts
  const modeloTexto = categoriaOverride ? await resolverModeloTexto(admin, orgId) : undefined;
  const resultado = await criarKitsVinculados({
    admin,
    orgId,
    userId,
    resolverToken: async () => {
      const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
      if (!conexao) throw new Error('Organização sem conexão com o Mercado Livre');
      return getValidAccessTokenConexao(conexao);
    },
    lerSchema: lerSchemaAtributos,
    encadearPublicacao: (familiaIds) => encadearPublicacao(req.headers.get('Authorization')!, familiaIds),
    llm: (entradaIA, alvos) => desempatarAtributosLLM(entradaIA, alvos, modeloTexto),
    marcaPadrao,
  }, input);
```

- [ ] **Step 2: Typecheck e lint**

Run: `pnpm tsc -b --force && pnpm lint:functions`
Expected: sem erros novos.

- [ ] **Step 3: Rodar a suíte de testes de kit vinculado de novo (garantia de que a fiação em
  index.ts não quebrou nada que processar.test.ts exercite indiretamente)**

Run: `pnpm vitest run supabase/functions/criar-kit-vinculado/__tests__/processar.test.ts`
Expected: PASS (sem mudança — este teste chama `criarKitsVinculados` direto, não passa por
`index.ts`; é só uma garantia de não ter quebrado import/tipo).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/criar-kit-vinculado/index.ts
git commit -m "feat(kit): index.ts parseia categoria_override e liga IA/marcaPadrao reais"
```

---

### Task 3: Frontend — `criarKitVinculado` aceita `categoriaOverride`

**Files:**
- Modify: `src/lib/kit.ts:204-216` (função `criarKitVinculado`)

**Interfaces:**
- Consumes: nada novo (só estende a assinatura existente).
- Produces: `criarKitVinculado(p: { familiaBaseId, kits, categoriaOverride? })` — consumido pela
  Task 4.

- [ ] **Step 1: Implementar (sem teste próprio — a Task 4 cobre via `dialog-criar-kit.test.tsx`,
  que já mocka `criarKitVinculado` e verifica o payload; ver Global Constraints)**

Trocar a assinatura de `criarKitVinculado` (hoje):
```ts
export async function criarKitVinculado(p: {
  familiaBaseId: string; kits: KitFormValues[];
}): Promise<ResultadoCriarKit> {
  const { data, error } = await supabase.functions.invoke('criar-kit-vinculado', {
    body: {
      familia_base_id: p.familiaBaseId,
      kits: p.kits.map((k) => ({
        multiplicador: k.multiplicador, chave_cadastro: k.chaveCadastro,
        titulo: k.titulo, descricao: k.descricao,
        preco: k.preco, gtin: k.gtin, imagem_path: k.imagemPath,
        altura_cm: k.alturaCm, largura_cm: k.larguraCm, comprimento_cm: k.comprimentoCm,
        atacado: k.atacado,
      })),
    },
  });
```
por:
```ts
export async function criarKitVinculado(p: {
  familiaBaseId: string; kits: KitFormValues[];
  categoriaOverride?: { categoriaMlId: string; categoriaNome: string } | null;
}): Promise<ResultadoCriarKit> {
  const { data, error } = await supabase.functions.invoke('criar-kit-vinculado', {
    body: {
      familia_base_id: p.familiaBaseId,
      kits: p.kits.map((k) => ({
        multiplicador: k.multiplicador, chave_cadastro: k.chaveCadastro,
        titulo: k.titulo, descricao: k.descricao,
        preco: k.preco, gtin: k.gtin, imagem_path: k.imagemPath,
        altura_cm: k.alturaCm, largura_cm: k.larguraCm, comprimento_cm: k.comprimentoCm,
        atacado: k.atacado,
      })),
      categoria_override: p.categoriaOverride
        ? { categoria_ml_id: p.categoriaOverride.categoriaMlId, categoria_nome: p.categoriaOverride.categoriaNome }
        : null,
    },
  });
```

(o resto da função, tratamento de `error`/`data`, não muda)

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc -b --force`
Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add src/lib/kit.ts
git commit -m "feat(kit): criarKitVinculado aceita categoriaOverride opcional"
```

---

### Task 4: Frontend — UI "Trocar categoria" no diálogo de criar kit

**Files:**
- Modify: `src/components/kit/dialog-criar-kit.tsx`
- Test: `src/components/kit/__tests__/dialog-criar-kit.test.tsx`

**Interfaces:**
- Consumes: `criarKitVinculado({ familiaBaseId, kits, categoriaOverride })` (Task 3);
  `buscarCategoriaML(familiaId: string, query: string) => Promise<{candidatos:
  CategoriaCandidata[], sugestaoConcorrente: CategoriaCandidata | null}>` (`src/lib/queries.ts:545`,
  já existe); `CategoriaCandidata` (`src/lib/tipos-dominio.ts`, campos `categoriaId`,
  `categoriaNome`, já existe).
- Produces: nada consumido por outra task — ponta de UI.

- [ ] **Step 1: Escrever os testes que falham**

Abrir `src/components/kit/__tests__/dialog-criar-kit.test.tsx`. `dialog-criar-kit.tsx` já importa
`QK` e `KitVinculado` de `@/lib/queries` (linha 14) — o mock precisa preservar esses exports reais,
mesmo padrão já usado no mesmo arquivo de teste para `@/lib/kit` (linhas 27-30):

```ts
const buscarCategoriaMLMock = vi.fn();
vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/queries')>();
  return { ...actual, buscarCategoriaML: (...args: unknown[]) => buscarCategoriaMLMock(...args) };
});
```

Adicionar este bloco de testes ao arquivo (dentro do `describe` existente, ou em um novo
`describe('Trocar categoria', ...)`):

Reaproveitar o helper `renderDialog`/`avancarECriar` e a fixture `BASE_COM_FOTO` já existentes no
mesmo arquivo. Assinatura real (linhas 81-96): `function renderDialog(kitsExistentes:
KitVinculado[], base: BaseParaKit = BASE)` — sempre passa `familiaBaseId="familia-base-1"`
fixo. `avancarECriar()` clica no checkbox `'Kit de 2 unidades'`, depois no botão `'Avançar'`,
depois em `'Criar e publicar'` — rótulos exatos já usados pelos testes existentes, não inventar
outros. `BASE_COM_FOTO` evita ter que escolher arquivo de foto pra `podeCriar` virar `true`, fora
do escopo deste teste.

```ts
describe('Trocar categoria', () => {
  it('botão "Trocar categoria" abre a busca; escolher uma categoria mostra o chip e entra no payload', async () => {
    buscarCategoriaMLMock.mockResolvedValue({
      candidatos: [{ categoriaId: 'MLB999', categoriaNome: 'Leite Infantil', domainId: '', domainName: '' }],
      sugestaoConcorrente: null,
    });
    criarKitVinculadoMock.mockResolvedValue({ ok: true, kits: [], publicacaoOk: true, loteId: null });
    renderDialog([], BASE_COM_FOTO);

    await userEvent.click(screen.getByRole('button', { name: 'Trocar categoria' }));
    await userEvent.type(screen.getByPlaceholderText(/buscar categoria/i), 'leite infantil');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(screen.getByText('Leite Infantil')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Leite Infantil'));

    expect(screen.getByText(/Categoria: Leite Infantil/)).toBeInTheDocument();
    expect(buscarCategoriaMLMock).toHaveBeenCalledWith('familia-base-1', 'leite infantil');

    await avancarECriar();

    await waitFor(() => expect(criarKitVinculadoMock).toHaveBeenCalled());
    const chamada = criarKitVinculadoMock.mock.calls[0][0] as { categoriaOverride?: unknown };
    expect(chamada.categoriaOverride).toEqual({ categoriaMlId: 'MLB999', categoriaNome: 'Leite Infantil' });
  });

  it('"×" no chip remove o override — volta a herdar a categoria da base', async () => {
    buscarCategoriaMLMock.mockResolvedValue({
      candidatos: [{ categoriaId: 'MLB999', categoriaNome: 'Leite Infantil', domainId: '', domainName: '' }],
      sugestaoConcorrente: null,
    });
    renderDialog([], BASE_COM_FOTO);
    await userEvent.click(screen.getByRole('button', { name: 'Trocar categoria' }));
    await userEvent.type(screen.getByPlaceholderText(/buscar categoria/i), 'leite');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => screen.getByText('Leite Infantil'));
    await userEvent.click(screen.getByText('Leite Infantil'));
    expect(screen.getByText(/Categoria: Leite Infantil/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remover categoria escolhida' }));
    expect(screen.queryByText(/Categoria: Leite Infantil/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar os testes novos e confirmar que falham**

Run: `pnpm vitest run src/components/kit/__tests__/dialog-criar-kit.test.tsx`
Expected: FAIL — botão "Trocar categoria" não existe ainda.

- [ ] **Step 3: Implementar em `dialog-criar-kit.tsx`**

Adicionar aos imports:
```ts
import { Input } from '@/components/ui/input';
import { buscarCategoriaML } from '@/lib/queries';
import type { CategoriaCandidata } from '@/lib/tipos-dominio';
```

No corpo do componente `DialogCriarKit`, junto aos outros `useState` (hoje: `etapa`, `marcados`,
`chaves`, `valores`), adicionar:
```ts
  const [categoriaOverride, setCategoriaOverride] = useState<{ categoriaMlId: string; categoriaNome: string } | null>(null);
  const [buscaCategoriaAberta, setBuscaCategoriaAberta] = useState(false);
  const [queryCategoria, setQueryCategoria] = useState('');
  const [candidatosCategoria, setCandidatosCategoria] = useState<CategoriaCandidata[]>([]);
  const [buscandoCategoria, setBuscandoCategoria] = useState(false);
```

Adicionar a função de busca (perto de outras funções auxiliares do componente):
```ts
  async function buscarCategoria() {
    if (!queryCategoria.trim()) return;
    setBuscandoCategoria(true);
    try {
      const r = await buscarCategoriaML(familiaBaseId, queryCategoria);
      setCandidatosCategoria(r.candidatos);
    } catch (e) {
      toast.error('Erro ao buscar categoria', { description: (e as Error).message });
    } finally {
      setBuscandoCategoria(false);
    }
  }
```

Adicionar o bloco de UI (na etapa `tamanhos`, antes da lista de tamanhos marcáveis — um único
bloco pra toda a submissão, não por tamanho):
```tsx
      <div className="flex flex-col gap-1.5">
        {categoriaOverride ? (
          <div className="flex items-center gap-1.5 text-xs">
            <span>Categoria: {categoriaOverride.categoriaNome}</span>
            <Button
              type="button" variant="ghost" size="sm" className="h-5 px-1"
              aria-label="Remover categoria escolhida"
              onClick={() => { setCategoriaOverride(null); setCandidatosCategoria([]); setQueryCategoria(''); }}
            >
              ×
            </Button>
          </div>
        ) : !buscaCategoriaAberta ? (
          <Button type="button" variant="outline" size="sm" className="h-7 w-fit text-xs" onClick={() => setBuscaCategoriaAberta(true)}>
            Trocar categoria
          </Button>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-1">
              <Input
                className="h-8 text-xs"
                placeholder="Buscar categoria (ex.: leite infantil)"
                value={queryCategoria}
                onChange={(e) => setQueryCategoria(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && buscarCategoria()}
              />
              <Button type="button" size="sm" className="h-8 px-2" onClick={buscarCategoria} disabled={buscandoCategoria}>
                Buscar
              </Button>
            </div>
            {candidatosCategoria.map((c) => (
              <button
                key={c.categoriaId}
                type="button"
                onClick={() => {
                  setCategoriaOverride({ categoriaMlId: c.categoriaId, categoriaNome: c.categoriaNome });
                  setBuscaCategoriaAberta(false);
                }}
                className="rounded-md border p-1.5 text-left text-xs hover:bg-accent"
              >
                {c.categoriaNome}
              </button>
            ))}
          </div>
        )}
      </div>
```

Na mutation de submissão, trocar a chamada final (hoje):
```ts
      return criarKitVinculado({ familiaBaseId, kits });
```
por:
```ts
      return criarKitVinculado({ familiaBaseId, kits, categoriaOverride });
```

Resetar `categoriaOverride`/`buscaCategoriaAberta`/`queryCategoria`/`candidatosCategoria` junto de
onde o diálogo já reseta `etapa`/`marcados`/`chaves`/`valores` ao fechar (mesmo `useEffect` ou
handler de reset existente — ler o componente pra achar o ponto exato, não criar um segundo
mecanismo de reset em paralelo).

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm vitest run src/components/kit/__tests__/dialog-criar-kit.test.tsx`
Expected: PASS — todos os testes, novos e pré-existentes.

- [ ] **Step 5: Typecheck e lint**

Run: `pnpm tsc -b --force && pnpm lint`
Expected: sem erros novos.

- [ ] **Step 6: QA visual manual**

Rodar `pnpm dev`, abrir a tela Publicados, clicar em "Criar kit" de qualquer produto-base, clicar
em "Trocar categoria", buscar uma categoria real (ex.: "leite infantil"), escolher uma, confirmar
que o chip aparece e que o "×" volta ao estado herdado. Print antes/depois se houver dúvida visual.

- [ ] **Step 7: Commit**

```bash
git add src/components/kit/dialog-criar-kit.tsx src/components/kit/__tests__/dialog-criar-kit.test.tsx
git commit -m "feat(kit): UI Trocar categoria no dialogo de criar kit"
```

---

## Depois de todas as tasks

1. `pnpm preflight` completo (gate real de pré-push).
2. Atualizar `docs/decisions/0151-kit-vinculado-a-partir-de-produto-existente.md` com um novo item
   registrando esta decisão (categoria própria opcional do kit) — mesma seção "Implementação"
   usada para os itens anteriores.
3. Fable revisa o diff completo (pedido do Diego) antes do merge.
4. Merge → deploy das Edge Functions afetadas (`criar-kit-vinculado` no mínimo; checar fecho real
   de `_shared/` tocado, se algum arquivo compartilhado mudou) → conferir versão pós-deploy.
