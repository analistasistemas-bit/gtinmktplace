# Foto-capa por família — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans pra implementar este plano tarefa-a-tarefa. Steps usam checkbox (`- [ ]`) para tracking.

**Goal:** Permitir que o operador suba uma imagem-banner por família que entrará como `pictures[0]` do payload ML em M4. Drag-drop em lote com prefixo `CAPA_<codigoPai>.jpeg`, capa opcional, thumb visível na UI de Revisão.

**Architecture:** Migration aditiva (1 coluna nullable) + estensão da Edge Function `upload-imagens-lote` (detecta prefixo) + novo componente `foto-capa-familia` integrado em `FamiliaRow` (thumb 40×40) e `FamiliaExpanded` (seção 200×200 com trocar/remover). Sem novas Edge Functions, sem novo bucket.

**Tech Stack:** Supabase (Postgres + Edge Functions Deno + Storage), Vite + React 18 + TypeScript, shadcn/ui, lucide-react, TanStack Query, Vitest 3 + jsdom.

**Spec base:** `docs/superpowers/specs/2026-05-28-foto-capa-familia-design.md`

---

## Task 1: Migration + regeneração de tipos

**Files:**
- Create: `supabase/migrations/20260528120000_capa_familia.sql`
- Modify: `src/lib/database.types.ts` (regenerado via Supabase MCP)

- [ ] **Step 1: Criar a migration**

Conteúdo do arquivo:

```sql
-- Foto-capa opcional por família
-- Aparece como pictures[0] no payload ML em M4. Path no storage:
--   imagens/{user_id}/capas/{codigoPai}.jpeg

ALTER TABLE public.familias
  ADD COLUMN IF NOT EXISTS capa_storage_path text;
```

- [ ] **Step 2: Aplicar via Supabase MCP**

Use o MCP `supabase-mcp-server` com `apply_migration`:

```
name: "capa_familia"
query: <conteúdo do arquivo>
```

Espera-se sucesso. Verificar via `list_tables(schemas=["public"])` se a coluna `capa_storage_path` aparece em `familias`.

- [ ] **Step 3: Regenerar tipos**

Use o MCP `generate_typescript_types`. Sobrescrever `src/lib/database.types.ts`. Conferir que `capa_storage_path: string | null` aparece em `familias.Row`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260528120000_capa_familia.sql src/lib/database.types.ts
git commit -m "feat(db): coluna familias.capa_storage_path para foto-capa opcional"
```

---

## Task 2: Tipos de domínio + mapper

**Files:**
- Modify: `src/lib/tipos-dominio.ts`
- Modify: `src/lib/queries.ts` (mapper `mapFamiliaFromDb`)

- [ ] **Step 1: Adicionar campo em Familia**

Em `src/lib/tipos-dominio.ts`, na interface `Familia`, adicionar:

```typescript
capaStoragePath: string | null;
```

- [ ] **Step 2: Atualizar o mapper**

Em `src/lib/queries.ts`, na função que mapeia a row de `familias` pro tipo de domínio (procure por `mapFamiliaFromDb` ou função equivalente), adicionar:

```typescript
capaStoragePath: row.capa_storage_path,
```

Se houver SELECT explícito de colunas em `useFamilias` (hook), adicionar `capa_storage_path` à lista. Se for `select('*')`, nada a fazer.

- [ ] **Step 3: Verificar com types check**

```bash
pnpm typecheck
```

Expected: PASS sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tipos-dominio.ts src/lib/queries.ts
git commit -m "feat(types): expor capaStoragePath em Familia"
```

---

## Task 3: Helper puro de match com prefixo (TDD)

**Files:**
- Create: `supabase/functions/_shared/upload/match.ts`
- Test: `supabase/functions/_shared/upload/__tests__/match.test.ts`

Esse helper é o coração da decisão "esse arquivo é capa ou foto de cor". Pura função TypeScript, fácil de testar.

- [ ] **Step 1: Escrever o teste**

```typescript
import { describe, it, expect } from 'vitest';
import { classificarArquivo } from '../match';

describe('classificarArquivo', () => {
  it('reconhece CAPA_ com 8 dígitos', () => {
    expect(classificarArquivo('CAPA_00012345.jpeg')).toEqual({
      tipo: 'capa',
      codigo: '00012345',
    });
  });

  it('reconhece foto de variação com 8 dígitos', () => {
    expect(classificarArquivo('00012345.jpeg')).toEqual({
      tipo: 'variacao',
      codigo: '00012345',
    });
  });

  it('aceita .jpg, .jpeg, .png em qualquer caixa', () => {
    expect(classificarArquivo('CAPA_00012345.JPG').tipo).toBe('capa');
    expect(classificarArquivo('CAPA_00012345.PNG').tipo).toBe('capa');
    expect(classificarArquivo('00012345.png').tipo).toBe('variacao');
  });

  it('rejeita arquivos sem 8 dígitos exatos', () => {
    expect(classificarArquivo('CAPA_123.jpeg')).toEqual({ tipo: 'invalido' });
    expect(classificarArquivo('123.jpeg')).toEqual({ tipo: 'invalido' });
    expect(classificarArquivo('CAPA_000123456.jpeg')).toEqual({ tipo: 'invalido' });
  });

  it('rejeita extensões não suportadas', () => {
    expect(classificarArquivo('CAPA_00012345.gif')).toEqual({ tipo: 'invalido' });
    expect(classificarArquivo('00012345.webp')).toEqual({ tipo: 'invalido' });
  });

  it('é case-sensitive para o prefixo (CAPA maiúsculo)', () => {
    expect(classificarArquivo('capa_00012345.jpeg')).toEqual({ tipo: 'invalido' });
    expect(classificarArquivo('Capa_00012345.jpeg')).toEqual({ tipo: 'invalido' });
  });
});
```

- [ ] **Step 2: Rodar teste — deve FALHAR**

```bash
pnpm vitest run supabase/functions/_shared/upload/__tests__/match.test.ts
```

Expected: FAIL com "module not found".

- [ ] **Step 3: Implementar helper**

Arquivo `supabase/functions/_shared/upload/match.ts`:

```typescript
export type Classificacao =
  | { tipo: 'capa'; codigo: string }
  | { tipo: 'variacao'; codigo: string }
  | { tipo: 'invalido' };

const REGEX_CAPA = /^CAPA_(\d{8})\.(jpe?g|png)$/i;
const REGEX_VARIACAO = /^(\d{8})\.(jpe?g|png)$/i;

export function classificarArquivo(nome: string): Classificacao {
  const mCapa = nome.match(REGEX_CAPA);
  if (mCapa && nome.startsWith('CAPA_')) {
    return { tipo: 'capa', codigo: mCapa[1] };
  }
  const mVar = nome.match(REGEX_VARIACAO);
  if (mVar) {
    return { tipo: 'variacao', codigo: mVar[1] };
  }
  return { tipo: 'invalido' };
}
```

Observação: a checagem `nome.startsWith('CAPA_')` força case-sensitivity do prefixo, enquanto o `/i` no regex permite extensão em qualquer caixa.

- [ ] **Step 4: Rodar teste — deve PASSAR**

```bash
pnpm vitest run supabase/functions/_shared/upload/__tests__/match.test.ts
```

Expected: 6/6 PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/upload/
git commit -m "feat(upload): helper classificarArquivo separa capa de variacao"
```

---

## Task 4: Estender Edge Function `upload-imagens-lote`

**Files:**
- Modify: `supabase/functions/upload-imagens-lote/index.ts`
- Test: `supabase/functions/upload-imagens-lote/__tests__/match-capa.test.ts` (criar)

Cuidado: essa Edge Function já está deployada e funcionando para fotos de cor (M3). NÃO quebrar o caminho atual.

- [ ] **Step 1: Ler a função atual inteira primeiro**

```bash
cat "supabase/functions/upload-imagens-lote/index.ts"
```

Identifique:
- Como é feito o loop sobre arquivos do FormData
- Como faz o match com `variacoes.codigo`
- Como faz o upload no storage
- Como monta a resposta JSON

- [ ] **Step 2: Escrever teste de integração da Edge Function (unit-style)**

Isolar a função de processamento de 1 arquivo em uma função exportável `processarArquivo(file, userId, loteId, supabase)`. Se ela ainda não estiver isolada (provavelmente está inline em `Deno.serve`), extrair para um arquivo `processar.ts` ao lado do index.ts.

Teste em `__tests__/match-capa.test.ts` (com mocks de supabase client):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { processarArquivo } from '../processar';

function fakeFile(nome: string): File {
  return new File(['fake-bytes'], nome, { type: 'image/jpeg' });
}

function fakeSupabase(opts: { familiaCodigoPai?: string; variacaoCodigo?: string }) {
  return {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (tabela === 'familias' && opts.familiaCodigoPai) {
                return { data: { id: 'fam-1', codigo_pai: opts.familiaCodigoPai }, error: null };
              }
              if (tabela === 'variacoes' && opts.variacaoCodigo) {
                return { data: { id: 'var-1', codigo: opts.variacaoCodigo }, error: null };
              }
              return { data: null, error: null };
            },
          }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  };
}

describe('processarArquivo — caminho capa', () => {
  it('CAPA_00012345.jpeg vai pro path capas/ e atualiza familias', async () => {
    const sb = fakeSupabase({ familiaCodigoPai: '00012345' });
    const r = await processarArquivo(fakeFile('CAPA_00012345.jpeg'), 'user-1', 'lote-1', sb as any);
    expect(r.tipo).toBe('capa_ok');
  });

  it('CAPA_00099999.jpeg sem família correspondente vira capa_sem_match', async () => {
    const sb = fakeSupabase({});
    const r = await processarArquivo(fakeFile('CAPA_00099999.jpeg'), 'user-1', 'lote-1', sb as any);
    expect(r.tipo).toBe('capa_sem_match');
  });

  it('00012345.jpeg sem prefixo segue caminho variação (M3)', async () => {
    const sb = fakeSupabase({ variacaoCodigo: '00012345' });
    const r = await processarArquivo(fakeFile('00012345.jpeg'), 'user-1', 'lote-1', sb as any);
    expect(['ok', 'ja_tinha']).toContain(r.tipo);
  });
});
```

- [ ] **Step 3: Rodar teste — FAIL**

```bash
pnpm vitest run supabase/functions/upload-imagens-lote/__tests__/match-capa.test.ts
```

Expected: FAIL (função `processarArquivo` ainda não existe / não trata capa).

- [ ] **Step 4: Implementar — extrair `processarArquivo` + tratar capa**

Em `supabase/functions/upload-imagens-lote/processar.ts`:

```typescript
import { classificarArquivo } from '../_shared/upload/match.ts';

export type ResultadoProcessamento =
  | { tipo: 'ok' }
  | { tipo: 'ja_tinha' }
  | { tipo: 'sem_match' }
  | { tipo: 'capa_ok' }
  | { tipo: 'capa_sem_match' }
  | { tipo: 'invalido'; erro: string };

export async function processarArquivo(
  file: File,
  userId: string,
  loteId: string,
  supabase: any,
): Promise<ResultadoProcessamento> {
  const classificacao = classificarArquivo(file.name);
  if (classificacao.tipo === 'invalido') {
    return { tipo: 'invalido', erro: `Nome inválido: ${file.name}` };
  }

  if (classificacao.tipo === 'capa') {
    const { data: familia } = await supabase
      .from('familias')
      .select('id, codigo_pai, capa_storage_path')
      .eq('lote_id', loteId)
      .eq('codigo_pai', classificacao.codigo)
      .maybeSingle();
    if (!familia) return { tipo: 'capa_sem_match' };

    const path = `${userId}/capas/${classificacao.codigo}.jpeg`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await supabase.storage
      .from('imagens')
      .upload(path, bytes, { contentType: file.type, upsert: true });
    if (upErr) return { tipo: 'invalido', erro: upErr.message };

    await supabase
      .from('familias')
      .update({ capa_storage_path: path })
      .eq('id', familia.id);

    return { tipo: 'capa_ok' };
  }

  // classificacao.tipo === 'variacao' — manter lógica M3 que já está no index.ts
  const { data: variacao } = await supabase
    .from('variacoes')
    .select('id, codigo, imagem_storage_path')
    .eq('lote_id', loteId)
    .eq('codigo', classificacao.codigo)
    .maybeSingle();
  if (!variacao) return { tipo: 'sem_match' };

  const path = `${userId}/${classificacao.codigo}.jpeg`;
  const jaTinha = !!variacao.imagem_storage_path;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage
    .from('imagens')
    .upload(path, bytes, { contentType: file.type, upsert: true });
  if (upErr) return { tipo: 'invalido', erro: upErr.message };

  if (!jaTinha) {
    await supabase
      .from('variacoes')
      .update({ imagem_storage_path: path })
      .eq('id', variacao.id);
  }

  return { tipo: jaTinha ? 'ja_tinha' : 'ok' };
}
```

Em `supabase/functions/upload-imagens-lote/index.ts`, refatorar pra usar `processarArquivo` em vez da lógica inline. Resposta JSON nova:

```typescript
const contadores = {
  ok: 0,
  ja_tinha: 0,
  sem_match: 0,
  capas_ok: 0,
  capas_sem_match: 0,
  erros: [] as string[],
};

for (const file of arquivos) {
  const r = await processarArquivo(file, user.id, loteId, supabase);
  switch (r.tipo) {
    case 'ok': contadores.ok++; break;
    case 'ja_tinha': contadores.ja_tinha++; break;
    case 'sem_match': contadores.sem_match++; break;
    case 'capa_ok': contadores.capas_ok++; break;
    case 'capa_sem_match': contadores.capas_sem_match++; break;
    case 'invalido': contadores.erros.push(r.erro); break;
  }
}

return new Response(JSON.stringify(contadores), {
  status: 200,
  headers: { ...corsHeaders, 'content-type': 'application/json' },
});
```

- [ ] **Step 5: Rodar todos os testes — deve PASSAR**

```bash
pnpm vitest run supabase/functions/upload-imagens-lote/__tests__/
```

Expected: PASS (3/3 ou mais).

- [ ] **Step 6: Deploy via Supabase MCP**

Use `deploy_edge_function`:

```
name: "upload-imagens-lote"
files: [
  { name: "source/index.ts", content: <conteúdo refatorado> },
  { name: "source/processar.ts", content: <conteúdo novo> }
]
entrypoint_path: "source/index.ts"
```

Aguardar resposta de sucesso e anotar a versão deployada.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/upload-imagens-lote/ supabase/functions/_shared/upload/
git commit -m "feat(upload): estender upload-imagens-lote para detectar prefixo CAPA_"
```

---

## Task 5: Helpers de upload e remoção da capa (cliente)

**Files:**
- Modify: `src/lib/upload-imagens.ts`

A drop-zone em lote já passa pela função existente `uploadImagensLote`. O que falta:
- Função pra subir 1 capa avulsa (file picker no card expandido)
- Função pra remover capa
- Atualizar tipo de retorno pra incluir `capas_ok`, `capas_sem_match`

- [ ] **Step 1: Atualizar tipo de retorno**

Em `src/lib/upload-imagens.ts`, achar a interface do retorno (algo como `RespostaUpload`) e adicionar:

```typescript
capas_ok: number;
capas_sem_match: number;
```

- [ ] **Step 2: Adicionar `subirCapaFamilia`**

```typescript
export async function subirCapaFamilia(
  loteId: string,
  codigoPai: string,
  arquivo: File,
): Promise<void> {
  const codigoPadronizado = codigoPai.padStart(8, '0');
  const nomeRenomeado = `CAPA_${codigoPadronizado}.${arquivo.name.split('.').pop()}`;
  const renomeado = new File([arquivo], nomeRenomeado, { type: arquivo.type });
  const r = await uploadImagensLote(loteId, [renomeado]);
  if (r.capas_ok !== 1) {
    throw new Error(
      r.capas_sem_match > 0
        ? `Família ${codigoPai} não encontrada no lote.`
        : r.erros[0] || 'Falha ao subir capa.',
    );
  }
}
```

- [ ] **Step 3: Adicionar `removerCapaFamilia`**

```typescript
import { supabase } from './supabase';

export async function removerCapaFamilia(familiaId: string, capaStoragePath: string): Promise<void> {
  const { error: rmErr } = await supabase.storage.from('imagens').remove([capaStoragePath]);
  if (rmErr) throw new Error(rmErr.message);
  const { error: upErr } = await supabase
    .from('familias')
    .update({ capa_storage_path: null })
    .eq('id', familiaId);
  if (upErr) throw new Error(upErr.message);
}
```

- [ ] **Step 4: Types check + build**

```bash
pnpm typecheck && pnpm build
```

Expected: PASS sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/upload-imagens.ts
git commit -m "feat(upload): helpers subirCapaFamilia e removerCapaFamilia"
```

---

## Task 6: Componente `<FotoCapaFamilia>` — thumb + ações

**Files:**
- Create: `src/components/foto-capa-familia.tsx`
- Create: `src/components/__tests__/foto-capa-familia.test.tsx`

Componente isolado, reutilizável no card colapsado (variante small) e no expandido (variante large).

- [ ] **Step 1: Escrever teste**

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FotoCapaFamilia } from '../foto-capa-familia';

describe('<FotoCapaFamilia>', () => {
  it('mostra placeholder quando capaUrl é null', () => {
    render(<FotoCapaFamilia capaUrl={null} tamanho="small" />);
    expect(screen.getByTestId('capa-placeholder')).toBeInTheDocument();
  });

  it('renderiza img quando capaUrl é string', () => {
    render(<FotoCapaFamilia capaUrl="https://example.com/x.jpg" tamanho="large" />);
    const img = screen.getByRole('img', { name: /capa/i });
    expect(img).toHaveAttribute('src', 'https://example.com/x.jpg');
  });

  it('tamanho small renderiza 40x40, large renderiza 200x200', () => {
    const { rerender } = render(<FotoCapaFamilia capaUrl={null} tamanho="small" />);
    expect(screen.getByTestId('capa-placeholder')).toHaveClass('h-10', 'w-10');
    rerender(<FotoCapaFamilia capaUrl={null} tamanho="large" />);
    expect(screen.getByTestId('capa-placeholder')).toHaveClass('h-48', 'w-48');
  });
});
```

- [ ] **Step 2: Rodar teste — FAIL**

```bash
pnpm vitest run src/components/__tests__/foto-capa-familia.test.tsx
```

Expected: FAIL (componente não existe).

- [ ] **Step 3: Implementar componente**

```typescript
import { Image as ImageIcon } from 'lucide-react';

interface Props {
  capaUrl: string | null;
  tamanho: 'small' | 'large';
}

export function FotoCapaFamilia({ capaUrl, tamanho }: Props) {
  const classe = tamanho === 'small' ? 'h-10 w-10' : 'h-48 w-48';
  if (!capaUrl) {
    return (
      <div
        data-testid="capa-placeholder"
        className={`${classe} flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground`}
      >
        <ImageIcon className={tamanho === 'small' ? 'h-4 w-4' : 'h-8 w-8'} />
      </div>
    );
  }
  return (
    <img
      src={capaUrl}
      alt="Capa da família"
      className={`${classe} shrink-0 rounded-md object-cover`}
    />
  );
}
```

- [ ] **Step 4: Rodar teste — PASS**

```bash
pnpm vitest run src/components/__tests__/foto-capa-familia.test.tsx
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/foto-capa-familia.tsx src/components/__tests__/foto-capa-familia.test.tsx
git commit -m "feat(ui): componente FotoCapaFamilia com placeholder + tamanhos"
```

---

## Task 7: Helper de URL da capa + hook de invalidação

**Files:**
- Modify: `src/lib/queries.ts`

Pra renderizar a capa o frontend precisa de uma URL. Como o bucket `imagens` provavelmente é privado, vamos gerar URL assinada de curta duração (1 hora).

- [ ] **Step 1: Adicionar helper `urlCapaFamilia`**

Em `src/lib/queries.ts`:

```typescript
export async function urlCapaFamilia(capaStoragePath: string | null): Promise<string | null> {
  if (!capaStoragePath) return null;
  const { data, error } = await supabase.storage
    .from('imagens')
    .createSignedUrl(capaStoragePath, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}
```

Observação: se o bucket `imagens` for público (verificar via supabase dashboard), pode-se usar `getPublicUrl` que é síncrono e cacheável. Verificar antes de implementar; trocar pra `getPublicUrl` se for o caso.

- [ ] **Step 2: Types check**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries.ts
git commit -m "feat(queries): urlCapaFamilia para signed URL da capa"
```

---

## Task 8: Card colapsado — thumb 40×40

**Files:**
- Modify: `src/components/familia-row.tsx`

- [ ] **Step 1: Ler o componente atual**

```bash
cat src/components/familia-row.tsx
```

Identifique onde o título da família é renderizado (`familia.titulo`).

- [ ] **Step 2: Adicionar query da signed URL via useEffect ou useQuery**

Topo do componente:

```typescript
import { useQuery } from '@tanstack/react-query';
import { urlCapaFamilia } from '@/lib/queries';
import { FotoCapaFamilia } from './foto-capa-familia';

const { data: capaUrl } = useQuery({
  queryKey: ['capa-url', familia.id, familia.capaStoragePath],
  queryFn: () => urlCapaFamilia(familia.capaStoragePath),
  enabled: !!familia.capaStoragePath,
  staleTime: 1000 * 60 * 30, // 30 min, signed URL dura 60min
});
```

- [ ] **Step 3: Inserir thumb antes do título**

Adjacente ao título atual, à esquerda:

```tsx
<FotoCapaFamilia capaUrl={capaUrl ?? null} tamanho="small" />
```

Manter alinhamento existente (Flex etc.) — não quebrar layout.

- [ ] **Step 4: Verificar build**

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/familia-row.tsx
git commit -m "feat(ui): thumb da capa no card colapsado da familia"
```

---

## Task 9: Card expandido — seção foto-capa com trocar/remover

**Files:**
- Modify: `src/components/familia-expanded.tsx`

- [ ] **Step 1: Ler o componente atual**

```bash
cat src/components/familia-expanded.tsx
```

- [ ] **Step 2: Adicionar seção foto-capa no topo da expansão**

Imports:

```typescript
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Camera, Trash2 } from 'lucide-react';
import { FotoCapaFamilia } from './foto-capa-familia';
import { urlCapaFamilia, QK } from '@/lib/queries';
import { subirCapaFamilia, removerCapaFamilia } from '@/lib/upload-imagens';
```

Estado e refs:

```typescript
const inputRef = useRef<HTMLInputElement>(null);
const [trocando, setTrocando] = useState(false);
const qc = useQueryClient();

const { data: capaUrl } = useQuery({
  queryKey: ['capa-url', familia.id, familia.capaStoragePath],
  queryFn: () => urlCapaFamilia(familia.capaStoragePath),
  enabled: !!familia.capaStoragePath,
  staleTime: 1000 * 60 * 30,
});

async function lidarTrocaCapa(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  if (!file || !familia.loteId) return;
  setTrocando(true);
  try {
    await subirCapaFamilia(familia.loteId, familia.codigoPai, file);
    qc.invalidateQueries({ queryKey: QK.familias(familia.loteId) });
  } catch (err) {
    alert(`Erro ao trocar capa: ${(err as Error).message}`);
  } finally {
    setTrocando(false);
    if (inputRef.current) inputRef.current.value = '';
  }
}

async function lidarRemoverCapa() {
  if (!familia.capaStoragePath) return;
  if (!confirm('Remover capa desta família?')) return;
  try {
    await removerCapaFamilia(familia.id, familia.capaStoragePath);
    qc.invalidateQueries({ queryKey: QK.familias(familia.loteId!) });
  } catch (err) {
    alert(`Erro ao remover capa: ${(err as Error).message}`);
  }
}
```

JSX no topo da seção expandida:

```tsx
<div className="flex items-start gap-4 border-b p-4">
  <FotoCapaFamilia capaUrl={capaUrl ?? null} tamanho="large" />
  <div className="flex flex-col gap-2">
    <span className="text-xs text-muted-foreground">Foto-capa do anúncio</span>
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={trocando}
      >
        <Camera className="mr-2 h-4 w-4" />
        {familia.capaStoragePath ? 'Trocar foto' : 'Subir capa'}
      </Button>
      {familia.capaStoragePath && (
        <Button variant="ghost" size="sm" onClick={lidarRemoverCapa}>
          <Trash2 className="mr-2 h-4 w-4" />
          Remover
        </Button>
      )}
    </div>
    <input
      ref={inputRef}
      type="file"
      accept="image/jpeg,image/png,image/jpg"
      className="hidden"
      onChange={lidarTrocaCapa}
    />
  </div>
</div>
```

Observação: se `familia.loteId` ou `familia.codigoPai` não estão no tipo `Familia` atual, adicionar ao mapper na Task 2 (revisitar).

- [ ] **Step 3: Verificar build**

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/familia-expanded.tsx
git commit -m "feat(ui): seção foto-capa no expandido com trocar/remover"
```

---

## Task 10: Revisão page — contadores `capas_ok` no status

**Files:**
- Modify: `src/pages/Revisao.tsx`

- [ ] **Step 1: Editar `lidarArquivosDrop`**

Localizar o trecho atual (linhas ~43-62 do `Revisao.tsx`):

```typescript
const partes = [
  `${r.ok} nova(s)`,
  `${r.ja_tinha} substituída(s)`,
  `${r.sem_match} sem match`,
];
```

Substituir por:

```typescript
const partes = [
  `${r.ok} cor(es) nova(s)`,
  `${r.ja_tinha} cor(es) substituída(s)`,
  `${r.sem_match} cor(es) sem match`,
  `${r.capas_ok} capa(s)`,
  `${r.capas_sem_match} capa(s) sem match`,
];
```

- [ ] **Step 2: Verificar build**

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Revisao.tsx
git commit -m "feat(ui): exibir contadores de capa no status do drop em lote"
```

---

## Task 11: Smoke test manual (sem código novo)

Esta tarefa é manual, sem código novo. Diego executa após Task 10.

- [ ] **Step 1: Subir o frontend localmente**

```bash
pnpm dev
```

- [ ] **Step 2: Criar (ou usar) um lote em estado revisão com pelo menos 2 famílias**

- [ ] **Step 3: Renomear 2 imagens de teste**

Exemplo (CLI):

```bash
cp foto-bonita.jpg CAPA_00012345.jpeg
cp outra-foto.jpg CAPA_00067890.jpeg
```

Onde `00012345` e `00067890` são códigos PAI reais do seu lote.

- [ ] **Step 4: Arrastar para a drop-zone na tela de Revisão**

Esperado:
- Status mostra `2 capa(s)` no toast/contador
- Cards das famílias com aqueles códigos passam a mostrar o thumb
- Expansão mostra a capa em 200×200 com botões "Trocar foto" + "Remover"

- [ ] **Step 5: Trocar uma capa via file picker**

- Abrir família expandida
- Clicar "Trocar foto" e escolher outra imagem
- Confirmar que o thumb e o expandido atualizam

- [ ] **Step 6: Remover uma capa**

- Clicar "Remover" → confirmar
- Verificar que o thumb volta a placeholder e o expandido mostra "Subir capa"
- Verificar no storage do Supabase que o arquivo foi removido

- [ ] **Step 7: Test edge cases**

- Arrastar `CAPA_00099999.jpeg` com código inexistente → toast mostra `1 capa(s) sem match`
- Arrastar mistura de capas + fotos de cor → contadores separados

---

## Task 12: Atualizar documentação

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/TASKS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/README.md`

- [ ] **Step 1: ROADMAP.md — adicionar ajuste em M3**

Onde lista os marcos, adicionar abaixo do M3 concluído:

```markdown
- **M3.1 (ajuste pós-M3, 2026-05-28):** foto-capa por família como `pictures[0]` no payload ML. Drag-drop com prefixo `CAPA_`. Spec: `docs/superpowers/specs/2026-05-28-foto-capa-familia-design.md`. ✅
```

- [ ] **Step 2: TASKS.md — marcar tarefas do plano como concluídas**

Adicionar no fim:

```markdown
## M3.1 — Foto-capa por família (2026-05-28)

- [x] Migration `capa_familia` (coluna `capa_storage_path`)
- [x] Helper `classificarArquivo` (TDD, 6 testes)
- [x] Edge Function `upload-imagens-lote` detecta prefixo `CAPA_`
- [x] Helpers `subirCapaFamilia` / `removerCapaFamilia`
- [x] Componente `<FotoCapaFamilia>` (small / large)
- [x] Thumb no card colapsado + expansão com trocar/remover
- [x] Contadores `capas_ok` / `capas_sem_match` na drop-zone
- [x] Smoke test manual aprovado pelo Diego
```

- [ ] **Step 3: CLAUDE.md — atualizar histórico**

Na seção "Histórico deste CLAUDE.md", adicionar linha:

```markdown
| 2026-05-28 | Ajuste M3.1: foto-capa por família (spec + plano + implementação subagent-driven). Storage path `imagens/{user_id}/capas/{codigoPai}.jpeg`. Edge function `upload-imagens-lote` agora trata prefixo `CAPA_`. UI da Revisão ganhou thumb no card colapsado + seção 200×200 no expandido com trocar/remover. |
```

E atualizar a linha "Última atualização: 2026-05-28".

- [ ] **Step 4: docs/README.md — adicionar links pro spec e plano novos**

Localizar a seção que indexa specs e planos; adicionar entradas:

```markdown
- [Spec foto-capa por família (2026-05-28)](superpowers/specs/2026-05-28-foto-capa-familia-design.md)
- [Plano 05 — foto-capa (2026-05-28)](superpowers/plans/2026-05-28-plan-05-foto-capa.md)
```

- [ ] **Step 5: Commit final**

```bash
git add docs/ROADMAP.md docs/TASKS.md CLAUDE.md docs/README.md
git commit -m "docs: fechar M3.1 (foto-capa por familia) — ROADMAP/TASKS/CLAUDE atualizados"
```

- [ ] **Step 6: Push opcional**

```bash
git push origin main
```

---

## Critérios de "pronto" (resumo)

- [ ] Migration aplicada (`capa_storage_path` em `familias`)
- [ ] Helper `classificarArquivo` com 6 testes verdes
- [ ] Edge Function `upload-imagens-lote` deployada (versão > v1)
- [ ] Componente `<FotoCapaFamilia>` com 3 testes verdes
- [ ] Card colapsado mostra thumb 40×40
- [ ] Card expandido com Trocar / Remover funcionando
- [ ] Drop-zone retorna e exibe `capas_ok` / `capas_sem_match`
- [ ] Smoke test manual com 2 capas reais aprovado
- [ ] `pnpm build` + `pnpm typecheck` + `pnpm test` verdes
- [ ] Docs (ROADMAP, TASKS, CLAUDE, README) atualizados

## Notas para o subagente implementador

- O bucket `imagens` provavelmente é privado — se o `urlCapaFamilia` retornar erro de auth, verificar RLS do storage. Não criar bucket novo.
- Hoje `upload-imagens-lote` está deployada na versão v1. Após deploy desta task, será v2+.
- O nome do arquivo no FormData precisa preservar o `CAPA_` — o frontend renomeia em `subirCapaFamilia` antes de enviar (Step 2 da Task 5).
- Se a função `processarArquivo` ficar > 100 linhas, extrair `processarCapa` e `processarVariacao` em arquivos separados.
- Não tocar em código não-relacionado. Não "limpar" código adjacente do M3.
- Cada commit referencia 1 task deste plano.

## Workflow de execução

Use `superpowers:subagent-driven-development`. Dispatch 1 subagente por task, com revisão em 2 estágios (spec + qualidade) entre tasks. Mesma cadência do plano-04 (M3).
