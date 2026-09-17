# Plano de Implementação — Busca Insensível a Acentos e Diacríticos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar todos os campos de busca do sistema insensíveis a acentos e diacríticos (ex.: buscar "macarrao" encontra "Macarrão", buscar "calca" encontra "Calça", e vice-versa).

**Architecture:** Criar função utilitária canônica pura `normalizarParaBusca` no frontend (`src/lib/texto.ts`) baseada em `normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()` e aplicá-la em todos os predicados de busca em memória (`publicados.ts`, `Revisao.tsx`, `pedidos-faturamento.ts`, `detalhe-vendas.ts`, `pulse-filtros.ts`, `dialog-entrada.tsx` e `produtos-saldo-filtro.ts`). No backend Deno (`repository.ts`), aplicar a mesma normalização nativa para a busca da carteira de organizações.

**Tech Stack:** TypeScript, React, Vitest, JavaScript Unicode Normalization (`String.prototype.normalize('NFD')`, RegExp Unicode Property Escapes `\p{Diacritic}`).

## Global Constraints

- Manter compatibilidade com buscas já existentes (GTIN, código, SKU, maiúsculas/minúsculas).
- Todas as funções de filtro devem permanecer funções puras e determinísticas, testáveis sem render de DOM sempre que possível.
- Frontend importa de `@/lib/texto`. Backend Deno (`supabase/functions/`) não importa do frontend; mantém seu helper local ou em `_shared/`.
- Nenhum banco de dados ou migration SQL é alterado, pois todas as buscas de catálogo/pedidos operam em memória sobre dados já carregados.
- Testes unitários com Vitest cobrindo: sem acento buscando com acento, com acento buscando sem acento, termos múltiplos e caracteres especiais do português (ç, ã, é, ô, etc.).

---

### Task 1: Utilitário Canônico `normalizarParaBusca`

**Files:**
- Create: `src/lib/texto.ts`
- Test: `src/lib/__tests__/texto.test.ts`

**Interfaces:**
- Produces: `normalizarParaBusca(s: string | null | undefined): string`

- [x] **Step 1: Escrever o teste que falha**

Criar `src/lib/__tests__/texto.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { normalizarParaBusca } from '../texto';

describe('normalizarParaBusca', () => {
  it('remove acentos comuns do português e converte para minúsculas', () => {
    expect(normalizarParaBusca('Macarrão')).toBe('macarrao');
    expect(normalizarParaBusca('CALÇA')).toBe('calca');
    expect(normalizarParaBusca('Órgão Público')).toBe('orgao publico');
    expect(normalizarParaBusca('Épico')).toBe('epico');
    expect(normalizarParaBusca('Açaí com Granola')).toBe('acai com granola');
  });

  it('lida com strings sem acento mantendo o conteúdo em minúsculas', () => {
    expect(normalizarParaBusca('macarrao')).toBe('macarrao');
    expect(normalizarParaBusca('TESTE')).toBe('teste');
  });

  it('trata nulo, indefinido e vazio com segurança', () => {
    expect(normalizarParaBusca('')).toBe('');
    expect(normalizarParaBusca(null)).toBe('');
    expect(normalizarParaBusca(undefined)).toBe('');
    expect(normalizarParaBusca('   ')).toBe('');
  });

  it('faz trim de espaços externos mas preserva internos', () => {
    expect(normalizarParaBusca('  Fita Métrica  ')).toBe('fita metrica');
  });
});
```

- [x] **Step 2: Executar o teste para verificar que falha**

Run: `pnpm vitest run src/lib/__tests__/texto.test.ts`
Expected: FAIL ("Cannot find module '../texto'")

- [x] **Step 3: Escrever implementação mínima**

Criar `src/lib/texto.ts`:
```typescript
/**
 * Normaliza texto para busca insensível a acentos e caixa:
 * - Decompõe caracteres acentuados via NFD
 * - Remove diacríticos (\p{Diacritic})
 * - Converte para minúsculas
 * - Remove espaços excedentes nas pontas
 */
export function normalizarParaBusca(s: string | null | undefined): string {
  if (!s) return '';
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}
```

- [x] **Step 4: Executar o teste para verificar que passa**

Run: `pnpm vitest run src/lib/__tests__/texto.test.ts`
Expected: PASS (4 tests passed)

- [x] **Step 5: Commit**

```bash
git add src/lib/texto.ts src/lib/__tests__/texto.test.ts
git commit -m "feat(busca): cria utilitario canonico normalizarParaBusca"
```

---

### Task 2: Busca Insensível a Acentos em Publicados (`publicados.ts`)

**Files:**
- Modify: `src/lib/publicados.ts`
- Test: `src/lib/__tests__/publicados-busca-acento.test.ts`

**Interfaces:**
- Consumes: `normalizarParaBusca` de `src/lib/texto`
- Produces: `filtrarPublicados(itens: PublicadoItem[], f: FiltroPublicados): PublicadoItem[]` com busca insensível a acentos

- [x] **Step 1: Escrever o teste que falha**

Criar `src/lib/__tests__/publicados-busca-acento.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { filtrarPublicados, type PublicadoItem } from '../publicados';

function item(over: Partial<PublicadoItem> = {}): PublicadoItem {
  return {
    familiaId: 'fam-1',
    codigoPai: '00001',
    gtin: '7891234567890',
    titulo: 'Botão de Pressão Inox',
    fornecedor: 'Metalúrgica São Paulo',
    tipo: 'outro',
    categoria: 'Botões',
    precoPublicacao: 19.9,
    precoPublicacaoMax: 19.9,
    descricao: null,
    mlItemId: 'MLB123',
    mlPermalink: null,
    publicadoEm: '2026-08-01',
    status: 'ativo',
    ...over,
  };
}

describe('filtrarPublicados — busca com acentos', () => {
  it('encontra produto com acento pesquisando sem acento', () => {
    const lista = [item({ titulo: 'Linha de Costura Poliéster' })];
    const r = filtrarPublicados(lista, { busca: 'poliester' });
    expect(r).toHaveLength(1);
  });

  it('encontra produto sem acento pesquisando com acento', () => {
    const lista = [item({ titulo: 'Linha de Costura Poliester' })];
    const r = filtrarPublicados(lista, { busca: 'poliéster' });
    expect(r).toHaveLength(1);
  });

  it('encontra fornecedor com acento pesquisando sem acento', () => {
    const lista = [item({ fornecedor: 'Metalúrgica São Paulo' })];
    const r = filtrarPublicados(lista, { busca: 'sao paulo' });
    expect(r).toHaveLength(1);
  });

  it('encontra múltiplos termos misturando acentos', () => {
    const lista = [item({ titulo: 'Botão de Pressão', fornecedor: 'São Paulo' })];
    const r = filtrarPublicados(lista, { busca: 'botao sao' });
    expect(r).toHaveLength(1);
  });
});
```

- [x] **Step 2: Executar o teste para verificar que falha**

Run: `pnpm vitest run src/lib/__tests__/publicados-busca-acento.test.ts`
Expected: FAIL (0 of 1 items returned for "poliester")

- [x] **Step 3: Implementar normalização em `src/lib/publicados.ts`**

Em `src/lib/publicados.ts`:
Importar `normalizarParaBusca` de `./texto`.
Modificar `filtrarPublicados`:
```typescript
import { normalizarParaBusca } from './texto';

export function filtrarPublicados(
  itens: PublicadoItem[],
  f: FiltroPublicados,
): PublicadoItem[] {
  const queryStr = normalizarParaBusca(f.busca);
  const termosBusca = queryStr ? queryStr.split(/\s+/) : [];

  return itens.filter((i) => {
    if (f.fornecedor && i.fornecedor !== f.fornecedor) return false;
    if (f.status === 'problema') { if (!i.status || !STATUS_PROBLEMA.has(i.status)) return false; }
    else if (f.status && i.status !== f.status) return false;
    if (f.tipo && rotuloTipo(i) !== f.tipo) return false;
    if (f.somenteEncalhados && !ehEncalhado(i)) return false;
    if (f.somenteIncompletos && !i.publicacaoIncompleta) return false;
    if (f.somenteSemCatalogo && !i.catalogRetentavel) return false;

    if (termosBusca.length > 0) {
      const textoBuscavel = normalizarParaBusca([
        i.titulo,
        i.codigoPai,
        i.fornecedor ?? '',
        rotuloTipo(i),
        i.gtin ?? '',
        ...(i.identificadores ?? []),
      ].join(' '));

      // O texto buscável do item precisa conter TODOS os termos (ordem não importa)
      const matchBusca = termosBusca.every((termo) => textoBuscavel.includes(termo));
      if (!matchBusca) return false;
    }

    return true;
  });
}
```

- [x] **Step 4: Executar o teste para verificar que passa**

Run: `pnpm vitest run src/lib/__tests__/publicados-busca-acento.test.ts`
Expected: PASS (4 tests passed)

- [x] **Step 5: Executar testes existentes de publicados para garantir sem regressão**

Run: `pnpm vitest run src/lib/__tests__/publicados-filtro-problema.test.ts`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/lib/publicados.ts src/lib/__tests__/publicados-busca-acento.test.ts
git commit -m "feat(publicados): torna busca de anuncios insensivel a acentos"
```

---

### Task 3: Busca Insensível a Acentos em Revisão (`Revisao.tsx`)

**Files:**
- Modify: `src/pages/Revisao.tsx:49-74`
- Test: `src/pages/__tests__/Revisao.busca.test.tsx`

**Interfaces:**
- Consumes: `normalizarParaBusca` de `src/lib/texto`
- Produces: `filtrarFamilias(familias: Familia[], filtro: FiltroOp, busca: string, soComCoresNovas?: boolean): Familia[]`

- [x] **Step 1: Escrever o teste que falha**

Criar `src/pages/__tests__/Revisao.busca.test.tsx`:
```typescript
import { describe, expect, it } from 'vitest';
import { filtrarFamilias } from '../Revisao';
import type { Familia } from '@/lib/tipos-dominio';

function mockFamilia(over: Partial<Familia> = {}): Familia {
  return {
    id: 'fam-1',
    loteId: 'lote-1',
    codigoPai: 'PAI01',
    titulo: 'Toalha de Banho Algodão',
    tipoAviamento: 'outro',
    operacao: 'CREATE',
    status: 'pronto',
    precoAbaixo20pc: false,
    categoriaMlId: 'MLB123',
    categoriaNome: 'Toalhas',
    variacoes: [
      { id: 'v1', familiaId: 'fam-1', codigo: 'VAR01', cor: 'Azul Bebê', gtin: '7890001', estoque: 10, custo: 10, preco: 20 },
    ],
    ...over,
  } as Familia;
}

describe('filtrarFamilias — busca com acentos', () => {
  it('acha produto com acento pesquisando sem acento', () => {
    const lista = [mockFamilia({ titulo: 'Toalha de Banho Algodão' })];
    const r = filtrarFamilias(lista, 'todos', 'algodao');
    expect(r).toHaveLength(1);
  });

  it('acha produto sem acento pesquisando com acento', () => {
    const lista = [mockFamilia({ titulo: 'Toalha de Banho Algodao' })];
    const r = filtrarFamilias(lista, 'todos', 'algodão');
    expect(r).toHaveLength(1);
  });

  it('acha variação por cor ou código com acento', () => {
    const lista = [mockFamilia({ variacoes: [{ codigo: 'VAR01', cor: 'Azul Turquesa', gtin: '7890001' }] as any })];
    const r = filtrarFamilias(lista, 'todos', 'VAR01');
    expect(r).toHaveLength(1);
  });
});
```

- [x] **Step 2: Executar o teste para verificar que falha**

Run: `pnpm vitest run src/pages/__tests__/Revisao.busca.test.tsx`
Expected: FAIL ("algodao" não encontra "Algodão")

- [x] **Step 3: Implementar em `src/pages/Revisao.tsx`**

Importar `normalizarParaBusca` de `@/lib/texto`.
Atualizar `filtrarFamilias`:
```typescript
export function filtrarFamilias(
  familias: Familia[],
  filtro: FiltroOp,
  busca: string,
  soComCoresNovas = false,
): Familia[] {
  const buscaNorm = normalizarParaBusca(busca);
  return familias.filter((f) => {
    if (filtro === 'CREATE' && f.operacao !== 'CREATE') return false;
    if (filtro === 'UPDATE' && f.operacao !== 'UPDATE') return false;
    if (filtro === 'avisos' && !f.precoAbaixo20pc) return false;
    if (filtro === 'incompletas' && !familiaIncompleta(f)) return false;
    if (filtro === 'preco_alterado' && !(f.operacao === 'UPDATE' && temAlteracaoPreco(f))) return false;
    if (soComCoresNovas && coresNovasComEstoque(f).length === 0) return false;
    if (!buscaNorm) return true;

    return (
      normalizarParaBusca(f.titulo).includes(buscaNorm) ||
      normalizarParaBusca(f.codigoPai).includes(buscaNorm) ||
      f.variacoes.some(
        (v) =>
          normalizarParaBusca(v.codigo).includes(buscaNorm) ||
          normalizarParaBusca(v.gtin).includes(buscaNorm),
      )
    );
  });
}
```

- [x] **Step 4: Executar o teste para verificar que passa**

Run: `pnpm vitest run src/pages/__tests__/Revisao.busca.test.tsx`
Expected: PASS

- [x] **Step 5: Executar testes de Revisao para garantir sem regressão**

Run: `pnpm vitest run src/pages/__tests__/Revisao.test.tsx`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/pages/Revisao.tsx src/pages/__tests__/Revisao.busca.test.tsx
git commit -m "feat(revisao): torna busca de familias em revisao insensivel a acentos"
```

---

### Task 4: Busca em Faturamento / Pedidos / Detalhe Financeiro (`pedidos-faturamento.ts`)

**Files:**
- Modify: `src/lib/pedidos-faturamento.ts:408-422`
- Test: `src/lib/__tests__/pedidos-faturamento-busca.test.ts`

**Interfaces:**
- Consumes: `normalizarParaBusca` de `src/lib/texto`
- Produces: `pedidoCasaBusca(p: Pedido, query: string): boolean`

- [x] **Step 1: Escrever o teste que falha**

Criar `src/lib/__tests__/pedidos-faturamento-busca.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { pedidoCasaBusca, type Pedido } from '../pedidos-faturamento';

function mockPedido(over: Partial<Pedido> = {}): Pedido {
  return {
    chave: '1001',
    isPack: false,
    orderIds: [1001],
    vendaIds: ['v1'],
    data: '2026-08-01',
    comprador_id: 1,
    comprador_nick: 'JOAO_SILVA',
    comprador_nome: 'João da Conceição',
    status: 'paid',
    faturavel: true,
    statusDetail: null,
    shipping_status: 'delivered',
    shipping_substatus: null,
    uf: 'SP',
    cidade: 'São Paulo',
    unidades: 1,
    bruto: 100,
    brutoFaturavel: 100,
    frete: 0,
    liquido: 80,
    money_release_date: null,
    temMembrosSemDataLiberacao: false,
    sacado_em: null,
    sacado_por: null,
    estorno: 0,
    custo: 30,
    imposto: 8,
    markup: 1.4,
    comissao: 12,
    rastreio: null,
    is_publiai: true,
    tem_devolucao: false,
    ehKit: false,
    itens: [
      {
        id: 'i1',
        ml_item_id: 'MLB123',
        titulo: 'Botão de Pressão',
        codigo: 'BOT01',
        cor: 'Azul',
        ean: '7891234',
        quantity: 1,
        unit_price: 100,
        imagem_path: null,
        custo: 30,
        liquido: 80,
        imposto: 8,
        aliquotaPct: 8,
        markup: 1.4,
      },
    ],
    ...over,
  };
}

describe('pedidoCasaBusca — busca com acentos', () => {
  it('acha comprador com acento pesquisando sem acento', () => {
    const p = mockPedido();
    expect(pedidoCasaBusca(p, 'joao')).toBe(true);
    expect(pedidoCasaBusca(p, 'conceicao')).toBe(true);
  });

  it('acha produto do item com acento pesquisando sem acento', () => {
    const p = mockPedido();
    expect(pedidoCasaBusca(p, 'botao')).toBe(true);
    expect(pedidoCasaBusca(p, 'pressao')).toBe(true);
  });

  it('acha produto pesquisando com acento quando o termo coincide', () => {
    const p = mockPedido();
    expect(pedidoCasaBusca(p, 'João')).toBe(true);
    expect(pedidoCasaBusca(p, 'Pressão')).toBe(true);
  });
});
```

- [x] **Step 2: Executar o teste para verificar que falha**

Run: `pnpm vitest run src/lib/__tests__/pedidos-faturamento-busca.test.ts`
Expected: FAIL ("joao" returns false)

- [x] **Step 3: Implementar em `src/lib/pedidos-faturamento.ts`**

Importar `normalizarParaBusca` de `./texto`.
Modificar `pedidoCasaBusca`:
```typescript
export function pedidoCasaBusca(p: Pedido, query: string): boolean {
  const q = normalizarParaBusca(query);
  if (!q) return true;
  const campos = [
    nomeExibicaoComprador(p),
    p.chave,
    ...p.orderIds.map(String),
    fmtBRLSemSimbolo(p.bruto),
    fmtBRLSemSimbolo(p.liquido),
    ...p.itens.flatMap((it) => [it.titulo, it.codigo, it.ean]),
  ];
  return campos.some((c) => normalizarParaBusca(c).includes(q));
}
```

- [x] **Step 4: Executar o teste para verificar que passa**

Run: `pnpm vitest run src/lib/__tests__/pedidos-faturamento-busca.test.ts`
Expected: PASS

- [x] **Step 5: Executar testes de faturamento para garantir sem regressão**

Run: `pnpm vitest run src/lib/__tests__/faturamento.test.ts` (ou testes correlatos)
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/lib/pedidos-faturamento.ts src/lib/__tests__/pedidos-faturamento-busca.test.ts
git commit -m "feat(faturamento): torna busca de pedidos e vendas insensivel a acentos"
```

---

### Task 5: Busca em Detalhe de Vendas (`DetalheVendas.tsx`)

**Files:**
- Modify: `src/lib/detalhe-vendas.ts` (ou `src/pages/DetalheVendas.tsx`)
- Test: `src/lib/__tests__/detalhe-vendas-busca.test.ts`

**Interfaces:**
- Consumes: `normalizarParaBusca` de `src/lib/texto`
- Produces: `linhaVendaCasaBusca(l: LinhaVenda, busca: string): boolean`

- [x] **Step 1: Escrever o teste que falha**

Criar `src/lib/__tests__/detalhe-vendas-busca.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { linhaVendaCasaBusca, type LinhaVenda } from '../detalhe-vendas';

function mockLinha(over: Partial<LinhaVenda> = {}): LinhaVenda {
  return {
    chave: 'ch-1',
    codigo: 'COD01',
    ean: '789123',
    titulo: 'Camisa Algodão Egípcio',
    unidades: 2,
    valor: 200,
    pctTotal: 10,
    taxas: { total: 30, comissao: 20, frete: 0, imposto: 10 },
    custo: 50,
    markup: 1.5,
    lucro: 120,
    mlItemIds: ['MLB123'],
    ...over,
  };
}

describe('linhaVendaCasaBusca', () => {
  it('acha produto por título com acento pesquisando sem acento', () => {
    const l = mockLinha();
    expect(linhaVendaCasaBusca(l, 'algodao')).toBe(true);
    expect(linhaVendaCasaBusca(l, 'egipcio')).toBe(true);
  });

  it('acha produto por código ou EAN', () => {
    const l = mockLinha();
    expect(linhaVendaCasaBusca(l, 'cod01')).toBe(true);
    expect(linhaVendaCasaBusca(l, '789123')).toBe(true);
  });
});
```

- [x] **Step 2: Executar o teste para verificar que falha**

Run: `pnpm vitest run src/lib/__tests__/detalhe-vendas-busca.test.ts`
Expected: FAIL (função não definida)

- [x] **Step 3: Implementar `linhaVendaCasaBusca` em `src/lib/detalhe-vendas.ts` e plugar em `DetalheVendas.tsx`**

Em `src/lib/detalhe-vendas.ts`:
```typescript
import { normalizarParaBusca } from './texto';

export function linhaVendaCasaBusca(l: LinhaVenda, busca: string): boolean {
  const q = normalizarParaBusca(busca);
  if (!q) return true;
  return (
    normalizarParaBusca(l.titulo).includes(q) ||
    normalizarParaBusca(l.codigo).includes(q) ||
    normalizarParaBusca(l.ean).includes(q)
  );
}
```

Em `src/pages/DetalheVendas.tsx`:
Substituir o filtro inline:
```typescript
import { linhaVendaCasaBusca } from '@/lib/detalhe-vendas';
// ...
const linhas = useMemo(() => {
  let base = secao.linhas;
  if (busca.trim()) {
    base = base.filter((l) => linhaVendaCasaBusca(l, busca));
  }
  // ...
```

- [x] **Step 4: Executar o teste para verificar que passa**

Run: `pnpm vitest run src/lib/__tests__/detalhe-vendas-busca.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/detalhe-vendas.ts src/pages/DetalheVendas.tsx src/lib/__tests__/detalhe-vendas-busca.test.ts
git commit -m "feat(vendas): torna busca de detalhe de vendas insensivel a acentos"
```

---

### Task 6: Busca em Pulse Radar (`pulse-filtros.ts`)

**Files:**
- Modify: `src/lib/pulse-filtros.ts:30-36`
- Test: `src/lib/__tests__/pulse-filtros-busca.test.ts`

**Interfaces:**
- Consumes: `normalizarParaBusca` de `src/lib/texto`
- Produces: `filtrarProdutos` com `casaBusca` insensível a acento

- [x] **Step 1: Escrever o teste que falha**

Criar `src/lib/__tests__/pulse-filtros-busca.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { filtrarProdutos, type PulseProduto, FILTROS_VAZIOS } from '../pulse-filtros';

function mockPulse(over: Partial<PulseProduto> = {}): PulseProduto {
  return {
    familia_id: 'fam-1',
    codigo_pai: '001',
    gtin: '7891234567890',
    titulo: 'Kit Meias Algodão Conforto',
    meu_preco: 50,
    anuncio_status: 'active',
    catalogo_status: 'vinculado',
    ...over,
  } as PulseProduto;
}

describe('Pulse radar — busca com acentos', () => {
  it('encontra produto com acento pesquisando sem acento', () => {
    const lista = [mockPulse({ titulo: 'Kit Meias Algodão Conforto' })];
    const r = filtrarProdutos(lista, { ...FILTROS_VAZIOS, busca: 'algodao' }, () => null);
    expect(r).toHaveLength(1);
  });

  it('encontra produto pesquisando com acento', () => {
    const lista = [mockPulse({ titulo: 'Kit Meias Algodão Conforto' })];
    const r = filtrarProdutos(lista, { ...FILTROS_VAZIOS, busca: 'algodão' }, () => null);
    expect(r).toHaveLength(1);
  });
});
```

- [x] **Step 2: Executar o teste para verificar que falha**

Run: `pnpm vitest run src/lib/__tests__/pulse-filtros-busca.test.ts`
Expected: FAIL ("algodao" não encontra "Algodão")

- [x] **Step 3: Implementar em `src/lib/pulse-filtros.ts`**

Importar `normalizarParaBusca` de `./texto`.
Modificar `casaBusca`:
```typescript
function casaBusca(p: PulseProduto, termo: string): boolean {
  const t = normalizarParaBusca(termo);
  if (!t) return true;
  return normalizarParaBusca(p.titulo).includes(t)
    || (p.gtin ?? '').includes(t)
    || normalizarParaBusca(p.codigo_pai).includes(t);
}
```

- [x] **Step 4: Executar o teste para verificar que passa**

Run: `pnpm vitest run src/lib/__tests__/pulse-filtros-busca.test.ts`
Expected: PASS

- [x] **Step 5: Executar testes existentes do pulse-filtros**

Run: `pnpm vitest run src/lib/__tests__/pulse-filtros.test.ts`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/lib/pulse-filtros.ts src/lib/__tests__/pulse-filtros-busca.test.ts
git commit -m "feat(pulse): torna busca no radar insensivel a acentos"
```

---

### Task 7: Busca no Picker do Diálogo de Entrada (`dialog-entrada.tsx`)

**Files:**
- Modify: `src/lib/produto-entrada.ts` (ou extrair função de matching para arquivo testável)
- Modify: `src/components/estoque/dialog-entrada.tsx`
- Test: `src/lib/__tests__/produto-entrada-busca.test.ts`

**Interfaces:**
- Consumes: `normalizarParaBusca` de `src/lib/texto`
- Produces: `filtrarOpcoesSku(opcoes: OpcaoSku[], busca: string, limite?: number): OpcaoSku[]`

- [x] **Step 1: Escrever o teste que falha**

Criar `src/lib/__tests__/produto-entrada-busca.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { filtrarOpcoesSku, type OpcaoSku } from '../produto-entrada';

const mockOpcoes: OpcaoSku[] = [
  { codigo: '001', rotulo: '001 · Botão de Pressão (Azul Bebê)', codigoPai: 'PAI01', estoque: 10 },
  { codigo: '002', rotulo: '002 · Linha Poliéster (Branco)', codigoPai: 'PAI02', estoque: 5 },
];

describe('filtrarOpcoesSku', () => {
  it('acha opção com acento buscando sem acento', () => {
    const r = filtrarOpcoesSku(mockOpcoes, 'botao');
    expect(r).toHaveLength(1);
    expect(r[0].codigo).toBe('001');
  });

  it('acha opção por cor com acento buscando sem acento', () => {
    const r = filtrarOpcoesSku(mockOpcoes, 'bebe');
    expect(r).toHaveLength(1);
    expect(r[0].codigo).toBe('001');
  });

  it('acha opção buscando com acento', () => {
    const r = filtrarOpcoesSku(mockOpcoes, 'Poliéster');
    expect(r).toHaveLength(1);
    expect(r[0].codigo).toBe('002');
  });
});
```

- [x] **Step 2: Executar o teste para verificar que falha**

Run: `pnpm vitest run src/lib/__tests__/produto-entrada-busca.test.ts`
Expected: FAIL (função não definida)

- [x] **Step 3: Implementar em `src/lib/produto-entrada.ts` e plugar em `dialog-entrada.tsx`**

Criar/exportar em `src/lib/produto-entrada.ts`:
```typescript
import { normalizarParaBusca } from './texto';

export interface OpcaoSku {
  codigo: string;
  rotulo: string;
  codigoPai: string;
  estoque: number;
}

export function filtrarOpcoesSku(opcoes: OpcaoSku[], busca: string, limite = 50): OpcaoSku[] {
  const termo = normalizarParaBusca(busca);
  if (!termo) return opcoes.slice(0, limite);
  return opcoes.filter((o) =>
    normalizarParaBusca(o.rotulo).includes(termo) ||
    normalizarParaBusca(o.codigoPai).includes(termo),
  ).slice(0, limite);
}
```

Atualizar `src/components/estoque/dialog-entrada.tsx` para usar `filtrarOpcoesSku`.

- [x] **Step 4: Executar o teste para verificar que passa**

Run: `pnpm vitest run src/lib/__tests__/produto-entrada-busca.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/produto-entrada.ts src/components/estoque/dialog-entrada.tsx src/lib/__tests__/produto-entrada-busca.test.ts
git commit -m "feat(estoque): torna busca de skus no dialogo de entrada insensivel a acentos"
```

---

### Task 8: Padronização do Estoque (`produtos-saldo-filtro.ts`)

**Files:**
- Modify: `src/lib/produtos-saldo-filtro.ts`
- Test: `src/lib/__tests__/produtos-saldo-filtro.test.ts`

**Interfaces:**
- Consumes: `normalizarParaBusca` de `src/lib/texto`
- Produces: `filtrarProdutos` usando o utilitário canônico

- [x] **Step 1: Substituir normalizador inline por `normalizarParaBusca` em `produtos-saldo-filtro.ts`**

Em `src/lib/produtos-saldo-filtro.ts`:
Substituir:
`const normalizar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();`
por importação de `normalizarParaBusca` de `./texto`.

- [x] **Step 2: Executar a suíte de testes de produtos-saldo-filtro**

Run: `pnpm vitest run src/lib/__tests__/produtos-saldo-filtro.test.ts`
Expected: PASS (25 tests passed)

- [x] **Step 3: Commit**

```bash
git add src/lib/produtos-saldo-filtro.ts
git commit -m "refactor(estoque): padroniza normalizacao de busca com normalizarParaBusca"
```

---

### Task 9: Central de Organizações (`supabase/functions/_shared/platform-admin/repository.ts`)

**Files:**
- Modify: `supabase/functions/_shared/platform-admin/repository.ts:135-136`

**Interfaces:**
- Produces: Filtro de organizações na carteira insensível a acentos

- [x] **Step 1: Aplicar normalização em `repository.ts`**

No método `wallet`:
```typescript
const normalizar = (s: string | null | undefined) =>
  s ? s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim() : '';

const needle = normalizar(input.search);
const organizations = (await loadOrganizations(!!input.include_test)).filter(
  (org) => !needle || normalizar(org.nome).includes(needle) || normalizar(org.slug).includes(needle)
);
```

- [x] **Step 2: Executar lint / deno check no backend**

Run: `npm run lint` ou deno check se configurado.

- [x] **Step 3: Commit**

```bash
git add supabase/functions/_shared/platform-admin/repository.ts
git commit -m "feat(platform-admin): torna busca de organizacoes insensivel a acentos"
```

---

### Task 10: Verificação Geral e Regressão

**Files:**
- Test: Executar todos os testes criados e modificados

- [x] **Step 1: Executar todos os testes das áreas alteradas**

Run: `pnpm vitest run src/lib/__tests__/texto.test.ts src/lib/__tests__/publicados-busca-acento.test.ts src/pages/__tests__/Revisao.busca.test.tsx src/lib/__tests__/pedidos-faturamento-busca.test.ts src/lib/__tests__/detalhe-vendas-busca.test.ts src/lib/__tests__/pulse-filtros-busca.test.ts src/lib/__tests__/produto-entrada-busca.test.ts src/lib/__tests__/produtos-saldo-filtro.test.ts`
Expected: ALL PASS

- [x] **Step 2: Typecheck do TypeScript**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors
