# E3 — Resolução de categoria genérica + schema dinâmico de atributos (design)

**Data:** 2026-06-14 · **ADR:** [0026](../../decisions/0026-generalizacao-categorizacao-atributos-por-ia.md) · **Épico:** Fase 1 / E3 da [evolução SaaS](2026-06-13-evolucao-saas-multicanal-design.md)

## Objetivo

Qualquer produto (não só aviamento) recebe **categoria-folha do ML** + **lista de atributos obrigatórios**
corretos, **sem código novo por nicho** e **sem regressão** nos aviamentos atuais. O preenchimento dos
*valores* dos atributos por IA é o **E4** (fora deste spec).

## Não-objetivos (YAGNI / outros épicos)
- Taxonomia canônica + `mapping_categoria_canal` → **E5** (só rende com 2+ canais).
- Preenchimento de valores de atributo por IA (closed-set) → **E4**.
- Vision no desempate de categoria → **E4/ambiguidade real**.

## Arquitetura

Resolução de categoria em camadas, **primeira que vencer manda**, orquestrada por uma função pura com
dependências injetadas (testável sem rede):

```
resolverCategoria(input, deps)
  1. override(input.nome)            → casou tipo conhecido?  → {regex,  alta}
  2. deps.preditor(input.nome)       → topo do domain_discovery → {preditor, média}
       └─ ambíguo (≥2 domains)?  → deps.llm(input, candidatos) → {ia, baixa}  (closed-set)
  3. nada                            → {outro, manual=pendente} (operador escolhe na Revisão)
```

Schema de atributos lido sob demanda da API do ML, cacheado, e comparado contra o que temos para listar os
**obrigatórios faltantes**.

### Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `_shared/ml/domain-discovery.ts` (novo) | `parseDomainDiscovery(body)` (puro) → `CategoriaCandidata[]`; `buscarCategoriaPreditor(token, query)` (rede + cache Redis). |
| `_shared/categoria/schema.ts` (novo) | `parseAtributosSchema(body)` (puro) → `AtributoSchema[]`; `idsObrigatorios(schema)` (puro); `nomesObrigatorios(schema)` (puro); `lerSchemaAtributos(token, categoriaId)` (rede + cache Redis). |
| `_shared/categoria/resolver.ts` (novo) | `resolverCategoria(input, deps)` (puro, deps injetadas) → `ResultadoCategoria`. |
| `_shared/categoria/detectar.ts` (existe) | `detectarTipoAviamento` vira o **override**; ganha `categoriaParaTipo`/`rotuloParaTipo` reexpostos como "registro de overrides". |
| `_shared/categoria/atributos.ts` (existe) | `montarAtributosBase(...)` (novo, BRAND/MODEL/EMPTY_GTIN_REASON p/ categoria prevista) + `atributosFaltantesGenerico(temAtributos, schema)` (novo). Funções por-tipo **intactas** (overrides). |
| `_shared/ai/categoria-llm.ts` (novo) | `desempatarCategoriaLLM(input, candidatos)` — escolhe 1 `category_id` **do closed-set**; fallback = topo. |
| `process-familia/index.ts` (modifica) | Troca o bloco 5c por `resolverCategoria(...)` + leitura de schema + faltantes; iça `getValidAccessToken` 1×. |
| `src/components/card-categoria.tsx` (modifica) | Mostra `categoria_nome` + selo de origem + lista de obrigatórios faltantes. |
| migration (nova) | `ALTER TYPE tipo_origem ADD VALUE 'preditor'` + `familias.categoria_nome text` + `familias.atributos_faltantes jsonb`. |

## Contratos (tipos)

```ts
// _shared/ml/domain-discovery.ts
export interface CategoriaCandidata {
  domainId: string;       // "MLB-ELECTRIC_DRILLS"
  domainName: string;     // "Furadeiras elétricas"
  categoriaId: string;    // "MLB189007" (folha)
  categoriaNome: string;  // "De Mão"
}

// _shared/categoria/schema.ts
export interface AtributoSchema {
  id: string;                 // "VOLTAGE"
  nome: string;               // "Voltagem"
  required: boolean;          // tags.required
  conditionalRequired: boolean; // tags.conditional_required
  valores: { id: string; nome: string }[]; // values[] (closed-set; usado no E4)
}

// _shared/categoria/resolver.ts
export type OrigemCategoria = 'regex' | 'preditor' | 'ia' | 'manual';
export interface ResultadoCategoria {
  categoriaId: string | null;   // null → 'outro' (operador escolhe)
  categoriaNome: string | null; // rótulo humano p/ a Revisão
  tipo: TipoAviamento;          // override casou → o tipo; senão 'outro'
  origem: OrigemCategoria;
}
export interface DepsResolver {
  preditor: (nome: string) => Promise<CategoriaCandidata[]>;
  llm?: (input: InputCategoria, candidatos: CategoriaCandidata[]) => Promise<string | null>; // category_id
}
```

## Regras de decisão

### Override (camada 1)
`detectarTipoAviamento(nome)` casou `linha|fita|botao|cola` → `{categoriaId: categoriaParaTipo(tipo),
categoriaNome: rótulo, tipo, origem:'regex'}`. **Idêntico ao comportamento atual** → zero regressão.

### Preditor (camada 2)
`buscarCategoriaPreditor(token, nome)`:
- `GET https://api.mercadolibre.com/sites/MLB/domain_discovery/search?limit=8&q={nome}` (Bearer).
- `parseDomainDiscovery` filtra itens com `category_id` presente e mapeia para `CategoriaCandidata`.
- Cache Redis `dd:{sha-ish da query normalizada}` TTL 30d (categorização muda raro; ML recategoriza, mas o
  cache é verificável e barato de invalidar reprocessando).
- Lista vazia (`[]`) → sem candidatos.

Resolução: candidatos não-vazios → `topo` (`candidatos[0]`) vira a categoria (`origem:'preditor'`), **a não
ser que** haja ambiguidade (ver abaixo).

### Desempate LLM (camada 2b) — gatilho de ambiguidade
Aciona **só quando** `deps.llm` existe **e** os candidatos contêm **≥2 `domainId` distintos** (sinal de
dúvida real; quando todos os candidatos são do mesmo domain, o topo é confiável). O LLM recebe nome +
descrição + a lista de candidatos e devolve **um `categoria_id` que DEVE estar na lista**; se devolver algo
fora da lista ou falhar → usa o `topo` (nunca inventa). Origem `'ia'` quando o LLM escolheu um candidato ≠
topo; caso contrário permanece `'preditor'`.

> Racional: o probe (2026-06-14) mostrou o topo correto em todas as verticais testadas; o desempate é uma
> rede de segurança barata para casos genuinamente ambíguos, não o caminho comum.

### Fallback (camada 3)
Sem override e preditor vazio → `{categoriaId:null, categoriaNome:null, tipo:'outro', origem:'manual'}`.
`categoria_ml_id` nula faz o `CardCategoria` exibir o seletor manual (comportamento atual).

### Resiliência
`buscarCategoriaPreditor`/`lerSchemaAtributos` que lancem (rede/token/ML 4xx) são **engolidos** no
`process-familia` (try/catch) → cai para override-ou-`outro`; **nunca** derruba o processamento da família.

## Schema dinâmico + faltantes

`lerSchemaAtributos(token, categoriaId)`:
- `GET /categories/{id}/attributes` (Bearer), cache Redis `attrs:{categoriaId}` TTL 30d.
- `parseAtributosSchema` → `AtributoSchema[]` (lê `tags.required`/`tags.conditional_required`, `values[]`).

`montarAtributosBase(categoriaId, schema, nome, marca, detalhe)` — para **categoria prevista** (sem
override): preenche só o **determinístico universal**:
- `BRAND` = `marca` (fornecedor, fallback "Avil") quando o schema tem BRAND.
- `MODEL` = `nome` quando o schema tem MODEL.
- `EMPTY_GTIN_REASON` quando `categoriaAceitaEmptyGtinReason` e sem GTIN real (reusa a lógica atual).
- Atributos com `values[]` (closed-set, ex.: VOLTAGE) ficam **vazios** → E4 preenche.

Para **override** (aviamento), segue `montarAtributosML` por-tipo (inalterado).

`atributosFaltantesGenerico(temAtributos: AtributoML[], schema: AtributoSchema[])` → `string[]` (nomes):
os atributos `required` (e `conditional_required` que tratamos) cujo `id` não está em `temAtributos`.
Persistido em `familias.atributos_faltantes` (snapshot p/ a Revisão).

## Integração — `process-familia` (bloco 5c)

```ts
// iça o token 1× (resolver + gross-up usam)
let token: string | null = null;
try { token = await getValidAccessToken(userId); } catch { /* resiliente */ }

const cat = await resolverCategoria(
  { nome: claimed.nome_pai, descricao: claimed.descricao_pai ?? undefined },
  {
    preditor: (q) => token ? buscarCategoriaPreditor(token, q) : Promise.resolve([]),
    llm: desempatarCategoriaLLM,
  },
);

const categoriaMlId = cat.categoriaId;            // alimenta o gross-up (igual hoje)
let atributosMl: AtributoML[] = [];
let faltantes: string[] = [];
if (cat.origem === 'regex') {
  atributosMl = montarAtributosML(cat.tipo, claimed.nome_pai, fornecedor, claimed.descricao_pai);
} else if (categoriaMlId && token) {
  try {
    const schema = await lerSchemaAtributos(token, categoriaMlId);
    atributosMl = montarAtributosBase(categoriaMlId, schema, claimed.nome_pai, fornecedor, claimed.descricao_pai);
    faltantes = atributosFaltantesGenerico(atributosMl, schema);
  } catch (e) { console.error('schema atributos falhou:', e); }
}
```

Persistência (update da família) ganha:
`tipo_origem: cat.origem`, `categoria_ml_id: categoriaMlId`, `categoria_nome: cat.categoriaNome`,
`atributos_ml: atributosMl`, `atributos_faltantes: faltantes`. `tipo_aviamento: cat.tipo` (segue o enum;
preditor/ia → `'outro'`).

> O `getValidAccessToken` já era chamado no bloco do gross-up; passa a ser içado uma vez e reaproveitado
> (resolver + listing-price). Sem chamada extra de token.

## Frontend — `CardCategoria`

- `categoriaIndefinida` (sem `categoriaMlId`) → seletor manual (**inalterado**).
- Com categoria: exibe `familia.categoriaNome ?? nomeCategoriaAmigavel(tipo)` (cobre override e preditor) +
  o `categoriaMlId`.
- **Selo de origem** quando `tipoOrigem` ∈ {`preditor`,`ia`}: chip "sugerida por IA — confira"
  (`StatusPill` tom `info`/`warning`). Override/manual → sem selo (alta confiança).
- **Obrigatórios faltantes**: se `familia.atributosFaltantes?.length`, lista "Faltam: Marca, Voltagem…"
  (tom `warning`) — sinaliza ao operador o que o E4 vai preencher.
- Tipos `Familia` (`src/lib/tipos-dominio.ts`) + adapter (`src/lib/queries.ts`) ganham `categoriaNome` e
  `atributosFaltantes`.

## Testes (TDD)

Puros (sem rede):
- `parseDomainDiscovery`: array real do probe → candidatos; item sem `category_id` é descartado; `[]` → `[]`.
- `parseAtributosSchema`: shape real → flags `required`/`conditional_required` + `values[]`.
- `idsObrigatorios`/`nomesObrigatorios`: filtra required + conditional_required.
- `resolverCategoria`: (a) override casa → regex; (b) sem override, preditor 1 domain → preditor topo;
  (c) sem override, ≥2 domains + llm escolhe candidato → ia; (d) llm devolve fora da lista → topo/preditor;
  (e) preditor `[]` → manual/outro; (f) sem `deps.llm` e ambíguo → topo/preditor.
- `montarAtributosBase`: schema com BRAND/MODEL/VOLTAGE → preenche BRAND+MODEL, deixa VOLTAGE vazio.
- `atributosFaltantesGenerico`: required não preenchido aparece; preenchido não aparece; conditional contado.
- Regressão: `montarAtributosML`/`detectarTipoAviamento` dos aviamentos **inalterados**.

## Bug bash (token real, browser-use)
1. Subir um lote com **produto de vertical nova** (ex.: caneta/caderno/furadeira) + um aviamento (controle).
2. Verificar na Revisão: aviamento → categoria correta, **sem** selo (override); produto novo → categoria
   prevista pelo ML (nome humano) + selo "sugerida" + lista de obrigatórios faltantes.
3. Conferir no banco: `tipo_origem='preditor'`, `categoria_ml_id` = a categoria-folha do `domain_discovery`,
   `categoria_nome` preenchido, `atributos_faltantes` com os required.
4. Limpeza: remover o lote de teste.

> A **publicação** de um produto de vertical nova com atributos válidos é o critério do **E4** (precisa dos
> valores preenchidos). No E3 o bug bash valida resolução + exibição, sem publicar.

## Critério de saída
Um produto fora de aviamentos recebe categoria-folha + lista de atributos obrigatórios corretos na Revisão,
sem código novo por nicho, validado com token real; aviamentos sem nenhuma regressão.
