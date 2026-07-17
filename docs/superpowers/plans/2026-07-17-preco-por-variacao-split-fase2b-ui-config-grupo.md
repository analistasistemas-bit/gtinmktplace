# Preço por variação — Fase 2b: UI de preço por variação e config por faixa — Plano de Implementação

> **Para workers agênticos:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans pra implementar este plano task a task. Steps usam sintaxe de checkbox (`- [ ]`) pra tracking.

**Objetivo:** A Revisão passa a permitir preços diferentes por variação de verdade: prompt "aplicar às demais?" na edição de preço, config de desconto/atacado por faixa de preço (em vez do bloqueio atual), badge "preço alterado" por variação, e aviso LOUD no diálogo de publicação quando honrar os preços exigiria dividir anúncio publicado.

**Arquitetura:** Helpers puros em `src/lib/grupos-preco.ts` (agrupamento, alvos da edição de preço, detecção de divisão no UPDATE, pendência de config) testados com vitest; `preco-alterado.ts` muda de comparação colapsada (F1) para por-variação; mutations novas gravam config nas colunas de `variacoes` (criadas na Fase 2a); componente novo `ConfigGruposPreco` substitui os controles bloqueados quando a família é divergente; `Revisao.tsx` ganha o aviso LOUD no diálogo. O backend (Fase 2a) já roteia divergência para o split — a UI só cria a divergência que ele suporta.

**Stack:** React + TypeScript + TanStack Query + shadcn/ui, vitest (jsdom), Supabase JS (mutations diretas com RLS).

## Restrições Globais

- **PRÉ-REQUISITO ABSOLUTO: a Fase 2a (plano `2026-07-17-preco-por-variacao-split-fase2a-dados-e-motor.md`) precisa estar mergeada e as edge functions deployadas ANTES de qualquer task deste plano tocar main.** Invariante #1 do ADR-0078: a UI que cria divergência e o split que a suporta nunca podem se separar em produção.
- **Invariante #2:** desativar atacado de um grupo grava `[]` (explicitamente sem atacado), NUNCA `null` (null = herda o família-level e pode virar LOUD no publish). Desativar desconto grava `false` explícito.
- **Pinagem (spec):** toda edição de preço pelo operador seta `preco_editado_pelo_operador = true` (a mutation `updateVariacaoPreco` em `src/lib/queries.ts:175-187` já faz isso) — "Sim, aplicar a todas" pina todas as salvas; "Não, só esta" pina só a editada.
- Caminho uniforme (todas as cores no mesmo preço) permanece **visualmente idêntico**: controles família-level atuais, sem prompt de grupo, sem badge indevido.
- Preços comparados com `round2` (2 casas) — mesma regra de centavos do backend.
- Botões de lote "Ativar desconto no lote"/"Atacado no lote" CONTINUAM bloqueados quando há família divergente (spec, "UI da Revisão") — só o texto muda para apontar a config por faixa.
- `pnpm test` exige `.env.test` (existe no repo). `pnpm lint` + `pnpm test` verdes em todo commit.
- Trabalho em worktree/branch; nunca editar main. Commits pequenos.

## Estrutura de arquivos

| Arquivo | Papel |
|---|---|
| `src/lib/tipos-dominio.ts` (modificar) | `Variacao` ganha `exibirComDesconto`, `descontoPct`, `atacado` |
| `src/lib/queries.ts` (modificar) | `variacaoFromRow` mapeia as colunas novas; mutations `setDescontoGrupo`/`setAtacadoGrupo` |
| `src/hooks/useFamiliaMutations.ts` (modificar) | `useSetDescontoGrupo`, `useSetAtacadoGrupo` |
| `src/lib/grupos-preco.ts` (criar) | `gruposDePreco`, `alvosAplicarPreco`, `exigeDivisaoUpdate`, `configGrupoPendente` |
| `src/lib/preco-alterado.ts` (modificar) | Badge por variação (F2) |
| `src/components/config-grupos-preco.tsx` (criar) | Config de desconto/atacado por faixa |
| `src/components/familia-row.tsx` (modificar) | Divergente → `ConfigGruposPreco`; uniforme → controles atuais |
| `src/components/familia-expanded.tsx` (modificar) | Prompt "aplicar às demais variações?" |
| `src/pages/Revisao.tsx` (modificar) | Textos dos botões de lote; aviso LOUD no diálogo de publicação |
| `src/lib/publicavel.ts` (modificar) | Só o comentário de `familiaPrecosDivergentes` (semântica: de bloqueio → chave do modo por-faixa) |
| Testes: `src/lib/__tests__/grupos-preco.test.ts` (criar), `src/lib/__tests__/preco-alterado.test.ts` (modificar) | TDD dos helpers |
| `docs/reference/edge-functions.md`, `obsidian-vault/04-Decisões/Índice de ADRs.md`, `docs/TASKS.md` (modificar/conferir) | Fechamento de documentação |

---

### Task 1: Tipos de domínio + adapter + mutations de grupo

**Arquivos:**
- Modificar: `src/lib/tipos-dominio.ts` (interface `Variacao`)
- Modificar: `src/lib/queries.ts` (`variacaoFromRow`, novas mutations no bloco "Mutations")
- Modificar: `src/hooks/useFamiliaMutations.ts` (dois hooks novos)

**Interfaces:**
- Consome: colunas `variacoes.exibir_com_desconto/desconto_pct/atacado` (Fase 2a, Task 1 — já em `database.types.ts`).
- Produz (Tasks 2, 5 dependem destes nomes exatos):
  - `Variacao.exibirComDesconto: boolean | null`, `Variacao.descontoPct: number | null`, `Variacao.atacado: FaixaAtacado[] | null`
  - `setDescontoGrupo(variacaoIds: string[], exibir: boolean, pct: number | null): Promise<void>`
  - `setAtacadoGrupo(variacaoIds: string[], faixas: FaixaAtacado[]): Promise<void>` — grava `faixas` como está (`[]` = explicitamente sem atacado; NUNCA converter [] em null)
  - `useSetDescontoGrupo(loteId: string)` → mutation `{ variacaoIds: string[]; exibir: boolean; pct: number | null }`
  - `useSetAtacadoGrupo(loteId: string)` → mutation `{ variacaoIds: string[]; faixas: FaixaAtacado[] }`

- [ ] **Step 1: `tipos-dominio.ts`** — na interface `Variacao` (após `custo: number | null;`), adicionar:

```ts
  /** Config por faixa (ADR-0078 F2). null = herda o família-level. */
  exibirComDesconto: boolean | null;
  descontoPct: number | null;
  /** null = herda; [] = explicitamente sem atacado (≠ null!). */
  atacado: FaixaAtacado[] | null;
```
O arquivo já tem `import type { FaixaAtacado } from './atacado';` no meio do arquivo — mover/usar esse import (ele precisa estar antes do uso na interface `Variacao`; mova a linha de import para o topo do arquivo).

- [ ] **Step 2: `queries.ts` — `variacaoFromRow`** (linhas ~145-169), adicionar ao objeto retornado:

```ts
    exibirComDesconto: r.exibir_com_desconto,
    descontoPct: r.desconto_pct != null ? Number(r.desconto_pct) : null,
    atacado: Array.isArray(r.atacado) ? (r.atacado as unknown as FaixaAtacado[]) : null,
```

- [ ] **Step 3: `queries.ts` — mutations** (junto de `updateFamiliaAtacado`/`setAtacadoLote`, ~linha 600):

```ts
// ADR-0078 F2: config POR FAIXA de preço — grava em TODAS as variações do grupo (a config
// viaja na variação; repreçar nunca a órfã). Desativar desconto = false explícito; desativar
// atacado = [] explícito (null significaria "herda a família" e pode virar LOUD no publish).
export async function setDescontoGrupo(
  variacaoIds: string[], exibir: boolean, pct: number | null,
): Promise<void> {
  const { error } = await supabase.from('variacoes')
    .update({ exibir_com_desconto: exibir, desconto_pct: pct })
    .in('id', variacaoIds);
  if (error) throw error;
}

export async function setAtacadoGrupo(variacaoIds: string[], faixas: FaixaAtacado[]): Promise<void> {
  const { error } = await supabase.from('variacoes')
    .update({ atacado: faixas as unknown as Database['public']['Tables']['variacoes']['Update']['atacado'] })
    .in('id', variacaoIds);
  if (error) throw error;
}
```

- [ ] **Step 4: `useFamiliaMutations.ts`** — importar `setDescontoGrupo, setAtacadoGrupo` de `@/lib/queries` e adicionar (seguindo o padrão exato dos hooks vizinhos, ex.: `useUpdateFamiliaAtacado` — invalidação de `QK.familias(loteId)` no `onSuccess`):

```ts
export function useSetDescontoGrupo(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ variacaoIds, exibir, pct }: { variacaoIds: string[]; exibir: boolean; pct: number | null }) =>
      setDescontoGrupo(variacaoIds, exibir, pct),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}

export function useSetAtacadoGrupo(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ variacaoIds, faixas }: { variacaoIds: string[]; faixas: FaixaAtacado[] }) =>
      setAtacadoGrupo(variacaoIds, faixas),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}
```
(Se o arquivo importar `useMutation`/`useQueryClient`/`QK` com outros nomes, seguir o padrão local — abrir o arquivo antes.)

- [ ] **Step 5: Compilar, rodar a suíte e commitar** — muitos testes constroem objetos `Variacao` literais; os campos novos são obrigatórios na interface, então testes/factories que quebrarem devem ganhar `exibirComDesconto: null, descontoPct: null, atacado: null` (mudança mecânica).

```bash
pnpm lint && pnpm test
git add src/lib/tipos-dominio.ts src/lib/queries.ts src/hooks/useFamiliaMutations.ts src
git commit -m "feat: tipos e mutations de config por faixa (ADR-0078 F2b)"
```

---

### Task 2: `src/lib/grupos-preco.ts` — helpers puros da UI

**Arquivos:**
- Criar: `src/lib/grupos-preco.ts`
- Teste: `src/lib/__tests__/grupos-preco.test.ts`

**Interfaces:**
- Consome: `Variacao`, `Familia` de `./tipos-dominio` (com os campos da Task 1).
- Produz (Tasks 4, 5, 6 dependem destes nomes exatos):

```ts
export interface GrupoPreco { preco: number; variacoes: Variacao[]; }
export function gruposDePreco(familia: Pick<Familia, 'variacoes'>): GrupoPreco[];
export function alvosAplicarPreco(
  variacoes: Variacao[], codigoEditado: string, aplicarATodas: boolean, novoPreco: number,
): Variacao[];
export function exigeDivisaoUpdate(familia: Pick<Familia, 'operacao' | 'variacoes'>): boolean;
export function configGrupoPendente(
  familia: Pick<Familia, 'exibirComDesconto' | 'atacado'>, grupo: GrupoPreco,
): boolean;
```

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/__tests__/grupos-preco.test.ts
import { describe, it, expect } from 'vitest';
import { gruposDePreco, alvosAplicarPreco, exigeDivisaoUpdate, configGrupoPendente } from '../grupos-preco';
import type { Variacao } from '../tipos-dominio';

const v = (codigo: string, over: Partial<Variacao> = {}): Variacao => ({
  id: codigo,
  codigo,
  cor: 'Azul',
  corHex: '#00f',
  corOrigem: null,
  corEditadaPeloOperador: false,
  preco: 8,
  precoPublicacao: 10,
  precoPublicadoMl: null,
  estoque: 5,
  gtin: null,
  excluidaDaPublicacao: false,
  mlVariationId: null,
  estoqueAnterior: null,
  custo: null,
  pesoGramas: null,
  alturaCm: null,
  larguraCm: null,
  comprimentoCm: null,
  exibirComDesconto: null,
  descontoPct: null,
  atacado: null,
  ...over,
});

describe('gruposDePreco', () => {
  it('uniforme → 1 grupo com todas as incluídas', () => {
    const g = gruposDePreco({ variacoes: [v('A'), v('B')] });
    expect(g).toHaveLength(1);
    expect(g[0].preco).toBe(10);
    expect(g[0].variacoes).toHaveLength(2);
  });
  it('2 preços → 2 grupos ordenados do menor para o maior; excluídas ficam de fora', () => {
    const g = gruposDePreco({
      variacoes: [v('A'), v('B', { precoPublicacao: 12 }), v('X', { excluidaDaPublicacao: true, precoPublicacao: 99 })],
    });
    expect(g.map((x) => x.preco)).toEqual([10, 12]);
  });
  it('sem precoPublicacao usa o preco da planilha (mesma regra dos controles atuais)', () => {
    const g = gruposDePreco({ variacoes: [v('A', { precoPublicacao: null })] });
    expect(g[0].preco).toBe(8);
  });
});

describe('alvosAplicarPreco', () => {
  const vars = [v('A'), v('B'), v('C', { precoPublicacao: 12 })];
  it('"Sim, aplicar a todas": a editada + toda variação com preço diferente do novo', () => {
    const alvos = alvosAplicarPreco(vars, 'A', true, 12);
    expect(alvos.map((x) => x.codigo).sort()).toEqual(['A', 'B']); // C já está em 12
  });
  it('"Não, só esta": só a editada', () => {
    expect(alvosAplicarPreco(vars, 'A', false, 12).map((x) => x.codigo)).toEqual(['A']);
  });
});

describe('exigeDivisaoUpdate', () => {
  it('CREATE nunca exige divisão', () => {
    expect(exigeDivisaoUpdate({ operacao: 'CREATE', variacoes: [v('A')] })).toBe(false);
  });
  it('UPDATE: variações do MESMO anúncio (mesmo precoPublicadoMl) indo a preços distintos → true', () => {
    expect(exigeDivisaoUpdate({
      operacao: 'UPDATE',
      variacoes: [
        v('A', { mlVariationId: 'm1', precoPublicadoMl: 10, precoPublicacao: 10 }),
        v('B', { mlVariationId: 'm2', precoPublicadoMl: 10, precoPublicacao: 12 }),
      ],
    })).toBe(true);
  });
  it('UPDATE: anúncio inteiro repreçado junto (uniforme) → false', () => {
    expect(exigeDivisaoUpdate({
      operacao: 'UPDATE',
      variacoes: [
        v('A', { mlVariationId: 'm1', precoPublicadoMl: 10, precoPublicacao: 12 }),
        v('B', { mlVariationId: 'm2', precoPublicadoMl: 10, precoPublicacao: 12 }),
      ],
    })).toBe(false);
  });
  it('UPDATE: faixas distintas já publicadas (split no ar), cada uma uniforme no seu preço → false', () => {
    expect(exigeDivisaoUpdate({
      operacao: 'UPDATE',
      variacoes: [
        v('A', { mlVariationId: 'm1', precoPublicadoMl: 10, precoPublicacao: 10 }),
        v('B', { mlVariationId: 'm2', precoPublicadoMl: 15, precoPublicacao: 15 }),
      ],
    })).toBe(false);
  });
  it('cor nova (precoPublicadoMl null) e excluídas não contam', () => {
    expect(exigeDivisaoUpdate({
      operacao: 'UPDATE',
      variacoes: [
        v('A', { mlVariationId: 'm1', precoPublicadoMl: 10, precoPublicacao: 10 }),
        v('N', { precoPublicacao: 20 }),
        v('X', { mlVariationId: 'm3', precoPublicadoMl: 10, precoPublicacao: 99, excluidaDaPublicacao: true }),
      ],
    })).toBe(false);
  });
});

describe('configGrupoPendente', () => {
  const grupo = (vars: Variacao[]) => ({ preco: 10, variacoes: vars });
  it('família com desconto ativo + variação sem confirmação explícita → pendente', () => {
    expect(configGrupoPendente({ exibirComDesconto: true, atacado: null }, grupo([v('A')]))).toBe(true);
  });
  it('família com atacado ativo + variação sem atacado explícito → pendente', () => {
    expect(configGrupoPendente(
      { exibirComDesconto: false, atacado: [{ min_unidades: 5, desconto_pct: 5 }] },
      grupo([v('A')]),
    )).toBe(true);
  });
  it('tudo confirmado explicitamente (mesmo que desligado) → não pendente', () => {
    expect(configGrupoPendente(
      { exibirComDesconto: true, atacado: [{ min_unidades: 5, desconto_pct: 5 }] },
      grupo([v('A', { exibirComDesconto: false, atacado: [] })]),
    )).toBe(false);
  });
  it('família sem nada ativo → nunca pendente', () => {
    expect(configGrupoPendente({ exibirComDesconto: false, atacado: null }, grupo([v('A')]))).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm vitest run src/lib/__tests__/grupos-preco.test.ts`
Esperado: FALHA — módulo não existe.

- [ ] **Step 3: Implementação mínima**

```ts
// src/lib/grupos-preco.ts
// ADR-0078 F2: helpers da UI de preço por variação. Faixa = preço comparado a 2 casas
// (mesma regra de centavos do backend, _shared/preco/grupos.ts).
import type { Familia, Variacao } from './tipos-dominio';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface GrupoPreco { preco: number; variacoes: Variacao[]; }

/** Grupos de preço (faixas) das cores incluídas, do menor para o maior preço. */
export function gruposDePreco(familia: Pick<Familia, 'variacoes'>): GrupoPreco[] {
  const incluidas = familia.variacoes.filter((x) => !x.excluidaDaPublicacao);
  const base = incluidas.length > 0 ? incluidas : familia.variacoes;
  const porPreco = new Map<number, Variacao[]>();
  for (const x of base) {
    const p = round2(x.precoPublicacao ?? x.preco);
    (porPreco.get(p) ?? porPreco.set(p, []).get(p)!).push(x);
  }
  return [...porPreco.entries()]
    .sort(([a], [b]) => a - b)
    .map(([preco, variacoes]) => ({ preco, variacoes }));
}

/** Alvos da edição de preço. "Aplicar a todas" replica como hoje (editada + quem difere do
 *  novo preço); "só esta" salva apenas a editada. A mutation pina cada alvo salvo. */
export function alvosAplicarPreco(
  variacoes: Variacao[],
  codigoEditado: string,
  aplicarATodas: boolean,
  novoPreco: number,
): Variacao[] {
  if (!aplicarATodas) return variacoes.filter((x) => x.codigo === codigoEditado);
  return variacoes.filter((x) => x.codigo === codigoEditado || x.precoPublicacao !== novoPreco);
}

/** LOUD do UPDATE (invariante #4): variações publicadas do MESMO anúncio (proxy: mesmo
 *  precoPublicadoMl, a faixa viva delas) indo a preços novos DISTINTOS = honrar exige
 *  dividir/migrar (perde histórico). Repreçar o anúncio inteiro junto não conta. O backend
 *  (particionarPorPreco) é a verdade final; aqui é o aviso antecipado na Revisão. */
export function exigeDivisaoUpdate(familia: Pick<Familia, 'operacao' | 'variacoes'>): boolean {
  if (familia.operacao !== 'UPDATE') return false;
  const publicadas = familia.variacoes.filter(
    (x) => x.mlVariationId && !x.excluidaDaPublicacao && x.precoPublicadoMl != null,
  );
  const novosPorFaixa = new Map<number, Set<number>>();
  for (const x of publicadas) {
    const faixa = round2(x.precoPublicadoMl!);
    const novo = round2(x.precoPublicacao ?? x.preco);
    (novosPorFaixa.get(faixa) ?? novosPorFaixa.set(faixa, new Set()).get(faixa)!).add(novo);
  }
  return [...novosPorFaixa.values()].some((novos) => novos.size > 1);
}

/** Espelho do LOUD do backend (resolverConfigGrupo): família divergente com desconto/atacado
 *  ativo no família-level e grupo sem confirmação explícita → o publish vai falhar. O selo
 *  "configurar faixa" aponta isso ANTES de publicar. */
export function configGrupoPendente(
  familia: Pick<Familia, 'exibirComDesconto' | 'atacado'>,
  grupo: GrupoPreco,
): boolean {
  const famDesconto = familia.exibirComDesconto;
  const famAtacado = (familia.atacado ?? []).length > 0;
  if (!famDesconto && !famAtacado) return false;
  return grupo.variacoes.some(
    (x) => (famDesconto && x.exibirComDesconto == null) || (famAtacado && x.atacado == null),
  );
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Rodar: `pnpm vitest run src/lib/__tests__/grupos-preco.test.ts`
Esperado: PASSA.

- [ ] **Step 5: Commit**

```bash
git add src/lib/grupos-preco.ts src/lib/__tests__/grupos-preco.test.ts
git commit -m "feat: helpers de faixa de preço na UI (ADR-0078 F2b)"
```

---

### Task 3: Badge "preço alterado" por variação

**Arquivos:**
- Modificar: `src/lib/preco-alterado.ts`
- Teste: `src/lib/__tests__/preco-alterado.test.ts` (modificar — os testes F1 de "efetivo colapsado" mudam de semântica)

**Interfaces:**
- Consome: shape `{ precoPublicacao, precoPublicadoMl, excluidaDaPublicacao }` (inalterado).
- Produz: `temAlteracaoPreco(familia): boolean` — mesma assinatura, semântica F2: badge quando **alguma** variação incluída tem `precoPublicadoMl != null` e `round2(precoPublicacao) !== round2(precoPublicadoMl)`. O badge nunca promete preço que o publish não empurraria (spec): na F2 o publish empurra o preço da PRÓPRIA variação.

- [ ] **Step 1: Reescrever o teste (fica RED contra a implementação F1)**

```ts
// src/lib/__tests__/preco-alterado.test.ts  (substituir o conteúdo)
import { describe, it, expect } from 'vitest';
import { temAlteracaoPreco } from '../preco-alterado';

const v = (precoPublicacao: number | null, precoPublicadoMl: number | null, excluida = false) =>
  ({ precoPublicacao, precoPublicadoMl, excluidaDaPublicacao: excluida });

describe('temAlteracaoPreco (F2: por variação)', () => {
  it('variação com preço a publicar ≠ confirmado no ML → badge', () => {
    expect(temAlteracaoPreco({ variacoes: [v(12, 10), v(10, 10)] })).toBe(true);
  });
  it('todas iguais ao confirmado → sem badge', () => {
    expect(temAlteracaoPreco({ variacoes: [v(10, 10), v(15, 15)] })).toBe(false);
  });
  it('preços divergentes entre si, mas cada um igual à sua faixa publicada → SEM badge (split no ar)', () => {
    expect(temAlteracaoPreco({ variacoes: [v(10, 10), v(12, 12)] })).toBe(false);
  });
  it('precoPublicadoMl null (nunca publicada) → sem badge', () => {
    expect(temAlteracaoPreco({ variacoes: [v(12, null)] })).toBe(false);
  });
  it('excluída não conta', () => {
    expect(temAlteracaoPreco({ variacoes: [v(12, 10, true)] })).toBe(false);
  });
  it('diferença abaixo de 1 centavo não acusa', () => {
    expect(temAlteracaoPreco({ variacoes: [v(10.001, 10.004)] })).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Rodar: `pnpm vitest run src/lib/__tests__/preco-alterado.test.ts`
Esperado: FALHA no caso "split no ar" (a implementação F1 colapsa o efetivo e acusaria badge).

- [ ] **Step 3: Implementação mínima** (substituir o corpo de `temAlteracaoPreco`)

```ts
const round2 = (n: number) => Math.round(n * 100) / 100;

interface VariacaoPreco {
  precoPublicacao: number | null;
  precoPublicadoMl: number | null;
  excluidaDaPublicacao: boolean;
}

/** F2 (ADR-0078): badge POR VARIAÇÃO — o preço que o publish empurraria (o da própria
 *  variação) difere do último confirmado no ML. precoPublicadoMl null = nunca publicada. */
export function temAlteracaoPreco(familia: { variacoes: VariacaoPreco[] }): boolean {
  return familia.variacoes.some(
    (v) =>
      !v.excluidaDaPublicacao &&
      v.precoPublicacao != null &&
      v.precoPublicadoMl != null &&
      round2(v.precoPublicacao) !== round2(v.precoPublicadoMl),
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa** (o badge/filtro na Revisão e o diálogo já consomem `temAlteracaoPreco` — nada mais a mudar)

Rodar: `pnpm vitest run src/lib/__tests__/preco-alterado.test.ts && pnpm test`
Esperado: PASSA (suíte inteira).

- [ ] **Step 5: Commit**

```bash
git add src/lib/preco-alterado.ts src/lib/__tests__/preco-alterado.test.ts
git commit -m "feat: badge preço alterado por variação (ADR-0078 F2b)"
```

---

### Task 4: Prompt "aplicar às demais variações?" na edição de preço

**Arquivos:**
- Modificar: `src/components/familia-expanded.tsx` (função `salvarPreco`, ~linhas 173-198, + um `AlertDialog` novo no JSX)

**Interfaces:**
- Consome: `alvosAplicarPreco` (Task 2), `updatePreco` (hook existente `useUpdateVariacaoPreco` — a mutation pina `preco_editado_pelo_operador = true`), componentes `AlertDialog*` já importados no arquivo.
- Produz: comportamento — editar preço com outras cores presentes abre o prompt; "Sim, aplicar a todas" replica + pina todas (comportamento atual); "Não, só esta cor" salva/pina só a editada (cria divergência, agora suportada). Família de 1 cor: salva direto, sem prompt.

- [ ] **Step 1: Estado + refatoração de `salvarPreco`** — adicionar import:

```ts
import { alvosAplicarPreco } from '@/lib/grupos-preco';
```
Adicionar estado junto aos outros `useState`:

```ts
  // ADR-0078 F2: edição de preço pergunta "aplicar às demais?" em vez de replicar no automático.
  const [promptPreco, setPromptPreco] = useState<{ codigo: string; preco: number } | null>(null);
```
Substituir `salvarPreco` por:

```ts
  async function salvarPreco(codigo: string) {
    const editada = variacoes.find((x) => x.codigo === codigo);
    const original = familia.variacoes.find((x) => x.codigo === codigo);
    if (!editada?.id || !original) return;
    const novoPreco = editada.precoPublicacao;
    if (novoPreco == null || novoPreco === original.precoPublicacao) return;
    if (variacoes.length === 1) {
      await aplicarPreco(codigo, novoPreco, false);
      return;
    }
    setPromptPreco({ codigo, preco: novoPreco }); // "aplicar às demais variações?"
  }

  async function aplicarPreco(codigo: string, novoPreco: number, aplicarATodas: boolean) {
    // "Sim" = replica + pina todas (comportamento clássico); "Não" = preço próprio + pina só a
    // editada (a divergência resultante roteia para o split — ADR-0078 F2).
    const alvos = alvosAplicarPreco(variacoes, codigo, aplicarATodas, novoPreco).filter((x) => x.id);
    if (aplicarATodas) {
      setVariacoes((vs) => vs.map((x) => ({ ...x, precoPublicacao: novoPreco })));
    }
    alvos.forEach((x) => flashPreco(x.codigo, 'salvando'));
    await Promise.all(
      alvos.map(async (x) => {
        try {
          await updatePreco.mutateAsync({ id: x.id!, preco: novoPreco });
          flashPreco(x.codigo, 'salvo');
        } catch {
          flashPreco(x.codigo, 'erro');
        }
      }),
    );
  }
```
(Conferir a assinatura real do `updatePreco.mutateAsync` no hook — hoje é `{ id, preco }`; seguir o que o arquivo já usa.)

- [ ] **Step 2: Diálogo no JSX** — antes do fechamento do componente (junto dos outros diálogos), adicionar:

```tsx
      <AlertDialog open={promptPreco != null} onOpenChange={(aberto) => { if (!aberto) setPromptPreco(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar o novo preço às demais variações?</AlertDialogTitle>
            <AlertDialogDescription>
              {promptPreco && (
                <>Novo preço: <strong>R$ {promptPreco.preco.toFixed(2)}</strong>. "Sim" iguala todas as
                cores (um anúncio, preço único). "Não" mantém preços diferentes — as faixas serão
                publicadas como anúncios separados no Mercado Livre.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                if (promptPreco) void aplicarPreco(promptPreco.codigo, promptPreco.preco, false);
                setPromptPreco(null);
              }}
            >
              Não, só esta cor
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (promptPreco) void aplicarPreco(promptPreco.codigo, promptPreco.preco, true);
                setPromptPreco(null);
              }}
            >
              Sim, aplicar a todas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

Nota: fechar o diálogo pelo X/Esc (onOpenChange sem clique nos botões) NÃO salva nada — o estado local da cor editada mantém o valor digitado, e o operador pode reabrir salvando de novo. Sem persistência implícita (invariante #2 em espírito: nada muda sem escolha).

- [ ] **Step 3: Verificar manualmente + suíte**

```bash
pnpm lint && pnpm test
```
Esperado: verdes. (A lógica de alvos está testada na Task 2; o diálogo é wiring.)

- [ ] **Step 4: Commit**

```bash
git add src/components/familia-expanded.tsx
git commit -m "feat: prompt aplicar-às-demais na edição de preço (ADR-0078 F2b)"
```

---

### Task 5: `ConfigGruposPreco` — desconto/atacado por faixa na linha da família

**Arquivos:**
- Criar: `src/components/config-grupos-preco.tsx`
- Modificar: `src/components/familia-row.tsx` (bloco final de controles, ~linhas 407-410; remover `avisoPrecosDivergentes` e os ramos `divergente` de `DescontoControle`/`AtacadoControle`)
- Modificar: `src/lib/publicavel.ts` (só o comentário de `familiaPrecosDivergentes`)

**Interfaces:**
- Consome: `gruposDePreco`, `configGrupoPendente`, `GrupoPreco` (Task 2); `useSetDescontoGrupo`, `useSetAtacadoGrupo` (Task 1); `AtacadoEditor`, `validarFaixas`, `calcularPrecoDe`, `pctEfetivo`, `useDescontoPct`, `fmtBRLSemSimbolo`, `StatusPill` (existentes).
- Produz: `export function ConfigGruposPreco({ familia }: { familia: Familia })`.

- [ ] **Step 1: Criar o componente**

```tsx
// src/components/config-grupos-preco.tsx
// ADR-0078 F2: com preços divergentes, desconto e atacado deixam de ser família-level e passam
// a ser POR FAIXA DE PREÇO (cada faixa vira um anúncio próprio no split). A config é gravada em
// TODAS as variações do grupo — viaja na variação, repreçar nunca a órfã (invariante #2). Grupo
// herdando config família-level ATIVA sem confirmação explícita → o publish falha LOUD; o selo
// "configurar faixa" antecipa isso na Revisão.
import { useEffect, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { AtacadoEditor } from '@/components/atacado-editor';
import { useDescontoPct } from '@/hooks/useConfiguracoes';
import { useSetDescontoGrupo, useSetAtacadoGrupo } from '@/hooks/useFamiliaMutations';
import { calcularPrecoDe, pctEfetivo } from '@/lib/desconto';
import { validarFaixas, type FaixaAtacado } from '@/lib/atacado';
import { gruposDePreco, configGrupoPendente, type GrupoPreco } from '@/lib/grupos-preco';
import { fmtBRLSemSimbolo } from '@/lib/formato';
import type { Familia } from '@/lib/tipos-dominio';

export function ConfigGruposPreco({ familia }: { familia: Familia }) {
  const grupos = gruposDePreco(familia);
  return (
    <div className="space-y-3 text-xs">
      <div className="text-muted-foreground">
        Cores com preços diferentes: desconto e atacado são configurados <strong>por faixa de
        preço</strong>. Cada faixa será publicada como um anúncio próprio no Mercado Livre.
      </div>
      {grupos.map((g) => (
        <GrupoConfig key={g.preco} familia={familia} grupo={g} />
      ))}
    </div>
  );
}

function GrupoConfig({ familia, grupo }: { familia: Familia; grupo: GrupoPreco }) {
  const { data: globalPct } = useDescontoPct();
  const setDesconto = useSetDescontoGrupo(familia.loteId);
  const setAtacado = useSetAtacadoGrupo(familia.loteId);
  const ids = grupo.variacoes.map((x) => x.id).filter((x): x is string => !!x);
  const rep = grupo.variacoes[0];
  const exibir = rep.exibirComDesconto ?? false;
  const pct = pctEfetivo(rep.descontoPct, globalPct ?? 15);
  const de = calcularPrecoDe(grupo.preco, pct);
  const [faixas, setFaixas] = useState<FaixaAtacado[]>(rep.atacado ?? []);
  // Re-sincroniza quando o servidor muda (mesmo padrão do AtacadoControle atual).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setFaixas(rep.atacado ?? []); }, [JSON.stringify(rep.atacado ?? [])]);
  const atacadoAtivo = faixas.length > 0;
  const erro = validarFaixas(faixas);
  const dirty = JSON.stringify(faixas) !== JSON.stringify(rep.atacado ?? []);
  const pendente = configGrupoPendente(familia, grupo);

  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="flex flex-wrap items-center gap-2 font-medium">
        Faixa R$ {fmtBRLSemSimbolo(grupo.preco)} · {grupo.variacoes.length} cor(es)
        <span className="truncate font-normal text-muted-foreground">
          {grupo.variacoes.slice(0, 4).map((x) => x.cor || x.codigo).join(', ')}
          {grupo.variacoes.length > 4 && '…'}
        </span>
        {pendente && (
          <StatusPill
            tone="warning"
            title="A família tinha desconto/atacado ativo. Confirme a config desta faixa (mesmo que seja desligar) — sem isso a publicação falha de propósito."
          >
            ⚠ configurar faixa
          </StatusPill>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox
          aria-label={`Exibir com desconto (faixa R$ ${fmtBRLSemSimbolo(grupo.preco)})`}
          checked={exibir}
          onCheckedChange={(marcado) =>
            setDesconto.mutate({ variacaoIds: ids, exibir: marcado === true, pct: rep.descontoPct })
          }
        />
        <span>Exibir com desconto</span>
        {exibir && (
          <>
            <Input
              type="number"
              min={0}
              max={99}
              className="w-14"
              defaultValue={rep.descontoPct ?? globalPct ?? 15}
              onBlur={(e) => {
                const n = Number(e.target.value);
                setDesconto.mutate({ variacaoIds: ids, exibir: true, pct: Number.isFinite(n) ? n : null });
              }}
            />
            <span>%</span>
            {de != null && (
              <span className="text-muted-foreground">
                <s>R$ {fmtBRLSemSimbolo(de)}</s> · R$ {fmtBRLSemSimbolo(grupo.preco)} · {pct}% OFF
              </span>
            )}
          </>
        )}
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            aria-label={`Preço de atacado (faixa R$ ${fmtBRLSemSimbolo(grupo.preco)})`}
            checked={atacadoAtivo}
            onCheckedChange={(marcado) => {
              if (marcado) setFaixas(faixas.length ? faixas : [{ min_unidades: 5, desconto_pct: 5 }]);
              // [] explícito = "sem atacado" confirmado (null significaria herdar → LOUD no publish).
              else { setFaixas([]); setAtacado.mutate({ variacaoIds: ids, faixas: [] }); }
            }}
          />
          <span>Preço de atacado</span>
        </div>
        {atacadoAtivo && (
          <div className="pl-6">
            <AtacadoEditor faixas={faixas} precoBase={grupo.preco} onChange={setFaixas} />
            <Button
              type="button"
              size="sm"
              className="mt-1 h-7 text-xs"
              disabled={!!erro || !dirty || setAtacado.isPending}
              onClick={() => setAtacado.mutate({ variacaoIds: ids, faixas })}
            >
              {setAtacado.isPending ? 'Salvando…' : dirty ? 'Salvar atacado' : '✓ Salvo'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `familia-row.tsx`** — trocar o bloco final:

```tsx
      <div className="px-4 pb-2 pl-8 sm:pl-[100px] space-y-4">
        {familiaPrecosDivergentes(familia) ? (
          <ConfigGruposPreco familia={familia} />
        ) : (
          <>
            <DescontoControle familia={familia} />
            <AtacadoControle familia={familia} />
          </>
        )}
      </div>
```
Adicionar `import { ConfigGruposPreco } from '@/components/config-grupos-preco';`. Em seguida, LIMPAR o código morto: remover a função `avisoPrecosDivergentes` e, dentro de `DescontoControle` e `AtacadoControle`, remover `const divergente = familiaPrecosDivergentes(familia);`, os `className={divergente ? 'opacity-50' : undefined}`, os `title={divergente ? ... : undefined}` e os ramos `if (divergente && v) { avisoPrecosDivergentes(...); return; }` — esses componentes agora só renderizam para família uniforme. Remover também `precoVendaMax`/`precoBaseMax` se ficarem sem uso (só o que ESTA mudança orfanou).

- [ ] **Step 3: `publicavel.ts`** — atualizar o comentário de `familiaPrecosDivergentes` (a função fica igual):

```ts
// ADR-0078 F2: preços divergentes entre as cores incluídas. Não bloqueia mais — chaveia a UI
// para o modo "config por faixa" (ConfigGruposPreco) e o roteamento de publicação para o split
// (1 anúncio por faixa). Os botões de LOTE continuam bloqueados na divergência (a ação em lote
// é cega ao preço por cor — configure por faixa dentro da família).
```

- [ ] **Step 4: Verificar**

```bash
pnpm lint && pnpm test
```
Esperado: verdes. Validação visual fica no fim de branch (browser-use, ver Task 7).

- [ ] **Step 5: Commit**

```bash
git add src/components/config-grupos-preco.tsx src/components/familia-row.tsx src/lib/publicavel.ts
git commit -m "feat: config de desconto/atacado por faixa de preço na Revisão (ADR-0078 F2b)"
```

---

### Task 6: Revisão — textos dos botões de lote + LOUD no diálogo de publicação

**Arquivos:**
- Modificar: `src/pages/Revisao.tsx` (toasts dos botões de lote ~linhas 375-405; diálogo de publicação, dentro do bloco `selecaoTemUpdate` ~linha 651-697)

**Interfaces:**
- Consome: `exigeDivisaoUpdate` (Task 2); `familiasDivergentes`, `selecionadas`, `somenteEstoqueOverrides` (já existem no componente).
- Produz: aviso LOUD visível antes de confirmar a publicação; nenhum comportamento de publicação muda aqui (o backend é o enforcement — `particionarPorPreco` conflitos → erro 400).

- [ ] **Step 1: Textos dos botões de lote** — nos dois `toast.error` de divergência (desconto e atacado no lote), trocar a frase final `"Ative família a família ou iguale os preços entre as cores primeiro."` por `"Configure desconto/atacado POR FAIXA dentro de cada família divergente (a ação em lote é cega ao preço por cor)."`. Mesma troca nos dois `title` dos botões: `"...: clique para saber por que"` continua, só o corpo do toast muda.

- [ ] **Step 2: Aviso LOUD no diálogo** — adicionar import `exigeDivisaoUpdate` de `@/lib/grupos-preco` e, dentro do `DialogContent` de publicação, logo APÓS o bloco `{selecaoTemUpdate && (...)}`, adicionar:

```tsx
          {(() => {
            const exigemDivisao = familias.filter(
              (f) => selecionadas.has(f.id) && exigeDivisaoUpdate(f),
            );
            if (exigemDivisao.length === 0) return null;
            return (
              <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <p className="font-semibold">
                  ⚠ {exigemDivisao.length} produto(s) publicado(s) cujos novos preços exigem DIVIDIR o anúncio
                </p>
                {exigemDivisao.map((f) => (
                  <p key={f.id} className="truncate">· {f.titulo}</p>
                ))}
                <p className="mt-1">
                  Mover cores entre anúncios perde histórico, vendas e perguntas. Com "Atualizar tudo",
                  a publicação desses produtos vai <strong>falhar de propósito</strong> (nada é enviado
                  ao ML). Opções: marcar "Somente estoque" para eles (adia a decisão), igualar os preços
                  das cores do mesmo anúncio, ou remover o anúncio e republicar aceitando a perda.
                </p>
              </div>
            );
          })()}
```

- [ ] **Step 3: Verificar**

```bash
pnpm lint && pnpm test
```
Esperado: verdes.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Revisao.tsx
git commit -m "feat: aviso LOUD de divisão de anúncio no diálogo de publicação (ADR-0078 F2b)"
```

---

### Task 7: Documentação, validação de fim de branch e fechamento

**Arquivos:**
- Modificar: `docs/reference/edge-functions.md` (nota curta: a Revisão agora cria divergência; fluxo descrito na F2a permanece)
- Conferir/Modificar: `obsidian-vault/04-Decisões/Índice de ADRs.md` (entrada da ADR-0078 deve existir; se o status dela estiver "Proposto", atualizar o arquivo `docs/decisions/0078-...md` para "Aceito — implementado (F1+F2)" com a data)
- Modificar: `docs/TASKS.md` (registrar a entrega da Fase 2)
- Conferir: `obsidian-vault/06-Roadmap/Sprint Atual.md` (se listar a F2 como pendente, marcar)

**Interfaces:** Consome tudo das tasks anteriores. Produz o fechamento exigido pelo CLAUDE.md ("documentação atualizada ou conferida — no mesmo commit da entrega").

- [ ] **Step 1: Docs** — aplicar as edições acima. Em `edge-functions.md`, na seção do split (escrita na F2a), acrescentar uma linha: "A partir da F2b, a Revisão permite criar a divergência (prompt 'aplicar às demais?' + config por faixa); o roteamento e o LOUD descritos acima passam a ser exercitados pela UI."

- [ ] **Step 2: Validação completa de fim de branch (spec, seção "Validação de fim de branch")**

```bash
pnpm lint && pnpm test && npm run check:functions
```
Esperado: verdes. Em seguida, validação de runtime (manual, com Diego / browser-use em modo leitura no Chrome do Diego):
1. Família uniforme: tela idêntica à atual (controles família-level, sem prompt de grupo).
2. Editar preço de 1 cor → prompt; "Não" → família mostra faixas com config própria; badge "preço alterado" correto por variação.
3. Publicação CREATE de teste com 2 faixas no fluxo controlado do Diego → 2 anúncios, cada um com preço/PxQ do grupo; conferir `anuncios_externos.atacado_status` por partição.
4. Abrir um anúncio ao vivo e verificar se o de→para renderiza via `original_price` (decide o texto do preview e follow-up — ADR-0017/0078).
5. UPDATE cruzando faixa → erro LOUD visível na família (mensagem "dividir/migrar"); com "Somente estoque" → publica sem LOUD e sem tocar preço.

- [ ] **Step 3: Commit final**

```bash
git add docs obsidian-vault
git commit -m "docs: fechamento da Fase 2 preço por variação (ADR-0078)"
```

- [ ] **Step 4: Handoff** — apresentar a Diego para validação local antes de qualquer merge/push (workflow do projeto: branch → Diego valida → commit/push sob OK). Depois do merge, usar `superpowers:finishing-a-development-branch`.

---

## Autorrevisão (feita na escrita do plano)

- **Cobertura do spec (fatia UI):** prompt "Sim pina todas / Não pina só a editada" (T4 — pinagem via `updateVariacaoPreco`, que já seta `preco_editado_pelo_operador`; variação pinada não recalcula no re-ingest — comportamento existente de `process-familia:395`, não alterado); agrupamento por preço na Revisão + config por grupo + preview de→para por faixa (T5); botões de lote desabilitados com tooltip nova (T6); badge por variação/`preco_publicado_ml` null sem badge/split no ar sem badge falso (T3); destaque LOUD no diálogo com as 3 saídas do operador (T6); "config viaja na variação" e "[] ≠ null" (T1/T5); validação browser + publicação real controlada (T7).
- **Buracos documentados como decisão de plano:** (1) `exigeDivisaoUpdate` usa `precoPublicadoMl` como proxy da faixa do anúncio — duas partições com o mesmo preço vivo seriam tratadas como uma só no AVISO; o enforcement verdadeiro é o backend (`particionarPorPreco`), então o pior caso é um aviso a mais/a menos, nunca preço errado publicado. (2) `familiaPublicavel` NÃO bloqueia grupo com config pendente — bloquear impediria também o UPDATE "somente estoque", que é legítimo; a pendência aparece como selo "⚠ configurar faixa" (T5) e o publish falha LOUD se ignorada. (3) O prompt de preço não dispara para família de 1 cor (nada a replicar).
- **Consistência de tipos:** `gruposDePreco`/`alvosAplicarPreco`/`exigeDivisaoUpdate`/`configGrupoPendente` (T2) batem com os usos em T4/T5/T6; `setDescontoGrupo`/`setAtacadoGrupo` e hooks (T1) batem com T5; campos `exibirComDesconto`/`descontoPct`/`atacado` (T1) batem com T2/T5 e com as colunas da F2a Task 1.
