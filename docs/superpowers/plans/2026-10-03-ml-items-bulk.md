# Multiget ML `/items?ids=` → `/items/bulk` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** trocar as 14 chamadas a `GET /items?ids=` (13 arquivos) por `GET /items/bulk?ids=` antes de 25/10/2026, sem mudar nenhuma saída observável dos módulos e sem nenhuma escrita no Mercado Livre fora do fluxo do app.

**Architecture:** um helper **puro** em `_shared/ml/multiget.ts` monta a URL do bulk (`status_code` + prefixo `body.`), quebra os ids em blocos únicos de ≤20 e normaliza os dois envelopes (`code`/`status_code`). Cada módulo mantém o próprio transporte e a própria semântica de erro e troca só três coisas: o laço de blocos, a URL e o filtro `code === 200`. A migração sai em 6 fatias, cada uma com TDD, A/B contra a `main` com token real (só GET, com a escrita bloqueada por uma guarda), revisão do Codex, merge, deploy e observação em produção.

**Tech Stack:** Deno (Supabase Edge Functions), TypeScript, vitest (`pnpm test`), Supabase CLI, Codex CLI.

**Spec:** `docs/superpowers/specs/2026-10-03-ml-items-bulk-design.md`. A tabela da §2 é o contrato medido e a §3 é o inventário.

## Global Constraints

- **No ML, só GET** durante spike, A/B e validação. **Nunca** PUT/POST/DELETE em anúncio fora do fluxo normal do app, nem para teste.
- O token ML é lido por SQL read-only (`get_connection_tokens`) via Management API (`SUPABASE_ACCESS_TOKEN` do `.env.local` da raiz). **Nunca** renovar, imprimir ou gravar o token. Scripts descartáveis ficam em `$CLAUDE_JOB_DIR/tmp` (`/Users/diego/.claude/jobs/b87cbc02/tmp`).
- Lote: **no máximo 20 ids, sem repetição** (bulk: 21 → 400; repetido → 400 no lote inteiro).
- A seleção do bulk sempre começa com `status_code` e todo campo do item leva o prefixo `body.`.
- Nenhuma mudança de comportamento observável: mesma saída, mesmo `throw` e `[]`, mesmos logs. Exceção declarada: dedup e blocos onde antes não havia (PxV, operações). Hoje esses casos já quebrariam com 400.
- `fiacao.ts` e `coletar-trafego-ml/deps.ts` (referência já migrada) **não mudam**.
- Deploy **só depois do merge** na `main`. A lista de edges sai de `deno info`, não de grep. A versão ativa é conferida com `supabase functions list`.
- Merge: fast-forward, com CI verde (`frontend`, `backend-lint`) e **OK do Diego por fatia**. Nunca `--admin` nem force-push.
- Revisão: o Codex `gpt-6.1-sol` high revisa o plano, o diff de cada fatia e o pré-merge (`codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only "<prompt>" < /dev/null`). A consultoria em caso de dúvida é o `gpt-6-astra` high.
- git em worktree: usar `/usr/bin/git` com comando simples e commit por `-F <arquivo em $CLAUDE_JOB_DIR/tmp>`. Fim de toda mensagem de commit: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prazo: tudo em produção até **15/10/2026**.

## Review Focus

1. **Id repetido na entrada**, comum quando N SKUs apontam para o mesmo item (PxV antes da migração, partições). Esperado: uma consulta por id e nenhum 400. Testes em T0 (`blocosMultiget`) e nos testes de módulo de T1, T2 e T5 com ids repetidos.
2. **Id inexistente ou removido no meio do lote.** O bulk devolve `{status_code:404}` **sem body**. Esperado: os outros 19 seguem normais e aquele id fica ausente, como hoje. Testes em T0 (`itensMultiget`) e no fixture de cada fatia (todos incluem a entrada 404).
3. **Mais de 20 ids** num módulo que hoje não divide em blocos (PxV `lerCores`/estoque vivo, `operacoes.lerRelacoes`). Esperado: dividir em blocos, sem 400. Testes em T4 e T5.
4. **`lerStatus` alimentando escrita** (`sincronizar-estoque` reativa quando lê `pausado`; `publicar-split-ml` usa `preco`). Esperado: `StatusCanal` idêntico ao da `main` nos mesmos anúncios. Teste em T1 (fixture) e no A/B de T1, que compara o objeto inteiro.
5. **Propagação de status para relacionados de catálogo** (`propagarStatusRelacionadosML`). Esperado: os mesmos PUTs que a `main` faria. Teste novo em T1 e A/B de T1, com a guarda bloqueando e registrando os PUTs, sem rede.

---

## File Structure

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `supabase/functions/_shared/ml/multiget.ts` (novo) | URL do bulk, blocos únicos ≤20, normalização do envelope | T0 |
| `supabase/functions/_shared/ml/__tests__/multiget.test.ts` (novo) | Contrato do helper com o fixture real | T0 |
| `supabase/functions/_shared/ml/__tests__/fixtures/bulk-*.json` (novos) | Respostas reais enxutas do bulk (spike de 03/10) | T0 |
| `docs/decisions/0177-multiget-ml-items-bulk.md` (novo) | ADR da migração | T0 |
| `$CLAUDE_JOB_DIR/tmp/ab/` (fora do repo) | Harness A/B com a guarda de fetch | T0 |
| `_shared/canais/mercado-livre.ts`, `_shared/ml/buscar-item.ts`, `_shared/ml/atualizar-item.ts` + testes | Fatia 1 | T1 |
| `_shared/ml/vendas.ts`, `_shared/ml/pedidos.ts` + testes | Fatia 2 | T2 |
| `_shared/ml/kit-virtual.ts`, `buscar-componentes-kit-virtual/index.ts` + testes | Fatia 3 | T3 |
| `_shared/promocoes/ml.ts`, `_shared/operacoes/ml.ts`, `_shared/ml/varrer-itens.ts`, `_shared/ml/descobrir-familia-up.ts` + testes | Fatia 4 | T4 |
| `_shared/pulse/parse.ts`, `pulse-coletar/processar.ts`, `acompanhar-migracao-pxv/index.ts`, `buscar-componentes-kit-virtual/processar.ts` (comentário) + testes | Fatia 5 | T5 |
| `docs/reference/edge-functions.md`, `obsidian-vault/03-Módulos/Estoque.md`, runbooks, ADR-0177 | Fatia 6 (docs) | T6 |

Caminhos relativos a `supabase/functions/` quando começam por `_shared/` ou pelo nome de uma edge. O worktree é `/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/verif-items-bulk`, na branch `worktree-ml-items-bulk`.

---

## Procedimentos comuns (referenciados por cada fatia; o texto completo está aqui)

### P-A/B: contraprova contra a `main` (rodar em T1–T5)

1. Extrair a árvore da `main` **do commit anterior à fatia**:
   `rm -rf $CLAUDE_JOB_DIR/tmp/ab/main && mkdir -p $CLAUDE_JOB_DIR/tmp/ab/main && /usr/bin/git archive origin/main supabase/functions | tar -x -C $CLAUDE_JOB_DIR/tmp/ab/main`
2. Rodar `python3 $CLAUDE_JOB_DIR/tmp/ab/rodar.py <fatia>`. O script lê os tokens das 4 orgs por SQL read-only e, para cada org, chama `deno run --allow-net=api.mercadolibre.com --allow-read --allow-env=ML_TOKEN,AB_ARVORE,AB_AMOSTRA $CLAUDE_JOB_DIR/tmp/ab/ab.ts <fatia>` **duas vezes**: com `AB_ARVORE=<main>` e com `AB_ARVORE=<worktree>/supabase/functions`. O token só passa por env do subprocesso.
3. O `ab.ts` instala a guarda **antes** de qualquer import dinâmico, importa os módulos da árvore indicada, roda os cenários da fatia e imprime um JSON canônico (chaves ordenadas; arrays `tags` ordenados) com `{saida, escritasBloqueadas}`.
4. O `rodar.py` compara os dois JSON. **Critério: idênticos.** Qualquer diferença bloqueia a fatia até ser explicada e aceita pelo Diego. As respostas ficam em `$CLAUDE_JOB_DIR/tmp/ab/out/<fatia>-<org>-{main,branch}.json`.
5. O `--allow-net=api.mercadolibre.com` é uma segunda trava: o Deno recusa qualquer outro host.

### P-Deploy: fecho de imports, deploy e versão (rodar em T1–T5, só depois do merge)

1. `python3 $CLAUDE_JOB_DIR/tmp/edges_afetadas.py <arquivo1> [arquivo2…]`. Para cada `supabase/functions/<fn>/index.ts`, roda `deno info --json` e lista as funções cujo grafo de módulos contém algum dos arquivos. Imprime a lista e o total.
2. `supabase functions list > $CLAUDE_JOB_DIR/tmp/versoes-antes-<fatia>.txt`, para anotar as versões que servem de rollback.
3. `supabase functions deploy <fn1> <fn2> …`, a partir da raiz do worktree já em fast-forward com a `main`.
4. `supabase functions list > $CLAUDE_JOB_DIR/tmp/versoes-depois-<fatia>.txt`. Comparar: **toda** função da lista precisa ter a versão incrementada e `updated_at` recente.
5. **Rollback** (só se a observação falhar): `git archive <sha_main_anterior> supabase/functions | tar -x -C $CLAUDE_JOB_DIR/tmp/rollback`, depois `supabase functions deploy <fns> --workdir $CLAUDE_JOB_DIR/tmp/rollback` (copiar `supabase/config.toml` junto), e reverter o commit na `main` por `git revert` + push. O endpoint antigo vale até 25/10.

### P-Observação: produção (rodar em T1–T5)

Logs pelo endpoint de analytics da Management API, com `iso_timestamp_start` e `iso_timestamp_end` (janela: do deploy até a primeira execução real + 10 min). Filtrar pela edge e procurar `multiget`, `bulk`, `Too many IDs`, `Duplicate item id`, `400` e exceções. Critério: zero erro novo e o resultado de negócio igual ao anterior (definido por fatia).

### P-Revisão Codex (rodar em T0–T6)

`/usr/bin/git diff origin/main...HEAD > $CLAUDE_JOB_DIR/tmp/diff-<fatia>.patch`, depois:

```
codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only "Revisão MINUCIOSA do diff em $CLAUDE_JOB_DIR/tmp/diff-<fatia>.patch (fatia <N> da migração /items?ids= → /items/bulk; spec docs/superpowers/specs/2026-10-03-ml-items-bulk-design.md; plano docs/superpowers/plans/2026-10-03-ml-items-bulk.md). Procure: qualquer mudança de saída observável, erro engolido/novo, id repetido chegando ao bulk, campo sem body., status_code ausente, regressão no tratamento de 404 sem body, teste que não prova o que diz. Liste achados com arquivo:linha e severidade; diga APROVADO só se não houver nenhum bloqueante." < /dev/null
```

Corrigir os bloqueantes, rodar os testes de novo e seguir. Não reenviar ao Codex só porque a correção é trivial. Se for estrutural, reenviar uma vez.

### P-Portão de merge (rodar em T1–T6)

1. `pnpm preflight` no worktree (3min37; é o portão de pré-push).
2. `/usr/bin/git push origin worktree-ml-items-bulk` e esperar CI verde (`gh run watch`).
3. **Parar e reportar ao Diego:** testes, A/B (orgs e anúncios comparados, 0 diferenças), achados do Codex, edges a deployar e decisões tomadas. Esperar o OK.
4. Com o OK: `/usr/bin/git push origin HEAD:main` (fast-forward), seguido de P-Deploy e P-Observação.

---

### Task T0: helper `multiget.ts`, fixtures reais, ADR-0177 e harness A/B (sem deploy)

**Files:**
- Create: `supabase/functions/_shared/ml/multiget.ts`
- Create: `supabase/functions/_shared/ml/__tests__/multiget.test.ts`
- Create: `supabase/functions/_shared/ml/__tests__/fixtures/bulk-*.json` (gerados no Step 1)
- Create: `docs/decisions/0177-multiget-ml-items-bulk.md`
- Create (fora do repo): `$CLAUDE_JOB_DIR/tmp/ab/guarda.ts`, `guarda.test.ts`, `ab.ts`, `rodar.py`; `$CLAUDE_JOB_DIR/tmp/edges_afetadas.py`

**Interfaces:**
- Produces:
  - `LIMITE_MULTIGET: 20`
  - `blocosMultiget(ids: readonly string[]): string[][]`
  - `caminhoMultiget(bloco: readonly string[], campos: readonly string[], extra?: string): string`, que devolve um caminho relativo começando por `/items/bulk?ids=`
  - `entradasMultiget<T = Record<string, unknown>>(json: unknown): Array<{ code: number | null; body: T | null }>`
  - `itensMultiget<T extends { id?: unknown } = Record<string, unknown>>(json: unknown): T[]`

- [ ] **Step 1: Gerar fixtures enxutos a partir do spike**

Criar `$CLAUDE_JOB_DIR/tmp/fixtures.py`:

```python
import json, pathlib
SPK = pathlib.Path('/Users/diego/.claude/jobs/b87cbc02/tmp/spike')
DST = pathlib.Path('/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/verif-items-bulk/supabase/functions/_shared/ml/__tests__/fixtures')
DST.mkdir(parents=True, exist_ok=True)
# conjunto do spike → nome do fixture. Mantém 3 itens 200 (o 1º com variations/attributes quando houver) + a entrada 404 sem body.
for conj in ['canais', 'atualizar_item', 'buscar_item', 'descobrir_familia', 'varrer_itens', 'vendas',
             'pedidos_pxv_cores', 'kit_virtual', 'componentes_kit', 'operacoes', 'pulse', 'pxv_estoque', 'promocoes']:
    for lado in ['bulk', 'antigo']:
        arr = json.loads((SPK / f'{conj}-{lado}.json').read_text())
        ok = [e for e in arr if (e.get('code') or e.get('status_code')) == 200][:3]
        err = [e for e in arr if (e.get('code') or e.get('status_code')) != 200][:1]
        for e in ok:  # enxuga listas grandes sem mudar a forma
            b = e['body']
            for k in ('attributes', 'variations'):
                if isinstance(b.get(k), list): b[k] = b[k][:4]
        (DST / f'bulk-{conj.replace("_", "-")}-{lado}.json').write_text(json.dumps(ok + err, ensure_ascii=False, indent=1) + '\n')
for org, nome in [('DSA', 'kit'), ('Avil', 'catalogo'), ('Avil', 'relacionados')]:
    for lado in ['bulk', 'antigo']:
        arr = json.loads((SPK / f'{org}-{nome}-{lado}.json').read_text())
        (DST / f'bulk-{nome}-{lado}.json').write_text(json.dumps(arr[:3], ensure_ascii=False, indent=1) + '\n')
print(sorted(p.name for p in DST.glob('bulk-*.json')))
```

Run: `python3 $CLAUDE_JOB_DIR/tmp/fixtures.py`
Expected: 32 arquivos `bulk-<conjunto>-{bulk,antigo}.json`. Conferir que todo `-bulk.json` tem `status_code` e nenhum tem `code`, e que todo `-antigo.json` tem `code`:
`grep -L '"status_code"' supabase/functions/_shared/ml/__tests__/fixtures/bulk-*-bulk.json` → vazio;
`grep -l '"code"' supabase/functions/_shared/ml/__tests__/fixtures/bulk-*-bulk.json` → vazio.

- [ ] **Step 2: Escrever o teste do helper (falhando)**

`supabase/functions/_shared/ml/__tests__/multiget.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  blocosMultiget, caminhoMultiget, entradasMultiget, itensMultiget, LIMITE_MULTIGET,
} from '../multiget.ts';
import bulkCanais from './fixtures/bulk-canais-bulk.json' with { type: 'json' };
import antigoCanais from './fixtures/bulk-canais-antigo.json' with { type: 'json' };

const ids = (n: number) => Array.from({ length: n }, (_, i) => `MLB${1000 + i}`);

describe('blocosMultiget', () => {
  it('limite é 20', () => expect(LIMITE_MULTIGET).toBe(20));
  it('blocos de ≤20 na ordem original', () => {
    const b = blocosMultiget(ids(45));
    expect(b.map((x) => x.length)).toEqual([20, 20, 5]);
    expect(b.flat()).toEqual(ids(45));
  });
  it('remove repetidos (bulk responde 400 ao lote inteiro com id repetido) e vazios', () => {
    expect(blocosMultiget(['MLB1', 'MLB2', 'MLB1', '', '  ', 'MLB2', 'MLB3'])).toEqual([['MLB1', 'MLB2', 'MLB3']]);
  });
  it('21 ids distintos → 2 blocos (bulk responde 400 a 21)', () => {
    expect(blocosMultiget(ids(21)).map((x) => x.length)).toEqual([20, 1]);
  });
  it('lista vazia → nenhum bloco (nenhuma chamada)', () => expect(blocosMultiget([])).toEqual([]));
});

describe('caminhoMultiget', () => {
  it('status_code primeiro, prefixo body. em todo campo, id garantido', () => {
    expect(caminhoMultiget(['MLB1', 'MLB2'], ['status', 'price']))
      .toBe('/items/bulk?ids=MLB1,MLB2&attributes=status_code,body.id,body.status,body.price');
  });
  it('não duplica id quando já está na lista e preserva a ordem dos campos', () => {
    expect(caminhoMultiget(['MLB1'], ['id', 'title', 'attributes']))
      .toBe('/items/bulk?ids=MLB1&attributes=status_code,body.id,body.title,body.attributes');
  });
  it('extra vai no fim, sem tocar a seleção', () => {
    expect(caminhoMultiget(['MLB1'], ['id'], '&include_attributes=all'))
      .toBe('/items/bulk?ids=MLB1&attributes=status_code,body.id&include_attributes=all');
  });
  it('codifica cada id', () => {
    expect(caminhoMultiget(['MLB 1'], ['id'])).toBe('/items/bulk?ids=MLB%201&attributes=status_code,body.id');
  });
  it('recusa bloco vazio, >20 ou com repetido (erro de programação, nunca chega ao ML)', () => {
    expect(() => caminhoMultiget([], ['id'])).toThrow();
    expect(() => caminhoMultiget(ids(21), ['id'])).toThrow();
    expect(() => caminhoMultiget(['MLB1', 'MLB1'], ['id'])).toThrow();
  });
});

describe('entradasMultiget / itensMultiget', () => {
  it('fixture real do bulk: 3 itens 200 + o 404 sem body', () => {
    const e = entradasMultiget(bulkCanais);
    expect(e.map((x) => x.code)).toEqual([200, 200, 200, 404]);
    expect(e[3].body).toBeNull();
    expect(itensMultiget<{ id: string }>(bulkCanais).map((b) => b.id)).toHaveLength(3);
  });
  it('envelope antigo (code) dá o mesmo resultado que o bulk (status_code) nos mesmos ids', () => {
    expect(itensMultiget(antigoCanais)).toEqual(itensMultiget(bulkCanais));
  });
  it('não-array, null e entradas malformadas → vazio, sem lançar', () => {
    expect(entradasMultiget(null)).toEqual([]);
    expect(entradasMultiget({ message: 'x' })).toEqual([]);
    expect(itensMultiget([null, 1, { status_code: 200 }, { status_code: 200, body: { id: 5 } }, { code: 500, body: { id: 'MLB1' } }])).toEqual([]);
  });
});
```

O teste "antigo dá o mesmo resultado" depende de os bodies serem idênticos, o que o spike provou. Se o fixture antigo trouxer o body de erro do 404, ele também é filtrado por `itensMultiget`, porque o código é 404.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test supabase/functions/_shared/ml/__tests__/multiget.test.ts`
Expected: FAIL, com o erro "Failed to resolve import ../multiget.ts".

- [ ] **Step 4: Implementar o helper**

`supabase/functions/_shared/ml/multiget.ts`:

```ts
// Multiget de anúncios do ML via `/items/bulk` (o `/items?ids=` sai do ar em 25/10/2026, ADR-0177).
// Puro de propósito: cada módulo mantém o próprio transporte e a própria semântica de erro.
// Contrato medido no spike de 03/10/2026 (spec 2026-10-03-ml-items-bulk-design.md §2):
// - seleção com `status_code` + `body.<campo>`; sem `status_code` o envelope perde o código;
// - id repetido → HTTP 400 no lote inteiro; 21 ids → 400; id inexistente → `{status_code:404}` sem body.

export const LIMITE_MULTIGET = 20;

/** Ids únicos (ordem preservada, vazios fora) em blocos de ≤20. */
export function blocosMultiget(ids: readonly string[]): string[][] {
  const unicos = [...new Set(ids.map((i) => i.trim()).filter((i) => i.length > 0))];
  const out: string[][] = [];
  for (let i = 0; i < unicos.length; i += LIMITE_MULTIGET) out.push(unicos.slice(i, i + LIMITE_MULTIGET));
  return out;
}

/** Caminho relativo do bulk. Lança se o bloco tiver 0 ou mais de 20 ids, ou id repetido. Isso é erro de programação. */
export function caminhoMultiget(bloco: readonly string[], campos: readonly string[], extra = ''): string {
  if (bloco.length === 0 || bloco.length > LIMITE_MULTIGET || new Set(bloco).size !== bloco.length) {
    throw new Error(`multiget: bloco inválido (${bloco.length} ids; use blocosMultiget)`);
  }
  const sel = ['id', ...campos.filter((c) => c !== 'id')].map((c) => `body.${c}`);
  return `/items/bulk?ids=${bloco.map(encodeURIComponent).join(',')}&attributes=status_code,${sel.join(',')}${extra}`;
}

/** Normaliza `{code|status_code, body}` (envelope antigo e bulk) para `{ code, body }`. */
export function entradasMultiget<T = Record<string, unknown>>(json: unknown): Array<{ code: number | null; body: T | null }> {
  if (!Array.isArray(json)) return [];
  return json.map((e) => {
    const env = (e && typeof e === 'object' ? e : {}) as { code?: unknown; status_code?: unknown; body?: unknown };
    const c = env.status_code ?? env.code;
    const body = env.body && typeof env.body === 'object' ? (env.body as T) : null;
    return { code: typeof c === 'number' ? c : null, body };
  });
}

/** Bodies com código 200 e `body.id` string, o filtro que os módulos repetiam. */
export function itensMultiget<T extends { id?: unknown } = Record<string, unknown>>(json: unknown): T[] {
  return entradasMultiget<T>(json)
    .filter((e) => e.code === 200 && e.body !== null && typeof e.body.id === 'string')
    .map((e) => e.body as T);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test supabase/functions/_shared/ml/__tests__/multiget.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 6: Guarda de fetch + teste da guarda (fora do repo)**

`$CLAUDE_JOB_DIR/tmp/ab/guarda.ts`:

```ts
// Guarda do A/B: só GET em api.mercadolibre.com chega à rede. Qualquer outra escrita no ML é
// registrada e respondida com 200 sintético, SEM rede. Qualquer outro host lança.
export const escritasBloqueadas: Array<{ metodo: string; url: string; corpo: string | null }> = [];
const fetchReal = globalThis.fetch.bind(globalThis);
export function instalarGuarda(): void {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const u = new URL(req.url);
    if (u.protocol !== 'https:' || u.hostname !== 'api.mercadolibre.com') {
      throw new Error(`GUARDA: host proibido ${u.hostname}`);
    }
    if (req.method !== 'GET') {
      escritasBloqueadas.push({ metodo: req.method, url: req.url, corpo: req.body ? await req.text() : null });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return fetchReal(req);
  };
}
```

`$CLAUDE_JOB_DIR/tmp/ab/guarda.test.ts`, que roda **sem rede** (`--allow-net` ausente, para provar que o PUT não sai):

```ts
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { escritasBloqueadas, instalarGuarda } from './guarda.ts';
instalarGuarda();
Deno.test('PUT no ML é bloqueado, registrado e não toca a rede', async () => {
  const r = await fetch('https://api.mercadolibre.com/items/MLB1', { method: 'PUT', body: '{"status":"paused"}' });
  assertEquals(r.status, 200);
  assertEquals(escritasBloqueadas, [{ metodo: 'PUT', url: 'https://api.mercadolibre.com/items/MLB1', corpo: '{"status":"paused"}' }]);
});
Deno.test('POST e DELETE também são bloqueados', async () => {
  await fetch('https://api.mercadolibre.com/items', { method: 'POST', body: '{}' });
  await fetch('https://api.mercadolibre.com/items/MLB1', { method: 'DELETE' });
  assertEquals(escritasBloqueadas.slice(-2).map((e) => e.metodo), ['POST', 'DELETE']);
});
Deno.test('outro host lança', async () => {
  await assertRejects(() => fetch('https://example.com/'), Error, 'GUARDA');
});
Deno.test('GET no ML passa para a rede (sem permissão de rede → erro de permissão, provando que tentou sair)', async () => {
  await assertRejects(() => fetch('https://api.mercadolibre.com/sites/MLB'));
});
```

Run: `deno test --allow-read $CLAUDE_JOB_DIR/tmp/ab/guarda.test.ts`
Expected: 4 passed.

- [ ] **Step 7: `ab.ts` (cenários por fatia) e `rodar.py`**

`$CLAUDE_JOB_DIR/tmp/ab/ab.ts`:

```ts
import { escritasBloqueadas, instalarGuarda } from './guarda.ts';
instalarGuarda(); // ANTES de qualquer import de módulo do app
const ARV = Deno.env.get('AB_ARVORE')!;
const TOKEN = Deno.env.get('ML_TOKEN')!;
const A = JSON.parse(Deno.env.get('AB_AMOSTRA')!) as { ids: string[]; catalogo: string[]; kits: string[]; sellerId: string };
const imp = (p: string) => import(`file://${ARV}/${p}`);
const canon = (x: unknown): unknown =>
  Array.isArray(x) ? x.map(canon)
  : x instanceof Map ? canon(Object.fromEntries([...x.entries()].sort()))
  : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, k === 'tags' && Array.isArray(v) ? [...v].sort() : canon(v)]))
  : x;
const comDup = (xs: string[]) => [...xs, ...xs.slice(0, 2)]; // repetidos de propósito (Review Focus 1)

const cenarios: Record<string, () => Promise<unknown>> = {
  async F1() {
    const { mercadoLivreConnector } = await imp('_shared/canais/mercado-livre.ts');
    const { propagarStatusRelacionadosML } = await imp('_shared/ml/atualizar-item.ts');
    const ctx = { getToken: async () => TOKEN };
    const status = await mercadoLivreConnector.lerStatus(ctx, comDup([...A.ids, ...A.catalogo, 'MLB0000000001']));
    const propag: Record<string, unknown> = {};
    for (const id of A.catalogo) {
      const antes = escritasBloqueadas.length;
      try { await propagarStatusRelacionadosML(TOKEN, id, 'paused'); propag[id] = escritasBloqueadas.slice(antes); }
      catch (e) { propag[id] = `ERRO ${(e as Error).message}`; }
    }
    return { status, propag };
  },
  async F2() {
    const { buscarGtinsDosItens } = await imp('_shared/ml/pedidos.ts');
    const v = await imp('_shared/ml/vendas.ts');
    return {
      gtins: await buscarGtinsDosItens(TOKEN, comDup([...A.ids, 'MLB0000000001'])),
      vendas: await v.buscarTitulosEGtins(TOKEN, comDup([...A.ids, 'MLB0000000001']), AbortSignal.timeout(30_000)),
    };
  },
  async F3() {
    const { buscarListingTypeItensML } = await imp('_shared/ml/kit-virtual.ts');
    return { lt: await buscarListingTypeItensML(TOKEN, comDup([...A.ids, ...A.kits, 'MLB0000000001'])) };
  },
  async F4() {
    const { buscarItensML, criarGetJson } = await imp('_shared/promocoes/ml.ts');
    const { criarClienteML } = await imp('_shared/operacoes/ml.ts');
    const { detalharItens } = await imp('_shared/ml/varrer-itens.ts');
    const cli = criarClienteML(TOKEN);
    const rel: Record<string, unknown> = {};
    for (const id of A.catalogo) {
      try { rel[id] = await cli.lerRelacoes(id); } catch (e) { rel[id] = `ERRO ${(e as Error).message}`; }
    }
    return {
      promo: await buscarItensML(criarGetJson(TOKEN), comDup([...A.ids, 'MLB0000000001'])),
      rel,
      varrer: await detalharItens(fetch, TOKEN, comDup([...A.ids, 'MLB0000000001'])),
    };
  },
  async F5() {
    const { parseStatusAnuncios } = await imp('_shared/pulse/parse.ts');
    // Pulse e PxV montam a URL inline. O A/B compara o parse de cada árvore sobre a resposta do endpoint que aquela árvore chama.
    const antigo = ARV.includes('/ab/main');
    const q = [...A.ids, 'MLB0000000001'].join(',');
    const url = antigo
      ? `https://api.mercadolibre.com/items?ids=${q}&attributes=id,status,sub_status,category_id,listing_type_id,price`
      : `https://api.mercadolibre.com/items/bulk?ids=${q}&attributes=status_code,body.id,body.status,body.sub_status,body.category_id,body.listing_type_id,body.price`;
    const json = await (await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
    return { pulse: parseStatusAnuncios(json) };
  },
};
const fatia = Deno.args[0];
const saida = await cenarios[fatia]();
console.log(JSON.stringify(canon({ saida, escritasBloqueadas })));
```

**Pré-condição do Step 7, a conferir antes de rodar:** `buscarTitulosEGtins` hoje não é exportada (`_shared/ml/vendas.ts:127`). A T2 adiciona `export` nela, **e** o A/B da T2 roda com a árvore `main` corrigida só nessa palavra (`sed -i '' 's/^async function buscarTitulosEGtins/export async function buscarTitulosEGtins/'` na cópia de `$CLAUDE_JOB_DIR/tmp/ab/main`). O comportamento não muda, só a visibilidade.

`$CLAUDE_JOB_DIR/tmp/ab/rodar.py` reaproveita `sql()` de `$CLAUDE_JOB_DIR/tmp/spike_bulk.py`:

```python
import json, os, subprocess, sys, pathlib
sys.path.insert(0, '/Users/diego/.claude/jobs/b87cbc02/tmp')
import spike_bulk as s
AB = pathlib.Path('/Users/diego/.claude/jobs/b87cbc02/tmp/ab')
WT = '/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/verif-items-bulk/supabase/functions'
fatia = sys.argv[1]
(AB / 'out').mkdir(exist_ok=True)
falhas = 0
for org in s.sql("select o.id, o.nome, c.id as cx, c.conta_externa_id as seller from public.organizations o "
                 "join public.marketplace_connections c on c.org_id=o.id and c.canal::text ilike '%livre%'"):
    tok = s.sql(f"select access_token from public.get_connection_tokens('{org['cx']}'::uuid)")[0]['access_token']
    amostra = {
        'ids': [r['item_externo_id'] for r in s.sql(f"select item_externo_id from public.anuncios_externos where org_id='{org['id']}' and status='publicado' and item_externo_id like 'MLB%' order by md5(item_externo_id) limit 40")],
        'catalogo': [r['x'] for r in s.sql(f"select distinct v->>'catalog_listing_id' as x from public.anuncios_externos a, jsonb_each(a.variacoes_externas) e(k,v) where a.org_id='{org['id']}' and v->>'catalog_listing_id' like 'MLB%' limit 5")],
        'kits': [r['ml_item_id'] for r in s.sql(f"select ml_item_id from public.kits_virtuais where org_id='{org['id']}' and ml_item_id is not null limit 5")],
        'sellerId': str(org['seller']),
    }
    res = {}
    for lado, arv in [('main', str(AB / 'main' / 'supabase' / 'functions')), ('branch', WT)]:
        env = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'], 'ML_TOKEN': tok, 'AB_ARVORE': arv, 'AB_AMOSTRA': json.dumps(amostra)}
        p = subprocess.run(['deno', 'run', '--allow-net=api.mercadolibre.com', '--allow-read', '--allow-env=ML_TOKEN,AB_ARVORE,AB_AMOSTRA',
                            str(AB / 'ab.ts'), fatia], env=env, capture_output=True, text=True, timeout=600)
        if p.returncode != 0:
            print(org['nome'], lado, 'FALHOU', p.stderr[-800:]); falhas += 1; continue
        res[lado] = p.stdout.strip().splitlines()[-1]
        (AB / 'out' / f"{fatia}-{org['nome'].replace(' ', '_')}-{lado}.json").write_text(res[lado])
    del tok
    igual = res.get('main') is not None and res.get('main') == res.get('branch')
    falhas += 0 if igual else 1
    print(f"{org['nome']}: ids={len(amostra['ids'])} catalogo={len(amostra['catalogo'])} kits={len(amostra['kits'])} → {'IDÊNTICO' if igual else 'DIFERENTE'}")
sys.exit(1 if falhas else 0)
```

O `lerStatus` fatia 40 ids em 2 blocos, o que exercita a divisão em blocos ao vivo. O `comDup` exercita a dedup ao vivo: na `main`, o endpoint antigo deduplica sozinho; na branch, quem deduplica é o helper. Se a branch não deduplicar, o bulk responde 400 e o A/B acusa a diferença.

- [ ] **Step 8: Script de edges afetadas**

`$CLAUDE_JOB_DIR/tmp/edges_afetadas.py`:

```python
import json, pathlib, subprocess, sys
FN = pathlib.Path('/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/verif-items-bulk/supabase/functions')
alvos = {str((FN / a).resolve()) for a in sys.argv[1:]}
afetadas = []
for idx in sorted(FN.glob('*/index.ts')):
    if idx.parent.name.startswith('_'): continue
    p = subprocess.run(['deno', 'info', '--json', str(idx)], capture_output=True, text=True, timeout=120)
    if p.returncode != 0:
        print('ERRO deno info', idx.parent.name, p.stderr[-300:]); sys.exit(2)
    locais = {m['specifier'].removeprefix('file://') for m in json.loads(p.stdout)['modules'] if m['specifier'].startswith('file://')}
    if locais & alvos: afetadas.append(idx.parent.name)
print(len(afetadas), ' '.join(afetadas))
```

Run (sanidade): `python3 $CLAUDE_JOB_DIR/tmp/edges_afetadas.py _shared/trafego/fiacao.ts`
Expected: inclui `coletar-trafego-ml`. Isso prova que o script enxerga `_shared`.

- [ ] **Step 9: ADR-0177**

`/usr/bin/git fetch origin` e depois `ls docs/decisions | sort | tail -2`. Se `0177` já existir na `origin/main`, usar o próximo número livre e trocar em todo o plano e na spec. Criar `docs/decisions/0177-multiget-ml-items-bulk.md`:

```markdown
# ADR-0177 — Multiget do Mercado Livre via `/items/bulk`

**Status:** Aceito (2026-10-03). **Prazo externo:** o ML desliga `GET /items?ids=` em 25/10/2026.

## Contexto
14 chamadas em 13 arquivos usavam `/items?ids=`. O substituto `GET /items/bulk?ids=` muda o
envelope (`status_code` no lugar de `code`). O spike real de 03/10/2026 (4 orgs) mediu:
- os bodies são idênticos aos do endpoint antigo; só a ordem de `tags` varia;
- a seleção precisa de `status_code` e do prefixo `body.`;
- id repetido no lote → HTTP 400 no lote inteiro (o antigo deduplicava);
- 21 ids → 400;
- id inexistente → `{status_code:404}` sem body.

## Decisão
- Helper puro `_shared/ml/multiget.ts` (`blocosMultiget`, `caminhoMultiget`, `entradasMultiget`,
  `itensMultiget`). Ele deduplica, divide em blocos de ≤20, monta a seleção e normaliza os dois envelopes.
- Cada módulo mantém o próprio transporte e a própria semântica de erro, porque os 4 transportes
  diferentes (fetchLike, `GetJson` com 429, `chamar`, `mlGet`) seguem como estão.
- `fiacao.ts` (primeiro módulo migrado, commit `6f8f6c9b`) fica como está.
- Migração em fatias, cada uma com A/B contra a `main` usando token real (só GET; escrita
  bloqueada por guarda), deploy por `deno info` e observação em produção.

## Consequências
- Nenhuma saída observável muda.
- Onde antes não havia blocos (PxV, operações), mais de 20 ids passa a funcionar.
- Um módulo novo que precise de multiget usa o helper. Escrever `/items?ids=` à mão é regressão.
```

- [ ] **Step 10: Verificação, revisão Codex e commit da T0**

Run: `pnpm test supabase/functions/_shared/ml` → PASS. Depois aplicar a P-Revisão Codex (fatia T0) e corrigir os bloqueantes.

```
/usr/bin/git add supabase/functions/_shared/ml/multiget.ts supabase/functions/_shared/ml/__tests__/multiget.test.ts supabase/functions/_shared/ml/__tests__/fixtures docs/decisions/0177-multiget-ml-items-bulk.md docs/superpowers/plans/2026-10-03-ml-items-bulk.md
/usr/bin/git commit -F $CLAUDE_JOB_DIR/tmp/msg-t0.txt
```

Mensagem: `feat(ml): helper multiget via /items/bulk + fixtures reais + ADR-0177`. Sem deploy: nenhuma edge importa o helper. O merge da T0 entra junto com a T1, no mesmo portão.

---

### Task T1 (Fatia 1): `lerStatus`, `buscar-item`, `atualizar-item`

**Files:**
- Modify: `_shared/canais/mercado-livre.ts:410-436` (`lerStatus`)
- Modify: `_shared/ml/buscar-item.ts:76-93`
- Modify: `_shared/ml/atualizar-item.ts:175-189` (`propagarStatusRelacionadosML`)
- Test: `_shared/canais/__tests__/mercado-livre.test.ts`, `_shared/ml/__tests__/buscar-item.test.ts`, **novo** `_shared/ml/__tests__/propagar-status-relacionados.test.ts`

**Interfaces:**
- Consumes: `blocosMultiget`, `caminhoMultiget`, `itensMultiget` (T0)
- Produces: as mesmas assinaturas públicas de hoje (nenhuma muda)

- [ ] **Step 1: Confirmar que a ordem de `tags` é irrelevante**

Run: `grep -n "tags" supabase/functions/_shared/ml/status.ts supabase/functions/_shared/canais/mercado-livre.ts`
Expected: só usos do tipo `includes(...)`/`some(...)`. Se algum uso depender da ordem (índice, `join`, comparação de arrays), **parar** e levar ao Codex astra.

- [ ] **Step 2: Testes falhando**

Em `_shared/canais/__tests__/mercado-livre.test.ts`, no `describe` de `lerStatus` (localizar com `grep -n "lerStatus" …`), adicionar:

```ts
import bulkCanais from '../../ml/__tests__/fixtures/bulk-canais-bulk.json' with { type: 'json' };
import antigoCanais from '../../ml/__tests__/fixtures/bulk-canais-antigo.json' with { type: 'json' };

it('lerStatus: usa /items/bulk com status_code e prefixo body., e lê o envelope status_code', async () => {
  const ids = (bulkCanais as Array<{ body?: { id: string } }>).flatMap((e) => (e.body ? [e.body.id] : []));
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return new Response(JSON.stringify(bulkCanais)); }));
  const r = await mercadoLivreConnector.lerStatus({ getToken: async () => 't' }, [...ids, ids[0], 'MLB0000000001']);
  expect(urls).toEqual([`https://api.mercadolibre.com/items/bulk?ids=${[...ids, 'MLB0000000001'].join(',')}&attributes=status_code,body.id,body.status,body.sub_status,body.available_quantity,body.price,body.listing_type_id,body.tags`]);
  // mesmo resultado que o envelope antigo nos mesmos ids
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(antigoCanais))));
  const r0 = await mercadoLivreConnector.lerStatus({ getToken: async () => 't' }, [...ids, 'MLB0000000001']);
  expect(r).toEqual(r0);
  expect(r['MLB0000000001'].status).toBe('indisponivel');
  for (const id of ids) expect(r[id].status).not.toBe('indisponivel');
});

it('lerStatus: 45 ids → 3 chamadas de ≤20, sem repetidos', async () => {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return new Response('[]'); }));
  const ids = Array.from({ length: 45 }, (_, i) => `MLB${i}`);
  await mercadoLivreConnector.lerStatus({ getToken: async () => 't' }, [...ids, ...ids]);
  expect(urls).toHaveLength(3);
  for (const u of urls) {
    const q = new URL(u).searchParams.get('ids')!.split(',');
    expect(q.length).toBeLessThanOrEqual(20);
    expect(new Set(q).size).toBe(q.length);
  }
});
```

Se o arquivo de teste usar outro padrão de mock de fetch (por exemplo, uma variável `fetchMock`), seguir o padrão existente e manter as mesmas asserções. No fim do arquivo, garantir `afterEach(() => vi.unstubAllGlobals())` se ainda não houver.

Em `_shared/ml/__tests__/buscar-item.test.ts`, trocar o roteamento `if (url.includes('/items?ids='))` (linha 24) por `if (url.includes('/items/bulk?ids='))`. A resposta mockada nesse ramo passa a usar `status_code` no lugar de `code`. Adicionar:

```ts
it('multiget de adoção usa o bulk com os campos de validação', async () => {
  // reaproveitar o fetch fake do arquivo; capturar a URL do multiget
  // (localizar o helper do arquivo com `grep -n "function fake\|const fake" buscar-item.test.ts`)
  expect(urlMultiget).toContain('/items/bulk?ids=');
  expect(urlMultiget).toContain('&attributes=status_code,body.id,body.category_id,body.family_name,body.seller_id,body.date_created');
});
```

Na execução, essa asserção vai dentro de um teste existente que já percorre o multiget: capturar a URL no fetch fake e checar o conteúdo, em vez de criar um fake novo.

Novo `_shared/ml/__tests__/propagar-status-relacionados.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { propagarStatusRelacionadosML } from '../atualizar-item.ts';

type Rota = { metodo: string; url: string; corpo?: string };
function fakeML(itemRelations: string[], multiget: unknown) {
  const chamadas: Rota[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    chamadas.push({ metodo, url: u, corpo: init?.body as string | undefined });
    if (metodo !== 'GET') return new Response('{}');
    if (u.includes('/items/bulk?ids=')) return new Response(JSON.stringify(multiget));
    return new Response(JSON.stringify({ id: 'MLB9', item_relations: itemRelations.map((id) => ({ id })) }));
  }));
  return chamadas;
}
afterEach(() => vi.unstubAllGlobals());

describe('propagarStatusRelacionadosML via bulk', () => {
  it('lê os relacionados por /items/bulk (status_code) e pausa só os ativos', async () => {
    const ch = fakeML(['MLB1', 'MLB2'], [
      { status_code: 200, body: { id: 'MLB1', status: 'active', sub_status: [] } },
      { status_code: 200, body: { id: 'MLB2', status: 'paused', sub_status: [] } },
    ]);
    await propagarStatusRelacionadosML('t', 'MLB9', 'paused');
    expect(ch.find((c) => c.url.includes('/items/bulk'))!.url)
      .toBe('https://api.mercadolibre.com/items/bulk?ids=MLB1,MLB2&attributes=status_code,body.id,body.status,body.sub_status');
    expect(ch.filter((c) => c.metodo === 'PUT').map((c) => c.url)).toEqual(['https://api.mercadolibre.com/items/MLB1']);
  });
  it('relacionado que volta 404 sem body → falha alto (502), nenhum PUT', async () => {
    const ch = fakeML(['MLB1'], [{ status_code: 404 }]);
    await expect(propagarStatusRelacionadosML('t', 'MLB9', 'paused')).rejects.toThrow();
    expect(ch.filter((c) => c.metodo !== 'GET')).toEqual([]);
  });
  it('relacionado deleted é pulado', async () => {
    const ch = fakeML(['MLB1'], [{ status_code: 200, body: { id: 'MLB1', status: 'closed', sub_status: ['deleted'] } }]);
    await propagarStatusRelacionadosML('t', 'MLB9', 'paused');
    expect(ch.filter((c) => c.metodo !== 'GET')).toEqual([]);
  });
});
```

Antes de fixar as asserções de PUT, ler `atualizar-item.ts:175-200` inteiro e alinhar ao que a função faz hoje: quais status ela pula, como é a URL do PUT e se usa `atualizarStatusML`. O teste fixa o comportamento **atual**. Se o primeiro teste falhar só por divergir do comportamento atual (e não pela URL do bulk), corrigir o teste, nunca o código.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test supabase/functions/_shared/canais supabase/functions/_shared/ml`
Expected: FAIL nos testes novos (URL ainda é `/items?ids=`; o envelope `status_code` não é lido).

- [ ] **Step 4: Implementar**

`_shared/canais/mercado-livre.ts`: adicionar o import `import { blocosMultiget, caminhoMultiget, itensMultiget } from '../ml/multiget.ts';` e trocar o corpo de `lerStatus`:

```ts
  async lerStatus(ctx: ContextoCanal, ids: string[]): Promise<Record<string, StatusCanal>> {
    const token = await ctx.getToken();
    // Chunks em paralelo (latência O(1) em vez de O(n/20) serial). Bulk: ids únicos, ≤20 (ADR-0177).
    const respostas = await Promise.all(blocosMultiget(ids).map(async (bloco) => {
      const url = `https://api.mercadolibre.com${caminhoMultiget(bloco, CAMPOS_STATUS_ML)}`;
      try {
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok) { console.warn(`lerStatus ML ${resp.status} (bloco)`); return []; }
        return itensMultiget<ItemMLStatus & { id: string }>(await resp.json());
      } catch (e) {
        console.warn('lerStatus ML falhou (bloco):', (e as Error).message);
        return [];
      }
    }));
    const porId = new Map<string, ItemMLStatus | null>();
    for (const body of respostas.flat()) porId.set(body.id, body);
    const out: Record<string, StatusCanal> = {};
    for (const id of ids) out[id] = parseStatusML(porId.get(id) ?? null);
    return out;
  },
```

E, no topo do arquivo (perto dos outros `const`): `const CAMPOS_STATUS_ML = ['id', 'status', 'sub_status', 'available_quantity', 'price', 'listing_type_id', 'tags'];`.

Equivalência: hoje um não-200 **com** id grava `null` e um id ausente cai em `?? null`. Os dois dão `parseStatusML(null)`, e o novo código produz o mesmo resultado. O `chunk` local continua usado em outro lugar? Rodar `grep -n "chunk(" supabase/functions/_shared/canais/mercado-livre.ts`. Se o `chunk` ficou órfão, removê-lo junto com o import.

`_shared/ml/buscar-item.ts`, linhas 76-93:

```ts
  for (const bloco of blocosMultiget(ids)) {
    const url = `${API}${caminhoMultiget(bloco, ['id', 'category_id', 'family_name', 'seller_id', 'date_created'])}`;
    const resp = await fetchLike(url, { headers });
    if (!resp.ok) throw new Error(`multiget de adoção (${resp.status})`);
    for (const b of itensMultiget<ItemMultiget>(await resp.json())) {
      if (b.category_id !== crit.categoriaId) continue;
      if (b.family_name !== crit.familyName) continue;
      if (String(b.seller_id) !== crit.sellerId) continue;
      if (!(Date.parse(b.date_created) >= crit.desdeMs)) continue;
      validos.push(b.id);
```

O resto do laço continua como está. Importar `blocosMultiget, caminhoMultiget, itensMultiget` de `./multiget.ts`. Remover `MULTIGET_CHUNK` e `chunk` se ficarem órfãos (`grep -n "MULTIGET_CHUNK\|chunk(" buscar-item.ts`). **Atenção:** `descobrir-familia-up.ts` importa `FetchLike` deste arquivo; não mexer nesse export.

Nota de equivalência: hoje `entry.body` sem `id` passa no filtro (`!entry.body` só exige truthy), mas `validos.push(b.id)` empurraria `undefined`. O `itensMultiget` exige `id` string. Isso só exclui um caso degenerado que o ML não produz (confirmado no spike) e vale citar na revisão.

`_shared/ml/atualizar-item.ts`, linhas 183-189:

```ts
  const porId = new Map<string, ItemMLStatus>();
  for (const bloco of blocosMultiget(ids)) {
    const multi = await fetch(`https://api.mercadolibre.com${caminhoMultiget(bloco, ['id', 'status', 'sub_status'])}`, { headers });
    const lote = await multi.json().catch(() => null);
    if (!multi.ok) throw erroML(multi.status, lote);
    for (const b of itensMultiget<ItemMLStatus & { id: string }>(lote)) porId.set(b.id, b);
  }
```

Importar de `./multiget.ts`. Daqui para baixo (linha 190 em diante) nada muda: um relacionado ausente continua lançando 502.

- [ ] **Step 5: Rodar e ver passar + suíte inteira do backend**

Run: `pnpm test supabase/functions/_shared supabase/functions/status-publicados supabase/functions/sincronizar-estoque supabase/functions/publicar-split-ml supabase/functions/update-familia-ml supabase/functions/remover-publicado`
Expected: PASS. Depois `deno check` nas edges afetadas: `deno check supabase/functions/status-publicados/index.ts supabase/functions/sincronizar-estoque/index.ts supabase/functions/update-familia-ml/index.ts` → sem erro.

- [ ] **Step 6: A/B (P-A/B, fatia `F1`)**

Run: `python3 $CLAUDE_JOB_DIR/tmp/ab/rodar.py F1`
Expected: `IDÊNTICO` nas 4 orgs, exit 0. Conferir em `out/F1-*-branch.json`:
- `escritasBloqueadas` igual ao da `main`. É a lista de PUTs que a propagação **faria**; nenhum saiu para a rede, por causa da guarda;
- `status` com 40+ ids e `MLB0000000001` = `indisponivel`.

- [ ] **Step 7: Varredura da fatia + commit + Codex + portão**

`grep -n "items?ids=" supabase/functions/_shared/canais/mercado-livre.ts supabase/functions/_shared/ml/buscar-item.ts supabase/functions/_shared/ml/atualizar-item.ts` → vazio.
Commit (`feat(ml): fatia 1 do /items/bulk — lerStatus, adoção e propagação de status`), depois P-Revisão Codex e P-Portão de merge. No relatório ao Diego, incluir as edges vindas de `edges_afetadas.py _shared/ml/multiget.ts _shared/canais/mercado-livre.ts _shared/ml/buscar-item.ts _shared/ml/atualizar-item.ts` (cerca de 15 esperadas).

- [ ] **Step 8: Deploy + observação (depois do OK e do merge)**

P-Deploy com a lista do Step 7. P-Observação nas edges:
- `sincronizar-estoque`: dispara a cada movimento de estoque. Nos logs, sem `lerStatus ML 400` e sem exceção; `estoque_reativou_anuncio` só onde houver reposição real;
- `monitorar-moderados`: sem erro novo;
- `status-publicados`: pedir ao Diego que abra a tela Publicados (ou observar a próxima chamada nos logs). A contagem por status bate com o `status` do A/B da Avil.

---

### Task T2 (Fatia 2): `vendas.ts`, `pedidos.ts`

**Files:**
- Modify: `_shared/ml/vendas.ts:127-159` (`buscarTitulosEGtins`, que passa a ser exportada)
- Modify: `_shared/ml/pedidos.ts:23-52` (`buscarGtinsDosItens`)
- Test: `_shared/ml/__tests__/vendas.test.ts`, **novo** `_shared/ml/__tests__/pedidos-gtin.test.ts`

**Interfaces:**
- Consumes: T0
- Produces: `export async function buscarTitulosEGtins(token: string, ids: string[], signal: AbortSignal): Promise<{ titulos: Record<string, string>; gtins: Record<string, string> }>`. Só a visibilidade muda.

- [ ] **Step 1: Testes falhando**

Novo `_shared/ml/__tests__/pedidos-gtin.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buscarGtinsDosItens } from '../pedidos.ts';
import bulk from './fixtures/bulk-pedidos-pxv-cores-bulk.json' with { type: 'json' };
import antigo from './fixtures/bulk-pedidos-pxv-cores-antigo.json' with { type: 'json' };
afterEach(() => vi.unstubAllGlobals());
const idsDo = (arr: unknown) => (arr as Array<{ body?: { id?: string } }>).flatMap((e) => (e.body?.id ? [e.body.id] : []));

describe('buscarGtinsDosItens via bulk', () => {
  it('URL do bulk com id,attributes e GTIN igual ao do envelope antigo', async () => {
    const ids = idsDo(bulk);
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return new Response(JSON.stringify(bulk)); }));
    const novo = await buscarGtinsDosItens('t', [...ids, ids[0]]);
    expect(urls).toEqual([`https://api.mercadolibre.com/items/bulk?ids=${ids.join(',')}&attributes=status_code,body.id,body.attributes`]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(antigo))));
    expect(novo).toEqual(await buscarGtinsDosItens('t', ids));
  });
  it('bloco com HTTP de erro é pulado sem derrubar os outros', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (n++ === 0 ? new Response('x', { status: 500 }) : new Response(JSON.stringify(bulk)))));
    const ids = Array.from({ length: 21 }, (_, i) => `MLB${i}`);
    await expect(buscarGtinsDosItens('t', ids)).resolves.toBeTypeOf('object');
    expect(n).toBe(2);
  });
});
```

O teste de igualdade só faz sentido se o fixture tiver pelo menos um GTIN. Conferir com `grep -c '"GTIN"' supabase/functions/_shared/ml/__tests__/fixtures/bulk-pedidos-pxv-cores-bulk.json` (≥1). Se der 0, gerar de novo o fixture desse conjunto (T0 Step 1), escolhendo itens com o atributo `GTIN`. No spike, os 18 itens da Avil têm `attributes` completos.

Em `_shared/ml/__tests__/vendas.test.ts`, adicionar o mesmo par (URL do bulk `&attributes=status_code,body.id,body.title,body.attributes` e igualdade com o envelope antigo) para `buscarTitulosEGtins`, com os fixtures `bulk-vendas-{bulk,antigo}.json`. Passar `AbortSignal.timeout(5000)`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test supabase/functions/_shared/ml/__tests__/pedidos-gtin.test.ts supabase/functions/_shared/ml/__tests__/vendas.test.ts`
Expected: FAIL (URL antiga; `buscarTitulosEGtins` não exportada).

- [ ] **Step 3: Implementar**

`vendas.ts`: `async function buscarTitulosEGtins(` → `export async function buscarTitulosEGtins(`, e o laço:

```ts
  for (const bloco of blocosMultiget(ids)) {
    try {
      const url = `${API}${caminhoMultiget(bloco, ['id', 'title', 'attributes'])}`;
      const resp = await fetch(url, { headers, signal });
      if (!resp.ok) continue;
      for (const b of itensMultiget<{ id: string; title?: string; attributes?: AtributoML[] }>(await resp.json())) {
        titulos[b.id] = b.title ?? b.id;
        const gtin = extrairGtin(b.attributes);
        if (gtin) gtins[b.id] = gtin;
      }
    } catch (e) {
```

O `catch` fica como está. Remover o `chunk` local se ficar órfão.

`pedidos.ts`:

```ts
  for (const bloco of blocosMultiget(itemIds)) {
    try {
      const url = `${API}${caminhoMultiget(bloco, ['id', 'attributes'])}`;
      const resp = await fetch(url, { headers, signal });
      if (!resp.ok) continue;
      for (const b of itensMultiget<ItemComAtributos & { id: string }>(await resp.json())) {
        const gtin = extrairGtin(b);
        if (gtin) out[b.id] = gtin;
      }
    } catch {
```

Importar de `./multiget.ts` nos dois. O tipo `ItemComAtributos` já existe em `pedidos.ts` (linha ~6); conferir o nome com `grep -n "ItemComAtributos" pedidos.ts`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test supabase/functions/_shared supabase/functions/sync-venda supabase/functions/reconciliar-faturamento supabase/functions/backfill-faturamento supabase/functions/sync-devolucao`
Expected: PASS.

- [ ] **Step 5: A/B (fatia `F2`)**

Preparar a cópia da `main` com o `export` (ver a pré-condição do T0 Step 7):
`sed -i '' 's/^async function buscarTitulosEGtins/export async function buscarTitulosEGtins/' $CLAUDE_JOB_DIR/tmp/ab/main/supabase/functions/_shared/ml/vendas.ts`
Run: `python3 $CLAUDE_JOB_DIR/tmp/ab/rodar.py F2` → `IDÊNTICO` nas 4 orgs. Conferir que `gtins` não veio vazio em pelo menos uma org.

- [ ] **Step 6: Commit + Codex + portão**

`feat(ml): fatia 2 do /items/bulk — GTIN de vendas e faturamento`. Edges: `edges_afetadas.py _shared/ml/vendas.ts _shared/ml/pedidos.ts`.

- [ ] **Step 7: Deploy + observação**

`sync-venda`: a próxima venda real. Pelo SQL read-only, a linha de faturamento dessa venda tem GTIN e markup preenchidos como nas anteriores. `reconciliar-faturamento` (cron `0 * * * *`): sem erro. `metricas-vendas`: sem erro quando a tela abrir.

---

### Task T3 (Fatia 3): kit virtual

**Files:**
- Modify: `_shared/ml/kit-virtual.ts:84-107` (`buscarListingTypeItensML`)
- Modify: `buscar-componentes-kit-virtual/index.ts:51-72` (`buscarUserProductIdsML`)
- Test: `_shared/ml/__tests__/kit-virtual-status.test.ts:118-130`, `buscar-componentes-kit-virtual/__tests__/processar.test.ts` (não muda: testa `processar.ts`)

- [ ] **Step 1: Testes falhando**

Em `kit-virtual-status.test.ts:122`, a expectativa vira
`'https://api.mercadolibre.com/items/bulk?ids=MLB1,MLB2&attributes=status_code,body.id,body.listing_type_id'`, e o mock de resposta desse teste passa de `code` para `status_code`. Adicionar:

```ts
it('fixture real: kit e itens comuns, 404 sem body fica fora do mapa, repetido vira uma consulta', async () => {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return new Response(JSON.stringify(bulkKit)); }));
  const ids = (bulkKit as Array<{ body?: { id: string } }>).flatMap((e) => (e.body ? [e.body.id] : []));
  const m = await buscarListingTypeItensML('t', [...ids, ids[0]]);
  expect(urls).toHaveLength(1);
  expect([...m.keys()].sort()).toEqual([...ids].sort());
});
```

Com `import bulkKit from './fixtures/bulk-kit-bulk.json' with { type: 'json' };`. O fixture do kit DSA vem do `spike_bulk2.py`, com os campos `id,listing_type_id,…`.

- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm test supabase/functions/_shared/ml/__tests__/kit-virtual-status.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

`kit-virtual.ts`:

```ts
  for (const bloco of blocosMultiget(itemIds)) {
    const resp = await fetch(
      `https://api.mercadolibre.com${caminhoMultiget(bloco, ['id', 'listing_type_id'])}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (!resp.ok) {
      throw new Error(`Falha ao consultar o listing type dos componentes (${resp.status}): ${await resp.text()}`);
    }
    const arr = await resp.json().catch(() => null);
    if (!Array.isArray(arr)) {
      throw new Error('O Mercado Livre devolveu uma resposta inesperada ao consultar o listing type dos componentes.');
    }
    for (const b of itensMultiget<{ id: string; listing_type_id?: string }>(arr)) {
      if (b.listing_type_id) out.set(b.id, b.listing_type_id);
    }
  }
```

`buscar-componentes-kit-virtual/index.ts`:

```ts
  for (const bloco of blocosMultiget(itemIds)) {
    const url = `${API}${caminhoMultiget(bloco, ['id', 'user_product_id', 'price', 'category_id'])}`;
    const arr = await mlGet(url, token);
    for (const b of itensMultiget<{ id: string; user_product_id?: string | null; price?: number | null; category_id?: string | null }>(arr)) {
      out.push({
        itemId: b.id,
        userProductId: b.user_product_id ?? null,
        precoAtualML: typeof b.price === 'number' ? b.price : null,
        categoriaMlId: b.category_id ?? null,
      });
    }
  }
```

Import: `import { blocosMultiget, caminhoMultiget, itensMultiget } from '../_shared/ml/multiget.ts';`. Se `mlGet` lançar em erro HTTP, nada muda. Hoje `!Array.isArray(arr)` → `continue`, e `itensMultiget` já devolve `[]` para não-array, o que é equivalente. Atualizar o comentário de `processar.ts:26` para `GET /items/bulk?ids=...&attributes=status_code,body.id,...`.

- [ ] **Step 4: Rodar e ver passar.** Run: `pnpm test supabase/functions/_shared/ml supabase/functions/buscar-componentes-kit-virtual supabase/functions/criar-kit-virtual supabase/functions/status-publicados` → PASS. Depois `deno check supabase/functions/buscar-componentes-kit-virtual/index.ts supabase/functions/criar-kit-virtual/index.ts`.

- [ ] **Step 5: A/B `F3`.** `python3 $CLAUDE_JOB_DIR/tmp/ab/rodar.py F3` → `IDÊNTICO`. A DSA precisa aparecer com `kits=2`. O `buscarUserProductIdsML` (inline em `index.ts`) é coberto pelo parse do helper (T0) e pelo par de fixtures `bulk-componentes-kit-{bulk,antigo}.json`. Adicionar em `multiget.test.ts`: `expect(itensMultiget(antigoComponentes)).toEqual(itensMultiget(bulkComponentes))`.

- [ ] **Step 6: Commit + Codex + portão.** `feat(ml): fatia 3 do /items/bulk — kit virtual`. Edges: `edges_afetadas.py _shared/ml/kit-virtual.ts buscar-componentes-kit-virtual/index.ts`.

- [ ] **Step 7: Deploy + observação.** `status-publicados` com kit da DSA sem erro. Se o Diego abrir o diálogo de kit, `buscar-componentes-kit-virtual` sem erro. `criar-kit-virtual` só é validado quando um kit real for criado pelo app.

---

### Task T4 (Fatia 4): promoções, operações, varredura de órfãos, descoberta de família UP

**Files:**
- Modify: `_shared/promocoes/ml.ts:122-135` (`buscarItensML`)
- Modify: `_shared/operacoes/ml.ts:38-48` (`multiget` interno)
- Modify: `_shared/ml/varrer-itens.ts:74-110` (`detalharItens`)
- Modify: `_shared/ml/descobrir-familia-up.ts:122-139` (`multiget` interno)
- Test: `_shared/promocoes/__tests__/ml.test.ts` (+ `fixtures/multiget.json`), `_shared/promocoes/__tests__/sincronizar.test.ts`, `_shared/operacoes/__tests__/ml.test.ts:117-150`, `_shared/ml/__tests__/varrer-itens.test.ts`, `_shared/ml/__tests__/descobrir-familia-up.test.ts:21-40,157-165`

- [ ] **Step 1: Testes falhando**

`operacoes/__tests__/ml.test.ts:125-126` passa a esperar:

```ts
expect(f.mock.calls[0][0]).toBe(`${API}/items/bulk?ids=MLB1&attributes=status_code,body.id,body.catalog_listing,body.item_relations`);
expect(f.mock.calls[1][0]).toBe(`${API}/items/bulk?ids=MLB2&attributes=status_code,body.id,body.catalog_listing`);
```

Os mocks de resposta do arquivo passam de `code:` para `status_code:`. Os testes "relacionado com code 404" (linha 138) e "item não devolvido" (linha 146) continuam iguais no comportamento, só com `status_code`. Adicionar:

```ts
it('lerRelacoes com 25 relacionados → 2 blocos (antes estourava o limite de 20)', async () => {
  const rels = Array.from({ length: 25 }, (_, i) => ({ id: `MLR${i}` }));
  const f = vi.fn(async (u: string) => {
    if (u.includes('body.item_relations')) return new Response(JSON.stringify([{ status_code: 200, body: { id: 'MLB1', catalog_listing: false, item_relations: rels } }]));
    const ids = new URL(u).searchParams.get('ids')!.split(',');
    return new Response(JSON.stringify(ids.map((id) => ({ status_code: 200, body: { id, catalog_listing: true } }))));
  });
  const cli = criarClienteML('t', f as unknown as typeof fetch);
  await cli.lerRelacoes('MLB1');
  expect(f.mock.calls.length).toBe(3);
});
```

Antes de fixar o número de chamadas, ler `operacoes/ml.ts:66-80` e alinhar com o que `lerRelacoes` faz.

`promocoes/__tests__/ml.test.ts`: converter `fixtures/multiget.json` com `sed -i '' 's/"code":/"status_code":/' …/promocoes/__tests__/fixtures/multiget.json` e conferir o resultado com `grep -c status_code`. No teste da linha 94 ("blocos de 20 e ignora code ≠ 200"), passar a checar a URL:
`expect(urls[0]).toMatch(/^\/items\/bulk\?ids=[^&]+&attributes=status_code,body\.id,body\.title,body\.thumbnail,body\.secure_thumbnail,body\.permalink,body\.listing_type_id,body\.category_id,body\.seller_custom_field,body\.attributes,body\.variations&include_attributes=all$/)`, e checar que nenhum bloco repete id. Linha 135: o cast `{ code: number; … }` vira `{ status_code: number; … }`.

`varrer-itens.test.ts`: os mocks passam de `code` para `status_code`. A asserção do teste da linha 56 ("quebra a consulta em blocos") continua válida. Adicionar uma checagem de URL: `toContain('/items/bulk?ids=')` e `toContain('&attributes=status_code,body.id,body.title,body.status,body.permalink,body.available_quantity,body.seller_custom_field,body.catalog_listing')`.

`descobrir-familia-up.test.ts`: linhas 35 e 163 passam de `'/items?ids='` para `'/items/bulk?ids='`, e o mock de resposta passa de `code` para `status_code`.

- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm test supabase/functions/_shared/promocoes supabase/functions/_shared/operacoes supabase/functions/_shared/ml` → FAIL nos alterados.

- [ ] **Step 3: Implementar**

`promocoes/ml.ts`:

```ts
const CAMPOS_ITEM = ['id', 'title', 'thumbnail', 'secure_thumbnail', 'permalink', 'listing_type_id', 'category_id', 'seller_custom_field', 'attributes', 'variations'];
// …
export async function buscarItensML(get: GetJson, ids: string[]): Promise<Map<string, ItemML>> {
  const m = new Map<string, ItemML>();
  for (const bloco of blocosMultiget(ids)) {
    const r = await get(caminhoMultiget(bloco, CAMPOS_ITEM, '&include_attributes=all'));
    for (const b of itensMultiget<Obj>(r)) {
      const it = normalizarItemML(b);
      m.set(it.id, it);
    }
  }
  return m;
}
```

Remover `ATRIBUTOS_ITEM` (linha 11) se ficar órfão. O `get` recebe um caminho relativo, como antes (`/items?ids=…`). Mudança de forma: antes a lista de ids ia toda dentro de um `encodeURIComponent` (`%2C`); agora vai id a id, com vírgula crua. O spike provou que as duas formas funcionam. Equivalência do filtro: antes era `x.code === 200 && x.body && typeof x.body === 'object'`; agora `itensMultiget` exige também `body.id` string. Isso é seguro, porque `normalizarItemML` usa `id` como chave do mapa.

`operacoes/ml.ts`:

```ts
  const multiget = async (xs: string[], atributos: string[]): Promise<Map<string, Obj>> => {
    const m = new Map<string, Obj>();
    for (const bloco of blocosMultiget(xs)) {
      const r = await chamar('GET', caminhoMultiget(bloco, atributos));
      if (!r.ok) throw await falha(r);
      for (const b of itensMultiget<Obj>(await r.json())) m.set(String(b.id), b);
    }
    return m;
  };
```

As chamadas passam a usar arrays: `multiget([itemId], ['id', 'catalog_listing', 'item_relations'])` e `multiget(rels, ['id', 'catalog_listing'])`. Remover o comentário `ponytail: um bloco só` e o helper `ids` (linha 22), se ficar órfão (`grep -n "ids(" operacoes/ml.ts`). `chamar` recebe caminho relativo (ver a linha 40 atual).

`varrer-itens.ts`:

```ts
  for (const bloco of blocosMultiget(ids)) {
    const url = `${API}${caminhoMultiget(bloco, ['id', 'title', 'status', 'permalink', 'available_quantity', 'seller_custom_field', 'catalog_listing'])}`;
    const resp = await fetchLike(url, { headers });
    if (!resp.ok) throw new Error(`detalhes dos anúncios: ML respondeu ${resp.status}`);
    for (const b of itensMultiget<{
      id: string; title?: string; status?: string; permalink?: string;
      available_quantity?: number; seller_custom_field?: string | null; catalog_listing?: boolean;
    }>(await resp.json())) {
      out.push({
        id: b.id,
        titulo: b.title ?? null,
        status: b.status ?? null,
        permalink: b.permalink ?? null,
        estoque: typeof b.available_quantity === 'number' ? b.available_quantity : null,
        sku: b.seller_custom_field ?? null,
        catalogo: b.catalog_listing === true,
      });
    }
  }
```

`descobrir-familia-up.ts`:

```ts
  for (const bloco of blocosMultiget(ids)) {
    const url = `${API}${caminhoMultiget(bloco, ['id', 'seller_id', 'category_id', 'family_id', 'family_name', 'status', 'variations', 'attributes'])}`;
    const resp = await fetchLike(url, { headers });
    if (!resp.ok) throw new Error(`multiget de família migrada (${resp.status})`);
    out.push(...itensMultiget<ItemBruto>(await resp.json()));
  }
```

Remover `MULTIGET_CHUNK` e `chunk` órfãos de `varrer-itens.ts` e `descobrir-familia-up.ts`. Atenção: `ItemBruto` precisa aceitar `id: string`. Conferir o tipo; se `id` for opcional, usar `itensMultiget<ItemBruto & { id: string }>`.

- [ ] **Step 4: Rodar e ver passar.** Run: `pnpm test supabase/functions/_shared supabase/functions/operacoes-massa supabase/functions/sincronizar-promocoes supabase/functions/coletar-ads-ml supabase/functions/coletar-trafego-ml supabase/functions/varrer-anuncios-orfaos supabase/functions/update-familia-ml` → PASS. Depois `deno check` nos `index.ts` dessas edges.

- [ ] **Step 5: A/B `F4`.** `python3 $CLAUDE_JOB_DIR/tmp/ab/rodar.py F4` → `IDÊNTICO` nas 4 orgs (inclui `rel` de catálogo e `promo` com `include_attributes=all`). O `descobrirFamiliaUP` faz uma busca por título antes do multiget, e uma busca de mercado não é determinística entre duas chamadas. Por isso fica coberto pelo par de fixtures `bulk-descobrir-familia-{bulk,antigo}.json`: adicionar em `multiget.test.ts` `expect(itensMultiget(antigoDescobrir)).toEqual(itensMultiget(bulkDescobrir))`.

- [ ] **Step 6: Commit + Codex + portão.** `feat(ml): fatia 4 do /items/bulk — promoções, operações, órfãos e família UP`. Edges: `edges_afetadas.py _shared/promocoes/ml.ts _shared/operacoes/ml.ts _shared/ml/varrer-itens.ts _shared/ml/descobrir-familia-up.ts`.

- [ ] **Step 7: Deploy + observação.** `sincronizar-promocoes` (cron `10 */6 * * *`): o número de itens e categorias gravados na rodada bate com a rodada anterior, comparado por SQL read-only nas tabelas da Central de Promoções (localizar com `grep -n "^### " docs/reference/modelo-de-dados.md | grep -i promo`). `coletar-trafego-ml` (cron `17 9`): segue ok. `operacoes-massa` e `varrer-anuncios-orfaos` só rodam por ação do usuário, então ficam com observação passiva.

---

### Task T5 (Fatia 5): Pulse e PxV

**Files:**
- Modify: `_shared/pulse/parse.ts:91-124` (`parseStatusAnuncios` + comentário)
- Modify: `pulse-coletar/processar.ts:682-691`
- Modify: `acompanhar-migracao-pxv/index.ts:93-108` (`lerCores`) e `:172-183` (estoque vivo)
- Test: `_shared/pulse/__tests__/parse.test.ts`; novo caso em `_shared/ml/__tests__/multiget.test.ts` (pares PxV)

- [ ] **Step 1: Testes falhando**

Em `parse.test.ts`, adicionar:

```ts
import bulkPulse from '../../ml/__tests__/fixtures/bulk-pulse-bulk.json' with { type: 'json' };
import antigoPulse from '../../ml/__tests__/fixtures/bulk-pulse-antigo.json' with { type: 'json' };
it('parseStatusAnuncios lê o envelope do bulk (status_code) igual ao antigo; 404 sem body fica fora', () => {
  const novo = parseStatusAnuncios(bulkPulse);
  expect(novo).toHaveLength(3);
  expect(novo).toEqual(parseStatusAnuncios(antigoPulse));
});
```

Em `multiget.test.ts`, adicionar os pares PxV (`bulk-pedidos-pxv-cores-*` e `bulk-pxv-estoque-*`): `expect(itensMultiget(antigo)).toEqual(itensMultiget(bulk))`.

- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm test supabase/functions/_shared/pulse` → FAIL (`parseStatusAnuncios` só lê `code`).

- [ ] **Step 3: Implementar**

`parse.ts`:

```ts
export function parseStatusAnuncios(json: unknown): AnuncioMultiget[] {
  return itensMultiget(json).map((b) => ({
    item_id: b.id as string,
    status: typeof b.status === 'string' ? b.status : null,
    sub_status: Array.isArray(b.sub_status) ? (b.sub_status as unknown[]).filter((s): s is string => typeof s === 'string') : null,
    category_id: typeof b.category_id === 'string' ? b.category_id : null,
    listing_type_id: typeof b.listing_type_id === 'string' ? b.listing_type_id : null,
    price: typeof b.price === 'number' ? b.price : null,
  }));
}
```

Importar `itensMultiget` de `../ml/multiget.ts`. **Conferir antes** que `_shared/pulse/parse.ts` não tem restrição de import: rodar `head -15` no arquivo e ver se há o comentário "sem import". `vendedores-do-catalogo.ts` importa este arquivo, e o helper é puro, então não cria dependência Deno/npm. O comentário da linha 91 passa a dizer: `Multiget \`/items/bulk?ids=…\` (ADR-0177) — situação dos NOSSOS anúncios. A resposta é uma lista de envelopes \`{ status_code, body }\` (o antigo usava \`code\`; os dois são aceitos)`.

`pulse-coletar/processar.ts`:

```ts
      for (const lote of blocosMultiget(ids)) {
        const json = await mlGet(
          `${API}${caminhoMultiget(lote, ['id', 'status', 'sub_status', 'category_id', 'listing_type_id', 'price'])}`,
          token,
        );
        for (const st of parseStatusAnuncios(json)) infoPorItem.set(st.item_id, st);
      }
```

O `const ids = [...new Set(...)]` da linha 682 fica.

`acompanhar-migracao-pxv/index.ts`, em `lerCores`:

```ts
      const token = await getToken();
      for (const bloco of blocosMultiget(itemIds)) {
        const url = `${API}${caminhoMultiget(bloco, ['id', 'attributes'])}`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        // Lança em vez de devolver mapa vazio: (comentário existente, mantido)
        if (!resp.ok) throw new Error(`multiget de cores falhou (${resp.status})`);
        for (const b of itensMultiget<{ id: string; attributes?: unknown }>(await resp.json())) {
          out.set(String(b.id), corDaVariacaoML(b.attributes));
        }
      }
```

O comentário das linhas 99-101 fica, colado ao `if (!resp.ok)`.

Estoque vivo (linhas 172-183):

```ts
      const ids = [...itemPorSku.values()];
      const vivoPorItem = new Map<string, number>();
      for (const bloco of blocosMultiget(ids)) {
        const url = `${API}${caminhoMultiget(bloco, ['id', 'available_quantity'])}`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}` } });
        if (!resp.ok) continue;
        for (const b of itensMultiget<{ id: string; available_quantity?: number }>(await resp.json())) {
          vivoPorItem.set(String(b.id), b.available_quantity ?? 0);
        }
      }
```

Equivalência: hoje um `!resp.ok` pula o lote inteiro (só havia um lote). Agora pula só o bloco com falha. Para ≤20 ids sem repetição, o resultado é idêntico. Repetidos e >20 hoje dão 400 → mapa vazio; agora funcionam. É a exceção declarada nas Global Constraints. Importar de `../_shared/ml/multiget.ts`.

- [ ] **Step 4: Rodar e ver passar.** Run: `pnpm test supabase/functions/_shared supabase/functions/pulse-coletar supabase/functions/acompanhar-migracao-pxv supabase/functions/pulse-analise-secoes237` → PASS. Depois `deno check supabase/functions/pulse-coletar/index.ts supabase/functions/acompanhar-migracao-pxv/index.ts`.

- [ ] **Step 5: A/B `F5`.** `python3 $CLAUDE_JOB_DIR/tmp/ab/rodar.py F5` → `IDÊNTICO`. Antes de rodar, conferir que `edges_afetadas.py _shared/pulse/parse.ts` lista `pulse-analise-secoes237`, para confirmar que é edge real e não pasta morta.

- [ ] **Step 6: Commit + Codex + portão.** `feat(ml): fatia 5 do /items/bulk — Pulse e migração PxV`. Edges: `edges_afetadas.py _shared/pulse/parse.ts pulse-coletar/processar.ts acompanhar-migracao-pxv/index.ts`.

- [ ] **Step 7: Deploy + observação.** `pulse-coletar` tier quente (cron `0 */6 * * *`): sem erro, e a situação dos anúncios gravada na rodada tem a mesma contagem por status da rodada anterior (SQL read-only). PxV: conferir por SQL se há migração ativa. Sem migração ativa, A/B + testes bastam, e isso fica registrado.

---

### Task T6 (Fatia 6): varredura final e docs

**Files:**
- Modify: `docs/reference/edge-functions.md` (multiget nas edges afetadas + nota ADR-0177)
- Modify: `obsidian-vault/03-Módulos/Estoque.md:231`
- Modify: `docs/runbooks/coletar-trafego-ml.md` (linha 102: o helper central existe; a referência fica)
- Modify: `obsidian-vault/04-Decisões/Índice de ADRs.md` (linha da 0177), `docs/project-status.md`, `docs/TASKS.md`, `obsidian-vault/09-Logs/Changelog.md`. Seguir a skill `docs-update-checklist`.

- [ ] **Step 1: Varredura**

Run: `grep -rn "items?ids=" supabase/functions src`
Expected: só comentários históricos explicitamente datados, ou zero. Hoje sobram `coletar-trafego-ml/deps.ts:135` ("o multiget /items?ids= sai em 25/10") e `vendedores-do-catalogo.ts:3` ("Medido em 2026-08-29… `/items?ids=` devolve 403"). Os dois são históricos e ficam. Qualquer outra ocorrência é bug.

Run: `grep -rnE "\.code\s*[!=]==?\s*200" supabase/functions --include=*.ts | grep -v __tests__`
Expected: só `fiacao.ts:76` (`code ?? status_code`).

Run: `grep -rn "'/items?ids=\|\"/items?ids=" supabase/functions --include=*.ts`
Expected: vazio, incluindo os testes.

- [ ] **Step 2: Docs**

Atualizar os arquivos listados com uma linha cada, citando a ADR-0177: `Estoque.md:231` passa a dizer `multiget /items/bulk (ADR-0177)`. Atualizar o Graphify depois da mudança (skill `graphify-update-maintenance`).

- [ ] **Step 3: Portão final**

`pnpm preflight` verde, CI verde e P-Revisão Codex do diff completo da branch contra a `main` antes da 1ª fatia (pré-merge). Merge dos docs com o OK do Diego. Remover a branch e o worktree no fim, conforme o CLAUDE.md.

- [ ] **Step 4: Teste de fumaça pós-tudo**

Rodar `python3 $CLAUDE_JOB_DIR/tmp/edges_afetadas.py _shared/ml/multiget.ts` e conferir em `supabase functions list` que **todas** as edges listadas têm versão posterior ao deploy da sua fatia. Nenhuma edge que importa o helper pode estar numa versão anterior.

---

## Self-review

- Cobertura da spec:
  - §2 (contrato) → T0, com testes do helper e fixtures reais;
  - §3 (inventário, 13 arquivos e 14 chamadas) → T1 (3), T2 (2), T3 (2), T4 (4), T5 (3 arquivos, 4 chamadas);
  - comentários e docs → T3, T5, T6;
  - §5 (validação) → P-A/B, P-Observação e o teste da guarda;
  - §6 (fatias) → T0 a T6;
  - §7 (pronto) → T6.
- Os nomes `blocosMultiget`, `caminhoMultiget`, `entradasMultiget` e `itensMultiget` são os mesmos em todas as tarefas.
- Review Focus 1 a 5 → T0 (dedup, 404, >20), T4 e T5 (blocos onde não havia), T1 (lerStatus + propagação com guarda).
