# Camada 2A — Inferência de atributos de texto-livre por IA (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a IA preencher atributos obrigatórios de **texto-livre** do Mercado Livre inferindo-os do nome/descrição do produto, sem nunca inventar — reduzindo os produtos que travam por atributo faltante.

**Architecture:** Expande as funções puras de E4 em `_shared/ai/atributos-llm-core.ts`. Um atributo `valueType='string'` passa a ser alvo da IA **só quando obrigatório**; a resposta da IA para texto-livre só é aceita se o valor constar (normalizado) no nome+descrição — invariante anti-invenção (ADR-0052). Nenhuma mudança de UI e nenhuma migration nesta fase; `process-familia` já chama `preencherAtributosClosedSet`, que herda o novo comportamento.

**Tech Stack:** Deno edge functions (TypeScript), Vitest (funções puras rodam no runner do frontend), OpenRouter (LLM já injetado via `desempatarAtributosLLM`).

## Global Constraints

- Regra de ouro do projeto: **nunca inventar dados de produto** — para texto-livre, materializada como: valor só é aceito se `normalizar(nome + ' ' + descricao).includes(normalizar(valor))`.
- Texto-livre só entra no alvo da IA quando `required || conditionalRequired` (nunca opcional).
- Ramo de aviamentos (determinístico, `montarAtributosML`) permanece intocado.
- Não inventar unidade/valor: comportamento de closed-set e numérico atual não muda.
- `normalizar` já existe em `atributos-llm-core.ts:30` (lowercase + NFD sem acento + trim).
- Testes: `npx vitest run supabase/functions/_shared/ai/` e `deno check` na função tocada.

---

### Task 1: Discriminador de tipo no alvo + texto-livre obrigatório vira alvo

**Files:**
- Modify: `supabase/functions/_shared/ai/atributos-llm-core.ts` (interface `AtributoAlvo` ~10-15; `atributosAlvo` ~43-58)
- Test: `supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts` (bloco `describe('atributosAlvo')` ~28-44)

**Interfaces:**
- Produces: `AtributoAlvo` ganha campo `tipo: 'closed' | 'numero' | 'texto'`. `atributosAlvo(schema, jaPreenchidos)` passa a incluir atributos `valueType==='string'` obrigatórios ainda não preenchidos, com `tipo:'texto'`.

- [ ] **Step 1: Adicionar caso de texto-livre obrigatório ao SCHEMA de teste e atualizar as asserções**

No arquivo de teste, adicione ao array `SCHEMA` (após a linha do `MODEL`, id `LINE`):

```ts
  A({ id: 'LINE', nome: 'Linha/Coleção', required: true }), // texto livre OBRIGATÓRIO
```

E atualize o teste de alvos (era `['VOLTAGE','RIBBON_FORMAT','LENGTH','THICKNESS']`):

```ts
  it('inclui texto-livre OBRIGATÓRIO não preenchido; closed-set/numéricos; ignora texto-livre opcional, GTIN, COLOR', () => {
    const alvos = atributosAlvo(SCHEMA, base); // base preenche BRAND+MODEL (texto-livre já resolvido)
    expect(alvos.map((a) => a.id)).toEqual(['LINE', 'VOLTAGE', 'RIBBON_FORMAT', 'LENGTH', 'THICKNESS']);
    expect(alvos.find((a) => a.id === 'LINE')?.tipo).toBe('texto');
    expect(alvos.find((a) => a.id === 'VOLTAGE')?.tipo).toBe('closed');
    expect(alvos.find((a) => a.id === 'LENGTH')?.tipo).toBe('numero');
    expect(alvos.find((a) => a.id === 'LENGTH')?.unidades).toEqual([{ id: 'cm', nome: 'cm' }, { id: 'm', nome: 'm' }]);
  });
```

Adicione também um caso garantindo que texto-livre **opcional** NÃO entra:

```ts
  it('texto-livre OPCIONAL não é alvo (evita poluição/invenção)', () => {
    const schema = [A({ id: 'NOTE', nome: 'Observação', required: false })];
    expect(atributosAlvo(schema, []).map((a) => a.id)).toEqual([]);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts -t atributosAlvo`
Expected: FAIL — hoje `LINE` não entra (texto-livre excluído) e `AtributoAlvo` não tem `tipo`.

- [ ] **Step 3: Implementar `tipo` e relaxar o filtro**

Em `atributos-llm-core.ts`, troque a interface e a função:

```ts
export interface AtributoAlvo {
  id: string;
  nome: string;
  tipo: 'closed' | 'numero' | 'texto';
  valores: { id: string; nome: string }[];   // closed-set; vazio quando é numérico/texto
  unidades?: { id: string; nome: string }[]; // só p/ number_unit
}
```

Adicione o helper logo após `ehNumerico`:

```ts
function tipoAlvo(a: AtributoSchema): 'closed' | 'numero' | 'texto' {
  if (a.valores.length > 0) return 'closed';
  if (ehNumerico(a)) return 'numero';
  return 'texto';
}
```

E reescreva `atributosAlvo`:

```ts
export function atributosAlvo(schema: AtributoSchema[], jaPreenchidos: AtributoML[]): AtributoAlvo[] {
  const presentes = new Set(jaPreenchidos.filter((a) => a.value_name || a.value_id).map((a) => a.id));
  return schema
    .filter((a) =>
      !IGNORAR.has(a.id) &&
      !presentes.has(a.id) &&
      !a.tags.some((t) => TAGS_EXCLUIR.has(t)) &&
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

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts -t atributosAlvo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/atributos-llm-core.ts supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts
git commit -m "feat(atributos-ia): texto-livre obrigatório vira alvo da IA + discriminador de tipo"
```

---

### Task 2: Validação de texto-livre com invariante anti-invenção

**Files:**
- Modify: `supabase/functions/_shared/ai/atributos-llm-core.ts` (`validarRespostaAtributos` ~94-113; assinatura passa a receber `input`)
- Test: `supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts` (bloco `validarRespostaAtributos`)

**Interfaces:**
- Consumes: `AtributoAlvo.tipo` (Task 1), `InputAtributos` (existente, `atributos-llm-core.ts:16-19`), `normalizar` (existente).
- Produces: `validarRespostaAtributos(resp, alvos, input: InputAtributos): AtributoML[]` — nova assinatura com `input`. Aceita texto-livre só se constar em `input.nome + input.descricao`.

- [ ] **Step 1: Escrever os testes de texto-livre (com `input`)**

Adicione ao `describe('validarRespostaAtributos (closed-set)')` (ou crie um `describe` novo) — note o 3º argumento `input`:

```ts
  describe('validarRespostaAtributos (texto-livre, anti-invenção)', () => {
    const schema = [A({ id: 'LINE', nome: 'Linha', required: true })];
    const alvos = atributosAlvo(schema, []);
    const input = { nome: 'Barbante Bandeirante Cores', descricao: 'linha Anne para crochê' };
    it('aceita texto que consta no nome/descrição (normalizado)', () => {
      expect(validarRespostaAtributos({ LINE: 'Anne' }, alvos, input)).toEqual([{ id: 'LINE', value_name: 'Anne' }]);
    });
    it('rejeita texto que NÃO consta na fonte (invenção)', () => {
      expect(validarRespostaAtributos({ LINE: 'Círculo' }, alvos, input)).toEqual([]);
    });
    it('rejeita texto absurdamente longo', () => {
      const longo = 'x'.repeat(80);
      expect(validarRespostaAtributos({ LINE: longo }, alvos, { nome: longo })).toEqual([]);
    });
  });
```

Atualize as chamadas existentes de `validarRespostaAtributos(resp, alvos)` nos testes já presentes para passar um input dummy `{ nome: '' }` (ex.: closed-set e numérico não usam a fonte, mas a assinatura mudou):

```ts
  // exemplos: validarRespostaAtributos({ VOLTAGE: '3' }, alvos, { nome: '' })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts -t validarRespostaAtributos`
Expected: FAIL — assinatura sem `input` e sem ramo de texto.

- [ ] **Step 3: Implementar `validarTextoLivre` e o novo ramo**

Em `atributos-llm-core.ts`, adicione antes de `validarRespostaAtributos`:

```ts
// Texto-livre só é aceito se constar (normalizado) no nome/descrição do produto — materializa
// "inferir do texto, nunca inventar" (ADR-0052). Também limita o comprimento p/ a IA não despejar
// a frase inteira como valor.
const MAX_TEXTO_LIVRE = 60;
function validarTextoLivre(bruto: string, input: InputAtributos): string | null {
  const valor = bruto.trim();
  if (!valor || valor.length > MAX_TEXTO_LIVRE) return null;
  const fonte = normalizar(`${input.nome} ${input.descricao ?? ''}`);
  return fonte.includes(normalizar(valor)) ? valor : null;
}
```

E reescreva `validarRespostaAtributos` para receber `input` e discriminar por `tipo`:

```ts
export function validarRespostaAtributos(
  resp: Record<string, string>,
  alvos: AtributoAlvo[],
  input: InputAtributos,
): AtributoML[] {
  const out: AtributoML[] = [];
  for (const alvo of alvos) {
    const bruto = resp?.[alvo.id];
    if (bruto == null || bruto === '') continue;
    if (alvo.tipo === 'closed') {
      const porId = alvo.valores.find((v) => v.id === String(bruto));
      const porNome = porId ? null : alvo.valores.find((v) => normalizar(v.nome) === normalizar(String(bruto)));
      const escolhido = porId ?? porNome;
      if (escolhido) out.push({ id: alvo.id, value_id: escolhido.id });
    } else if (alvo.tipo === 'numero') {
      const valor = validarNumerico(String(bruto), alvo.unidades);
      if (valor) out.push({ id: alvo.id, value_name: valor });
    } else { // texto
      const valor = validarTextoLivre(String(bruto), input);
      if (valor) out.push({ id: alvo.id, value_name: valor });
    }
  }
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts -t validarRespostaAtributos`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/atributos-llm-core.ts supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts
git commit -m "feat(atributos-ia): valida texto-livre só se constar no texto do produto (anti-invenção)"
```

---

### Task 3: Prompt da IA para texto-livre

**Files:**
- Modify: `supabase/functions/_shared/ai/atributos-llm-core.ts` (`montarPromptAtributos` ~136-159)
- Test: `supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts` (bloco `montarPromptAtributos`, se existir; senão criar)

**Interfaces:**
- Consumes: `AtributoAlvo.tipo` (Task 1).
- Produces: `montarPromptAtributos` gera, para `tipo:'texto'`, uma instrução de "copiar do título/descrição, nunca inventar".

- [ ] **Step 1: Escrever o teste do bloco de texto-livre**

```ts
  describe('montarPromptAtributos (texto-livre)', () => {
    const schema = [A({ id: 'LINE', nome: 'Linha', required: true })];
    const alvos = atributosAlvo(schema, []);
    it('pede para copiar do título/descrição e não inventar', () => {
      const p = montarPromptAtributos({ nome: 'Barbante Anne' }, alvos);
      expect(p).toMatch(/LINE/);
      expect(p.toLowerCase()).toMatch(/copie|extraia/);
      expect(p.toLowerCase()).toMatch(/n[aã]o.*invent/);
    });
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts -t "montarPromptAtributos (texto-livre)"`
Expected: FAIL — hoje o ramo default trata como numérico ("apenas o número").

- [ ] **Step 3: Implementar o ramo de texto no `blocos`**

Reescreva o `.map` dentro de `montarPromptAtributos`:

```ts
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts -t "montarPromptAtributos (texto-livre)"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/atributos-llm-core.ts supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts
git commit -m "feat(atributos-ia): prompt de texto-livre instrui copiar do produto, não inventar"
```

---

### Task 4: Costurar em `preencherAtributosClosedSet` e verificar E2E do módulo

**Files:**
- Modify: `supabase/functions/_shared/ai/atributos-llm-core.ts` (`preencherAtributosClosedSet` ~119-133: passar `input` para `validarRespostaAtributos`)
- Test: `supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts` (bloco `preencherAtributosClosedSet`)

**Interfaces:**
- Consumes: `validarRespostaAtributos(resp, alvos, input)` (Task 2). `preencherAtributosClosedSet` já recebe `input`.
- Produces: comportamento externo inalterado para `process-familia` (mesma assinatura de `preencherAtributosClosedSet`); agora também preenche texto-livre obrigatório derivável.

- [ ] **Step 1: Escrever o teste E2E do fluxo com LLM fake**

```ts
  describe('preencherAtributosClosedSet (com texto-livre)', () => {
    const schema = [A({ id: 'LINE', nome: 'Linha', required: true })];
    const input = { nome: 'Barbante Anne 400g', descricao: '' };
    it('preenche texto-livre quando a IA responde valor que consta no nome', async () => {
      const llm = async () => ({ LINE: 'Anne' });
      const out = await preencherAtributosClosedSet(schema, [], input, llm);
      expect(out).toContainEqual({ id: 'LINE', value_name: 'Anne' });
    });
    it('não preenche quando a IA responde valor inventado', async () => {
      const llm = async () => ({ LINE: 'Marca Fantasma' });
      const out = await preencherAtributosClosedSet(schema, [], input, llm);
      expect(out).toEqual([]);
    });
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts -t "preencherAtributosClosedSet (com texto-livre)"`
Expected: FAIL — `validarRespostaAtributos` ainda é chamado sem `input` dentro de `preencherAtributosClosedSet`.

- [ ] **Step 3: Passar `input` na chamada interna**

Em `preencherAtributosClosedSet`, na linha que valida a resposta:

```ts
  const preenchidos = validarRespostaAtributos(resp, restantes, input);
```

- [ ] **Step 4: Rodar a suíte inteira do módulo + deno check**

Run: `npx vitest run supabase/functions/_shared/ai/`
Expected: PASS (todos os blocos, incluindo os testes antigos ajustados para a nova assinatura).

Run: `cd supabase/functions && deno check process-familia/index.ts`
Expected: DENO=0 (o consumidor real compila com a infra alterada).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/atributos-llm-core.ts supabase/functions/_shared/ai/__tests__/atributos-llm.test.ts
git commit -m "feat(atributos-ia): preencherAtributosClosedSet passa input p/ validar texto-livre"
```

---

## Verificação final do Plano A

- [ ] `npx vitest run` (suíte inteira) verde.
- [ ] `npx tsc -b` sem erros.
- [ ] `cd supabase/functions && deno check process-familia/index.ts` (e `publicar-split-ml/index.ts` se tocar o mesmo _shared) = 0.
- [ ] Deploy CLI de `process-familia` (+ funções que importam `_shared/ai/atributos-llm-core.ts`), `verify_jwt` conforme `config.toml`.
- [ ] Validação real: reprocessar uma família não-aviamento cujo obrigatório de texto-livre esteja no nome/descrição e conferir que a IA o preenche (some do `atributos_faltantes`).

## Self-Review (feito)

- **Cobertura**: decisões 1 (inferir texto do produto) e 2 (invariante substring) do ADR-0052 cobertas pelas Tasks 1-4. Decisões 3-5 (fallback UI, flag de edição) são do **Plano B** — fora deste plano por design.
- **Placeholders**: nenhum — todo passo traz código/comando/resultado esperado.
- **Consistência de tipos**: `AtributoAlvo.tipo` (Task 1) é usado em `validarRespostaAtributos` (Task 2) e `montarPromptAtributos` (Task 3); `validarRespostaAtributos(resp, alvos, input)` (Task 2) é a assinatura usada na Task 4.

## Fora de escopo (Plano B — a planejar após A validado)

Flag `atributos_editados_pelo_operador` (migration + guard em `process-familia` + setter em `queries.ts`), edge function expondo o schema da categoria ao front, editor de atributos faltantes na Revisão (evoluir `card-categoria.tsx`), trava de publicação enquanto houver faltante. Categoria livre continua fora (fase posterior).
