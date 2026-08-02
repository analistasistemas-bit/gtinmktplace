# Título no padrão Mercado Livre — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** trocar a geração de título por um contrato de slots nomeados, montado deterministicamente no padrão do Mercado Livre — sem separador `|`, sem adjetivo vazio, com unidade canônica e Title Case.

**Architecture:** a IA passa a devolver dez slots nomeados em vez de uma string. Guards operam sobre os slots (estrutura), e a montagem em string acontece **uma única vez, ao final**, cortando por prioridade. Isso elimina a classe de bug em que injeção e corte disputam a mesma ponta do texto.

**Tech Stack:** Deno (edge functions), TypeScript, Vitest, OpenRouter `json_schema` strict.

**Spec:** `docs/superpowers/specs/2026-08-02-titulo-padrao-ml-design.md`

## Global Constraints

- Teto de **60 caracteres** no título final.
- **Nenhum `|`** no título. Nenhum emoji. Nenhum caractere decorativo (`★`, `!!!`, `[...]`).
- **Nunca truncar no meio de um token.** Remoção é sempre de slot inteiro.
- **Nunca remover um discriminador em silêncio** — `medida` sempre, e `variacao` quando discrimina.
- Montagem acontece **uma única vez**, depois de todos os guards.
- Marca só entra no título se estiver **ancorada** em `nome_pai` ou `descricao_pai`.
- Nome da loja (`Avil`, `DS`, fornecedor `AVIL`) **nunca** aparece no título.
- Slug de modelo e preço vivem em `_shared/ai/tokens.ts::PRECOS` — não alterar aqui.

**Divergência deliberada em relação à §5.4 da spec.** A spec lista seis pontos que emitem CAPS e
manda corrigir todos. Na arquitetura de slots isso deixa de ser necessário: os slots guardam
texto cru em qualquer caixa, e a capitalização é gerada **uma única vez** por `tituloCase` no
render (Task 5). Guard que escreve `BARBANTE` num slot está correto — sai `Barbante`. As duas
exceções continuam valendo porque não são caixa, são **formato do dado**: `normalizarUnidade`
(`MT` → `m`) e `extrairContagem` (`UNIDADES` → `un`), ambas na Task 2. Os outros quatro pontos
somem junto com as funções, na Task 11.
- Testes: `pnpm test <caminho>` (vitest run). Lint de functions: `pnpm lint:functions`. Tipos: `pnpm check:functions`.
- Trabalho sai na branch `worktree-copy-premium-descricao`. Nunca editar a main.

---

## Estrutura de arquivos

Convenção local: arquivos planos com prefixo em `_shared/ai/` (como `copywriter-prompt.ts`), testes espelhados em `_shared/ai/__tests__/`.

| Arquivo | Responsabilidade |
|---|---|
| `_shared/ai/titulo-slots.ts` **(novo)** | Tipo `TituloSlots`, `SLOTS_VAZIOS`, `ORDEM_LEITURA`, `ORDEM_CORTE` |
| `_shared/ai/titulo-case.ts` **(novo)** | Title Case PT-BR por slot |
| `_shared/ai/titulo-marcas.ts` **(novo)** | Mapa curado razão social → marca comercial |
| `_shared/ai/titulo-montar.ts` **(novo)** | `montarTitulo`, reduções, `TituloInviavelError` |
| `_shared/ai/titulo-guards.ts` **(novo)** | `normalizarSlots`, `aplicarGuardsTitulo`, `validarSlotsAncorados` |
| `_shared/ai/titulo-pos.ts` **(novo)** | `posProcessarTitulo` — pipeline fechado, único ponto de entrada |
| `_shared/ai/titulo.ts` | Mantém os extratores (`extrairMetragem`, `extrairLargura`, `contemMetragem`, `extrairContagem`). Guards de string legados removidos na Task 11 |
| `_shared/ai/copywriter.ts` | `SCHEMA` e `OutputCopy` passam a carregar `titulo_slots` |
| `_shared/ai/copywriter-prompt.ts` | Bloco `TÍTULO` do `SYSTEM` substituído por T1–T7 + few-shots |
| `_shared/split/titulo-particao.ts` | Usa `posProcessarTitulo`; fallback determinístico sem pipe |
| `process-familia/index.ts`, `regenerar-copy-familia/index.ts` | Cadeia manual → `posProcessarTitulo` |
| `scripts/experimento-titulo/` **(novo)** | Harness A/B e métricas |

---

## Task 1: Contrato de slots

**Files:**
- Create: `supabase/functions/_shared/ai/titulo-slots.ts`
- Test: `supabase/functions/_shared/ai/__tests__/titulo-slots.test.ts`

**Interfaces:**
- Produces: `TituloSlots` (dez chaves `string`), `SLOTS_VAZIOS: TituloSlots`, `ORDEM_LEITURA: readonly (keyof TituloSlots)[]`, `ORDEM_CORTE: readonly (keyof TituloSlots)[]`, `SlotTitulo = keyof TituloSlots`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// supabase/functions/_shared/ai/__tests__/titulo-slots.test.ts
import { describe, it, expect } from 'vitest';
import { ORDEM_CORTE, ORDEM_LEITURA, SLOTS_VAZIOS } from '../titulo-slots';

describe('contrato de slots', () => {
  it('tem exatamente dez slots', () => {
    expect(Object.keys(SLOTS_VAZIOS)).toHaveLength(10);
  });

  it('todo slot começa vazio', () => {
    expect(Object.values(SLOTS_VAZIOS).every((v) => v === '')).toBe(true);
  });

  it('ordem de corte é o espelho exato da ordem de leitura', () => {
    expect([...ORDEM_CORTE]).toEqual([...ORDEM_LEITURA].reverse());
  });

  it('ordem de leitura começa em produto e termina em sinonimo', () => {
    expect(ORDEM_LEITURA[0]).toBe('produto');
    expect(ORDEM_LEITURA[ORDEM_LEITURA.length - 1]).toBe('sinonimo');
  });

  it('as duas ordens cobrem todos os slots, sem sobra nem falta', () => {
    expect([...ORDEM_LEITURA].sort()).toEqual(Object.keys(SLOTS_VAZIOS).sort());
    expect([...ORDEM_CORTE].sort()).toEqual(Object.keys(SLOTS_VAZIOS).sort());
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/titulo-slots.test.ts`
Expected: FAIL — `Failed to resolve import "../titulo-slots"`

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/_shared/ai/titulo-slots.ts

/**
 * Slots do título (ADR-0099). Dez chaves, TODAS obrigatórias, com "" para ausente.
 *
 * Chave obrigatória com "" em vez de propriedade opcional elimina a diferença entre chave
 * ausente, null e "" — diferença que, de outro modo, vira ramificação em cada guard e no
 * montador. Também estabiliza o contrato entre modelos: o json_schema strict do OpenRouter
 * trata `required` de forma mais previsível que opcionalidade.
 */
export interface TituloSlots {
  /** Único slot que nunca pode ser "". */
  produto: string;
  marca: string;
  /** Numeração, linha ou referência que o CONSUMIDOR usa (N.3, Tex 29, 4/6). */
  modelo: string;
  medida: string;
  quantidade: string;
  material: string;
  /** Cor, tamanho, espessura — o discriminador da família perante as irmãs. */
  variacao: string;
  compatibilidade: string;
  aplicacao: string;
  sinonimo: string;
}

export type SlotTitulo = keyof TituloSlots;

export const SLOTS_VAZIOS: TituloSlots = {
  produto: '', marca: '', modelo: '', medida: '', quantidade: '',
  material: '', variacao: '', compatibilidade: '', aplicacao: '', sinonimo: '',
};

/**
 * Ordem de LEITURA: posição de cada slot no texto final. É a hierarquia do padrão ML
 * (produto → marca → modelo → medida → ... → sinônimo).
 */
export const ORDEM_LEITURA = [
  'produto', 'marca', 'modelo', 'medida', 'quantidade',
  'material', 'variacao', 'compatibilidade', 'aplicacao', 'sinonimo',
] as const satisfies readonly SlotTitulo[];

/**
 * Ordem de CORTE: quem sai primeiro quando estoura 60 chars. É o espelho exato da ordem de
 * leitura — o menos prioritário sai antes.
 *
 * Ordem de leitura e ordem de corte são contratos DISTINTOS de propósito: é o que permite
 * proteger `variacao` do corte sem tirá-la do lugar no texto. Quem decide o que é incortável
 * é montarTitulo (titulo-montar.ts), não esta lista.
 */
export const ORDEM_CORTE = [...ORDEM_LEITURA].reverse() as readonly SlotTitulo[];
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/titulo-slots.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/titulo-slots.ts supabase/functions/_shared/ai/__tests__/titulo-slots.test.ts
git commit -m "feat(titulo): contrato de dez slots nomeados com ordem de leitura e de corte"
```

---

## Task 2: Unidade canônica (`MT` → `m`)

**Files:**
- Modify: `supabase/functions/_shared/ai/titulo.ts:16-24` (`normalizarUnidade`, `extrairMetragem`), `:107-115` (`extrairContagem`)
- Test: `supabase/functions/_shared/ai/__tests__/titulo.test.ts` (existente), `supabase/functions/_shared/ai/__tests__/copywriter-largura.test.ts` (existente, regressão)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `extrairMetragem` passa a devolver `'100m'` (era `'100MT'`); `extrairContagem` passa a devolver `'10un'` (era `'10 UNIDADES'`).

**Contexto que o implementador precisa:** `extrairMetragem` é consumido também por `garantirMetragemDescricao` (`copywriter-prompt.ts:127`), do lado da **descrição**. A mudança não pode fazer o bullet `• Metragem:` desaparecer — só mudar o texto dele.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// acrescentar em supabase/functions/_shared/ai/__tests__/titulo.test.ts
import { extrairContagem, extrairMetragem } from '../titulo';

describe('unidade canônica (ADR-0099)', () => {
  it('metragem sai em "m" minúsculo, nunca "MT"', () => {
    expect(extrairMetragem('FITA CETIM N.3 100MT')).toBe('100m');
    expect(extrairMetragem('LANTEJOULAS CORES C/50MTS')).toBe('50m');
    expect(extrairMetragem('TECIDO HELANCA 10 METROS')).toBe('10m');
  });

  it('preserva decimal em formato BR', () => {
    expect(extrairMetragem('BORDADO EM PECA C/13,71MT')).toBe('13,71m');
  });

  it('contagem sai em "un", nunca "UNIDADES" nem "UND"', () => {
    expect(extrairContagem('SACO DE ORGANZA C/10UND')).toBe('10un');
    expect(extrairContagem('POMPOM C/100UND')).toBe('100un');
    expect(extrairContagem('KIT COM 12 PEÇAS')).toBe('12pc');
  });

  it('sem metragem no texto devolve null', () => {
    expect(extrairMetragem('COLCHETE C/GANCHO TAM')).toBeNull();
  });
});
```

```ts
// acrescentar em supabase/functions/_shared/ai/__tests__/copywriter-largura.test.ts
import { garantirMetragemDescricao } from '../copywriter-prompt';

describe('regressão: descrição não perde a metragem com a unidade nova', () => {
  it('injeta o bullet com "m" minúsculo', () => {
    const out = garantirMetragemDescricao('🧵 INTRO\n\nTexto.', 'FITA CETIM 100MT');
    expect(out).toContain('• Metragem: 100m');
  });

  it('continua não duplicando quando a IA já citou em prosa', () => {
    const out = garantirMetragemDescricao('🧵 INTRO\n\nRolo com 100 metros.', 'FITA CETIM 100MT');
    expect(out).not.toContain('• Metragem');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/titulo.test.ts`
Expected: FAIL — recebido `'100MT'`, esperado `'100m'`

- [ ] **Step 3: Implementar**

Em `titulo.ts`, substituir `normalizarUnidade` e ajustar `extrairMetragem`:

```ts
// A unidade canônica do padrão ML é "m" minúsculo (ADR-0099): "570m", nunca "570mt".
// Esta função ANTES emitia 'MT'/'M' — era a origem dos 38% de títulos com "MT" medidos em
// produção. A DETECÇÃO continua aceitando MT/MTS/METROS/M na entrada; só a EMISSÃO mudou.
function normalizarUnidade(_raw: string): string {
  return 'm';
}

export function extrairMetragem(nome: string): string | null {
  const m = nome.match(RE_METRAGEM);
  if (!m) return null;
  return `${m[1]}${normalizarUnidade(m[2])}`;
}
```

E `extrairContagem`:

```ts
// Canônico: "10un" / "12pc" (ADR-0099). Antes emitia "10 UNIDADES", que gastava caractere e
// destoava do padrão ML. A detecção segue aceitando UNIDADES/UND/UN/PEÇAS/PÇS/PCS/PC.
function extrairContagem(texto: string): string | null {
  const m = texto.match(RE_CONTAGEM);
  if (!m) return null;
  const unidade = /^(?:P|PC)/i.test(m[2]) ? 'pc' : 'un';
  return `${m[1]}${unidade}`;
}
```

**Atenção:** `extrairContagem` é hoje `function` privada. A Task 6 vai precisar dela — exportar agora: trocar `function extrairContagem` por `export function extrairContagem`.

- [ ] **Step 4: Rodar a suíte inteira de título e descrição**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/`
Expected: PASS. Testes antigos que fixavam `'100MT'`/`'10 UNIDADES'` como esperado precisam ser atualizados para a forma canônica nova — **atualizar o esperado, não reverter a função.**

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/titulo.ts supabase/functions/_shared/ai/__tests__/
git commit -m "feat(titulo): unidade canônica m/un/pc, substituindo MT e UNIDADES"
```

---

## Task 3: Title Case PT-BR

**Files:**
- Create: `supabase/functions/_shared/ai/titulo-case.ts`
- Test: `supabase/functions/_shared/ai/__tests__/titulo-case.test.ts`

**Interfaces:**
- Produces: `tituloCase(texto: string, ehPrimeiroSlot: boolean): string`

**Contexto:** a entrada vem toda em CAPS da planilha (`FITA CETIM BUFALO N.3 16MM CORES 10MT`), então não há capitalização original a preservar — isto é **geração**, não transformação.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// supabase/functions/_shared/ai/__tests__/titulo-case.test.ts
import { describe, it, expect } from 'vitest';
import { tituloCase } from '../titulo-case';

describe('tituloCase', () => {
  it('capitaliza palavras comuns', () => {
    expect(tituloCase('FITA CETIM', true)).toBe('Fita Cetim');
  });

  it('mantém preposição e artigo em minúscula, exceto na primeira palavra', () => {
    expect(tituloCase('AGULHA DE CROCHE', true)).toBe('Agulha de Croche');
    expect(tituloCase('SACO DE ORGANZA', true)).toBe('Saco de Organza');
    expect(tituloCase('PARA FORRO', false)).toBe('para Forro');
  });

  it('primeira palavra do primeiro slot capitaliza mesmo sendo preposição', () => {
    expect(tituloCase('DE LUXO', true)).toBe('De Luxo');
  });

  it('mantém unidade em minúscula', () => {
    expect(tituloCase('100M', false)).toBe('100m');
    expect(tituloCase('6MM', false)).toBe('6mm');
    expect(tituloCase('500G', false)).toBe('500g');
    expect(tituloCase('10UN', false)).toBe('10un');
    expect(tituloCase('3,5CM', false)).toBe('3,5cm');
  });

  it('mantém sigla da lista fechada em caixa alta', () => {
    expect(tituloCase('PVC', false)).toBe('PVC');
    expect(tituloCase('EVA', false)).toBe('EVA');
    expect(tituloCase('FPS 60', false)).toBe('FPS 60');
  });

  it('formata percentual seguido de material', () => {
    expect(tituloCase('100% POLIESTER', false)).toBe('100% Poliester');
    expect(tituloCase('85% ALGODAO', false)).toBe('85% Algodao');
  });

  it('Tex não é sigla — vira Title Case', () => {
    expect(tituloCase('TEX 29', false)).toBe('Tex 29');
  });

  it('preserva a forma da numeração da fonte', () => {
    expect(tituloCase('N.3', false)).toBe('N.3');
    expect(tituloCase('N.02', false)).toBe('N.02');
    expect(tituloCase('4/6', false)).toBe('4/6');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/titulo-case.test.ts`
Expected: FAIL — `Failed to resolve import "../titulo-case"`

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/_shared/ai/titulo-case.ts

/**
 * Title Case PT-BR para slots de título (ADR-0099).
 *
 * É GERAÇÃO, não transformação: a entrada vem toda em CAPS da planilha
 * ("FITA CETIM BUFALO N.3 16MM"), então não existe capitalização original a preservar.
 */

// Minúsculas quando não são a primeira palavra do título.
const ATONAS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'com', 'sem', 'para', 'por', 'a', 'o', 'as', 'os', 'ao', 'aos',
]);

// Lista FECHADA. Não é catch-all: "Tex 29" é Title Case, não "TEX 29" — o documento do padrão
// ML escreve assim, e sigla aberta transformaria qualquer palavra curta em caixa alta.
const SIGLAS = new Set(['PVC', 'EVA', 'MDF', 'MDP', 'FPS', 'LED', 'ABS', 'PET', 'PP', 'PU']);

// Número colado à unidade: 100m, 6mm, 500g, 10un, 3,5cm, 2l. Unidade sempre minúscula.
const RE_UNIDADE = /^(\d+(?:[.,]\d+)?)(m|mm|cm|g|kg|l|ml|un|pc)$/i;
// Percentual: 100%, 85%.
const RE_PERCENTUAL = /^\d+%$/;
// Numeração da fonte, preservada como está: N.3, N.02, 4/6, 8/4.
const RE_NUMERACAO = /^(?:[A-Za-z]+\.\d+|\d+\/\d+)$/;

function capitalizar(p: string): string {
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

function palavraCase(bruta: string, ehPrimeira: boolean): string {
  const p = bruta.trim();
  if (!p) return p;

  const unidade = p.match(RE_UNIDADE);
  if (unidade) return `${unidade[1]}${unidade[2].toLowerCase()}`;

  if (RE_PERCENTUAL.test(p)) return p;
  if (RE_NUMERACAO.test(p)) return p;
  if (SIGLAS.has(p.toUpperCase())) return p.toUpperCase();

  const minuscula = p.toLowerCase();
  // Átona só perde a maiúscula quando NÃO abre o título — "De Luxo" no início continua "De".
  if (!ehPrimeira && ATONAS.has(minuscula)) return minuscula;
  return capitalizar(p);
}

/**
 * `ehPrimeiroSlot` diz se este slot abre o título. Só a primeira palavra do PRIMEIRO slot
 * escapa da regra de átona — "Fita de Cetim para Forro" mantém "para" minúsculo mesmo sendo
 * a primeira palavra do slot `aplicacao`.
 */
export function tituloCase(texto: string, ehPrimeiroSlot: boolean): string {
  return texto
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => palavraCase(p, ehPrimeiroSlot && i === 0))
    .join(' ');
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/titulo-case.test.ts`
Expected: PASS (9 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/titulo-case.ts supabase/functions/_shared/ai/__tests__/titulo-case.test.ts
git commit -m "feat(titulo): Title Case PT-BR com átonas, unidades, siglas e numeração da fonte"
```

---

## Task 4: Mapa de marcas

**Files:**
- Create: `supabase/functions/_shared/ai/titulo-marcas.ts`
- Test: `supabase/functions/_shared/ai/__tests__/titulo-marcas.test.ts`

**Interfaces:**
- Produces: `marcaDoFornecedor(fornecedor: string | null): string | null`, `LOJA_NUNCA_MARCA: readonly string[]`

**Contexto medido em produção:** `familias.fornecedor` é razão social **truncada em 30 chars**. Derivar a marca por heurística NÃO funciona — o primeiro token útil produz `"BARBANTE"` para `FABRICA DE BARBANTE BANDEIRANT`, `"V"` para `V.R.MACHADO SILK SREEN EM GERA` e `"LINHAS"` para `LINHAS SETTA LTDA`. Por isso o mapa é curado à mão e chaveado na string **como está gravada**.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// supabase/functions/_shared/ai/__tests__/titulo-marcas.test.ts
import { describe, it, expect } from 'vitest';
import { marcaDoFornecedor } from '../titulo-marcas';

describe('marcaDoFornecedor', () => {
  it('corrige a grafia e o acento da marca', () => {
    expect(marcaDoFornecedor('BUFALO')).toBe('Búfalo');
    expect(marcaDoFornecedor('CIRCULO S.A.')).toBe('Círculo');
  });

  it('resolve razão social truncada para a marca comercial', () => {
    expect(marcaDoFornecedor('FABRICA DE BARBANTE BANDEIRANT')).toBe('Bandeirante');
    expect(marcaDoFornecedor('BR17-COATS CORRENTE LTDA')).toBe('Corrente');
    expect(marcaDoFornecedor('LINHAS SETTA LTDA')).toBe('Setta');
  });

  it('devolve null quando a razão social não tem marca comercial identificável', () => {
    expect(marcaDoFornecedor('V.R.MACHADO SILK SREEN EM GERA')).toBeNull();
    expect(marcaDoFornecedor('S.PROCHOWNIK COMERCIAL LTDA')).toBeNull();
  });

  it('NUNCA devolve o nome da loja como marca', () => {
    expect(marcaDoFornecedor('AVIL')).toBeNull();
    expect(marcaDoFornecedor('DS')).toBeNull();
  });

  it('fornecedor fora do mapa não bloqueia nada — devolve null e o fluxo segue pela fonte', () => {
    expect(marcaDoFornecedor('FORNECEDOR NOVO QUALQUER')).toBeNull();
    expect(marcaDoFornecedor(null)).toBeNull();
    expect(marcaDoFornecedor('')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/titulo-marcas.test.ts`
Expected: FAIL — `Failed to resolve import "../titulo-marcas"`

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/_shared/ai/titulo-marcas.ts

/**
 * Mapa curado razão social → marca comercial (ADR-0099).
 *
 * `familias.fornecedor` é razão social TRUNCADA em 30 chars, não marca. Derivar por heurística
 * foi medido e não funciona: o primeiro token útil devolve "BARBANTE" para
 * FABRICA DE BARBANTE BANDEIRANT, "V" para V.R.MACHADO e "LINHAS" para LINHAS SETTA. Daí o
 * mapa ser manual e chaveado na string COMO ESTÁ GRAVADA — essa forma é estável.
 *
 * O MAPA FORNECE A GRAFIA; A FONTE FORNECE A PERMISSÃO. Este módulo só diz como a marca se
 * escreve. Quem decide se ela pode entrar no título é validarSlotsAncorados (titulo-guards.ts),
 * exigindo que apareça em nome_pai ou descricao_pai. Sem isso o sistema estaria afirmando uma
 * marca a partir de um campo de fornecedor — o que o padrão do ML proíbe.
 *
 * Entrada com `null` é deliberada, não lacuna: significa "esta razão social não carrega marca
 * comercial identificável, nunca invente uma a partir dela".
 */
const MARCAS: Record<string, string | null> = {
  'BUFALO': 'Búfalo',
  'CIRCULO S.A.': 'Círculo',
  'DETALLIA FITAS TEXTEIS LTDA': 'Detallia',
  'ECOFIBRA INDUSTRIA TEXTIL': 'Ecofibra',
  'TRINITY': 'Trinity',
  'FABRICA DE BARBANTE BANDEIRANT': 'Bandeirante',
  'LINHANYL S/A': 'Linhanyl',
  'BR17-COATS CORRENTE LTDA': 'Corrente',
  'LINHAS SETTA LTDA': 'Setta',
  'FISCHER COMERCIO DE PRODUTOS P': 'Fischer',
  'Eucerin': 'Eucerin',
  // Sem marca comercial identificável na razão social:
  'V.R.MACHADO SILK SREEN EM GERA': null,
  'S.PROCHOWNIK COMERCIAL LTDA': null,
};

/**
 * Nomes de loja. `AVIL` aparece gravado como fornecedor em produção, e `DS` é a marca_padrao da
 * org DSA. O padrão do ML proíbe nome de loja no título — bloqueio explícito, nunca só omissão.
 */
export const LOJA_NUNCA_MARCA: readonly string[] = ['AVIL', 'DS', 'AVIL LTDA', 'DSA'];

export function marcaDoFornecedor(fornecedor: string | null): string | null {
  const chave = fornecedor?.trim();
  if (!chave) return null;
  if (LOJA_NUNCA_MARCA.includes(chave.toUpperCase())) return null;
  return MARCAS[chave] ?? null;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/titulo-marcas.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/titulo-marcas.ts supabase/functions/_shared/ai/__tests__/titulo-marcas.test.ts
git commit -m "feat(titulo): mapa curado de marcas com bloqueio de nome de loja"
```

---

## Task 5: `montarTitulo` + `TituloInviavelError`

**Files:**
- Create: `supabase/functions/_shared/ai/titulo-montar.ts`
- Test: `supabase/functions/_shared/ai/__tests__/titulo-montar.test.ts`

**Interfaces:**
- Consumes: `TituloSlots`, `SLOTS_VAZIOS`, `ORDEM_LEITURA`, `ORDEM_CORTE`, `SlotTitulo` (Task 1); `tituloCase` (Task 3).
- Produces: `montarTitulo(slots: TituloSlots, ctx: ContextoCorte): string`, `TituloInviavelError`, `ContextoCorte = { variacaoDiscrimina: boolean }`, `TITULO_MAX = 60`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// supabase/functions/_shared/ai/__tests__/titulo-montar.test.ts
import { describe, it, expect } from 'vitest';
import { montarTitulo, TituloInviavelError } from '../titulo-montar';
import { SLOTS_VAZIOS, type TituloSlots } from '../titulo-slots';

const slots = (p: Partial<TituloSlots>): TituloSlots => ({ ...SLOTS_VAZIOS, ...p });
const semDiscriminador = { variacaoDiscrimina: false };
const comDiscriminador = { variacaoDiscrimina: true };

describe('montarTitulo — montagem', () => {
  it('junta na ordem de leitura, com um espaço', () => {
    const t = montarTitulo(slots({
      produto: 'BARBANTE', marca: 'BANDEIRANTE', modelo: '4/6',
      medida: '570m', material: '85% ALGODAO',
    }), semDiscriminador);
    expect(t).toBe('Barbante Bandeirante 4/6 570m 85% Algodao');
  });

  it('ignora slots vazios sem deixar espaço duplo', () => {
    const t = montarTitulo(slots({ produto: 'AGULHA DE CROCHE', medida: '3,5mm' }), semDiscriminador);
    expect(t).toBe('Agulha de Croche 3,5mm');
    expect(t).not.toMatch(/\s{2}/);
  });

  it('nunca emite pipe', () => {
    const t = montarTitulo(slots({ produto: 'FITA', material: '100% POLIESTER' }), semDiscriminador);
    expect(t).not.toContain('|');
  });
});

describe('montarTitulo — corte por prioridade', () => {
  it('remove o slot de menor prioridade primeiro', () => {
    const t = montarTitulo(slots({
      produto: 'TECIDO HELANCA LIGHT', medida: '10m', material: 'POLIESTER',
      variacao: 'PRETO', aplicacao: 'PARA FORRO', sinonimo: 'HELANQUINHA',
    }), semDiscriminador);
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t).not.toContain('Helanquinha'); // sinonimo sai antes de aplicacao
  });

  it('nunca trunca um token no meio', () => {
    const t = montarTitulo(slots({
      produto: 'BORDADO INGLES EM PECA REFERENCIA CORES',
      marca: 'BUFALO', medida: '13,71m', variacao: 'BRANCO', aplicacao: 'PARA ACABAMENTO',
    }), semDiscriminador);
    for (const token of t.split(' ')) {
      expect(['Bordado', 'Ingles', 'Em', 'Peca', 'Referencia', 'Cores', 'Bufalo',
              '13,71m', 'Branco', 'para', 'Acabamento']).toContain(token);
    }
  });

  it('medida sobrevive mesmo espremendo o resto', () => {
    const t = montarTitulo(slots({
      produto: 'TECIDO OXFORD LISO ESTAMPADO ESPECIAL',
      marca: 'DETALLIA', medida: '10m', material: '100% POLIESTER',
      aplicacao: 'PARA DECORACAO', sinonimo: 'OXFORDINHO',
    }), semDiscriminador);
    expect(t).toContain('10m');
    expect(t.length).toBeLessThanOrEqual(60);
  });

  it('variacao sobrevive quando discrimina, mesmo custando outros slots', () => {
    const t = montarTitulo(slots({
      produto: 'LINHA ESPECIAL PARA RENASCENCA',
      marca: 'CIRCULO', quantidade: '10un', material: '100% ALGODAO',
      variacao: 'BEGE', aplicacao: 'PARA BORDADO',
    }), comDiscriminador);
    expect(t).toContain('Bege');
    expect(t.length).toBeLessThanOrEqual(60);
  });

  it('variacao é cortável quando NÃO discrimina', () => {
    const t = montarTitulo(slots({
      produto: 'LINHA ESPECIAL PARA RENASCENCA BORDADA',
      marca: 'CIRCULO', quantidade: '10un', material: '100% ALGODAO MERCERIZADO',
      variacao: 'CORES SORTIDAS',
    }), semDiscriminador);
    expect(t).not.toContain('Sortidas');
    expect(t.length).toBeLessThanOrEqual(60);
  });
});

describe('montarTitulo — reduções antes de remover', () => {
  it('reduz 100% Poliéster para Poliéster antes de derrubar um slot', () => {
    const t = montarTitulo(slots({
      produto: 'FITAS DE VELUDO DECORATIVA', marca: 'BUFALO',
      medida: '25m', material: '100% POLIESTER', variacao: 'AMARELO OURO',
    }), comDiscriminador);
    expect(t).toContain('Poliester');
    expect(t).toContain('Amarelo Ouro');
    expect(t.length).toBeLessThanOrEqual(60);
  });
});

describe('montarTitulo — inviável', () => {
  it('lança TituloInviavelError quando o obrigatório não cabe', () => {
    expect(() => montarTitulo(slots({
      produto: 'BORDADO INGLES EM PECA REFERENCIA CORES PASSA FITA ESPECIAL PREMIUM EXTRA',
      medida: '13,71m', variacao: 'BRANCO',
    }), comDiscriminador)).toThrow(TituloInviavelError);
  });

  it('o erro carrega os slots e o comprimento, para a mensagem ao operador', () => {
    try {
      montarTitulo(slots({
        produto: 'BORDADO INGLES EM PECA REFERENCIA CORES PASSA FITA ESPECIAL PREMIUM EXTRA',
        medida: '13,71m', variacao: 'BRANCO',
      }), comDiscriminador);
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(TituloInviavelError);
      const err = e as TituloInviavelError;
      expect(err.comprimento).toBeGreaterThan(60);
      expect(err.slotsObrigatorios.produto).toBeTruthy();
      expect(err.slotsObrigatorios.medida).toBe('13,71m');
    }
  });
});

describe('montarTitulo — propriedades', () => {
  const casos: TituloSlots[] = [
    slots({ produto: 'FITA CETIM', marca: 'PROGRESSO', modelo: 'N.1', medida: '100m', material: '100% POLIESTER' }),
    slots({ produto: 'LANTEJOULA', marca: 'BUFALO', medida: '50m 6mm', material: 'PVC' }),
    slots({ produto: 'GRAMPEADOR GRANDE', marca: 'BUFALO', quantidade: '30un' }),
    slots({ produto: 'AGULHA DE CROCHE', marca: 'CIRCULO', medida: '3,5mm', material: 'ALUMINIO' }),
  ];

  it('nunca passa de 60 caracteres', () => {
    for (const c of casos) expect(montarTitulo(c, semDiscriminador).length).toBeLessThanOrEqual(60);
  });

  it('nunca termina nem começa com espaço', () => {
    for (const c of casos) {
      const t = montarTitulo(c, semDiscriminador);
      expect(t).toBe(t.trim());
    }
  });

  it('nunca contém espaço duplo', () => {
    for (const c of casos) expect(montarTitulo(c, semDiscriminador)).not.toMatch(/\s{2}/);
  });

  it('é determinístico', () => {
    for (const c of casos) {
      expect(montarTitulo(c, semDiscriminador)).toBe(montarTitulo(c, semDiscriminador));
    }
  });

  it('nunca remove um slot de prioridade maior enquanto existir um de menor', () => {
    // Preenche TODOS os slots com valores longos e força o corte até o limite. A cada remoção,
    // o slot que saiu tem de ser o de menor prioridade ainda presente.
    const cheio = slots({
      produto: 'TECIDO OXFORD', marca: 'DETALLIA', modelo: 'N.12', medida: '10m',
      quantidade: '5un', material: 'POLIESTER', variacao: 'AZUL',
      compatibilidade: 'PARA MAQUINA', aplicacao: 'PARA FORRO', sinonimo: 'OXFORDINHO',
    });
    const t = montarTitulo(cheio, semDiscriminador);
    const presente = (v: string) => t.toLowerCase().includes(v.toLowerCase());

    // Lido do MENOS para o MAIS prioritário, o vetor de presença tem de ser monotônico:
    // uma sequência de ausentes seguida de uma sequência de presentes, nunca intercalado.
    const porPrioridade: Array<[string, string]> = [
      ['produto', 'Oxford'], ['marca', 'Detallia'], ['modelo', 'N.12'], ['medida', '10m'],
      ['quantidade', '5un'], ['material', 'Poliester'], ['variacao', 'Azul'],
      ['compatibilidade', 'Maquina'], ['aplicacao', 'Forro'], ['sinonimo', 'Oxfordinho'],
    ];
    let viuPresente = false;
    for (let i = porPrioridade.length - 1; i >= 0; i--) {
      const [nome, valor] = porPrioridade[i];
      if (presente(valor)) viuPresente = true;
      // Ausente DEPOIS de já ter visto um presente menos prioritário = ordem de corte violada.
      else expect(viuPresente, `${nome} foi cortado, mas um slot menos prioritário sobreviveu`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/titulo-montar.test.ts`
Expected: FAIL — `Failed to resolve import "../titulo-montar"`

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/_shared/ai/titulo-montar.ts
import { tituloCase } from './titulo-case.ts';
import { ORDEM_CORTE, ORDEM_LEITURA, type SlotTitulo, type TituloSlots } from './titulo-slots.ts';

export const TITULO_MAX = 60;

/**
 * O conjunto obrigatório de slots não cabe em 60 chars e não há corte legítimo restante.
 *
 * Falhar alto aqui é deliberado. As alternativas seriam truncar (produz título inválido) ou
 * remover um discriminador (funde dois produtos num anúncio só, e o ML derruba por duplicado) —
 * ambas silenciosas. O projeto já aplica essa regra a dado de negócio: nunca defaultar em
 * silêncio.
 *
 * ATENÇÃO ao capturar: gerarCopy é a única etapa de IA sem fallback resiliente (ADR-0030), então
 * este erro derruba a família. Cada call site DEVE traduzi-lo em mensagem acionável nomeando os
 * slots que não couberam — família morta com stack opaco trocaria um defeito silencioso por outro.
 */
export class TituloInviavelError extends Error {
  constructor(
    readonly slotsObrigatorios: Partial<TituloSlots>,
    readonly comprimento: number,
  ) {
    super(`Título obrigatório excede ${TITULO_MAX} caracteres: ${comprimento}`);
    this.name = 'TituloInviavelError';
  }
}

export interface ContextoCorte {
  /**
   * `variacao` identifica unicamente esta família perante as irmãs. Hoje isso vale quando
   * nCores === 1 (a planilha separou as cores em PAI distintos), mas a regra é sobre a FUNÇÃO
   * do dado, não sobre o tipo — amanhã pode ser tamanho ou espessura.
   */
  variacaoDiscrimina: boolean;
}

/**
 * Reduções determinísticas, aplicadas ANTES de remover qualquer slot. Cada uma preserva a
 * identidade da informação e só encurta a forma — ao contrário da remoção, que a elimina.
 */
const REDUCOES: Partial<Record<SlotTitulo, (v: string) => string>> = {
  // "100% Poliéster" → "Poliéster": mantém o material, larga o percentual.
  material: (v) => v.replace(/^\d+%\s*/, ''),
  // "Número 6" → "N.6"
  modelo: (v) => v.replace(/^N[úu]mero\s+/i, 'N.'),
  // "10 Unidades" → "10un" (rede: normalizarSlots já canoniza, isto pega o que escapou)
  quantidade: (v) => v.replace(/^(\d+)\s*unidades?$/i, '$1un').replace(/^(\d+)\s*pe[çc]as?$/i, '$1pc'),
};

function slotsIncortaveis(ctx: ContextoCorte): Set<SlotTitulo> {
  // `produto` é a identidade e `medida` distingue SKUs (10m ≠ 100m; 1kg ≠ 500g) — é a razão de
  // existir do garantirMetragemTitulo, cujo histórico registra a IA descartando a metragem sob
  // o teto de 60. `variacao` entra só quando discrimina.
  const base: SlotTitulo[] = ['produto', 'medida'];
  if (ctx.variacaoDiscrimina) base.push('variacao');
  return new Set(base);
}

function render(slots: TituloSlots, presentes: Set<SlotTitulo>): string {
  const partes: string[] = [];
  for (const slot of ORDEM_LEITURA) {
    const valor = slots[slot]?.trim();
    if (!valor || !presentes.has(slot)) continue;
    partes.push(tituloCase(valor, partes.length === 0));
  }
  return partes.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Monta o título final a partir dos slots. É o ÚNICO ponto onde slots viram string, e roda
 * depois de todos os guards — se algum guard injetasse dado depois daqui, injeção e corte
 * voltariam a disputar a mesma ponta do texto, que é o bug que este desenho elimina.
 *
 * Estratégia: renderiza; se estourar, aplica reduções; se ainda estourar, remove slots na ordem
 * de corte, pulando os incortáveis; esgotado tudo, lança TituloInviavelError.
 */
export function montarTitulo(slots: TituloSlots, ctx: ContextoCorte): string {
  const protegidos = slotsIncortaveis(ctx);
  let atual: TituloSlots = { ...slots };
  const presentes = new Set<SlotTitulo>(ORDEM_LEITURA.filter((s) => slots[s]?.trim()));

  if (render(atual, presentes).length <= TITULO_MAX) return render(atual, presentes);

  // 1. Reduções — preservam a informação, só encurtam a forma.
  for (const [slot, reduzir] of Object.entries(REDUCOES) as Array<[SlotTitulo, (v: string) => string]>) {
    if (!presentes.has(slot)) continue;
    atual = { ...atual, [slot]: reduzir(atual[slot]) };
    if (render(atual, presentes).length <= TITULO_MAX) return render(atual, presentes);
  }

  // 2. Remoção de slots inteiros, do menos prioritário ao mais. Nunca corta token.
  for (const slot of ORDEM_CORTE) {
    if (protegidos.has(slot) || !presentes.has(slot)) continue;
    presentes.delete(slot);
    if (render(atual, presentes).length <= TITULO_MAX) return render(atual, presentes);
  }

  // 3. Só restaram incortáveis e ainda não cabe.
  const obrigatorios: Partial<TituloSlots> = {};
  for (const slot of protegidos) if (atual[slot]?.trim()) obrigatorios[slot] = atual[slot];
  throw new TituloInviavelError(obrigatorios, render(atual, presentes).length);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/titulo-montar.test.ts`
Expected: PASS (14 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/titulo-montar.ts supabase/functions/_shared/ai/__tests__/titulo-montar.test.ts
git commit -m "feat(titulo): montarTitulo com corte por prioridade e TituloInviavelError"
```

---

## Task 6: Guards sobre slots

**Files:**
- Create: `supabase/functions/_shared/ai/titulo-guards.ts`
- Test: `supabase/functions/_shared/ai/__tests__/titulo-guards.test.ts`

**Interfaces:**
- Consumes: `TituloSlots`, `SLOTS_VAZIOS` (Task 1); `extrairMetragem`, `extrairLargura`, `extrairContagem` (Task 2, `titulo.ts`); `marcaDoFornecedor`, `LOJA_NUNCA_MARCA` (Task 4).
- Produces:
  - `DadosFonteTitulo = { nomePai: string; descricaoPai: string; tipoProdutoBusca: string; cores: string[]; fornecedor: string | null }`
  - `normalizarSlots(slots: TituloSlots): TituloSlots`
  - `aplicarGuardsTitulo(slots: TituloSlots, fonte: DadosFonteTitulo): TituloSlots`
  - `validarSlotsAncorados(slots: TituloSlots, fonte: DadosFonteTitulo): TituloSlots`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// supabase/functions/_shared/ai/__tests__/titulo-guards.test.ts
import { describe, it, expect } from 'vitest';
import { aplicarGuardsTitulo, normalizarSlots, validarSlotsAncorados, type DadosFonteTitulo } from '../titulo-guards';
import { SLOTS_VAZIOS, type TituloSlots } from '../titulo-slots';

const slots = (p: Partial<TituloSlots>): TituloSlots => ({ ...SLOTS_VAZIOS, ...p });
const fonte = (p: Partial<DadosFonteTitulo>): DadosFonteTitulo => ({
  nomePai: '', descricaoPai: '', tipoProdutoBusca: '', cores: [], fornecedor: null, ...p,
});

describe('normalizarSlots', () => {
  it('expande abreviação de planilha', () => {
    const s = normalizarSlots(slots({ produto: 'COLCHETE C/GANCHO', compatibilidade: 'P/ZIPER DE NYLON' }));
    expect(s.produto).toBe('COLCHETE COM GANCHO');
    expect(s.compatibilidade).toBe('PARA ZIPER DE NYLON');
  });

  it('descarta ruído de planilha sem valor de busca', () => {
    expect(normalizarSlots(slots({ modelo: 'TAM UND' })).modelo).toBe('');
    expect(normalizarSlots(slots({ modelo: 'TAM VR' })).modelo).toBe('');
    expect(normalizarSlots(slots({ variacao: 'CORES' })).variacao).toBe('');
  });

  it('remove código interno de estoque', () => {
    expect(normalizarSlots(slots({ modelo: 'T-007' })).modelo).toBe('');
    expect(normalizarSlots(slots({ modelo: 'BAR-03-VR' })).modelo).toBe('');
  });

  it('preserva numeração que o consumidor usa', () => {
    expect(normalizarSlots(slots({ modelo: 'N.3' })).modelo).toBe('N.3');
    expect(normalizarSlots(slots({ modelo: '4/6' })).modelo).toBe('4/6');
    expect(normalizarSlots(slots({ modelo: 'TEX 29' })).modelo).toBe('TEX 29');
  });

  it('colapsa espaço e apara', () => {
    expect(normalizarSlots(slots({ produto: '  NOVELO   LINHA  ' })).produto).toBe('NOVELO LINHA');
  });
});

describe('aplicarGuardsTitulo', () => {
  it('crava a metragem do nome quando a IA a omitiu', () => {
    const s = aplicarGuardsTitulo(slots({ produto: 'FITA CETIM' }), fonte({ nomePai: 'FITA CETIM N.3 100MT' }));
    expect(s.medida).toContain('100m');
  });

  it('corrige metragem arredondada pela IA', () => {
    const s = aplicarGuardsTitulo(slots({ produto: 'BORDADO', medida: '13,7m' }), fonte({ nomePai: 'BORDADO C/13,71MT' }));
    expect(s.medida).toContain('13,71m');
    expect(s.medida).not.toContain('13,7m ');
  });

  it('acrescenta a largura grounded à medida', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'LANTEJOULA', medida: '50m' }),
      fonte({ nomePai: 'LANTEJOULAS C/50MT', descricaoPai: 'LARGURA: 6MM.' }),
    );
    expect(s.medida).toContain('6mm');
  });

  it('crava a quantidade grounded', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'SACO DE ORGANZA' }),
      fonte({ nomePai: 'SACO DE ORGANZA 10X15CM CORES C/10UND' }),
    );
    expect(s.quantidade).toBe('10un');
  });

  it('crava a cor no slot variacao quando há exatamente uma', () => {
    const s = aplicarGuardsTitulo(slots({ produto: 'FITA' }), fonte({ cores: ['Branco'] }));
    expect(s.variacao).toBe('Branco');
  });

  it('não crava cor quando há várias (o comprador escolhe)', () => {
    const s = aplicarGuardsTitulo(slots({ produto: 'FITA' }), fonte({ cores: ['Branco', 'Preto'] }));
    expect(s.variacao).toBe('');
  });

  it('crava o tipo de produto quando o nome não diz o que o produto é', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'EUROROMA 4/6' }),
      fonte({ nomePai: 'EUROROMA 4/6 CORES 600G', descricaoPai: 'BARBANTE PARA CROCHE', tipoProdutoBusca: 'barbante' }),
    );
    expect(s.produto.toUpperCase()).toContain('BARBANTE');
  });

  it('usa o mapa para corrigir a grafia da marca', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'FITA CETIM', marca: 'BUFALO' }),
      fonte({ nomePai: 'FITA CETIM BUFALO N.3', fornecedor: 'BUFALO' }),
    );
    expect(s.marca).toBe('Búfalo');
  });
});

describe('validarSlotsAncorados', () => {
  it('remove marca que não aparece na fonte', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'FITA', marca: 'Detallia' }),
      fonte({ nomePai: 'FITAS DE VELUDO 20MM CORES', descricaoPai: 'FITA DE VELUDO.' }),
    );
    expect(s.marca).toBe('');
  });

  it('mantém marca ancorada, ignorando acento na comparação', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'FITA', marca: 'Búfalo' }),
      fonte({ nomePai: 'FITA CETIM BUFALO N.3', descricaoPai: '' }),
    );
    expect(s.marca).toBe('Búfalo');
  });

  it('NUNCA deixa nome da loja passar como marca', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'FITA', marca: 'Avil' }),
      fonte({ nomePai: 'FITA AVIL', descricaoPai: 'PRODUTO AVIL' }),
    );
    expect(s.marca).toBe('');
  });

  it('remove adjetivo vazio de qualquer slot', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'FITA', aplicacao: 'ALTA RESISTENCIA', sinonimo: 'QUALIDADE PREMIUM' }),
      fonte({ nomePai: 'FITA', descricaoPai: 'FITA DE CETIM.' }),
    );
    expect(s.aplicacao).toBe('');
    expect(s.sinonimo).toBe('');
  });

  it('remove sinônimo que não está na fonte', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'BARBANTE', sinonimo: 'CORDAO' }),
      fonte({ nomePai: 'BARBANTE EUROROMA', descricaoPai: 'BARBANTE PARA CROCHE.' }),
    );
    expect(s.sinonimo).toBe('');
  });

  it('mantém sinônimo presente na fonte', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'TECIDO HELANCA', sinonimo: 'HELANQUINHA' }),
      fonte({ nomePai: 'TECIDO HELANCA LIGHT', descricaoPai: 'CONHECIDO COMO HELANQUINHA.' }),
    );
    expect(s.sinonimo).toBe('HELANQUINHA');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/titulo-guards.test.ts`
Expected: FAIL — `Failed to resolve import "../titulo-guards"`

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/_shared/ai/titulo-guards.ts
import { extrairContagem, extrairLargura, extrairMetragem } from './titulo.ts';
import { LOJA_NUNCA_MARCA, marcaDoFornecedor } from './titulo-marcas.ts';
import { ORDEM_LEITURA, type SlotTitulo, type TituloSlots } from './titulo-slots.ts';

export interface DadosFonteTitulo {
  nomePai: string;
  descricaoPai: string;
  /** tipo_produto_busca já validado por validarTipoProdutoBusca (ADR-0054). */
  tipoProdutoBusca: string;
  /** Cores REAIS da família (sem 'Outra' nem placeholder de cor não identificada). */
  cores: string[];
  fornecedor: string | null;
}

function normalizar(s: string): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

// T4 — o comprador não busca por abreviação de estoque.
const ABREVIACOES: Array<[RegExp, string]> = [
  [/\bC\/(?=[A-ZÁ-Ú])/gi, 'COM '],
  [/\bS\/(?=[A-ZÁ-Ú])/gi, 'SEM '],
  [/\bP\/(?=[A-ZÁ-Ú])/gi, 'PARA '],
  [/\bNIQ\b/gi, 'NIQUELADO'],
  [/\bAG\b/gi, 'AGULHA'],
  [/\bHEXAG\b/gi, 'HEXAGONAL'],
  [/\bESP\./gi, 'ESPECIAL '],
  [/\bBCO\b/gi, 'BRANCO'],
  [/\bDESL\b/gi, 'DESLIZE'],
];

// T4/T5 — ruído de planilha e código interno, descartados inteiros (não traduzidos).
const RUIDO = [
  /^TAM\s*(UND|VR|VAR)?$/i,   // "TAM UND", "TAM VR", "TAM"
  /^C\s*VAR$/i,
  /^CORES?$/i,                 // "CORES" indicando só que há variação
  /^[A-Z]{1,4}-\d{2,3}(-[A-Z]{1,3})?$/i, // T-007, BAR-03-VR
  /^REF\.?\s*\d+$/i,           // REF.275
  /^GRD\s*\d+$/i,              // GRD 7
];

/** Passo 2 do pipeline: higieniza e canonicaliza o que a IA devolveu. */
export function normalizarSlots(slots: TituloSlots): TituloSlots {
  const out = { ...slots };
  for (const slot of ORDEM_LEITURA) {
    let v = (out[slot] ?? '').trim().replace(/\s{2,}/g, ' ');
    for (const [re, sub] of ABREVIACOES) v = v.replace(re, sub);
    v = v.replace(/\s{2,}/g, ' ').trim();
    if (RUIDO.some((re) => re.test(v))) v = '';
    out[slot] = v;
  }
  return out;
}

function jaContem(valor: string, agulha: string): boolean {
  return new RegExp(`\\b${agulha.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(valor);
}

/**
 * Passo 3: crava os dados que a fonte garante e a IA costuma descartar sob o teto de 60 chars.
 * Opera sobre SLOTS, nunca sobre a string final — é o que impede injeção e corte de disputarem
 * a mesma ponta do texto.
 */
export function aplicarGuardsTitulo(slots: TituloSlots, fonte: DadosFonteTitulo): TituloSlots {
  const out = { ...slots };
  const textoFonte = `${fonte.nomePai}\n${fonte.descricaoPai}`;

  // Tipo de produto (ADR-0054): nome só de marca+especificação não diz o que o produto É.
  const tipo = fonte.tipoProdutoBusca?.trim();
  if (tipo) {
    const palavras = normalizar(tipo).split(/\s+/).filter((w) => w.length >= 3);
    const presente = palavras.some((w) => jaContem(normalizar(out.produto), w));
    if (palavras.length > 0 && !presente) out.produto = `${tipo.toUpperCase()} ${out.produto}`.trim();
  }

  // Metragem: SEMPRE reescreve a partir da fonte. A IA arredonda ("13,7m" para "13,71m" real) e
  // às vezes duplica — checar "já contém a certa?" não pega a errada que ficou junto.
  const metragem = extrairMetragem(fonte.nomePai);
  const largura = extrairLargura(textoFonte);
  if (metragem || largura) {
    const partes = [metragem, largura].filter(Boolean) as string[];
    out.medida = partes.join(' ');
  }

  // Quantidade: costuma vir só na descrição ("pacote com 10 unidades").
  const contagem = extrairContagem(textoFonte);
  if (contagem) out.quantidade = contagem;

  // Cor única → discriminador da família (anti-duplicado do ML, ADR-0044). Multi-cor não entra:
  // o comprador escolhe na variação, e afirmar uma cor induziria a erro.
  if (fonte.cores.length === 1) out.variacao = fonte.cores[0];
  else if (fonte.cores.length > 1) out.variacao = '';

  // Marca: o mapa só corrige a GRAFIA. A permissão vem de validarSlotsAncorados.
  const doMapa = marcaDoFornecedor(fonte.fornecedor);
  if (doMapa) out.marca = doMapa;

  return out;
}

/**
 * T3 — adjetivo sem dado. Lista fechada dos reincidentes medidos em produção (35% dos títulos
 * terminavam num deles). Proibidos em termos ABSOLUTOS, mesmo vindo da fonte: o sistema não
 * rastreia origem por campo — a fonte é um blob de texto —, então não há como distinguir um
 * atributo técnico declarado pelo fabricante de uma invenção do modelo.
 */
const ADJETIVOS_VAZIOS = [
  'elegante', 'versatil', 'resistente', 'super resistente', 'alta resistencia',
  'alta durabilidade', 'qualidade premium', 'alta qualidade', 'qualidade superior',
  'toque macio', 'macio', 'conforto e controle', 'secagem limpa', 'adesao firme',
  'alta aderencia', 'uso profissional', 'alta performance', 'excelente qualidade',
  'paleta vibrante', 'rolo economico', 'fixacao firme', 'premium', 'melhor',
  'imperdivel', 'promocao', 'oferta', 'pronta entrega', 'envio rapido', 'compre agora',
];

/** Passo 4: tudo que sobrevive precisa de respaldo na fonte. */
export function validarSlotsAncorados(slots: TituloSlots, fonte: DadosFonteTitulo): TituloSlots {
  const out = { ...slots };
  const alvoFonte = normalizar(`${fonte.nomePai} ${fonte.descricaoPai}`);

  // T3: adjetivo vazio sai de QUALQUER slot.
  for (const slot of ORDEM_LEITURA) {
    const v = normalizar(out[slot]).toLowerCase();
    if (v && ADJETIVOS_VAZIOS.includes(v)) out[slot] = '';
  }

  // Marca: o mapa deu a grafia, a fonte dá a permissão. Sem menção na fonte, a marca sai —
  // afirmá-la a partir do campo de fornecedor é o que o padrão do ML proíbe.
  if (out.marca) {
    const ehLoja = LOJA_NUNCA_MARCA.includes(normalizar(out.marca));
    const ancorada = alvoFonte.includes(normalizar(out.marca));
    if (ehLoja || !ancorada) out.marca = '';
  }

  // T7: sinônimo só quando presente na fonte. O modelo não pode inventar — "barbante" → "cordão"
  // e "linha" → "fio" trocam a identidade técnica do produto.
  if (out.sinonimo && !alvoFonte.includes(normalizar(out.sinonimo))) out.sinonimo = '';

  return out;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/titulo-guards.test.ts`
Expected: PASS (19 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/titulo-guards.ts supabase/functions/_shared/ai/__tests__/titulo-guards.test.ts
git commit -m "feat(titulo): guards sobre slots — normalizar, cravar dados da fonte, validar ancoragem"
```

---

## Task 7: `posProcessarTitulo` — pipeline fechado

**Files:**
- Create: `supabase/functions/_shared/ai/titulo-pos.ts`
- Test: `supabase/functions/_shared/ai/__tests__/titulo-pos.test.ts`

**Interfaces:**
- Consumes: `normalizarSlots`, `aplicarGuardsTitulo`, `validarSlotsAncorados`, `DadosFonteTitulo` (Task 6); `montarTitulo`, `ContextoCorte`, `TituloInviavelError` (Task 5); `TituloSlots` (Task 1).
- Produces: `posProcessarTitulo(slotsIa: TituloSlots, fonte: DadosFonteTitulo): string`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// supabase/functions/_shared/ai/__tests__/titulo-pos.test.ts
import { describe, it, expect } from 'vitest';
import { posProcessarTitulo } from '../titulo-pos';
import { type DadosFonteTitulo } from '../titulo-guards';
import { SLOTS_VAZIOS, type TituloSlots } from '../titulo-slots';

const slots = (p: Partial<TituloSlots>): TituloSlots => ({ ...SLOTS_VAZIOS, ...p });
const fonte = (p: Partial<DadosFonteTitulo>): DadosFonteTitulo => ({
  nomePai: '', descricaoPai: '', tipoProdutoBusca: '', cores: [], fornecedor: null, ...p,
});

describe('posProcessarTitulo', () => {
  it('produz título no padrão ML, sem pipe e com unidade canônica', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'FITA CETIM', marca: 'BUFALO', modelo: 'N.3', material: '100% POLIESTER' }),
      fonte({ nomePai: 'FITA CETIM BUFALO N.3 16MM CORES 10MT', descricaoPai: 'LARGURA: 16MM. 100% POLIESTER.', fornecedor: 'BUFALO' }),
    );
    expect(t).not.toContain('|');
    expect(t).toContain('10m');
    expect(t).toContain('Búfalo');
    expect(t.length).toBeLessThanOrEqual(60);
  });

  it('é IDEMPOTENTE — mesma entrada, mesmo título, qualquer número de execuções', () => {
    const s = slots({ produto: 'LANTEJOULA', marca: 'BUFALO', material: 'PVC' });
    const f = fonte({ nomePai: 'LANTEJOULAS TAM 8 CORES C/50MT', descricaoPai: 'LANTEJOULA BÚFALO. LARGURA: 8MM.', fornecedor: 'BUFALO', cores: ['Prata'] });
    const um = posProcessarTitulo(s, f);
    const dois = posProcessarTitulo(s, f);
    const tres = posProcessarTitulo(s, f);
    expect(dois).toBe(um);
    expect(tres).toBe(um);
  });

  it('remove o adjetivo vazio que a IA insistiu em mandar', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'FITA VELUDO', material: '100% POLIESTER', aplicacao: 'ALTA RESISTENCIA' }),
      fonte({ nomePai: 'FITAS VELUDO 16MM CORES C/25MTS', descricaoPai: '100% POLIESTER.' }),
    );
    expect(t.toLowerCase()).not.toContain('resist');
  });

  it('nunca deixa nome da loja virar marca', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'FITA', marca: 'AVIL' }),
      fonte({ nomePai: 'FITA AVIL 10MT', descricaoPai: 'PRODUTO AVIL.', fornecedor: 'AVIL' }),
    );
    expect(t).not.toContain('Avil');
  });

  it('preserva a cor como discriminador quando a família é mono-cor', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'LINHA ESPECIAL PARA RENASCENCA', marca: 'CIRCULO', material: '100% ALGODAO' }),
      fonte({ nomePai: 'LINHA ESP. P/RENASCENCA COR BEGE C/10UND', descricaoPai: 'LINHA CÍRCULO 100% ALGODÃO.', fornecedor: 'CIRCULO S.A.', cores: ['Bege'] }),
    );
    expect(t).toContain('Bege');
    expect(t.length).toBeLessThanOrEqual(60);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/titulo-pos.test.ts`
Expected: FAIL — `Failed to resolve import "../titulo-pos"`

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/_shared/ai/titulo-pos.ts
import { aplicarGuardsTitulo, normalizarSlots, validarSlotsAncorados, type DadosFonteTitulo } from './titulo-guards.ts';
import { montarTitulo } from './titulo-montar.ts';
import { type TituloSlots } from './titulo-slots.ts';

export type { DadosFonteTitulo };

/**
 * Todo o pós-processamento do título, num lugar só (ADR-0099).
 *
 * Antes disto, os três call sites (process-familia, regenerar-copy-familia, titulo-particao)
 * compunham os guards à mão e por isso divergiam: regenerar perdia garantirQuantidadeTitulo e
 * a partição perdia largura E quantidade — em silêncio. Mesmo defeito que posProcessarDescricao
 * já corrigiu do lado da descrição.
 *
 * A ORDEM É PARTE DA CORREÇÃO:
 *   1. normalizarSlots        — higieniza e canonicaliza
 *   2. aplicarGuardsTitulo    — crava o que a fonte garante
 *   3. validarSlotsAncorados  — derruba o que não tem respaldo
 *   4. montarTitulo           — ÚNICA montagem, ao final
 *
 * A montagem acontecer uma vez só, depois de todos os guards, é o ponto central do desenho.
 * Um guard que injetasse depois da montagem devolveria o sistema ao bug original: injeção e
 * corte disputando a mesma ponta do texto, com perda silenciosa do dado recém-injetado.
 *
 * Pode lançar TituloInviavelError — ver titulo-montar.ts. O call site DEVE traduzi-lo em
 * mensagem acionável ao operador.
 */
export function posProcessarTitulo(slotsIa: TituloSlots, fonte: DadosFonteTitulo): string {
  const slots = normalizarSlots(slotsIa);
  const garantidos = aplicarGuardsTitulo(slots, fonte);
  const validados = validarSlotsAncorados(garantidos, fonte);
  // `variacao` discrimina quando a família é mono-cor: a planilha separou as cores em PAI
  // distintos, então a cor é o que diferencia esta família das irmãs (ADR-0044).
  return montarTitulo(validados, { variacaoDiscrimina: fonte.cores.length === 1 });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/titulo-pos.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/titulo-pos.ts supabase/functions/_shared/ai/__tests__/titulo-pos.test.ts
git commit -m "feat(titulo): posProcessarTitulo com pipeline fechado e montagem única"
```

---

## Task 8: Schema do copywriter devolve slots

**Files:**
- Modify: `supabase/functions/_shared/ai/copywriter.ts:8-35` (`OutputCopy`, `SCHEMA`), `:60-74` (parse)
- Test: `supabase/functions/_shared/ai/__tests__/copywriter-schema.test.ts` (novo)

**Interfaces:**
- Consumes: `TituloSlots`, `SLOTS_VAZIOS` (Task 1).
- Produces: `OutputCopy.titulo_slots: TituloSlots` substituindo `OutputCopy.titulo: string`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// supabase/functions/_shared/ai/__tests__/copywriter-schema.test.ts
import { describe, it, expect } from 'vitest';
import { SCHEMA_COPY } from '../copywriter';
import { SLOTS_VAZIOS } from '../titulo-slots';

describe('json_schema do copywriter', () => {
  const props = SCHEMA_COPY.schema.properties as Record<string, unknown>;
  const slotsSchema = props.titulo_slots as {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };

  it('não aceita mais `titulo` como string no contrato novo', () => {
    expect(props.titulo).toBeUndefined();
  });

  it('exige titulo_slots', () => {
    expect(SCHEMA_COPY.schema.required).toContain('titulo_slots');
  });

  it('declara as dez chaves e todas obrigatórias', () => {
    const chaves = Object.keys(SLOTS_VAZIOS);
    expect(Object.keys(slotsSchema.properties).sort()).toEqual(chaves.sort());
    expect(slotsSchema.required.sort()).toEqual(chaves.sort());
  });

  it('proíbe chave desconhecida — o modelo não pode improvisar um slot `diferencial`', () => {
    expect(slotsSchema.additionalProperties).toBe(false);
    expect(SCHEMA_COPY.schema.additionalProperties).toBe(false);
    expect(slotsSchema.properties.diferencial).toBeUndefined();
  });

  it('todo slot é string', () => {
    for (const v of Object.values(slotsSchema.properties)) {
      expect(v).toEqual({ type: 'string' });
    }
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/copywriter-schema.test.ts`
Expected: FAIL — `SCHEMA_COPY` não é exportado

- [ ] **Step 3: Implementar**

Em `copywriter.ts`, substituir `OutputCopy` e `SCHEMA` (agora exportado como `SCHEMA_COPY`) e o parse:

```ts
import { ORDEM_LEITURA, SLOTS_VAZIOS, type TituloSlots } from './titulo-slots.ts';

export interface OutputCopy {
  /** Slots do título (ADR-0099). A string final sai de posProcessarTitulo, não daqui. */
  titulo_slots: TituloSlots;
  descricao: string;
  tipo_produto_busca: string;
  tokens_input: number;
  tokens_output: number;
  custo_centavos: number;
}

// Dez chaves, todas obrigatórias, todas string. Gerado da ORDEM_LEITURA para que schema e tipo
// nunca divirjam — acrescentar um slot lá o traz para cá automaticamente.
const PROPRIEDADES_SLOTS = Object.fromEntries(
  ORDEM_LEITURA.map((slot) => [slot, { type: 'string' }]),
);

export const SCHEMA_COPY = {
  name: 'copy_anuncio',
  schema: {
    type: 'object',
    properties: {
      // O título deixou de ser string no contrato: a IA devolve slots nomeados e a montagem é
      // determinística (titulo-montar.ts). Decompor um título plano de volta em slots por regex
      // seria adivinhação, e era assim que "| DIFERENCIAL" nascia sem ninguém conseguir auditar.
      titulo_slots: {
        type: 'object',
        properties: PROPRIEDADES_SLOTS,
        required: [...ORDEM_LEITURA],
        // Sem isto o modelo improvisa um slot `diferencial`/`beneficio` e a Causa C do ADR-0098
        // volta pela porta do schema.
        additionalProperties: false,
      },
      descricao: { type: 'string' },
      tipo_produto_busca: { type: 'string' },
    },
    required: ['titulo_slots', 'descricao', 'tipo_produto_busca'],
    additionalProperties: false,
  },
  strict: true,
} as const;
```

No `chamarCopy`, trocar o parse e o retorno:

```ts
  let parsed: { titulo_slots: Partial<TituloSlots>; descricao: string; tipo_produto_busca: string };
  try {
    parsed = JSON.parse(conteudo);
  } catch (e) {
    throw new Error(`JSON inválido: ${(e as Error).message}`);
  }
  const usage = resp.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  return {
    // Merge com SLOTS_VAZIOS: mesmo com `required` no schema, um modelo pode devolver a chave
    // ausente. O default garante o contrato de dez chaves para todo consumidor a jusante.
    titulo_slots: { ...SLOTS_VAZIOS, ...parsed.titulo_slots },
    descricao: parsed.descricao,
    tipo_produto_busca: validarTipoProdutoBusca(parsed.tipo_produto_busca, input.nome, input.descricao_detalhado),
    ...
  };
```

E na chamada, trocar `json_schema: SCHEMA` por `json_schema: SCHEMA_COPY`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/copywriter-schema.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/copywriter.ts supabase/functions/_shared/ai/__tests__/copywriter-schema.test.ts
git commit -m "feat(copywriter): schema devolve titulo_slots com dez chaves e additionalProperties false"
```

---

## Task 9: T1–T7 e few-shots no SYSTEM

**Files:**
- Modify: `supabase/functions/_shared/ai/copywriter-prompt.ts:260-271` (bloco `TÍTULO` do `SYSTEM`)
- Test: `supabase/functions/_shared/ai/__tests__/copywriter-prompt.test.ts` (existente)

**Interfaces:**
- Consumes: nada de código; o bloco de texto precisa nomear os dez slots exatamente como em `ORDEM_LEITURA` (Task 1).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// acrescentar em supabase/functions/_shared/ai/__tests__/copywriter-prompt.test.ts
import { SYSTEM } from '../copywriter-prompt';
import { ORDEM_LEITURA } from '../titulo-slots';

describe('bloco TÍTULO do SYSTEM (ADR-0099)', () => {
  it('não ensina mais o formato com pipe nem o slot DIFERENCIAL', () => {
    expect(SYSTEM).not.toContain('DIFERENCIAL');
    expect(SYSTEM).not.toContain('MARCA MODELO MEDIDA |');
    expect(SYSTEM).not.toContain('| RESISTENTE');
  });

  it('nomeia os dez slots exatamente como o contrato', () => {
    for (const slot of ORDEM_LEITURA) expect(SYSTEM).toContain(slot);
  });

  it('carrega a frase decisiva de T6', () => {
    expect(SYSTEM).toContain('Espaço restante não é motivo para adicionar palavras');
  });

  it('traz pelo menos dois exemplos CORRETO de título', () => {
    expect(SYSTEM.match(/CORRETO:/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('nenhum exemplo CORRETO termina em adjetivo — é o mecanismo que criou o problema', () => {
    const proibidos = ['resistente', 'premium', 'versatil', 'elegante', 'macio', 'profissional'];
    for (const linha of SYSTEM.split('\n').filter((l) => l.includes('CORRETO:'))) {
      const texto = linha.split('CORRETO:')[1].trim().replace(/\s*\(\d+ chars\)\s*$/, '');
      const ultima = texto.split(/\s+/).pop()?.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') ?? '';
      expect(proibidos).not.toContain(ultima);
    }
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/copywriter-prompt.test.ts`
Expected: FAIL — `SYSTEM` ainda contém `DIFERENCIAL`

- [ ] **Step 3: Implementar**

Substituir INTEIRO o bloco entre `TÍTULO` e `DESCRIÇÃO — TEMPLATE OBRIGATÓRIO` por:

```
═══════════════════════════════════════════════════════
TÍTULO — DEVOLVA SLOTS, NÃO UMA FRASE
═══════════════════════════════════════════════════════
Você NÃO escreve o título. Você preenche dez campos e o sistema monta o título a partir deles.
Todos os dez são obrigatórios no JSON; devolva "" (string vazia) para o que não se aplica ou
não está na fonte. Slot vazio é normal e esperado.

produto        — o que o item É, no termo que o comprador digita na busca. NUNCA "".
marca          — só se a marca aparecer no nome ou na descrição. Nome de loja não é marca.
modelo         — numeração/linha que o CONSUMIDOR usa para escolher: N.3, Nº 6, Tex 29, 4/6.
medida         — comprimento, largura, peso, volume: 570m, 6mm, 500g, 2l.
quantidade     — contagem da embalagem: 10un, 12pc.
material       — composição: 100% Poliéster, 85% Algodão, PVC, Alumínio.
variacao       — cor ou tamanho, quando o anúncio é de UMA opção só.
compatibilidade— com o que funciona, se a fonte disser: Para DeskJet 2774.
aplicacao      — uso principal, só se a fonte confirmar: Para Forro.
sinonimo       — outro termo de busca REAL, apenas se estiver na fonte: Helanquinha.

T1 ORDEM. O sistema monta nesta ordem: produto, marca, modelo, medida, quantidade, material,
variacao, compatibilidade, aplicacao, sinonimo. Você não precisa se preocupar com a ordem nem
com o limite de 60 caracteres — só com o conteúdo de cada campo.

T2 SEM SEPARADOR. Não use "|", "★", "!!!", colchete, emoji ou qualquer caractere decorativo
dentro dos campos.

T3 PROIBIDO ADJETIVO SEM DADO. Nunca escreva, em campo nenhum: elegante, versátil, resistente,
super resistente, alta resistência, alta durabilidade, qualidade premium, alta qualidade,
qualidade superior, toque macio, macio, conforto e controle, secagem limpa, adesão firme, alta
aderência, uso profissional, alta performance, excelente qualidade, paleta vibrante, premium,
melhor, imperdível, promoção, oferta, pronta entrega, envio rápido, compre agora. Também
proibidos: telefone, contato e nome da loja.

T4 EXPANDA O DIALETO DE PLANILHA. O comprador não busca por abreviação de estoque:
C/ → com · S/ → sem · P/ → para · NIQ → niquelado · AG → agulha · HEXAG → hexagonal ·
ESP. → especial · BCO → branco. Ruído sem valor de busca vira "": TAM UND, TAM VR, C VAR, e
"CORES" quando significa apenas que há variação.

T5 PROIBIDO CÓDIGO INTERNO. Referência de estoque não é buscada por ninguém: T-007, BAR-03-VR,
REF.275, GRD 7, e código de cor solto (o "610" em "COR 610 BEGE"). Numeração que o consumidor
usa para escolher (N.3, Tex 29, 4/6) é modelo legítimo e DEVE ficar.

T6 COMPLETUDE ACIMA DE OCUPAÇÃO. O título não deve tentar preencher os 60 caracteres. Depois de
incluir todos os dados relevantes e comprovados, pare. Um título curto, preciso e completo é
superior a um título longo preenchido com adjetivos, aplicações genéricas, sinônimos fracos ou
expressões promocionais. Espaço restante não é motivo para adicionar palavras.

T7 SINÔNIMO SÓ DA FONTE. Preencha "sinonimo" apenas com termo que APARECE no nome ou na
descrição. Nunca invente sinônimo: barbante→cordão, linha→fio e tecido→malha trocam a
identidade técnica do produto. Nunca empilhe palavra-chave.

EXEMPLOS

Fonte: Barbante · marca Bandeirante · modelo 4/6 · 570 m · 85% algodão
  produto="Barbante" marca="Bandeirante" modelo="4/6" medida="570m" material="85% Algodão"
  CORRETO: Barbante Bandeirante 4/6 570m 85% Algodão
  ERRADO:  Barbante Bandeirante 4/6 570m 85% Algodão Resistente Premium

Fonte: Agulha de crochê · marca Círculo · 3,5 mm · alumínio
  produto="Agulha de Crochê" marca="Círculo" medida="3,5mm" material="Alumínio"
  CORRETO: Agulha de Crochê Círculo 3,5mm Alumínio
  ERRADO:  Agulha de Crochê Círculo 3,5mm Alumínio Confortável Versátil Profissional

O segundo exemplo termina com bastante espaço livre. Isso é um resultado completo, não uma
falha.
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/copywriter-prompt.ts supabase/functions/_shared/ai/__tests__/copywriter-prompt.test.ts
git commit -m "feat(prompt): T1-T7 do título com slots e few-shots curtos, sem slot DIFERENCIAL"
```

---

## Task 10: Migrar os três call sites

**Files:**
- Modify: `supabase/functions/process-familia/index.ts:450-464`
- Modify: `supabase/functions/regenerar-copy-familia/index.ts:56-77`
- Modify: `supabase/functions/_shared/split/titulo-particao.ts:7,34-68`
- Test: `supabase/functions/_shared/split/__tests__/titulo-particao.test.ts` (existente)

**Interfaces:**
- Consumes: `posProcessarTitulo`, `DadosFonteTitulo` (Task 7); `TituloInviavelError` (Task 5); `OutputCopy.titulo_slots` (Task 8).

**Contexto:** `tituloParticaoDeterministico` recebe `tituloBase` — uma string já pronta vinda de `familias.titulo_ml` —, não slots. Não dá para decompor. Ele continua operando em string, mas sem pipe e sem truncar token.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// acrescentar em supabase/functions/_shared/split/__tests__/titulo-particao.test.ts
import { tituloParticaoDeterministico } from '../titulo-particao';

describe('tituloParticaoDeterministico sem pipe (ADR-0099)', () => {
  it('acrescenta a cor representativa ao título-base', () => {
    const t = tituloParticaoDeterministico('Fita de Cetim Búfalo N.3 10m', [{ cor: 'Vermelho' }], 1);
    expect(t).toBe('Fita de Cetim Búfalo N.3 10m Vermelho');
    expect(t).not.toContain('|');
  });

  it('escolhe a primeira cor em ordem alfabética', () => {
    const t = tituloParticaoDeterministico('Fita 10m', [{ cor: 'Verde' }, { cor: 'Azul' }], 1);
    expect(t).toContain('Azul');
    expect(t).not.toContain('Verde');
  });

  it('derruba palavras inteiras do base para caber, nunca corta token', () => {
    const base = 'Bordado Inglês Búfalo Referência Cores Passa Fita Especial 13,71m';
    const t = tituloParticaoDeterministico(base, [{ cor: 'Branco' }], 1);
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t).toContain('Branco');
    for (const token of t.split(' ')) expect(`${base} Branco`.split(' ')).toContain(token);
  });

  it('sem cor nomeada usa ordinal da partição', () => {
    const t = tituloParticaoDeterministico('Fita 10m', [{ cor: null }], 2);
    expect(t).toContain('Opcao 3');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test supabase/functions/_shared/split/__tests__/titulo-particao.test.ts`
Expected: FAIL — sai com `|` ou com token cortado

- [ ] **Step 3: Implementar**

Em `titulo-particao.ts`, trocar o import da linha 7 e reescrever as duas funções:

```ts
import { posProcessarTitulo } from '../ai/titulo-pos.ts';

const TITULO_MAX = 60;

/**
 * Fallback determinístico e puro. Opera sobre o título-base JÁ MONTADO (familias.titulo_ml da
 * partição 0), não sobre slots — não há como decompor uma string pronta em slots sem adivinhar.
 * Por isso continua em string, mas respeitando as invariantes do ADR-0099: sem pipe, e derrubando
 * PALAVRA INTEIRA do base, nunca cortando token no meio. O discriminador nunca é derrubado.
 */
export function tituloParticaoDeterministico(
  tituloBase: string,
  cores: Array<{ cor: string | null }>,
  particao: number,
): string {
  const corRep = cores
    .map((c) => c.cor?.trim())
    .filter((c): c is string => !!c)
    .sort((a, b) => a.localeCompare(b, 'pt'))[0];
  // ponytail: ordinal só entra quando a partição não tem nenhuma cor nomeada (improvável
  // num produto com >100 cores); ainda assim garante título não-vazio e distinto.
  const discriminador = corRep ?? `Opcao ${particao + 1}`;

  const palavras = tituloBase.trim().split(/\s+/).filter(Boolean);
  while (palavras.length > 1 && `${palavras.join(' ')} ${discriminador}`.length > TITULO_MAX) {
    palavras.pop();
  }
  return `${palavras.join(' ')} ${discriminador}`.trim();
}
```

E em `gerarTituloParticao`, trocar a cadeia manual (linhas 58-61) por:

```ts
    const titulo = posProcessarTitulo(out.titulo_slots, {
      nomePai: opts.nome,
      descricaoPai: opts.descricao_detalhado ?? '',
      tipoProdutoBusca: out.tipo_produto_busca,
      cores: [...new Set(opts.cores.map((c) => c.cor).filter((c): c is string => !!c))],
      fornecedor: null, // a partição não carrega fornecedor; a marca vem ancorada da fonte
    });
```

Em `process-familia/index.ts`, substituir o bloco `titulo_ml:` (linhas 450-464) por:

```ts
      titulo_ml: posProcessarTitulo(copy.titulo_slots, {
        nomePai: claimed.nome_pai,
        descricaoPai: claimed.descricao_pai ?? '',
        tipoProdutoBusca: copy.tipo_produto_busca,
        cores: coresUnicas,
        fornecedor: claimed.fornecedor ?? null,
      }),
```

E envolver a chamada num tratamento que traduz o erro (ADR-0030: sem isso a família morre com stack opaco). Logo antes do `.update(`:

```ts
    // TituloInviavelError significa que produto+medida+cor obrigatórios não cabem em 60 chars.
    // A família falha de propósito (nunca truncar nem fundir produtos), mas o operador precisa
    // saber O QUE encurtar na planilha — daí nomear os slots em vez de deixar subir cru.
    let tituloFinal: string;
    try {
      tituloFinal = posProcessarTitulo(copy.titulo_slots, {
        nomePai: claimed.nome_pai,
        descricaoPai: claimed.descricao_pai ?? '',
        tipoProdutoBusca: copy.tipo_produto_busca,
        cores: coresUnicas,
        fornecedor: claimed.fornecedor ?? null,
      });
    } catch (e) {
      if (e instanceof TituloInviavelError) {
        const campos = Object.entries(e.slotsObrigatorios).map(([k, v]) => `${k}="${v}"`).join(', ');
        throw new Error(`Título obrigatório não cabe em 60 caracteres (${e.comprimento}). Encurte o nome do produto na planilha. Campos: ${campos}`);
      }
      throw e;
    }
```

e usar `titulo_ml: tituloFinal`. Importar `TituloInviavelError` de `../_shared/ai/titulo-montar.ts` e `posProcessarTitulo` de `../_shared/ai/titulo-pos.ts`. **Confirmar que `claimed` traz `fornecedor`** — se o `select` da família não o incluir, acrescentar `fornecedor` à lista de colunas.

Aplicar o mesmo tratamento em `regenerar-copy-familia/index.ts` (linhas 63-77), devolvendo `new Response(mensagem, { status: 422, headers: corsHeaders })` em vez de `throw`, já que ali há uma resposta HTTP ao operador.

- [ ] **Step 4: Rodar tudo**

Run: `pnpm test && pnpm lint:functions && pnpm check:functions`
Expected: PASS. `check:functions` é o que pega import quebrado nas edge functions — vitest não cobre esses arquivos.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/
git commit -m "refactor(titulo): três call sites passam a usar posProcessarTitulo"
```

---

## Task 11: Remover os guards de string mortos

**Files:**
- Modify: `supabase/functions/_shared/ai/titulo.ts` — remover `clampTitulo`, `removerCaudaConectiva`, `normalizarSegmentos`, `garantirQuantidadeTitulo`, `garantirMetragemTitulo`, `garantirLarguraTitulo`, `garantirCorTitulo`, `garantirTipoProdutoTitulo`, `garantirTipoFioTitulo`, `removerMarketingNaoGrounded`
- Delete: `__tests__/titulo-clamp-metragem.test.ts`, `titulo-cor.test.ts`, `titulo-largura.test.ts`, `titulo-marketing.test.ts`, `titulo-tipo-fio.test.ts`, `titulo-tipo-produto.test.ts`

**Interfaces:**
- `titulo.ts` fica só com os extratores: `extrairMetragem`, `extrairLargura`, `contemMetragem`, `extrairContagem` — consumidos por `titulo-guards.ts` (Task 6) e por `copywriter-prompt.ts` (lado da descrição).

**Contexto:** `garantirTipoFioTitulo` implementava o ADR-0070 (corrigir `FIO` para `LINHA` quando `nome_pai` diz `L.CLEA`). Essa regra não pode sumir — ela migra para `aplicarGuardsTitulo`, sobre o slot `produto`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// acrescentar em supabase/functions/_shared/ai/__tests__/titulo-guards.test.ts
describe('tipo de fio declarado no nome (ADR-0070)', () => {
  it('corrige FIO para LINHA quando a planilha diz L.CLEA', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'FIO CLEA 1000' }),
      fonte({ nomePai: 'L.CLEA 1000 CORES', descricaoPai: 'LINHA CLÉA.' }),
    );
    expect(s.produto.toUpperCase()).toContain('LINHA');
    expect(s.produto.toUpperCase()).not.toMatch(/^FIO\b/);
  });

  it('corrige quando nome_pai declara BARBANTE por extenso', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'LINHA ALGODAO' }),
      fonte({ nomePai: 'BARBANTE ALGODAO 600G', descricaoPai: '' }),
    );
    expect(s.produto.toUpperCase()).toContain('BARBANTE');
  });

  it('sem sinal em nome_pai não mexe — nunca inventa a partir da descrição', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'FIO ECOAMIGURUMI' }),
      fonte({ nomePai: 'EUROROMA 160G', descricaoPai: 'LINHA RECICLADA.' }),
    );
    expect(s.produto.toUpperCase()).toMatch(/^FIO\b/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test supabase/functions/_shared/ai/__tests__/titulo-guards.test.ts`
Expected: FAIL — `aplicarGuardsTitulo` ainda não corrige o tipo de fio

- [ ] **Step 3: Implementar**

Acrescentar em `titulo-guards.ts`, e chamar dentro de `aplicarGuardsTitulo` logo após o bloco do tipo de produto:

```ts
// Sinônimos concorrentes para "tipo de fio" que a descrição usa para o MESMO produto. Não usa
// tipo_aviamento (categoria ML) como sinal: o bucket "Fios e Cadarços" mistura barbante/fio/linha
// legítimos (ADR-0054).
const SINONIMOS_TIPO_FIO = ['LINHA', 'FIO', 'BARBANTE'];

// A planilha às vezes já declara qual sinônimo é o certo: por extenso ("FIO NAUTICO") ou pela
// abreviação "L." (convenção do catálogo: L.CLEA = "Linha Cléa").
function tipoFioDeclaradoNoNome(nomePai: string): string | null {
  if (/^L\./i.test(nomePai.trim())) return 'LINHA';
  const m = nomePai.match(/\b(LINHA|FIO|BARBANTE)\b/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * ADR-0070: corrige a 1ª palavra de `produto` quando ela é um sinônimo de tipo de fio DIFERENTE
 * do que nome_pai declara (bug lote #63: "FIO CLÉA 1000" quando a planilha diz "L.CLEA").
 * Sem sinal em nome_pai não mexe — conservador por construção, nunca inventa a partir de
 * sinônimo só grounded na descrição.
 */
function corrigirTipoFio(produto: string, nomePai: string): string {
  const declarado = tipoFioDeclaradoNoNome(nomePai);
  if (!declarado) return produto;
  const palavras = produto.split(/\s+/);
  const primeira = normalizar(palavras[0] ?? '');
  if (primeira === declarado || !SINONIMOS_TIPO_FIO.includes(primeira)) return produto;
  palavras[0] = declarado;
  return palavras.join(' ');
}
```

Dentro de `aplicarGuardsTitulo`, após o bloco do tipo de produto:

```ts
  out.produto = corrigirTipoFio(out.produto, fonte.nomePai);
```

Depois disso, remover de `titulo.ts` as dez funções listadas em **Files** e apagar os seis arquivos de teste. Confirmar que nada mais as importa:

```bash
grep -rn "clampTitulo\|garantirCorTitulo\|garantirMetragemTitulo\|garantirLarguraTitulo\|garantirQuantidadeTitulo\|garantirTipoProdutoTitulo\|garantirTipoFioTitulo\|removerMarketingNaoGrounded\|removerCaudaConectiva" --include=*.ts supabase/ src/
```
Expected: nenhum resultado fora de `titulo.ts` antes da remoção; nenhum resultado depois.

- [ ] **Step 4: Rodar tudo**

Run: `pnpm test && pnpm lint:functions && pnpm check:functions`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/
git commit -m "refactor(titulo): remove guards de string mortos, ADR-0070 migrado para slots"
```

---

## Task 12: Experimento A/B

**Files:**
- Create: `scripts/experimento-titulo/metricas.ts`, `scripts/experimento-titulo/index.ts`
- Test: `tests/experimento-titulo-metricas.test.ts`

**Interfaces:**
- Consumes: `posProcessarTitulo`, `DadosFonteTitulo` (Task 7); `SLOTS_VAZIOS` (Task 1).
- Produces: `terminaEmAdjetivoVazio`, `unidadeCanonica`, `marcaAncorada`, `colisoes` — funções puras, testáveis sem rede.

**Contexto:** o baseline é grátis — `familias.titulo_ml` já gravado, filtrado por `not titulo_editado_pelo_operador` (24 dos 167 títulos foram editados à mão e contaminariam a medida). O harness lê pela management API do Supabase, igual ao `scripts/experimento-copy/index.ts`, que serve de modelo.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/experimento-titulo-metricas.test.ts
import { describe, it, expect } from 'vitest';
import { colisoes, marcaAncorada, terminaEmAdjetivoVazio, unidadeCanonica } from '../scripts/experimento-titulo/metricas';

describe('terminaEmAdjetivoVazio', () => {
  it('detecta os reincidentes medidos em produção', () => {
    expect(terminaEmAdjetivoVazio('FITA CETIM 10MT | 100% POLIÉSTER | ELEGANTE')).toBe(true);
    expect(terminaEmAdjetivoVazio('RENDA BÚFALO 20MM 50M | ALTA DURABILIDADE')).toBe(true);
    expect(terminaEmAdjetivoVazio('LANTEJOULA 50MT 6MM | PVC DE ALTA QUALIDADE')).toBe(true);
  });

  it('NÃO acusa composição, que é dado ancorado', () => {
    expect(terminaEmAdjetivoVazio('FITA CETIM BUFALO N.1 100MT | 100% POLIÉSTER')).toBe(false);
  });

  it('NÃO acusa cor, que é discriminador legítimo', () => {
    expect(terminaEmAdjetivoVazio('CURSOR N.5 1000UND | BRANCO')).toBe(false);
  });

  it('funciona sem pipe (formato novo)', () => {
    expect(terminaEmAdjetivoVazio('Fita de Cetim Búfalo N.3 10m Resistente')).toBe(true);
    expect(terminaEmAdjetivoVazio('Fita de Cetim Búfalo N.3 10m 100% Poliéster')).toBe(false);
  });
});

describe('unidadeCanonica', () => {
  it('reprova MT, MTS, UND e GR', () => {
    expect(unidadeCanonica('FITA 100MT')).toBe(false);
    expect(unidadeCanonica('LANTEJOULA C/50MTS')).toBe(false);
    expect(unidadeCanonica('SACO 10UND')).toBe(false);
    expect(unidadeCanonica('NOVELO 500GR')).toBe(false);
  });

  it('aprova m, un, g minúsculos', () => {
    expect(unidadeCanonica('Fita de Cetim 100m')).toBe(true);
    expect(unidadeCanonica('Saco de Organza 10un')).toBe(true);
    expect(unidadeCanonica('Novelo 500g')).toBe(true);
  });
});

describe('marcaAncorada', () => {
  it('confirma marca presente na fonte', () => {
    expect(marcaAncorada('Fita de Cetim Búfalo N.3', 'FITA CETIM BUFALO N.3 CORES')).toBe(true);
  });

  it('acusa marca ausente da fonte', () => {
    expect(marcaAncorada('Fita Detallia 25m', 'FITAS DE VELUDO 20MM CORES C/25MTS')).toBe(false);
  });
});

describe('colisoes', () => {
  it('conta títulos idênticos entre produtos distintos', () => {
    expect(colisoes([
      { codigoPai: '1', titulo: 'Fita 10m' },
      { codigoPai: '2', titulo: 'Fita 10m' },
      { codigoPai: '3', titulo: 'Fita 100m' },
    ])).toBe(1);
  });

  it('não conta o mesmo produto reingerido', () => {
    expect(colisoes([
      { codigoPai: '1', titulo: 'Fita 10m' },
      { codigoPai: '1', titulo: 'Fita 10m' },
    ])).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test tests/experimento-titulo-metricas.test.ts`
Expected: FAIL — `Failed to resolve import`

- [ ] **Step 3: Implementar**

```ts
// scripts/experimento-titulo/metricas.ts

const norm = (s: string) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/**
 * Lista fechada dos adjetivos vazios efetivamente observados nos 143 títulos de produção.
 *
 * Medida deliberadamente ESTRITA. A medida frouxa ("cauda sem nenhum dígito") dá 51%, mas conta
 * "| BRANCO" como defeito — cor é dado legítimo. Comparar contra esta lista dá 35%, que é o
 * número defensável e o alvo do ADR-0099.
 */
const ADJETIVOS = [
  'ELEGANTE', 'VERSATIL', 'RESISTENTE', 'SUPER RESISTENTE', 'ALTA RESISTENCIA',
  'ALTA DURABILIDADE', 'QUALIDADE PREMIUM', 'ALTA QUALIDADE', 'QUALIDADE SUPERIOR',
  'TOQUE MACIO', 'MACIO', 'CONFORTO E CONTROLE', 'SECAGEM LIMPA', 'ADESAO FIRME',
  'ALTA ADERENCIA', 'USO PROFISSIONAL', 'ALTA PERFORMANCE', 'EXCELENTE QUALIDADE',
  'PALETA VIBRANTE', 'ROLO ECONOMICO', 'FIXACAO FIRME', 'PREMIUM', 'IDEAL PARA CRIANCAS',
  'ECOLOGICA', 'PVC DE ALTA QUALIDADE',
];

export function terminaEmAdjetivoVazio(titulo: string): boolean {
  const fim = norm(titulo.split('|').pop() ?? '').trim();
  return ADJETIVOS.some((a) => fim === a || fim.endsWith(` ${a}`));
}

/** Reprova qualquer unidade não-canônica: MT, MTS, METROS, UND, UNDS, GR. */
export function unidadeCanonica(titulo: string): boolean {
  return !/\d\s*(MT|MTS|METROS|UND|UNDS|GR)\b/i.test(titulo);
}

export function marcaAncorada(titulo: string, fonte: string): boolean {
  const alvo = norm(fonte);
  // Toda palavra capitalizada do título que não seja unidade nem número é candidata a marca;
  // basta uma constar da fonte para o título estar ancorado.
  const candidatas = titulo.split(/\s+/).filter((p) => /^[A-ZÁ-Ú]/.test(p) && !/^\d/.test(p));
  return candidatas.some((c) => alvo.includes(norm(c)));
}

/** Grupos de título idêntico entre codigo_pai DISTINTOS — o mesmo produto reingerido não conta. */
export function colisoes(itens: Array<{ codigoPai: string; titulo: string }>): number {
  const porTitulo = new Map<string, Set<string>>();
  for (const i of itens) {
    const chave = norm(i.titulo).trim();
    if (!porTitulo.has(chave)) porTitulo.set(chave, new Set());
    porTitulo.get(chave)!.add(i.codigoPai);
  }
  return [...porTitulo.values()].filter((pais) => pais.size > 1).length;
}
```

Depois criar `scripts/experimento-titulo/index.ts` copiando a estrutura de `scripts/experimento-copy/index.ts` (management API, `SUPABASE_ACCESS_TOKEN`, concorrência configurável), com:
- query: `select codigo_pai, nome_pai, descricao_pai, unidade, fornecedor, titulo_ml, <variacoes> from familias where titulo_ml is not null and not titulo_editado_pelo_operador order by criado_em desc limit 150`
- cenário A: `titulo_ml` gravado (baseline grátis, não re-executa)
- cenário B: `gerarCopy` novo + `posProcessarTitulo`
- relatório em `scripts/experimento-titulo/resultado.md` com a tabela de métricas

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test tests/experimento-titulo-metricas.test.ts`
Expected: PASS (11 testes)

- [ ] **Step 5: Commit**

```bash
git add scripts/experimento-titulo/ tests/experimento-titulo-metricas.test.ts
git commit -m "feat(experimento): harness e métricas puras para o título"
```

---

## Task 13: ADR-0099 e documentação

**Files:**
- Create: `docs/decisions/0099-titulo-padrao-mercado-livre.md`
- Modify: `docs/TASKS.md`, `obsidian-vault/04-Decisões/Índice de ADRs.md`, `docs/reference/glossario.md`

**Interfaces:** nenhuma.

**Contexto:** a regra do projeto exige documentação atualizada **no mesmo commit da entrega**. "Slot de título" e "discriminador" são termos de domínio novos e precisam entrar no glossário.

- [ ] **Step 1: Escrever o ADR**

Criar `docs/decisions/0099-titulo-padrao-mercado-livre.md` com:
- **Contexto:** o censo de 143 títulos (35% adjetivo vazio, 52% unidade não canônica, 94% pipe, 14% sem acento, 1 colisão) e a causa — o prompt prescrevia `| DIFERENCIAL` com `| RESISTENTE` de exemplo, repetindo a Causa C do ADR-0098.
- **Decisão:** contrato de dez slots, ordem de leitura ≠ ordem de corte, `medida` e `variacao`-discriminadora incortáveis, `TituloInviavelError`, `posProcessarTitulo` único.
- **Consequências:** título de anúncio publicado NÃO é atualizado (o `atualizarItemML` nunca envia `title`), então a mudança vale só para anúncios novos — raio zero sobre os 167 vivos. Marca é best-effort: ~metade do catálogo não a tem na fonte.
- **Alternativas descartadas:** manter o pipe (contraria o padrão ML); derivar marca do `fornecedor` por heurística (medido: produz `"BARBANTE"` para Bandeirante e `"V"` para V.R.Machado); truncar quando não cabe (funde produtos, o ML derruba por duplicado).

- [ ] **Step 2: Registrar nos índices**

- `docs/TASKS.md`: entrada de conclusão referenciando o ADR-0099.
- `obsidian-vault/04-Decisões/Índice de ADRs.md`: linha do ADR-0099.
- `docs/reference/glossario.md`: verbetes **slot de título** (um dos dez campos nomeados que a IA preenche e o montador ordena) e **discriminador** (dado que identifica unicamente uma família perante as irmãs — hoje `medida` sempre e `variacao` quando a família é mono-cor; nunca é cortado do título).

- [ ] **Step 3: Conferir a suíte inteira e os tipos**

Run: `pnpm test && pnpm lint && pnpm lint:functions && pnpm check:functions`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add docs/ obsidian-vault/
git commit -m "docs: ADR-0099 título no padrão Mercado Livre"
```

---

## Ordem de execução e dependências

```
Task 1 (slots) ─┬─> Task 3 (case) ─┐
                ├─> Task 4 (marcas)├─> Task 5 (montar) ─┐
                │                  │                    ├─> Task 7 (pos) ─> Task 10 (call sites) ─> Task 11 (limpeza)
Task 2 (unidade)┴──────────────────┴> Task 6 (guards) ──┘                          │
                                                                                    │
Task 8 (schema) ────────────────────────────────────────────────────────────────────┤
Task 9 (prompt) ────────────────────────────────────────────────────────────────────┘
                                                                     Task 12 (experimento) ─> Task 13 (docs)
```

Tasks 1–4 são independentes entre si depois da Task 1 e podem ir em paralelo. Task 10 exige 7, 8 e 9 prontas — é onde o sistema volta a compilar de ponta a ponta.

## Validação final antes de fechar a branch

1. `pnpm test && pnpm lint && pnpm lint:functions && pnpm check:functions` — tudo verde.
2. Rodar o experimento (Task 12) e conferir contra o baseline: adjetivo vazio 35% → ~0%, unidade canônica 48% → 100%, pipe 94% → 0%, marca ancorada ≥ 36%, marca não-ancorada permanece 0%, colisões 1 → 0.
3. Validação em runtime real com browser-use antes de qualquer merge — nenhuma família foi processada com o contrato novo até aqui, e toda a verificação anterior é estrutural.
4. Nenhum `TODO`, `test.skip` ou stub na árvore.
