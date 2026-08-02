# Redesenho da tela de Estoque — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a listagem de Estoque de `<table>` por cards com miniatura, busca que acha GTIN/fornecedor, filtros confiáveis e um cadastro preenchível — eliminando o scroll horizontal pela raiz.

**Architecture:** Nenhuma tabela HTML sobra no caminho do painel expandido — é isso que torna o estouro de largura estruturalmente impossível, em vez de remendado. A lógica de filtro sai para função pura testável; a UI vira cards. Só um `select` muda no acesso a dados; nenhuma edge, migration ou RLS é tocada.

**Tech Stack:** React 19 + TypeScript, TanStack Query v5, Tailwind v4, shadcn/ui, Vitest + Testing Library, Supabase JS.

## Global Constraints

- **Entrega 100% frontend.** Nenhuma alteração em `supabase/functions/**`, `supabase/migrations/**` ou RLS. Se alguma task parecer exigir isso, pare e reporte — é sinal de que a spec errou.
- **A foto não participa do enriquecimento por IA** (decisão §8.2 da spec, opção A). Não prometer isso na UI.
- **`agruparProdutosComSaldo` não muda de lógica.** Só copia campos novos. O corte "família mais recente" e `buscarTodasPaginas` são invariantes de correção de saldo.
- **Nada de ajuste manual de saldo.** Cortado no ADR-0094.
- **Design system:** usar `StatusPill`, `Section`, `EmptyState`, `Skeleton`, `Tabs`, `CanalBadge`, `FotoCapaFamilia` já existentes. Tokens semânticos (`success`/`warning`/`danger`/`info`), nunca cor literal.
- **Toda task termina com `pnpm lint` e `pnpm test` verdes.** Nenhum `test.skip`, nenhum TODO.
- **Idioma:** UI e mensagens em português, com acentuação correta.
- Spec de referência: `docs/superpowers/specs/2026-08-01-estoque-redesign-design.md`.

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `src/lib/produtos-saldo.ts` | acesso a dados + tipos | modificar (select e tipos) |
| `src/lib/produtos-saldo-filtro.ts` | busca, filtro e ordenação (puro) | criar |
| `src/lib/__tests__/produtos-saldo-filtro.test.ts` | testes do filtro | criar |
| `src/components/foto-capa-familia.tsx` | miniatura + placeholder | modificar (`onError`) |
| `src/components/movimentos-estoque.tsx` | trilha de auditoria | modificar (sai a `<table>`) |
| `src/components/estoque/produto-card.tsx` | linha de produto + painel | criar |
| `src/components/estoque/variacao-estoque-card.tsx` | card de variação | criar |
| `src/components/estoque/barra-filtros-estoque.tsx` | busca, filtro, ordenação | criar |
| `src/components/estoque/linha-variacao-form.tsx` | card de variação no cadastro | criar |
| `src/pages/Estoque.tsx` | composição da página | modificar |
| `src/components/estoque/dialog-entrada.tsx` | entrada de mercadoria | modificar (`filtroInicial`) |
| `src/components/estoque/dialog-cadastro-produto.tsx` | cadastro | modificar (cards, fotos, travas) |
| `tests/pages/Publicados.test.tsx` | guarda da regressão | modificar |

---

### Task 1: Dados — campos novos no select e nos tipos

**Files:**
- Modify: `src/lib/produtos-saldo.ts:8-27` (tipos), `:53-57` (cópia no agrupamento), `:69-73` (select)
- Test: `src/lib/__tests__/produtos-saldo.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `VariacaoComSaldo.imagemPath: string | null`; `ProdutoComSaldo.capaStoragePath: string | null`, `.fornecedor: string | null`, `.unidade: string | null`, `.origem: string`, `.mlItemId: string | null`, `.criadoEm: string`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescente ao final de `src/lib/__tests__/produtos-saldo.test.ts` (siga o estilo de montagem de linhas que já existe no arquivo):

```ts
it('copia os campos novos da família e da variação para o produto agrupado', () => {
  const linhas = [{
    codigo: '00000002', nome: null, cor: 'azul', gtin: '789', estoque: 5,
    custo: 10, preco: 20, peso_gramas: null, altura_cm: null, largura_cm: null,
    comprimento_cm: null, imagem_path: 'org/lote/00000002.jpg',
    familias: {
      codigo_pai: '00000001', nome_pai: 'Camiseta', descricao_pai: null,
      criado_em: '2026-08-01T10:00:00Z', capa_storage_path: 'org/lote/capa.jpg',
      fornecedor: 'Fornecedor X', unidade: 'UN', origem: 'nacional',
      ml_item_id: 'MLB123',
    },
  }];
  const [p] = agruparProdutosComSaldo(linhas as never);
  expect(p.capaStoragePath).toBe('org/lote/capa.jpg');
  expect(p.fornecedor).toBe('Fornecedor X');
  expect(p.unidade).toBe('UN');
  expect(p.origem).toBe('nacional');
  expect(p.mlItemId).toBe('MLB123');
  expect(p.criadoEm).toBe('2026-08-01T10:00:00Z');
  expect(p.variacoes[0].imagemPath).toBe('org/lote/00000002.jpg');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test -- produtos-saldo`
Expected: FAIL — as propriedades vêm `undefined`.

- [ ] **Step 3: Ampliar os tipos**

Em `src/lib/produtos-saldo.ts`, acrescente aos tipos existentes (não remova nada):

```ts
export interface LinhaVariacaoCrua {
  // ...campos atuais...
  imagem_path: string | null;
  familias: {
    codigo_pai: string; nome_pai: string; descricao_pai: string | null; criado_em: string;
    capa_storage_path: string | null; fornecedor: string | null;
    unidade: string | null; origem: string; ml_item_id: string | null;
  } | null;
}

export interface VariacaoComSaldo {
  // ...campos atuais...
  imagemPath: string | null;
}

export interface ProdutoComSaldo {
  // ...campos atuais...
  capaStoragePath: string | null;
  fornecedor: string | null;
  unidade: string | null;
  origem: string;
  /** Fonte CANÔNICA de "publicado no ML". `anuncios_externos` é espelho best-effort e pode
   *  estar furado (espelhar.ts:117 só loga a falha) — ver §3.4 da spec. */
  mlItemId: string | null;
  criadoEm: string;
}
```

- [ ] **Step 4: Preencher no agrupamento**

Em `agruparProdutosComSaldo`, no `porPai.set(...)` (linha ~50), acrescente os campos da família; no `p.variacoes.push({...})`, acrescente `imagemPath: l.imagem_path`:

```ts
porPai.set(pai, {
  codigoPai: pai, nomePai: f.nome_pai, descricaoPai: f.descricao_pai,
  variacoes: [], saldoTotal: 0,
  capaStoragePath: f.capa_storage_path, fornecedor: f.fornecedor,
  unidade: f.unidade, origem: f.origem, mlItemId: f.ml_item_id,
  criadoEm: f.criado_em,
});
```

- [ ] **Step 5: Ampliar o select**

Substitua a string do `.select()` em `fetchProdutosComSaldo`:

```ts
.select('codigo, nome, cor, gtin, estoque, custo, preco, peso_gramas, altura_cm, largura_cm, comprimento_cm, imagem_path, familias!inner(codigo_pai, nome_pai, descricao_pai, criado_em, capa_storage_path, fornecedor, unidade, origem, ml_item_id)')
```

- [ ] **Step 6: Rodar os testes**

Run: `pnpm test -- produtos-saldo && pnpm lint`
Expected: PASS. Os testes antigos de agrupamento continuam verdes sem edição — se algum quebrou, a lógica foi alterada indevidamente.

- [ ] **Step 7: Commit**

```bash
git add src/lib/produtos-saldo.ts src/lib/__tests__/produtos-saldo.test.ts
git commit -m "feat(estoque): carrega foto, fornecedor, origem e ml_item_id no saldo por produto"
```

---

### Task 2: Filtro, busca e ordenação como função pura

**Files:**
- Create: `src/lib/produtos-saldo-filtro.ts`, `src/lib/__tests__/produtos-saldo-filtro.test.ts`

**Interfaces:**
- Consumes: `ProdutoComSaldo` da Task 1.
- Produces: `type FiltroEstoque = 'todos' | 'sem-estoque' | 'nao-publicado'`; `type OrdemEstoque = 'nome' | 'saldo-asc' | 'recente'`; `filtrarProdutos(produtos, opts): ProdutoComSaldo[]` com `opts: { termo: string; filtro: FiltroEstoque; ordem: OrdemEstoque; canaisPorProduto: Map<string, string[]> | undefined }`; `produtoPublicado(p, canais): boolean`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `src/lib/__tests__/produtos-saldo-filtro.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { filtrarProdutos, type FiltroEstoque } from '../produtos-saldo-filtro';
import type { ProdutoComSaldo } from '../produtos-saldo';

function produto(over: Partial<ProdutoComSaldo> = {}): ProdutoComSaldo {
  return {
    codigoPai: '00000001', nomePai: 'Protetor Solar', descricaoPai: null,
    capaStoragePath: null, fornecedor: 'Eucerin', unidade: 'UN',
    origem: 'nacional', mlItemId: null, criadoEm: '2026-08-01T10:00:00Z',
    saldoTotal: 20,
    variacoes: [{
      codigo: '00000002', nome: null, cor: 'incolor', gtin: '4005800241901',
      estoque: 20, custo: 10, preco: 20, pesoGramas: null, alturaCm: null,
      larguraCm: null, comprimentoCm: null, imagemPath: null,
    }],
    ...over,
  };
}

const base = { filtro: 'todos' as FiltroEstoque, ordem: 'nome' as const, canaisPorProduto: new Map() };

describe('filtrarProdutos — busca', () => {
  it('acha pelo GTIN da variação', () => {
    expect(filtrarProdutos([produto()], { ...base, termo: '4005800241901' })).toHaveLength(1);
  });

  it('acha pelo fornecedor', () => {
    expect(filtrarProdutos([produto()], { ...base, termo: 'eucerin' })).toHaveLength(1);
  });

  it('acha pela cor da variação', () => {
    expect(filtrarProdutos([produto()], { ...base, termo: 'incolor' })).toHaveLength(1);
  });

  it('ignora acento e caixa', () => {
    const p = produto({ nomePai: 'Loção Hidratante' });
    expect(filtrarProdutos([p], { ...base, termo: 'LOCAO' })).toHaveLength(1);
  });

  it('não acha o que não existe', () => {
    expect(filtrarProdutos([produto()], { ...base, termo: 'inexistente' })).toHaveLength(0);
  });
});

describe('filtrarProdutos — sem-estoque', () => {
  it('inclui saldo zero E saldo negativo', () => {
    const lista = [produto({ saldoTotal: 0 }), produto({ codigoPai: 'X', saldoTotal: -3 }), produto({ codigoPai: 'Y', saldoTotal: 5 })];
    const r = filtrarProdutos(lista, { ...base, termo: '', filtro: 'sem-estoque' });
    expect(r.map((p) => p.saldoTotal).sort()).toEqual([-3, 0]);
  });
});

describe('filtrarProdutos — nao-publicado', () => {
  const semCanal = produto();

  it('exclui quem tem canal no espelho', () => {
    const canais = new Map([['00000001', ['mercado_livre']]]);
    const r = filtrarProdutos([semCanal], { ...base, termo: '', filtro: 'nao-publicado', canaisPorProduto: canais });
    expect(r).toHaveLength(0);
  });

  it('inclui quem não tem canal nem ml_item_id', () => {
    const r = filtrarProdutos([semCanal], { ...base, termo: '', filtro: 'nao-publicado' });
    expect(r).toHaveLength(1);
  });

  // A guarda do defeito mais grave da spec (§3.4): anuncios_externos é espelho best-effort.
  it('NÃO marca como não publicado quem tem ml_item_id mas não tem linha no espelho', () => {
    const p = produto({ mlItemId: 'MLB123' });
    const r = filtrarProdutos([p], { ...base, termo: '', filtro: 'nao-publicado' });
    expect(r).toHaveLength(0);
  });

  it('com canaisPorProduto undefined não devolve tudo como não publicado', () => {
    const r = filtrarProdutos([semCanal], { ...base, termo: '', filtro: 'nao-publicado', canaisPorProduto: undefined });
    expect(r).toHaveLength(0);
  });
});

describe('filtrarProdutos — ordenação', () => {
  const a = produto({ codigoPai: 'A', nomePai: 'Zinco', saldoTotal: 1, criadoEm: '2026-01-01T00:00:00Z' });
  const b = produto({ codigoPai: 'B', nomePai: 'Abacate', saldoTotal: 9, criadoEm: '2026-08-01T00:00:00Z' });

  it('nome ordena alfabeticamente em pt-BR', () => {
    expect(filtrarProdutos([a, b], { ...base, termo: '', ordem: 'nome' }).map((p) => p.nomePai)).toEqual(['Abacate', 'Zinco']);
  });

  it('saldo-asc põe o menor saldo primeiro', () => {
    expect(filtrarProdutos([b, a], { ...base, termo: '', ordem: 'saldo-asc' }).map((p) => p.saldoTotal)).toEqual([1, 9]);
  });

  it('recente põe o mais novo primeiro', () => {
    expect(filtrarProdutos([a, b], { ...base, termo: '', ordem: 'recente' }).map((p) => p.codigoPai)).toEqual(['B', 'A']);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test -- produtos-saldo-filtro`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Crie `src/lib/produtos-saldo-filtro.ts`:

```ts
// Busca, filtro e ordenação da tela Estoque. Função pura de propósito: é a única parte da tela
// que decide o que o operador vê, e precisa ser testável sem render.
import type { ProdutoComSaldo } from '@/lib/produtos-saldo';

export type FiltroEstoque = 'todos' | 'sem-estoque' | 'nao-publicado';
export type OrdemEstoque = 'nome' | 'saldo-asc' | 'recente';

export interface OpcoesFiltro {
  termo: string;
  filtro: FiltroEstoque;
  ordem: OrdemEstoque;
  /** `undefined` = query de canais não carregou/falhou. NUNCA tratar como "sem canal": isso
   *  classificaria o catálogo inteiro como não publicado. */
  canaisPorProduto: Map<string, string[]> | undefined;
}

const normalizar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * Publicado = tem `ml_item_id` (fonte canônica, a mesma de `fetchPublicados`) OU aparece no
 * espelho `anuncios_externos` com algum canal. O espelho sozinho não serve: seu upsert falha
 * apenas com console.error (`_shared/anuncios/espelhar.ts:117`) sem desfazer a publicação, então
 * produto publicado de verdade pode não ter linha lá.
 */
export function produtoPublicado(p: ProdutoComSaldo, canais: Map<string, string[]> | undefined): boolean {
  if (p.mlItemId != null) return true;
  return (canais?.get(p.codigoPai)?.length ?? 0) > 0;
}

function casaTermo(p: ProdutoComSaldo, termo: string): boolean {
  const alvos = [p.nomePai, p.codigoPai, p.fornecedor ?? ''];
  for (const v of p.variacoes) alvos.push(v.codigo, v.gtin ?? '', v.cor ?? '', v.nome ?? '');
  return alvos.some((a) => normalizar(a).includes(termo));
}

export function filtrarProdutos(produtos: ProdutoComSaldo[], opts: OpcoesFiltro): ProdutoComSaldo[] {
  const termo = normalizar(opts.termo.trim());

  const lista = produtos.filter((p) => {
    if (termo && !casaTermo(p, termo)) return false;
    // <= 0, não === 0: saldo negativo é sintoma de bug de ledger e precisa ser ENCONTRÁVEL.
    if (opts.filtro === 'sem-estoque') return p.saldoTotal <= 0;
    if (opts.filtro === 'nao-publicado') return !produtoPublicado(p, opts.canaisPorProduto);
    return true;
  });

  const ordenada = [...lista];
  if (opts.ordem === 'saldo-asc') ordenada.sort((a, b) => a.saldoTotal - b.saldoTotal);
  else if (opts.ordem === 'recente') ordenada.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  else ordenada.sort((a, b) => a.nomePai.localeCompare(b.nomePai, 'pt-BR'));
  return ordenada;
}
```

- [ ] **Step 4: Rodar os testes**

Run: `pnpm test -- produtos-saldo-filtro && pnpm lint`
Expected: PASS (14 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/produtos-saldo-filtro.ts src/lib/__tests__/produtos-saldo-filtro.test.ts
git commit -m "feat(estoque): busca por GTIN/fornecedor/cor e filtros com fonte canonica de publicado"
```

---

### Task 3: Miniatura que não quebra quando a imagem falha

**Files:**
- Modify: `src/components/foto-capa-familia.tsx:23-29`
- Test: `src/components/__tests__/foto-capa-familia.test.tsx` (criar)

**Interfaces:**
- Consumes: nada.
- Produces: `FotoCapaFamilia` cai no placeholder também quando o `<img>` dispara `onError`. Assinatura de props inalterada — os consumidores atuais (`familia-expanded.tsx`) não mudam.

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/components/__tests__/foto-capa-familia.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FotoCapaFamilia } from '../foto-capa-familia';

describe('FotoCapaFamilia', () => {
  it('sem url mostra o placeholder', () => {
    render(<FotoCapaFamilia capaUrl={null} tamanho="small" />);
    expect(screen.getByTestId('capa-placeholder')).toBeInTheDocument();
  });

  // Arquivo apagado do bucket ou URL assinada expirada: o card não pode ficar com imagem
  // quebrada — cai no mesmo placeholder do caso "sem foto".
  it('imagem que falha ao carregar cai no placeholder', () => {
    render(<FotoCapaFamilia capaUrl="https://exemplo.invalido/foto.jpg" tamanho="small" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByTestId('capa-placeholder')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test -- foto-capa-familia`
Expected: FAIL no segundo teste — o `<img>` permanece montado.

- [ ] **Step 3: Implementar**

Reescreva `src/components/foto-capa-familia.tsx` mantendo as constantes de classe:

```tsx
import { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';

interface Props {
  capaUrl: string | null;
  tamanho: 'small' | 'medium' | 'large';
}

const CLASSE_FOTO = { small: 'h-10 w-10', medium: 'h-20 w-20', large: 'h-48 w-48' } as const;
const CLASSE_ICONE = { small: 'h-4 w-4', medium: 'h-6 w-6', large: 'h-8 w-8' } as const;

export function FotoCapaFamilia({ capaUrl, tamanho }: Props) {
  const classe = CLASSE_FOTO[tamanho];
  const [falhou, setFalhou] = useState(false);

  // URL nova (troca de foto) merece nova chance de carregar.
  useEffect(() => { setFalhou(false); }, [capaUrl]);

  if (!capaUrl || falhou) {
    return (
      <div
        data-testid="capa-placeholder"
        className={`${classe} flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground`}
      >
        <ImageIcon className={CLASSE_ICONE[tamanho]} />
      </div>
    );
  }
  return (
    <img
      src={capaUrl}
      alt="Capa da família"
      onError={() => setFalhou(true)}
      className={`${classe} shrink-0 rounded-md object-cover`}
    />
  );
}
```

- [ ] **Step 4: Rodar os testes**

Run: `pnpm test -- foto-capa && pnpm lint`
Expected: PASS. Rode também `pnpm test -- familia-expanded` se existir, para conferir o outro consumidor.

- [ ] **Step 5: Commit**

```bash
git add src/components/foto-capa-familia.tsx src/components/__tests__/foto-capa-familia.test.tsx
git commit -m "fix(ui): foto que falha ao carregar cai no placeholder em vez de quebrar"
```

---

### Task 4: Movimentos de estoque sem `<table>` (corrige Estoque e Publicados)

**Files:**
- Modify: `src/components/movimentos-estoque.tsx:52-90`
- Modify: `tests/pages/Publicados.test.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: `MovimentosEstoque` com as mesmas props (`codigoPai`, `ativo`). Nenhum `<table>` no DOM que ele renderiza.

**Contexto:** este componente tem dois consumidores — `Estoque.tsx:118` e `Publicados.tsx:359` — e nos dois ele vive dentro de um `<TableCell>`. É a tabela aninhada dele que estoura a largura das duas telas.

- [ ] **Step 1: Escrever o teste de regressão em Publicados**

Em `tests/pages/Publicados.test.tsx`, o mock atual de `useFamilia` devolve `data: undefined`, e `Publicados.tsx:342` só monta os movimentos quando a família carrega — por isso `MovimentosEstoque` nunca renderiza nos testes atuais. Acrescente um bloco com a família carregada:

```tsx
describe('Publicados — trilha de movimentos no painel expandido', () => {
  it('exibe os movimentos sem usar <table>', async () => {
    // Ajuste o mock de useFamilia deste bloco para devolver uma família carregada
    // (mesma forma que o restante do arquivo usa) e o de fetchMovimentosEstoque para:
    //   [{ id: 'm1', codigo: '00000005', motivo: 'entrada', quantidade: 10,
    //      estoque_resultante: 10, criado_em: '2026-08-01T05:11:00Z',
    //      canal_origem: null, documento: 'NF 1234', quantidade_pedida: null }]
    const user = userEvent.setup();
    renderPublicados();
    await user.click(screen.getByRole('button', { name: 'Expandir análise' }));

    expect(await screen.findByText('00000005')).toBeInTheDocument();
    expect(screen.getByText(/NF 1234/)).toBeInTheDocument();
    const painel = screen.getByText('Movimentos de estoque').closest('div')!;
    expect(painel.querySelector('table')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test -- Publicados`
Expected: FAIL no `expect(painel.querySelector('table')).toBeNull()` — a tabela ainda existe.

- [ ] **Step 3: Substituir a tabela por linhas flex**

Em `src/components/movimentos-estoque.tsx`, troque o bloco `<div className="overflow-x-auto">…</table></div>` por:

```tsx
<ul className="flex flex-col gap-1.5">
  {data.map((m) => (
    <li
      key={m.id}
      className="flex flex-col gap-1 border-t border-border/50 py-1.5 text-xs sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="tabular-nums text-muted-foreground">{fmtDataHora(m.criado_em)}</span>
        <span className="font-mono">{m.codigo}</span>
        <span className="min-w-0">
          {rotuloMotivo(m.motivo)}
          {/* Vendeu mais do que havia: o saldo parou em 0 e o pedido real fica visível. */}
          {m.quantidade_pedida != null && Math.abs(m.quantidade) !== m.quantidade_pedida && (
            <span className="ml-1 text-destructive">(pedido de {m.quantidade_pedida})</span>
          )}
          {m.documento && <span className="ml-1 text-muted-foreground">· {m.documento}</span>}
        </span>
      </div>
      <div className="flex shrink-0 items-baseline gap-3">
        <Delta m={m} />
        <span className="tabular-nums">
          {m.estoque_resultante != null ? m.estoque_resultante : '—'}
        </span>
        <span className="text-muted-foreground">{m.canal_origem ?? '—'}</span>
      </div>
    </li>
  ))}
</ul>
```

Nada mais muda: `fetchMovimentosEstoque`, `rotuloMotivo`, `movimentoInformativo`, `Delta` e `fmtDataHora` ficam como estão. Os campos `quantidade_pedida` e `documento` são rastro de auditoria — se sumirem, a task falhou.

- [ ] **Step 4: Rodar os testes**

Run: `pnpm test -- Publicados && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/movimentos-estoque.tsx tests/pages/Publicados.test.tsx
git commit -m "fix(estoque): movimentos sem tabela aninhada - corrige o scroll horizontal em Estoque e Publicados"
```

---

### Task 5: Card de variação

**Files:**
- Create: `src/components/estoque/variacao-estoque-card.tsx`
- Test: `src/components/estoque/__tests__/variacao-estoque-card.test.tsx`

**Interfaces:**
- Consumes: `VariacaoComSaldo` (Task 1), `useImageUrl` de `@/hooks/useImageUrl`, `FotoCapaFamilia` (Task 3).
- Produces: `<VariacaoEstoqueCard variacao={v} />`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/components/estoque/__tests__/variacao-estoque-card.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VariacaoEstoqueCard } from '../variacao-estoque-card';
import type { VariacaoComSaldo } from '@/lib/produtos-saldo';

vi.mock('@/hooks/useImageUrl', () => ({ useImageUrl: () => ({ data: null, isError: false }) }));

function variacao(over: Partial<VariacaoComSaldo> = {}): VariacaoComSaldo {
  return {
    codigo: '00000005', nome: null, cor: 'incolor', gtin: '4005800241901',
    estoque: 20, custo: 12, preco: 89.9, pesoGramas: 200,
    alturaCm: 10, larguraCm: 20, comprimentoCm: 30, imagemPath: null, ...over,
  };
}

describe('VariacaoEstoqueCard', () => {
  it('mostra SKU, cor, GTIN e dimensões', () => {
    render(<VariacaoEstoqueCard variacao={variacao()} />);
    expect(screen.getByText('00000005')).toBeInTheDocument();
    expect(screen.getByText('incolor')).toBeInTheDocument();
    expect(screen.getByText(/4005800241901/)).toBeInTheDocument();
    expect(screen.getByText(/200g · 10×20×30cm/)).toBeInTheDocument();
  });

  it('saldo zero recebe aviso de sem estoque', () => {
    render(<VariacaoEstoqueCard variacao={variacao({ estoque: 0 })} />);
    expect(screen.getByText('sem estoque')).toBeInTheDocument();
  });

  // Saldo negativo é bug de ledger, não "acabou o estoque": precisa de rótulo próprio.
  it('saldo negativo recebe rótulo de inconsistência', () => {
    render(<VariacaoEstoqueCard variacao={variacao({ estoque: -3 })} />);
    expect(screen.getByText('saldo inconsistente')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test -- variacao-estoque-card`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Crie `src/components/estoque/variacao-estoque-card.tsx`:

```tsx
// Card de variação da tela Estoque. Substitui a linha de 7 colunas: nada aqui pode ter largura
// dirigida por conteúdo, senão volta o estouro de largura que motivou o redesenho.
import { FotoCapaFamilia } from '@/components/foto-capa-familia';
import { StatusPill } from '@/components/ui/status-pill';
import { useImageUrl } from '@/hooks/useImageUrl';
import { fmtBRL } from '@/lib/formato';
import type { VariacaoComSaldo } from '@/lib/produtos-saldo';

/** "200g · 10×20×30cm", só as partes informadas. "—" se nada foi preenchido. */
function rotuloDimensoes(v: VariacaoComSaldo): string {
  const partes: string[] = [];
  if (v.pesoGramas != null) partes.push(`${v.pesoGramas}g`);
  const { alturaCm: a, larguraCm: l, comprimentoCm: c } = v;
  if (a != null || l != null || c != null) partes.push(`${a ?? '—'}×${l ?? '—'}×${c ?? '—'}cm`);
  return partes.length > 0 ? partes.join(' · ') : '—';
}

export function PillSaldo({ saldo }: { saldo: number }) {
  if (saldo > 0) return null;
  return saldo < 0
    ? <StatusPill tone="danger">saldo inconsistente</StatusPill>
    : <StatusPill tone="warning">sem estoque</StatusPill>;
}

export function VariacaoEstoqueCard({ variacao: v }: { variacao: VariacaoComSaldo }) {
  const { data: url } = useImageUrl(v.imagemPath);

  return (
    <div className="flex min-w-0 gap-3 rounded-lg border bg-background p-3">
      <FotoCapaFamilia capaUrl={url ?? null} tamanho="small" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-mono font-medium">{v.codigo}</span>
          <span className="shrink-0 tabular-nums font-medium">{v.estoque}</span>
        </div>
        <span className="truncate text-muted-foreground">{v.cor ?? v.nome ?? '—'}</span>
        <span className="truncate text-muted-foreground">GTIN {v.gtin ?? '—'}</span>
        <span className="truncate text-muted-foreground">{rotuloDimensoes(v)}</span>
        <span className="truncate text-muted-foreground">
          custo {v.custo != null ? fmtBRL(Number(v.custo)) : '—'} · preço {fmtBRL(Number(v.preco))}
        </span>
        <PillSaldo saldo={v.estoque} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rodar os testes**

Run: `pnpm test -- variacao-estoque-card && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/estoque/variacao-estoque-card.tsx src/components/estoque/__tests__/variacao-estoque-card.test.tsx
git commit -m "feat(estoque): card de variacao com miniatura e pill de saldo"
```

---

### Task 6: Card de produto com painel em abas

**Files:**
- Create: `src/components/estoque/produto-card.tsx`
- Test: `src/components/estoque/__tests__/produto-card.test.tsx`

**Interfaces:**
- Consumes: `ProdutoComSaldo` (Task 1), `VariacaoEstoqueCard` e `PillSaldo` (Task 5), `MovimentosEstoque` (Task 4), `CanalBadge`, `Tabs` de `@/components/ui/tabs`.
- Produces: `<ProdutoCard produto={p} canais={string[]} onDarEntrada={(filtro: { sku?: string; codigoPai: string }) => void} />`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/components/estoque/__tests__/produto-card.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProdutoCard } from '../produto-card';
import type { ProdutoComSaldo } from '@/lib/produtos-saldo';

vi.mock('@/hooks/useImageUrl', () => ({ useImageUrl: () => ({ data: null, isError: false }) }));
vi.mock('@/components/movimentos-estoque', () => ({
  MovimentosEstoque: () => <div>Movimentos de estoque</div>,
}));

const produto: ProdutoComSaldo = {
  codigoPai: '00000004', nomePai: 'Protetor Solar', descricaoPai: 'Descrição longa.',
  capaStoragePath: null, fornecedor: 'Eucerin', unidade: 'UN', origem: 'nacional',
  mlItemId: null, criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 20,
  variacoes: [{
    codigo: '00000005', nome: null, cor: 'incolor', gtin: '4005800241901', estoque: 20,
    custo: 12, preco: 89.9, pesoGramas: null, alturaCm: null, larguraCm: null,
    comprimentoCm: null, imagemPath: null,
  }],
};

function renderCard(onDarEntrada = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProdutoCard produto={produto} canais={[]} onDarEntrada={onDarEntrada} />
    </QueryClientProvider>,
  );
  return onDarEntrada;
}

describe('ProdutoCard', () => {
  it('expande por teclado e expõe aria-expanded', async () => {
    const user = userEvent.setup();
    renderCard();
    const botao = screen.getByRole('button', { name: /Protetor Solar/ });
    expect(botao).toHaveAttribute('aria-expanded', 'false');
    botao.focus();
    await user.keyboard('{Enter}');
    expect(botao).toHaveAttribute('aria-expanded', 'true');
  });

  // Guarda de regressão do defeito que originou o redesenho: tabela aninhada estoura a largura.
  it('o painel expandido não contém nenhuma <table>', async () => {
    const user = userEvent.setup();
    const { container } = render(<div />);
    renderCard();
    await user.click(screen.getByRole('button', { name: /Protetor Solar/ }));
    expect(document.querySelectorAll('table')).toHaveLength(0);
    expect(container).toBeDefined();
  });

  it('produto multivariação não pré-seleciona SKU ao dar entrada', async () => {
    const user = userEvent.setup();
    const onDarEntrada = renderCard();
    await user.click(screen.getByRole('button', { name: 'Dar entrada' }));
    expect(onDarEntrada).toHaveBeenCalledWith({ sku: '00000005', codigoPai: '00000004' });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test -- produto-card`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Crie `src/components/estoque/produto-card.tsx`:

```tsx
// Linha de produto da tela Estoque. Substitui a <TableRow>: o painel expandido é filho do card,
// FORA de qualquer <table> — é isso que impede o min-content de tabela aninhada de estourar a
// largura da página (o bug que motivou o redesenho).
import { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CanalBadge } from '@/components/canal-badge';
import { FotoCapaFamilia } from '@/components/foto-capa-familia';
import { MovimentosEstoque } from '@/components/movimentos-estoque';
import { VariacaoEstoqueCard, PillSaldo } from '@/components/estoque/variacao-estoque-card';
import { useImageUrl } from '@/hooks/useImageUrl';
import { cn } from '@/lib/utils';
import type { ProdutoComSaldo } from '@/lib/produtos-saldo';

export interface AlvoEntrada {
  /** Só preenchido quando o produto tem UMA variação — com várias, a escolha é do operador. */
  sku?: string;
  codigoPai: string;
}

export function ProdutoCard({ produto, canais, onDarEntrada }: {
  produto: ProdutoComSaldo;
  canais: string[];
  onDarEntrada: (alvo: AlvoEntrada) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const painelId = useId();
  const { data: capaUrl } = useImageUrl(produto.capaStoragePath);

  const alvo: AlvoEntrada = produto.variacoes.length === 1
    ? { sku: produto.variacoes[0].codigo, codigoPai: produto.codigoPai }
    : { codigoPai: produto.codigoPai };

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-3 p-3">
        {/* Botão real, não div com onClick: a expansão precisa funcionar por teclado. */}
        <button
          type="button"
          aria-expanded={aberto}
          aria-controls={painelId}
          onClick={() => setAberto((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', aberto && 'rotate-90')} />
          <FotoCapaFamilia capaUrl={capaUrl ?? null} tamanho="small" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{produto.nomePai}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">{produto.codigoPai}</div>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden text-right sm:block">
            <div className="tabular-nums font-medium">{produto.saldoTotal}</div>
            <div className="text-xs text-muted-foreground">
              {produto.variacoes.length} {produto.variacoes.length === 1 ? 'SKU' : 'SKUs'}
            </div>
          </div>
          <PillSaldo saldo={produto.saldoTotal} />
          {canais.length > 0 && (
            <div className="hidden flex-wrap gap-1 md:flex">
              {canais.map((c) => <CanalBadge key={c} canal={c} />)}
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={() => onDarEntrada(alvo)}>
            Dar entrada
          </Button>
        </div>
      </div>

      {aberto && (
        <div id={painelId} className="border-t bg-muted/40 p-3">
          {produto.descricaoPai && (
            <p className="mb-3 line-clamp-3 text-xs text-muted-foreground">{produto.descricaoPai}</p>
          )}
          <Tabs defaultValue="variacoes">
            <TabsList>
              <TabsTrigger value="variacoes">Variações</TabsTrigger>
              <TabsTrigger value="movimentos">Movimentos</TabsTrigger>
            </TabsList>
            <TabsContent value="variacoes">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {produto.variacoes.map((v) => <VariacaoEstoqueCard key={v.codigo} variacao={v} />)}
              </div>
            </TabsContent>
            <TabsContent value="movimentos">
              <MovimentosEstoque codigoPai={produto.codigoPai} ativo={aberto} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rodar os testes**

Run: `pnpm test -- produto-card && pnpm lint`
Expected: PASS.

> Se o terceiro teste falhar porque o produto do fixture tem uma só variação, ele está certo: com uma variação o SKU **é** pré-selecionado. Acrescente uma segunda variação ao fixture e asserte `{ codigoPai: '00000004' }` sem `sku`.

- [ ] **Step 5: Commit**

```bash
git add src/components/estoque/produto-card.tsx src/components/estoque/__tests__/produto-card.test.tsx
git commit -m "feat(estoque): card de produto com painel em abas, acessivel por teclado"
```

---

### Task 7: Barra de busca, filtros e ordenação

**Files:**
- Create: `src/components/estoque/barra-filtros-estoque.tsx`
- Test: `src/components/estoque/__tests__/barra-filtros-estoque.test.tsx`

**Interfaces:**
- Consumes: `FiltroEstoque`, `OrdemEstoque` (Task 2), `Input`, `Select` de `@/components/ui/*`.
- Produces: `<BarraFiltrosEstoque termo filtro ordem canaisIndisponivel onTermo onFiltro onOrdem />`, todas as callbacks `(v) => void`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/components/estoque/__tests__/barra-filtros-estoque.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarraFiltrosEstoque } from '../barra-filtros-estoque';

const props = {
  termo: '', filtro: 'todos' as const, ordem: 'nome' as const,
  canaisIndisponivel: false,
  onTermo: vi.fn(), onFiltro: vi.fn(), onOrdem: vi.fn(),
};

describe('BarraFiltrosEstoque', () => {
  it('digitar na busca emite o termo', async () => {
    const onTermo = vi.fn();
    const user = userEvent.setup();
    render(<BarraFiltrosEstoque {...props} onTermo={onTermo} />);
    await user.type(screen.getByPlaceholderText(/Buscar por nome, código, SKU, GTIN/), 'abc');
    expect(onTermo).toHaveBeenCalled();
  });

  // A UI não pode oferecer um filtro que ela sabe que responderia errado.
  it('com canais indisponíveis, o filtro "não publicado" fica desabilitado e o motivo aparece', () => {
    render(<BarraFiltrosEstoque {...props} canaisIndisponivel />);
    expect(screen.getByRole('button', { name: 'Não publicado' })).toBeDisabled();
    expect(screen.getByText(/não foi possível carregar os canais/i)).toBeInTheDocument();
  });

  it('com canais disponíveis o filtro está habilitado', () => {
    render(<BarraFiltrosEstoque {...props} />);
    expect(screen.getByRole('button', { name: 'Não publicado' })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test -- barra-filtros-estoque`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Crie `src/components/estoque/barra-filtros-estoque.tsx`:

```tsx
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { FiltroEstoque, OrdemEstoque } from '@/lib/produtos-saldo-filtro';

const FILTROS: Array<{ valor: FiltroEstoque; rotulo: string }> = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'sem-estoque', rotulo: 'Sem estoque' },
  { valor: 'nao-publicado', rotulo: 'Não publicado' },
];

const ORDENS: Array<{ valor: OrdemEstoque; rotulo: string }> = [
  { valor: 'nome', rotulo: 'Nome (A-Z)' },
  { valor: 'saldo-asc', rotulo: 'Menor saldo' },
  { valor: 'recente', rotulo: 'Mais recente' },
];

export function BarraFiltrosEstoque({
  termo, filtro, ordem, canaisIndisponivel, onTermo, onFiltro, onOrdem,
}: {
  termo: string;
  filtro: FiltroEstoque;
  ordem: OrdemEstoque;
  /** Query de canais carregando ou em erro: o filtro por publicação não pode ser oferecido. */
  canaisIndisponivel: boolean;
  onTermo: (v: string) => void;
  onFiltro: (v: FiltroEstoque) => void;
  onOrdem: (v: OrdemEstoque) => void;
}) {
  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-sm"
          placeholder="Buscar por nome, código, SKU, GTIN, cor ou fornecedor…"
          value={termo}
          onChange={(e) => onTermo(e.target.value)}
        />
        <div className="flex gap-1">
          {FILTROS.map((f) => {
            const desabilitado = f.valor === 'nao-publicado' && canaisIndisponivel;
            return (
              <Button
                key={f.valor}
                type="button"
                size="sm"
                variant={filtro === f.valor ? 'secondary' : 'ghost'}
                disabled={desabilitado}
                onClick={() => onFiltro(f.valor)}
              >
                {f.rotulo}
              </Button>
            );
          })}
        </div>
        <div className="flex gap-1">
          {ORDENS.map((o) => (
            <Button
              key={o.valor}
              type="button"
              size="sm"
              variant={ordem === o.valor ? 'secondary' : 'ghost'}
              onClick={() => onOrdem(o.valor)}
              className={cn(ordem === o.valor && 'font-medium')}
            >
              {o.rotulo}
            </Button>
          ))}
        </div>
      </div>
      {canaisIndisponivel && (
        <p className="text-xs text-muted-foreground">
          Não foi possível carregar os canais — o filtro por publicação está indisponível.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rodar os testes**

Run: `pnpm test -- barra-filtros-estoque && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/estoque/barra-filtros-estoque.tsx src/components/estoque/__tests__/barra-filtros-estoque.test.tsx
git commit -m "feat(estoque): barra de busca, filtros e ordenacao"
```

---

### Task 8: Compor a página Estoque

**Files:**
- Modify: `src/pages/Estoque.tsx` (substitui `LinhaProduto`, `rotuloDimensoes` e todo o bloco de `<Table>`)
- Test: `src/pages/__tests__/Estoque.test.tsx` (criar)

**Interfaces:**
- Consumes: tudo das Tasks 1, 2, 6, 7.
- Produces: página sem `<table>` e sem `LinhaProduto`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/pages/__tests__/Estoque.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Estoque from '../Estoque';
import type { ProdutoComSaldo } from '@/lib/produtos-saldo';

const produto: ProdutoComSaldo = {
  codigoPai: '00000004', nomePai: 'Protetor Solar', descricaoPai: null,
  capaStoragePath: null, fornecedor: 'Eucerin', unidade: 'UN', origem: 'nacional',
  mlItemId: null, criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 20,
  variacoes: [{
    codigo: '00000005', nome: null, cor: 'incolor', gtin: '4005800241901', estoque: 20,
    custo: 12, preco: 89.9, pesoGramas: null, alturaCm: null, larguraCm: null,
    comprimentoCm: null, imagemPath: null,
  }],
};

vi.mock('@/hooks/useModulosHabilitados', () => ({
  useModulosHabilitados: () => ({ data: ['estoque'], isLoading: false }),
}));
vi.mock('@/hooks/useImageUrl', () => ({ useImageUrl: () => ({ data: null, isError: false }) }));
vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<typeof import('@/lib/produtos-saldo')>()),
  fetchProdutosComSaldo: () => Promise.resolve([produto]),
  fetchCanaisPorProduto: () => Promise.resolve(new Map()),
}));

function renderEstoque() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Estoque /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Estoque', () => {
  it('busca por GTIN encontra o produto', async () => {
    const user = userEvent.setup();
    renderEstoque();
    await screen.findByText('Protetor Solar');
    await user.type(screen.getByPlaceholderText(/Buscar por nome/), '4005800241901');
    expect(screen.getByText('Protetor Solar')).toBeInTheDocument();
  });

  it('busca que não casa mostra a mensagem de vazio', async () => {
    const user = userEvent.setup();
    renderEstoque();
    await screen.findByText('Protetor Solar');
    await user.type(screen.getByPlaceholderText(/Buscar por nome/), 'zzzz');
    expect(screen.getByText(/Nenhum produto bate com/)).toBeInTheDocument();
  });

  it('não renderiza nenhuma <table>', async () => {
    renderEstoque();
    await screen.findByText('Protetor Solar');
    expect(document.querySelectorAll('table')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test -- Estoque`
Expected: FAIL — a página ainda usa `<Table>` e o placeholder da busca é o antigo.

- [ ] **Step 3: Reescrever o corpo da página**

Em `src/pages/Estoque.tsx`: apague `rotuloDimensoes` e o componente `LinhaProduto` inteiro (linhas 23-125), remova os imports de `Table*`, `CanalBadge`, `MovimentosEstoque`, `cn`, `fmtBRL`, `ChevronRight` e `VariacaoComSaldo`. Acrescente:

```tsx
import { ProdutoCard, type AlvoEntrada } from '@/components/estoque/produto-card';
import { BarraFiltrosEstoque } from '@/components/estoque/barra-filtros-estoque';
import { filtrarProdutos, type FiltroEstoque, type OrdemEstoque } from '@/lib/produtos-saldo-filtro';
import { Skeleton } from '@/components/ui/skeleton';
```

No componente, troque o state e as queries:

```tsx
const [busca, setBusca] = useState('');
const [filtro, setFiltro] = useState<FiltroEstoque>('todos');
const [ordem, setOrdem] = useState<OrdemEstoque>('nome');
const [entradaAberta, setEntradaAberta] = useState(false);
const [alvoEntrada, setAlvoEntrada] = useState<AlvoEntrada | null>(null);
const [cadastroAberto, setCadastroAberto] = useState(false);

const { data: produtos, isLoading, isError } = useQuery({ /* inalterado */ });

// isLoading/isError explícitos: `data === undefined` sozinho confunde "carregando" com "falhou",
// e o filtro por publicação depende dessa diferença.
const {
  data: canaisPorProduto, isLoading: canaisLoading, isError: canaisErro,
} = useQuery({
  queryKey: ['canais-por-produto'],
  queryFn: fetchCanaisPorProduto,
  enabled: !!modulos?.includes('estoque'),
  staleTime: 60_000,
});
const canaisIndisponivel = canaisLoading || canaisErro;
```

Logo após, o efeito que impede o filtro de ficar preso num estado que não sabe responder:

```tsx
// Filtro selecionado + canais caíram = a tela responderia errado. Volta para "todos".
useEffect(() => {
  if (canaisIndisponivel && filtro === 'nao-publicado') setFiltro('todos');
}, [canaisIndisponivel, filtro]);
```

E a lista:

```tsx
const lista = filtrarProdutos(produtos ?? [], {
  termo: busca, filtro, ordem,
  canaisPorProduto: canaisIndisponivel ? undefined : canaisPorProduto,
});
```

Substitua todo o bloco `<div className="rounded-lg border"><Table>…</Table>…</div>` por:

```tsx
<>
  <BarraFiltrosEstoque
    termo={busca} filtro={filtro} ordem={ordem}
    canaisIndisponivel={canaisIndisponivel}
    onTermo={setBusca} onFiltro={setFiltro} onOrdem={setOrdem}
  />
  <div className="flex flex-col gap-2">
    {lista.map((p) => (
      <ProdutoCard
        key={p.codigoPai}
        produto={p}
        canais={canaisPorProduto?.get(p.codigoPai) ?? []}
        onDarEntrada={(alvo) => { setAlvoEntrada(alvo); setEntradaAberta(true); }}
      />
    ))}
    {lista.length === 0 && (
      <p className="p-4 text-sm text-muted-foreground">Nenhum produto bate com “{busca}”.</p>
    )}
  </div>
</>
```

Troque o estado de carregamento textual por skeleton:

```tsx
{isLoading ? (
  <div className="flex flex-col gap-2">
    {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
  </div>
) : isError ? (
```

E atualize o `DialogEntrada` no fim do arquivo:

```tsx
<DialogEntrada
  produtos={produtos ?? []}
  aberto={entradaAberta}
  onFechar={() => setEntradaAberta(false)}
  skuInicial={alvoEntrada?.sku}
  filtroInicial={alvoEntrada?.codigoPai}
/>
```

- [ ] **Step 4: Rodar os testes**

Run: `pnpm test -- Estoque && pnpm lint`
Expected: PASS. `filtroInicial` ainda não existe no `DialogEntrada` — o TypeScript vai reclamar. Faça a Task 9 antes de fechar esta, ou adicione a prop opcional agora e implemente na Task 9.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Estoque.tsx src/pages/__tests__/Estoque.test.tsx
git commit -m "feat(estoque): listagem em cards, sem tabela - corrige o scroll horizontal"
```

---

### Task 9: `filtroInicial` na entrada de mercadoria

**Files:**
- Modify: `src/components/estoque/dialog-entrada.tsx:21-26` (props), `:37-45` (reset), `:47-57` (predicado)
- Test: `src/components/estoque/__tests__/dialog-entrada.test.tsx` (criar)

**Interfaces:**
- Consumes: `ProdutoComSaldo`.
- Produces: `DialogEntrada` aceita `filtroInicial?: string`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/components/estoque/__tests__/dialog-entrada.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogEntrada } from '../dialog-entrada';
import type { ProdutoComSaldo } from '@/lib/produtos-saldo';

const variacao = (codigo: string, cor: string) => ({
  codigo, nome: null, cor, gtin: null, estoque: 5, custo: null, preco: 10,
  pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null, imagemPath: null,
});

const produtos: ProdutoComSaldo[] = [
  {
    codigoPai: '00000004', nomePai: 'Protetor Solar', descricaoPai: null,
    capaStoragePath: null, fornecedor: null, unidade: null, origem: 'nacional',
    mlItemId: null, criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 10,
    variacoes: [variacao('00000005', 'incolor'), variacao('00000006', 'bege')],
  },
  {
    codigoPai: '00000009', nomePai: 'Outro Produto', descricaoPai: null,
    capaStoragePath: null, fornecedor: null, unidade: null, origem: 'nacional',
    mlItemId: null, criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 5,
    variacoes: [variacao('00000010', 'única')],
  },
];

// O código do PAI não aparece no rótulo do SKU — filtrar por ele só funciona se o predicado
// olhar codigoPai explicitamente. Sem isso a lista abre vazia.
it('filtroInicial pelo código do pai lista só as variações daquele produto', () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DialogEntrada produtos={produtos} aberto onFechar={() => {}} filtroInicial="00000004" />
    </QueryClientProvider>,
  );
  expect(screen.getByText(/00000005/)).toBeInTheDocument();
  expect(screen.getByText(/00000006/)).toBeInTheDocument();
  expect(screen.queryByText(/00000010/)).toBeNull();
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test -- dialog-entrada`
Expected: FAIL — a lista aparece vazia (o predicado só olha `o.rotulo`).

- [ ] **Step 3: Implementar**

Em `src/components/estoque/dialog-entrada.tsx`, acrescente a prop:

```tsx
export function DialogEntrada({ produtos, aberto, onFechar, skuInicial, filtroInicial }: {
  produtos: ProdutoComSaldo[];
  aberto: boolean;
  onFechar: () => void;
  skuInicial?: string;
  /** Pré-filtra a lista (usado com o `codigo_pai` quando o produto tem várias variações). */
  filtroInicial?: string;
}) {
```

No `useEffect` de reset, troque `setBusca('')` por:

```tsx
setBusca(filtroInicial ?? '');
```

e acrescente `filtroInicial` ao array de dependências: `[aberto, skuInicial, filtroInicial]`.

No `useMemo` de `opcoes`, troque o predicado:

```tsx
return todas.filter((o) => o.rotulo.toLowerCase().includes(termo)
  || o.codigoPai.toLowerCase().includes(termo)).slice(0, 50);
```

- [ ] **Step 4: Rodar os testes**

Run: `pnpm test -- dialog-entrada && pnpm test -- Estoque && pnpm lint`
Expected: PASS nos dois.

- [ ] **Step 5: Commit**

```bash
git add src/components/estoque/dialog-entrada.tsx src/components/estoque/__tests__/dialog-entrada.test.tsx
git commit -m "feat(estoque): dar entrada abre filtrado pelo produto, sem escolher SKU sozinho"
```

---

### Task 10: Cadastro — card por variação, com identidade estável

**Files:**
- Create: `src/components/estoque/linha-variacao-form.tsx`
- Modify: `src/components/estoque/dialog-cadastro-produto.tsx:26-35` (tipo), `:82` (state), `:244-294` (tabela → cards)
- Modify: `src/components/estoque/__tests__/dialog-cadastro-produto.test.tsx:44` (seletor)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `type LinhaVariacao` ganha `clientId: string` e `foto: File | null`; `novaLinha(): LinhaVariacao`; `<LinhaVariacaoForm linha indice podeRemover onMudar onRemover />`.

- [ ] **Step 1: Escrever os testes que falham**

Substitua o seletor frágil do teste existente (`document.querySelector('table tbody tr td:nth-child(3) input')`) por label, e acrescente os casos novos ao mesmo arquivo:

```tsx
// dentro de describe existente, no lugar do querySelector:
const precoInput = screen.getByLabelText('Preço da variação 1');
await user.type(precoInput, '10');
```

```tsx
describe('DialogCadastroProduto — formulário em cards', () => {
  it('remover a variação do meio preserva os dados das outras', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /Adicionar variação/ }));
    await user.click(screen.getByRole('button', { name: /Adicionar variação/ }));

    await user.type(screen.getByLabelText('Cor / nome da variação 1'), 'azul');
    await user.type(screen.getByLabelText('Cor / nome da variação 2'), 'verde');
    await user.type(screen.getByLabelText('Cor / nome da variação 3'), 'preto');

    await user.click(screen.getByRole('button', { name: 'Remover variação 2' }));

    expect(screen.getByLabelText('Cor / nome da variação 1')).toHaveValue('azul');
    expect(screen.getByLabelText('Cor / nome da variação 2')).toHaveValue('preto');
  });

  it('preço vazio mostra mensagem e mantém o botão travado', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('Nome'), 'Produto Teste');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.click(screen.getByLabelText('Preço da variação 1'));
    await user.tab();
    expect(screen.getByText('Preço é obrigatório e deve ser maior que zero.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeDisabled();
  });

  it('estoque fracionário é recusado inline', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('Estoque inicial da variação 1'), '2,5');
    await user.tab();
    expect(screen.getByText('Estoque inicial deve ser um número inteiro.')).toBeInTheDocument();
  });

  it('texto não numérico no custo é recusado em vez de virar campo vazio', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('Custo da variação 1'), 'abc');
    await user.tab();
    expect(screen.getByText('Valor inválido.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test -- dialog-cadastro-produto`
Expected: FAIL — os labels não existem.

- [ ] **Step 3: Criar o card de variação do formulário**

Crie `src/components/estoque/linha-variacao-form.tsx`:

```tsx
// Card de variação do cadastro. Substitui a linha de 9 inputs minúsculos numa tabela com scroll
// horizontal. Campos agrupados por natureza: identificação, comercial, logística, foto.
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface LinhaVariacao {
  /** Identidade estável da linha. `key` por índice + <input type="file"> (DOM não-controlável)
   *  faz o arquivo escolhido "andar" para outra variação quando uma linha é removida — e como o
   *  casamento com o id do banco é posicional, a foto acabaria gravada no SKU errado. */
  clientId: string;
  nome: string; gtin: string;
  preco: string; custo: string; estoqueInicial: string;
  pesoGramas: string; alturaCm: string; larguraCm: string; comprimentoCm: string;
  foto: File | null;
}

export function novaLinha(): LinhaVariacao {
  return {
    clientId: crypto.randomUUID(),
    nome: '', gtin: '', preco: '', custo: '', estoqueInicial: '',
    pesoGramas: '', alturaCm: '', larguraCm: '', comprimentoCm: '', foto: null,
  };
}

/** `null` = campo vazio. `NaN` = texto inválido — que NÃO pode virar "vazio" em silêncio. */
export function parseNum(v: string): number | null | typeof NaN {
  const t = v.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function erroCampo(campo: keyof LinhaVariacao, valor: string): string | null {
  if (campo === 'nome' || campo === 'gtin') return null;
  const n = parseNum(valor);
  if (Number.isNaN(n)) return 'Valor inválido.';
  if (campo === 'preco' && (n == null || n <= 0)) return 'Preço é obrigatório e deve ser maior que zero.';
  if (campo === 'estoqueInicial' && n != null && !Number.isInteger(n)) {
    return 'Estoque inicial deve ser um número inteiro.';
  }
  if (campo === 'custo' && n != null && n <= 0) return 'Custo, quando informado, deve ser maior que zero.';
  return null;
}

const NUMERICOS = [
  { campo: 'preco', rotulo: 'Preço' },
  { campo: 'custo', rotulo: 'Custo' },
  { campo: 'estoqueInicial', rotulo: 'Estoque inicial' },
] as const;

const LOGISTICA = [
  { campo: 'pesoGramas', rotulo: 'Peso (g)' },
  { campo: 'alturaCm', rotulo: 'Altura (cm)' },
  { campo: 'larguraCm', rotulo: 'Largura (cm)' },
  { campo: 'comprimentoCm', rotulo: 'Comprimento (cm)' },
] as const;

export function LinhaVariacaoForm({ linha, indice, podeRemover, onMudar, onRemover }: {
  linha: LinhaVariacao;
  indice: number;
  podeRemover: boolean;
  onMudar: (patch: Partial<LinhaVariacao>) => void;
  onRemover: () => void;
}) {
  const n = indice + 1;
  const id = (campo: string) => `var-${linha.clientId}-${campo}`;

  const campoTexto = (campo: keyof LinhaVariacao, rotulo: string) => (
    <div key={campo} className="flex flex-col gap-1">
      <label htmlFor={id(campo)} className="text-xs text-muted-foreground">
        {rotulo} da variação {n}
      </label>
      <Input
        id={id(campo)}
        className="h-8 text-sm"
        value={linha[campo] as string}
        onChange={(e) => onMudar({ [campo]: e.target.value } as Partial<LinhaVariacao>)}
      />
      {erroCampo(campo, linha[campo] as string) && (
        <span className="text-xs text-destructive">{erroCampo(campo, linha[campo] as string)}</span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Variação {n}</span>
        <Button
          type="button" variant="ghost" size="sm"
          disabled={!podeRemover}
          aria-label={`Remover variação ${n}`}
          onClick={onRemover}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {campoTexto('nome', 'Cor / nome')}
        {campoTexto('gtin', 'GTIN')}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {NUMERICOS.map((c) => campoTexto(c.campo, c.rotulo))}
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        {LOGISTICA.map((c) => campoTexto(c.campo, c.rotulo))}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={id('foto')} className="text-xs text-muted-foreground">
            Foto da variação {n}
          </label>
          <Input
            id={id('foto')} type="file" accept="image/*"
            onChange={(e) => onMudar({ foto: e.target.files?.[0] ?? null })}
          />
        </div>
        {linha.foto && (
          <img
            src={URL.createObjectURL(linha.foto)}
            alt={`Prévia da foto da variação ${n}`}
            className="h-16 w-16 shrink-0 rounded-md object-cover"
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Trocar a tabela pelos cards no diálogo**

Em `dialog-cadastro-produto.tsx`: remova o tipo `LinhaVariacao` local, `LINHA_VAZIA` e a função `num`, importando de `./linha-variacao-form`:

```tsx
import { LinhaVariacaoForm, novaLinha, parseNum, type LinhaVariacao } from '@/components/estoque/linha-variacao-form';
```

Troque o state e o `podeSalvar`:

```tsx
const [linhas, setLinhas] = useState<LinhaVariacao[]>([novaLinha()]);

const podeSalvar = !!nomePai.trim() && !!origem && linhas.length > 0
  && linhas.every((l) => {
    const p = parseNum(l.preco);
    return typeof p === 'number' && !Number.isNaN(p) && p > 0;
  });
```

Em `montarPayload`, troque `num(...)` por `parseNum(...)` e normalize `NaN` para `null` (a validação inline já impediu o envio):

```tsx
const numOuNull = (v: string) => {
  const n = parseNum(v);
  return typeof n === 'number' && !Number.isNaN(n) ? n : null;
};
```

Substitua todo o bloco `<div className="overflow-x-auto rounded-md border"><table>…</table></div>` por:

```tsx
<div className="flex flex-col gap-3">
  {linhas.map((l, i) => (
    <LinhaVariacaoForm
      key={l.clientId}
      linha={l}
      indice={i}
      podeRemover={linhas.length > 1}
      onMudar={(patch) => setLinhas((prev) => prev.map((x) => (x.clientId === l.clientId ? { ...x, ...patch } : x)))}
      onRemover={() => setLinhas((prev) => prev.filter((x) => x.clientId !== l.clientId))}
    />
  ))}
</div>
```

E o botão de adicionar: `onClick={() => setLinhas((l) => [...l, novaLinha()])}`.

Ajuste `DialogContent` para `sm:max-w-3xl` e substitua o comentário sobre `4xl`/`5xl` por um que explique que a largura é do agrupamento em cards, mantendo a nota do prefixo `sm:` (que continua obrigatória por causa do `tailwind-merge`).

- [ ] **Step 5: Rodar os testes**

Run: `pnpm test -- dialog-cadastro-produto && pnpm lint`
Expected: PASS, incluindo o teste antigo da `chaveCadastro` com o seletor novo.

- [ ] **Step 6: Commit**

```bash
git add src/components/estoque/linha-variacao-form.tsx src/components/estoque/dialog-cadastro-produto.tsx src/components/estoque/__tests__/dialog-cadastro-produto.test.tsx
git commit -m "feat(cadastro): variacao em card com validacao inline e identidade estavel"
```

---

### Task 11: Fotos na etapa 1, lote de upload e travas

**Files:**
- Modify: `src/components/estoque/dialog-cadastro-produto.tsx` (fluxo de salvar, fechar e etapa 2)
- Modify: `src/components/estoque/__tests__/dialog-cadastro-produto.test.tsx`

**Interfaces:**
- Consumes: `LinhaVariacao.foto` (Task 10), `uploadFotoProduto` e `ResultadoCadastro` de `@/lib/produtos-saldo`.
- Produces: nada consumido por outras tasks.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao arquivo de teste do diálogo:

```tsx
describe('DialogCadastroProduto — fotos e travas', () => {
  // D6: pendência de IA ou de estoque NÃO pode esconder o upload — a foto é o que o operador
  // veio fazer, e ele fica sem nenhum caminho para enviá-la.
  it('mostra os campos de foto mesmo com filaOk false', async () => {
    cadastrarProdutoMock.mockResolvedValueOnce({
      loteId: 'l1', familiaId: 'f1', filaOk: false, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000005' }],
    });
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('Nome'), 'Produto Teste');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.type(screen.getByLabelText('Preço da variação 1'), '10');
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    expect(await screen.findByText(/não foi enfileirado/)).toBeInTheDocument();
    expect(screen.getByLabelText('Capa')).toBeInTheDocument();
  });

  it('não fecha enquanto o cadastro está em voo', async () => {
    let resolver: (v: unknown) => void = () => {};
    cadastrarProdutoMock.mockImplementationOnce(() => new Promise((r) => { resolver = r; }));
    const onFechar = vi.fn();
    const user = userEvent.setup();
    renderDialogCom({ onFechar });
    await user.type(screen.getByLabelText('Nome'), 'Produto Teste');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.type(screen.getByLabelText('Preço da variação 1'), '10');
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await user.keyboard('{Escape}');
    expect(onFechar).not.toHaveBeenCalled();
    resolver({ loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [], variacoes: [] });
  });
});
```

> `renderDialogCom({ onFechar })` é uma variação de `renderDialog()` que aceita o callback — extraia o helper existente para receber props opcionais.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test -- dialog-cadastro-produto`
Expected: FAIL — o bloco de fotos está atrás de `!pendencias` e o Escape fecha.

- [ ] **Step 3: Subir as fotos escolhidas na etapa 1**

Em `salvar()`, depois de `setResultado(r)`, dispare o lote:

```tsx
setResultado(r);
setChaveCadastro(crypto.randomUUID());
await subirLoteDeFotos(r);
// Segunda invalidação, OBRIGATÓRIA: a primeira roda antes dos uploads, e `imagem_path` /
// `capa_storage_path` só são gravados dentro de uploadFotoProduto. Sem esta, o card fica com
// placeholder mesmo com a foto já enviada.
qc.invalidateQueries({ queryKey: ['produtos-saldo'] });
if (r.filaOk && r.falhasEstoque.length === 0) toast.success('✓ Produto cadastrado');
```

E a função do lote, que casa `linhas[i]` com `resultado.variacoes[i]`:

```tsx
/**
 * Casamento POSICIONAL, e ele é correto por quatro invariantes encadeados:
 *   1. derivarCodigos numera na ordem do array           (_shared/produto/codigos.ts:38)
 *   2. montarLinhasProduto casa variacoes[i] ↔ codigos[i] (_shared/produto/validar.ts:102)
 *   3. a edge ordena a resposta por codigo               (cadastrar-produto/index.ts:256)
 *   4. todo codigo tem 8 digitos, entao ordem lexicografica = numerica
 * Se qualquer um deles mudar, a foto vai para o SKU errado EM SILENCIO.
 */
async function subirLoteDeFotos(r: ResultadoCadastro) {
  const alvos: Array<{ arquivo: File; alvo: Parameters<typeof uploadFotoProduto>[3] }> = [];
  for (const [tipo, arquivo] of Object.entries(fotosCapa)) {
    if (arquivo) alvos.push({ arquivo, alvo: { tipo: tipo as 'capa' | 'capa2' | 'capa3', familiaId: r.familiaId } });
  }
  linhas.forEach((l, i) => {
    const v = r.variacoes[i];
    if (l.foto && v) alvos.push({ arquivo: l.foto, alvo: { tipo: 'variacao', variacaoId: v.id } });
  });
  if (alvos.length === 0) return;

  setEnviandoFotos({ feitos: 0, total: alvos.length });
  const falhas: string[] = [];
  for (const [i, a] of alvos.entries()) {
    try {
      await subirFoto(a.arquivo, a.alvo);
    } catch {
      falhas.push(a.alvo.tipo === 'variacao' ? a.alvo.variacaoId : a.alvo.tipo);
    }
    setEnviandoFotos({ feitos: i + 1, total: alvos.length });
  }
  setEnviandoFotos(null);
  setFalhasFoto(falhas);
}
```

State novo: `const [fotosCapa, setFotosCapa] = useState<Record<'capa'|'capa2'|'capa3', File | null>>({ capa: null, capa2: null, capa3: null });`, `const [enviandoFotos, setEnviandoFotos] = useState<{ feitos: number; total: number } | null>(null);` e `const [falhasFoto, setFalhasFoto] = useState<string[]>([]);`.

Mova os três `<Input type="file">` de capa para a etapa 1 (junto dos dados do pai), gravando em `fotosCapa`.

- [ ] **Step 4: Travar o fechamento e liberar o upload na etapa 2**

```tsx
const ocupado = salvando || enviandoFotos !== null;

<Dialog open={aberto} onOpenChange={(o) => { if (!o && !ocupado) onFechar(); }}>
```

O botão "Fechar" e o "Cancelar" recebem `disabled={ocupado}`.

Na etapa 2, remova o wrapper `{!pendencias && (...)}` dos blocos de foto — os avisos de pendência continuam acima, mas não escondem mais o upload. O botão "Ir para a Revisão" mantém `disabled={!!pendencias || ocupado}`.

Enquanto `enviandoFotos`, mostre o progresso:

```tsx
{enviandoFotos && (
  <p className="text-sm text-muted-foreground">
    enviando fotos ({enviandoFotos.feitos}/{enviandoFotos.total})…
  </p>
)}
```

- [ ] **Step 5: Rodar os testes**

Run: `pnpm test && pnpm lint`
Expected: PASS na suíte inteira.

- [ ] **Step 6: Commit**

```bash
git add src/components/estoque/dialog-cadastro-produto.tsx src/components/estoque/__tests__/dialog-cadastro-produto.test.tsx
git commit -m "feat(cadastro): foto escolhida na etapa 1, upload em lote e trava contra perder arquivo"
```

---

### Task 12: Verificação visual e documentação

**Files:**
- Modify: `docs/TASKS.md`
- Verificar (sem alterar, salvo necessidade): `docs/reference/*`, `obsidian-vault/`

- [ ] **Step 1: Rodar a suíte completa**

Run: `pnpm lint && pnpm test`
Expected: tudo verde, nenhum `test.skip`.

- [ ] **Step 2: Verificação visual com Playwright**

Invoque a skill `playwright-cli` (regra do projeto) e tire **screenshots reais** — snapshot de acessibilidade não pega bug de layout CSS. Copie o `.env.local` para o worktree antes de subir o dev, senão a app abre branca.

Telas e estados obrigatórios, em viewport largo (1440px) **e** estreito (768px):

1. Estoque, lista colapsada — miniatura aparece, nada rola horizontalmente;
2. Estoque, card expandido na aba Variações — sem scroll horizontal na página;
3. Estoque, card expandido na aba Movimentos — idem;
4. **Publicados**, linha expandida — a regressão que esta entrega toca de lado;
5. Cadastro aberto com 3 variações — sem scroll horizontal dentro do diálogo.

Em cada print, confirmar `document.documentElement.scrollWidth <= window.innerWidth`.

- [ ] **Step 3: Ajustar a largura do diálogo se necessário**

A spec deliberadamente não fixa a largura (o histórico do arquivo tem duas medidas erradas). Se o print 5 mostrar corte, ajuste o `sm:max-w-*` e tire o print de novo. Mantenha o prefixo `sm:` — sem ele o `tailwind-merge` não sobrescreve o default do `DialogContent`.

- [ ] **Step 4: Atualizar a documentação**

Em `docs/TASKS.md`, registre a entrega referenciando a spec. Confira `docs/reference/` e `obsidian-vault/`: esta entrega não muda edge, modelo de dados nem decisão arquitetural, então a expectativa é "conferido sem necessidade de alteração" — informe explicitamente qual dos dois casos ocorreu.

- [ ] **Step 5: Commit**

```bash
git add docs/TASKS.md
git commit -m "docs(estoque): registra a entrega do redesenho da tela de Estoque"
```

---

## Auto-revisão do plano

**Cobertura da spec:** §3.1 → Task 6 · §3.2 → Task 5 · §3.3 → Task 4 · §3.4 → Tasks 2, 7, 8 · §3.5 → Tasks 2, 5 · §4 → Task 1 · §5.1 → Task 10 · §5.2 → Task 11 · §5.3 → Task 11 · §5.4 → Task 10 · §5.5 → Task 9 · §6 → Tasks 3, 7, 8 · §7 → distribuído · §8.2 (decisão A) → Global Constraints · §9 → Task 12.

**Não coberto de propósito:** §8.1 (empate de `criado_em`) é dívida declarada, sem task. A guarda de ordenação do lado da edge que a §7 da spec pede **não** virou task: testar o handler exigiria mock do cliente Supabase e a entrega é frontend-only por decisão. Em vez disso, a Task 11 grava os quatro invariantes num comentário no ponto exato onde a quebra causaria dano. Se isso for insuficiente, vira task própria junto com a opção B da §8.2.
