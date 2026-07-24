# Atualização rápida de estoque (1-clique) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao terminar de processar um lote, se houver famílias `UPDATE` sem nenhuma
pendência (mesmo critério já usado no "Selecionar todos" da Revisão), oferecer um
botão único de confirmação em `Progresso.tsx` que publica só o estoque delas no ML
(preço sempre ignorado), sem exigir que o operador entre em Revisão e selecione
família a família. `CREATE` nunca entra nesse atalho. `/relatorio/{loteId}` ganha uma
seção mostrando variações que zeraram estoque nesta rodada e famílias 100% zeradas.

**Architecture:** Mudança quase 100% frontend (1 linha exportada em código existente),
zero migration, zero edge function nova. O critério de elegibilidade reaproveita
`familiaPublicavel` (`src/lib/publicavel.ts`) — uma família com cor nova incompleta
(sem foto/preço) e estoque > 0 já retorna `ok: false` ali, o que a exclui
automaticamente do atalho. Isso sozinho **não basta**: uma cor nova *completa* (foto +
preço + estoque, mas nunca publicada no ML) passaria em `familiaPublicavel().ok` e
criaria uma variação nova de verdade — por isso a elegibilidade soma um segundo guard
(`temCorNovaIncluida`, via `casadaNoMl` exportada de `publicavel.ts`) que barra qualquer
cor incluída ainda não casada no ML, completa ou não. A publicação em si reusa
`publicarFamilias` (`src/lib/publicar.ts`) com `somenteEstoqueGlobal: true` (ADR-0078),
o mesmo edge `publicar-familias` que a Revisão já chama.

**Tech Stack:** React 18 + TypeScript, Vitest, Tailwind/shadcn, TanStack Query.

**ADR:** `docs/decisions/0089-atualizacao-rapida-de-estoque.md`

---

## Global constraints (todo o plano)

- `pnpm test` (vitest) e `pnpm lint` devem passar em cada task antes do commit.
- Nenhuma mudança em `ingest-lote`, schema, RLS ou edge functions — só frontend.
- Nunca incluir família `CREATE` no atalho de 1-clique, mesmo que tecnicamente pronta.
- Preço nunca é enviado ao ML por essa via — `somenteEstoqueGlobal` sempre `true`.
- Continua exigindo 1 clique de confirmação humana — nunca publicar sem essa ação.

---

## File Structure

- `src/lib/publicavel.ts` — **modificar** (1 linha). Exportar `casadaNoMl` (hoje
  privada) — `estoque-rapido.ts` precisa dela para garantir que nenhuma cor nova
  (completa ou não) entre no atalho de 1-clique.
- `src/lib/estoque-rapido.ts` — **criar**. Fonte única de duas funções puras:
  `familiasElegiveisEstoqueRapido` (elegibilidade pro atalho) e `calcularZerados`
  (relatório de variações/famílias que zeraram estoque).
- `src/lib/__tests__/estoque-rapido.test.ts` — **criar**. Testes das duas funções.
- `src/pages/Progresso.tsx` — **modificar**. Busca as famílias completas
  (`useFamilias`), calcula elegíveis e, quando > 0, mostra o gate de confirmação em
  vez de navegar direto pra Revisão.
- `src/pages/Relatorio.tsx` — **modificar**. Busca as famílias completas e renderiza a
  seção de zerados.

---

## Task 1: Funções puras `estoque-rapido.ts`

**Files:**
- Create: `src/lib/estoque-rapido.ts`
- Test: `src/lib/__tests__/estoque-rapido.test.ts`

Contexto de tipos usados (de `src/lib/tipos-dominio.ts`, não alterar):
`Familia` tem `id`, `operacao: 'CREATE'|'UPDATE'`, `variacoes: Variacao[]`, `codigoPai`,
`titulo`. `Variacao` tem `codigo`, `cor`, `estoque: number`,
`estoqueAnterior: number | null`, `excluidaDaPublicacao: boolean`,
`mlVariationId: string | null`, `jaCasadaUP?: boolean`. `familiaPublicavel` (de `src/lib/publicavel.ts`)
retorna `{ ok: boolean; motivos: string[] }` — **só bloqueia cor nova incompleta** (sem
foto/cor/preço). Uma cor nova **completa** (foto + preço + estoque > 0) passa em
`familiaPublicavel().ok === true` mesmo sem nunca ter ido ao ML — publicá-la criaria uma
variação nova de verdade, o que a ADR-0089 proíbe explicitamente ("todas as cores já
casadas com o ML"). Por isso a elegibilidade do atalho não pode depender só de
`familiaPublicavel`: precisa também barrar qualquer cor incluída que ainda não esteja
casada no ML, mesmo completa.

- [ ] **Step 0: Exportar `casadaNoMl` de `publicavel.ts`**

Em `src/lib/publicavel.ts`, troque a linha 13:

```ts
function casadaNoMl(v: Variacao): boolean {
```

por:

```ts
export function casadaNoMl(v: Variacao): boolean {
```

Nenhuma outra mudança nesse arquivo — só a visibilidade do símbolo.

- [ ] **Step 1: Write the failing test**

Crie `src/lib/__tests__/estoque-rapido.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { familiasElegiveisEstoqueRapido, calcularZerados } from '../estoque-rapido';
import type { Familia, Variacao } from '../tipos-dominio';

function mkVar(over: Partial<Variacao> = {}): Variacao {
  return {
    codigo: '001', cor: 'Azul', corHex: '#00f', corOrigem: null, corEditadaPeloOperador: false,
    preco: 40, precoPublicacao: 40, precoPublicadoMl: null, estoque: 5, gtin: null,
    fotoPath: 'foto/001.jpg', excluidaDaPublicacao: false, mlVariationId: 'V1',
    estoqueAnterior: null, custo: null, pesoGramas: null, alturaCm: null, larguraCm: null,
    comprimentoCm: null, exibirComDesconto: null, descontoPct: null, atacado: null,
    ...over,
  } as Variacao;
}

function mkFam(over: Partial<Familia> = {}): Familia {
  return {
    id: 'f1', codigoPai: '00000100', titulo: 'FITA EXEMPLO', operacao: 'UPDATE',
    status: 'pronto', atributosFaltantes: null, mlItemId: 'MLB123',
    categoriaMlId: 'MLB419782', tipoAviamento: 'outro',
    variacoes: [mkVar()],
    ...over,
  } as Familia;
}

describe('familiasElegiveisEstoqueRapido', () => {
  test('UPDATE publicável (cor casada, sem pendência): elegível', () => {
    const f = mkFam({ variacoes: [mkVar({ mlVariationId: 'V1', fotoPath: 'a.jpg' })] });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([f]);
  });

  test('CREATE, mesmo tecnicamente pronto, nunca é elegível', () => {
    const f = mkFam({
      operacao: 'CREATE', mlItemId: null, categoriaMlId: 'MLB419782',
      variacoes: [mkVar({ mlVariationId: null, fotoPath: 'a.jpg', excluidaDaPublicacao: false })],
    });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([]);
  });

  test('UPDATE com cor nova (estoque > 0, sem foto): não elegível — cai no fluxo manual', () => {
    const f = mkFam({
      variacoes: [
        mkVar({ mlVariationId: 'V1', fotoPath: 'a.jpg' }), // casada, ok
        mkVar({ codigo: '002', mlVariationId: null, fotoPath: undefined, estoque: 3 }), // cor nova sem foto
      ],
    });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([]);
  });

  // B1 (achado da revisão): familiaPublicavel só reprova cor nova INCOMPLETA. Uma cor
  // nova COMPLETA (foto + preço + estoque > 0) passa em familiaPublicavel().ok, mas
  // ainda não está casada no ML — publicá-la criaria uma variação nova de verdade, o
  // que a ADR-0089 proíbe. A elegibilidade tem que barrar isso mesmo com tudo completo.
  test('UPDATE com cor nova COMPLETA (foto+preço+estoque, mas ainda não casada no ML): não elegível', () => {
    const f = mkFam({
      variacoes: [
        mkVar({ mlVariationId: 'V1', fotoPath: 'a.jpg' }), // casada, ok
        mkVar({
          codigo: '002', mlVariationId: null, jaCasadaUP: false, fotoPath: 'nova.jpg',
          precoPublicacao: 40, estoque: 3, excluidaDaPublicacao: false,
        }), // cor nova 100% completa, mas NUNCA foi ao ML — não pode entrar no 1-clique
      ],
    });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([]);
  });

  test('UPDATE com cor nova SEM estoque (dorme, excluída): continua elegível', () => {
    const f = mkFam({
      variacoes: [
        mkVar({ mlVariationId: 'V1', fotoPath: 'a.jpg' }),
        mkVar({ codigo: '002', mlVariationId: null, fotoPath: undefined, estoque: 0, excluidaDaPublicacao: true }),
      ],
    });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([f]);
  });

  test('família ainda processando (status != pronto/erro): não elegível', () => {
    const f = mkFam({ status: 'processando' });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([]);
  });

  test('UPDATE com atributo obrigatório faltando (ADR-0052): não elegível', () => {
    const f = mkFam({ atributosFaltantes: ['Material'] });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([]);
  });

  test('UPDATE sem ml_item_id (nunca foi publicada): não elegível', () => {
    const f = mkFam({ mlItemId: null });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([]);
  });

  test('família com status erro: reprovável (retry pendente), não elegível pro atalho', () => {
    // familiaPublicavel trata 'erro' como republicável, mas a cor pode não estar
    // resolvida (é justamente o caso genérico "sem cor selecionada" abaixo); o teste
    // cobre o caminho onde não há nenhuma cor casada nem nova — sempre reprova.
    const f = mkFam({ status: 'erro', variacoes: [] });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([]);
  });

  test('mistura: só as elegíveis voltam, na ordem original', () => {
    const elegivel = mkFam({ id: 'f1' });
    const createPronto = mkFam({
      id: 'f2', operacao: 'CREATE', mlItemId: null,
      variacoes: [mkVar({ mlVariationId: null, fotoPath: 'a.jpg' })],
    });
    expect(familiasElegiveisEstoqueRapido([elegivel, createPronto])).toEqual([elegivel]);
  });
});

describe('calcularZerados', () => {
  test('variação que zerou nesta rodada (estoqueAnterior > 0, estoque 0): entra na lista', () => {
    const f = mkFam({ variacoes: [mkVar({ codigo: '001', cor: 'Azul', estoqueAnterior: 10, estoque: 0 })] });
    expect(calcularZerados([f]).variacoes).toEqual([
      { familiaId: 'f1', codigoPai: '00000100', titulo: 'FITA EXEMPLO', codigo: '001', cor: 'Azul' },
    ]);
  });

  test('variação já zerada antes (estoqueAnterior 0, estoque 0): não é transição, não entra', () => {
    const f = mkFam({ variacoes: [mkVar({ estoqueAnterior: 0, estoque: 0 })] });
    expect(calcularZerados([f]).variacoes).toEqual([]);
  });

  test('cor nova (estoqueAnterior null) com estoque 0: não conta como transição', () => {
    const f = mkFam({ variacoes: [mkVar({ estoqueAnterior: null, estoque: 0 })] });
    expect(calcularZerados([f]).variacoes).toEqual([]);
  });

  test('variação excluída da publicação: nunca entra, mesmo zerando', () => {
    const f = mkFam({ variacoes: [mkVar({ estoqueAnterior: 10, estoque: 0, excluidaDaPublicacao: true })] });
    expect(calcularZerados([f]).variacoes).toEqual([]);
  });

  test('família com todas as variações incluídas zeradas: entra em `familias`', () => {
    const f = mkFam({
      variacoes: [
        mkVar({ codigo: '001', estoqueAnterior: 10, estoque: 0 }),
        mkVar({ codigo: '002', estoqueAnterior: 5, estoque: 0 }),
      ],
    });
    expect(calcularZerados([f]).familias).toEqual([
      { familiaId: 'f1', codigoPai: '00000100', titulo: 'FITA EXEMPLO' },
    ]);
  });

  test('família com pelo menos 1 cor ainda com estoque: não entra em `familias`', () => {
    const f = mkFam({
      variacoes: [
        mkVar({ codigo: '001', estoqueAnterior: 10, estoque: 0 }),
        mkVar({ codigo: '002', estoque: 5 }),
      ],
    });
    expect(calcularZerados([f]).familias).toEqual([]);
  });

  test('família sem nenhuma variação incluída: não entra em `familias`', () => {
    const f = mkFam({ variacoes: [mkVar({ excluidaDaPublicacao: true, estoque: 0 })] });
    expect(calcularZerados([f]).familias).toEqual([]);
  });

  // N3 (achado da revisão): o relatório é sobre reposição de estoque (conceito de
  // UPDATE); uma família CREATE zerada não é "estoque que zerou numa reposição" e
  // seria semanticamente estranha na seção "Estoque zerado nesta atualização".
  test('família CREATE, mesmo com tudo zerado, não entra no relatório', () => {
    const f = mkFam({
      operacao: 'CREATE', mlItemId: null,
      variacoes: [mkVar({ estoqueAnterior: 10, estoque: 0 })],
    });
    expect(calcularZerados([f])).toEqual({ variacoes: [], familias: [] });
  });

  test('sem nenhuma variação/família zerada: listas vazias', () => {
    const f = mkFam({ variacoes: [mkVar({ estoqueAnterior: 5, estoque: 5 })] });
    expect(calcularZerados([f])).toEqual({ variacoes: [], familias: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- estoque-rapido`
Expected: FAIL — "Failed to resolve import '../estoque-rapido'" (módulo ainda não existe).

- [ ] **Step 3: Write minimal implementation**

Crie `src/lib/estoque-rapido.ts`:

```ts
import { familiaPublicavel, casadaNoMl } from './publicavel';
import type { Familia, Variacao } from './tipos-dominio';

// familiaPublicavel só reprova cor nova INCOMPLETA (sem foto/cor/preço) — uma cor nova
// COMPLETA passa em familiaPublicavel().ok mesmo nunca tendo ido ao ML. Publicá-la
// criaria uma variação nova de verdade, o que o atalho de 1-clique nunca pode fazer
// (ADR-0089: "todas as cores já casadas com o ML"). Por isso, além de familiaPublicavel,
// exigimos que NENHUMA variação incluída seja nova — só cores já casadas (ou dormentes/
// excluídas) entram.
function temCorNovaIncluida(f: Familia): boolean {
  return f.variacoes.some((v) => !v.excluidaDaPublicacao && !casadaNoMl(v));
}

// ADR-0089: famílias elegíveis pro atalho de 1-clique de "Atualização rápida de
// estoque". Reaproveita o critério que já libera o "Selecionar todos" manual da Revisão
// (familiaPublicavel) e adiciona o guard acima contra cor nova completa. CREATE nunca
// entra, mesmo tecnicamente pronto — atalho é só para reposição de estoque de anúncio
// já publicado, nunca para criar conteúdo novo no ML.
export function familiasElegiveisEstoqueRapido(familias: Familia[]): Familia[] {
  return familias.filter(
    (f) => f.operacao === 'UPDATE' && familiaPublicavel(f).ok && !temCorNovaIncluida(f),
  );
}

export interface VariacaoZerada {
  familiaId: string;
  codigoPai: string;
  titulo: string;
  codigo: string;
  cor: string;
}

export interface FamiliaTotalmenteZerada {
  familiaId: string;
  codigoPai: string;
  titulo: string;
}

export interface RelatorioZerados {
  variacoes: VariacaoZerada[];
  familias: FamiliaTotalmenteZerada[];
}

// Zerou NESTA rodada = tinha estoque > 0 antes e virou 0 agora. Cor nova
// (estoqueAnterior null) nunca conta: nunca teve estoque "antes" de fato.
function zerouNestaRodada(v: Variacao): boolean {
  return v.estoqueAnterior != null && v.estoqueAnterior > 0 && v.estoque === 0;
}

// ADR-0089: relatório pós-publicação (rápida ou manual) — variações que zeraram nesta
// rodada + famílias em que TODAS as variações incluídas ficaram com estoque 0 (anúncio
// sem nada vendável). Puramente informativo: não pausa nada automaticamente no ML.
export function calcularZerados(familias: Familia[]): RelatorioZerados {
  const variacoes: VariacaoZerada[] = [];
  const familiasZeradas: FamiliaTotalmenteZerada[] = [];
  // Só UPDATE: o relatório é sobre reposição de estoque; CREATE não é "estoque que
  // zerou numa reposição" (N3).
  for (const f of familias.filter((f) => f.operacao === 'UPDATE')) {
    const incluidas = f.variacoes.filter((v) => !v.excluidaDaPublicacao);
    for (const v of incluidas) {
      if (zerouNestaRodada(v)) {
        variacoes.push({ familiaId: f.id, codigoPai: f.codigoPai, titulo: f.titulo, codigo: v.codigo, cor: v.cor });
      }
    }
    if (incluidas.length > 0 && incluidas.every((v) => v.estoque === 0)) {
      familiasZeradas.push({ familiaId: f.id, codigoPai: f.codigoPai, titulo: f.titulo });
    }
  }
  return { variacoes, familias: familiasZeradas };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- estoque-rapido`
Expected: PASS (19 testes: 10 de `familiasElegiveisEstoqueRapido` + 9 de `calcularZerados`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/publicavel.ts src/lib/estoque-rapido.ts src/lib/__tests__/estoque-rapido.test.ts
git commit -m "feat(estoque): familiasElegiveisEstoqueRapido + calcularZerados (ADR-0089)"
```

---

## Task 2: Gate de 1-clique em `Progresso.tsx`

**Files:**
- Modify: `src/pages/Progresso.tsx`

Hoje o `useEffect` de `Progresso.tsx` navega automaticamente para `/revisao/{loteId}`
assim que todas as famílias ficam `'pronto'`. Precisamos: (1) buscar as famílias
completas (`useFamilias`, com `variacoes`, para poder calcular elegibilidade — o
`useFamiliasResumo` já usado na tela não carrega `variacoes`); (2) só navegar
automaticamente quando NÃO houver elegíveis; (3) quando houver, mostrar o resumo +
botão de confirmação.

- [ ] **Step 1: Importar o necessário**

Em `src/pages/Progresso.tsx`, troque o bloco de imports (linhas 1-10) por:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { useLote } from '@/hooks/useLotes';
import { useFamilias, useFamiliasResumo } from '@/hooks/useFamilias';
import { useLoteRealtime } from '@/hooks/useLoteRealtime';
import { PageHeader } from '@/components/ui/page-header';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { JornadaLote } from '@/components/jornada-lote';
import { totalAnomalias } from '@/lib/tipos-dominio';
import { familiasElegiveisEstoqueRapido } from '@/lib/estoque-rapido';
import { publicarFamilias } from '@/lib/publicar';
import { QK } from '@/lib/queries';
```

- [ ] **Step 2: Buscar famílias completas + calcular elegíveis**

Logo após a linha `const { data: familias = [] } = useFamiliasResumo(loteId, { ... });`
adicione:

```tsx
  // Famílias completas (com variações), só pra calcular elegibilidade do atalho de
  // 1-clique (ADR-0089) — o useFamiliasResumo acima não carrega variacoes. Mesmo
  // polling de fallback do resumo (linha acima): o realtime tem a mesma race condition
  // documentada ali (~1-2s pra subscription estabilizar), e um resumo mais rápido que
  // esta query completa faria o efeito abaixo decidir com `elegiveis` desatualizado.
  const { data: familiasCompletas = [], isSuccess: familiasCompletasCarregadas } = useFamilias(loteId, {
    refetchInterval: polling ? 2500 : undefined,
  });
  const elegiveis = useMemo(
    () => familiasElegiveisEstoqueRapido(familiasCompletas),
    [familiasCompletas],
  );
  const [confirmando, setConfirmando] = useState(false);
  const qc = useQueryClient();
```

- [ ] **Step 3: Não navegar automaticamente quando houver elegíveis**

Troque o `useEffect` existente:

```tsx
  useEffect(() => {
    if (lote?.status === 'revisao' || lote?.status === 'processando') {
      const prontas = familias.filter((f) => f.status === 'pronto').length;
      if (prontas > 0 && prontas === familias.length) {
        nav(`/revisao/${loteId}`);
      }
    }
  }, [lote, familias, loteId, nav]);
```

por:

```tsx
  useEffect(() => {
    if (lote?.status !== 'revisao' && lote?.status !== 'processando') return;
    if (!familiasCompletasCarregadas) return; // espera carregar antes de decidir
    const prontas = familias.filter((f) => f.status === 'pronto').length;
    if (prontas > 0 && prontas === familias.length && elegiveis.length === 0) {
      nav(`/revisao/${loteId}`);
    }
  }, [lote, familias, elegiveis, familiasCompletasCarregadas, loteId, nav]);
```

- [ ] **Step 4: Handler de confirmação**

Depois da declaração de `pct` (`const pct = total > 0 ? Math.round((prontas / total) * 100) : 0;`), adicione:

```tsx
  const prontasCount = familias.filter((f) => f.status === 'pronto').length;
  const mostrarGateEstoqueRapido =
    (lote.status === 'revisao' || lote.status === 'processando') &&
    prontasCount > 0 &&
    prontasCount === familias.length &&
    elegiveis.length > 0;

  async function confirmarEstoqueRapido() {
    if (!loteId) return;
    setConfirmando(true);
    try {
      await publicarFamilias(
        elegiveis.map((f) => f.id),
        'gold_special',
        ['mercado_livre'],
        { somenteEstoqueGlobal: true },
      );
      qc.invalidateQueries({ queryKey: QK.familias(loteId) });
      qc.invalidateQueries({ queryKey: QK.lote(loteId) });
      toast.success(`${elegiveis.length} família(s) enfileirada(s) para atualização de estoque`, {
        description: 'Acompanhe o andamento no relatório.',
      });
      nav(`/relatorio/${loteId}`);
    } catch (e) {
      toast.error('Falha ao enfileirar a atualização de estoque', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setConfirmando(false);
    }
  }
```

Nota: `total`/`prontas`/`pct` continuam existindo como hoje (não remover); `prontasCount`
é uma variável nova (mesmo cálculo de `prontas` do efeito, mas em escopo do render).

- [ ] **Step 5: Renderizar o gate**

No JSX, logo depois do bloco `<JornadaLote status={lote.status} />` (e antes do bloco
`{temAnomalias && (`), insira:

```tsx
      {mostrarGateEstoqueRapido && (
        <div className="mb-4 space-y-3 rounded-lg border border-info/30 bg-info/5 px-4 py-3">
          <p className="text-sm font-medium">
            {elegiveis.length} família(s) prontas para atualizar estoque no Mercado
            Livre — sem alterar preço, foto ou criar cor nova.
          </p>
          <div className="flex gap-2">
            <Button onClick={confirmarEstoqueRapido} disabled={confirmando}>
              {confirmando ? 'Atualizando…' : `Atualizar estoque (${elegiveis.length})`}
            </Button>
            <Button variant="outline" onClick={() => nav(`/revisao/${loteId}`)} disabled={confirmando}>
              Revisar manualmente
            </Button>
          </div>
        </div>
      )}
```

- [ ] **Step 6: Verificar build + lint + testes**

Run: `pnpm build && pnpm lint && pnpm test -- estoque-rapido`
Expected: build sem erros de tipo; lint 0 errors; testes da Task 1 continuam passando.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Progresso.tsx
git commit -m "feat(progresso): gate de 1-clique p/ atualização rápida de estoque (ADR-0089)"
```

---

## Task 3: Seção de zerados em `Relatorio.tsx`

**Files:**
- Modify: `src/pages/Relatorio.tsx`

- [ ] **Step 1: Importar o necessário**

No topo de `src/pages/Relatorio.tsx`, troque:

```tsx
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useLote } from '@/hooks/useLotes';
import { useFamiliasResumo } from '@/hooks/useFamilias';
import { useLoteRealtime } from '@/hooks/useLoteRealtime';
```

por:

```tsx
import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useLote } from '@/hooks/useLotes';
import { useFamilias, useFamiliasResumo } from '@/hooks/useFamilias';
import { useLoteRealtime } from '@/hooks/useLoteRealtime';
import { calcularZerados } from '@/lib/estoque-rapido';
```

- [ ] **Step 2: Buscar famílias completas + calcular zerados**

Logo após o bloco `const { data: familias = [] } = useFamiliasResumo(loteId, { ... });`
(fecha com `});`), adicione:

```tsx
  // Famílias completas (com variações + estoqueAnterior), só pra calcular o relatório
  // de zerados (ADR-0089) — o useFamiliasResumo acima não carrega variacoes.
  const { data: familiasCompletas = [] } = useFamilias(loteId);
  const zerados = useMemo(() => calcularZerados(familiasCompletas), [familiasCompletas]);
```

- [ ] **Step 3: Renderizar a seção**

Logo depois do bloco `<JornadaLote status={lote.status} />` (fecha com `</div>`), antes
de `{publicando && (`, insira:

```tsx
      {(zerados.variacoes.length > 0 || zerados.familias.length > 0) && (
        <div className="mb-6 space-y-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Estoque zerado nesta atualização
          </p>
          {zerados.variacoes.length > 0 && (
            <div>
              <p className="text-muted-foreground">
                {zerados.variacoes.length} variação(ões) zeraram:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {zerados.variacoes.map((v) => (
                  <li key={`${v.familiaId}-${v.codigo}`}>
                    {v.codigoPai} — {v.titulo} · {v.cor} ({v.codigo})
                  </li>
                ))}
              </ul>
            </div>
          )}
          {zerados.familias.length > 0 && (
            <div>
              <p className="text-muted-foreground">
                {zerados.familias.length} anúncio(s) sem nada vendável (todas as variações zeradas):
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {zerados.familias.map((f) => (
                  <li key={f.familiaId}>{f.codigoPai} — {f.titulo}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 4: Verificar build + lint + testes**

Run: `pnpm build && pnpm lint && pnpm test -- estoque-rapido`
Expected: build sem erros; lint 0 errors; testes da Task 1 passando.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Relatorio.tsx
git commit -m "feat(relatorio): seção de estoque zerado nesta rodada (ADR-0089)"
```

---

## Verificação final (após as 3 tasks)

- [ ] Suíte completa: `pnpm test` — todos verdes (existentes + 19 novos).
- [ ] `pnpm build && pnpm lint` — limpos.
- [ ] Conferência manual: subir um lote com famílias `UPDATE` já publicadas (planilha
  sem imagens) → gate aparece em Progresso com a contagem certa → confirmar → cai no
  Relatório com o status de publicação e, se algo zerou, a seção de zerados.
- [ ] Conferência manual: lote com família `UPDATE` trazendo cor nova com estoque > 0
  e sem foto → essa família NÃO entra no gate (fica de fora da contagem) e segue
  normalmente para a Revisão manual.
- [ ] Conferência manual (achado da revisão, B1): lote com família `UPDATE` trazendo
  cor nova já **completa** (upload de foto feito numa Revisão anterior, preço definido,
  estoque > 0, mas ainda não publicada no ML) → essa família também NÃO entra no gate,
  mesmo estando tecnicamente "pronta" — precisa continuar exigindo confirmação manual
  porque publicá-la criaria uma variação nova no anúncio.
- [ ] Conferência manual: lote 100% `CREATE` → gate nunca aparece, comportamento igual
  ao atual (navega direto pra Revisão).

---

## Cobertura da ADR-0089 (self-review)

- Decisão 1 (gate 1-clique em Progresso) → Task 2.
- Decisão 2 (restrito a UPDATE, nunca CREATE) → Task 1 (`familiasElegiveisEstoqueRapido`) + teste dedicado.
- Decisão 3 (preço sempre ignorado) → Task 2, `somenteEstoqueGlobal: true` hardcoded na chamada.
- Decisão 4 (critério reaproveita `familiaPublicavel`, cor nova com/sem estoque, **e nunca cor nova mesmo completa**) → Task 1, testes cobrindo os três casos.
- Decisão 5 (relatório de zerados, por variação e por família, só UPDATE) → Task 1 (`calcularZerados`) + Task 3 (renderização).
- Nenhuma mudança de backend/schema/edge — coerente com a ADR. Único ajuste em código existente é 1 linha em `publicavel.ts` (exportar `casadaNoMl`), sem mudar comportamento.

**Placeholder scan:** nenhum "TBD"/"tratar depois" — toda task tem código completo e comando de verificação.
**Type/signature consistency:** `familiasElegiveisEstoqueRapido(familias: Familia[]): Familia[]` e `calcularZerados(familias: Familia[]): RelatorioZerados` são as únicas interfaces cruzando tasks; Task 2 e Task 3 as consomem exatamente como definidas na Task 1.

### Revisão adversarial (Fable 5)

O plano foi revisado por um segundo modelo (Fable 5) antes de fechar. Achados e como
foram tratados:

- **B1 (bloqueador, corrigido):** o critério original (`familiaPublicavel` sozinho) só
  reprova cor nova *incompleta* — uma cor nova completa (foto+preço+estoque) passaria e
  o 1-clique criaria variação nova no ML sem revisão, contradizendo a ADR. Corrigido
  com `temCorNovaIncluida`/`casadaNoMl` (Step 0 + implementação da Task 1) + teste
  dedicado.
- **I1 (importante, corrigido):** `useFamilias` sem polling podia ficar dessincronizado
  do `useFamiliasResumo` (que já tem fallback de polling por uma race documentada do
  realtime), fazendo o gate nunca aparecer ou contar errado. Corrigido: mesmo
  `refetchInterval` nos dois hooks (Task 2, Step 2).
- **I2 (importante, corrigido):** faltavam testes de segurança (atributo obrigatório
  faltando, família sem `ml_item_id`, status `erro`). Adicionados à Task 1.
- **N1 (aceito como está):** família não-elegível que sobra no lote depende do
  `lote.status` voltar a `'revisao'` (comportamento de backend já existente,
  `publicavel.ts:135-137`) e do operador chegar lá via `destinoDoLote`/card do
  Dashboard — padrão já usado pelo app, sem link direto novo no Relatório. Não é lacuna
  deste plano.
- **N2 (corrigido):** contagem de testes no plano ajustada de 16 para 19 (10 + 9).
- **N3 (corrigido):** `calcularZerados` agora filtra `operacao === 'UPDATE'` — família
  `CREATE` nunca entra no relatório de "estoque zerado nesta atualização".
