# Categoria + Título: substantivo do tipo de produto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar a classe de bug do lote #50 (categoria "Outros"/errada + título sem o tipo de produto) reaproveitando a mesma chamada de IA do copywriter para extrair um substantivo grounded do tipo de produto (`tipo_produto_busca`), usado tanto para reforçar a busca de categoria no ML quanto para garantir que o título nunca omita o tipo do produto quando ele só existe na descrição.

**Arquitetura:** `gerarCopy` (copywriter) ganha um 3º campo de saída no mesmo schema JSON estrito já existente — `tipo_produto_busca`, validado deterministicamente contra o texto-fonte (mesma regra anti-invenção do ADR-0052: só aceito se aparecer literalmente em nome+descrição). Esse campo alimenta (a) uma 2ª chamada ao `domain_discovery` em paralelo com a busca pelo nome bruto, cujos candidatos são unidos (dedup, bruta-primeiro) e (b) um novo guard determinístico de título (`garantirTipoProdutoTitulo`, mesmo padrão de `garantirMetragemTitulo`/`garantirCorTitulo`). Em `resolverCategoria`, candidatos com nome de categoria genérico ("outros"/"diversos"/etc.) são separados dos específicos ANTES de qualquer decisão; a IA de desempate passa a rodar sempre que sobrar ≥1 candidato específico (não só quando ambíguo) e ganha permissão explícita de abster-se (`category_id: null`); abstenção deliberada ou zero candidatos específicos → `origem: 'manual'` (nunca mais aceita "Outros" como resposta final automática). Falha técnica do LLM (exceção/timeout) continua caindo no topo específico, preservando o comportamento resiliente e os testes existentes.

**Tech Stack:** Deno/TypeScript (Supabase Edge Functions), Vitest, OpenRouter (JSON Schema estrito), API nativa do Mercado Livre (`domain_discovery`).

**Fora de escopo (adiado, documentado no ADR como Fase 2):** usar `category_id` das ofertas de concorrentes (`_shared/concorrencia/parse.ts`, já parseado mas hoje descartado) como candidato adicional de categoria. Testes empíricos mostram que a Fase 1 (query limpa via IA) já resolve os 2 casos onde esse sinal ajudaria (EUROROMA); nos outros 2 casos (bainha, remendo) o sinal do concorrente era unânime **e errado** (colisão de GTIN/catálogo), então não fecha nada que a Fase 1 não feche sozinha. Acrescentar agora é complexidade sem ganho demonstrado — YAGNI.

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `docs/decisions/0054-categoria-titulo-tipo-produto-generico.md` | Criar | ADR da decisão |
| `supabase/functions/_shared/ai/copywriter-prompt.ts` | Modificar | Regra do `tipo_produto_busca` no SYSTEM + regra de título |
| `supabase/functions/_shared/ai/copywriter.ts` | Modificar | Schema JSON + `OutputCopy` + validação grounded |
| `supabase/functions/_shared/ai/titulo.ts` | Modificar | Novo guard `garantirTipoProdutoTitulo` |
| `supabase/functions/_shared/ai/categoria-llm-core.ts` | Modificar | Schema nullable + prompt de abstenção |
| `supabase/functions/_shared/ai/categoria-llm.ts` | Modificar | Retorno 3 estados (`string \| null \| undefined`) |
| `supabase/functions/_shared/categoria/resolver.ts` | Modificar | Dual preditor + merge + partição genérico/específico + fluxo de abstenção |
| `supabase/functions/process-familia/index.ts` | Modificar | Wiring: passa `tipo_produto_busca` pro resolver e pro guard de título |
| `supabase/functions/regenerar-copy-familia/index.ts` | Modificar | Wiring do guard de título (endpoint "Regenerar Copy" acionado pelo operador) |
| `supabase/functions/_shared/split/titulo-particao.ts` | Modificar | Wiring do guard de título (split de produto em N anúncios, ADR-0048) |
| `docs/reference/edge-functions.md` | Modificar | Documentar o novo campo/fluxo |
| Testes correspondentes em `__tests__/` de cada arquivo acima | Criar/Modificar | TDD |

---

## Task 1: ADR

**Files:**
- Create: `docs/decisions/0054-categoria-titulo-tipo-produto-generico.md`

- [ ] **Step 1: Escrever o ADR** cobrindo: contexto (lote #50, evidência empírica dos 5 casos + testes reais na API do ML), decisão (dual query, partição genérico/específico, abstenção da IA, guard de título), consequências, Fase 2 adiada (sinal de concorrente), como reverter.
- [ ] **Step 2: Commit**
```bash
git add docs/decisions/0054-categoria-titulo-tipo-produto-generico.md
git commit -m "docs(categoria): ADR-0054 — tipo de produto genérico via IA (categoria + título)"
```

---

## Task 2: `copywriter` ganha `tipo_produto_busca`

**Files:**
- Modify: `supabase/functions/_shared/ai/copywriter-prompt.ts` (só o texto do SYSTEM — `copywriter-prompt.test.ts`
  existente cobre `montarUserPrompt`, não o SYSTEM; nenhum teste novo necessário aqui, é conteúdo de prompt)
- Modify: `supabase/functions/_shared/ai/copywriter.ts`
- Test: `supabase/functions/_shared/ai/__tests__/copywriter-tipo-produto.test.ts` (novo — valida a função pura de grounding)

- [ ] **Step 1: Escrever o teste da validação grounded (falha primeiro)**

```typescript
// supabase/functions/_shared/ai/__tests__/copywriter-tipo-produto.test.ts
import { describe, it, expect } from 'vitest';
import { validarTipoProdutoBusca } from '../copywriter';

describe('validarTipoProdutoBusca (regra anti-invenção, espelha ADR-0052)', () => {
  it('aceita quando a palavra aparece na descrição', () => {
    const r = validarTipoProdutoBusca('barbante de crochê', 'EUROROMA 4/6 CORES 600G 610MT', 'BARBANTE 4/6. O BARBANTE EUROROMA...');
    expect(r).toBe('barbante de crochê');
  });
  it('aceita quando a palavra aparece no nome', () => {
    const r = validarTipoProdutoBusca('bainha instantânea', 'BAINHA INSTANTÂNEA 4MT UND', '');
    expect(r).toBe('bainha instantânea');
  });
  it('rejeita (string vazia) quando nenhuma palavra significativa consta na fonte', () => {
    const r = validarTipoProdutoBusca('solda de estanho', 'EUROROMA 4/6 CORES 600G 610MT', 'BARBANTE 4/6...');
    expect(r).toBe('');
  });
  it('ignora acento/caixa na comparação', () => {
    const r = validarTipoProdutoBusca('Bainha Instantânea', 'bainha instantanea 4mt und', '');
    expect(r).toBe('Bainha Instantânea');
  });
  it('string vazia/whitespace → vazia', () => {
    expect(validarTipoProdutoBusca('', 'X', 'Y')).toBe('');
    expect(validarTipoProdutoBusca('   ', 'X', 'Y')).toBe('');
  });
  it('BUG a evitar: tipo composto só de palavras curtas (<3 letras) NÃO auto-aceita — rejeita', () => {
    // "fio"/"giz"/"cós" são >=3 letras e devem contar; o piso é só pra preposição/artigo.
    const r = validarTipoProdutoBusca('e a', 'EUROROMA 4/6 CORES 600G 610MT', 'BARBANTE 4/6...');
    expect(r).toBe('');
  });
  it('palavra curta real de produto (3 letras) conta como grounded', () => {
    const r = validarTipoProdutoBusca('fio de bordar', 'NOVELO X', 'PRODUTO FEITO DE FIO 100% ALGODAO');
    expect(r).toBe('fio de bordar');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha** — `pnpm test copywriter-tipo-produto` → FAIL (`validarTipoProdutoBusca` não existe).

- [ ] **Step 3: Implementar em `copywriter.ts`**

Adicionar (função pura, exportada, sem I/O). **Nota de design (achado da revisão do plano):** este NÃO é o
mesmo padrão de `validarTextoLivre` em `atributos-llm-core.ts` (que exige a frase INTEIRA em sequência
contígua na fonte) — propositalmente, porque `tipo_produto_busca` é uma frase de BUSCA (pode combinar o
substantivo grounded com palavras de contexto de uso genérico já permitidas no prompt, ex.: "barbante de
croche" quando só "barbante" está na fonte), não um valor literal extraído. O invariante real e
NÃO-NEGOCIÁVEL é: **nenhuma palavra significativa pode ficar sem checar** — o bug que a revisão do plano
encontrou foi um filtro que, ao sobrar zero palavras "significativas" (limiar alto demais, 4 letras),
caía num `||` que ACEITAVA sem checar nada. Corrigido abaixo: limiar 3 letras (cobre "fio", "giz", "cós" —
tipos de produto reais e curtos deste domínio) e **zero palavras relevantes → rejeita**, nunca aceita.

```typescript
function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function tokens(s: string): string[] {
  return normalizar(s).split(/\s+/).filter(Boolean);
}

const MIN_PALAVRA_SIGNIFICATIVA = 3; // abaixo disso é preposição/artigo (de/e/a/o...), nunca conta

/**
 * Regra de ouro (mesmo espírito anti-invenção do ADR-0052, adaptado — ver nota acima): só
 * aceita tipo_produto_busca se ALGUMA palavra dele (>=3 letras) constar literalmente em nome
 * ou descrição. Zero palavras significativas na frase → REJEITA (nunca aceita por padrão).
 */
export function validarTipoProdutoBusca(tipoProdutoBusca: string, nome: string, descricao: string): string {
  const valor = tipoProdutoBusca?.trim() ?? '';
  if (!valor) return '';
  const fonte = new Set(tokens(`${nome} ${descricao}`));
  const palavrasRelevantes = tokens(valor).filter((w) => w.length >= MIN_PALAVRA_SIGNIFICATIVA);
  if (palavrasRelevantes.length === 0) return ''; // nada pra verificar → rejeita, não aceita
  const grounded = palavrasRelevantes.some((w) => fonte.has(w));
  return grounded ? valor : '';
}
```

Atualizar `SCHEMA` (adicionar `tipo_produto_busca` a `properties` e `required`, mantendo `additionalProperties: false`):

```typescript
tipo_produto_busca: { type: 'string' },
```

Atualizar `OutputCopy` (`tipo_produto_busca: string`) e `chamarCopy`/`gerarCopy`: parsear o campo, aplicar `validarTipoProdutoBusca(parsed.tipo_produto_busca, input.nome, input.descricao_detalhado)` antes de devolver.

- [ ] **Step 4: Rodar teste, confirmar PASS** — `pnpm test copywriter-tipo-produto`

- [ ] **Step 5: Atualizar o SYSTEM prompt em `copywriter-prompt.ts`**

Adicionar seção nova (antes de TÍTULO):

```
═══════════════════════════════════════════════════════
TIPO DE PRODUTO (campo tipo_produto_busca)
═══════════════════════════════════════════════════════
Preencha "tipo_produto_busca" com um substantivo curto (2-5 palavras) que identifica
O QUE o produto FISICAMENTE É (ex.: "barbante de crochê", "fita de cetim", "tesoura de
costura", "bainha adesiva"). REGRA ABSOLUTA: só preencha se essa palavra aparecer
literalmente no nome OU na descrição — nunca infira o tipo só a partir da marca. Se
nenhuma palavra do tipo de produto aparecer no texto-fonte, devolva "" (vazio).
```

Atualizar a seção TÍTULO com a regra de prioridade:

```
- Se o NOME do produto não contém uma palavra que identifique o tipo do produto (ex.:
  "EUROROMA 4/6 CORES 600G" não diz o que é), mas a descrição diz (ex.: "BARBANTE"),
  esse substantivo é OBRIGATÓRIO como primeiro segmento do título — à frente até da
  marca. Prioridade de conteúdo quando faltar espaço: TIPO DE PRODUTO > MEDIDA > MARCA
  > DIFERENCIAL (corte o DIFERENCIAL antes de cortar o tipo).
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/ai/copywriter.ts supabase/functions/_shared/ai/copywriter-prompt.ts supabase/functions/_shared/ai/__tests__/copywriter-tipo-produto.test.ts
git commit -m "feat(copywriter): extrai tipo_produto_busca grounded (categoria + título)"
```

---

## Task 3: Guard determinístico de título — `garantirTipoProdutoTitulo`

**Files:**
- Modify: `supabase/functions/_shared/ai/titulo.ts`
- Test: `supabase/functions/_shared/ai/__tests__/titulo-tipo-produto.test.ts` (novo)

- [ ] **Step 1: Escrever o teste (falha primeiro)**

```typescript
// supabase/functions/_shared/ai/__tests__/titulo-tipo-produto.test.ts
import { describe, it, expect } from 'vitest';
import { garantirTipoProdutoTitulo } from '../titulo';

describe('garantirTipoProdutoTitulo', () => {
  it('prefixa o tipo quando ausente do título', () => {
    const r = garantirTipoProdutoTitulo('EUROROMA 4/6 600G 610MT | 85% ALGODÃO | ALTA RESISTÊNCIA', 'barbante');
    expect(r.startsWith('BARBANTE ')).toBe(true);
    expect(r.length).toBeLessThanOrEqual(60);
  });
  it('não duplica quando o tipo já está no título', () => {
    const r = garantirTipoProdutoTitulo('BAINHA INSTANTÂNEA 4MT UND | RESISTENTE', 'bainha instantânea');
    expect(r).toBe('BAINHA INSTANTÂNEA 4MT UND | RESISTENTE');
  });
  it('tipoProdutoBusca vazio → título intacto', () => {
    expect(garantirTipoProdutoTitulo('X | Y', '')).toBe('X | Y');
  });
  it('corta o diferencial antes do texto-base para caber em 60 chars', () => {
    const r = garantirTipoProdutoTitulo('EUROROMA 4/6 600G 610MT NOVELO PREMIUM | 85% ALGODÃO RECICLADO | ALTA RESISTÊNCIA E DURABILIDADE', 'barbante de crochê');
    expect(r.length).toBeLessThanOrEqual(60);
    expect(r.startsWith('BARBANTE DE CROCHÊ')).toBe(true);
  });
  it('BUG a evitar: tipoProdutoBusca sem palavra >=3 letras não duplica (não prefixa às cegas)', () => {
    // Se não dá pra verificar ausência com segurança, não prefixa — evita "FIO FIO DE COSTURA".
    const r = garantirTipoProdutoTitulo('FIO DE COSTURA 100M', 'e a');
    expect(r).toBe('FIO DE COSTURA 100M');
  });
  it('tipo com palavra curta real (3 letras) já presente no título não duplica', () => {
    const r = garantirTipoProdutoTitulo('FIO DE COSTURA 100M | RESISTENTE', 'fio de bordar');
    expect(r).toBe('FIO DE COSTURA 100M | RESISTENTE');
  });
});
```

- [ ] **Step 2: Rodar, confirmar falha.**

- [ ] **Step 3: Implementar em `titulo.ts`** (usar `normalizarBusca`/`removerCaudaConectiva` já existentes no
arquivo). **Mesma correção da Task 2:** limiar 3 letras (não 4) e, se sobrar zero palavras significativas pra
verificar, **não prefixa** (retorna o título intacto) — prefixar às cegas sem conseguir checar duplicação foi
o bug real que a revisão do plano encontrou (título dobrado, ex. "FIO FIO DE COSTURA 100M").

```typescript
const MIN_PALAVRA_SIGNIFICATIVA_TITULO = 3;

export function garantirTipoProdutoTitulo(titulo: string, tipoProdutoBusca: string): string {
  const tipo = tipoProdutoBusca?.trim();
  if (!tipo) return titulo;
  const palavrasTipo = normalizarBusca(tipo).split(/\s+/).filter((w) => w.length >= MIN_PALAVRA_SIGNIFICATIVA_TITULO);
  if (palavrasTipo.length === 0) return titulo; // nada significativo pra verificar com segurança → não mexe

  const tituloNorm = normalizarBusca(titulo);
  const jaPresente = palavrasTipo.some((w) => new RegExp(`\\b${w}\\b`).test(tituloNorm));
  if (jaPresente) return titulo;

  let candidato = `${tipo.toUpperCase()} ${titulo}`;
  if (candidato.length <= TITULO_MAX) return candidato;

  const partes = candidato.split(' | ');
  while (partes.length > 1 && partes.join(' | ').length > TITULO_MAX) partes.pop();
  candidato = partes.join(' | ');
  if (candidato.length > TITULO_MAX) {
    const palavras = candidato.split(/\s+/);
    while (palavras.length > 1 && palavras.join(' ').length > TITULO_MAX) palavras.pop();
    candidato = palavras.join(' ');
  }
  return removerCaudaConectiva(candidato);
}
```

Nota: `normalizarBusca` hoje é função privada do módulo — remover o `function` local e reexportar, ou duplicar a normalização (`normalize('NFD')...`). Preferir reexportar (DRY).

- [ ] **Step 4: Rodar, confirmar PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/titulo.ts supabase/functions/_shared/ai/__tests__/titulo-tipo-produto.test.ts
git commit -m "feat(titulo): garantirTipoProdutoTitulo — prefixa tipo de produto ausente do nome"
```

---

## Task 4: `categoria-llm-core.ts` — schema nullable + prompt de abstenção

**Files:**
- Modify: `supabase/functions/_shared/ai/categoria-llm-core.ts`
- Test: `supabase/functions/_shared/ai/__tests__/categoria-llm.test.ts` (estender)

- [ ] **Step 1: Estender o teste (falha primeiro)** — adicionar a `categoria-llm.test.ts`:

```typescript
describe('montarPromptDesempate — instrução de abstenção', () => {
  it('instrui a IA a devolver null quando nenhum candidato serve, mesmo sendo o único', () => {
    const p = montarPromptDesempate({ nome: 'X' }, candidatos);
    expect(p.toLowerCase()).toContain('null');
  });
});
```

- [ ] **Step 2: Rodar, confirmar falha.**

- [ ] **Step 3: Implementar** — em `SCHEMA_DESEMPATE`, trocar `category_id: { type: 'string' }` por:

```typescript
category_id: { type: ['string', 'null'] },
```

Em `montarPromptDesempate`, adicionar linha final:

```typescript
'Se NENHUMA categoria da lista descrever de fato este produto, responda category_id null — mesmo que exista só uma opção na lista. Não escolha a menos pior só por ser a única disponível.',
```

- [ ] **Step 4: Rodar, confirmar PASS.**

- [ ] **Step 5: Validação manual pontual contra o OpenRouter real (achado da revisão do plano)** — `type:
['string','null']` em modo `strict:true` não tem precedente em nenhum outro schema do projeto. Antes de confiar
no fallback de abstenção em produção, fazer 1 chamada real (script descartável, não entra no repo) ao
`MODELO_COPY` via `montarPromptDesempate` com uma lista de candidatos claramente ruins pro produto de teste, e
confirmar que o modelo de fato devolve `category_id: null` (não um erro de schema, não uma string forçada).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/ai/categoria-llm-core.ts supabase/functions/_shared/ai/__tests__/categoria-llm.test.ts
git commit -m "feat(categoria-llm): schema aceita null explícito + instrução de abstenção"
```

---

## Task 5: `categoria-llm.ts` — retorno de 3 estados

**Files:**
- Modify: `supabase/functions/_shared/ai/categoria-llm.ts`

Sem teste dedicado novo (a função faz I/O de rede — cobertura vem indiretamente via `resolver.test.ts` com `deps.llm` mockado nos 3 estados). Mudança pontual:

- [ ] **Step 1: Implementar** — trocar a assinatura de retorno para `Promise<string | null | undefined>`:

```typescript
export async function desempatarCategoriaLLM(
  input: InputCategoria,
  candidatos: CategoriaCandidata[],
): Promise<string | null | undefined> {
  if (candidatos.length === 0) return undefined;
  try {
    const client = openrouterClient();
    const resp = await client.chat.completions.create({ /* ...inalterado... */ });
    const raw = resp.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { category_id?: string | null };
    if (parsed.category_id === null) return null; // abstenção deliberada
    return escolherCandidatoValido(parsed.category_id, candidatos) ?? undefined; // fora do closed-set = falha técnica
  } catch (e) {
    console.error('desempate LLM de categoria falhou:', e);
    return undefined; // falha técnica — NUNCA confundir com abstenção deliberada (null)
  }
}
```

- [ ] **Step 2: Typecheck** — `pnpm exec tsc --noEmit` (ou o comando de typecheck do projeto) garante que os call-sites tipados aceitam o novo union.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/ai/categoria-llm.ts
git commit -m "fix(categoria-llm): distingue abstenção deliberada (null) de falha técnica (undefined)"
```

---

## Task 6: `resolver.ts` — dual query + partição genérico/específico + abstenção

**Files:**
- Modify: `supabase/functions/_shared/categoria/resolver.ts`
- Test: `supabase/functions/_shared/categoria/__tests__/resolver.test.ts` (estender — preservar TODOS os testes (a)-(k) existentes)

- [ ] **Step 1: Escrever os novos testes (falha primeiro)** — adicionar ao arquivo existente, mantendo (a)-(k) intactos:

```typescript
describe('resolverCategoria — tipo_produto_busca + candidatos genéricos + abstenção', () => {
  const generico: CategoriaCandidata = { domainId: 'MLB-ARTS_AND_CRAFTS', domainName: 'Artes e artesanatos', categoriaId: 'MLB1371', categoriaNome: 'Outros' };
  const fiosCat: CategoriaCandidata = { domainId: 'MLB-SEWING_AND_CRAFT_THREADS', domainName: 'Fios para costura', categoriaId: 'MLB270273', categoriaNome: 'Fios e Cadarços de Armarinho' };

  it('(l) só candidato genérico ("Outros") → manual, nunca aceita como resposta final', async () => {
    const r = await resolverCategoria(
      { nome: 'BAINHA INSTANTÂNEA 4MT UND' },
      { preditor: async () => [generico] },
    );
    expect(r.origem).toBe('manual');
    expect(r.categoriaId).toBeNull();
  });

  it('(m) busca bruta falha, tipoProdutoBusca acha candidato específico bom → resolve', async () => {
    const r = await resolverCategoria(
      { nome: 'EUROROMA 4/6 CORES 600G 610MT', tipoProdutoBusca: 'barbante de crochê' },
      {
        preditor: async (q) => (q === 'barbante de crochê' ? [fiosCat] : []),
      },
    );
    expect(r.categoriaId).toBe('MLB270273');
    expect(r.tipo).toBe('linha');
  });

  it('(n) LLM abstém deliberadamente (null) mesmo com 1 candidato específico → manual, não aceita o falso-amigo', async () => {
    const especifico: CategoriaCandidata = { domainId: 'MLB-BICYCLE_TIRE_REPAIR_KITS', domainName: 'Kit de remendos de bicicletas', categoriaId: 'MLB67966', categoriaNome: 'Remendos' };
    const r = await resolverCategoria(
      { nome: 'REMENDO MAGICO 1MT UND' },
      { preditor: async () => [especifico], llm: async () => null },
    );
    expect(r.origem).toBe('manual');
    expect(r.categoriaId).toBeNull();
  });

  it('(o) LLM falha tecnicamente (undefined) → cai no topo específico (resiliente, como hoje)', async () => {
    const especifico: CategoriaCandidata = { domainId: 'MLB-X', domainName: 'X', categoriaId: 'MLB1', categoriaNome: 'Categoria Específica' };
    const r = await resolverCategoria(
      { nome: 'Produto qualquer' },
      { preditor: async () => [especifico], llm: async () => undefined },
    );
    expect(r.origem).toBe('preditor');
    expect(r.categoriaId).toBe('MLB1');
  });

  it('(p) mistura genérico + específico: LLM só vê o específico e escolhe', async () => {
    const r = await resolverCategoria(
      { nome: 'X' },
      { preditor: async () => [generico, fiosCat], llm: async (_i, cands) => {
          expect(cands.some((c) => c.categoriaNome === 'Outros')).toBe(false); // genérico não chega no LLM
          return 'MLB270273';
        } },
    );
    expect(r.categoriaId).toBe('MLB270273');
  });

  it('(q) tipoProdutoBusca vazio → só 1 chamada ao preditor (sem 2ª busca desnecessária)', async () => {
    let chamadas = 0;
    await resolverCategoria(
      { nome: 'Caderno', tipoProdutoBusca: '' },
      { preditor: async () => { chamadas++; return []; } },
    );
    expect(chamadas).toBe(1);
  });

  it('(r) dedup: mesmo category_id nas duas buscas não duplica candidato', async () => {
    const r = await resolverCategoria(
      { nome: 'EUROROMA', tipoProdutoBusca: 'linha euroroma' },
      { preditor: async () => [fiosCat] }, // mesma resposta pras duas queries
    );
    expect(r.categoriaId).toBe('MLB270273');
    expect(r.origem).toBe('preditor');
  });
});
```

- [ ] **Step 2: Rodar, confirmar falha** (novos testes falham; (a)-(k) devem continuar passando — isso é o guard de regressão dos lotes 42-49).

- [ ] **Step 3: Implementar**

```typescript
export interface InputCategoria {
  nome: string;
  descricao?: string;
  tipoProdutoBusca?: string;
}

export interface DepsResolver {
  preditor: (nome: string) => Promise<CategoriaCandidata[]>;
  llm?: (input: InputCategoria, candidatos: CategoriaCandidata[]) => Promise<string | null | undefined>;
}

const TERMOS_GENERICOS = ['outro', 'outros', 'outra', 'outras', 'diverso', 'diversos', 'diversa', 'diversas', 'geral', 'general', 'otro', 'otros'];

function ehCategoriaGenerica(nome: string): boolean {
  const n = normalizarTexto(nome);
  return TERMOS_GENERICOS.some((t) => n.includes(t));
}

function mesclarCandidatos(a: CategoriaCandidata[], b: CategoriaCandidata[]): CategoriaCandidata[] {
  const vistos = new Set<string>();
  const out: CategoriaCandidata[] = [];
  for (const c of [...a, ...b]) {
    if (vistos.has(c.categoriaId)) continue;
    vistos.add(c.categoriaId);
    out.push(c);
  }
  return out;
}

export async function resolverCategoria(input: InputCategoria, deps: DepsResolver): Promise<ResultadoCategoria> {
  const { tipo } = detectarTipoAviamento(input.nome);
  const catOverride = categoriaParaTipo(tipo);
  if (catOverride) {
    return { categoriaId: catOverride, categoriaNome: rotuloParaTipo(tipo), tipo, origem: 'regex' };
  }

  const buscaLimpa = input.tipoProdutoBusca?.trim();
  const [brutos, limpos] = await Promise.all([
    deps.preditor(input.nome).catch(() => [] as CategoriaCandidata[]),
    buscaLimpa ? deps.preditor(buscaLimpa).catch(() => [] as CategoriaCandidata[]) : Promise.resolve([] as CategoriaCandidata[]),
  ]);
  const candidatos = mesclarCandidatos(brutos, limpos);
  if (candidatos.length === 0) {
    return { categoriaId: null, categoriaNome: null, tipo: 'outro', origem: 'manual' };
  }

  const topo = candidatos[0];

  const pista = avaliarPistaForte(input, candidatos);
  if (pista?.tipo === 'escolhido' && pista.candidato.categoriaId !== topo.categoriaId) {
    return { categoriaId: pista.candidato.categoriaId, categoriaNome: pista.candidato.categoriaNome, tipo: tipoParaCategoria(pista.candidato.categoriaId), origem: 'ia' };
  }
  if (pista?.tipo === 'sem-candidato') {
    return { categoriaId: null, categoriaNome: null, tipo: 'outro', origem: 'manual' };
  }

  const especificos = candidatos.filter((c) => !ehCategoriaGenerica(c.categoriaNome));
  if (especificos.length === 0) {
    return { categoriaId: null, categoriaNome: null, tipo: 'outro', origem: 'manual' };
  }
  const topoEspecifico = especificos[0];

  if (deps.llm) {
    const resultado = await deps.llm(input, especificos).catch(() => undefined as string | null | undefined);
    if (resultado === null) {
      return { categoriaId: null, categoriaNome: null, tipo: 'outro', origem: 'manual' };
    }
    if (typeof resultado === 'string') {
      const escolhido = especificos.find((c) => c.categoriaId === resultado);
      if (escolhido && escolhido.categoriaId !== topoEspecifico.categoriaId) {
        return { categoriaId: escolhido.categoriaId, categoriaNome: escolhido.categoriaNome, tipo: tipoParaCategoria(escolhido.categoriaId), origem: 'ia' };
      }
    }
    // resultado === undefined (falha técnica) OU string fora do closed-set: cai no fallback abaixo.
  }

  return { categoriaId: topoEspecifico.categoriaId, categoriaNome: topoEspecifico.categoriaNome, tipo: tipoParaCategoria(topoEspecifico.categoriaId), origem: 'preditor' };
}
```

Nota: `normalizarTexto` já existe no arquivo (reusar). Manter `avaliarPistaForte`/`PISTAS_FORTES` inalterados — só passam a operar sobre a lista mesclada.

- [ ] **Step 4: Rodar TODOS os testes de `resolver.test.ts`** — `pnpm test resolver` — confirmar (a)-(r) todos PASS. Esse é o guard de regressão contra os lotes 42-49: se qualquer teste (a)-(k) quebrar, a implementação está errada, não o teste.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/categoria/resolver.ts supabase/functions/_shared/categoria/__tests__/resolver.test.ts
git commit -m "feat(categoria): dual query + genérico nunca é resposta final + IA pode abster-se"
```

---

## Task 7: Wiring em `process-familia/index.ts`

**Files:**
- Modify: `supabase/functions/process-familia/index.ts` (linhas ~142-173 e ~296-301, ver leitura já feita)

- [ ] **Step 1: Wiring da categoria** — na chamada de `resolverCategoria` (hoje linha ~167-173), passar `tipoProdutoBusca: copy.tipo_produto_busca` explicitamente (não depender da ordem implícita step5→5c):

```typescript
const cat = await resolverCategoria(
  { nome: claimed.nome_pai, descricao: claimed.descricao_pai ?? undefined, tipoProdutoBusca: copy.tipo_produto_busca },
  {
    preditor: (q) => (token ? buscarCategoriaPreditor(token, q) : Promise.resolve([])),
    llm: desempatarCategoriaLLM,
  },
);
```

- [ ] **Step 2: Wiring do título** — na composição de `titulo_ml` (hoje linha ~297-301), aplicar `garantirTipoProdutoTitulo` como guard mais interno:

```typescript
titulo_ml: garantirCorTitulo(
  garantirMetragemTitulo(
    garantirTipoProdutoTitulo(copy.titulo, copy.tipo_produto_busca),
    claimed.nome_pai,
  ),
  coresUnicas.length === 1 ? coresUnicas[0] : null,
  coresUnicas.length,
),
```

Atualizar o import de `titulo.ts` no topo do arquivo para incluir `garantirTipoProdutoTitulo`.

- [ ] **Step 3: Typecheck + lint**

```bash
pnpm lint
pnpm exec tsc --noEmit  # ou o comando de typecheck do projeto, conferir package.json
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/process-familia/index.ts
git commit -m "feat(process-familia): conecta tipo_produto_busca na categoria e no título"
```

---

## Task 7b: Wiring nos outros 2 pontos que chamam `gerarCopy` + montam título

**Achado da revisão do plano:** `garantirMetragemTitulo`/`garantirCorTitulo` (o padrão que `garantirTipoProdutoTitulo`
replica) já são chamados em MAIS dois lugares além de `process-familia`, ambos com o mesmo bug do lote #50 se não
forem conectados: o endpoint "Regenerar Copy" (acionado manualmente pelo operador) e a geração de título de
partição (ADR-0048, produto split em N anúncios).

**Files:**
- Modify: `supabase/functions/regenerar-copy-familia/index.ts`
- Modify: `supabase/functions/_shared/split/titulo-particao.ts`
- Test: `supabase/functions/_shared/split/__tests__/titulo-particao.test.ts` (estender)

- [ ] **Step 1: Escrever o teste em `titulo-particao.test.ts` (falha primeiro)** — mockar `gerarCopy` (já é
importado dinamicamente no arquivo, ver comentário na linha 8-10 do módulo) devolvendo `tipo_produto_busca`
preenchido e um `titulo` que não o contém; confirmar que `gerarTituloParticao` devolve o título com o tipo
prefixado (mesma expectativa de `garantirTipoProdutoTitulo` isolado, mas via a função pública do módulo).

- [ ] **Step 2: Rodar, confirmar falha.**

- [ ] **Step 3: `titulo-particao.ts`** — importar `garantirTipoProdutoTitulo` de `../ai/titulo.ts` (mesmo import
de `garantirCorTitulo, garantirMetragemTitulo` já existente na linha 7); trocar:

```typescript
const titulo = garantirMetragemTitulo(out.titulo, opts.nome);
```
por:
```typescript
const titulo = garantirMetragemTitulo(garantirTipoProdutoTitulo(out.titulo, out.tipo_produto_busca), opts.nome);
```

- [ ] **Step 4: `regenerar-copy-familia/index.ts`** — importar `garantirTipoProdutoTitulo` de
`../_shared/ai/titulo.ts` (junto dos outros dois já importados na linha 4); trocar:

```typescript
const tituloFinal = garantirCorTitulo(
  garantirMetragemTitulo(result.titulo, familia.nome_pai),
  coresUnicas.length === 1 ? coresUnicas[0] : null,
  coresUnicas.length,
);
```
por:
```typescript
const tituloFinal = garantirCorTitulo(
  garantirMetragemTitulo(garantirTipoProdutoTitulo(result.titulo, result.tipo_produto_busca), familia.nome_pai),
  coresUnicas.length === 1 ? coresUnicas[0] : null,
  coresUnicas.length,
);
```

Não requer mudança de categoria neste arquivo — `regenerar-copy-familia` só regenera título+descrição, nunca
recalcula `categoria_ml_id` (confirmado: o payload do UPDATE não toca campos de categoria).

- [ ] **Step 5: Rodar `titulo-particao.test.ts`, confirmar PASS.**

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/regenerar-copy-familia/index.ts supabase/functions/_shared/split/titulo-particao.ts supabase/functions/_shared/split/__tests__/titulo-particao.test.ts
git commit -m "fix(titulo): conecta garantirTipoProdutoTitulo em regenerar-copy e split de partição"
```

---

## Task 8: Suíte completa + regressão histórica

**Files:** nenhum novo — só execução.

- [ ] **Step 1: Rodar a suíte inteira**

```bash
pnpm test
```

Esperado: todos os testes verdes, incluindo os pré-existentes de `atributos.test.ts`, `detectar.test.ts`, `faltantes-editaveis.test.ts`, `schema.test.ts`, `titulo*.test.ts`, `categoria-llm.test.ts`.

- [ ] **Step 2: Conferir que os testes (a)-(k) de `resolver.test.ts` (comportamento hoje correto para lotes 42-49: tesoura, alfinete, furadeira, caderno) NÃO mudaram de expectativa** — só leitura do diff do arquivo de teste, confirmando que as asserções originais permanecem intactas (só foram adicionados testes novos, nenhum modificado).

- [ ] **Step 3: Build**

```bash
pnpm build
```

---

## Task 9: Documentação (regra de conclusão do CLAUDE.md)

**Files:**
- Modify: `docs/reference/edge-functions.md`
- Modify: `docs/TASKS.md`
- Modify: `obsidian-vault/` (arquivo relevante de arquitetura/decisões, se existir seção de categorização)

- [ ] **Step 1:** Documentar em `docs/reference/edge-functions.md` o novo campo `tipo_produto_busca` no `process-familia` e o novo fluxo de resolução de categoria (dual query + partição genérico/específico + abstenção).
- [ ] **Step 2:** Atualizar `docs/TASKS.md` com a entrada da correção (lote #50).
- [ ] **Step 3:** Atualizar `obsidian-vault/` se houver página de arquitetura de categorização/copywriter.
- [ ] **Step 4: Commit**

```bash
git add docs/reference/edge-functions.md docs/TASKS.md obsidian-vault/
git commit -m "docs: atualiza edge-functions e TASKS com o fix de categoria/título (lote #50)"
```

---

## Task 10: Parar para validação (NÃO fazer merge/push/PR)

Conforme o workflow de entrega deste projeto: parar aqui. Reportar ao Diego o branch/worktree, os testes rodados, e aguardar validação local antes de qualquer merge → push → deploy. Não abrir PR sem pedido explícito.
