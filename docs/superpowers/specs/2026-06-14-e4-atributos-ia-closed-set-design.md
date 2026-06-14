# E4 — Preenchimento de atributos por IA (closed-set) + publicar vertical nova (design)

**Data:** 2026-06-14 · **ADR:** [0026](../../decisions/0026-generalizacao-categorizacao-atributos-por-ia.md) · **Épico:** Fase 1 / E4 · **Depende de:** E3 (categoria + schema)

## Objetivo

Preencher os **valores** dos atributos obrigatórios de uma categoria prevista (E3) **escolhendo dentro da
lista permitida** (`values[]`, closed-set — anti-alucinação), validar, e **publicar um produto de vertical
nova no ML** com atributos válidos. Aviamentos seguem 100% determinísticos → **zero regressão**.

## Não-objetivos (YAGNI / diferido)
- Vision no preenchimento (texto título+descrição basta; foto fica como melhoria futura).
- UI de edição **por-atributo** manual + telemetria de correções do operador → diferido (o seletor manual
  de **categoria** já existe como escape hatch; closed-set vem da própria lista do ML, baixo risco de erro).

## Arquitetura

No `process-familia`, após resolver a categoria prevista e ler o schema (E3), um passo de IA preenche os
atributos `required`/`conditional_required` que têm `values[]` (closed-set) e ainda estão vazios. O LLM
recebe título+descrição + a lista de valores permitidos e devolve, para cada atributo, **um `value_id` da
lista** (ou nada). O resultado entra em `atributos_ml`; `atributos_faltantes` é recalculado (some o que foi
preenchido). Na publicação, dois pontos hoje hard-coded para aviamento são generalizados para qualquer
categoria.

### Arquivos

| Arquivo | Mudança |
|---|---|
| `_shared/ai/atributos-llm.ts` (novo) | `preencherAtributosClosedSet(schema, base, input, llmFn)` (orquestra) + `desempatarAtributosLLM` (rede). |
| `_shared/ai/atributos-llm-core.ts` (novo) | puras: `montarPromptAtributos`, `validarRespostaAtributos` (closed-set guard), `atributosAlvo(schema, base)` (quais pedir à IA). |
| `_shared/categoria/atributos.ts` (modifica) | `categoriaAceitaEmptyGtinReason` ganha variante por-schema; `atributosFaltantesGenerico` reusado no gate. |
| `_shared/ml/publicar.ts` (modifica) | `montarPayloadItem` ganha param opcional `aceitaEmptyGtin?: boolean` (worker passa o valor do schema p/ categoria prevista; fallback = helper hard-coded p/ aviamento). |
| `process-familia/index.ts` (modifica) | após `montarAtributosBase` (E3), chama `preencherAtributosClosedSet` → `atributos_ml` completo + `faltantes` recalculado. |
| `publish-familia-ml/index.ts` (modifica) | gate (linha 80) generaliza: aviamento → `atributosFaltantes(tipo,…)` (atual); previsto → `familia.atributos_faltantes` (E3, recalculado no E4). Lê o schema (cache Redis) p/ passar `aceitaEmptyGtin`. |
| `src/components/card-categoria.tsx` (modifica) | quando há atributos preenchidos por IA, lista "IA preencheu: Voltagem: Bivolt" + selo "confirme" (read-only). |

## Contratos

```ts
// _shared/ai/atributos-llm-core.ts
export interface AtributoAlvo { id: string; nome: string; valores: { id: string; nome: string }[]; }
export interface InputAtributos { nome: string; descricao?: string; }
// resposta do LLM: { [attrId]: value_id }
export function atributosAlvo(schema: AtributoSchema[], jaPreenchidos: AtributoML[]): AtributoAlvo[];
export function validarRespostaAtributos(resp: Record<string,string>, alvos: AtributoAlvo[]): AtributoML[];
export function montarPromptAtributos(input: InputAtributos, alvos: AtributoAlvo[]): string;
```

## Regras

### Quais atributos a IA preenche (`atributosAlvo`)
`required || conditional_required`, **com `values[]` não-vazio** (closed-set), **ainda não em
`jaPreenchidos`**, e **não** em `{GTIN, EMPTY_GTIN_REASON}` (resolvidos na publicação). Ex.: VOLTAGE da
furadeira. BRAND/MODEL (texto livre, sem `values[]`) já vêm do E3 e não são alvo da IA.

### Closed-set guard (`validarRespostaAtributos`)
Para cada alvo, o `value_id` devolvido pela IA só é aceito se **estiver em `alvo.valores`**; senão o atributo
é **omitido** (fica faltante — o operador resolve). Nunca inventa valor. Correção fuzzy: se a IA devolver um
`value_name` em vez de `value_id`, casa por nome normalizado contra `valores`; sem casar → omite.

### Preenchimento (`preencherAtributosClosedSet`)
`alvos = atributosAlvo(schema, base)`; se vazio → retorna `base` (sem chamar IA). Senão chama a IA 1×,
valida, e retorna `[...base, ...preenchidos]`. Resiliente: IA falha → retorna `base` (atributos ficam
faltantes, publicação ainda possível se não forem `required` estritos).

### Integração no `process-familia`
Só no ramo de **categoria prevista** (origem ≠ regex). Após `montarAtributosBase`:
```ts
atributosMl = await preencherAtributosClosedSet(schema, atributosMl, { nome, descricao }, desempatarAtributosLLM);
faltantes = atributosFaltantesGenerico(atributosMl, schema);
```
Aviamento (override) inalterado.

### Generalização da publicação
- **Gate** (`publish-familia-ml`): `const faltam = ehAviamento(tipo) ? atributosFaltantes(tipo, attrs) :
  (familia.atributos_faltantes ?? []);` — bloqueia se faltar obrigatório, em qualquer categoria.
- **EMPTY_GTIN_REASON** (`montarPayloadItem`): novo param `aceitaEmptyGtin?: boolean`. O worker lê o schema
  (cache Redis) e passa `schema.some(a => a.id === 'EMPTY_GTIN_REASON')` p/ categoria prevista; p/ aviamento
  passa `undefined` → cai no `categoriaAceitaEmptyGtinReason` atual (comportamento idêntico). Assim produto
  de vertical nova **sem GTIN real** declara o motivo e publica.

## Testes (TDD)
- `atributosAlvo`: filtra closed-set required não preenchidos; ignora GTIN/EMPTY_GTIN_REASON e texto-livre.
- `validarRespostaAtributos`: value_id válido entra; inválido omitido; fuzzy por value_name; vazio → [].
- `montarPromptAtributos`: inclui os valores permitidos.
- `preencherAtributosClosedSet`: sem alvos → base sem chamar IA; com alvos → merge; IA falha → base.
- `montarPayloadItem`: `aceitaEmptyGtin=true` em categoria prevista sem GTIN → variação com EMPTY_GTIN_REASON;
  `false`/undefined aviamento → comportamento atual (regressão).
- Gate generalizado: previsto com faltantes → bloqueia; sem faltantes → publica.

## Bug bash (token real, browser-use + publicação)
1. Subir (ou inserir) uma família de **vertical nova** com descrição que contenha o atributo closed-set
   (ex.: furadeira "650W Bivolt") + GTIN real (ou sem GTIN p/ exercitar EMPTY_GTIN_REASON).
2. `process-familia` → categoria prevista + VOLTAGE preenchido por IA (value_id de "Bivolt") + faltantes vazio.
3. Publicar pela Revisão (browser-use, sessão admin) → **anúncio real criado no ML** com category_id previsto
   + atributos válidos (BRAND/MODEL/VOLTAGE) + COLOR + EMPTY_GTIN_REASON (se sem GTIN). Conferir ao vivo
   (`GET /items/{id}` → attributes). 
4. **Encerrar o anúncio** (one-off descartável, status closed) + remover dados de teste. `anuncios_externos`
   volta a 21.

## Critério de saída
Produto de vertical nova publicado no ML com atributos obrigatórios válidos preenchidos por IA (closed-set),
validado com token real; aviamentos sem regressão.
