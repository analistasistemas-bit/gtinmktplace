# Publicação CREATE no Mercado Livre — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o operador selecione famílias (excluindo cores específicas) na tela de Revisão e publique cada uma como 1 anúncio CREATE no Mercado Livre, com fotos e variações nativas.

**Architecture:** Front valida "publicável" localmente (função pura) e bloqueia incompletas. Ao publicar, chama a edge `publicar-familias` (claim `status='publicando'` + enfileira no QStash, server-side). O worker `publish-familia-ml` (1 por família, via QStash) sobe fotos para `/pictures`, monta o payload e faz `POST /items`, persistindo `ml_item_id`/`ml_variation_id`. O Relatório acompanha ao vivo.

**Tech Stack:** React + TS + TanStack Query (front); Supabase Edge Functions (Deno) + QStash + Mercado Livre API (back); vitest (TDD das funções puras).

**Spec:** [2026-06-03-m4-publicacao-create-design.md](../specs/2026-06-03-m4-publicacao-create-design.md)

**Decisão de implementação (registrar):** a pré-condição "atributos obrigatórios completos" do spec §4.1 é validada no **backend** (`publish-familia-ml` roda `atributosFaltantes` antes do `POST /items` e falha com motivo claro). No **front**, `familiaPublicavel` usa `categoriaMlId != null` como proxy de atributos (no v17 `montarAtributosML` sempre preenche os obrigatórios para tipos conhecidos), evitando duplicar lógica Deno↔front. As demais pré-condições (cor, foto, preço, status) são checadas no front.

---

## File Structure

**Backend (Deno):**
- Create `supabase/functions/_shared/ml/publicar.ts` — `montarPayloadItem()` (puro) + tipos do payload
- Modify `supabase/functions/_shared/queue.ts` — `enfileirarPublicacao()`
- Create `supabase/functions/_shared/ml/fotos.ts` — `subirFotoML()` (POST /pictures)
- Create `supabase/functions/_shared/ml/criar-item.ts` — `criarItemML()` (POST /items)
- Create `supabase/functions/publicar-familias/index.ts` — edge de disparo
- Create `supabase/functions/publish-familia-ml/index.ts` — worker

**Frontend:**
- Create `src/lib/publicavel.ts` — `familiaPublicavel()` (puro)
- Create `src/lib/publicar.ts` — `publicarFamilias()` + `setVariacaoExcluida()`
- Modify `src/lib/tipos-dominio.ts` — `Variacao.excluidaDaPublicacao`
- Modify `src/lib/queries.ts` + `src/lib/database.types.ts` — mapear coluna nova
- Modify `src/components/familia-row.tsx` — selo + checkbox condicional
- Modify `src/components/familia-expanded.tsx` — checkbox "incluir" por cor
- Modify `src/pages/Revisao.tsx` — filtro Incompletas, footer Publicar, modal
- Modify `src/pages/Relatorio.tsx` — dados reais

---

## Fase A — Schema e adapters

### Task 1: Migration `excluida_da_publicacao`

**Files:**
- Migration via MCP `apply_migration` (name: `add_excluida_da_publicacao_variacoes`)
- Modify: `src/lib/database.types.ts` (Row/Insert/Update de `variacoes`)

- [ ] **Step 1: Aplicar a migration via MCP**

```sql
ALTER TABLE public.variacoes
  ADD COLUMN IF NOT EXISTS excluida_da_publicacao boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Regenerar tipos via MCP `generate_typescript_types` e atualizar `database.types.ts`**

Adicionar em ordem alfabética nas 3 seções de `variacoes` (Row sem `?`, Insert/Update com `?`):
```ts
excluida_da_publicacao: boolean   // Row
excluida_da_publicacao?: boolean  // Insert e Update
```

- [ ] **Step 3: Verificar build**

Run: `pnpm build`
Expected: build OK, sem erro de tipo.

- [ ] **Step 4: Commit**

```bash
git add src/lib/database.types.ts
git commit -m "feat(m4): coluna variacoes.excluida_da_publicacao (publicacao CREATE)"
```

---

### Task 2: Expor `excluidaDaPublicacao` no adapter

**Files:**
- Modify: `src/lib/tipos-dominio.ts` (interface `Variacao`)
- Modify: `src/lib/queries.ts` (`variacaoFromRow`)
- Test: `tests/lib/variacao-adapter.test.ts`

- [ ] **Step 1: Escrever o teste**

```ts
import { describe, it, expect } from 'vitest';
import { variacaoFromRow } from '../../src/lib/queries';
import type { Database } from '../../src/lib/database.types';

type VariacaoRow = Database['public']['Tables']['variacoes']['Row'];

function baseRow(over: Partial<VariacaoRow>): VariacaoRow {
  return {
    id: 'v1', familia_id: 'f1', user_id: 'u1', codigo: '00000101',
    cor: 'Azul', cor_hex: '#00f', cor_origem: 'descricao',
    cor_editada_pelo_operador: false, preco: 10, preco_publicacao: 9,
    preco_editado_pelo_operador: false, estoque: 5, gtin: null,
    imagem_path: 'u1/l1/00000101.jpeg', altura_cm: 1, largura_cm: 1,
    comprimento_cm: 1, peso_gramas: 1, ml_picture_id: null,
    ml_variation_id: null, excluida_da_publicacao: false,
    atualizado_em: '', criado_em: '',
    ...over,
  };
}

describe('variacaoFromRow', () => {
  it('mapeia excluida_da_publicacao', () => {
    expect(variacaoFromRow(baseRow({ excluida_da_publicacao: true })).excluidaDaPublicacao).toBe(true);
    expect(variacaoFromRow(baseRow({ excluida_da_publicacao: false })).excluidaDaPublicacao).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- --run tests/lib/variacao-adapter.test.ts`
Expected: FAIL (`excluidaDaPublicacao` é undefined).

- [ ] **Step 3: Implementar**

Em `src/lib/tipos-dominio.ts`, adicionar ao fim da interface `Variacao`:
```ts
  excluidaDaPublicacao: boolean;
```

Em `src/lib/queries.ts`, dentro de `variacaoFromRow`, antes do `};` final:
```ts
    excluidaDaPublicacao: r.excluida_da_publicacao,
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- --run tests/lib/variacao-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Corrigir mocks de Variacao que quebrem o build**

Run: `pnpm build` — se algum teste/mock constrói `Variacao` literal sem o campo, adicionar `excluidaDaPublicacao: false`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tipos-dominio.ts src/lib/queries.ts tests/lib/variacao-adapter.test.ts
git commit -m "feat(m4): expor excluidaDaPublicacao no adapter de variacao"
```

---

## Fase B — Validação "publicável" e UX da seleção

### Task 3: Função pura `familiaPublicavel`

**Files:**
- Create: `src/lib/publicavel.ts`
- Test: `tests/lib/publicavel.test.ts`

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, it, expect } from 'vitest';
import { familiaPublicavel } from '../../src/lib/publicavel';
import type { Familia, Variacao } from '../../src/lib/tipos-dominio';

function cor(over: Partial<Variacao>): Variacao {
  return {
    codigo: '00000101', cor: 'Azul', corHex: '#00f', corOrigem: 'descricao',
    corEditadaPeloOperador: false, preco: 10, precoPublicacao: 9, estoque: 5,
    gtin: null, fotoPath: 'u/l/101.jpeg', excluidaDaPublicacao: false,
    ...over,
  };
}
function fam(over: Partial<Familia>): Familia {
  return {
    id: 'f1', loteId: 'l1', codigoPai: '00000100', titulo: 'LINHA', descricao: 'd',
    operacao: 'CREATE', estrategiaPreco: 'PROPRIO', estrategiaMotivo: '',
    concorrencia: 'sem', concorrenciaVendedores: 0, concorrenciaPrecoMin: null,
    analiseMercado: null, tipoAviamento: 'linha', categoriaMlId: 'MLB270273',
    precoMin: 9, precoMax: 9, precoAbaixo20pc: false, capaStoragePath: null,
    variacoes: [cor({})], status: 'pronto', tokensInput: null, tokensOutput: null,
    custoCentavos: null, tituloEditadoPeloOperador: false,
    descricaoEditadaPeloOperador: false, variacoesSemCor: 0,
    ...over,
  };
}

describe('familiaPublicavel', () => {
  it('família completa é publicável', () => {
    expect(familiaPublicavel(fam({})).ok).toBe(true);
  });
  it('status diferente de pronto bloqueia', () => {
    const r = familiaPublicavel(fam({ status: 'processando' }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/pronta|processament/i);
  });
  it('operação UPDATE não é CREATE-publicável', () => {
    expect(familiaPublicavel(fam({ operacao: 'UPDATE' })).ok).toBe(false);
  });
  it('sem categoria bloqueia', () => {
    const r = familiaPublicavel(fam({ categoriaMlId: null, tipoAviamento: 'outro' }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/categoria/i);
  });
  it('cor incluída sem foto bloqueia, mencionando a cor', () => {
    const r = familiaPublicavel(fam({ variacoes: [cor({ cor: 'Verde', fotoPath: undefined })] }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/Verde.*foto|foto.*Verde/i);
  });
  it('cor incluída sem nome de cor bloqueia', () => {
    const r = familiaPublicavel(fam({ variacoes: [cor({ cor: '' })] }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/cor/i);
  });
  it('cor sem preço de publicação bloqueia', () => {
    const r = familiaPublicavel(fam({ variacoes: [cor({ precoPublicacao: null })] }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/pre[çc]o/i);
  });
  it('cor problemática EXCLUÍDA não bloqueia se sobra ≥1 cor boa', () => {
    const r = familiaPublicavel(fam({
      variacoes: [cor({}), cor({ codigo: '00000102', cor: 'Verde', fotoPath: undefined, excluidaDaPublicacao: true })],
    }));
    expect(r.ok).toBe(true);
  });
  it('todas as cores excluídas bloqueia (≥1 obrigatória)', () => {
    const r = familiaPublicavel(fam({ variacoes: [cor({ excluidaDaPublicacao: true })] }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/nenhuma cor|ao menos|pelo menos/i);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- --run tests/lib/publicavel.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
import type { Familia } from './tipos-dominio';

export interface ResultadoPublicavel {
  ok: boolean;
  motivos: string[];
}

export function familiaPublicavel(familia: Familia): ResultadoPublicavel {
  const motivos: string[] = [];

  if (familia.status !== 'pronto') motivos.push('Ainda em processamento (aguarde ficar "pronta")');
  if (familia.operacao !== 'CREATE') motivos.push('Já publicada (CREATE só vale para famílias novas)');
  if (!familia.categoriaMlId) motivos.push('Categoria indefinida');

  const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  if (incluidas.length === 0) {
    motivos.push('Nenhuma cor incluída (ao menos 1 obrigatória)');
  }
  for (const v of incluidas) {
    if (!v.cor) motivos.push(`Cor ${v.codigo} sem cor definida`);
    if (!v.fotoPath) motivos.push(`Cor ${v.cor || v.codigo} sem foto`);
    if (!v.precoPublicacao || v.precoPublicacao <= 0) motivos.push(`Cor ${v.cor || v.codigo} sem preço de publicação`);
  }

  return { ok: motivos.length === 0, motivos };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- --run tests/lib/publicavel.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/publicavel.ts tests/lib/publicavel.test.ts
git commit -m "feat(m4): familiaPublicavel valida pre-condicoes de publicacao (TDD)"
```

---

### Task 4: Persistir exclusão de cor + disparo de publicação (client lib)

**Files:**
- Create: `src/lib/publicar.ts`

- [ ] **Step 1: Implementar (sem teste unitário — I/O com Supabase; validado no bug bash)**

```ts
import { supabase } from './supabase';

/** Marca/desmarca a cor para exclusão da publicação (persiste na hora). */
export async function setVariacaoExcluida(variacaoId: string, excluida: boolean): Promise<void> {
  const { error } = await supabase
    .from('variacoes')
    .update({ excluida_da_publicacao: excluida })
    .eq('id', variacaoId);
  if (error) throw new Error(`Falha ao atualizar exclusão: ${error.message}`);
}

export interface ResultadoPublicar {
  enfileiradas: number;
}

/** Dispara a publicação CREATE das famílias selecionadas (edge enfileira no QStash). */
export async function publicarFamilias(familiaIds: string[]): Promise<ResultadoPublicar> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão ativa');
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/publicar-familias`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ familia_ids: familiaIds }),
  });
  if (!resp.ok) {
    const texto = await resp.text();
    throw new Error(`Publicação falhou (${resp.status}): ${texto}`);
  }
  return resp.json();
}
```

- [ ] **Step 2: Verificar build**

Run: `pnpm build`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add src/lib/publicar.ts
git commit -m "feat(m4): client lib setVariacaoExcluida + publicarFamilias"
```

---

### Task 5: Selo publicável/incompleta na `FamiliaRow`

**Files:**
- Modify: `src/components/familia-row.tsx`
- Test: `tests/components/familia-row-publicavel.test.tsx`

- [ ] **Step 1: Escrever o teste**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FamiliaRow } from '@/components/familia-row';
import type { Familia } from '@/lib/tipos-dominio';

// reaproveite o helper fam() de tests/lib/publicavel.test.ts copiando o literal mínimo aqui
function fam(over: Partial<Familia>): Familia { /* ...mesmo literal da Task 3... */ return ({} as Familia); }

describe('FamiliaRow — selo de publicável', () => {
  it('família incompleta mostra cadeado e desabilita o checkbox', () => {
    const f = fam({ categoriaMlId: null, tipoAviamento: 'outro' });
    render(<FamiliaRow familia={f} selecionada={false} expandida={false} onSelecionar={() => {}} onExpandir={() => {}} />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByText(/categoria/i)).toBeInTheDocument();
  });
  it('família publicável mantém o checkbox habilitado', () => {
    render(<FamiliaRow familia={fam({})} selecionada={false} expandida={false} onSelecionar={() => {}} onExpandir={() => {}} />);
    expect(screen.getByRole('checkbox')).not.toBeDisabled();
  });
});
```

> Nota: copie o literal `fam()` completo da Task 3 (o engenheiro pode ler tasks fora de ordem).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- --run tests/components/familia-row-publicavel.test.tsx`
Expected: FAIL (checkbox não desabilita / motivo ausente).

- [ ] **Step 3: Implementar**

Em `src/components/familia-row.tsx`, importar e calcular:
```tsx
import { familiaPublicavel } from '@/lib/publicavel';
// dentro do componente:
const pub = familiaPublicavel(familia);
```
No `<Checkbox>`, adicionar `disabled={!pub.ok}`. Abaixo do bloco de nome/PAI, quando `!pub.ok`, renderizar o motivo (resumo + `title` com a lista):
```tsx
{!pub.ok && (
  <span
    className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
    title={pub.motivos.join('\n')}
  >
    🔒 {pub.motivos[0]}{pub.motivos.length > 1 ? ` (+${pub.motivos.length - 1})` : ''}
  </span>
)}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- --run tests/components/familia-row-publicavel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/familia-row.tsx tests/components/familia-row-publicavel.test.tsx
git commit -m "feat(m4): selo publicavel/incompleta na FamiliaRow"
```

---

### Task 6: Checkbox "incluir cor" no `FamiliaExpanded`

**Files:**
- Modify: `src/components/familia-expanded.tsx`

- [ ] **Step 1: Ler o componente e localizar o map das variações**

Run: `sed -n '1,80p' src/components/familia-expanded.tsx` — identificar onde cada variação é renderizada e como recebe `familia`.

- [ ] **Step 2: Implementar o checkbox de inclusão (otimista + persistência)**

Importar:
```tsx
import { Checkbox } from '@/components/ui/checkbox';
import { setVariacaoExcluida } from '@/lib/publicar';
import { useQueryClient } from '@tanstack/react-query';
import { QK } from '@/lib/queries';
```
Para cada variação com `v.id`, antes dos dados da cor, renderizar:
```tsx
<Checkbox
  checked={!v.excluidaDaPublicacao}
  aria-label={`Incluir cor ${v.cor || v.codigo} na publicação`}
  onCheckedChange={async (marcado) => {
    await setVariacaoExcluida(v.id!, marcado !== true);
    qc.invalidateQueries({ queryKey: QK.familias(familia.loteId) });
  }}
/>
```
(declarar `const qc = useQueryClient();` no topo do componente).

- [ ] **Step 3: Verificar build + lint**

Run: `pnpm build && pnpm lint`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add src/components/familia-expanded.tsx
git commit -m "feat(m4): checkbox incluir/excluir cor da publicacao no expandido"
```

---

### Task 7: Filtro "Incompletas", footer "Publicar" e modal de confirmação

**Files:**
- Modify: `src/pages/Revisao.tsx`
- Test: `tests/components/revisao-filtros.test.tsx` (estender — já existe)

- [ ] **Step 1: Estender o teste de filtros**

Em `tests/components/revisao-filtros.test.tsx`, adicionar caso para o filtro `incompletas` usando `filtrarFamilias`:
```ts
it('filtro incompletas só retorna famílias não-publicáveis', () => {
  const completa = /* fam publicável */;
  const incompleta = /* fam com categoriaMlId null */;
  const r = filtrarFamilias([completa, incompleta], 'incompletas', '');
  expect(r).toEqual([incompleta]);
});
```
(use os literais `fam()` da Task 3.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- --run tests/components/revisao-filtros.test.tsx`
Expected: FAIL (`'incompletas'` não é tipo válido / não filtra).

- [ ] **Step 3: Implementar o filtro**

Em `src/pages/Revisao.tsx`:
```ts
import { familiaPublicavel } from '@/lib/publicavel';
type FiltroOp = 'todos' | 'CREATE' | 'UPDATE' | 'avisos' | 'incompletas';
```
No `filtrarFamilias`, adicionar:
```ts
    if (filtro === 'incompletas' && familiaPublicavel(f).ok) return false;
```
Adicionar `'incompletas'` ao array de chips e ao `counts`:
```ts
incompletas: familias.filter((f) => !familiaPublicavel(f).ok).length,
```
No render dos chips, rótulo: `f === 'incompletas' ? '🔒 Incompletas (' + counts.incompletas + ')' : ...`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- --run tests/components/revisao-filtros.test.tsx`
Expected: PASS.

- [ ] **Step 5: Substituir o footer mock por Publicar + modal**

Trocar o bloco do footer (`{selecionadas.size > 0 && ...}`) por:
```tsx
{selecionadas.size > 0 && (
  <div className="flex items-center justify-between border-t bg-background px-4 py-3">
    <div className="text-sm text-muted-foreground">
      {selecionadas.size} família(s) · {coresSelecionadas} cor(es) selecionada(s)
    </div>
    <Button onClick={() => setConfirmando(true)}>Publicar selecionada{selecionadas.size > 1 ? 's' : ''} →</Button>
  </div>
)}
```
Onde:
```ts
const [confirmando, setConfirmando] = useState(false);
const [publicando, setPublicando] = useState(false);
const coresSelecionadas = familias
  .filter((f) => selecionadas.has(f.id))
  .reduce((acc, f) => acc + f.variacoes.filter((v) => !v.excluidaDaPublicacao).length, 0);
```
Garantir que só famílias publicáveis entram em `selecionadas` — no `toggleSelecao` da Revisão, ignorar ids não-publicáveis (a `FamiliaRow` já desabilita o checkbox, mas reforce).

- [ ] **Step 6: Adicionar o modal de confirmação**

Usar `Dialog` do shadcn (`@/components/ui/dialog`). Conteúdo:
```tsx
<Dialog open={confirmando} onOpenChange={setConfirmando}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Publicar no Mercado Livre</DialogTitle>
    </DialogHeader>
    <p className="text-sm">
      Vou publicar <strong>{selecionadas.size}</strong> família(s) como anúncios novos no
      Mercado Livre, com <strong>{coresSelecionadas}</strong> cor(es) no total. Confirmar?
    </p>
    <DialogFooter>
      <Button variant="outline" onClick={() => setConfirmando(false)}>Cancelar</Button>
      <Button disabled={publicando} onClick={confirmarPublicacao}>
        {publicando ? 'Enfileirando…' : 'Confirmar publicação'}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```
E a função:
```ts
async function confirmarPublicacao() {
  setPublicando(true);
  try {
    await publicarFamilias([...selecionadas]);
    setSelecionadas(new Set());
    setConfirmando(false);
    nav(`/relatorio/${loteId}`);
  } catch (e) {
    alert((e as Error).message);
  } finally {
    setPublicando(false);
  }
}
```
(importar `publicarFamilias` de `@/lib/publicar`, `useNavigate` de react-router, `Dialog*` do shadcn — rodar `npx shadcn@latest add dialog` se ainda não existir.)

- [ ] **Step 7: Verificar build + lint + testes**

Run: `pnpm build && pnpm lint && pnpm test -- --run`
Expected: tudo verde.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Revisao.tsx tests/components/revisao-filtros.test.tsx
git commit -m "feat(m4): filtro Incompletas + footer Publicar + modal de confirmacao"
```

---

## Fase C — Backend de publicação

### Task 8: `enfileirarPublicacao` na fila

**Files:**
- Modify: `supabase/functions/_shared/queue.ts`

- [ ] **Step 1: Adicionar a função (espelha `enfileirarFamilia`, alvo `publish-familia-ml`)**

```ts
export async function enfileirarPublicacao(job: ProcessFamiliaJob): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const target = `${url}/functions/v1/publish-familia-ml`;
  const { messageId } = await qstashClient().publishJSON({
    url: target,
    body: job,
    retries: 3,
  });
  return messageId;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/queue.ts
git commit -m "feat(m4): enfileirarPublicacao (QStash -> publish-familia-ml)"
```

---

### Task 9: `montarPayloadItem` (puro, TDD)

**Files:**
- Create: `supabase/functions/_shared/ml/publicar.ts`
- Test: `supabase/functions/_shared/ml/__tests__/publicar.test.ts`

> O formato exato do payload `/items` será refinado no bug bash (Task 13). Esta task fixa a estrutura conhecida do ADR-0009; os campos sob descoberta (GTIN, listing_type) ficam isolados em constantes/parâmetros para ajuste fácil.

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, it, expect } from 'vitest';
import { montarPayloadItem } from '../publicar';

const familia = {
  titulo_ml: 'Linha XIK 120 Várias Cores',
  descricao_ml: 'Descrição...',
  categoria_ml_id: 'MLB270273',
  atributos_ml: [{ id: 'BRAND', value_name: 'Avil' }, { id: 'MODEL', value_name: 'XIK 120' }],
};
const variacoes = [
  { codigo: '00000101', cor: 'Azul', estoque: 5, preco_publicacao: 9.9, gtin: '7891234567890', ml_picture_id: 'PIC1' },
  { codigo: '00000102', cor: 'Verde', estoque: 0, preco_publicacao: 9.9, gtin: null, ml_picture_id: 'PIC2' },
];
const capaPictureId = 'CAPA1';

describe('montarPayloadItem', () => {
  it('inclui título, categoria e atributos do pai', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    expect(p.title).toBe('Linha XIK 120 Várias Cores');
    expect(p.category_id).toBe('MLB270273');
    expect(p.attributes).toEqual(expect.arrayContaining([{ id: 'BRAND', value_name: 'Avil' }]));
  });
  it('cria uma variação por cor com cor, estoque, preço e picture_ids', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    expect(p.variations).toHaveLength(2);
    const azul = p.variations[0];
    expect(azul.available_quantity).toBe(5);
    expect(azul.price).toBe(9.9);
    expect(azul.picture_ids).toContain('PIC1');
    expect(azul.attribute_combinations).toEqual(
      expect.arrayContaining([{ id: 'COLOR', value_name: 'Azul' }]),
    );
  });
  it('pictures do item incluem capa + foto de cada cor', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    const ids = p.pictures.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['CAPA1', 'PIC1', 'PIC2']));
  });
  it('cor com GTIN inválido/nulo marca o atributo de "sem código universal"', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    const verde = p.variations[1];
    // GTIN null → não envia GTIN; marca EMPTY_GTIN_NUMBER (ajustado no bug bash, Task 13)
    expect(JSON.stringify(verde)).toMatch(/GTIN|código|EMPTY/i);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- --run supabase/functions/_shared/ml/__tests__/publicar.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
export interface AtributoItem { id: string; value_name?: string; value_id?: string; }
export interface PictureRef { id: string; }
export interface VariacaoItem {
  attribute_combinations: AtributoItem[];
  available_quantity: number;
  price: number;
  picture_ids: string[];
  attributes?: AtributoItem[];
  seller_custom_field?: string;
}
export interface PayloadItem {
  title: string;
  category_id: string;
  price?: number;
  currency_id: string;
  buying_mode: string;
  listing_type_id: string;
  condition: string;
  pictures: PictureRef[];
  attributes: AtributoItem[];
  variations: VariacaoItem[];
}

interface FamiliaInput {
  titulo_ml: string | null;
  descricao_ml: string | null;
  categoria_ml_id: string | null;
  atributos_ml: AtributoItem[];
}
interface VariacaoInput {
  codigo: string; cor: string | null; estoque: number;
  preco_publicacao: number | null; gtin: string | null; ml_picture_id: string | null;
}

// Defaults a confirmar contra a API real (Task 13).
const CURRENCY = 'BRL';
const BUYING_MODE = 'buy_it_now';
const LISTING_TYPE = 'gold_special';
const CONDITION = 'new';

function gtinValidoEan(gtin: string | null): boolean {
  if (!gtin) return false;
  if (/^3000/.test(gtin)) return false; // código interno, não-EAN
  return /^\d{8,14}$/.test(gtin);
}

export function montarPayloadItem(
  familia: FamiliaInput,
  variacoes: VariacaoInput[],
  capaPictureId: string | null,
): PayloadItem {
  const picIds = [
    ...(capaPictureId ? [capaPictureId] : []),
    ...variacoes.map((v) => v.ml_picture_id).filter((x): x is string => !!x),
  ];
  const pictures: PictureRef[] = [...new Set(picIds)].map((id) => ({ id }));

  const variations: VariacaoItem[] = variacoes.map((v) => {
    const variation: VariacaoItem = {
      attribute_combinations: [{ id: 'COLOR', value_name: v.cor ?? '' }],
      available_quantity: v.estoque,
      price: v.preco_publicacao ?? 0,
      picture_ids: v.ml_picture_id ? [v.ml_picture_id] : [],
      seller_custom_field: v.codigo,
    };
    if (gtinValidoEan(v.gtin)) {
      variation.attributes = [{ id: 'GTIN', value_name: v.gtin! }];
    } else {
      // Sem código universal — id/forma exatos confirmados no bug bash (Task 13).
      variation.attributes = [{ id: 'GTIN', value_name: 'EMPTY_GTIN_NUMBER' }];
    }
    return variation;
  });

  return {
    title: familia.titulo_ml ?? '',
    category_id: familia.categoria_ml_id ?? '',
    currency_id: CURRENCY,
    buying_mode: BUYING_MODE,
    listing_type_id: LISTING_TYPE,
    condition: CONDITION,
    pictures,
    attributes: familia.atributos_ml ?? [],
    variations,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- --run supabase/functions/_shared/ml/__tests__/publicar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/publicar.ts supabase/functions/_shared/ml/__tests__/publicar.test.ts
git commit -m "feat(m4): montarPayloadItem para POST /items (TDD, defaults a confirmar)"
```

---

### Task 10: Helpers de chamada ML (`subirFotoML`, `criarItemML`)

**Files:**
- Create: `supabase/functions/_shared/ml/fotos.ts`
- Create: `supabase/functions/_shared/ml/criar-item.ts`

> Sem teste unitário (I/O HTTP com a API real) — validado no bug bash. Mantenha cada um pequeno e com erro legível.

- [ ] **Step 1: `subirFotoML`**

```ts
// supabase/functions/_shared/ml/fotos.ts
export async function subirFotoML(accessToken: string, sourceUrl: string): Promise<string> {
  const resp = await fetch('https://api.mercadolibre.com/pictures/items/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: sourceUrl }),
  });
  if (!resp.ok) {
    throw new Error(`Falha ao subir foto (${resp.status}): ${await resp.text()}`);
  }
  const json = await resp.json();
  return json.id as string;
}
```
> Endpoint exato (`/pictures/items/upload` vs `/pictures`) confirmado no bug bash (Task 13).

- [ ] **Step 2: `criarItemML`**

```ts
// supabase/functions/_shared/ml/criar-item.ts
import type { PayloadItem } from './publicar.ts';

export interface ResultadoItem {
  id: string;
  permalink: string;
  variations: Array<{ id: string | number; seller_custom_field?: string }>;
}

export async function criarItemML(accessToken: string, payload: PayloadItem): Promise<ResultadoItem> {
  const resp = await fetch('https://api.mercadolibre.com/items', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await resp.json();
  if (!resp.ok) {
    const detalhe = json?.message ?? JSON.stringify(json);
    const e = new Error(`ML rejeitou (${resp.status}): ${detalhe}`);
    (e as { status?: number }).status = resp.status;
    throw e;
  }
  return { id: json.id, permalink: json.permalink, variations: json.variations ?? [] };
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/ml/fotos.ts supabase/functions/_shared/ml/criar-item.ts
git commit -m "feat(m4): helpers subirFotoML + criarItemML"
```

---

### Task 11: Edge `publicar-familias` (disparo)

**Files:**
- Create: `supabase/functions/publicar-familias/index.ts`

> Padrão: auth de usuário (`requireUser`), `verify_jwt:false` no deploy (valida via `requireUser`), igual ao `ingest-lote`.

- [ ] **Step 1: Implementar**

```ts
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { enfileirarPublicacao } from '../_shared/queue.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let user;
  try { user = await requireUser(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const { familia_ids } = await req.json().catch(() => ({}));
  if (!Array.isArray(familia_ids) || familia_ids.length === 0) {
    return new Response('familia_ids obrigatório', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();
  // Claim atômico: só famílias do usuário, CREATE, status pronto, ainda não publicadas.
  const { data: alvo, error } = await admin
    .from('familias')
    .update({ status: 'publicando' })
    .in('id', familia_ids)
    .eq('user_id', user.id)
    .eq('operacao', 'CREATE')
    .eq('status', 'pronto')
    .is('ml_item_id', null)
    .select('id, lote_id');
  if (error) return new Response(`Erro no claim: ${error.message}`, { status: 500, headers: corsHeaders });

  let enfileiradas = 0;
  for (const f of alvo ?? []) {
    const messageId = await enfileirarPublicacao({ familia_id: f.id, lote_id: f.lote_id });
    await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', f.id);
    enfileiradas++;
  }
  if (alvo && alvo[0]) {
    await admin.from('lotes').update({ status: 'publicando' }).eq('id', alvo[0].lote_id);
  }

  return new Response(JSON.stringify({ enfileiradas }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 2: Deploy via MCP `deploy_edge_function`**

`name: publicar-familias`, `verify_jwt: false`, `entrypoint_path: index.ts`. Incluir `index.ts` (imports `./_shared/...`) + `_shared/cors.ts`, `_shared/auth.ts`, `_shared/supabase.ts`, `_shared/queue.ts`. (Converter `../_shared/` → `./_shared/` no index.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/publicar-familias/index.ts
git commit -m "feat(m4): edge publicar-familias (claim status + enfileira no QStash)"
```

---

### Task 12: Worker `publish-familia-ml`

**Files:**
- Create: `supabase/functions/publish-familia-ml/index.ts`

> Idempotente (ADR-0006): se `ml_item_id` já existe, retorna. Padrão de assinatura QStash igual ao `process-familia`.

- [ ] **Step 1: Implementar**

```ts
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { subirFotoML } from '../_shared/ml/fotos.ts';
import { montarPayloadItem } from '../_shared/ml/publicar.ts';
import { criarItemML } from '../_shared/ml/criar-item.ts';
import { atributosFaltantes } from '../_shared/categoria/atributos.ts';

interface Job { familia_id: string; lote_id: string; }

const BUCKET = 'imagens';
const TTL_SIGNED = 60 * 60 * 2; // 2h — ML baixa a foto de forma assíncrona (gap §569)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }
  const job: Job = JSON.parse(body);
  const admin = adminClient();

  const { data: familia } = await admin.from('familias').select('*').eq('id', job.familia_id).single();
  if (!familia) return new Response('familia não encontrada', { status: 404, headers: corsHeaders });
  if (familia.ml_item_id) {
    return new Response(JSON.stringify({ jaPublicado: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const { data: variacoes } = await admin.from('variacoes')
      .select('*').eq('familia_id', job.familia_id).eq('excluida_da_publicacao', false);
    if (!variacoes || variacoes.length === 0) throw new Error('Sem cores incluídas para publicar');

    // Pré-condição de atributos (spec §4.1, validada server-side).
    const faltam = atributosFaltantes(familia.tipo_aviamento, familia.atributos_ml ?? []);
    if (faltam.length) throw new Error(`Atributos obrigatórios faltando: ${faltam.join(', ')}`);

    const token = await getValidAccessToken(familia.user_id);

    async function signed(path: string): Promise<string> {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL_SIGNED);
      if (error || !data) throw new Error(`Signed URL falhou para ${path}`);
      return data.signedUrl;
    }

    let capaPictureId: string | null = null;
    if (familia.capa_storage_path) {
      capaPictureId = await subirFotoML(token, await signed(familia.capa_storage_path));
    }
    const variacoesComFoto = [];
    for (const v of variacoes) {
      let picId = v.ml_picture_id as string | null;
      if (!picId && v.imagem_path) {
        picId = await subirFotoML(token, await signed(v.imagem_path));
        await admin.from('variacoes').update({ ml_picture_id: picId }).eq('id', v.id);
      }
      variacoesComFoto.push({ ...v, ml_picture_id: picId });
    }

    const payload = montarPayloadItem(
      { titulo_ml: familia.titulo_ml, descricao_ml: familia.descricao_ml, categoria_ml_id: familia.categoria_ml_id, atributos_ml: familia.atributos_ml ?? [] },
      variacoesComFoto.map((v) => ({ codigo: v.codigo, cor: v.cor, estoque: v.estoque, preco_publicacao: v.preco_publicacao, gtin: v.gtin, ml_picture_id: v.ml_picture_id })),
      capaPictureId,
    );

    const resultado = await criarItemML(token, payload);

    await admin.from('familias').update({
      ml_item_id: resultado.id,
      ml_permalink: resultado.permalink,
      status: 'publicado',
      publicado_em: new Date().toISOString(),
    }).eq('id', job.familia_id);

    for (const mv of resultado.variations) {
      if (mv.seller_custom_field) {
        await admin.from('variacoes').update({ ml_variation_id: String(mv.id) })
          .eq('familia_id', job.familia_id).eq('codigo', mv.seller_custom_field);
      }
    }

    return new Response(JSON.stringify({ ml_item_id: resultado.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;
    await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', job.familia_id);
    // 5xx/429 → relança para o QStash retentar; 4xx → 200 (não retentar, erro persistido).
    if (status && status >= 500) return new Response(msg, { status: 500, headers: corsHeaders });
    return new Response(JSON.stringify({ erro: msg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
```

- [ ] **Step 2: Deploy via MCP `deploy_edge_function`**

`name: publish-familia-ml`, `verify_jwt: false`, incluir `index.ts` + todo o grafo `_shared/` usado (`cors`, `supabase`, `queue`, `ml/token`, `ml/fotos`, `ml/publicar`, `ml/criar-item`, `categoria/atributos` + dependências transitivas de cada um — `ml/token` puxa redis/etc.). Converter `../_shared/` → `./_shared/`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/publish-familia-ml/index.ts
git commit -m "feat(m4): worker publish-familia-ml (fotos + POST /items + persistencia)"
```

---

## Fase D — Relatório

### Task 13: Bug bash com 1 família real (descobertas da API)

> **Esta é a task de descoberta.** Resolve os 3 pontos do spec §5.4 ajustando `montarPayloadItem` (Task 9) e `subirFotoML` (Task 10) conforme a API real, com o token AVILBV.

- [ ] **Step 1: Subir um lote novo pela UI** (1 família simples com 1–2 cores, fotos e GTIN válido) e processar até `status='pronto'`.

- [ ] **Step 2: Publicar pela UI** e observar `familias.erro_mensagem` se falhar.

- [ ] **Step 3: Iterar sobre os 3 pontos de descoberta** (re-deploy do worker a cada ajuste):
  - **GTIN inválido/interno:** descobrir o atributo correto. Rodar via MCP/HTTP: `GET https://api.mercadolibre.com/categories/MLB270273/attributes` (com token), achar o atributo de código universal e o `value_id` de "não tem". Ajustar `montarPayloadItem` (o ramo `else` do GTIN).
  - **`listing_type_id`/`condition`/`buying_mode`:** confirmar valores aceitos para a conta (`GET /sites/MLB/listing_types`). Ajustar constantes.
  - **Endpoint/forma da foto:** confirmar `/pictures/items/upload` e o uso de `picture_ids` nas variações.

- [ ] **Step 4: Validar 1 publicação real bem-sucedida** — anúncio aparece no ML com fotos, cores, preço; `ml_item_id`/`ml_permalink`/`ml_variation_id` persistidos.

- [ ] **Step 5: Atualizar os testes de `montarPayloadItem`** para o formato final descoberto e rodar `pnpm test -- --run`.

- [ ] **Step 6: Commit** (e ADR de fechamento se surgir decisão nova, ex.: tratamento do GTIN interno)

```bash
git add -A
git commit -m "fix(m4): ajustes de payload/foto do POST /items validados com token real"
```

---

### Task 14: Tela de Relatório com dados reais

**Files:**
- Modify: `src/pages/Relatorio.tsx`

- [ ] **Step 1: Ler o mock atual**

Run: `sed -n '1,80p' src/pages/Relatorio.tsx` — identificar a estrutura dos cards e da lista.

- [ ] **Step 2: Consumir famílias reais + acompanhamento ao vivo**

Reusar `useFamilias(loteId)` + `useLote(loteId)` + `useLoteRealtime(loteId)` com polling fallback enquanto houver família `publicando` (mesmo padrão de `Progresso.tsx`):
```tsx
const publicando = familias.some((f) => f.status === 'publicando');
const { data: familias = [] } = useFamilias(loteId, { refetchInterval: publicando ? 2500 : undefined });
```
Cards de resumo:
```tsx
const publicadas = familias.filter((f) => f.status === 'publicado').length;
const emPublicacao = familias.filter((f) => f.status === 'publicando').length;
const comErro = familias.filter((f) => f.status === 'erro').length;
```
Lista por família:
- `status==='publicado'` → link `f.mlPermalink` (expor no adapter `familiaFromRow` se ainda não exposto: `mlPermalink: r.ml_permalink`, `mlItemId: r.ml_item_id` no tipo `Familia`).
- `status==='publicando'` → "publicando…".
- `status==='erro'` → `f.erroMensagem` (expor `erroMensagem: r.erro_mensagem` no adapter) + botão "Editar e tentar de novo" → `nav('/revisao/' + loteId)`.

- [ ] **Step 3: Expor campos faltantes no adapter**

Em `src/lib/tipos-dominio.ts` (interface `Familia`) e `familiaFromRow`: adicionar `mlPermalink: string | null`, `mlItemId: string | null`, `erroMensagem: string | null`. Corrigir mocks que quebrem o build.

- [ ] **Step 4: Verificar build + lint + testes**

Run: `pnpm build && pnpm lint && pnpm test -- --run`
Expected: verde.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Relatorio.tsx src/lib/tipos-dominio.ts src/lib/queries.ts
git commit -m "feat(m4): Relatorio real com links, erros e tentar de novo"
```

---

## Self-Review (preenchido)

**Spec coverage:**
- §4.1 publicável → Task 3 (`familiaPublicavel`) + nota: atributos validados no backend (Task 12).
- §4.2 selo na linha → Task 5. §4.3 excluir cor → Tasks 4+6. §4.4 filtro/footer → Task 7. §4.5 modal → Task 7.
- §5.1 worker → Task 12; fotos → Tasks 10+12; payload → Task 9; idempotência → Task 12.
- §5.2 erros 4xx/5xx → Task 12 (status no catch). §5.3 schema → Task 1; coluna excluida → Task 1.
- §5.4 descobertas → Task 13. §6 relatório → Task 14. §7 testes → Tasks 3, 9 (puros) + 13 (bug bash).
- Disparo server-side (§3) → Tasks 8 (fila) + 11 (edge `publicar-familias`).

**Placeholder scan:** os pontos sob descoberta (GTIN/listing_type/endpoint de foto) são tarefas concretas na Task 13 com comandos de descoberta, não placeholders soltos.

**Type consistency:** `familiaPublicavel`/`ResultadoPublicavel`, `montarPayloadItem`/`PayloadItem`/`VariacaoItem`, `enfileirarPublicacao(ProcessFamiliaJob)`, `excluidaDaPublicacao`/`excluida_da_publicacao`, `setVariacaoExcluida`/`publicarFamilias` — consistentes entre tasks.
