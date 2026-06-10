# Import só-planilha (reposição de estoque) + aviso de cor nova — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir importar só a planilha (imagens opcionais) para repor estoque de anúncios já publicados, e avisar proativamente na Revisão quando a planilha trouxer cores novas que precisam de foto.

**Architecture:** Mudança 100% frontend. O backend já detecta UPDATE por `codigo_pai`, já entra cor nova desmarcada e já sobe foto por cor (`VariacaoCard` → `BotaoTrocarFoto`). Duas mudanças: (1) relaxar o gate de imagens na tela "Novo lote"; (2) função pura que lista as cores novas sem foto + banner informativo no topo da Revisão.

**Tech Stack:** React 18 + TypeScript, Vitest, Tailwind/shadcn, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-06-10-import-so-planilha-estoque-design.md`

---

## File Structure

- `src/lib/cores-novas.ts` — **criar**. Função pura `coresNovasSemFoto(familias)` + tipo `FamiliaCorNova`. Responsabilidade única: derivar, a partir das famílias da Revisão, quais cores novas (UPDATE, sem variação no ML) ainda não têm foto, agrupadas por família.
- `tests/lib/cores-novas.test.ts` — **criar**. Testes da função pura.
- `src/pages/NovoLote.tsx` — **modificar**. Relaxar `podeProcessar` (imagens opcionais) + texto explicativo.
- `src/pages/Revisao.tsx` — **modificar**. Banner no topo da lista usando `coresNovasSemFoto`.

---

## Task 1: Função pura `coresNovasSemFoto`

**Files:**
- Create: `src/lib/cores-novas.ts`
- Test: `tests/lib/cores-novas.test.ts`

Contexto de tipos (de `src/lib/tipos-dominio.ts`, não alterar):
- `Familia` tem `codigoPai: string`, `titulo: string`, `operacao: 'CREATE' | 'UPDATE'`, `variacoes: Variacao[]`.
- `Variacao` tem `codigo: string`, `cor: string`, `mlVariationId: string | null`, `fotoPath?: string`.

Regra: uma cor é "nova sem foto" quando a família é `UPDATE`, a variação não tem `mlVariationId` (nunca foi ao ML) e não tem `fotoPath`. CREATE não conta (não é "cor nova de um anúncio existente"). Cor nova que já recebeu foto não conta. Marcada ou desmarcada conta igual (o aviso aparece assim que a cor chega).

- [ ] **Step 1: Write the failing test**

Crie `tests/lib/cores-novas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { coresNovasSemFoto, totalCoresNovasSemFoto } from '@/lib/cores-novas';
import type { Familia, Variacao } from '@/lib/tipos-dominio';

function variacao(over: Partial<Variacao>): Variacao {
  return {
    codigo: '00000001',
    cor: 'Azul',
    corHex: '#0000ff',
    corOrigem: 'descricao',
    corEditadaPeloOperador: false,
    preco: 10,
    precoPublicacao: 10,
    estoque: 5,
    gtin: null,
    fotoPath: undefined,
    excluidaDaPublicacao: false,
    mlVariationId: null,
    estoqueAnterior: null,
    custo: null,
    pesoGramas: null,
    alturaCm: null,
    larguraCm: null,
    comprimentoCm: null,
    ...over,
  };
}

function familia(over: Partial<Familia>): Familia {
  return {
    id: 'f1',
    loteId: 'l1',
    codigoPai: '00000100',
    titulo: 'FITA EXEMPLO',
    descricao: '',
    operacao: 'UPDATE',
    estrategiaPreco: 'PROPRIO',
    estrategiaMotivo: '',
    concorrencia: 'sem',
    concorrenciaVendedores: 0,
    concorrenciaPrecoMin: null,
    analiseMercado: null,
    tipoAviamento: 'fita',
    categoriaMlId: 'MLB255054',
    precoMin: 0,
    precoMax: 0,
    precoAbaixo20pc: false,
    capaStoragePath: null,
    capa2StoragePath: null,
    variacaoPrincipalCodigo: null,
    variacoes: [],
    status: 'pronto',
    tokensInput: null,
    tokensOutput: null,
    custoCentavos: null,
    tituloEditadoPeloOperador: false,
    descricaoEditadaPeloOperador: false,
    variacoesSemCor: 0,
    mlPermalink: null,
    mlItemId: 'MLB1',
    mudancaEstrutural: null,
    erroMensagem: null,
    exibirComDesconto: false,
    descontoPct: null,
    ...over,
  };
}

describe('coresNovasSemFoto', () => {
  it('lista a cor nova de UPDATE sem mlVariationId e sem foto', () => {
    const f = familia({
      variacoes: [
        variacao({ codigo: '00000101', mlVariationId: 'V1', fotoPath: 'a.jpg' }), // casada
        variacao({ codigo: '00000102', mlVariationId: null, fotoPath: undefined }), // nova sem foto
      ],
    });
    const r = coresNovasSemFoto([f]);
    expect(r).toEqual([
      { codigoPai: '00000100', titulo: 'FITA EXEMPLO', codigos: ['00000102'] },
    ]);
    expect(totalCoresNovasSemFoto([f])).toBe(1);
  });

  it('ignora cor nova que já tem foto', () => {
    const f = familia({
      variacoes: [variacao({ codigo: '00000102', mlVariationId: null, fotoPath: 'nova.jpg' })],
    });
    expect(coresNovasSemFoto([f])).toEqual([]);
    expect(totalCoresNovasSemFoto([f])).toBe(0);
  });

  it('ignora famílias CREATE (não são reposição de anúncio existente)', () => {
    const f = familia({
      operacao: 'CREATE',
      variacoes: [variacao({ codigo: '00000102', mlVariationId: null, fotoPath: undefined })],
    });
    expect(coresNovasSemFoto([f])).toEqual([]);
  });

  it('conta cor nova mesmo desmarcada (opt-in)', () => {
    const f = familia({
      variacoes: [variacao({ codigo: '00000102', mlVariationId: null, fotoPath: undefined, excluidaDaPublicacao: true })],
    });
    expect(totalCoresNovasSemFoto([f])).toBe(1);
  });

  it('retorna vazio quando não há cores novas sem foto', () => {
    const f = familia({
      variacoes: [variacao({ codigo: '00000101', mlVariationId: 'V1', fotoPath: 'a.jpg' })],
    });
    expect(coresNovasSemFoto([f])).toEqual([]);
    expect(totalCoresNovasSemFoto([f])).toBe(0);
  });

  it('agrupa por família, somando entre várias famílias', () => {
    const f1 = familia({
      codigoPai: '00000100', titulo: 'FITA A',
      variacoes: [
        variacao({ codigo: '00000102', mlVariationId: null }),
        variacao({ codigo: '00000103', mlVariationId: null }),
      ],
    });
    const f2 = familia({
      id: 'f2', codigoPai: '00000200', titulo: 'FITA B',
      variacoes: [variacao({ codigo: '00000201', mlVariationId: null })],
    });
    expect(coresNovasSemFoto([f1, f2])).toEqual([
      { codigoPai: '00000100', titulo: 'FITA A', codigos: ['00000102', '00000103'] },
      { codigoPai: '00000200', titulo: 'FITA B', codigos: ['00000201'] },
    ]);
    expect(totalCoresNovasSemFoto([f1, f2])).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- cores-novas`
Expected: FAIL — "Failed to resolve import '@/lib/cores-novas'" (módulo ainda não existe).

- [ ] **Step 3: Write minimal implementation**

Crie `src/lib/cores-novas.ts`:

```ts
import type { Familia } from './tipos-dominio';

export interface FamiliaCorNova {
  codigoPai: string;
  titulo: string;
  codigos: string[];
}

// Cor nova de um anúncio já publicado (UPDATE) que ainda não tem foto. A cor nova
// entra desmarcada e fica silenciosa até ser incluída; este aviso a expõe assim que
// chega na planilha. CREATE não conta (não é reposição de um anúncio existente).
export function coresNovasSemFoto(familias: Familia[]): FamiliaCorNova[] {
  const out: FamiliaCorNova[] = [];
  for (const f of familias) {
    if (f.operacao !== 'UPDATE') continue;
    const codigos = f.variacoes
      .filter((v) => !v.mlVariationId && !v.fotoPath)
      .map((v) => v.codigo);
    if (codigos.length > 0) {
      out.push({ codigoPai: f.codigoPai, titulo: f.titulo, codigos });
    }
  }
  return out;
}

export function totalCoresNovasSemFoto(familias: Familia[]): number {
  return coresNovasSemFoto(familias).reduce((acc, f) => acc + f.codigos.length, 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- cores-novas`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cores-novas.ts tests/lib/cores-novas.test.ts
git commit -m "feat(revisao): coresNovasSemFoto — deriva cores novas de UPDATE sem foto"
```

---

## Task 2: Imagens opcionais na tela "Novo lote"

**Files:**
- Modify: `src/pages/NovoLote.tsx`

O hook `useUploadLote` e a edge `ingest-lote` já toleram zero imagens (loop de upload não roda, grava `imagens_paths: []`). Só o gate da tela bloqueia.

- [ ] **Step 1: Relaxar o gate `podeProcessar`**

Em `src/pages/NovoLote.tsx`, troque a linha:

```ts
  const podeProcessar = planilha.length === 1 && imagens.length > 0;
```

por:

```ts
  // Imagens são opcionais: reposição de estoque sobe só a planilha. Lotes novos /
  // cores novas pedem fotos, completáveis na Revisão (aviso + botão por cor).
  const podeProcessar = planilha.length === 1;
```

- [ ] **Step 2: Atualizar o subtítulo e o hint da dropzone de imagens**

No mesmo arquivo, troque o `subtitle` do `PageHeader`:

```tsx
      <PageHeader title="Novo lote" subtitle="Envie a planilha e as imagens do lote para processar." />
```

por:

```tsx
      <PageHeader
        title="Novo lote"
        subtitle="Envie a planilha. As imagens são opcionais: numa reposição de estoque, suba só a planilha."
      />
```

E troque o `hint` da `Dropzone` de imagens:

```tsx
            hint="Arraste as pastas aqui (pode ser várias de uma vez) ou use o botão abaixo. As fotos acumulam."
```

por:

```tsx
            hint="Opcional. Em reposição de estoque, pode deixar vazio. Cores novas e lotes novos pedem fotos — você completa na Revisão. As fotos acumulam."
```

- [ ] **Step 3: Verificar build + lint**

Run: `pnpm build && pnpm lint`
Expected: build sem erros de tipo; lint 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/NovoLote.tsx
git commit -m "feat(novo-lote): imagens opcionais (importar só a planilha p/ reposição)"
```

---

## Task 3: Banner "cores novas precisam de foto" na Revisão

**Files:**
- Modify: `src/pages/Revisao.tsx`

- [ ] **Step 1: Importar a função pura**

Em `src/pages/Revisao.tsx`, junto aos imports existentes (depois do import de `publicavel`), adicione:

```ts
import { coresNovasSemFoto, totalCoresNovasSemFoto } from '@/lib/cores-novas';
```

- [ ] **Step 2: Derivar a lista (memoizada) ao lado de `visiveis`**

Logo após a linha:

```ts
  const visiveis = useMemo(() => filtrarFamilias(familias, filtro, busca), [familias, filtro, busca]);
```

adicione:

```ts
  const coresNovas = useMemo(() => coresNovasSemFoto(familias), [familias]);
  const totalCoresNovas = useMemo(() => totalCoresNovasSemFoto(familias), [familias]);
```

- [ ] **Step 3: Renderizar o banner**

No JSX, logo antes do bloco `{loteId && (` que contém a `DropZoneImagensExistente` (a `<div className="border-b bg-background px-3 py-2">`), insira:

```tsx
      {totalCoresNovas > 0 && (
        <div className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning">
          <strong>{totalCoresNovas} cor(es) nova(s)</strong> vieram na planilha e precisam de foto
          para publicar. Expanda{' '}
          {coresNovas.map((f, i) => (
            <span key={f.codigoPai}>
              {i > 0 && ', '}
              <span className="font-medium">{f.titulo || f.codigoPai}</span> ({f.codigos.length})
            </span>
          ))}{' '}
          e use o botão de foto em cada cor nova.
        </div>
      )}
```

- [ ] **Step 4: Verificar build + lint + testes**

Run: `pnpm build && pnpm lint && pnpm test -- cores-novas`
Expected: build sem erros; lint 0 errors; testes da função pura passando.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Revisao.tsx
git commit -m "feat(revisao): banner avisa cores novas sem foto após import só-planilha"
```

---

## Verificação final (após as 3 tasks)

- [ ] Suíte completa: `pnpm test` — todos verdes (os testes existentes + 6 novos).
- [ ] `pnpm build && pnpm lint` — limpos.
- [ ] Conferência manual do fluxo descrito na §4 do spec (reposição pura sobe só planilha; cor nova dispara o banner; botão de foto por cor já funciona).

---

## Cobertura do spec (self-review)

- §3.1 Import só-planilha → Task 2.
- §3.2 Foto por cor (já existe) → nenhuma task (confirmado no plano; `BotaoTrocarFoto` cobre).
- §3.3 Sinalização proativa → Task 1 (função pura + testes) + Task 3 (banner).
- §7 Testes → Task 1 cobre a função pura; relaxação do gate e banner são UI (convenção: sem teste).
- Nenhuma mudança de backend/schema/edge — coerente com a §2/§6 do spec.
