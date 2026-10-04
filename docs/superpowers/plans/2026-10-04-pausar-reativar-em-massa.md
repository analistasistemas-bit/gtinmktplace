# Pausar/reativar em massa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pausar/reativar N anúncios do ML de uma vez a partir da tela Publicados, como 2º tipo do motor de operações em massa (ADR-0174), com acompanhamento e Reverter numa tela global de Operações.

**Architecture:** O laço de execução de `_shared/operacoes/executar.ts` é extraído para `laco.ts` e passa a receber um `processar` por item; o caminho de promoção (`executar`) mantém assinatura e comportamento. Um handler novo (`executar-status.ts` + `decidir-status.ts`) lê o status fresco pelo conector ML, aplica as travas (moderação, migração PxV) e chama `conn.atualizarStatus` (ADR-0060, já propaga ao catálogo). A edge `operacoes-massa` ganha ramos `pausar|reativar` na criação e na etapa QStash. No front, seleção por checkbox em Publicados → preview → tela `/operacoes` (lista movida de `components/promocoes` para `components/operacoes`).

**Tech Stack:** Supabase (Postgres, Edge Functions Deno), QStash, React + TanStack Query, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-04-pausar-reativar-em-massa-design.md` (ler junto com ADR-0174, inclusive a emenda 2026-10-04).

## Global Constraints

- Migrations só via `supabase migration new` + `supabase db push`; validar com `npm run db:check` (ADR-0043). Nunca `apply_migration`/painel.
- Edge alterada → `supabase functions deploy operacoes-massa` (só depois do merge) e conferir versão ativa.
- `pnpm test` exige `.env.test` e o dev exige `.env.local`: copie os dois do checkout principal (`/Users/diego/Desktop/IA/Anuncios MktPlace/`) para a raiz do worktree antes do 1º teste (ambos gitignored).
- Git no worktree: use `/usr/bin/git` (o hook RTK/guard barra `git` puro e comandos compostos); commit com `-F <arquivo absoluto>` em `$CLAUDE_JOB_DIR/tmp`.
- Toda query com service role filtra por `org_id`.
- Só admin ou suporte com escopo `full` executa (`ctx.isAdmin || ctx.support?.scope === 'full'`); front: `usePodeExecutarOperacao()`.
- `MAX_ITENS = 500` por operação; teto por mensagem QStash continua `{ limiteMs: 90_000, lote: 20, maxItens: 100 }`.
- Kit Virtual (`kits_virtuais`, `ehKitVirtual`) nunca entra em pausar/reativar em massa.
- ADR-0111 inalterado: nenhuma mudança em `sincronizar-estoque`.
- **Não-regressão:** os arquivos existentes `supabase/functions/_shared/operacoes/__tests__/{decidir,executar,falhas,ml,validar}.test.ts` NÃO podem ser editados e têm que passar.
- Escrita real no ML só na validação de campo, na DSA, com MLBs aprovados pelo Diego. A Avil não é tocada.
- Copy em pt-BR; vocabulário do app ("Pausar", "Reativar", "Feito", "Já estava", "Bloqueado", "Erro").
- Portão antes de push: `pnpm preflight:static` (27 s) e `pnpm test`.

## Review Focus

1. **Duplicidade sem promoção:** mesmo anúncio em duas operações de pausa simultâneas → a 2ª criação recebe 409 (índice parcial novo); operação de promoção do mesmo anúncio NÃO é barrada por isso. → teste SQL na Task 1.
2. **Item moderado/encerrado entre seleção e execução:** status ao vivo do Publicados tem cache de 5 min; o handler relê e grava `bloqueado`, nunca chama `atualizarStatus`. → teste na Task 2/3.
3. **Reverter de operação de status** só sobre `aplicado` (não `ja_estava`: não fomos nós que mudamos) e a origem tem que ser a ação inversa sem promoção. → testes nas Tasks 4 e 6.
4. **"Todos do filtro" com filtro trocado:** seleção feita num filtro não pode vazar para outro → limpar seleção quando `filtro` muda. → teste na Task 6 (lógica pura) e validação de campo.
5. **Token recusado/conta desconectada no meio:** `atualizarStatus` devolve `ok:false` → item `erro` com `mensagemOperador`, operação conclui (não fica `executando` para sempre); sem conexão na etapa QStash → `encerrarComErro`. → testes nas Tasks 3 e 5.

---

### Task 1: Migration — ações de status no schema

**Files:**
- Create: `supabase/migrations/<timestamp>_operacoes_massa_status.sql` (via `supabase migration new operacoes_massa_status`)
- Modify: `supabase/tests/operacoes_massa.sql` (acrescentar bloco no fim, antes do `rollback`)
- Modify: `src/lib/database.types.ts` (`operacoes_massa` e `operacoes_massa_itens`: `promocao_id`/`promocao_tipo` → `string | null` em Row; opcionais em Insert)

**Interfaces:**
- Produces: `acao` aceita `'pausar' | 'reativar'`; `promocao_id`/`promocao_tipo` nullable; índice `operacoes_massa_itens_status_unico`.

- [ ] **Step 1: Escrever o teste SQL (vermelho)** — acrescentar ao fim de `supabase/tests/operacoes_massa.sql`, antes do `rollback;` final (manter `reset role;` antes, igual aos blocos existentes):

```sql
-- Emenda 2026-10-04 (pausar/reativar): coerência ação × promoção e anti-duplicidade sem promoção.
reset role;
do $$
declare v_op1 uuid := '91000000-0000-0000-0000-000000000301';
        v_op2 uuid := '91000000-0000-0000-0000-000000000302';
        v_org uuid := '91000000-0000-0000-0000-000000000001';
begin
  insert into public.operacoes_massa (id, org_id, acao) values (v_op1, v_org, 'pausar'), (v_op2, v_org, 'reativar');

  begin
    insert into public.operacoes_massa (org_id, acao) values (v_org, 'aderir');
    raise exception 'CHECK: aderir sem promoção foi aceito';
  exception when check_violation then null; end;

  begin
    insert into public.operacoes_massa (org_id, acao, promocao_id, promocao_tipo) values (v_org, 'pausar', 'P-X', 'DEAL');
    raise exception 'CHECK: pausar com promoção foi aceito';
  exception when check_violation then null; end;

  insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id) values (v_op1, v_org, 'MLB9');
  begin
    insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id) values (v_op2, v_org, 'MLB9');
    raise exception 'ÍNDICE: mesmo anúncio em duas operações de status pendentes';
  exception when unique_violation then null; end;

  -- Terminado libera o anúncio.
  update public.operacoes_massa_itens set status = 'aplicado' where operacao_id = v_op1 and ml_item_id = 'MLB9';
  insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id) values (v_op2, v_org, 'MLB9');

  -- Operação de promoção do mesmo anúncio não é barrada pelo índice de status.
  insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id)
    values ('91000000-0000-0000-0000-000000000201', v_org, 'P-A', 'MLB9');
end;
$$;
```

- [ ] **Step 2: Rodar e ver falhar.** Docker local: `docker exec -i supabase_db_<ref> psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/operacoes_massa.sql` → esperado: erro de check (`acao` não aceita `pausar`) ou NOT NULL de `promocao_id`. Se o Docker não subir (load do iCloud), usar a receita de `reference_teste_sql_sem_docker` (memória): uma requisição `database/query` com `begin; set local lock_timeout='2s'; set local statement_timeout='30s'; <corpo do teste sem metacomandos psql>; do $$ begin raise exception 'TESTE_OK'; end $$; rollback;` — **sem** a migration tem que falhar antes do `TESTE_OK`. Avisar o Diego que é DDL desfeito via API.

- [ ] **Step 3: Escrever a migration** (`supabase migration new operacoes_massa_status`, conteúdo):

```sql
-- ADR-0174 emenda 2026-10-04 — 2º tipo do motor: pausar/reativar (sem promoção).
alter table public.operacoes_massa drop constraint operacoes_massa_acao_check;
alter table public.operacoes_massa drop constraint operacoes_massa_promocao_tipo_check;
alter table public.operacoes_massa alter column promocao_id drop not null;
alter table public.operacoes_massa alter column promocao_tipo drop not null;
alter table public.operacoes_massa add constraint operacoes_massa_acao_check
  check (acao in ('aderir','sair','pausar','reativar'));
alter table public.operacoes_massa add constraint operacoes_massa_promocao_tipo_check
  check (promocao_tipo is null or promocao_tipo in ('DEAL','SMART'));
alter table public.operacoes_massa add constraint operacoes_massa_acao_promocao_check check (
  (acao in ('aderir','sair') and promocao_id is not null and promocao_tipo is not null)
  or (acao in ('pausar','reativar') and promocao_id is null and promocao_tipo is null)
);

alter table public.operacoes_massa_itens alter column promocao_id drop not null;

-- O índice de promoção (org_id, promocao_id, ml_item_id) não barra NULL (NULLs são distintos):
-- as operações sem promoção ganham o seu.
create unique index operacoes_massa_itens_status_unico
  on public.operacoes_massa_itens (org_id, ml_item_id)
  where promocao_id is null and status in ('pendente','enviando');
```

Antes de aplicar, confirmar os nomes reais das constraints: `select conname from pg_constraint where conrelid = 'public.operacoes_massa'::regclass;` (via `supabase db query` read-only ou psql local). Se o nome gerado for outro, usar o real.

- [ ] **Step 4: Rodar o teste SQL com a migration** → esperado: termina sem erro (local) ou `P0001: TESTE_OK` (receita de produção). Rodar também `npm run db:check`.

- [ ] **Step 5: Atualizar `src/lib/database.types.ts`** — em `operacoes_massa` e `operacoes_massa_itens`: `promocao_id: string | null` (Row), `promocao_id?: string | null` (Insert/Update); em `operacoes_massa`: `promocao_tipo: string | null` / `promocao_tipo?: string | null`. Rodar `pnpm exec tsc -b` e corrigir os usos que quebrarem só com `?? ''`/guarda — sem mudar comportamento.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add supabase/migrations/*_operacoes_massa_status.sql supabase/tests/operacoes_massa.sql src/lib/database.types.ts
/usr/bin/git commit -F "$CLAUDE_JOB_DIR/tmp/msg.txt"   # "feat(operacoes): schema aceita pausar/reativar sem promoção"
```

(`supabase db push` só no fim, Task 9, antes do deploy da edge.)

---

### Task 2: Decisão pura do handler de status

**Files:**
- Create: `supabase/functions/_shared/operacoes/decidir-status.ts`
- Create: `supabase/functions/_shared/operacoes/__tests__/decidir-status.test.ts`
- Modify: `supabase/functions/_shared/operacoes/tipos.ts` (acrescentar `AcaoStatus`)

**Interfaces:**
- Consumes: `StatusAnuncioCanal` de `../canais/contrato.ts`; `StatusItem` de `./tipos.ts`.
- Produces:
  - `export type AcaoStatus = 'pausar' | 'reativar'` (em `tipos.ts`)
  - `export type DecisaoStatus = { tipo: 'escrever'; alvo: 'ativo' | 'pausado' } | { tipo: 'fim'; status: 'ja_estava' | 'bloqueado' | 'erro'; mensagem: string | null }`
  - `export function decidirStatus(acao: AcaoStatus, atual: StatusAnuncioCanal | null, migracao: string | null): DecisaoStatus`
  - `export const MSG_BLOQUEADO_STATUS`, `export const MSG_SEM_LEITURA`

- [ ] **Step 1: Teste (vermelho)**

```ts
import { describe, expect, it } from 'vitest';
import { decidirStatus, MSG_BLOQUEADO_STATUS, MSG_SEM_LEITURA } from '../decidir-status.ts';

const PXV = 'Migração para preço por variação em andamento.';

describe('decidirStatus', () => {
  it('pausar ativo → escrever pausado; reativar pausado → escrever ativo', () => {
    expect(decidirStatus('pausar', 'ativo', null)).toEqual({ tipo: 'escrever', alvo: 'pausado' });
    expect(decidirStatus('reativar', 'pausado', null)).toEqual({ tipo: 'escrever', alvo: 'ativo' });
  });
  it('já no alvo → ja_estava (idempotente no retry do QStash)', () => {
    expect(decidirStatus('pausar', 'pausado', null)).toEqual({ tipo: 'fim', status: 'ja_estava', mensagem: null });
    expect(decidirStatus('reativar', 'ativo', null)).toEqual({ tipo: 'fim', status: 'ja_estava', mensagem: null });
  });
  it('moderado, encerrado, inativo → bloqueado, nunca escreve', () => {
    for (const s of ['moderado', 'encerrado', 'inativo'] as const) {
      expect(decidirStatus('reativar', s, null)).toEqual({ tipo: 'fim', status: 'bloqueado', mensagem: MSG_BLOQUEADO_STATUS });
      expect(decidirStatus('pausar', s, null)).toEqual({ tipo: 'fim', status: 'bloqueado', mensagem: MSG_BLOQUEADO_STATUS });
    }
  });
  it('migração PxV em curso → bloqueado com a mensagem do guard, mesmo ativo', () => {
    expect(decidirStatus('pausar', 'ativo', PXV)).toEqual({ tipo: 'fim', status: 'bloqueado', mensagem: PXV });
  });
  it('sem leitura (null/indisponivel) → erro, sem escrever', () => {
    expect(decidirStatus('pausar', null, null)).toEqual({ tipo: 'fim', status: 'erro', mensagem: MSG_SEM_LEITURA });
    expect(decidirStatus('pausar', 'indisponivel', null)).toEqual({ tipo: 'fim', status: 'erro', mensagem: MSG_SEM_LEITURA });
  });
});
```

- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/operacoes/__tests__/decidir-status.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

`tipos.ts` (acrescentar ao fim):
```ts
/** Emenda 2026-10-04 — 2º tipo do motor: status do anúncio (ADR-0060), sem promoção. */
export type AcaoStatus = 'pausar' | 'reativar';
```

`decidir-status.ts`:
```ts
// ADR-0174 emenda 2026-10-04 — decisão pura por item de pausar/reativar, a partir do status FRESCO do ML
// (o da tela Publicados tem cache de 5 min). Idempotente: item já no alvo nunca é escrito de novo.
import type { StatusAnuncioCanal } from '../canais/contrato.ts';
import type { AcaoStatus } from './tipos.ts';

export type DecisaoStatus =
  | { tipo: 'escrever'; alvo: 'ativo' | 'pausado' }
  | { tipo: 'fim'; status: 'ja_estava' | 'bloqueado' | 'erro'; mensagem: string | null };

export const MSG_BLOQUEADO_STATUS = 'Anúncio moderado ou encerrado no ML — não dá para pausar/reativar';
export const MSG_SEM_LEITURA = 'O ML não devolveu o anúncio';

export function decidirStatus(acao: AcaoStatus, atual: StatusAnuncioCanal | null, migracao: string | null): DecisaoStatus {
  if (migracao) return { tipo: 'fim', status: 'bloqueado', mensagem: migracao };
  if (atual === null || atual === 'indisponivel') return { tipo: 'fim', status: 'erro', mensagem: MSG_SEM_LEITURA };
  if (atual !== 'ativo' && atual !== 'pausado') return { tipo: 'fim', status: 'bloqueado', mensagem: MSG_BLOQUEADO_STATUS };
  const alvo = acao === 'pausar' ? 'pausado' : 'ativo';
  if (atual === alvo) return { tipo: 'fim', status: 'ja_estava', mensagem: null };
  return { tipo: 'escrever', alvo };
}
```

- [ ] **Step 4:** rodar o teste → PASS.
- [ ] **Step 5: Commit** — `feat(operacoes): decisão pura de pausar/reativar`.

---

### Task 3: Laço genérico + executor de status

**Files:**
- Create: `supabase/functions/_shared/operacoes/laco.ts`
- Create: `supabase/functions/_shared/operacoes/executar-status.ts`
- Create: `supabase/functions/_shared/operacoes/__tests__/executar-status.test.ts`
- Modify: `supabase/functions/_shared/operacoes/executar.ts` (o corpo de `executar` passa a chamar `laco`; `finalizar`/`agendarOuConcluir`/`FalhaPosEscrita`/`mensagemDe`/`ESPERA_ENVIANDO_SEG` mudam para `laco.ts`)
- Modify: `supabase/functions/_shared/operacoes/tipos.ts` (mover `ItemRow` e `CamposItem` para cá)

**Interfaces:**
- Consumes: `decidirStatus`, `AcaoStatus` (Task 2); `ResultadoCanal`, `StatusAnuncioCanal` de `../canais/contrato.ts`.
- Produces:
  - `tipos.ts`: `ItemRow`, `CamposItem` (mesmos campos de hoje); `executar.ts` re-exporta: `export type { ItemRow, CamposItem } from './tipos.ts';` (os testes antigos importam de `../executar.ts`).
  - `laco.ts`:
    ```ts
    export interface DepsLaco {
      agora(): number;
      reivindicar(operacaoId: string, mlItemId: string): Promise<boolean>;
      itensPendentes(operacaoId: string, limite: number): Promise<ItemRow[]>;
      temEnviando(operacaoId: string): Promise<boolean>;
      itensAConferir(operacaoId: string): Promise<ItemRow[]>;
      gravarItem(operacaoId: string, mlItemId: string, campos: Partial<CamposItem>): Promise<void>;
      continuar(delaySeg?: number): Promise<void>;
      agendarConferencia(delaySeg: number): Promise<void>;
      concluir(): Promise<void>;
    }
    export interface Fatal { eh(e: unknown): boolean; mensagem: string }
    export class FalhaPosEscrita extends Error { constructor(readonly causa: unknown) }
    export const gravarPos: (p: Promise<void>) => Promise<void>;
    export const mensagemDe: (e: unknown) => string;
    export async function laco(operacaoId: string, deps: DepsLaco, opts: { limiteMs: number; lote: number; maxItens?: number },
      processar: (it: ItemRow) => Promise<void>, fatal?: Fatal): Promise<{ processados: number; continuou: boolean }>;
    export async function agendarOuConcluir(deps: DepsLaco, aConferir: ItemRow[]): Promise<void>;
    ```
  - `executar.ts`: `DepsExecutar extends DepsLaco` (só os campos de promoção: `ml`, `semaforoAtual`, `espelharStatusCentral`); `executar(op, deps, opts)` com a MESMA assinatura de hoje.
  - `executar-status.ts`:
    ```ts
    export interface OperacaoStatusRow { id: string; org_id: string; acao: AcaoStatus }
    export interface DepsStatus extends DepsLaco {
      lerStatus(mlItemId: string): Promise<StatusAnuncioCanal | null>;
      migracaoPxv(mlItemId: string): Promise<string | null>;
      atualizarStatus(mlItemId: string, alvo: 'ativo' | 'pausado'): Promise<ResultadoCanal<void>>;
    }
    export const MSG_FALHA_STATUS = 'Falha ao atualizar status no Mercado Livre.';
    export function executarStatus(op: OperacaoStatusRow, deps: DepsStatus, opts: { limiteMs: number; lote: number; maxItens?: number }): Promise<{ processados: number; continuou: boolean }>;
    ```

- [ ] **Step 1: Teste do executor de status (vermelho)** — `executar-status.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { executarStatus, MSG_FALHA_STATUS, type DepsStatus, type OperacaoStatusRow } from '../executar-status.ts';
import { MSG_BLOQUEADO_STATUS } from '../decidir-status.ts';
import type { ItemRow } from '../tipos.ts';
import type { StatusAnuncioCanal } from '../../canais/contrato.ts';

type Linha = ItemRow & { mensagem?: string | null };
const item = (id: string): Linha => ({
  ml_item_id: id, preco: null, status: 'pendente', conferencias: 0, semaforo: null, confirmado_risco: false,
  proxima_conferencia: null, saida_pedida_em: null,
});

function montar(itens: Linha[], status: Record<string, StatusAnuncioCanal | null>, opts: {
  pxv?: Record<string, string>; falhaCanal?: string[]; passoMs?: number;
} = {}) {
  let t = 0;
  const deps: DepsStatus = {
    agora: () => (t += opts.passoMs ?? 0),
    reivindicar: vi.fn(async (_o, id) => {
      const it = itens.find((i) => i.ml_item_id === id)!;
      if (it.status !== 'pendente') return false;
      it.status = 'enviando';
      return true;
    }),
    itensPendentes: vi.fn(async (_o, limite) => itens.filter((i) => i.status === 'pendente').slice(0, limite).map((i) => ({ ...i }))),
    temEnviando: vi.fn(async () => itens.some((i) => i.status === 'enviando')),
    itensAConferir: vi.fn(async () => []),
    gravarItem: vi.fn(async (_o, id, campos) => { Object.assign(itens.find((i) => i.ml_item_id === id)!, campos); }),
    continuar: vi.fn(async () => {}),
    agendarConferencia: vi.fn(async () => {}),
    concluir: vi.fn(async () => {}),
    lerStatus: vi.fn(async (id) => status[id] ?? null),
    migracaoPxv: vi.fn(async (id) => opts.pxv?.[id] ?? null),
    atualizarStatus: vi.fn(async (id) => (opts.falhaCanal?.includes(id)
      ? { ok: false, erro: { codigo: 'desconhecido', mensagemOperador: 'ML recusou', retentavel: false } }
      : { ok: true })) as DepsStatus['atualizarStatus'],
  };
  return deps;
}
const PAUSAR: OperacaoStatusRow = { id: 'op', org_id: 'o', acao: 'pausar' };
const OPTS = { limiteMs: 60_000, lote: 10, maxItens: 100 };

describe('executarStatus', () => {
  it('um desfecho por item e conclui', async () => {
    const itens = ['A', 'B', 'C', 'D', 'E', 'F'].map(item);
    const deps = montar(itens, { A: 'ativo', B: 'pausado', C: 'moderado', D: 'ativo', E: null, F: 'ativo' },
      { pxv: { D: 'Migração em curso' }, falhaCanal: ['F'] });
    const r = await executarStatus(PAUSAR, deps, OPTS);
    expect(r).toEqual({ processados: 6, continuou: false });
    expect(itens.map((i) => [i.ml_item_id, i.status, i.mensagem ?? null])).toEqual([
      ['A', 'aplicado', null],
      ['B', 'ja_estava', null],
      ['C', 'bloqueado', MSG_BLOQUEADO_STATUS],
      ['D', 'bloqueado', 'Migração em curso'],
      ['E', 'erro', 'O ML não devolveu o anúncio'],
      ['F', 'erro', 'ML recusou'],
    ]);
    expect(deps.atualizarStatus).toHaveBeenCalledTimes(2); // só A e F escrevem
    expect(deps.atualizarStatus).toHaveBeenCalledWith('A', 'pausado');
    expect(deps.concluir).toHaveBeenCalledTimes(1);
  });

  it('reativar escreve ativo', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: 'pausado' });
    await executarStatus({ ...PAUSAR, acao: 'reativar' }, deps, OPTS);
    expect(deps.atualizarStatus).toHaveBeenCalledWith('A', 'ativo');
    expect(itens[0].status).toBe('aplicado');
  });

  it('erro de canal sem mensagem usa a genérica', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: 'ativo' });
    deps.atualizarStatus = vi.fn(async () => ({ ok: false }));
    await executarStatus(PAUSAR, deps, OPTS);
    expect(itens[0]).toMatchObject({ status: 'erro', mensagem: MSG_FALHA_STATUS });
  });

  it('leitura que lança vira erro do item e o laço segue', async () => {
    const itens = [item('A'), item('B')];
    const deps = montar(itens, { B: 'ativo' });
    deps.lerStatus = vi.fn(async (id: string) => { if (id === 'A') throw new Error('ML 500'); return 'ativo' as const; });
    await executarStatus(PAUSAR, deps, OPTS);
    expect(itens.map((i) => i.status)).toEqual(['erro', 'aplicado']);
  });

  it('teto por contagem: continua via QStash sem concluir', async () => {
    const itens = ['A', 'B', 'C'].map(item);
    const deps = montar(itens, { A: 'ativo', B: 'ativo', C: 'ativo' });
    const r = await executarStatus(PAUSAR, deps, { ...OPTS, maxItens: 2 });
    expect(r).toEqual({ processados: 2, continuou: true });
    expect(deps.continuar).toHaveBeenCalledTimes(1);
    expect(deps.concluir).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/operacoes` → o novo arquivo FALHA (módulo não existe); os antigos passam.

- [ ] **Step 3: Mover tipos** — em `tipos.ts` acrescentar (cópia exata dos de `executar.ts`, com o import de `Semaforo`):

```ts
import type { Semaforo } from '../promocoes/tipos.ts';
export interface ItemRow {
  ml_item_id: string; preco: number | null; status: StatusItem; conferencias: number;
  semaforo: Semaforo | null; confirmado_risco: boolean;
  proxima_conferencia: string | null;   // ISO; null = sem conferência agendada
  saida_pedida_em: string | null;       // ISO do 1º DELETE aceito; relógio das 24 h
}
export interface CamposItem {
  status: StatusItem; mensagem: string | null; offer_id: string | null; conferencias: number;
  proxima_conferencia: string | null; saida_pedida_em: string | null;
}
```
Em `executar.ts`: remover as duas interfaces e acrescentar `export type { ItemRow, CamposItem } from './tipos.ts';` + `import type { ItemRow, CamposItem } from './tipos.ts';`.

- [ ] **Step 4: Criar `laco.ts`** — mover de `executar.ts`, sem mudar a lógica, `FalhaPosEscrita`, `gravarPos`, `mensagemDe`, `ESPERA_ENVIANDO_SEG`, `finalizar`, `agendarOuConcluir`, e o corpo do laço de `executar`, generalizando só o tratamento de `SemEscritaPromocoes` para `fatal`:

```ts
// ADR-0174 — laço do motor de operações em massa, comum a todas as ações: orçamento de tempo e teto por contagem
// (continua via QStash), claim por item antes de escrever no ML, finalização (espera `enviando`, agenda conferência
// ou conclui). A regra de cada ação vive no `processar` (promoção: executar.ts; status: executar-status.ts).
import type { CamposItem, ItemRow } from './tipos.ts';

export interface DepsLaco { /* exatamente a lista do bloco Interfaces acima */ }
export interface Fatal { eh(e: unknown): boolean; mensagem: string }

const ESPERA_ENVIANDO_SEG = 150; // > 2 min: o enviando do worker morto já volta em itensPendentes

export class FalhaPosEscrita extends Error {
  constructor(readonly causa: unknown) { super(mensagemDe(causa)); }
}
/** Escrita no ML já aceita: falha ao gravar relança e o item fica `enviando` para o retry redecidir. */
export const gravarPos = (p: Promise<void>) => p.catch((e) => { throw new FalhaPosEscrita(e); });
export const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

async function finalizar(operacaoId: string, deps: DepsLaco, processados: number) {
  if (await deps.temEnviando(operacaoId)) {
    await deps.continuar(ESPERA_ENVIANDO_SEG);
    return { processados, continuou: true };
  }
  await agendarOuConcluir(deps, await deps.itensAConferir(operacaoId));
  return { processados, continuou: false };
}

export async function agendarOuConcluir(deps: DepsLaco, aConferir: ItemRow[]): Promise<void> {
  const vencimentos = aConferir.map((i) => Date.parse(i.proxima_conferencia ?? '')).filter(Number.isFinite);
  if (!vencimentos.length) return deps.concluir();
  await deps.agendarConferencia(Math.max(1, Math.ceil((Math.min(...vencimentos) - deps.agora()) / 1000)));
}

export async function laco(
  operacaoId: string, deps: DepsLaco, opts: { limiteMs: number; lote: number; maxItens?: number },
  processar: (it: ItemRow) => Promise<void>, fatal?: Fatal,
): Promise<{ processados: number; continuou: boolean }> {
  const inicio = deps.agora();
  let processados = 0;
  for (;;) {
    const lote = await deps.itensPendentes(operacaoId, opts.lote);
    if (!lote.length) break;
    for (const it of lote) {
      // Teto por contagem (ADR-0173 §4): o Supabase derruba por CPU (2 s), não por relógio.
      if (processados >= (opts.maxItens ?? Infinity) || deps.agora() - inicio >= opts.limiteMs) {
        await deps.continuar();
        return { processados, continuou: true };
      }
      if (!(await deps.reivindicar(operacaoId, it.ml_item_id))) continue;
      processados++;
      try {
        await processar(it);
      } catch (e) {
        if (e instanceof FalhaPosEscrita) throw e.causa;
        if (!fatal?.eh(e)) {
          await deps.gravarItem(operacaoId, it.ml_item_id, { status: 'erro', mensagem: mensagemDe(e) });
          continue;
        }
        // Fatal (ex.: sem permissão na conta): nada mais passa — encerra este e todos os restantes.
        await deps.gravarItem(operacaoId, it.ml_item_id, { status: 'erro', mensagem: fatal.mensagem });
        for (let resto = await deps.itensPendentes(operacaoId, opts.lote); resto.length; resto = await deps.itensPendentes(operacaoId, opts.lote)) {
          for (const r of resto) await deps.gravarItem(operacaoId, r.ml_item_id, { status: 'erro', mensagem: fatal.mensagem });
        }
        return finalizar(operacaoId, deps, processados);
      }
    }
  }
  return finalizar(operacaoId, deps, processados);
}
```

Em `executar.ts`: `DepsExecutar extends DepsLaco` mantendo só `ml`, `semaforoAtual`, `espelharStatusCentral` (com os comentários atuais); importar `FalhaPosEscrita`, `gravarPos`, `mensagemDe`, `agendarOuConcluir`, `laco` de `./laco.ts`; `executar` vira:

```ts
export function executar(
  op: OperacaoRow, deps: DepsExecutar, opts: { limiteMs: number; lote: number; maxItens?: number },
): Promise<{ processados: number; continuou: boolean }> {
  return laco(op.id, deps, opts, (it) => processarItem(op, it, deps),
    { eh: (e) => e instanceof SemEscritaPromocoes, mensagem: RECONECTAR });
}
```
`conferir` continua em `executar.ts` e passa a usar `agendarOuConcluir` importado.

- [ ] **Step 5: Criar `executar-status.ts`**

```ts
// ADR-0174 emenda 2026-10-04 — executor de pausar/reativar em massa. Escrita via conn.atualizarStatus (ADR-0060:
// propaga ao anúncio de catálogo relacionado antes do PUT do item). Status relido fresco antes de cada escrita.
import type { ResultadoCanal, StatusAnuncioCanal } from '../canais/contrato.ts';
import { decidirStatus } from './decidir-status.ts';
import { gravarPos, laco, type DepsLaco } from './laco.ts';
import type { AcaoStatus, ItemRow } from './tipos.ts';

export interface OperacaoStatusRow { id: string; org_id: string; acao: AcaoStatus }
export interface DepsStatus extends DepsLaco {
  /** Status FRESCO no ML (parseStatusML, com sub_status de moderação); null = o ML não devolveu o item. */
  lerStatus(mlItemId: string): Promise<StatusAnuncioCanal | null>;
  /** Mensagem do guard de migração PxV (ADR-0161) ou null. */
  migracaoPxv(mlItemId: string): Promise<string | null>;
  atualizarStatus(mlItemId: string, alvo: 'ativo' | 'pausado'): Promise<ResultadoCanal<void>>;
}

export const MSG_FALHA_STATUS = 'Falha ao atualizar status no Mercado Livre.';

async function processarStatus(op: OperacaoStatusRow, it: ItemRow, deps: DepsStatus): Promise<void> {
  const id = it.ml_item_id;
  const [atual, migracao] = await Promise.all([deps.lerStatus(id), deps.migracaoPxv(id)]);
  const d = decidirStatus(op.acao, atual, migracao);
  if (d.tipo === 'fim') return deps.gravarItem(op.id, id, { status: d.status, mensagem: d.mensagem });
  const r = await deps.atualizarStatus(id, d.alvo);
  if (!r.ok) return deps.gravarItem(op.id, id, { status: 'erro', mensagem: r.erro?.mensagemOperador ?? MSG_FALHA_STATUS });
  await gravarPos(deps.gravarItem(op.id, id, { status: 'aplicado', mensagem: null }));
}

export function executarStatus(
  op: OperacaoStatusRow, deps: DepsStatus, opts: { limiteMs: number; lote: number; maxItens?: number },
): Promise<{ processados: number; continuou: boolean }> {
  return laco(op.id, deps, opts, (it) => processarStatus(op, it, deps));
}
```

- [ ] **Step 6:** `pnpm test -- supabase/functions/_shared/operacoes` → TODOS passam, inclusive os 5 arquivos antigos sem edição. Conferir com `/usr/bin/git diff --stat -- supabase/functions/_shared/operacoes/__tests__/` que só o arquivo novo mudou.
- [ ] **Step 7: Commit** — `refactor(operacoes): laço comum + executor de pausar/reativar`.

---

### Task 4: Validação do pedido de status

**Files:**
- Create: `supabase/functions/_shared/operacoes/validar-status.ts`
- Create: `supabase/functions/_shared/operacoes/__tests__/validar-status.test.ts`

**Interfaces:**
- Consumes: `MAX_ITENS`, `Recusa` de `./validar.ts`.
- Produces:
  - `export interface ItemPedidoStatus { ml_item_id: string; titulo: string | null }`
  - `export function validarPedidoStatus(itens: ItemPedidoStatus[], daOrg: Set<string>, kits: Set<string>): { ok: true; itens: ItemPedidoStatus[] } | { ok: false; erro: string; itens?: Recusa[] }`

- [ ] **Step 1: Teste (vermelho)**

```ts
import { describe, expect, it } from 'vitest';
import { validarPedidoStatus } from '../validar-status.ts';
import { MAX_ITENS } from '../validar.ts';

const it1 = (id: string, titulo: string | null = 'T') => ({ ml_item_id: id, titulo });
const org = new Set(['MLB1', 'MLB2', 'MLBK']);
const kits = new Set(['MLBK']);

describe('validarPedidoStatus', () => {
  it('aceita anúncios da org; título cortado em 300', () => {
    const r = validarPedidoStatus([it1('MLB1', 'x'.repeat(400)), it1('MLB2', null)], org, kits);
    expect(r).toEqual({ ok: true, itens: [{ ml_item_id: 'MLB1', titulo: 'x'.repeat(300) }, { ml_item_id: 'MLB2', titulo: null }] });
  });
  it('recusa kit, repetido e de fora da org — tudo ou nada', () => {
    const r = validarPedidoStatus([it1('MLB1'), it1('MLB1'), it1('MLBK'), it1('MLB9')], org, kits);
    expect(r).toEqual({ ok: false, erro: 'Alguns anúncios não podem entrar na operação.', itens: [
      { ml_item_id: 'MLB1', motivo: 'Anúncio repetido no pedido' },
      { ml_item_id: 'MLBK', motivo: 'Kit Virtual não entra em pausar/reativar em massa' },
      { ml_item_id: 'MLB9', motivo: 'O anúncio não é desta organização' },
    ] });
  });
  it('vazio e acima do máximo', () => {
    expect(validarPedidoStatus([], org, kits)).toEqual({ ok: false, erro: 'Selecione ao menos um anúncio.' });
    const muitos = Array.from({ length: MAX_ITENS + 1 }, (_, i) => it1(`MLB${i}`));
    expect(validarPedidoStatus(muitos, org, kits)).toEqual({ ok: false, erro: `No máximo ${MAX_ITENS} anúncios por operação.` });
  });
});
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar**

```ts
// ADR-0174 emenda 2026-10-04 — validação do pedido de pausar/reativar (criação). Puro. Sem trava financeira:
// pausar/reativar não cria prejuízo. Kit Virtual fica fora (status em kit nunca testado — ADR-0154 D-14).
import { MAX_ITENS, type Recusa } from './validar.ts';

export interface ItemPedidoStatus { ml_item_id: string; titulo: string | null }
const TITULO_MAX = 300;

export function validarPedidoStatus(
  itens: ItemPedidoStatus[], daOrg: Set<string>, kits: Set<string>,
): { ok: true; itens: ItemPedidoStatus[] } | { ok: false; erro: string; itens?: Recusa[] } {
  if (!itens.length) return { ok: false, erro: 'Selecione ao menos um anúncio.' };
  if (itens.length > MAX_ITENS) return { ok: false, erro: `No máximo ${MAX_ITENS} anúncios por operação.` };
  const ok: ItemPedidoStatus[] = [];
  const recusas: Recusa[] = [];
  const vistos = new Set<string>();
  for (const it of itens) {
    const id = it.ml_item_id;
    if (vistos.has(id)) { recusas.push({ ml_item_id: id, motivo: 'Anúncio repetido no pedido' }); continue; }
    vistos.add(id);
    if (kits.has(id)) { recusas.push({ ml_item_id: id, motivo: 'Kit Virtual não entra em pausar/reativar em massa' }); continue; }
    if (!daOrg.has(id)) { recusas.push({ ml_item_id: id, motivo: 'O anúncio não é desta organização' }); continue; }
    ok.push({ ml_item_id: id, titulo: it.titulo?.slice(0, TITULO_MAX) ?? null });
  }
  return recusas.length ? { ok: false, erro: 'Alguns anúncios não podem entrar na operação.', itens: recusas } : { ok: true, itens: ok };
}
```
(Se `Recusa` não estiver exportada em `validar.ts`, ela está — `export interface Recusa`.)

- [ ] **Step 4:** rodar → PASS. **Step 5: Commit** — `feat(operacoes): validação do pedido de pausar/reativar`.

---

### Task 5: Fiação na edge `operacoes-massa`

**Files:**
- Modify: `supabase/functions/_shared/operacoes/deps.ts` (extrair `depsLaco`; criar `depsStatus`; `idsDaOrg`)
- Modify: `supabase/functions/operacoes-massa/index.ts`
- Test: `supabase/functions/_shared/operacoes/__tests__/` (só os existentes + novos das Tasks 2–4; a edge é fiação — validada por `pnpm check:functions` e pela validação de campo)

**Interfaces:**
- Consumes: `executarStatus`, `DepsStatus`, `OperacaoStatusRow` (Task 3); `validarPedidoStatus`, `ItemPedidoStatus` (Task 4); `AcaoStatus` (Task 2); `getConnector` de `../canais/registry.ts`; `motivoMigracaoPxvPorItem` de `../user-products/guard-migracao-pxv.ts`.
- Produces (deps.ts):
  - `export function depsLaco(admin: SupabaseClient, op: { id: string; org_id: string }, chave: string): DepsLaco`
  - `export function depsStatus(admin: SupabaseClient, cx: Cx, op: OperacaoStatusRow, chave: string): DepsStatus`
  - `export async function idsDaOrg(admin: SupabaseClient, orgId: string, ids: string[]): Promise<{ daOrg: Set<string>; kits: Set<string> }>`

- [ ] **Step 1: `deps.ts` — separar o genérico.** Mover de `depsExecutar` para `depsLaco` os métodos `agora`, `reivindicar`, `itensPendentes`, `temEnviando`, `itensAConferir`, `gravarItem`, `continuar`, `agendarConferencia`, `concluir` (mesmo código; `publicar` e `linhas` vão junto). `depsExecutar` vira:

```ts
export function depsExecutar(admin: SupabaseClient, cx: Cx, op: OperacaoRow, chave: string): DepsExecutar {
  const semaforoExato = criarSemaforoExato(admin, cx);
  return {
    ...depsLaco(admin, op, chave),
    ml: criarClienteML(cx.token),
    async semaforoAtual(promocaoId, mlItemId, preco) { /* código atual */ },
    async espelharStatusCentral(promocaoId, tipo, mlItemId, espelho) { /* código atual */ },
  };
}
```

E acrescentar:

```ts
/** Pausar/reativar: leitura e escrita pelo conector ML (ADR-0060), token da conexão da org. */
export function depsStatus(admin: SupabaseClient, cx: Cx, op: OperacaoStatusRow, chave: string): DepsStatus {
  const conn = getConnector('mercado_livre');
  const ctx = { getToken: async () => cx.token };
  return {
    ...depsLaco(admin, op, chave),
    async lerStatus(mlItemId) {
      return (await conn.lerStatus(ctx, [mlItemId]))[mlItemId]?.status ?? null;
    },
    migracaoPxv: (mlItemId) => motivoMigracaoPxvPorItem(admin, op.org_id, mlItemId),
    atualizarStatus: (mlItemId, alvo) => conn.atualizarStatus(ctx, mlItemId, alvo),
  };
}

/** Quais ids são anúncios da org (mesmas 3 fontes de status-publicados) e quais são Kit Virtual. */
export async function idsDaOrg(admin: SupabaseClient, orgId: string, ids: string[]) {
  const [f, e, u, k] = await Promise.all([
    admin.from('familias').select('ml_item_id').eq('org_id', orgId).in('ml_item_id', ids),
    admin.from('anuncios_externos').select('item_externo_id').eq('org_id', orgId).in('item_externo_id', ids),
    admin.from('anuncios_externos_itens').select('item_externo_id').eq('org_id', orgId).in('item_externo_id', ids),
    admin.from('kits_virtuais').select('ml_item_id').eq('org_id', orgId).eq('status', 'publicado').in('ml_item_id', ids),
  ]);
  for (const [onde, r] of [['familias', f], ['anuncios_externos', e], ['anuncios_externos_itens', u], ['kits_virtuais', k]] as const) falhou(onde, r.error);
  const daOrg = new Set<string>([
    ...(f.data ?? []).map((r) => String(r.ml_item_id)),
    ...(e.data ?? []).map((r) => String(r.item_externo_id)),
    ...(u.data ?? []).map((r) => String(r.item_externo_id)),
  ]);
  const kits = new Set((k.data ?? []).map((r) => String(r.ml_item_id)));
  for (const id of kits) daOrg.add(id); // kit é da org; a recusa vem pelo motivo "Kit Virtual"
  return { daOrg, kits };
}
```
Imports novos em `deps.ts`: `getConnector` (`../canais/registry.ts`), `motivoMigracaoPxvPorItem` (`../user-products/guard-migracao-pxv.ts`), `DepsLaco` (`./laco.ts`), `DepsStatus`, `OperacaoStatusRow` (`./executar-status.ts`). Se `.in()` com 500 ids estourar a URL (PostgREST ~8 KB por query string), quebrar `ids` em blocos de 100 e unir — 500 × ~14 chars = 7 KB, no limite: **fazer em blocos de 100 desde já**.

- [ ] **Step 2: `index.ts` — criação.**
  - `lerPedido` passa a devolver uma união:
    ```ts
    type Pedido =
      | { acao: 'aderir' | 'sair'; promocao_id: string; origem_id: string | null; itens: ItemPedido[] }
      | { acao: AcaoStatus; origem_id: string | null; itens: ItemPedidoStatus[] };
    ```
    Para `pausar|reativar`: exige `itens` array de `{ ml_item_id: string não vazio, titulo?: string | null }`; ignora/recusa `promocao_id` (se vier → `null` = pedido inválido).
  - Em `criar`, logo após a checagem de admin, ramificar:
    ```ts
    if (pedido.acao === 'pausar' || pedido.acao === 'reativar') return criarStatus(admin, ctx, pedido);
    ```
    (o `exigirModulo(..., 'promocoes')` fica só no ramo de promoção — mover para depois desse `if`).
  - `criarStatus`:
    1. `origem_id` (Reverter): ler `operacoes_massa (acao, promocao_id)` da org; exige `origem.acao === inversaStatus(pedido.acao)` e `origem.promocao_id === null`, senão 400 `'A operação de origem não pode ser revertida por este pedido.'`.
    2. `const ids = [...new Set(pedido.itens.map((i) => i.ml_item_id))]`; se `ids.length && ids.length <= MAX_ITENS` → `idsDaOrg(admin, orgId, ids)`, senão sets vazios.
    3. `validarPedidoStatus(...)`; `!ok` → 400 com `itens`.
    4. Insert em `operacoes_massa` `{ org_id, acao, origem_id, criado_por: userId }` (sem promoção), itens com `promocao_id: null`, `titulo`, `semaforo: null`, `confirmado_risco: false`. Mesmo tratamento de `23505` → 409 `'Algum destes anúncios já está numa operação em andamento.'`, mesmo publish QStash, mesma auditoria — **reaproveitar o trecho atual extraindo-o para uma função `gravarEPublicar(admin, ctx, cabecalho, itens)`** usada pelos dois ramos, em vez de copiar.
    - `inversaStatus = (a: AcaoStatus): AcaoStatus => (a === 'pausar' ? 'reativar' : 'pausar')`.
- [ ] **Step 3: `index.ts` — etapa QStash.** Depois de ler `linha` e checar `concluida`, antes do bloco de módulo/promoção:
    ```ts
    if (linha.acao === 'pausar' || linha.acao === 'reativar') {
      const cx = await conexaoDaOrg(admin, linha.org_id);
      if (!cx) {
        await encerrarComErro(admin, linha, MSG_SEM_CONEXAO);
        return json({ ok: false, erro: MSG_SEM_CONEXAO });
      }
      const op: OperacaoStatusRow = { id: linha.id, org_id: linha.org_id, acao: linha.acao };
      const chave = req.headers.get('upstash-message-id') ?? crypto.randomUUID();
      // Sem etapa de conferência: o PUT de status é síncrono (qualquer etapa executa).
      return json({ ok: true, ...(await executarStatus(op, depsStatus(admin, cx, op, chave), EXECUCAO)) });
    }
    ```
    O `select` de `linha` não muda. `OperacaoRow` do ramo de promoção passa a receber `linha.promocao_id!`/`linha.promocao_tipo!` (o CHECK da Task 1 garante).
  - Atualizar o comentário de cabeçalho do arquivo: "aderir/sair de promoções DEAL/SMART e pausar/reativar anúncios".
- [ ] **Step 4: Verificar** — `pnpm lint:functions && pnpm check:functions` → sem erro; `pnpm test -- supabase/functions/_shared/operacoes` → PASS.
- [ ] **Step 5: Commit** — `feat(operacoes-massa): criar e executar pausar/reativar`.

---

### Task 6: Front — regras puras e hooks

**Files:**
- Modify: `src/lib/operacoes.ts`
- Modify: `src/lib/__tests__/operacoes.test.ts` (acrescentar `describe`s; não alterar os existentes)
- Modify: `src/hooks/useOperacoes.ts`

**Interfaces:**
- Produces (`src/lib/operacoes.ts`):
  ```ts
  export type AcaoPromocao = 'aderir' | 'sair';
  export type AcaoStatus = 'pausar' | 'reativar';
  export type AcaoOperacao = AcaoPromocao | AcaoStatus;
  export const ehAcaoStatus: (a: string) => a is AcaoStatus;
  export function inversa<A extends AcaoOperacao>(a: A): A;   // aderir↔sair, pausar↔reativar
  export function itensRevertiveis(acao: AcaoOperacao, itens: {ml_item_id; status}[]): string[]; // aderir: aplicado+ja_estava; demais: aplicado
  export function tituloOperacao(op: { acao: string; promocao_nome: string | null; promocao_id: string | null }, total: number): string;
  export function motivoNaoSelecionavel(i: Pick<PublicadoItem, 'ehKitVirtual' | 'publicacaoIncompleta' | 'migracaoEmAndamento' | 'status'>): string | null;
  export function separarSelecao(itens: Pick<PublicadoItem, 'mlItemId' | 'status'>[]): { ativos: string[]; pausados: string[] };
  ```
  `montarPreview` e `precisaConfirmarRisco` passam a tipar `acao: AcaoPromocao`.
- Produces (`src/hooks/useOperacoes.ts`):
  ```ts
  export interface PedidoOperacaoStatus { acao: AcaoStatus; origem_id: string | null; itens: { ml_item_id: string; titulo: string | null }[] }
  // useCriarOperacao aceita PedidoOperacao | PedidoOperacaoStatus
  export function useAcompanharOperacao(id: string | null): void; // poll 5 s enquanto executando; ao concluir invalida QK.statusPublicados e QK_OPERACOES
  ```

- [ ] **Step 1: Testes (vermelho)** — acrescentar em `src/lib/__tests__/operacoes.test.ts`:

```ts
describe('operações de status (emenda 2026-10-04)', () => {
  it('inversa e revertíveis', () => {
    expect(inversa('pausar')).toBe('reativar');
    expect(inversa('reativar')).toBe('pausar');
    const itens = [{ ml_item_id: 'A', status: 'aplicado' as const }, { ml_item_id: 'B', status: 'ja_estava' as const }];
    expect(itensRevertiveis('pausar', itens)).toEqual(['A']); // ja_estava não fomos nós que mudamos
    expect(itensRevertiveis('aderir', itens)).toEqual(['A', 'B']); // regra antiga intacta
  });
  it('título por tipo', () => {
    expect(tituloOperacao({ acao: 'pausar', promocao_nome: null, promocao_id: null }, 47)).toBe('Pausar 47 anúncios');
    expect(tituloOperacao({ acao: 'reativar', promocao_nome: null, promocao_id: null }, 1)).toBe('Reativar 1 anúncio');
    expect(tituloOperacao({ acao: 'aderir', promocao_nome: '10.10', promocao_id: 'P1' }, 3)).toBe('Aderir à 10.10');
    expect(tituloOperacao({ acao: 'sair', promocao_nome: null, promocao_id: 'P1' }, 3)).toBe('Sair de P1');
  });
  it('quem não entra na seleção', () => {
    expect(motivoNaoSelecionavel({ status: 'ativo' })).toBeNull();
    expect(motivoNaoSelecionavel({ status: 'pausado' })).toBeNull();
    expect(motivoNaoSelecionavel({ status: 'ativo', ehKitVirtual: true })).toBe('Kit Virtual não entra em pausar/reativar em massa');
    expect(motivoNaoSelecionavel({ status: 'ativo', publicacaoIncompleta: true })).toBe('Publicação incompleta');
    expect(motivoNaoSelecionavel({ status: 'ativo', migracaoEmAndamento: true })).toBe('Migração para preço por variação em andamento');
    expect(motivoNaoSelecionavel({ status: 'moderado' })).toBe('Só anúncio ativo ou pausado');
    expect(motivoNaoSelecionavel({ status: undefined })).toBe('Só anúncio ativo ou pausado');
  });
  it('separa ativos e pausados', () => {
    expect(separarSelecao([{ mlItemId: 'A', status: 'ativo' }, { mlItemId: 'B', status: 'pausado' }, { mlItemId: 'C', status: 'moderado' }]))
      .toEqual({ ativos: ['A'], pausados: ['B'] });
  });
});
```
(acrescentar `tituloOperacao`, `motivoNaoSelecionavel`, `separarSelecao` ao import do topo do arquivo.)

- [ ] **Step 2:** `pnpm test -- src/lib/__tests__/operacoes.test.ts` → FAIL.
- [ ] **Step 3: Implementar em `src/lib/operacoes.ts`**

```ts
import type { PublicadoItem } from '@/lib/publicados';

export type AcaoPromocao = 'aderir' | 'sair';
export type AcaoStatus = 'pausar' | 'reativar';
export type AcaoOperacao = AcaoPromocao | AcaoStatus;
export const ehAcaoStatus = (a: string): a is AcaoStatus => a === 'pausar' || a === 'reativar';

const INVERSA: Record<AcaoOperacao, AcaoOperacao> = { aderir: 'sair', sair: 'aderir', pausar: 'reativar', reativar: 'pausar' };
export function inversa<A extends AcaoOperacao>(a: A): A {
  return INVERSA[a] as A;
}

/** Ajuste 4: só `aderir` reverte também o que já estava participando; o resto só o que NÓS mudamos (`aplicado`). */
export function itensRevertiveis(acao: AcaoOperacao, itens: { ml_item_id: string; status: StatusItemOperacao }[]): string[] {
  const aceitos: StatusItemOperacao[] = acao === 'aderir' ? ['aplicado', 'ja_estava'] : ['aplicado'];
  return itens.filter((i) => aceitos.includes(i.status)).map((i) => i.ml_item_id);
}

export function tituloOperacao(op: { acao: string; promocao_nome: string | null; promocao_id: string | null }, total: number): string {
  if (ehAcaoStatus(op.acao)) return `${op.acao === 'pausar' ? 'Pausar' : 'Reativar'} ${total} anúncio${total === 1 ? '' : 's'}`;
  const nome = op.promocao_nome ?? op.promocao_id ?? '';
  return `${op.acao === 'aderir' ? 'Aderir à' : 'Sair de'} ${nome}`;
}

export function motivoNaoSelecionavel(
  i: Pick<PublicadoItem, 'ehKitVirtual' | 'publicacaoIncompleta' | 'migracaoEmAndamento' | 'status'>,
): string | null {
  if (i.ehKitVirtual) return 'Kit Virtual não entra em pausar/reativar em massa';
  if (i.publicacaoIncompleta) return 'Publicação incompleta';
  if (i.migracaoEmAndamento) return 'Migração para preço por variação em andamento';
  if (i.status !== 'ativo' && i.status !== 'pausado') return 'Só anúncio ativo ou pausado';
  return null;
}

export function separarSelecao(itens: Pick<PublicadoItem, 'mlItemId' | 'status'>[]) {
  return {
    ativos: itens.filter((i) => i.status === 'ativo').map((i) => i.mlItemId),
    pausados: itens.filter((i) => i.status === 'pausado').map((i) => i.mlItemId),
  };
}
```
Substituir as versões antigas de `inversa` e `itensRevertiveis`; trocar `acao: AcaoOperacao` por `acao: AcaoPromocao` em `montarPreview` e `precisaConfirmarRisco`. Atualizar o comentário do topo ("aderir/sair de promoções e pausar/reativar anúncios"). Se `PublicadoItem['status']` não aceitar `undefined` no `Pick`, ajustar o teste para `status: 'indisponivel'`.

- [ ] **Step 4: Hooks** — em `src/hooks/useOperacoes.ts`:

```ts
export interface PedidoOperacaoStatus {
  acao: AcaoStatus; origem_id: string | null; itens: { ml_item_id: string; titulo: string | null }[];
}
```
`useCriarOperacao`: `mutationFn: async (pedido: PedidoOperacao | PedidoOperacaoStatus)`; no `onSuccess` manter as duas invalidações. Acrescentar:

```ts
/** Emenda 2026-10-04: acompanha uma operação criada na tela Publicados; ao concluir, força o status ao vivo
 *  (`QK.statusPublicados`, cache de 5 min) e a lista de operações a recarregarem. */
export function useAcompanharOperacao(id: string | null) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: [...QK_OPERACOES, id, 'acompanhar'],
    queryFn: async () => {
      const { data, error } = await supabase.from('operacoes_massa').select('status').eq('id', id!).single();
      if (error) throw error;
      return data as { status: string };
    },
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'concluida' ? false : 5_000),
  });
  const concluida = data?.status === 'concluida';
  useEffect(() => {
    if (!concluida) return;
    qc.invalidateQueries({ queryKey: QK.statusPublicados });
    qc.invalidateQueries({ queryKey: QK_OPERACOES });
  }, [concluida, qc]);
}
```
(import `QK` de `@/lib/queries`; `AcaoStatus` de `@/lib/operacoes`.)

- [ ] **Step 5:** `pnpm test -- src/lib/__tests__/operacoes.test.ts src/components/promocoes` → PASS; `pnpm exec tsc -b` sem erro.
- [ ] **Step 6: Commit** — `feat(front): regras e hooks de pausar/reativar em massa`.

---

### Task 7: Front — lista global de Operações, preview de status e Reverter

**Files:**
- Move: `src/components/promocoes/lista-operacoes.tsx` → `src/components/operacoes/lista-operacoes.tsx` (`/usr/bin/git mv`)
- Move: `src/components/promocoes/__tests__/lista-operacoes.test.tsx` → `src/components/operacoes/__tests__/lista-operacoes.test.tsx` (só o caminho de import muda: `../lista-operacoes` continua)
- Create: `src/components/operacoes/preview-status.tsx`
- Create: `src/components/operacoes/__tests__/preview-status.test.tsx`
- Create: `src/pages/Operacoes.tsx`
- Modify: `src/pages/Promocoes.tsx` (import novo; `<ListaOperacoes filtro="promocao" />`)
- Modify: `src/App.tsx` (rota `/operacoes` dentro do `MenuGuard`)
- Modify: `src/lib/menus.ts` (`PREFIX.operacoes = 'publicados'`)
- Modify: `src/components/sidebar.tsx` (item `{ to: '/operacoes', label: 'Operações', icon: History, end: false, key: 'publicados' }` logo após Promoções)

**Interfaces:**
- Consumes: `tituloOperacao`, `ehAcaoStatus`, `inversa`, `itensRevertiveis` (Task 6); `useCriarOperacao`, `PedidoOperacaoStatus`, `usePodeExecutarOperacao`, `ErroOperacao` (Task 6/existente).
- Produces:
  - `export function ListaOperacoes({ filtro }: { filtro?: 'promocao' }): JSX.Element` — sem `filtro` mostra todas; `'promocao'` só `aderir|sair`.
  - `export function PreviewStatus(props: { acao: AcaoStatus; itens: { ml_item_id: string; titulo: string | null; thumbnail?: string | null }[]; foraDoLote: { motivo: string; quantidade: number }[]; origemId: string | null; aberto: boolean; onFechar: () => void; onCriada: (operacaoId: string) => void }): JSX.Element`

Decisão de menu: `/operacoes` usa a chave de menu `publicados` (quem vê Publicados vê Operações) — evita chave nova em `MENU_KEYS` e migration de `allowed_menus`. A sidebar já usa `to` como React key, então duas entradas com `key: 'publicados'` não colidem.

- [ ] **Step 1: Teste do preview (vermelho)** — `preview-status.test.tsx`, mesmo padrão de mocks de `lista-operacoes.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreviewStatus } from '../preview-status';
import { useCriarOperacao, usePodeExecutarOperacao } from '@/hooks/useOperacoes';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useOperacoes', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOperacoes')>('@/hooks/useOperacoes');
  return { ...actual, useCriarOperacao: vi.fn(), usePodeExecutarOperacao: vi.fn() };
});

const mutateAsync = vi.fn(async () => ({ operacao_id: 'OP9' }));
beforeEach(() => {
  vi.mocked(useCriarOperacao).mockReturnValue({ mutateAsync, isPending: false } as never);
  vi.mocked(usePodeExecutarOperacao).mockReturnValue(true);
  mutateAsync.mockClear();
});
const itens = [{ ml_item_id: 'MLB1', titulo: 'Toalha Azul' }, { ml_item_id: 'MLB2', titulo: 'Toalha Verde' }];

describe('PreviewStatus', () => {
  it('pausar: lista, avisos de catálogo e de estoque, executa com os ids', async () => {
    const onCriada = vi.fn();
    render(<PreviewStatus acao="pausar" itens={itens} foraDoLote={[{ motivo: 'Kit Virtual', quantidade: 1 }]}
      origemId={null} aberto onFechar={() => {}} onCriada={onCriada} />);
    expect(screen.getByText('Toalha Azul')).toBeInTheDocument();
    expect(screen.getByText(/catálogo ligados a estes também mudam/i)).toBeInTheDocument();
    expect(screen.getByText(/repor estoque reativa/i)).toBeInTheDocument();
    expect(screen.getByText(/1 fora do lote: Kit Virtual/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pausar 2 anúncios' }));
    expect(mutateAsync).toHaveBeenCalledWith({ acao: 'pausar', origem_id: null, itens: [
      { ml_item_id: 'MLB1', titulo: 'Toalha Azul' }, { ml_item_id: 'MLB2', titulo: 'Toalha Verde' },
    ] });
    expect(onCriada).toHaveBeenCalledWith('OP9');
  });
  it('reativar não mostra o aviso de estoque', () => {
    render(<PreviewStatus acao="reativar" itens={itens} foraDoLote={[]} origemId={null} aberto onFechar={() => {}} onCriada={() => {}} />);
    expect(screen.queryByText(/repor estoque reativa/i)).not.toBeInTheDocument();
  });
  it('membro comum vê o preview mas não executa', () => {
    vi.mocked(usePodeExecutarOperacao).mockReturnValue(false);
    render(<PreviewStatus acao="pausar" itens={itens} foraDoLote={[]} origemId={null} aberto onFechar={() => {}} onCriada={() => {}} />);
    expect(screen.queryByRole('button', { name: /Pausar 2/ })).not.toBeInTheDocument();
    expect(screen.getByText('Só administradores executam.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar `preview-status.tsx`** usando os mesmos primitivos de `preview-operacao.tsx` (abrir o arquivo e seguir o mesmo `Dialog`/`Sheet`, classes e tratamento de `ErroOperacao` — inclusive mostrar `erro.itens` recusados):

```tsx
// ADR-0174 emenda 2026-10-04 — preview de pausar/reativar em massa: o que muda, o que fica de fora e os avisos.
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErroOperacao, useCriarOperacao, usePodeExecutarOperacao } from '@/hooks/useOperacoes';
import type { AcaoStatus } from '@/lib/operacoes';
import { formatarNomeProduto } from '@/lib/texto';

interface Props {
  acao: AcaoStatus;
  itens: { ml_item_id: string; titulo: string | null; thumbnail?: string | null }[];
  foraDoLote: { motivo: string; quantidade: number }[];
  origemId: string | null;
  aberto: boolean;
  onFechar: () => void;
  onCriada: (operacaoId: string) => void;
}

export function PreviewStatus({ acao, itens, foraDoLote, origemId, aberto, onFechar, onCriada }: Props) {
  const criar = useCriarOperacao();
  const podeExecutar = usePodeExecutarOperacao();
  const verbo = acao === 'pausar' ? 'Pausar' : 'Reativar';
  const rotulo = `${verbo} ${itens.length} anúncio${itens.length === 1 ? '' : 's'}`;

  const executar = async () => {
    try {
      const r = await criar.mutateAsync({ acao, origem_id: origemId, itens: itens.map((i) => ({ ml_item_id: i.ml_item_id, titulo: i.titulo })) });
      onCriada(r.operacao_id);
    } catch (e) {
      const msg = e instanceof ErroOperacao ? e.message : 'Não foi possível criar a operação.';
      toast.error(msg);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{rotulo}</DialogTitle>
          <DialogDescription>Anúncios de catálogo ligados a estes também mudam.</DialogDescription>
        </DialogHeader>
        {acao === 'pausar' && (
          <p className="text-sm text-muted-foreground">Atenção: repor estoque reativa estes anúncios automaticamente.</p>
        )}
        {foraDoLote.map((f) => (
          <p key={f.motivo} className="text-sm text-muted-foreground">{f.quantidade} fora do lote: {f.motivo}</p>
        ))}
        <ul className="max-h-72 divide-y overflow-y-auto rounded border text-sm">
          {itens.map((i) => (
            <li key={i.ml_item_id} className="flex items-center gap-2 p-2">
              {i.thumbnail && <img src={i.thumbnail} alt="" className="h-8 w-8 rounded object-cover" />}
              <span className="min-w-0 flex-1 truncate">{i.titulo ? formatarNomeProduto(i.titulo) : i.ml_item_id}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{i.ml_item_id}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          {podeExecutar
            ? <Button onClick={executar} disabled={criar.isPending || itens.length === 0}>{rotulo}</Button>
            : <p className="text-sm text-muted-foreground">Só administradores executam.</p>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```
Se `formatarNomeProduto` alterar o texto do teste ("Toalha Azul"), trocar o teste para o texto formatado — não remover a formatação (é o padrão da lista).

- [ ] **Step 4: Mover e generalizar `ListaOperacoes`.**
  - `/usr/bin/git mv` dos dois arquivos; atualizar import em `Promocoes.tsx` e o import de `PreviewOperacao` dentro da lista para `@/components/promocoes/preview-operacao`.
  - Prop `filtro?: 'promocao'`: `const lista = filtro === 'promocao' ? ops.filter((o) => !ehAcaoStatus(o.acao)) : ops;`.
  - Trocar o `tituloOperacao` local por `tituloOperacao(op, op.itens.length)` de `@/lib/operacoes`.
  - `useItensPromocao(opAberta && !ehAcaoStatus(opAberta.acao) ? opAberta.promocao_id ?? '' : '')` — operação de status não carrega a Central.
  - Reverter de operação de status: `ids = itensRevertiveis(op.acao, paraRevertiveis(itensOp))`; abre `<PreviewStatus acao={inversa(op.acao)} itens={ids.map(id => ({ ml_item_id: id, titulo: porLog.get(id)?.titulo ?? null }))} foraDoLote={[]} origemId={op.id} ... />` (o handler revalida no ML; não há "Central" para confrontar). Reverter de promoção: caminho atual, intacto.
  - Empty state sem filtro: título "Nenhuma operação ainda", descrição "Selecione anúncios em Publicados ou numa campanha de Promoções.".
  - Acrescentar ao teste movido 2 casos: (a) operação `acao: 'pausar', promocao_id: null, promocao_nome: null, promocao_tipo: null` com 3 itens → mostra "Pausar 3 anúncios"; (b) `filtro="promocao"` esconde essa operação. Usar o `op()` do próprio arquivo com override.
- [ ] **Step 5: Página e rota.**

`src/pages/Operacoes.tsx`:
```tsx
// ADR-0174 emenda 2026-10-04 — tela global de operações em massa (promoções e pausar/reativar).
import { PageHeader } from '@/components/ui/page-header';
import { ListaOperacoes } from '@/components/operacoes/lista-operacoes';

export default function Operacoes() {
  return (
    <div className="space-y-4">
      <PageHeader title="Operações" description="Operações em massa da organização: andamento, resultado por anúncio e Reverter." />
      <ListaOperacoes />
    </div>
  );
}
```
(`PageHeader` de `@/components/ui/page-header`, export default — igual a `Promocoes.tsx`; conferir as props reais de `PageHeader` lá. Em `App.tsx`: `const Operacoes = lazy(() => import('@/pages/Operacoes'));`, como as demais páginas.)
`App.tsx`: `<Route path="/operacoes" element={<Operacoes />} />` junto das rotas de Promoções. `menus.ts`: `operacoes: 'publicados',` no `PREFIX`. `sidebar.tsx`: item novo após Promoções, ícone `History` do `lucide-react`.
- [ ] **Step 6:** `pnpm test -- src/components/operacoes src/components/promocoes src/lib` → PASS; `pnpm exec tsc -b` → sem erro.
- [ ] **Step 7: Commit** — `feat(front): tela global de Operações e preview de pausar/reativar`.

---

### Task 8: Front — seleção na tela Publicados

**Files:**
- Create: `src/components/operacoes/barra-selecao-publicados.tsx`
- Create: `src/components/operacoes/__tests__/barra-selecao-publicados.test.tsx`
- Modify: `src/pages/Publicados.tsx`

**Interfaces:**
- Consumes: `motivoNaoSelecionavel`, `separarSelecao` (Task 6); `PreviewStatus` (Task 7); `useAcompanharOperacao` (Task 6).
- Produces: `export function BarraSelecaoPublicados({ ativos, pausados, onPausar, onReativar, onLimpar }: { ativos: number; pausados: number; onPausar: () => void; onReativar: () => void; onLimpar: () => void }): JSX.Element | null`

- [ ] **Step 1: Teste da barra (vermelho)**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarraSelecaoPublicados } from '../barra-selecao-publicados';

describe('BarraSelecaoPublicados', () => {
  it('some sem seleção', () => {
    const { container } = render(<BarraSelecaoPublicados ativos={0} pausados={0} onPausar={vi.fn()} onReativar={vi.fn()} onLimpar={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('contagens e botões; 0 desabilita', async () => {
    const onPausar = vi.fn();
    render(<BarraSelecaoPublicados ativos={2} pausados={0} onPausar={onPausar} onReativar={vi.fn()} onLimpar={vi.fn()} />);
    expect(screen.getByText('2 selecionados')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reativar 0' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Pausar 2' }));
    expect(onPausar).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar a barra** (mesmo visual de `components/promocoes/barra-selecao.tsx`):

```tsx
// ADR-0174 emenda 2026-10-04 — barra fixa da seleção na tela Publicados.
import { Button } from '@/components/ui/button';

export function BarraSelecaoPublicados({ ativos, pausados, onPausar, onReativar, onLimpar }: {
  ativos: number; pausados: number; onPausar: () => void; onReativar: () => void; onLimpar: () => void;
}) {
  const total = ativos + pausados;
  if (total === 0) return null;
  return (
    <div className="sticky bottom-0 z-30 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-lg">
      <p className="text-sm font-medium">{total} selecionado{total > 1 ? 's' : ''}</p>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onPausar} disabled={ativos === 0}>Pausar {ativos}</Button>
        <Button size="sm" variant="outline" onClick={onReativar} disabled={pausados === 0}>Reativar {pausados}</Button>
        <Button size="sm" variant="ghost" onClick={onLimpar}>Limpar</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Integrar em `Publicados.tsx`** (arquivo grande — mudanças cirúrgicas):
  1. Estado: `const [selecao, setSelecao] = useState<Set<string>>(new Set());`, `const [previewAcao, setPreviewAcao] = useState<AcaoStatus | null>(null);`, `const [acompanhando, setAcompanhando] = useState<string | null>(null);` + `useAcompanharOperacao(acompanhando);`.
  2. Limpar ao trocar o filtro: `useEffect(() => { setSelecao(new Set()); }, [filtro]);` — `filtro` vem de `useMemo` sobre `searchParams`; se a identidade mudar a cada render, usar `JSON.stringify(filtro)` como dependência.
  3. `const selecionaveis = useMemo(() => itensExibidos.filter((i) => !motivoNaoSelecionavel(i)), [itensExibidos]);` e `const itensSelecionados = useMemo(() => itensExibidos.filter((i) => selecao.has(i.mlItemId)), [itensExibidos, selecao]);` + `const { ativos, pausados } = separarSelecao(itensSelecionados);`.
  4. Cabeçalho: nova `<TableHead className="w-8">` como **primeira** coluna com `<Checkbox aria-label={`Selecionar todos do filtro (${selecionaveis.length})`} checked={selecionaveis.length > 0 && selecionaveis.every((i) => selecao.has(i.mlItemId))} onCheckedChange={(v) => setSelecao(v ? new Set(selecionaveis.map((i) => i.mlItemId)) : new Set())} />` (componente `Checkbox` de `@/components/ui/checkbox`; confirmar que existe — é o usado em `PromocaoDetalhe.tsx`). Ajustar a coluna "Título" (sticky) para não sobrepor: a célula do checkbox fica `sm:static` igual.
  5. Linhas: `LinhaTabela` ganha props `selecionado: boolean`, `onSelecionar: (v: boolean) => void`, `motivoNaoSelecionavel: string | null`; primeira `<TableCell>` com `<Checkbox checked={selecionado} disabled={!!motivo} title={motivo ?? undefined} aria-label={`Selecionar ${item.titulo}`} onCheckedChange={(v) => onSelecionar(v === true)} />`. `LinhaIncompleta` e `LinhaKitVirtual` ganham uma `<TableCell />` vazia como primeira célula (mantém colunas alinhadas). Todos os `colSpan={temFiscal ? 10 : 9}` viram `temFiscal ? 11 : 10`.
  6. `onSelecionar` em `LinhaTabela`: `(v) => setSelecao((s) => { const n = new Set(s); if (v) n.add(item.mlItemId); else n.delete(item.mlItemId); return n; })`.
  7. Abaixo da tabela (antes da paginação): `<BarraSelecaoPublicados ativos={ativos.length} pausados={pausados.length} onPausar={() => setPreviewAcao('pausar')} onReativar={() => setPreviewAcao('reativar')} onLimpar={() => setSelecao(new Set())} />`.
  8. Preview: quando `previewAcao`, montar `const alvo = previewAcao === 'pausar' ? ativos : pausados;` e `const foraDoLote = [{ motivo: previewAcao === 'pausar' ? 'já pausados' : 'já ativos', quantidade: (previewAcao === 'pausar' ? pausados : ativos).length }].filter((f) => f.quantidade > 0);` e renderizar `<PreviewStatus acao={previewAcao} itens={alvo.map((id) => { const i = itensSelecionados.find((x) => x.mlItemId === id)!; return { ml_item_id: id, titulo: i.titulo }; })} foraDoLote={foraDoLote} origemId={null} aberto onFechar={() => setPreviewAcao(null)} onCriada={(id) => { setPreviewAcao(null); setSelecao(new Set()); setAcompanhando(id); toast.success('Operação iniciada', { action: { label: 'Ver em Operações', onClick: () => navigate('/operacoes') } }); }} />`. (`PublicadoItem` não tem miniatura — `thumbnail` fica ausente; `navigate` via `useNavigate` se a página ainda não tiver.)
  9. Layout mobile: se a tela tiver variante em cards abaixo de `sm`, o checkbox entra no card também; se só tiver a tabela com scroll horizontal (é o caso hoje — a coluna Título é sticky), basta o passo 4–5.
- [ ] **Step 5:** `pnpm test -- src/components/operacoes src/pages` → PASS (se houver teste de `Publicados` que conte colunas/células, atualizar a contagem — é consequência direta da coluna nova); `pnpm exec tsc -b` sem erro.
- [ ] **Step 6: Commit** — `feat(publicados): seleção em massa para pausar/reativar`.

---

### Task 9: Portão, docs, revisão, merge e deploy

**Files:**
- Modify: `docs/TASKS.md`, `docs/reference/edge-functions.md` (`operacoes-massa`: ações), `docs/reference/modelo-de-dados.md` (`operacoes_massa`: `acao` e nullable), `docs/reference/glossario.md` se houver § de operações em massa, Changelog/obsidian conforme skill `docs-update-checklist`.

- [ ] **Step 1:** Invocar a skill `docs-update-checklist` e atualizar os docs que ela mapear para "migration + edge alterada + tela nova".
- [ ] **Step 2: Portão local** — `pnpm preflight:static` e `pnpm test` → tudo verde. Colar o resumo no relatório.
- [ ] **Step 3: Commit + push da branch**; esperar CI (`frontend`, `backend-lint`) verde: `gh run watch`.
- [ ] **Step 4: Revisão pré-merge Grok 4.7 xhigh** (rodada única): `cursor-agent -p --mode ask --model grok-4.7-xhigh "<revise o diff de origin/main..HEAD contra a spec docs/superpowers/specs/2026-10-04-pausar-reativar-em-massa-design.md; foco nos 5 itens de Review Focus do plano>" < /dev/null`. Corrigir os achados válidos, teste + CI, sem reenviar ao Grok.
- [ ] **Step 5: Merge fast-forward na main** (`/usr/bin/git push origin <sha>:main`), depois:
  - `supabase db push` (migration da Task 1) → conferir as constraints com `select conname from pg_constraint where conrelid='public.operacoes_massa'::regclass`;
  - `supabase functions deploy operacoes-massa` → conferir versão nova ativa (`supabase functions list`).
  - Ordem obrigatória: db push → functions deploy (a edge nova grava `promocao_id null`, que o schema antigo recusa).
- [ ] **Step 6: Validação de campo na DSA** (MLBs aprovados pelo Diego antes, 2–3 anúncios ativos): Publicados → filtrar → selecionar → Pausar → acompanhar em `/operacoes` → conferir no ML (`GET /items/{id}` só leitura: `status: paused`, e o catálogo relacionado também) → Reverter → conferir `active`. Prints 1440 e 360 px (Playwright próprio, sessão isolada — nunca o Chrome do Diego). Aba Operações em Promoções continua mostrando só aderir/sair.
- [ ] **Step 7:** Deletar a branch e remover o worktree (`rm -rf` + `git worktree prune`, por causa do iCloud).
