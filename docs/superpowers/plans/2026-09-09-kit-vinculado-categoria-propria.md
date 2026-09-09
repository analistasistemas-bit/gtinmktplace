# Kit vinculado — categoria própria Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que, ao criar um kit vinculado (ADR-0151), o operador escolha opcionalmente uma
categoria do Mercado Livre diferente da categoria do produto-base.

**Architecture:** Sem override, nada muda (categoria continua herdada da base). Com override, o
backend resolve schema + atributos-base para a categoria NOVA (mesma lógica curada/genérica+IA que
`definir-categoria-familia` já usa para produtos normais, chamada diretamente — sem extrair função
compartilhada, por ser só um if/else pequeno e não valer o acoplamento entre os dois arquivos),
herda da base os atributos textuais (`value_name`) que a categoria nova também declara e a
resolução não preencheu (cobre `NET_WEIGHT`, que nem o caminho curado nem o genérico+IA preenchem
sozinhos), recalcula `atributos_faltantes`/`tipo_aviamento` pra essa categoria nova (o gate de
publicação lê esses dois campos, e sem recalculá-los o kit herdaria os da base — categoria antiga
— e publicaria às cegas) e só então aplica `aplicarKitNosAtributos` por cima, como hoje.
`montarFamiliaKit` grava a categoria do override em vez de clonar da base. 3 achados desta lista
(herança de `NET_WEIGHT`, gate de faltantes, `tipo_aviamento`) vieram da revisão do Fable sobre
uma primeira versão deste plano que não os cobria — ver o aviso no início da Task 1.

**Tech Stack:** Deno Edge Functions (Supabase), TypeScript, React + Vitest/Testing Library no
front.

**Spec:** `docs/superpowers/specs/2026-09-09-kit-vinculado-categoria-propria-design.md`

## Global Constraints

- Roteamento de modelos do CLAUDE.md do projeto: nenhuma tarefa deste plano desce para o modelo
  mais barato — todas tocam o payload de publicação em marketplace (ADR-0151), e a regra do
  CLAUDE.md é "nunca rebaixar modelo em... publicação em marketplace". Todas as 3 tarefas rodam no
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

**Contexto crítico desta task (achado na revisão do Fable, verificado no código real antes de
escrever este plano):**

1. **Gate de publicação lê `familia.tipo_aviamento`/`familia.atributos_faltantes` — nenhum dos
   dois está em `STRIP_FAMILIA_KIT`.** `publish-familia-ml/processar.ts:147-151` decide se pode
   publicar assim: `categoriaParaTipo(tipoAviamento) != null ? atributosFaltantes(...) :
   (categoria_ml_id ? atributos_faltantes : ['CATEGORIA'])`. Sem tocar esses dois campos no kit
   com override, `montarFamiliaKit` clona os da BASE (que refletem a categoria ANTIGA, já
   publicada, `atributos_faltantes=[]`) — o gate passaria mesmo se a categoria nova exigisse
   atributos que não foram resolvidos. Kit não tem Revisão pra pegar isso depois (D-3/D-4,
   ADR-0151) — tem que travar aqui, na criação, ou nunca mais.
2. **`resolverAtributosGenericos` não preenche `NET_WEIGHT` (nem nenhum atributo `number`/
   `number_unit`, exceto `THICKNESS` via `preencherMedidasObvias`).** Confirmado lendo
   `_shared/ai/atributos-llm-core.ts:114-117` e o pipeline de `resolverAtributosGenericos`
   (`preencherAtributosClosedSet` → `preencherUnitsPerPack` → `preencherNomeObrigatorio`, nenhum
   dos três cobre `NET_WEIGHT`). Sem correção, o caminho genérico (o que o caso real do Diego usa —
   "Leite Infantil" não é aviamento, cai em `tipo === 'outro'`) publicaria o kit **sem** `NET_WEIGHT`
   — reintroduz o mesmo bug (MLB7585283770) que motivou a sessão anterior, só que por ausência em
   vez de valor errado. Correção: depois de resolver `atributosBase` (curado ou genérico), herdar
   da base qualquer atributo `value_name` (nunca `value_id` — valores de lista/closed-set não são
   portáveis entre categorias) cujo `id` já existe no schema da categoria NOVA e ainda não foi
   resolvido. `aplicarKitNosAtributos` já sabe escalar `NET_WEIGHT` quando ele está presente — só
   precisava chegar até ali.

**Interfaces:**
- Consumes: `tipoParaCategoria`, `montarAtributosML`, `atributosFaltantesGenerico`
  (`_shared/categoria/atributos.ts`, já exportadas); `resolverAtributosGenericos`
  (`_shared/categoria/resolver-atributos-genericos.ts`, assinatura `(categoriaMlId: string, input:
  {nome, descricao?, fornecedor?}, deps: {lerSchema: (id: string) => Promise<AtributoSchema[]>,
  llm: (input, alvos) => Promise<Record<string, string>>}, marcaPadrao?: string) =>
  Promise<{atributosMl: AtributoML[], faltantes: string[]}>`); `InputAtributos`, `AtributoAlvo`
  (`_shared/ai/atributos-llm-core.ts`, tipos).
- Produces: `CriarKitInput.categoriaOverride?: { categoriaMlId: string; categoriaNome: string } |
  null` (novo campo, consumido pela Task 2 ao montar o input a partir do body HTTP);
  `CriarKitDeps.llm?` e `CriarKitDeps.marcaPadrao?` (novos campos opcionais, consumidos pela Task 2
  ao montar os deps reais); novo `motivo` de erro `'atributos_faltantes'` (consumido pela Task 2 em
  `STATUS_POR_MOTIVO`).

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

Adicionar, no topo do arquivo (perto de `SCHEMA_SEM_KIT`), os schemas de categoria de override
usados nos testes novos. **Atenção de forma (achado da revisão do Fable + verificação própria):**
`AtributoSchema` real (`_shared/categoria/schema.ts:10-19`) tem `required`, `conditionalRequired`,
`allowedUnits`, `tags` além de `id`/`nome`/`valueType`/`valores` — os `SCHEMA_COM_KIT`/
`SCHEMA_SEM_KIT` pré-existentes no arquivo NÃO têm esses campos porque só eram usados direto com
`aplicarKitNosAtributos`, que não olha `tags`/`required`. Os schemas novos aqui SÃO usados também
por `resolverAtributosGenericos` → `atributosFaltantesGenerico`, que acessa `a.tags.some(...)` —
sem os campos completos, isso lança `TypeError` em runtime (engolido pelo try/catch de
`resolverAtributosGenericos`, mascarando o teste). Por isso os schemas abaixo declaram TODOS os
campos, em todo item — não reaproveitar `SCHEMA_SEM_KIT`/`SCHEMA_COM_KIT` (que ficam como estão,
intocados, só para os testes pré-existentes de `aplicarKitNosAtributos`) em nenhum teste novo.

```ts
const CAMPOS_SCHEMA_PADRAO = { required: false, conditionalRequired: false, allowedUnits: [], tags: [] };

const SCHEMA_OVERRIDE_COM_KIT = [
  {
    ...CAMPOS_SCHEMA_PADRAO, id: 'SALE_FORMAT', nome: 'Formato de venda', valueType: 'list',
    valores: [{ id: 'V-UN', nome: 'Unidade' }, { id: 'V-KIT', nome: 'Kit' }],
  },
  { ...CAMPOS_SCHEMA_PADRAO, id: 'UNITS_PER_PACK', nome: 'Unidades por kit', valueType: 'number', valores: [] },
  { ...CAMPOS_SCHEMA_PADRAO, id: 'BRAND', nome: 'Marca', valueType: 'string', valores: [] },
];
// Mesmo schema, mas também declara NET_WEIGHT — usado no teste de herança/escala do atributo.
const SCHEMA_OVERRIDE_COM_KIT_E_NET_WEIGHT = [
  ...SCHEMA_OVERRIDE_COM_KIT,
  { ...CAMPOS_SCHEMA_PADRAO, id: 'NET_WEIGHT', nome: 'Peso líquido', valueType: 'number_unit', valores: [] },
];
// Categoria genérica sem "Kit" no schema — usada só nos testes novos (não reaproveita
// SCHEMA_SEM_KIT do topo do arquivo, que os testes pré-existentes de aplicarKitNosAtributos usam).
const SCHEMA_OVERRIDE_SEM_KIT = [
  { ...CAMPOS_SCHEMA_PADRAO, id: 'BRAND', nome: 'Marca', valueType: 'string', valores: [] },
];
// Categoria genérica com "Kit" MAIS um atributo obrigatório que a resolução por IA (mockada pra
// devolver {} nos testes) nunca preenche — dispara o gate de atributos_faltantes.
const SCHEMA_OVERRIDE_COM_KIT_E_OBRIGATORIO_NAO_RESOLVIDO = [
  ...SCHEMA_OVERRIDE_COM_KIT,
  {
    ...CAMPOS_SCHEMA_PADRAO, id: 'MODEL_OBRIGATORIO', nome: 'Modelo obrigatório', valueType: 'list',
    required: true, valores: [{ id: 'V1', nome: 'Opção 1' }],
  },
];
```

`depsFake` também precisa que a família-base fake já tenha `NET_WEIGHT` em `atributos_ml` pro
teste de herança. A linha real hoje (dentro da construção de `baseFamilia`) é:
```ts
    categoria_ml_id: 'MLB123', atributos_ml: [{ id: 'SALE_FORMAT', value_id: 'V-UN' }],
```
Trocar por (adiciona `NET_WEIGHT`, sem remover o que já existia):
```ts
    categoria_ml_id: 'MLB123',
    atributos_ml: [{ id: 'SALE_FORMAT', value_id: 'V-UN' }, { id: 'NET_WEIGHT', value_name: '700 g' }],
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
      schemaPorCategoria: { 'MLB123': SCHEMA_COM_KIT, 'MLB-OVERRIDE': SCHEMA_OVERRIDE_SEM_KIT },
    });
    const input: CriarKitInput = {
      familiaBaseId: BASE_ID, kits: [kitPadrao(2)],
      categoriaOverride: { categoriaMlId: 'MLB-OVERRIDE', categoriaNome: 'Sem Kit' },
    };
    const r = await criarKitsVinculados(deps, input);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('categoria_sem_kit');
  });

  it('categoriaOverride numa categoria que também declara NET_WEIGHT: herda da base e escala por N (Fable, bug MLB7585283770 de novo)', async () => {
    const { deps, inserts } = depsFake({
      schemaPorCategoria: { 'MLB123': SCHEMA_SEM_KIT, 'MLB-OVERRIDE': SCHEMA_OVERRIDE_COM_KIT_E_NET_WEIGHT },
    });
    const input: CriarKitInput = {
      familiaBaseId: BASE_ID, kits: [kitPadrao(2)],
      categoriaOverride: { categoriaMlId: 'MLB-OVERRIDE', categoriaNome: 'Categoria com peso líquido' },
    };
    const r = await criarKitsVinculados(deps, input);
    expect(r.ok).toBe(true);
    const atributos = inserts.familias[0].atributos_ml as { id: string; value_name?: string }[];
    // base tinha NET_WEIGHT '700 g' (peso de 1 unidade); kit de multiplicador 2 escala pra 1400 g —
    // mesma fórmula pesoBase × N já usada e testada pro caminho sem override.
    expect(atributos.find((a) => a.id === 'NET_WEIGHT')?.value_name).toBe('200 g');
  });

  it('categoriaOverride numa categoria SEM NET_WEIGHT no schema: não inventa o atributo (guard existente continua valendo)', async () => {
    const { deps, inserts } = depsFake({
      schemaPorCategoria: { 'MLB123': SCHEMA_SEM_KIT, 'MLB-OVERRIDE': SCHEMA_OVERRIDE_COM_KIT },
    });
    const input: CriarKitInput = {
      familiaBaseId: BASE_ID, kits: [kitPadrao(2)],
      categoriaOverride: { categoriaMlId: 'MLB-OVERRIDE', categoriaNome: 'Categoria sem peso líquido' },
    };
    const r = await criarKitsVinculados(deps, input);
    expect(r.ok).toBe(true);
    const atributos = inserts.familias[0].atributos_ml as { id: string }[];
    expect(atributos.some((a) => a.id === 'NET_WEIGHT')).toBe(false);
  });

  it('categoriaOverride com atributo obrigatório não resolvido: recusa alto ANTES de criar qualquer linha (gate Fable — kit não tem Revisão pra pegar isso depois)', async () => {
    const llmMock = vi.fn(async () => ({}));
    const { deps, inserts } = depsFake({
      schemaPorCategoria: { 'MLB123': SCHEMA_SEM_KIT, 'MLB-OVERRIDE': SCHEMA_OVERRIDE_COM_KIT_E_OBRIGATORIO_NAO_RESOLVIDO },
      llm: llmMock,
    });
    const input: CriarKitInput = {
      familiaBaseId: BASE_ID, kits: [kitPadrao(2)],
      categoriaOverride: { categoriaMlId: 'MLB-OVERRIDE', categoriaNome: 'Categoria com obrigatório' },
    };
    const r = await criarKitsVinculados(deps, input);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('atributos_faltantes');
    expect(inserts.familias).toHaveLength(0);
  });
```

Nota sobre o teste de herança de NET_WEIGHT: `peso_gramas` da variação-base no `depsFake` padrão é
`100` (default de `opts.peso_gramas`), então `pesoBase` (lido de `variacoes.peso_gramas`, não de
`atributos_ml.NET_WEIGHT`) é `100`; multiplicador 2 → `200 g`. O `NET_WEIGHT: '700 g'` que este
Step adicionou em `atributos_ml` da base só serve pra marcar QUE o atributo existe (o guard
"herda se a base tinha" olha presença, não valor) — o VALOR final vem de `pesoBase × n`, igual ao
caminho sem override; não confundir os dois números.

- [ ] **Step 2: Rodar os testes novos e confirmar que falham**

Run: `cd supabase/functions && deno test --allow-none criar-kit-vinculado/__tests__/processar.test.ts 2>&1 | head -60`
(ou, se o projeto rodar esses testes via vitest: `pnpm vitest run supabase/functions/criar-kit-vinculado/__tests__/processar.test.ts`)
Expected: FAIL — `categoriaOverride` não existe em `CriarKitInput`, `depsFake` não aceita os campos
novos (erro de tipo/compilação), ou os 7 testes novos falham porque o código de produção ainda não
lê `categoriaOverride`.

- [ ] **Step 3: Implementar em `processar.ts`**

Adicionar aos imports do topo do arquivo (a lista atual começa com `import type { SupabaseClient }
...`):

```ts
import {
  aplicarKitNosAtributos, tipoParaCategoria, montarAtributosML, atributosFaltantesGenerico,
  FALTANTE_ATRIBUTOS_NAO_VALIDADOS, type AtributoML,
} from '../_shared/categoria/atributos.ts';
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
    // tipoAviamentoKit/faltantesKit só existem — e só são LIDOS (mais abaixo, ao montar
    // familiaObj) — no ramo COM override. Declarados aqui fora só pra ficarem visíveis depois do
    // if/else; o gate de faltantes mora DENTRO do else (Fable, 2ª revisão: gate fora do if/else
    // rodaria também no caminho padrão — QUALQUER família fake dos testes pré-existentes tem
    // `atributos_faltantes` preenchido pela string genérica que `linhaFamiliaCheia` usa pra toda
    // coluna sem override explícito, e essa string não tem `.join` — `TypeError` em todo teste
    // que não passa `categoriaOverride`, e regressão real: hoje uma base com
    // `atributos_faltantes` não vazio ainda cria o kit, só trava depois no publish).
    let tipoAviamentoKit: string | undefined;
    let faltantesKit: string[] | undefined;
    if (!input.categoriaOverride) {
      // Caminho intocado: mesma categoria/atributos da base, como hoje. tipo_aviamento/
      // atributos_faltantes da base seguem herdados por montarFamiliaKit (clone), sem tocar aqui.
      atributosBase = (base.atributos_ml as AtributoML[] | null) ?? [];
    } else {
      const tipo = tipoParaCategoria(categoriaAlvo);
      tipoAviamentoKit = tipo;
      // Sentinela de falha do LLM (Fable, 3ª revisão): resolverAtributosGenericos engole erro
      // interno (rede/parse) e devolve `{atributosMl:[], faltantes:[FALTANTE_ATRIBUTOS_NAO_VALIDADOS]}`
      // — sem preservar esse sinal, o recálculo de faltantes abaixo (que ignora
      // resolvido.faltantes de propósito, ver comentário mais adiante) apagaria a única prova de
      // que a IA nem chegou a rodar, e um schema sem obrigatórios além do que a portabilidade
      // cobre publicaria com ficha vazia e nenhum erro.
      let faltantesSentinela: string[] | null = null;
      if (tipo !== 'outro') {
        atributosBase = montarAtributosML(
          tipo, base.nome_pai as string, (base.fornecedor as string | null) ?? undefined,
          (base.descricao_pai as string | null) ?? undefined, deps.marcaPadrao,
        );
      } else {
        const llm = deps.llm ?? (() => Promise.resolve({} as Record<string, string>));
        // `lerSchema` devolve o schema JÁ lido acima (evita 2º fetch de rede pra mesma
        // categoria — achado da revisão do Fable: um 2º fetch falho/vazio faria
        // resolverAtributosGenericos travar em "schema vazio" mesmo com o 1º fetch ok).
        const resolvido = await resolverAtributosGenericos(
          categoriaAlvo,
          {
            nome: base.nome_pai as string,
            descricao: (base.descricao_pai as string | null) ?? undefined,
            fornecedor: (base.fornecedor as string | null) ?? undefined,
          },
          { lerSchema: () => Promise.resolve(schema), llm },
          deps.marcaPadrao,
        );
        atributosBase = resolvido.atributosMl;
        if (resolvido.faltantes.includes(FALTANTE_ATRIBUTOS_NAO_VALIDADOS)) {
          faltantesSentinela = resolvido.faltantes;
        }
      }
      // Portabilidade de atributos textuais (Fable, revisão do plano): NET_WEIGHT e outros
      // atributos `value_name` (nunca `value_id` — valores de lista não são portáveis entre
      // categorias) do produto-base valem na categoria nova também, se ela os declarar e a
      // resolução acima ainda não os tiver preenchido. Nem montarAtributosML nem
      // resolverAtributosGenericos preenchem number/number_unit (exceto THICKNESS) — sem isto
      // NET_WEIGHT nunca chegaria a aplicarKitNosAtributos pra ser escalado por N. Exclui também
      // `list`/`boolean` no schema NOVO (sugestão da revisão Fable): o mesmo id pode ser texto
      // livre numa categoria e lista fechada na outra — herdar o texto cru pra um `value_id`
      // esperado publicaria errado sem nenhum erro visível.
      const schemaPorId = new Map(schema.map((s) => [s.id, s]));
      const idsJaResolvidos = new Set(atributosBase.map((a) => a.id));
      const portaveis = ((base.atributos_ml as AtributoML[] | null) ?? [])
        .filter((a) => {
          const alvo = schemaPorId.get(a.id);
          return a.value_name != null && !a.value_id && alvo != null
            && alvo.valueType !== 'list' && alvo.valueType !== 'boolean'
            && !idsJaResolvidos.has(a.id);
        });
      atributosBase = [...atributosBase, ...portaveis];
      // Recalcula faltantes DEPOIS da portabilidade (não usa resolvido.faltantes direto — ele foi
      // calculado ANTES dos atributos portáveis entrarem, listaria falso-faltante em atributo que
      // a portabilidade acabou de preencher) — EXCETO quando é a sentinela de falha da IA, que
      // preserva-se sempre (ver comentário acima). Recálculo só se aplica à categoria genérica:
      // curada (tipo !== 'outro') nunca teve checagem de faltantes, mesma limitação pré-existente
      // do caminho de definir-categoria-familia — não é regressão introduzida aqui.
      faltantesKit = faltantesSentinela
        ?? (tipo !== 'outro' ? [] : atributosFaltantesGenerico(atributosBase, schema));
      // Gate LOUD antes de criar qualquer linha (Fable): kit não passa por Revisão (D-3/D-4,
      // ADR-0151) — se a categoria nova exige atributo que não foi resolvido, falha aqui ou nunca
      // mais. Mesma regra de ouro do ADR-0051 (não publica às cegas). SÓ roda aqui dentro do
      // ramo com override — no caminho padrão nada disso é calculado nem checado.
      if (faltantesKit.length > 0) {
        return {
          ok: false, motivo: 'atributos_faltantes',
          mensagem: `A categoria escolhida exige atributos que não foram resolvidos: ${faltantesKit.join(', ')}.`,
        };
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
        // Gate de publicação (publish-familia-ml/processar.ts:147-151) lê estes dois campos pra
        // decidir se pode publicar — sem sobrescrever aqui, o kit herdaria os da BASE (categoria
        // antiga, atributos_faltantes=[] porque a base já publicou) e o gate passaria assim mesmo,
        // mesmo com a categoria nova exigindo algo não resolvido (bloqueante da revisão Fable).
        familiaObj.tipo_aviamento = tipoAviamentoKit;
        familiaObj.atributos_faltantes = faltantesKit;
      }
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm vitest run supabase/functions/criar-kit-vinculado/__tests__/processar.test.ts`
Expected: PASS — todos os testes, incluindo os 7 novos e todos os pré-existentes (nenhuma
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
import { ehCategoriaMlValida } from '../_shared/categoria/schema.ts';
```

Adicionar `atributos_faltantes: 400,` ao mapa `STATUS_POR_MOTIVO` (hoje começa com
`multiplicador_invalido: 400,` — acrescentar a chave nova em qualquer linha do objeto, mesmo
padrão das outras entradas 400 já existentes).

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
    // Mesma validação de definir-categoria-familia/index.ts:50 (achado da revisão do Fable):
    // sem isto, um categoria_ml_id malformado (ex.: contendo '../') vira uma chamada HTTP
    // autenticada com o token do vendedor pra uma URL arbitrária dentro de lerSchemaAtributos, e
    // sem validar cedo o erro real fica escondido atrás de "categoria não oferece Kit".
    if (!ehCategoriaMlValida(co.categoria_ml_id)) {
      return json({ error: 'categoria_override.categoria_ml_id inválido (formato esperado: MLB seguido de dígitos).' }, 400);
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

### Task 3: Frontend — `criarKitVinculado` + UI "Trocar categoria" no diálogo de criar kit

(Dobra o que seria uma Task 3 separada pro wrapper `criarKitVinculado` — Fable, revisão do plano:
6 linhas, único consumidor é esta mesma UI, mesmo commit, não vale uma task/modelo à parte.)

**Files:**
- Modify: `src/lib/kit.ts:204-216` (função `criarKitVinculado`)
- Modify: `src/components/kit/dialog-criar-kit.tsx`
- Test: `src/components/kit/__tests__/dialog-criar-kit.test.tsx`

**Interfaces:**
- Consumes: `buscarCategoriaML(familiaId: string, query: string) => Promise<{candidatos:
  CategoriaCandidata[], sugestaoConcorrente: CategoriaCandidata | null}>` (`src/lib/queries.ts:545`,
  já existe); `CategoriaCandidata` (`src/lib/tipos-dominio.ts:146-150` — só `categoriaId`,
  `categoriaNome`, `domainName`; **não tem `domainId`**, achado da revisão do Fable — não incluir
  esse campo nas fixtures de teste).
- Produces: nada consumido por outra task — ponta de UI.

- [ ] **Step 1: Implementar `criarKitVinculado` em `src/lib/kit.ts` (sem teste próprio — o Step 5
  cobre via `dialog-criar-kit.test.tsx`, que já mocka `criarKitVinculado` e vai verificar o
  payload)**

Trocar a assinatura de `criarKitVinculado` (hoje, linhas 204-216):
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

- [ ] **Step 2: Escrever os testes que falham**

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
      candidatos: [{ categoriaId: 'MLB999', categoriaNome: 'Leite Infantil', domainName: '' }],
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
      candidatos: [{ categoriaId: 'MLB999', categoriaNome: 'Leite Infantil', domainName: '' }],
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

- [ ] **Step 3: Rodar os testes novos e confirmar que falham**

Run: `pnpm vitest run src/components/kit/__tests__/dialog-criar-kit.test.tsx`
Expected: FAIL — botão "Trocar categoria" não existe ainda.

- [ ] **Step 4: Implementar em `dialog-criar-kit.tsx`**

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

Adicionar o bloco de UI **fora do ternário `{etapa === 'tamanhos' ? (...) : (...)}`** — entre o
`</DialogHeader>` e esse ternário — pra aparecer nas duas etapas, não só em `tamanhos` (achado da
revisão do Fable: "kit não passa pela Revisão, o preview do diálogo É a revisão" — se o controle
de categoria só existisse na etapa de escolher tamanho, ficaria invisível bem na etapa que
efetivamente revisa antes de publicar). Um único bloco pra toda a submissão, não por tamanho:
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

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm vitest run src/components/kit/__tests__/dialog-criar-kit.test.tsx`
Expected: PASS — todos os testes, novos e pré-existentes.

- [ ] **Step 6: Typecheck e lint**

Run: `pnpm tsc -b --force && pnpm lint`
Expected: sem erros novos.

- [ ] **Step 7: QA visual manual**

Rodar `pnpm dev`, abrir a tela Publicados, clicar em "Criar kit" de qualquer produto-base, clicar
em "Trocar categoria", buscar uma categoria real (ex.: "leite infantil"), escolher uma, confirmar
que o chip aparece e que o "×" volta ao estado herdado. Print antes/depois se houver dúvida visual.

- [ ] **Step 8: Commit**

```bash
git add src/lib/kit.ts src/components/kit/dialog-criar-kit.tsx src/components/kit/__tests__/dialog-criar-kit.test.tsx
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
