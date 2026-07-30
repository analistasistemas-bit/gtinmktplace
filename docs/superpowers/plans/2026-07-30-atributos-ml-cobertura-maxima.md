# Cobertura máxima de atributos ML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a IA de atributos do PubliAI preencher tanto quanto o "Sugerir características" nativo do Mercado Livre, sem nunca inventar um valor que não esteja no texto do produto.

**Architecture:** Todas as correções vivem num único arquivo puro e testável sem rede, `supabase/functions/_shared/ai/atributos-llm-core.ts` (mais um comentário cruzado em `_shared/categoria/atributos.ts`). Nenhuma mudança de schema de banco, nenhuma edge function nova, nenhuma mudança de assinatura pública além de um campo aditivo em `AtributoAlvo`.

**Tech Stack:** Deno/TypeScript (edge functions), Vitest para os testes (roda via Vite, já configurado em `vitest.config.ts`).

**Spec de referência:** `docs/superpowers/specs/2026-07-30-atributos-ml-cobertura-maxima-design.md` (já commitado, aprovado após 3 rodadas de revisão automática).

**Ferramenta necessária:** `.env.test` precisa existir na raiz do worktree (copiar de `.env.local`/`.env.test.example` se faltar — regra do CLAUDE.md do projeto, sem ele `pnpm test` quebra no boot do supabase.ts).

---

## Nota sobre um detalhe que refina o spec (achado escrevendo o código exato)

O spec (seção "4. Confusão semântica…") diz que "unidade do texto fora da tabela de sinônimos… não valida nenhum atributo". Escrevendo o guard exato, isso geraria uma contradição com um teste que **já existe e deve continuar passando**: `número correto em formato diferente da fonte ainda é aceito` (`atributos-llm-core.ts`, texto "Tecido 3,00 X 1,80 Metros", resposta `LENGTH: '3 m'`) — o "X" entre as duas medidas é capturado pelo scanner como um "token de unidade" perto do "3", e "x" não está (nem deveria estar) na tabela de sinônimos. Se "unidade não reconhecida → rejeita", esse teste real quebraria.

**Comportamento correto (o que este plano implementa):** o guard só **rejeita** quando encontra, perto do número, uma unidade **reconhecida e diferente** da que a IA respondeu (o caso real do bug: "224 metros" no texto ≠ "g" na resposta). Quando não encontra NENHUMA unidade reconhecida perto do número (tabela de sinônimos não bateu com nada, ou não há palavra ali — ex.: "3,00 X 1,80"), o guard não tem sinal confiável e **não bloqueia** — cai no comportamento atual (só `numeroConstaNoTexto`). Isso preserva "3,00 X 1,80 Metros" → aceita "3 m", e ainda fecha o bug real "224 metros" → rejeita "224 g".

---

### Task 1: Fixture do teste golden (schema real da categoria MLB270273)

**Files:**
- Create: `supabase/functions/_shared/ai/__tests__/fixtures/schema-mlb270273.json`

- [ ] **Step 1: Baixar o schema real da API pública do Mercado Livre**

Run:
```bash
curl -s "https://api.mercadolibre.com/categories/MLB270273/attributes" -o "supabase/functions/_shared/ai/__tests__/fixtures/schema-mlb270273.json"
```
Expected: arquivo criado, sem erro.

- [ ] **Step 2: Verificar que o fixture tem o formato esperado**

Run:
```bash
node -e "const d = require('./supabase/functions/_shared/ai/__tests__/fixtures/schema-mlb270273.json'); console.log(d.length, 'atributos'); console.log(d.find(a => a.id === 'COMPOSITION').tags)"
```
Expected: `65 atributos` seguido de `{ multivalued: true }` (pode variar um pouco se a ML mudou o schema nesse meio-tempo — se `COMPOSITION` não existir mais ou não tiver mais `multivalued`, pare e avise; o teste golden do Task 7 depende desse shape).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/ai/__tests__/fixtures/schema-mlb270273.json
git commit -m "test: fixture do schema real MLB270273 p/ teste golden de cobertura de atributos"
```

---

### Task 2: Corrigir o tokenizer do guard anti-invenção (pontuação colada)

**Bug real:** `tokens()` faz `split(/\s+/)`, então "100% ALGODÃO." vira token `"algodao."` (ponto colado) e nunca bate contra a resposta limpa da IA `"algodão"` — mesmo a palavra estando literalmente na planilha. Isso provavelmente já causava perda silenciosa de atributos texto-livre antes desta mudança, não só nos casos que os próximos tasks destravam.

**Files:**
- Modify: `supabase/functions/_shared/ai/atributos-llm-core.ts` (função `tokens`, `validarTextoLivre`)
- Test: `supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

No describe `'validarRespostaAtributos (texto-livre, anti-invenção)'` (já existe, usa `schema = [A({ id: 'LINE', nome: 'Linha', required: true })]` e `alvos = atributosAlvo(schema, [])`), adicionar depois do último `it`:

```typescript
  it('casa mesmo com pontuação colada na fonte (bug real: "ALGODÃO." não batia com "algodão")', () => {
    const inp = { nome: 'Linha Renascença', descricao: 'COMPOSIÇÃO: 100% ALGODÃO. USO: CROCHÊ' };
    expect(validarRespostaAtributos({ LINE: 'algodão' }, atributosAlvo(schema, []), inp)).toEqual([{ id: 'LINE', value_name: 'algodão' }]);
  });
  it('NÃO casa contíguo através de pontuação forte (dois itens de lista não viram um valor só)', () => {
    const inp = { nome: 'Linha X', descricao: 'COMPOSIÇÃO: ALGODÃO. POLIÉSTER PREMIUM' };
    expect(validarRespostaAtributos({ LINE: 'Algodão Poliéster' }, atributosAlvo(schema, []), inp)).toEqual([]);
  });
  it('vírgula NÃO é pontuação forte (contiguidade de 2 palavras sobrevive a vírgula, só não a ponto/ponto-e-vírgula/dois-pontos)', () => {
    const inp = { nome: 'Linha X', descricao: 'É a tradicional Renda Renascença, uma das mais belas técnicas' };
    expect(validarRespostaAtributos({ LINE: 'Renda Renascença' }, atributosAlvo(schema, []), inp)).toEqual([{ id: 'LINE', value_name: 'Renda Renascença' }]);
  });
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm exec vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts -t "pontuação"`
Expected: FAIL nos 2 primeiros (o de vírgula já passa hoje, sem problema — serve de guard de regressão).

- [ ] **Step 3: Implementar — trocar `tokens()` por tokenização de letra/número e segmentar `validarTextoLivre` por pontuação forte**

Em `supabase/functions/_shared/ai/atributos-llm-core.ts`, localizar:

```typescript
const MIN_TEXTO_LIVRE = 2;
const MAX_TEXTO_LIVRE = 60;
function tokens(s: string): string[] {
  return normalizar(s).split(/\s+/).filter(Boolean);
}
```

Substituir por:

```typescript
const MIN_TEXTO_LIVRE = 2;
const MAX_TEXTO_LIVRE = 60;

// Tokeniza por corrida de letra/número (unicode), não por espaço — pontuação colada na palavra
// ("ALGODÃO." na planilha) NUNCA deve quebrar o match contra a resposta limpa da IA ("algodão").
// Bug real (adendo ADR-0052, 2026-07-30): split(/\s+/) fazia esse match falhar sempre que havia
// ponto/vírgula grudado, mesmo a palavra estando literalmente no texto.
function tokens(s: string): string[] {
  return normalizar(s).match(/\p{L}+|\p{N}+/gu) ?? [];
}

// Segmenta em pontuação FORTE (fim de frase/item de lista) — a contiguidade de um valor
// multi-palavra não pode atravessar isso, senão "ALGODÃO. POLIÉSTER" (dois itens de lista)
// casaria como um valor só "algodão poliéster". Vírgula fica de fora de propósito: "RENDA
// RENASCENÇA," continua um match válido de 2 palavras (é só uma pausa, não um novo item).
function segmentos(s: string): string[] {
  return s.split(/[.;:|]+/);
}
```

Depois, localizar `validarTextoLivre`:

```typescript
function validarTextoLivre(bruto: string, input: InputAtributos): string | null {
  const valor = bruto.trim();
  if (valor.length < MIN_TEXTO_LIVRE || valor.length > MAX_TEXTO_LIVRE) return null;
  const alvo = tokens(valor);
  if (alvo.length === 0) return null;
  const fonte = tokens(`${input.nome} ${input.descricao ?? ''}`);
  for (let i = 0; i + alvo.length <= fonte.length; i++) {
    if (alvo.every((t, j) => fonte[i + j] === t)) return valor;
  }
  return null;
}
```

Substituir por:

```typescript
function validarTextoLivre(bruto: string, input: InputAtributos): string | null {
  const valor = bruto.trim();
  if (valor.length < MIN_TEXTO_LIVRE || valor.length > MAX_TEXTO_LIVRE) return null;
  const alvo = tokens(valor);
  if (alvo.length === 0) return null;
  const texto = `${input.nome} ${input.descricao ?? ''}`;
  for (const seg of segmentos(texto)) {
    const fonte = tokens(seg);
    for (let i = 0; i + alvo.length <= fonte.length; i++) {
      if (alvo.every((t, j) => fonte[i + j] === t)) return valor;
    }
  }
  return null;
}
```

- [ ] **Step 4: Rodar o arquivo inteiro e confirmar que tudo passa (regressão zero)**

Run: `pnpm exec vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts`
Expected: PASS em todos os testes (os 3 novos + os pré-existentes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/atributos-llm-core.ts supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts
git commit -m "fix(atributos-ia): tokenizer do guard anti-invenção não quebra mais em pontuação colada"
```

---

### Task 3: `multivalued` deixa de ser banido; texto-livre opcional sem sugestão vira alvo

**Files:**
- Modify: `supabase/functions/_shared/ai/atributos-llm-core.ts` (interface `AtributoAlvo`, `TAGS_EXCLUIR`, `atributosAlvo`)
- Modify: `supabase/functions/_shared/categoria/atributos.ts` (comentário cruzado em `TAGS_NAO_FALTANTE`)
- Test: `supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts`

- [ ] **Step 1: Escrever/ajustar os testes que falham**

No describe `'atributosAlvo'`, o teste `'exclui variation_attribute, hidden/read_only e multivalued'` (linha ~48) e `'texto-livre OPCIONAL não é alvo (evita poluição/invenção)'` (linha ~44) descrevem o comportamento ANTIGO. Substituir os dois por:

```typescript
  it('exclui variation_attribute, hidden/read_only (multivalued sozinho NÃO exclui mais — adendo ADR-0052 2026-07-30)', () => {
    const ids = atributosAlvo(SCHEMA, base).map((a) => a.id);
    expect(ids).not.toContain('MAIN_COLOR');
    expect(ids).not.toContain('IMPORT_DUTY');
    expect(ids).not.toContain('PRODUCT_FEATURES'); // multivalued + read_only → ainda de fora (read_only)
  });
  it('texto-livre OPCIONAL sem sugestão agora é alvo (cobertura máxima, adendo ADR-0052 2026-07-30)', () => {
    const schema = [A({ id: 'NOTE', nome: 'Observação', required: false })];
    expect(atributosAlvo(schema, []).map((a) => a.id)).toEqual(['NOTE']);
  });
  it('texto-livre OPCIONAL com id regulatório/certificação continua de fora (denylist)', () => {
    const schema = [A({ id: 'ANVISA_REGISTRATION', nome: 'Registro ANVISA', required: false })];
    expect(atributosAlvo(schema, []).map((a) => a.id)).toEqual([]);
  });
```

Adicionar um novo describe no final do arquivo (antes do último `});` de fechamento do arquivo, depois do describe `preencherAtributosClosedSet`):

```typescript
describe('multivalued vira alvo (cobertura máxima, adendo ADR-0052 2026-07-30)', () => {
  const schema = [A({
    id: 'COMPOSITION', nome: 'Composição', valueType: 'string',
    valores: [{ id: '1', nome: 'Algodão' }, { id: '2', nome: 'Poliéster' }], tags: ['multivalued'],
  })];
  const alvos = atributosAlvo(schema, []);
  it('multivalued sem read_only/hidden vira alvo, com a flag multivalued=true', () => {
    expect(alvos.map((a) => a.id)).toEqual(['COMPOSITION']);
    expect(alvos[0].multivalued).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm exec vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts -t "adendo ADR-0052"`
Expected: FAIL — `PRODUCT_FEATURES` ok, mas `NOTE` não vira alvo ainda (`toEqual([])` na implementação atual em vez de `['NOTE']`), e `alvos[0].multivalued` é `undefined`.

- [ ] **Step 3: Implementar**

Antes disso, atualizar o comentário de topo do arquivo (fica impreciso depois desta task — hoje
diz que texto-livre opcional fica sempre de fora, o que deixa de ser verdade). Localizar:

```typescript
// Texto livre (string sem values, ex.: MODEL) fica de fora — risco alto de invenção.
```

Substituir por:

```typescript
// Texto livre obrigatório (ex.: MODEL) e texto-livre OPCIONAL sem sugestão e sem denylist
// regulatório também entram (adendo ADR-0052, 2026-07-30) — ver REGULATORIO_ID mais abaixo.
```

Em `atributos-llm-core.ts`, localizar a interface `AtributoAlvo`:

```typescript
export interface AtributoAlvo {
  id: string;
  nome: string;
  tipo: 'closed' | 'numero' | 'texto';        // closed-set / numérico / texto-livre (só obrigatório)
  valores: { id: string; nome: string }[];   // closed-set; vazio quando é numérico/texto
  unidades?: { id: string; nome: string }[]; // só p/ number_unit (ex.: cm, m)
}
```

Substituir por:

```typescript
export interface AtributoAlvo {
  id: string;
  nome: string;
  tipo: 'closed' | 'numero' | 'texto';        // closed-set / numérico / texto-livre (só obrigatório)
  valores: { id: string; nome: string }[];   // closed-set; vazio quando é numérico/texto
  unidades?: { id: string; nome: string }[]; // só p/ number_unit (ex.: cm, m)
  multivalued: boolean;                      // ML aceita mais de 1 valor; preenchemos só 1 (fase 1)
}
```

Localizar:

```typescript
// Tags que tiram o atributo do escopo da IA no nível do item: read_only/hidden (não editável /
// não conta p/ a nota), variation_attribute (preenchido por variação, ex.: MAIN_COLOR) e
// multivalued (a IA monta um único valor, não lista). Validado no schema real de MLB255054.
const TAGS_EXCLUIR = new Set(['read_only', 'hidden', 'variation_attribute', 'multivalued']);
```

Substituir por:

```typescript
// Tags que tiram o atributo do escopo da IA no nível do item: read_only/hidden (não editável /
// não conta p/ a nota) e variation_attribute (preenchido por variação, ex.: MAIN_COLOR).
// Validado no schema real de MLB255054. `multivalued` NÃO entra mais aqui (adendo ADR-0052,
// 2026-07-30) — a IA passa a preencher um único valor pra esses atributos. Continua banido do
// gate de obrigatórios (TAGS_NAO_FALTANTE, em categoria/atributos.ts) DE PROPÓSITO: o editor
// manual de faltantes ainda não sabe mostrar/editar multivalued, então um multivalued required
// não pode travar a publicação por lá — ver comentário espelhado em categoria/atributos.ts.
const TAGS_EXCLUIR = new Set(['read_only', 'hidden', 'variation_attribute']);

// Padrão de id de atributo regulatório/certificação — fora do escopo do texto-livre OPCIONAL
// novo (adendo ADR-0052, 2026-07-30): a IA não deve copiar um número/texto qualquer do produto
// pra um campo de compliance só porque "parece bater". Atributo regulatório OBRIGATÓRIO segue
// coberto como antes (branch de baixo, inalterado) — só a expansão nova pra opcional respeita
// esta lista.
const REGULATORIO_ID = /REGISTRATION|CERTIF|ANVISA|ANATEL|INMETRO|LICENSE/;
```

Localizar o corpo de `atributosAlvo`:

```typescript
export function atributosAlvo(schema: AtributoSchema[], jaPreenchidos: AtributoML[]): AtributoAlvo[] {
  const presentes = new Set(jaPreenchidos.filter((a) => a.value_name || a.value_id).map((a) => a.id));
  return schema
    .filter((a) =>
      !IGNORAR.has(a.id) &&
      !presentes.has(a.id) &&
      // ?? [] defende contra schema de shape antigo (sem tags) vindo de cache stale: degrada
      // pra "sem tag de exclusão" em vez de estourar TypeError e derrubar o enriquecimento inteiro.
      !(a.tags ?? []).some((t) => TAGS_EXCLUIR.has(t)) &&
      // closed-set e numéricos (obrig. e opcional) OU texto-livre SÓ quando obrigatório
      (a.valores.length > 0 || ehNumerico(a) ||
        (a.valueType === 'string' && (a.required || a.conditionalRequired))),
    )
    .map((a) => ({
      id: a.id,
      nome: a.nome,
      tipo: tipoAlvo(a),
      valores: a.valores,
      unidades: a.valueType === 'number_unit' ? a.allowedUnits : undefined,
    }));
}
```

Substituir por:

```typescript
export function atributosAlvo(schema: AtributoSchema[], jaPreenchidos: AtributoML[]): AtributoAlvo[] {
  const presentes = new Set(jaPreenchidos.filter((a) => a.value_name || a.value_id).map((a) => a.id));
  return schema
    .filter((a) =>
      !IGNORAR.has(a.id) &&
      !presentes.has(a.id) &&
      // ?? [] defende contra schema de shape antigo (sem tags) vindo de cache stale: degrada
      // pra "sem tag de exclusão" em vez de estourar TypeError e derrubar o enriquecimento inteiro.
      !(a.tags ?? []).some((t) => TAGS_EXCLUIR.has(t)) &&
      // closed-set e numéricos (obrig. e opcional); texto-livre obrigatório sempre; texto-livre
      // OPCIONAL sem sugestão também vira alvo, exceto id regulatório/certificação (adendo
      // ADR-0052, 2026-07-30) — checagem explícita de valueType==='string', não por negação, pra
      // não capturar um value_type futuro/desconhecido tratado como string por acidente.
      (a.valores.length > 0 || ehNumerico(a) ||
        (a.valueType === 'string' && (a.required || a.conditionalRequired)) ||
        (a.valueType === 'string' && a.valores.length === 0 && !REGULATORIO_ID.test(a.id))),
    )
    .map((a) => ({
      id: a.id,
      nome: a.nome,
      tipo: tipoAlvo(a),
      valores: a.valores,
      unidades: a.valueType === 'number_unit' ? a.allowedUnits : undefined,
      multivalued: (a.tags ?? []).includes('multivalued'),
    }));
}
```

Em `supabase/functions/_shared/categoria/atributos.ts`, localizar:

```typescript
// Tags que tiram o atributo do escopo de "faltante acionável": read_only/hidden (não editável),
// variation_attribute (vem da variação) e multivalued (não montamos lista). DEVE casar com o
// filtro do editor (faltantes-editaveis.ts) — se o gate contasse um destes como faltante mas o
// editor não o mostrasse, a família ficaria impublicável sem campo para corrigir.
export const TAGS_NAO_FALTANTE = new Set(['read_only', 'hidden', 'variation_attribute', 'multivalued']);
```

Substituir por (só o comentário muda, o Set continua igual — divergência proposital documentada):

```typescript
// Tags que tiram o atributo do escopo de "faltante acionável": read_only/hidden (não editável),
// variation_attribute (vem da variação) e multivalued (não montamos lista). DEVE casar com o
// filtro do editor (faltantes-editaveis.ts) — se o gate contasse um destes como faltante mas o
// editor não o mostrasse, a família ficaria impublicável sem campo para corrigir.
// `multivalued` fica banido AQUI de propósito (diferente de TAGS_EXCLUIR em
// atributos-llm-core.ts, que parou de banir multivalued no adendo ADR-0052 2026-07-30): a IA já
// sabe preencher 1 valor pra um multivalued opcional, mas o editor manual de faltantes ainda não
// sabe mostrar/editar esse tipo — um multivalued required teria que aparecer aqui como faltante
// sem ter como o operador corrigir. Não "ressincronizar" os dois sets sem atualizar o editor junto.
export const TAGS_NAO_FALTANTE = new Set(['read_only', 'hidden', 'variation_attribute', 'multivalued']);
```

- [ ] **Step 4: Rodar o arquivo inteiro e confirmar que tudo passa**

Run: `pnpm exec vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts`
Expected: PASS em todos.

- [ ] **Step 5: Rodar a suíte de `categoria/atributos.ts` (só mudou comentário, garantir zero regressão)**

Run: `pnpm exec vitest run supabase/functions/_shared/categoria/__tests__/atributos.test.ts`
Expected: PASS em todos (sem nenhuma mudança de comportamento esperada).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/ai/atributos-llm-core.ts supabase/functions/_shared/categoria/atributos.ts supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts
git commit -m "feat(atributos-ia): multivalued e texto-livre opcional sem sugestão viram alvo da IA"
```

---

### Task 4: Atributo multivalued não aceita resposta com vírgula (fase 1: só 1 valor)

**Por quê:** a API do ML trata vírgula em `value_name` de atributo multivalued como separador de múltiplos valores. Sem essa trava, "Algodão, Poliéster" (se a IA responder assim) publicaria 2 valores sem ter sido essa a intenção da fase 1 (que só sabe validar/montar 1 valor por atributo).

**Files:**
- Modify: `supabase/functions/_shared/ai/atributos-llm-core.ts` (função `validarRespostaAtributos`)
- Test: `supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

No describe `'multivalued vira alvo (cobertura máxima, adendo ADR-0052 2026-07-30)'` criado no Task 3, adicionar (nota: o `input` usa "Algodão Poliéster 100%" — os DOIS tokens precisam constar contíguos na fonte pro teste da vírgula ser um teste real da trava, não um caso que já seria rejeitado por outro motivo):

```typescript
  const input = { nome: 'Linha Algodão Poliéster 100%' };
  it('aceita 1 valor extraído do texto', () => {
    expect(validarRespostaAtributos({ COMPOSITION: 'Algodão' }, alvos, input)).toEqual([{ id: 'COMPOSITION', value_name: 'Algodão' }]);
  });
  it('resposta com vírgula (tentativa de multi-valor) é rejeitada — fase 1 só sabe 1 valor por atributo', () => {
    expect(validarRespostaAtributos({ COMPOSITION: 'Algodão, Poliéster' }, alvos, input)).toEqual([]);
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm exec vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts -t "vírgula"`
Expected: FAIL no segundo teste — sem a trava, "Algodão, Poliéster" tokeniza pra `['algodao','poliester']`, contíguos na fonte "algodao poliester 100" ("Linha Algodão Poliéster 100%" normalizado), então `validarTextoLivre` aceitaria hoje (bug que este task fecha).

- [ ] **Step 3: Implementar**

Em `atributos-llm-core.ts`, localizar o branch `else` (texto-livre) dentro de `validarRespostaAtributos`:

```typescript
    } else {
      const valor = validarTextoLivre(String(bruto), input);
      if (valor) out.push({ id: alvo.id, value_name: valor });
    }
```

Substituir por:

```typescript
    } else {
      // Multivalued (fase 1: só 1 valor) — resposta com vírgula é rejeitada, não aceita truncada
      // nem dividida: a ML trataria vírgula em value_name multivalued como separador de vários
      // valores, publicando algo que não foi validado (adendo ADR-0052, 2026-07-30).
      if (alvo.multivalued && String(bruto).includes(',')) continue;
      const valor = validarTextoLivre(String(bruto), input);
      if (valor) out.push({ id: alvo.id, value_name: valor });
    }
```

- [ ] **Step 4: Rodar o arquivo inteiro e confirmar que tudo passa**

Run: `pnpm exec vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts`
Expected: PASS em todos.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/atributos-llm-core.ts supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts
git commit -m "fix(atributos-ia): rejeita valor com vírgula em atributo multivalued (fase 1: só 1 valor)"
```

---

### Task 5: Guard de unidade para atributos `number_unit` (evita confundir comprimento com peso)

**Bug real:** o guard hoje só checa se o número aparece em QUALQUER lugar do texto — não se a unidade bate com o contexto. Isso deixou "224 metros" (do texto) virar resposta da IA pra `UNIT_WEIGHT: "224 g"` em vez de `LENGTH: "224 m"`.

**Files:**
- Modify: `supabase/functions/_shared/ai/atributos-llm-core.ts` (nova tabela de sinônimos + nova função + `validarRespostaAtributos`)
- Test: `supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar um novo describe, depois do describe `'validarRespostaAtributos (numérico)'` existente:

```typescript
describe('validarRespostaAtributos (numérico, unidade precisa bater com o contexto do número)', () => {
  const schema = [
    A({ id: 'LENGTH', nome: 'Comprimento', valueType: 'number_unit', allowedUnits: [{ id: 'm', nome: 'm' }, { id: 'cm', nome: 'cm' }] }),
    A({ id: 'UNIT_WEIGHT', nome: 'Peso da unidade', valueType: 'number_unit', allowedUnits: [{ id: 'g', nome: 'g' }, { id: 'kg', nome: 'kg' }] }),
  ];
  const alvos = atributosAlvo(schema, []);

  it('aceita LENGTH=224 m (sinônimo "metros"→"m" bate com o número no texto)', () => {
    const input = { nome: 'Linha 224 metros' };
    expect(validarRespostaAtributos({ LENGTH: '224 m' }, alvos, input)).toEqual([{ id: 'LENGTH', value_name: '224 m' }]);
  });
  it('rejeita UNIT_WEIGHT=224 g quando o 224 do texto só aparece com "metros" (bug real: comprimento confundido com peso)', () => {
    const input = { nome: 'Linha 224 metros' };
    expect(validarRespostaAtributos({ UNIT_WEIGHT: '224 g' }, alvos, input)).toEqual([]);
  });
  it('unidade não reconhecida perto do número (fora da tabela de sinônimos) não bloqueia — sem sinal confiável, mantém o comportamento atual', () => {
    const input = { nome: 'Linha 224 braças' };
    expect(validarRespostaAtributos({ LENGTH: '224 m' }, alvos, input)).toEqual([{ id: 'LENGTH', value_name: '224 m' }]);
  });
  it('quilo/kg também tem sinônimo (grama/quilo cobertos, não só metro)', () => {
    const input = { nome: 'Novelo 100 gramas' };
    expect(validarRespostaAtributos({ UNIT_WEIGHT: '100 g' }, alvos, input)).toEqual([{ id: 'UNIT_WEIGHT', value_name: '100 g' }]);
    expect(validarRespostaAtributos({ LENGTH: '100 m' }, alvos, input)).toEqual([]);
  });
});
```

Também, no describe `'validarRespostaAtributos (numérico)'` existente (que usa `comFonte = { nome: 'Fita 2500 cm com 2,5 m de sobra' }`), confirmar que o teste já existente `'número correto em formato diferente da fonte ainda é aceito (mesmo valor, vírgula vs ponto)'` (texto `'Tecido 3,00 X 1,80 Metros'`, resposta `LENGTH: '3 m'`) continua passando — é o guard de regressão do "sem sinal confiável não bloqueia" (ver nota no topo do plano). Não precisa mudar esse teste, só confirmar no Step 4 que ele não quebrou.

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm exec vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts -t "contexto do número"`
Expected: FAIL no segundo teste (`UNIT_WEIGHT: 224 g` seria aceito hoje, é exatamente o bug real).

- [ ] **Step 3: Implementar**

Em `atributos-llm-core.ts`, adicionar depois da função `numeroConstaNoTexto` (antes de `validarRespostaAtributos`):

```typescript
// Sinônimo (forma do texto da planilha) → unidade do schema da ML. A planilha costuma escrever
// por extenso ("224 METROS"); o schema só expõe a forma abreviada ("m"). Tabela pequena e
// curada, escopada às unidades já observadas no domínio — cresce sob demanda, não tenta cobrir o
// sistema métrico inteiro. Inclui a própria forma abreviada como entrada (identity) pro texto que
// já vem abreviado continuar batendo direto.
const SINONIMOS_UNIDADE: Record<string, string> = {
  metro: 'm', metros: 'm', m: 'm',
  centimetro: 'cm', centimetros: 'cm', cm: 'cm',
  milimetro: 'mm', milimetros: 'mm', mm: 'mm',
  polegada: '"', polegadas: '"', '"': '"',
  grama: 'g', gramas: 'g', g: 'g',
  quilo: 'kg', quilos: 'kg', quilograma: 'kg', quilogramas: 'kg', kg: 'kg',
};

// Unidades do schema encontradas COLADAS a um número específico no texto (não em qualquer lugar
// do texto). Fecha a confusão real (adendo ADR-0052, 2026-07-30): "224 METROS" no texto virando
// resposta da IA em UNIT_WEIGHT "224 g" só porque 224 aparece solto em algum lugar — exige que a
// unidade da resposta bata com a unidade que está de fato junto daquele número na fonte. Quando
// não acha NENHUMA unidade reconhecida perto do número (Set vazio), quem chama trata como "sem
// sinal confiável" e não bloqueia — só bloqueia quando acha uma unidade reconhecida e diferente.
function unidadesJuntoAoNumero(num: number, texto: string): Set<string> {
  const out = new Set<string>();
  const re = /(\d+(?:[.,]\d+)?)\s*([\p{L}"]+)/gu;
  for (const m of normalizar(texto).matchAll(re)) {
    const n = parseFloat(m[1].replace(',', '.'));
    if (Math.abs(n - num) < 1e-9) {
      const un = SINONIMOS_UNIDADE[normalizar(m[2])];
      if (un) out.add(un);
    }
  }
  return out;
}
```

Localizar o branch `else if (alvo.tipo === 'numero')` dentro de `validarRespostaAtributos`:

```typescript
    } else if (alvo.tipo === 'numero') {
      const valor = validarNumerico(String(bruto), alvo.unidades);
      if (valor && numeroConstaNoTexto(parseFloat(valor), input)) out.push({ id: alvo.id, value_name: valor });
    } else {
```

Substituir por:

```typescript
    } else if (alvo.tipo === 'numero') {
      const valor = validarNumerico(String(bruto), alvo.unidades);
      if (!valor) continue;
      const [numStr, unidadeResp] = valor.split(' ');
      const num = parseFloat(numStr);
      if (!numeroConstaNoTexto(num, input)) continue;
      if (unidadeResp) {
        const texto = `${input.nome} ${input.descricao ?? ''}`;
        const unidadesTexto = unidadesJuntoAoNumero(num, texto);
        if (unidadesTexto.size > 0 && !unidadesTexto.has(normalizar(unidadeResp))) continue;
      }
      out.push({ id: alvo.id, value_name: valor });
    } else {
```

(O `else {` final do texto-livre, já modificado no Task 4, continua igual — só o branch `numero` acima dele muda.)

- [ ] **Step 4: Rodar o arquivo inteiro e confirmar que tudo passa (inclusive o teste "3,00 X 1,80 Metros" pré-existente)**

Run: `pnpm exec vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts`
Expected: PASS em todos, incluindo `'número correto em formato diferente da fonte ainda é aceito'`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/atributos-llm-core.ts supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts
git commit -m "fix(atributos-ia): guard de number_unit exige unidade compatível com o contexto do número"
```

---

### Task 6: Reforço no prompt (não reciclar número; multivalued só 1 valor)

**Files:**
- Modify: `supabase/functions/_shared/ai/atributos-llm-core.ts` (função `montarPromptAtributos`)
- Test: `supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

No describe `'montarPromptAtributos'`, adicionar:

```typescript
  it('reforça para não reciclar o mesmo número em atributos diferentes quando há alvo numérico', () => {
    const p = montarPromptAtributos({ nome: 'Fita', descricao: 'rolo 25m veludo' }, atributosAlvo(SCHEMA, base));
    expect(p.toLowerCase()).toContain('não reutilize o mesmo número');
  });
  it('multivalued: pede só 1 valor, sem juntar por vírgula', () => {
    const schema = [A({ id: 'COMPOSITION', nome: 'Composição', valueType: 'string', tags: ['multivalued'] })];
    const p = montarPromptAtributos({ nome: 'Linha Algodão' }, atributosAlvo(schema, []));
    expect(p.toLowerCase()).toContain('não junte vários separados por vírgula');
  });
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm exec vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts -t "reutilize|vírgula"`
Expected: FAIL nos 2.

- [ ] **Step 3: Implementar**

Em `atributos-llm-core.ts`, localizar `montarPromptAtributos`:

```typescript
export function montarPromptAtributos(input: InputAtributos, alvos: AtributoAlvo[]): string {
  const blocos = alvos.map((a) => {
    if (a.tipo === 'closed') {
      const vals = a.valores.slice(0, 60).map((v) => `${v.id} = ${v.nome}`).join('; ');
      return `- ${a.id} (${a.nome}): escolha um → ${vals}`;
    }
    if (a.tipo === 'numero') {
      if (a.unidades && a.unidades.length > 0) {
        return `- ${a.id} (${a.nome}): número + unidade (uma de: ${a.unidades.map((u) => u.nome).join(', ')}). Ex.: "10 ${a.unidades[0].nome}".`;
      }
      return `- ${a.id} (${a.nome}): apenas o número.`;
    }
    return `- ${a.id} (${a.nome}): copie exatamente do título/descrição; se não constar lá, omita (não invente).`;
  }).join('\n');
  return [
    `Produto: ${input.nome}`,
    input.descricao ? `Descrição: ${input.descricao}` : '',
    '',
    'Para cada atributo abaixo, informe o valor que melhor descreve o produto, SOMENTE se a informação',
    'estiver clara no título/descrição. Se não souber, NÃO inclua o atributo. Nunca invente.',
    '',
    blocos,
    '',
    'Responda um JSON { "ATRIBUTO_ID": "valor", ... } só com os que tiver certeza',
    '(value_id para listas; número com unidade para medidas).',
  ].filter(Boolean).join('\n');
}
```

Substituir por:

```typescript
export function montarPromptAtributos(input: InputAtributos, alvos: AtributoAlvo[]): string {
  const blocos = alvos.map((a) => {
    if (a.tipo === 'closed') {
      const vals = a.valores.slice(0, 60).map((v) => `${v.id} = ${v.nome}`).join('; ');
      return `- ${a.id} (${a.nome}): escolha um → ${vals}`;
    }
    if (a.tipo === 'numero') {
      if (a.unidades && a.unidades.length > 0) {
        return `- ${a.id} (${a.nome}): número + unidade (uma de: ${a.unidades.map((u) => u.nome).join(', ')}). Ex.: "10 ${a.unidades[0].nome}".`;
      }
      return `- ${a.id} (${a.nome}): apenas o número.`;
    }
    const sufixoMultivalor = a.multivalued
      ? ' Se houver mais de um valor possível, informe só o mais relevante (não junte vários separados por vírgula).'
      : '';
    return `- ${a.id} (${a.nome}): copie exatamente do título/descrição; se não constar lá, omita (não invente).${sufixoMultivalor}`;
  }).join('\n');
  const temNumerico = alvos.some((a) => a.tipo === 'numero');
  return [
    `Produto: ${input.nome}`,
    input.descricao ? `Descrição: ${input.descricao}` : '',
    '',
    'Para cada atributo abaixo, informe o valor que melhor descreve o produto, SOMENTE se a informação',
    'estiver clara no título/descrição. Se não souber, NÃO inclua o atributo. Nunca invente.',
    '',
    blocos,
    '',
    temNumerico
      ? 'Não reutilize o mesmo número para mais de um atributo — cada número do texto pertence a um contexto específico (ex.: comprimento ≠ peso ≠ quantidade).'
      : '',
    'Responda um JSON { "ATRIBUTO_ID": "valor", ... } só com os que tiver certeza',
    '(value_id para listas; número com unidade para medidas).',
  ].filter(Boolean).join('\n');
}
```

- [ ] **Step 4: Rodar o arquivo inteiro e confirmar que tudo passa**

Run: `pnpm exec vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts`
Expected: PASS em todos.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/atributos-llm-core.ts supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts
git commit -m "feat(atributos-ia): prompt reforça não reciclar número e não juntar multivalued por vírgula"
```

---

### Task 7: Teste golden com o schema real da MLB270273 (guard de regressão da cobertura)

**Files:**
- Test: `supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts`
- Usa a fixture do Task 1: `supabase/functions/_shared/ai/__tests__/fixtures/schema-mlb270273.json`

- [ ] **Step 1: Escrever o teste**

No topo do arquivo `atributos-llm.test.ts`, adicionar aos imports:

```typescript
import schemaMlb270273Raw from './fixtures/schema-mlb270273.json';
import { parseAtributosSchema } from '../../categoria/schema';
```

No final do arquivo, adicionar:

```typescript
// Guard de regressão da cobertura (adendo ADR-0052, 2026-07-30): schema REAL da categoria
// MLB270273 (Fios e Cadarços) + texto REAL da família c1fb33e4-ec56-489d-b0ff-c7354b3b0444 em
// produção (a que motivou toda essa investigação). Antes deste adendo, só 3 atributos viravam
// alvo pra essa família (LENGTH, THICKNESS, FINISH); depois, 6 (+ LINE, COMPOSITION,
// RECOMMENDED_USES) — os mesmos 3 que ficavam em branco na Revisão comparado ao "Sugerir
// características" nativo do ML.
describe('golden: categoria real MLB270273 — família real da investigação 2026-07-30', () => {
  const schema = parseAtributosSchema(schemaMlb270273Raw);
  // Já preenchido pelo caminho determinístico + closed-set/numérico que já funcionava antes
  // desta mudança — snapshot real da família em produção.
  const jaPreenchidos = [
    { id: 'BRAND', value_name: 'BR17-COATS CORRENTE LTDA' },
    { id: 'MODEL', value_name: 'LINHA ESP. P/RENASCENCA COR BRANCO C/10UND' },
    { id: 'PRESENTATION_TYPE', value_name: 'PACOTE COM 10 NOVELOS' },
    { id: 'UNITS_PER_PACKAGE', value_name: '10' },
    { id: 'UNIT_WEIGHT', value_name: '224 g' },
    { id: 'IS_WAXED', value_id: '242084' },
    { id: 'IS_ELASTIC', value_id: '242084' },
    { id: 'SALE_FORMAT', value_id: '1359392' },
  ];
  const input = {
    nome: 'LINHA ESP. P/RENASCENCA COR BRANCO C/10UND',
    descricao: 'LINHA ESPECIAL PARA RENASCENÇA NA COR BRANCA.TEX 87 ET.140. CONTÉM: PACOTE COM 10 NOVELOS COM 224 METROS CADA. COMPOSIÇÃO: 100% ALGODÃO. A LINHA RENASCENÇA É O FIO IDEAL PARA A CONFECÇÃO DA TRADICIONAL RENDA RENASCENÇA, UMA DAS MAIS BELAS E REFINADAS TÉCNICAS DO ARTESANATO BRASILEIRO. COM EXCELENTE QUALIDADE E ACABAMENTO, ELA PROPORCIONA O CAIMENTO E A FIRMEZA NECESSÁRIOS PARA UNIR OS LACÊS E FORMAR OS DELICADOS DESENHOS CARACTERÍSTICOS DESSA RENDA. SUA RESISTÊNCIA GARANTE QUE AS PEÇAS MANTENHAM A BELEZA E A DURABILIDADE AO LONGO DO TEMPO, MESMO APÓS LAVAGENS. PERFEITA PARA QUEM APRECIA TRABALHOS MANUAIS SOFISTICADOS, A LINHA RENASCENÇA PERMITE CRIAR PEÇAS EXCLUSIVAS COMO TOALHAS, CAMINHOS DE MESA, BLUSAS, VESTIDOS, GOLAS E ITENS DE DECORAÇÃO QUE ENCANTAM PELA ELEGÂNCIA E PELO TRABALHO ARTESANAL MINUCIOSO.',
  };

  it('6 atributos viram alvo (antes do adendo eram só 3: LENGTH/THICKNESS/FINISH)', () => {
    const alvos = atributosAlvo(schema, jaPreenchidos);
    expect(alvos.map((a) => a.id).sort()).toEqual(
      ['COMPOSITION', 'FINISH', 'LENGTH', 'LINE', 'RECOMMENDED_USES', 'THICKNESS'].sort(),
    );
  });

  it('preenche LINE, COMPOSITION, RECOMMENDED_USES e LENGTH com valores literalmente presentes na descrição real (FINISH/THICKNESS ficam de fora — sem info clara no texto, igual ao "Sugerir características" nativo do ML nesse mesmo produto)', () => {
    const respostaIaSimulada = {
      LINE: 'Linha Especial para Renascença',
      COMPOSITION: 'Algodão',
      RECOMMENDED_USES: 'Renda Renascença',
      LENGTH: '224 m',
    };
    const alvos = atributosAlvo(schema, jaPreenchidos);
    const preenchidos = validarRespostaAtributos(respostaIaSimulada, alvos, input);
    expect(preenchidos).toContainEqual({ id: 'LINE', value_name: 'Linha Especial para Renascença' });
    expect(preenchidos).toContainEqual({ id: 'COMPOSITION', value_name: 'Algodão' });
    expect(preenchidos).toContainEqual({ id: 'RECOMMENDED_USES', value_name: 'Renda Renascença' });
    expect(preenchidos).toContainEqual({ id: 'LENGTH', value_name: '224 m' });
  });
});
```

- [ ] **Step 2: Rodar e ver o resultado**

Run: `pnpm exec vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts -t "golden"`
Expected: PASS (todo o código de que este teste depende já foi implementado nos Tasks 2-6). Se FALHAR, não é um caso de "escrever a implementação" — é sinal de que algum dos tasks anteriores tem um bug real contra dado de produção real. Investigar antes de seguir (não ajustar o teste pra passar sem entender por quê).

- [ ] **Step 3: Rodar o arquivo inteiro**

Run: `pnpm exec vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts`
Expected: PASS em todos.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts
git commit -m "test(atributos-ia): golden test com schema+produto reais da família investigada (3→6 alvos)"
```

---

### Task 8: Suíte completa, typecheck e lint

**Files:** nenhum (só verificação)

- [ ] **Step 1: Rodar a suíte inteira**

Run: `pnpm test`
Expected: PASS em tudo (não só nos arquivos tocados — `resolver-atributos-genericos.ts` e `process-familia/index.ts` consomem `atributosAlvo`/`preencherAtributosClosedSet` e precisam continuar passando sem alteração).

- [ ] **Step 2: Typecheck (edge functions rodam em Deno, não no `tsc`/`tsconfig` do front — `supabase/functions/**` não está em nenhum project reference do `tsc -b`, então só `check:functions` de fato cobre os arquivos deste plano)**

Run: `pnpm run check:functions`
Expected: sem erros (o campo novo `multivalued` em `AtributoAlvo` é lido em 2 lugares só — `atributos-llm-core.ts` e o teste; `resolver-atributos-genericos.ts`/`process-familia/index.ts` só passam `AtributoAlvo[]` adiante, não constroem objetos literais do tipo, então não quebram por campo faltante).

- [ ] **Step 3: Lint (idem — `eslint.config.js` ignora `supabase/functions`; quem cobre é o lint do Deno)**

Run: `pnpm run lint:functions`
Expected: sem erros.

- [ ] **Step 4: Se algo quebrou fora dos arquivos tocados, investigar antes de seguir**

Não é esperado nenhuma quebra colateral (mudanças são aditivas/internas a `atributos-llm-core.ts`), mas se a suíte completa achar algo, é sinal de um caller que constrói `AtributoAlvo` manualmente em algum lugar não mapeado nesta investigação — parar e checar antes de "consertar" às pressas.

---

## Nota final: documentação

O spec (`docs/superpowers/specs/2026-07-30-atributos-ml-cobertura-maxima-design.md`) e o adendo da ADR-0052 (`docs/decisions/0052-camada2-atributos-ia-first-com-fallback.md`) já foram escritos e commitados nesta branch, ANTES deste plano (parte do processo de brainstorming). Não há mais nenhum arquivo de `docs/reference/` a atualizar — esta mudança não altera schema de banco, edge functions expostas nem glossário de domínio (regra de manutenção de docs do CLAUDE.md do projeto, seção "Documentação").
