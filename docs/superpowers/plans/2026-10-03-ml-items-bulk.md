# Multiget ML `/items?ids=` → `/items/bulk` — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** trocar as 14 chamadas a `GET /items?ids=` (13 arquivos) por `GET /items/bulk?ids=` antes de 25/10/2026, mantendo equivalentes as decisões de negócio e sem nenhuma escrita no Mercado Livre fora do fluxo do app.

**Architecture:** um **adaptador** puro (`_shared/ml/multiget.ts`) monta a URL do bulk, deduplicando dentro da requisição, e converte a resposta de volta no **envelope antigo** (`[{code, body}]`, com o id recolocado pela posição no 404 sem body). Cada módulo troca só a URL e passa o JSON pelo adaptador; laços, predicados e erros continuam como estão. As leituras inline ganham uma extração mínima, num commit separado, para poderem ser testadas. Cada fatia passa por TDD, A/B em duas fases (gravação e replay, só GET ao vivo, escrita simulada) e revisão do Codex. Depois do merge, a fatia tem deploy com manifesto de hash por edge e observação.

**Tech Stack:** Deno (Supabase Edge Functions), TypeScript, vitest (`pnpm test`), Supabase CLI 2.101, Codex CLI.

**Spec:** `docs/superpowers/specs/2026-10-03-ml-items-bulk-design.md` (v2). §2 é o contrato medido, §3 o inventário, §4.3 as diferenças aceitas e §5 a validação.

**Histórico:** a v1 levou REVISAR do Codex `gpt-6.1-sol` high (18 achados). A v2 responde todos (tabela no fim) e incorpora a consultoria do `gpt-6-astra` high.

## Global Constraints

- **No ML, só GET** em spike, A/B e validação. **Nunca** PUT, POST ou DELETE em anúncio fora do fluxo normal do app, nem para teste.
- O token ML é lido por SQL read-only (`get_connection_tokens`) via Management API (`SUPABASE_ACCESS_TOKEN` do `.env.local` da raiz). **Nunca** renovar, imprimir ou gravar o token. 401/403 encerra o A/B.
- Scripts descartáveis ficam em `$CLAUDE_JOB_DIR/tmp` (`/Users/diego/.claude/jobs/b87cbc02/tmp`).
- **Equivalência estrita:** os módulos mantêm particionamento, predicados, transporte, `throw`/`[]`/`continue`, o comportamento diante de resposta não-array e a contagem de chamadas a `getToken()`. As únicas diferenças aceitas são as do spec §4.3.
- **Fora de escopo:** melhorias funcionais (mais de 20 relacionados na propagação, mais de 20 ids no PxV, dedup global). Hoje respondem 400 e continuam assim.
- O helper **não** divide em blocos, **não** filtra, **não** faz `trim` e **não** lança.
- `fiacao.ts` e `coletar-trafego-ml/deps.ts` **não mudam**.
- Deploy **só depois do merge**. Edges por `deno info` (com caminho decodificado). `--project-ref txvncrgkoynoxwopfkbp` explícito. Manifesto com hash do código baixado antes e depois.
- Merge: fast-forward, com CI verde (`frontend`, `backend-lint`) e **OK do Diego por fatia**. Nunca `--admin` nem force-push.
- Revisão: o Codex `gpt-6.1-sol` high revisa o plano, cada fatia e o pré-merge (`codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only - < <prompt> > <saída>`, sempre com stdin de arquivo). A consultoria é o `gpt-6-astra` high.
- git no worktree: `/usr/bin/git` com comando simples, commit por `-F <arquivo em $CLAUDE_JOB_DIR/tmp>`. Fim de toda mensagem: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prazo: em produção até **15/10/2026**.
- Datas-alvo:
  - T0 + T1: 05/10
  - T2: 07/10
  - T3: 08/10
  - T4: 10/10
  - T5: 13/10
  - T6: 14/10

## Review Focus

1. **Mesmo id em dois blocos, com 200 num e 404 sem body no outro (`lerStatus`).** Esperado: resultado final igual ao do antigo (`null` → `indisponivel`). Teste em T1 Step 1.
2. **Resposta não-array (objeto, `null`, texto) no PxV e nos demais.** Esperado: o mesmo comportamento de hoje (`TypeError` que reagenda, ou vazio onde já era vazio). Testes em T0 (o adaptador devolve intacto) e T5.
3. **Relacionados de catálogo mistos `[ativo, ilegível]` e `[pausado, ativo]` nos dois sentidos.** Esperado: a mesma sequência de PUTs de hoje, inclusive o PUT antes do 502, que já existe e fica caracterizado, sem prometer atomicidade. Teste em T1 Step 1.
4. **Id repetido no bloco, e mais de 20 posições com até 20 ids únicos.** Esperado: uma consulta e nenhum 400, como no antigo, que deduplica antes do limite. Testes em T0 e no teste de URL de cada módulo.
5. **`lerStatus` real alimentando a reativação no `sincronizar-estoque`.** Esperado: pausado → reativa; 404 sem body → não reativa. Teste em T1 Step 1.

---

## File Structure

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `supabase/functions/_shared/ml/multiget.ts` (novo) | `caminhoMultiget`, `comoEnvelopeAntigo` | T0 |
| `supabase/functions/_shared/ml/__tests__/multiget.test.ts` (novo) | contrato do adaptador com fixtures reais | T0 |
| `supabase/functions/_shared/ml/__tests__/fixtures/bulk-*.json` (novos) | pares reais antigo/bulk, alinhados por id | T0 |
| `docs/decisions/0177-multiget-ml-items-bulk.md` (novo) | ADR | T0 |
| `$CLAUDE_JOB_DIR/tmp/ab/*` (fora do repo) | guarda, replay, cenários, runner e testes | T0 |
| `$CLAUDE_JOB_DIR/tmp/edges_afetadas.py`, `manifesto.py` (fora do repo) | lista de edges e manifesto de deploy | T0 |
| `_shared/canais/mercado-livre.ts`, `_shared/ml/buscar-item.ts`, `_shared/ml/atualizar-item.ts` + testes | F1 | T1 |
| `_shared/ml/vendas.ts`, `_shared/ml/pedidos.ts` + testes | F2 | T2 |
| `_shared/ml/kit-virtual.ts`, `buscar-componentes-kit-virtual/{index.ts, leitura-ml.ts (novo), processar.ts}` + testes | F3 | T3 |
| `_shared/promocoes/ml.ts`, `_shared/operacoes/ml.ts`, `_shared/ml/varrer-itens.ts`, `_shared/ml/descobrir-familia-up.ts` + testes | F4 | T4 |
| `pulse-coletar/processar.ts`, `acompanhar-migracao-pxv/{index.ts, leitura-ml.ts (novo)}` + testes | F5 | T5 |
| docs vivas | F6 | T6 |

Caminhos que começam por `_shared/` ou pelo nome de uma edge são relativos a `supabase/functions/`. Worktree: `/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/verif-items-bulk`, branch `worktree-ml-items-bulk`.

---

## Procedimentos comuns

### P-A/B (T1–T5): duas fases, baseline fixa

1. **Baseline:** `BASE=$(/usr/bin/git rev-parse <commit pai do primeiro commit da fatia>)`. Extrair:
   `rm -rf $CLAUDE_JOB_DIR/tmp/ab/base && mkdir -p $CLAUDE_JOB_DIR/tmp/ab/base && /usr/bin/git archive $BASE supabase/functions | tar -x -C $CLAUDE_JOB_DIR/tmp/ab/base`.
   Numa fatia com extração (T3, T5), a baseline é o **commit da extração**, que ainda usa o endpoint antigo. A extração em si é validada no P-Extração.
2. **Produção ≡ baseline** (antes da 1ª fatia e antes de cada deploy): `python3 $CLAUDE_JOB_DIR/tmp/manifesto.py conferir <BASE> <edges da fatia>`. Bloqueia se algum arquivo do bundle em produção diferir da árvore `BASE`.
3. Rodar `python3 $CLAUDE_JOB_DIR/tmp/ab/rodar.py <fatia> $CLAUDE_JOB_DIR/tmp/ab/base/supabase/functions <worktree>/supabase/functions`. Para cada org:
   - fase A (baseline, grava);
   - fase B (nova, replay);
   - fase A' (baseline de novo, replay).
4. **Critério:**
   - B == A, sob a canonização da fatia, nas 4 orgs;
   - toda checagem de cobertura positiva verde;
   - nenhuma escrita inesperada;
   - nenhuma gravação sobrando.
   - Se A ≠ B e A' == B, a diferença é preço ou estoque mudando entre as fases: repetir, até 3 vezes.
   - Qualquer outra diferença bloqueia até ser explicada e aceita pelo Diego.
5. **Pós-deploy:** o mesmo runner, com a árvore nova = código **baixado de produção** (`$CLAUDE_JOB_DIR/tmp/dl/<fatia>-depois/<edge>/supabase/functions`), uma edge representativa por módulo.

### P-Extração (T3, T5)

1. Escrever primeiro os testes de caracterização da função extraída, com URL e envelope **antigos**.
2. Mover o código (commit `refactor(...)`, sem mudar o endpoint).
3. `/usr/bin/git diff --color-moved=zebra HEAD~1 -- <arquivos>`: o diff precisa ser **só movimento**, mais import/export e a chamada no lugar antigo.
4. Rodar os testes.
5. Rodar o A/B com baseline = commit pai da extração e árvore nova = commit da extração. As duas usam o endpoint antigo, e a igualdade prova que mover o código não mudou nada.
6. Codex revisa o commit de extração isolado.

### P-Deploy (T1–T5, só depois do merge)

1. `python3 $CLAUDE_JOB_DIR/tmp/edges_afetadas.py <arquivos alterados na fatia, incluindo _shared/ml/multiget.ts na 1ª>`. O script **recusa** lista vazia.
2. `python3 $CLAUDE_JOB_DIR/tmp/manifesto.py antes <fatia> <BASE> <edges>`. Para cada edge:
   - baixa um snapshot em diretório próprio (fonte do rollback);
   - grava `verify_jwt` e a versão;
   - confere o hash contra `BASE`.
   Divergência bloqueia.
3. Conferir que `origin/main` == HEAD local (ninguém empurrou outra coisa) e que nenhuma edge da lista mudou de versão desde o passo 2.
4. `supabase functions deploy <edges…> --project-ref txvncrgkoynoxwopfkbp`, na raiz do worktree (o `config.toml` define `verify_jwt`).
5. `python3 $CLAUDE_JOB_DIR/tmp/manifesto.py depois <fatia> <SHA_MAIN> <edges>`. Para cada edge:
   - baixa de novo;
   - confere o hash de cada arquivo contra `SHA_MAIN`;
   - confere `verify_jwt` igual ao de antes e versão incrementada.
   Qualquer falha é **deploy parcial**: completar o deploy da edge que faltou ou reverter todas, e não avançar de fatia.
6. **Rollback** (só até 25/10):
   - para cada edge, `supabase functions deploy <edge> --project-ref txvncrgkoynoxwopfkbp --workdir $CLAUDE_JOB_DIR/tmp/dl/<fatia>-antes/<edge>` com `--no-verify-jwt` quando o manifesto registrou `false`;
   - depois, `manifesto.py conferir <BASE> <edges>`;
   - o código volta por branch `revert/<fatia>` → CI verde → fast-forward.

### P-Observação (T1–T5)

- Logs pelo endpoint de analytics da Management API, com `iso_timestamp_start/end`: do deploy até a 1ª execução real + 10 min.
- Procurar `items/bulk`, `Too many IDs`, `Duplicate item id`, ` 400`, `TypeError`, `multiget`.
- Critério: zero erro novo e a comparação **por id e campo** definida na fatia.
- Prazo de observação: 24 h por fatia. Se não houver execução real, registrar "não observado; coberto por teste + A/B (+ A/B pós-deploy)".

### P-Revisão Codex (T0–T6)

`/usr/bin/git diff <BASE>..HEAD > $CLAUDE_JOB_DIR/tmp/diff-<fatia>.patch`. Escrever em `$CLAUDE_JOB_DIR/tmp/prompt-rev-<fatia>.txt`:

```
Revisão MINUCIOSA do diff em $CLAUDE_JOB_DIR/tmp/diff-<fatia>.patch (fatia <N> da migração /items?ids= → /items/bulk; spec docs/superpowers/specs/2026-10-03-ml-items-bulk-design.md; plano docs/superpowers/plans/2026-10-03-ml-items-bulk.md). Leia também o código completo dos arquivos tocados. Promessa: decisões de negócio equivalentes, diferenças só as do spec §4.3. Procure: qualquer mudança de particionamento, predicado, throw/[]/continue, comportamento com não-array, contagem de getToken; adaptador mal aplicado (ids errados no comoEnvelopeAntigo); teste que não prova o que diz; risco de escrita no ML. Liste achados com arquivo:linha e severidade (BLOQUEANTE/IMPORTANTE/MENOR). Termine com VEREDITO: APROVADO ou VEREDITO: REVISAR.
```

Rodar: `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only - < $CLAUDE_JOB_DIR/tmp/prompt-rev-<fatia>.txt > $CLAUDE_JOB_DIR/tmp/rev-<fatia>.txt 2>&1` (em background). Corrigir os bloqueantes. Correção estrutural volta ao Codex uma vez; correção pontual segue com teste.

### P-Portão de merge (T1–T6)

1. `pnpm preflight`.
2. `/usr/bin/git push origin worktree-ml-items-bulk` e `gh run watch` (CI verde).
3. **Parar e reportar ao Diego:**
   - testes;
   - A/B (orgs, n de ids, cobertura positiva, 0 diferenças);
   - Codex (achados e o que foi feito);
   - edges a deployar;
   - decisões.
   Esperar o OK.
4. Com o OK: `/usr/bin/git fetch origin`. Se a `origin/main` andou, `/usr/bin/git merge origin/main`, testes de novo e CI. Depois `/usr/bin/git push origin HEAD:main` (fast-forward), P-Deploy e P-Observação.

---

### Task T0: adaptador, fixtures alinhados, ADR-0177 e ferramental (sem deploy)

**Files:**
- Create: `supabase/functions/_shared/ml/multiget.ts`
- Create: `supabase/functions/_shared/ml/__tests__/multiget.test.ts`
- Create: `supabase/functions/_shared/ml/__tests__/fixtures/bulk-<conjunto>-{antigo,bulk}.json`
- Create: `docs/decisions/0177-multiget-ml-items-bulk.md`
- Create (fora do repo): `$CLAUDE_JOB_DIR/tmp/ab/{guarda.ts, guarda.test.ts, cenarios.ts, ab.ts, rodar.py}`, `$CLAUDE_JOB_DIR/tmp/{fixtures.py, edges_afetadas.py, manifesto.py}`

**Interfaces:**
- Produces:
  - `caminhoMultiget(ids: readonly string[], campos: string, extra?: string): string`, que devolve `"/items/bulk?ids=…&attributes=status_code,body.…"`
  - `comoEnvelopeAntigo(json: unknown, idsPedidos: readonly string[]): unknown`

- [ ] **Step 1: Fixtures alinhados por id**

`$CLAUDE_JOB_DIR/tmp/fixtures.py`:

```python
import json, pathlib
SPK = pathlib.Path('/Users/diego/.claude/jobs/b87cbc02/tmp/spike')
DST = pathlib.Path('/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/verif-items-bulk/supabase/functions/_shared/ml/__tests__/fixtures')
DST.mkdir(parents=True, exist_ok=True)
INVALIDO = 'MLB0000000001'

def carregar(nome):
    return json.loads((SPK / nome).read_text())

def por_id(arr):
    return {(e.get('body') or {}).get('id'): e for e in arr if (e.get('body') or {}).get('id')}

def escolher(antigo, prefer):
    """3 ids presentes nos dois lados, priorizando os que têm os atributos que os testes usam."""
    ok = [i for i, e in por_id(antigo).items() if e.get('code') == 200]
    def peso(i):
        b = por_id(antigo)[i]['body']
        attrs = {a.get('id') for a in (b.get('attributes') or [])}
        tem_var = bool(b.get('variations'))
        return (-(len(attrs & prefer)), -int(tem_var), i)
    return sorted(ok, key=peso)[:3]

def gravar(conj, antigo, bulk, ids, prefer):
    A, B = por_id(antigo), por_id(bulk)
    assert all(i in A and i in B for i in ids), (conj, ids)
    def enxuto(e):
        e = json.loads(json.dumps(e))
        b = e['body']
        for k in ('attributes',):
            if isinstance(b.get(k), list):
                manter = [a for a in b[k] if a.get('id') in prefer][:6] or b[k][:3]
                b[k] = manter
        if isinstance(b.get('variations'), list):
            b['variations'] = b['variations'][:2]
        return e
    lado_antigo = [enxuto(A[i]) for i in ids] + [e for e in antigo if (e.get('body') or {}).get('id') == INVALIDO]
    # bulk: na ordem pedida (é como o bulk responde) e com o 404 sem body no fim, onde foi pedido
    lado_bulk = [enxuto(B[i]) for i in ids] + [e for e in bulk if e.get('status_code') == 404 and not e.get('body')][:1]
    for lado, arr in (('antigo', lado_antigo), ('bulk', lado_bulk)):
        (DST / f'bulk-{conj}-{lado}.json').write_text(json.dumps(arr, ensure_ascii=False, indent=1) + '\n')
    (DST / f'bulk-{conj}-ids.json').write_text(json.dumps(ids + [INVALIDO]) + '\n')

PREF = {'GTIN', 'COLOR', 'BRAND', 'MODEL', 'SELLER_SKU'}
for conj in ['canais', 'atualizar_item', 'buscar_item', 'descobrir_familia', 'varrer_itens', 'vendas',
             'pedidos_pxv_cores', 'kit_virtual', 'componentes_kit', 'operacoes', 'pulse', 'pxv_estoque', 'promocoes']:
    antigo, bulk = carregar(f'{conj}-antigo.json'), carregar(f'{conj}-bulk.json')
    gravar(conj.replace('_', '-'), antigo, bulk, escolher(antigo, PREF), PREF)
for org, nome in [('DSA', 'kit'), ('Avil', 'catalogo'), ('Avil', 'relacionados')]:
    antigo, bulk = carregar(f'{org}-{nome}-antigo.json'), carregar(f'{org}-{nome}-bulk.json')
    ids = sorted(set(por_id(antigo)) & set(por_id(bulk)))[:3]
    gravar(nome, antigo, bulk, ids, PREF)
print(sorted(p.name for p in DST.glob('bulk-*-ids.json')))
```

Run: `python3 $CLAUDE_JOB_DIR/tmp/fixtures.py`
Expected: 16 trincas `bulk-<conj>-{antigo,bulk,ids}.json`. Conferir:
- `grep -L status_code fixtures/bulk-*-bulk.json` → vazio;
- `grep -l '"code"' fixtures/bulk-*-bulk.json` → vazio;
- `grep -c '"GTIN"' fixtures/bulk-pedidos-pxv-cores-antigo.json fixtures/bulk-vendas-antigo.json` → ≥1 cada;
- `grep -c '"COLOR"' fixtures/bulk-pedidos-pxv-cores-antigo.json` → ≥1.

Os fixtures de kit, catálogo e relacionados não têm 404, porque o spike não pediu id inválido nesses casos. O teste de kit insere o 404 explicitamente (T3).

- [ ] **Step 2: Teste do adaptador (falhando)**

`supabase/functions/_shared/ml/__tests__/multiget.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { caminhoMultiget, comoEnvelopeAntigo } from '../multiget.ts';

const CONJUNTOS = [
  'canais', 'atualizar-item', 'buscar-item', 'descobrir-familia', 'varrer-itens', 'vendas', 'pedidos-pxv-cores',
  'kit-virtual', 'componentes-kit', 'operacoes', 'pulse', 'pxv-estoque', 'promocoes', 'kit', 'catalogo', 'relacionados',
] as const;
const carregar = async (c: string, lado: 'antigo' | 'bulk' | 'ids') =>
  (await import(`./fixtures/bulk-${c}-${lado}.json`, { with: { type: 'json' } })).default as unknown;

type Env = { code?: number; body?: { id?: string; tags?: string[] } & Record<string, unknown> };
/** Antigo e bulk comparados por id (a ordem do antigo é arbitrária) e com `tags` ordenado (spec §4.3). */
const normalizar = (arr: unknown) =>
  (arr as Env[]).map((e) => ({
    code: e.code,
    id: e.body?.id,
    body: e.code === 200 ? { ...e.body, ...(e.body?.tags ? { tags: [...e.body.tags].sort() } : {}) } : undefined,
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)));

describe('caminhoMultiget', () => {
  it('status_code primeiro e prefixo body. em cada campo, na ordem dada', () => {
    expect(caminhoMultiget(['MLB1', 'MLB2'], 'id,status,price'))
      .toBe('/items/bulk?ids=MLB1,MLB2&attributes=status_code,body.id,body.status,body.price');
  });
  it('deduplica DENTRO da requisição, preservando a 1ª ocorrência (o antigo deduplicava antes do limite)', () => {
    expect(caminhoMultiget(['MLB2', 'MLB1', 'MLB2'], 'id')).toBe('/items/bulk?ids=MLB2,MLB1&attributes=status_code,body.id');
  });
  it('21 posições com 20 únicos → 20 na URL', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `MLB${i}`);
    const q = new URL(`https://x${caminhoMultiget([...ids, ids[0]], 'id')}`).searchParams.get('ids')!.split(',');
    expect(q).toEqual(ids);
  });
  it('não divide, não filtra, não lança: 21 distintos ficam na URL (o ML responde 400, como hoje)', () => {
    const ids = Array.from({ length: 21 }, (_, i) => `MLB${i}`);
    expect(new URL(`https://x${caminhoMultiget(ids, 'id')}`).searchParams.get('ids')!.split(',')).toHaveLength(21);
    expect(() => caminhoMultiget([], 'id')).not.toThrow();
  });
  it('extra vai no fim e cada id é codificado', () => {
    expect(caminhoMultiget(['MLB 1'], 'id', '&include_attributes=all'))
      .toBe('/items/bulk?ids=MLB%201&attributes=status_code,body.id&include_attributes=all');
  });
});

describe('comoEnvelopeAntigo', () => {
  it.each(CONJUNTOS)('%s: resposta real do bulk vira o envelope antigo dos mesmos ids', async (c) => {
    const ids = (await carregar(c, 'ids')) as string[];
    const bulk = await carregar(c, 'bulk');
    const antigo = await carregar(c, 'antigo');
    const pedidos = (bulk as unknown[]).length === ids.length ? ids : ids.slice(0, -1);
    expect(normalizar(comoEnvelopeAntigo(bulk, pedidos))).toEqual(normalizar(antigo));
  });
  it('404 sem body recebe o id pela posição', () => {
    const r = comoEnvelopeAntigo(
      [{ status_code: 200, body: { id: 'MLB1' } }, { status_code: 404 }, { status_code: 200, body: { id: 'MLB3' } }],
      ['MLB1', 'MLB2', 'MLB3'],
    );
    expect(r).toEqual([{ code: 200, body: { id: 'MLB1' } }, { code: 404, body: { id: 'MLB2' } }, { code: 200, body: { id: 'MLB3' } }]);
  });
  it('posição conta sobre os ids ÚNICOS enviados', () => {
    expect(comoEnvelopeAntigo([{ status_code: 200, body: { id: 'MLB1' } }, { status_code: 404 }], ['MLB1', 'MLB1', 'MLB2']))
      .toEqual([{ code: 200, body: { id: 'MLB1' } }, { code: 404, body: { id: 'MLB2' } }]);
  });
  it('quantidade diferente da de ids: só traduz o código, sem inventar id', () => {
    expect(comoEnvelopeAntigo([{ status_code: 404 }], ['MLB1', 'MLB2'])).toEqual([{ code: 404 }]);
  });
  it('code tem prioridade sobre status_code (mesma regra de fiacao.ts) e envelope antigo passa intacto', () => {
    expect(comoEnvelopeAntigo([{ code: 200, status_code: 404, body: { id: 'MLB1' } }], ['MLB1']))
      .toEqual([{ code: 200, body: { id: 'MLB1' } }]);
    const antigo = [{ code: 404, body: { id: 'MLB9', message: 'x' } }];
    expect(comoEnvelopeAntigo(antigo, ['MLB9'])).toEqual(antigo);
  });
  it('não-array volta INTACTO (preserva TypeError/vazio de cada módulo)', () => {
    const obj = { message: 'erro' };
    expect(comoEnvelopeAntigo(obj, ['MLB1'])).toBe(obj);
    expect(comoEnvelopeAntigo(null, ['MLB1'])).toBeNull();
    expect(comoEnvelopeAntigo('x', ['MLB1'])).toBe('x');
  });
  it('entrada que não é objeto volta intacta na posição', () => {
    expect(comoEnvelopeAntigo([null, 5], ['MLB1', 'MLB2'])).toEqual([null, 5]);
  });
  it('body que já existe nunca é trocado, mesmo sem id', () => {
    expect(comoEnvelopeAntigo([{ status_code: 500, body: { message: 'x' } }], ['MLB1']))
      .toEqual([{ code: 500, body: { message: 'x' } }]);
  });
});
```

No teste `it.each`, os fixtures de kit, catálogo e relacionados não têm o 404, então `pedidos` usa os ids sem o inválido. Nos demais, a última posição é o 404.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test supabase/functions/_shared/ml/__tests__/multiget.test.ts`
Expected: FAIL (`Failed to resolve import "../multiget.ts"`).

- [ ] **Step 4: Implementar**

`supabase/functions/_shared/ml/multiget.ts`:

```ts
// Multiget de anúncios do ML via `/items/bulk` (`/items?ids=` sai do ar em 25/10/2026, ADR-0177).
// ADAPTADOR, não parser: devolve a resposta no envelope antigo para que nenhum módulo mude
// predicado, laço ou tratamento de erro. Contrato medido em 03/10/2026 (spec §2):
// - seleção com `status_code` + `body.<campo>`; sem `status_code` o envelope perde o código;
// - id repetido → 400 no lote inteiro (o antigo deduplicava antes do limite de 20);
// - id inexistente → `{status_code:404}` SEM body, na posição do id pedido.

const unicos = (ids: readonly string[]): string[] => [...new Set(ids)];

/** Caminho relativo do bulk. Dedup só dentro da requisição; não divide, não filtra, não lança. */
export function caminhoMultiget(ids: readonly string[], campos: string, extra = ''): string {
  const sel = campos.split(',').map((c) => `body.${c}`).join(',');
  return `/items/bulk?ids=${unicos(ids).map(encodeURIComponent).join(',')}&attributes=status_code,${sel}${extra}`;
}

/** Resposta do bulk → envelope antigo `[{code, body}]`. Não-array volta intacto. */
export function comoEnvelopeAntigo(json: unknown, idsPedidos: readonly string[]): unknown {
  if (!Array.isArray(json)) return json;
  const enviados = unicos(idsPedidos);
  const alinhado = json.length === enviados.length;
  return json.map((e, i) => {
    if (!e || typeof e !== 'object') return e;
    const { status_code, code, body, ...resto } = e as Record<string, unknown>;
    void resto; // `id` de topo (bulk sem attributes=) não existe no envelope antigo
    const out: Record<string, unknown> = { code: code ?? status_code };
    if (body !== undefined) out.body = body;
    else if (alinhado) out.body = { id: enviados[i] };
    return out;
  });
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test supabase/functions/_shared/ml/__tests__/multiget.test.ts` → PASS.

- [ ] **Step 6: Guarda com replay + testes**

`$CLAUDE_JOB_DIR/tmp/ab/guarda.ts`:

```ts
// Guarda do A/B. Fase 'gravar': GET em api.mercadolibre.com vai à rede e é gravado. Fase 'replay':
// GET que não é multiget sai da gravação (faltou → erro), multiget vai à rede. Em qualquer fase,
// escrita só por rota prevista (resposta simulada, sem rede); qualquer outra escrita ou host → erro.
export type Gravacao = { metodo: string; url: string; status: number; corpo: string };
export type Escrita = { metodo: string; url: string; corpo: string | null };
export type ChamadaGet = { url: string; status: number };
const MULTIGET = /\/items(\/bulk)?\?ids=/;

export function criarGuarda(opts: {
  fase: 'gravar' | 'replay';
  gravadas?: Gravacao[];
  fetchReal?: typeof fetch;
}) {
  const fetchReal = opts.fetchReal ?? globalThis.fetch.bind(globalThis);
  const fila = new Map<string, Gravacao[]>();
  for (const g of opts.gravadas ?? []) fila.set(g.url, [...(fila.get(g.url) ?? []), g]);
  const gravacoes: Gravacao[] = [];
  const escritas: Escrita[] = [];
  const gets: ChamadaGet[] = [];
  const fetchGuardado = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const u = new URL(req.url);
    if (u.protocol !== 'https:' || u.hostname !== 'api.mercadolibre.com' || (u.port && u.port !== '443')) {
      throw new Error(`GUARDA: destino proibido ${u.origin}`);
    }
    if (req.method !== 'GET') {
      const corpo = req.body ? await req.text() : null;
      escritas.push({ metodo: req.method, url: req.url, corpo });
      if (req.method === 'PUT' && /^\/items\/MLB[0-9]+$/.test(u.pathname)) {
        return new Response(JSON.stringify({ id: u.pathname.split('/')[2], ...(corpo ? JSON.parse(corpo) : {}) }), { status: 200 });
      }
      throw new Error(`GUARDA: escrita não prevista ${req.method} ${u.pathname}`);
    }
    if (opts.fase === 'replay' && !MULTIGET.test(req.url)) {
      const g = fila.get(req.url)?.shift();
      if (!g) throw new Error(`GUARDA: GET sem gravação no replay ${req.url}`);
      gets.push({ url: req.url, status: g.status });
      return new Response(g.corpo, { status: g.status });
    }
    const r = await fetchReal(req);
    const corpo = await r.text();
    gets.push({ url: req.url, status: r.status });
    if (r.status === 401 || r.status === 403) throw new Error(`GUARDA: HTTP ${r.status} (token expirado? não renovar) ${u.pathname}`);
    if (!MULTIGET.test(req.url)) gravacoes.push({ metodo: 'GET', url: req.url, status: r.status, corpo });
    return new Response(corpo, { status: r.status, headers: r.headers });
  };
  const sobras = () => [...fila.values()].flat().map((g) => g.url);
  return { fetchGuardado, gravacoes, escritas, gets, sobras };
}
```

`$CLAUDE_JOB_DIR/tmp/ab/guarda.test.ts`:

```ts
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { criarGuarda } from './guarda.ts';

function espiao() {
  const vistos: Array<{ metodo: string; url: string }> = [];
  const f = ((input: RequestInfo | URL, init?: RequestInit) => {
    const r = new Request(input, init);
    vistos.push({ metodo: r.method, url: r.url });
    return Promise.resolve(new Response('[]', { status: 200 }));
  }) as typeof fetch;
  return { f, vistos };
}

Deno.test('GET no ML é encaminhado ao fetch real e gravado (exceto multiget)', async () => {
  const { f, vistos } = espiao();
  const g = criarGuarda({ fase: 'gravar', fetchReal: f });
  await g.fetchGuardado('https://api.mercadolibre.com/items/MLB1?attributes=id');
  await g.fetchGuardado('https://api.mercadolibre.com/items/bulk?ids=MLB1&attributes=status_code,body.id');
  assertEquals(vistos.map((v) => v.metodo), ['GET', 'GET']);
  assertEquals(g.gravacoes.map((x) => x.url), ['https://api.mercadolibre.com/items/MLB1?attributes=id']);
});
Deno.test('PUT por string, Request e init.method nunca chega ao fetch real', async () => {
  const { f, vistos } = espiao();
  const g = criarGuarda({ fase: 'gravar', fetchReal: f });
  await g.fetchGuardado('https://api.mercadolibre.com/items/MLB1', { method: 'PUT', body: '{"status":"paused"}' });
  await g.fetchGuardado(new Request('https://api.mercadolibre.com/items/MLB2', { method: 'PUT', body: '{"status":"active"}' }));
  await g.fetchGuardado(new Request('https://api.mercadolibre.com/items/MLB3'), { method: 'PUT', body: '{}' });
  assertEquals(vistos, []);
  assertEquals(g.escritas.map((e) => [e.metodo, e.url, e.corpo]), [
    ['PUT', 'https://api.mercadolibre.com/items/MLB1', '{"status":"paused"}'],
    ['PUT', 'https://api.mercadolibre.com/items/MLB2', '{"status":"active"}'],
    ['PUT', 'https://api.mercadolibre.com/items/MLB3', '{}'],
  ]);
});
Deno.test('POST/DELETE ou PUT fora da rota prevista → erro, sem rede', async () => {
  const { f, vistos } = espiao();
  const g = criarGuarda({ fase: 'gravar', fetchReal: f });
  await assertRejects(() => g.fetchGuardado('https://api.mercadolibre.com/items', { method: 'POST', body: '{}' }), Error, 'não prevista');
  await assertRejects(() => g.fetchGuardado('https://api.mercadolibre.com/items/MLB1', { method: 'DELETE' }), Error, 'não prevista');
  await assertRejects(() => g.fetchGuardado('https://api.mercadolibre.com/items/MLB1/description', { method: 'PUT', body: '{}' }), Error, 'não prevista');
  assertEquals(vistos, []);
});
Deno.test('outro host, http ou outra porta → erro, sem rede', async () => {
  const { f, vistos } = espiao();
  const g = criarGuarda({ fase: 'gravar', fetchReal: f });
  for (const u of ['https://example.com/', 'http://api.mercadolibre.com/items/MLB1', 'https://api.mercadolibre.com:8443/x']) {
    await assertRejects(() => g.fetchGuardado(u), Error, 'destino proibido');
  }
  assertEquals(vistos, []);
});
Deno.test('replay: GET não-multiget vem da gravação, sem rede; sobra é detectável; faltante → erro', async () => {
  const { f, vistos } = espiao();
  const g = criarGuarda({ fase: 'replay', fetchReal: f, gravadas: [
    { metodo: 'GET', url: 'https://api.mercadolibre.com/a', status: 200, corpo: '{"x":1}' },
    { metodo: 'GET', url: 'https://api.mercadolibre.com/b', status: 200, corpo: '{}' },
  ] });
  assertEquals(await (await g.fetchGuardado('https://api.mercadolibre.com/a')).json(), { x: 1 });
  assertEquals(vistos, []);
  assertEquals(g.sobras(), ['https://api.mercadolibre.com/b']);
  await assertRejects(() => g.fetchGuardado('https://api.mercadolibre.com/a'), Error, 'sem gravação');
  await g.fetchGuardado('https://api.mercadolibre.com/items/bulk?ids=MLB1&attributes=status_code,body.id');
  assertEquals(vistos.length, 1); // só o multiget foi à rede
});
Deno.test('401/403 encerra (token não é renovado)', async () => {
  const f = (() => Promise.resolve(new Response('{}', { status: 401 }))) as typeof fetch;
  const g = criarGuarda({ fase: 'gravar', fetchReal: f });
  await assertRejects(() => g.fetchGuardado('https://api.mercadolibre.com/items/MLB1'), Error, 'HTTP 401');
});
```

Run: `deno test --no-prompt --allow-read $CLAUDE_JOB_DIR/tmp/ab/guarda.test.ts` (sem `--allow-net`)
Expected: 6 passed.

- [ ] **Step 7: Cenários, runner e canonização**

`$CLAUDE_JOB_DIR/tmp/ab/ab.ts`. Roda **uma** fase de **uma** árvore para **uma** org e escreve JSON em stdout:

```ts
import { criarGuarda, type Gravacao } from './guarda.ts';
import { CENARIOS } from './cenarios.ts';

const fase = Deno.env.get('AB_FASE') as 'gravar' | 'replay';
const arquivoGravadas = Deno.env.get('AB_GRAVADAS');
const gravadas: Gravacao[] = fase === 'replay' ? JSON.parse(await Deno.readTextFile(arquivoGravadas!)) : [];
const guarda = criarGuarda({ fase, gravadas });
globalThis.fetch = guarda.fetchGuardado as typeof fetch; // ANTES de qualquer import do app

const ctx = {
  arvore: Deno.env.get('AB_ARVORE')!,
  token: Deno.env.get('ML_TOKEN')!,
  amostra: JSON.parse(Deno.env.get('AB_AMOSTRA')!),
  imp: (p: string) => import(`file://${Deno.env.get('AB_ARVORE')}/${p}`),
  escritas: guarda.escritas,
};
const fatia = Deno.args[0];
const resultado: Record<string, unknown> = {};
for (const c of CENARIOS[fatia]) {
  try { resultado[c.nome] = { ok: true, valor: c.canon(await c.rodar(ctx)) }; }
  catch (e) { resultado[c.nome] = { ok: false, erro: (e as Error).message.replace(/MLB\d+/g, 'MLB#').slice(0, 300) }; }
}
if (fase === 'gravar' && arquivoGravadas) await Deno.writeTextFile(arquivoGravadas, JSON.stringify(guarda.gravacoes));
console.log(JSON.stringify({
  resultado,
  escritas: guarda.escritas,
  sobras: fase === 'replay' ? guarda.sobras() : [],
  getsComErro: guarda.gets.filter((g) => g.status >= 400 && g.status !== 404),
}));
```

`$CLAUDE_JOB_DIR/tmp/ab/cenarios.ts`. Um cenário = `{ nome, rodar, canon, positivo, esperaErro? }`:

```ts
type Ctx = {
  arvore: string; token: string; imp: (p: string) => Promise<any>;
  escritas: Array<{ metodo: string; url: string; corpo: string | null }>;
  amostra: { ids: string[]; catalogo: string[]; kits: string[]; sellerId: string; skuPorItem: Record<string, string> };
};
export type Cenario = {
  nome: string; rodar: (c: Ctx) => Promise<unknown>; canon: (v: unknown) => unknown;
  positivo: (v: any) => boolean; esperaErro?: boolean;
};

const ord = (x: unknown): unknown =>
  x instanceof Map ? ord(Object.fromEntries([...x.entries()]))
  : Array.isArray(x) ? x.map(ord)
  : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, ord(v)]))
  : x;
const estrito = (v: unknown) => ord(v);
/** Multiconjunto (spec §4.3): ordena por chave estável SEM remover repetidos. */
const multiconjunto = (chave: (x: any) => string) => (v: unknown) =>
  (ord(v) as any[]).slice().sort((a, b) => (chave(a) < chave(b) ? -1 : chave(a) > chave(b) ? 1 : 0));
const bloco20 = (xs: string[]) => xs.slice(0, 20);
const comRepetidos = (xs: string[]) => [...xs, xs[0], xs[1]]; // repetidos dentro E entre blocos
const INVALIDO = 'MLB0000000001';

export const CENARIOS: Record<string, Cenario[]> = {
  F1: [
    { nome: 'lerStatus', canon: estrito,
      rodar: async (c) => (await c.imp('_shared/canais/mercado-livre.ts')).mercadoLivreConnector
        .lerStatus({ getToken: async () => c.token }, comRepetidos([...c.amostra.ids, ...c.amostra.catalogo, INVALIDO])),
      positivo: (v) => Object.values(v).some((s: any) => s.status !== 'indisponivel') && v[INVALIDO]?.status === 'indisponivel' },
    { nome: 'propagarPausar', canon: estrito,
      rodar: async (c) => {
        const { propagarStatusRelacionadosML } = await c.imp('_shared/ml/atualizar-item.ts');
        const out: Record<string, unknown> = {};
        for (const id of c.amostra.catalogo) {
          const antes = c.escritas.length;
          try { await propagarStatusRelacionadosML(c.token, id, 'paused'); out[id] = { escritas: c.escritas.slice(antes) }; }
          catch (e) { out[id] = { erro: (e as Error).message }; }
        }
        return out;
      },
      positivo: (v) => Object.keys(v).length === 0 || Object.values(v).some((r: any) => r.escritas) },
    { nome: 'propagarAtivar', canon: estrito,
      rodar: async (c) => {
        const { propagarStatusRelacionadosML } = await c.imp('_shared/ml/atualizar-item.ts');
        const out: Record<string, unknown> = {};
        for (const id of c.amostra.catalogo) {
          const antes = c.escritas.length;
          try { await propagarStatusRelacionadosML(c.token, id, 'active'); out[id] = { escritas: c.escritas.slice(antes) }; }
          catch (e) { out[id] = { erro: (e as Error).message }; }
        }
        return out;
      },
      positivo: (v) => Object.keys(v).length === 0 || Object.values(v).some((r: any) => r.escritas) },
    { nome: 'buscarItemPorSku', canon: estrito,
      rodar: async (c) => {
        const { buscarItemPorSku } = await c.imp('_shared/ml/buscar-item.ts');
        const out: Record<string, unknown> = {};
        for (const [item, sku] of Object.entries(c.amostra.skuPorItem).slice(0, 3)) {
          const det = await (await fetch(`https://api.mercadolibre.com/items/${item}?attributes=id,category_id,family_name`,
            { headers: { Authorization: `Bearer ${c.token}` } })).json();
          if (!det.family_name) continue;
          out[item] = await buscarItemPorSku(fetch, { accessToken: c.token, sellerId: c.amostra.sellerId,
            categoriaId: det.category_id, familyName: det.family_name, desdeMs: 0 }, sku);
        }
        return out;
      },
      positivo: (v) => Object.keys(v).length === 0 || Object.values(v).some((r: any) => r && r.tipo !== 'nenhum') },
  ],
  F2: [
    { nome: 'gtinsPedidos', canon: estrito,
      rodar: async (c) => (await c.imp('_shared/ml/pedidos.ts')).buscarGtinsDosItens(c.token, comRepetidos([...c.amostra.ids, INVALIDO])),
      positivo: (v) => Object.keys(v).length > 0 },
    { nome: 'titulosEGtins', canon: estrito,
      rodar: async (c) => (await c.imp('_shared/ml/vendas.ts')).buscarTitulosEGtins(c.token, comRepetidos([...c.amostra.ids, INVALIDO]), AbortSignal.timeout(60_000)),
      positivo: (v) => Object.keys(v.titulos).length > 0 },
  ],
  F3: [
    { nome: 'listingTypes', canon: estrito,
      rodar: async (c) => (await c.imp('_shared/ml/kit-virtual.ts')).buscarListingTypeItensML(c.token, comRepetidos([...c.amostra.ids, ...c.amostra.kits, INVALIDO])),
      positivo: (v) => Object.keys(v).length > 0 },
    { nome: 'componentes', canon: multiconjunto((x) => x.itemId),
      rodar: async (c) => (await c.imp('buscar-componentes-kit-virtual/leitura-ml.ts')).buscarUserProductIdsML(c.token, comRepetidos([...c.amostra.ids, INVALIDO])),
      positivo: (v) => v.length > 0 },
  ],
  F4: [
    { nome: 'promocoesItens', canon: estrito,
      rodar: async (c) => { const m = await c.imp('_shared/promocoes/ml.ts'); return m.buscarItensML(m.criarGetJson(c.token), comRepetidos([...c.amostra.ids, INVALIDO])); },
      positivo: (v) => Object.keys(v).length > 0 },
    { nome: 'lerRelacoes', canon: estrito,
      rodar: async (c) => {
        const cli = (await c.imp('_shared/operacoes/ml.ts')).criarClienteML(c.token);
        const out: Record<string, unknown> = {};
        for (const id of c.amostra.catalogo) { try { out[id] = await cli.lerRelacoes(id); } catch (e) { out[id] = { erro: (e as Error).message }; } }
        return out;
      },
      positivo: (v) => Object.keys(v).length === 0 || Object.values(v).some((r: any) => !r.erro) },
    { nome: 'detalharItens', canon: multiconjunto((x) => x.id),
      rodar: async (c) => (await c.imp('_shared/ml/varrer-itens.ts')).detalharItens(fetch, c.token, comRepetidos([...c.amostra.ids, INVALIDO])),
      positivo: (v) => v.length > 0 },
    { nome: 'descobrirFamiliaUP', canon: (v: any) => ord(v?.porCor ? { ...v, porCor: Object.fromEntries(Object.entries(v.porCor).map(([k, a]: any) => [k, [...a].sort()])) } : v),
      rodar: async (c) => {
        const { descobrirFamiliaUP } = await c.imp('_shared/ml/descobrir-familia-up.ts');
        const out: Record<string, unknown> = {};
        for (const item of c.amostra.ids.slice(0, 3)) {
          const det = await (await fetch(`https://api.mercadolibre.com/items/${item}?attributes=id,title,category_id`,
            { headers: { Authorization: `Bearer ${c.token}` } })).json();
          out[item] = await descobrirFamiliaUP(fetch, { getToken: async () => c.token, sellerId: c.amostra.sellerId,
            titulo: det.title, categoriaId: det.category_id, itemMortoId: 'MLB0' });
        }
        return out;
      },
      positivo: () => true }, // o critério é o A/B estrito; "nenhuma" é legítimo
  ],
  F5: [
    { nome: 'situacaoPulse', canon: estrito,
      rodar: async (c) => (await c.imp('pulse-coletar/processar.ts')).lerSituacaoAnuncios([...new Set([...c.amostra.ids, INVALIDO])], c.token),
      positivo: (v) => Object.keys(v).length > 0 },
    { nome: 'coresPxV', canon: estrito,
      rodar: async (c) => (await c.imp('acompanhar-migracao-pxv/leitura-ml.ts')).lerCoresML(c.token, comRepetidos([...bloco20(c.amostra.ids).slice(0, 17), INVALIDO])),
      positivo: (v) => Object.keys(v).length > 0 },
    { nome: 'estoqueVivoPxV', canon: estrito,
      rodar: async (c) => (await c.imp('acompanhar-migracao-pxv/leitura-ml.ts')).lerEstoqueVivoML(c.token, comRepetidos([...bloco20(c.amostra.ids).slice(0, 17), INVALIDO])),
      positivo: (v) => Object.keys(v).length > 0 },
    { nome: 'coresPxV21distintos', canon: estrito, esperaErro: true,
      rodar: async (c) => (await c.imp('acompanhar-migracao-pxv/leitura-ml.ts')).lerCoresML(c.token, [...c.amostra.ids.slice(0, 21)]),
      positivo: () => true },
  ],
};
```

O `descobrirFamiliaUP` exige mais campos em `CriteriosDescoberta` do que os mostrados. Na execução, ler a interface (`_shared/ml/descobrir-familia-up.ts:54-70`) e preencher **todos** os campos obrigatórios com valores reais do item. Se faltar um campo real, o cenário falha alto, nunca usa valor inventado.

`$CLAUDE_JOB_DIR/tmp/ab/rodar.py <fatia> <arvore_base> <arvore_nova>` reaproveita `sql()` de `spike_bulk.py`:

```python
import json, os, subprocess, sys, pathlib
sys.path.insert(0, '/Users/diego/.claude/jobs/b87cbc02/tmp')
import spike_bulk as s
AB = pathlib.Path('/Users/diego/.claude/jobs/b87cbc02/tmp/ab'); (AB / 'out').mkdir(exist_ok=True)
fatia, base, nova = sys.argv[1], sys.argv[2], sys.argv[3]
ORGS_ESPERADAS = {'Avil', 'DSA', 'Daludi Shop', 'Hairfly Cosmeticos'}

def rodar(arvore, fase, gravadas, tok, amostra):
    env = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'], 'ML_TOKEN': tok, 'AB_ARVORE': arvore,
           'AB_AMOSTRA': json.dumps(amostra), 'AB_FASE': fase, 'AB_GRAVADAS': str(gravadas)}
    p = subprocess.run(['deno', 'run', '--no-prompt', '--allow-net=api.mercadolibre.com:443', '--allow-read',
                        f'--allow-write={gravadas}', '--allow-env', str(AB / 'ab.ts'), fatia],
                       env=env, capture_output=True, text=True, timeout=900)
    if p.returncode != 0:
        raise SystemExit(f'deno falhou ({fase}): {p.stderr[-1500:]}')
    return json.loads(p.stdout.strip().splitlines()[-1])

orgs = s.sql("select o.id, o.nome, c.id as cx, c.conta_externa_id as seller from public.organizations o "
             "join public.marketplace_connections c on c.org_id=o.id and c.canal::text ilike '%livre%'")
faltando = ORGS_ESPERADAS - {o['nome'] for o in orgs}
if faltando: raise SystemExit(f'orgs faltando: {faltando}')
falhas = []
for org in orgs:
    tok = s.sql(f"select access_token from public.get_connection_tokens('{org['cx']}'::uuid)")[0]['access_token']
    pares = s.sql(f"select a.item_externo_id as item, e.k as sku from public.anuncios_externos a, jsonb_each(a.variacoes_externas) e(k, v) "
                  f"where a.org_id='{org['id']}' and a.status='publicado' and a.item_externo_id like 'MLB%' order by md5(a.item_externo_id) limit 60")
    amostra = {
        'ids': list(dict.fromkeys(p['item'] for p in pares))[:40],
        'skuPorItem': {p['item']: p['sku'] for p in pares},
        'catalogo': [r['x'] for r in s.sql(f"select distinct v->>'catalog_listing_id' as x from public.anuncios_externos a, jsonb_each(a.variacoes_externas) e(k,v) where a.org_id='{org['id']}' and v->>'catalog_listing_id' like 'MLB%' limit 5")],
        'kits': [r['ml_item_id'] for r in s.sql(f"select ml_item_id from public.kits_virtuais where org_id='{org['id']}' and ml_item_id is not null limit 5")],
        'sellerId': str(org['seller']),
    }
    if len(amostra['ids']) < 21: falhas.append(f"{org['nome']}: amostra com {len(amostra['ids'])} ids (<21)"); continue
    grav = AB / 'out' / f"{fatia}-{org['nome'].replace(' ', '_')}-gravadas.json"
    a = rodar(base, 'gravar', grav, tok, amostra)
    b = rodar(nova, 'replay', grav, tok, amostra)
    del tok
    nome = org['nome'].replace(' ', '_')
    for lado, r in (('A', a), ('B', b)): (AB / 'out' / f'{fatia}-{nome}-{lado}.json').write_text(json.dumps(r, ensure_ascii=False, indent=1))
    problemas = []
    if b['sobras']: problemas.append(f"gravações não consumidas: {b['sobras'][:3]}")
    if a['getsComErro'] or b['getsComErro']: problemas.append(f"HTTP inesperado: {(a['getsComErro'] + b['getsComErro'])[:3]}")
    if a['escritas'] != b['escritas']: problemas.append('escritas simuladas diferentes')
    for cen, ra in a['resultado'].items():
        rb = b['resultado'].get(cen)
        if ra != rb: problemas.append(f'{cen}: A≠B')
    if problemas:  # A' para separar mudança de preço/estoque entre as fases
        tok = s.sql(f"select access_token from public.get_connection_tokens('{org['cx']}'::uuid)")[0]['access_token']
        a2 = rodar(base, 'replay', grav, tok, amostra); del tok
        (AB / 'out' / f'{fatia}-{nome}-A2.json').write_text(json.dumps(a2, ensure_ascii=False, indent=1))
        deriva = all(a2['resultado'].get(c) == b['resultado'].get(c) for c in a['resultado']) and a2['escritas'] == b['escritas']
        problemas.append('(A\'==B: deriva de dados ao vivo; repetir)' if deriva else '(A\'≠B: diferença real)')
    print(f"{org['nome']}: ids={len(amostra['ids'])} catalogo={len(amostra['catalogo'])} kits={len(amostra['kits'])} → "
          f"{'IDÊNTICO' if not problemas else ' | '.join(problemas)}")
    falhas += [f"{org['nome']}: {p}" for p in problemas]
sys.exit(1 if falhas else 0)
```

A cobertura positiva e o `esperaErro` são checados por `cenarios.ts` depois de cada fase. Acrescentar ao fim do laço em `ab.ts`:

```ts
for (const c of CENARIOS[fatia]) {
  const r = resultado[c.nome] as { ok: boolean; valor?: unknown };
  if (c.esperaErro ? r.ok : !r.ok || !c.positivo(r.valor)) {
    console.error(`COBERTURA: cenário ${c.nome} ${c.esperaErro ? 'devia falhar' : 'sem resultado positivo'}`);
    Deno.exit(3);
  }
}
```

Esse bloco fica **antes** do `console.log` final. A amostra é a mesma nas duas fases, então um cenário que lança na baseline e na nova com a mesma mensagem conta como equivalente só quando `esperaErro: true`. Nos demais casos, lançar reprova.

- [ ] **Step 8: Edges afetadas (caminho decodificado) e manifesto**

`$CLAUDE_JOB_DIR/tmp/edges_afetadas.py`:

```python
import json, pathlib, subprocess, sys
from urllib.parse import urlparse, unquote
FN = pathlib.Path('/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/verif-items-bulk/supabase/functions')
alvos = {(FN / a).resolve() for a in sys.argv[1:]}
assert alvos and all(p.exists() for p in alvos), f'alvo inexistente: {[str(p) for p in alvos if not p.exists()]}'
afetadas = []
for idx in sorted(FN.glob('*/index.ts')):
    if idx.parent.name.startswith('_'): continue
    p = subprocess.run(['deno', 'info', '--json', str(idx)], capture_output=True, text=True, timeout=180)
    if p.returncode != 0: raise SystemExit(f'deno info falhou em {idx.parent.name}: {p.stderr[-300:]}')
    g = json.loads(p.stdout)
    erros = [m for m in g['modules'] if m.get('error') and m['specifier'].startswith('file:')]
    if erros: raise SystemExit(f'grafo com erro em {idx.parent.name}: {erros[:1]}')
    locais = {pathlib.Path(unquote(urlparse(m['specifier']).path)).resolve() for m in g['modules'] if m['specifier'].startswith('file:')}
    if locais & alvos: afetadas.append(idx.parent.name)
if not afetadas: raise SystemExit('lista de edges VAZIA: recusado (não deployar)')
print(len(afetadas)); print(' '.join(afetadas))
```

Sanidade, obrigatória antes do 1º uso:
- `python3 $CLAUDE_JOB_DIR/tmp/edges_afetadas.py _shared/trafego/fiacao.ts` precisa listar `coletar-trafego-ml`;
- `python3 $CLAUDE_JOB_DIR/tmp/edges_afetadas.py _shared/canais/mercado-livre.ts` precisa listar `status-publicados` e `sincronizar-estoque`.

`$CLAUDE_JOB_DIR/tmp/manifesto.py` tem os modos `conferir <SHA> <edges…>`, `antes <fatia> <SHA> <edges…>` e `depois <fatia> <SHA> <edges…>`:

```python
import hashlib, json, pathlib, subprocess, sys, shutil
REF = 'txvncrgkoynoxwopfkbp'
TMP = pathlib.Path('/Users/diego/.claude/jobs/b87cbc02/tmp')
WT = '/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/verif-items-bulk'
modo = sys.argv[1]
fatia, sha, edges = (('-', sys.argv[2], sys.argv[3:]) if modo == 'conferir' else (sys.argv[2], sys.argv[3], sys.argv[4:]))
assert edges, 'sem edges'

def baixar(edge, destino):
    shutil.rmtree(destino, ignore_errors=True); (destino / 'supabase').mkdir(parents=True)
    p = subprocess.run(['supabase', 'functions', 'download', edge, '--project-ref', REF, '--use-api', '--workdir', str(destino)],
                       capture_output=True, text=True, timeout=300)
    if p.returncode != 0: raise SystemExit(f'download {edge}: {p.stderr[-300:]}')

def no_sha(caminho_rel):
    p = subprocess.run(['/usr/bin/git', 'show', f'{sha}:{caminho_rel}'], cwd=WT, capture_output=True)
    return hashlib.sha256(p.stdout).hexdigest() if p.returncode == 0 else None

lista = json.loads(subprocess.run(['supabase', 'functions', 'list', '--project-ref', REF, '-o', 'json'],
                                  capture_output=True, text=True, timeout=120).stdout)
info = {f['slug']: {'versao': f.get('version'), 'verify_jwt': f.get('verify_jwt')} for f in lista}
manif, divergencias = {}, []
for edge in edges:
    destino = TMP / 'dl' / f'{fatia}-{modo}' / edge
    baixar(edge, destino)
    arquivos = sorted(p for p in (destino / 'supabase' / 'functions').rglob('*') if p.is_file())
    if not any(a.parent.name == edge and a.name == 'index.ts' for a in arquivos): divergencias.append(f'{edge}: download sem index.ts')
    for a in arquivos:
        rel = 'supabase/functions/' + str(a.relative_to(destino / 'supabase' / 'functions'))
        if hashlib.sha256(a.read_bytes()).hexdigest() != no_sha(rel): divergencias.append(f'{edge}: {rel}')
    manif[edge] = {**info.get(edge, {}), 'arquivos': len(arquivos)}
(TMP / f'manifesto-{fatia}-{modo}.json').write_text(json.dumps({'sha': sha, 'edges': manif}, indent=1))
if modo == 'depois':
    antes = json.loads((TMP / f'manifesto-{fatia}-antes.json').read_text())['edges']
    for e in edges:
        if manif[e]['verify_jwt'] != antes[e]['verify_jwt']: divergencias.append(f'{e}: verify_jwt mudou')
        if not (manif[e]['versao'] or 0) > (antes[e]['versao'] or 0): divergencias.append(f'{e}: versão não incrementou')
print(json.dumps(manif, indent=1)); print('DIVERGÊNCIAS:', divergencias or 'nenhuma')
sys.exit(1 if divergencias else 0)
```

Sanidade, obrigatória antes do 1º uso: `python3 $CLAUDE_JOB_DIR/tmp/manifesto.py conferir 3b68f702 coletar-trafego-ml`. O resultado esperado é "nenhuma" divergência, ou divergências explicáveis por um commit da `main` posterior ao deploy daquela edge. Nesse caso, achar o SHA que bate (`git log -- supabase/functions/coletar-trafego-ml supabase/functions/_shared/trafego`) e anotar.

- [ ] **Step 9: ADR-0177**

Antes de escrever, rodar `/usr/bin/git fetch origin` e `/usr/bin/git ls-tree --name-only origin/main docs/decisions/ | sort | tail -3`. Se a 0177 já existir, usar o próximo número livre em todo lugar.

`docs/decisions/0177-multiget-ml-items-bulk.md`:

```markdown
# ADR-0177 — Multiget do Mercado Livre via `/items/bulk`

**Status:** Aceito (2026-10-03). **Prazo externo:** o ML desliga `GET /items?ids=` em 25/10/2026.

## Contexto
14 chamadas em 13 arquivos usavam `/items?ids=`. O substituto `GET /items/bulk?ids=` muda o
envelope (`status_code` no lugar de `code`). Os spikes reais de 03/10/2026 (4 orgs, só GET) mediram:
- bodies idênticos ao endpoint antigo;
- seleção com `status_code` e prefixo `body.`;
- id repetido → HTTP 400 no lote inteiro (o antigo deduplicava antes do limite);
- 21 ids → 400;
- id inexistente → `{status_code:404}` SEM body, na posição pedida;
- ordem dos envelopes = a pedida (a do antigo era arbitrária).

## Decisão
- **Adaptador, não parser:** `_shared/ml/multiget.ts`.
  - `caminhoMultiget` monta a URL com dedup só dentro da requisição.
  - `comoEnvelopeAntigo` converte a resposta no envelope antigo `[{code, body}]` e recoloca o id do 404 pela posição.
  - Nenhum módulo muda predicado, particionamento ou tratamento de erro.
- Leituras inline (componentes de kit, PxV, Pulse) ganham uma extração mínima num commit separado, só para serem testáveis.
- `fiacao.ts` (primeiro módulo migrado, `6f8f6c9b`) não muda.
- Validação por fatia: testes com fixtures reais, A/B em duas fases contra a baseline (só GET ao vivo, escrita simulada) e deploy com manifesto de hash por edge.

## Consequências
- As decisões de negócio ficam equivalentes.
- A ordem das listas passa a seguir a ordem pedida, e logs que imprimem a URL mostram `/items/bulk`.
- Melhorias funcionais (mais de 20 ids onde não há blocos) ficam fora; continuam respondendo 400 como antes.
- Um módulo novo que precise de multiget usa o adaptador. Escrever `/items?ids=` à mão é regressão.
```

- [ ] **Step 10: Codex + commit da T0**

Run: `pnpm test supabase/functions/_shared/ml` → PASS. P-Revisão Codex (fatia T0, que inclui ferramental: mandar também `$CLAUDE_JOB_DIR/tmp/ab/*.ts`, `rodar.py`, `edges_afetadas.py` e `manifesto.py` no prompt).

```
/usr/bin/git add supabase/functions/_shared/ml/multiget.ts supabase/functions/_shared/ml/__tests__/multiget.test.ts supabase/functions/_shared/ml/__tests__/fixtures docs/decisions/0177-multiget-ml-items-bulk.md
/usr/bin/git commit -F $CLAUDE_JOB_DIR/tmp/msg-t0.txt
```

Mensagem: `feat(ml): adaptador /items/bulk → envelope antigo + fixtures reais + ADR-0177`. Sem deploy; o merge vai junto com a T1.

---

### Task T1 (F1): `lerStatus`, `buscar-item`, `atualizar-item`

**Files:**
- Modify: `_shared/canais/mercado-livre.ts:414-420`
- Modify: `_shared/ml/buscar-item.ts:79-83`
- Modify: `_shared/ml/atualizar-item.ts:183-184`
- Test: `_shared/canais/__tests__/mercado-livre.test.ts` (507-597), `_shared/ml/__tests__/buscar-item.test.ts`, `sincronizar-estoque/__tests__/processar.test.ts`

**Interfaces:** consome `caminhoMultiget` e `comoEnvelopeAntigo`. Nenhuma assinatura pública muda.

- [ ] **Step 1: Testes falhando**

Em `mercado-livre.test.ts`, depois do `describe('lerStatus — catalogForewarning (E5 fase3)')`:

```ts
import bulkCanais from '../../ml/__tests__/fixtures/bulk-canais-bulk.json' with { type: 'json' };
import antigoCanais from '../../ml/__tests__/fixtures/bulk-canais-antigo.json' with { type: 'json' };
import idsCanais from '../../ml/__tests__/fixtures/bulk-canais-ids.json' with { type: 'json' };

describe('lerStatus via /items/bulk (ADR-0177)', () => {
  const ctx = { getToken: async () => 't' };
  it('URL do bulk com os mesmos campos e mesmo resultado que o envelope antigo', async () => {
    const urls: string[] = [];
    globalThis.fetch = ((u: string) => { urls.push(u); return Promise.resolve(new Response(JSON.stringify(bulkCanais))); }) as typeof fetch;
    const novo = await mercadoLivreConnector.lerStatus(ctx, idsCanais as string[]);
    expect(urls).toEqual([`https://api.mercadolibre.com/items/bulk?ids=${(idsCanais as string[]).join(',')}&attributes=status_code,body.id,body.status,body.sub_status,body.available_quantity,body.price,body.listing_type_id,body.tags`]);
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify(antigoCanais)))) as typeof fetch;
    expect(novo).toEqual(await mercadoLivreConnector.lerStatus(ctx, idsCanais as string[]));
    expect(novo['MLB0000000001'].status).toBe('indisponivel');
  });
  it('id repetido no bloco: uma consulta, sem repetição na URL', async () => {
    const urls: string[] = [];
    globalThis.fetch = ((u: string) => { urls.push(u); return Promise.resolve(new Response('[]')); }) as typeof fetch;
    await mercadoLivreConnector.lerStatus(ctx, ['MLB1', 'MLB2', 'MLB1']);
    expect(new URL(urls[0]).searchParams.get('ids')).toBe('MLB1,MLB2');
  });
  it('mesmo id em dois blocos: 200 pausado no 1º, 404 sem body no 2º → indisponivel (igual ao antigo)', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `MLB${100 + i}`);
    globalThis.fetch = ((u: string) => {
      const q = new URL(u).searchParams.get('ids')!.split(',');
      if (q.length === 20) return Promise.resolve(new Response(JSON.stringify(q.map((id) => ({ status_code: 200, body: { id, status: 'paused', sub_status: [] } })))));
      return Promise.resolve(new Response(JSON.stringify(q.map(() => ({ status_code: 404 })))));
    }) as typeof fetch;
    const r = await mercadoLivreConnector.lerStatus(ctx, [...ids, ids[0]]);
    expect(r[ids[0]].status).toBe('indisponivel');
    expect(r[ids[1]].status).toBe('pausado');
  });
  it('pausado e preço chegam ao StatusCanal (alimentam reativação e faixa do split)', async () => {
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify([
      { status_code: 200, body: { id: 'MLB1', status: 'paused', sub_status: [], price: 49.9, available_quantity: 3 } },
    ])))) as typeof fetch;
    const r = await mercadoLivreConnector.lerStatus(ctx, ['MLB1']);
    expect(r.MLB1.status).toBe('pausado');
    expect(r.MLB1.preco).toBe(49.9);
  });
});
```

O valor esperado de `status` vem dos rótulos de `StatusCanal` em `_shared/ml/status.ts`. Conferir `'pausado'` e `'indisponivel'` com `grep -n "'pausado'\|'indisponivel'" _shared/ml/status.ts` antes de rodar.

A propagação (`describe('atualizarStatus propaga…')`, linhas 531-597) passa a rodar **nos dois envelopes**. Trocar `describe(` por `describe.each(['code', 'status_code'] as const)('atualizarStatus propaga… [%s]', (campo) => {`. Em `stubRelacionados`:

```ts
      if (url.includes('/items/MLB1?')) return json({ id: 'MLB1', item_relations: relacionados.map((r) => ({ id: r.id })) });
      if (campo === 'status_code') expect(url).toMatch(/\/items\/bulk\?ids=[^&]+&attributes=status_code,body\.id,body\.status,body\.sub_status$/);
      return json(relacionados.map((r) => (r.id === opts.ilegivel
        ? (campo === 'status_code' ? { status_code: 404 } : { code: 404, body: { message: 'not found' } })
        : { [campo]: 200, body: r })));
```

E acrescentar ao `describe.each`:

```ts
  it('mistos ao pausar: [ativo, ilegível] → PUT no ativo ANTES do 502 (comportamento atual, caracterizado)', async () => {
    const puts = stubRelacionados([{ id: 'MLB8', status: 'active' }, { id: 'MLB9', status: 'active' }], { ilegivel: 'MLB9' });
    const res = await mercadoLivreConnector.atualizarStatus(ctxFake, 'MLB1', 'pausado');
    expect(res.ok).toBe(false);
    expect(res.erro?.retentavel).toBe(true);
    expect(puts).toEqual(PUTS_ESPERADOS_MISTO_PAUSAR);
  });
  it('mistos ao reativar: [pausado, ativo] → só o pausado e o próprio item', async () => {
    const puts = stubRelacionados([{ id: 'MLB8', status: 'paused' }, { id: 'MLB9', status: 'active' }]);
    await mercadoLivreConnector.atualizarStatus(ctxFake, 'MLB1', 'ativo');
    expect(puts).toEqual([{ id: 'MLB8', status: 'active' }, { id: 'MLB1', status: 'active' }]);
  });
```

`PUTS_ESPERADOS_MISTO_PAUSAR` é caracterização. **Antes** de mudar o código de produção, rodar esse teste no envelope `code` com `expect(puts).toEqual([])` provisório, ler o valor real que falhou, fixar a constante com ele (`[{ id: 'MLB8', status: 'paused' }]` ou `[]`, conforme o código atual de `atualizar-item.ts:190-200`) e comentar a linha com a origem. Nunca ajustar o código de produção para casar com o teste.

Em `buscar-item.test.ts`, o `fakeFetch` (linhas 13-29) passa a atender as duas rotas, cada uma com seu envelope, e a registrar as URLs:

```ts
const vistos: string[] = [];
// Monta um fetch fake que responde à busca (paginada) e ao multiget (antigo /items?ids= ou /items/bulk?ids=).
function fakeFetch(searchPages: Array<{ results: string[]; total: number }>, itens: Record<string, unknown>): FetchLike {
  let page = 0;
  return (url: string) => {
    if (url.includes('/items/search')) {
      const p = searchPages[Math.min(page, searchPages.length - 1)];
      page++;
      const offsetMatch = /offset=(\d+)/.exec(url);
      const offset = offsetMatch ? Number(offsetMatch[1]) : 0;
      return resp({ results: p.results, paging: { total: p.total, offset, limit: 100 } });
    }
    const bulk = url.includes('/items/bulk?ids=');
    if (bulk || url.includes('/items?ids=')) {
      vistos.push(url);
      // ids únicos por requisição: é assim que os dois endpoints respondem
      const ids = [...new Set(decodeURIComponent(/ids=([^&]+)/.exec(url)![1]).split(','))];
      return resp(ids.map((id) => (itens[id]
        ? (bulk ? { status_code: 200, body: itens[id] } : { code: 200, body: itens[id] })
        : (bulk ? { status_code: 404 } : { code: 404, body: { id } }))));
    }
    return resp({}, false, 500);
  };
}
```

Testes novos no `describe` existente:

```ts
  it('multiget de adoção usa /items/bulk com os campos de validação', async () => {
    vistos.length = 0;
    const f = fakeFetch([{ results: ['MLB1'], total: 1 }], { MLB1: item() });
    expect(await buscarItemPorSku(f, CRIT, 's1')).toEqual({ tipo: 'um', itemExternoId: 'MLB1' });
    expect(vistos).toEqual(['https://api.mercadolibre.com/items/bulk?ids=MLB1&attributes=status_code,body.id,body.category_id,body.family_name,body.seller_id,body.date_created']);
  });

  it('mesmo id em dois blocos (20 distintos + o 1º repetido) → ambiguo, como no endpoint antigo', async () => {
    // O antigo deduplicava só DENTRO da requisição: o MLB1 válido aparece no bloco 1 e no bloco 2.
    // Caracterização confirmada pelo Codex na main (achado 5 da revisão do plano v1).
    const results = [...Array.from({ length: 20 }, (_, i) => `MLB${i + 1}`), 'MLB1'];
    const f = fakeFetch([{ results, total: 21 }], { MLB1: item() });
    expect(await buscarItemPorSku(f, CRIT, 's1')).toEqual({ tipo: 'ambiguo' });
  });
```

O segundo teste precisa **passar também antes** da mudança de produção, com o fake respondendo pela rota antiga, porque é caracterização. Rodá-lo no Step 2 e conferir que ele passa (ele não deve estar entre os que falham). Se falhar antes da mudança, o valor esperado está errado: ler o real e corrigir **o teste**.

Em `sincronizar-estoque/__tests__/processar.test.ts`, adicionar:

```ts
import { mercadoLivreConnector } from '../../_shared/canais/mercado-livre.ts';

describe('reativação com o lerStatus REAL lendo /items/bulk', () => {
  it.each([
    ['pausado no bulk → reativa', [{ status_code: 200, body: { id: 'FK1', status: 'paused', sub_status: [] } }], [{ itemExternoId: 'FK1', status: 'ativo' }]],
    ['404 sem body → não reativa', [{ status_code: 404 }], []],
  ])('%s', async (_n, resposta, esperado) => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = ((u: string) => Promise.resolve(new Response(JSON.stringify(u.includes('/items/bulk') ? resposta : {})))) as typeof fetch;
    try {
      fakeConnector.lerStatus = (ctx, ids) => mercadoLivreConnector.lerStatus(ctx, ids);
      await processarSincronizacao(deps(umAnuncio(7)), { ...JOB, reativar: true });
      expect(chamadasDeStatus()).toEqual(esperado);
    } finally { globalThis.fetch = fetchOriginal; }
  });
});
```

Adaptar a sobrescrita de `lerStatus` ao formato do `fakeConnector` do arquivo (ver `processar.test.ts`, onde o fake é criado). Se o fake não permitir sobrescrever, criar a variante com `{ ...fakeConnector, lerStatus: … }` passada pelo `getConnector` de `deps`.

- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm test supabase/functions/_shared/canais supabase/functions/_shared/ml supabase/functions/sincronizar-estoque` → FAIL nos novos.

- [ ] **Step 3: Implementar (só URL + adaptador)**

`mercado-livre.ts`, com o import `import { caminhoMultiget, comoEnvelopeAntigo } from '../ml/multiget.ts';`:

```ts
      const url = `https://api.mercadolibre.com${caminhoMultiget(bloco, 'id,status,sub_status,available_quantity,price,listing_type_id,tags')}`;
      try {
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok) { console.warn(`lerStatus ML ${resp.status} (bloco)`); return []; }
        const arr = comoEnvelopeAntigo(await resp.json(), bloco); // [{ code, body }] (ADR-0177)
        return Array.isArray(arr) ? arr : [];
```

O resto (linhas 421-435) não muda.

`buscar-item.ts`:

```ts
    const url = `${API}${caminhoMultiget(bloco, 'id,category_id,family_name,seller_id,date_created')}`;
    const resp = await fetchLike(url, { headers });
    if (!resp.ok) throw new Error(`multiget de adoção (${resp.status})`);
    const arr = comoEnvelopeAntigo(await resp.json(), bloco) as Array<{ code?: number; body?: ItemMultiget }>;
```

`atualizar-item.ts`:

```ts
  const multi = await fetch(`https://api.mercadolibre.com${caminhoMultiget(ids, 'id,status,sub_status')}`, { headers });
  const lote = comoEnvelopeAntigo(await multi.json().catch(() => null), ids);
```

Imports: `import { caminhoMultiget, comoEnvelopeAntigo } from './multiget.ts';` nos dois. **Nenhuma outra linha muda.**

- [ ] **Step 4: Rodar e ver passar.** Run: `pnpm test supabase/functions` → PASS. Depois `deno check` nos `index.ts` de `status-publicados`, `sincronizar-estoque`, `update-familia-ml`, `publicar-split-ml`, `monitorar-moderados` e `remover-publicado`.

- [ ] **Step 5: A/B `F1`** (P-A/B; baseline = commit da T0). Esperado: `IDÊNTICO` nas 4 orgs, com cobertura positiva verde.

- [ ] **Step 6: Varredura, commit, Codex e portão.**
  - `grep -n "items?ids=" <3 arquivos>` → vazio.
  - Commit `feat(ml): fatia 1 do /items/bulk — lerStatus, adoção e propagação de status`.
  - P-Revisão Codex.
  - P-Portão, com as edges de `edges_afetadas.py _shared/ml/multiget.ts _shared/canais/mercado-livre.ts _shared/ml/buscar-item.ts _shared/ml/atualizar-item.ts`.

- [ ] **Step 7: Deploy e observação** (P-Deploy, P-Observação).
  - A/B pós-deploy com o código baixado de `status-publicados` (cobre `lerStatus`) e de `update-familia-ml` (cobre `buscar-item` e `atualizar-item`).
  - Logs de `sincronizar-estoque`, `monitorar-moderados` e `status-publicados`.
  - Por id: amostra de 10 anúncios Avil; o status na tela Publicados (ou no A/B pós-deploy) é igual ao status na fase A.

---

### Task T2 (F2): `vendas.ts`, `pedidos.ts`

**Files:**
- Modify: `_shared/ml/vendas.ts:127` (`export`), `:139-142`
- Modify: `_shared/ml/pedidos.ts:35-38`
- Test: `_shared/ml/__tests__/vendas.test.ts`, **novo** `_shared/ml/__tests__/pedidos-gtin.test.ts`

- [ ] **Step 1: Testes falhando**

`_shared/ml/__tests__/pedidos-gtin.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buscarGtinsDosItens } from '../pedidos.ts';
import bulk from './fixtures/bulk-pedidos-pxv-cores-bulk.json' with { type: 'json' };
import antigo from './fixtures/bulk-pedidos-pxv-cores-antigo.json' with { type: 'json' };
import ids from './fixtures/bulk-pedidos-pxv-cores-ids.json' with { type: 'json' };
afterEach(() => vi.unstubAllGlobals());

describe('buscarGtinsDosItens via bulk', () => {
  it('URL do bulk e GTINs iguais aos do envelope antigo, nos mesmos ids', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return new Response(JSON.stringify(bulk)); }));
    const novo = await buscarGtinsDosItens('t', ids as string[]);
    expect(urls).toEqual([`https://api.mercadolibre.com/items/bulk?ids=${(ids as string[]).join(',')}&attributes=status_code,body.id,body.attributes`]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(antigo))));
    const velho = await buscarGtinsDosItens('t', ids as string[]);
    expect(novo).toEqual(velho);
    expect(Object.keys(novo).length).toBeGreaterThan(0);
  });
  it('bloco do meio com HTTP 500: os outros dois blocos sobrevivem com os GTINs certos', async () => {
    const todos = Array.from({ length: 45 }, (_, i) => `MLB${i}`);
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      n++;
      if (n === 2) return new Response('x', { status: 500 });
      const q = new URL(u).searchParams.get('ids')!.split(',');
      return new Response(JSON.stringify(q.map((id) => ({ status_code: 200, body: { id, attributes: [{ id: 'GTIN', value_name: `789${id.slice(3)}` }] } }))));
    }));
    const r = await buscarGtinsDosItens('t', todos);
    expect(n).toBe(3);
    expect(Object.keys(r).sort()).toEqual([...todos.slice(0, 20), ...todos.slice(40)].sort());
    expect(r.MLB0).toBe('7890');
  });
});
```

O formato exato que `extrairGtin` aceita (`value_name` contra `values[0].name`) precisa ser conferido em `pedidos.ts:12-21` antes de rodar. Ajustar o atributo sintético a esse formato.

Em `vendas.test.ts`, adicionar o par com `buscarTitulosEGtins` (agora exportada): fixtures `bulk-vendas-*`, URL `&attributes=status_code,body.id,body.title,body.attributes`, igualdade com o envelope antigo e `Object.keys(r.titulos).length > 0`.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar.**
  - `vendas.ts:127`: `export async function buscarTitulosEGtins(`.
  - `vendas.ts:139`: `const url = \`${API}${caminhoMultiget(bloco, 'id,title,attributes')}\`;`
  - `vendas.ts:142`: `const arr = comoEnvelopeAntigo(await resp.json(), bloco) as any; // [{ code, body }] (ADR-0177)`. Usar o mesmo tipo implícito de hoje: se `arr` hoje é `any`, manter.
  - `pedidos.ts:35`: `const url = \`${API}${caminhoMultiget(bloco, 'id,attributes')}\`;`
  - `pedidos.ts:38`: `const arr = comoEnvelopeAntigo(await resp.json(), bloco) as unknown[];`. Conferir o tipo usado depois, na linha 40 (`for (const e of arr)`); se hoje é `any`, usar `as any`.
  - Imports de `./multiget.ts`.

- [ ] **Step 4: Testes de sync-venda, reconciliar-faturamento, backfill-faturamento, sync-devolucao e _shared → PASS.** Depois `deno check` nos `index.ts`.

- [ ] **Step 5: A/B `F2`.** Antes, aplicar o `export` também na baseline extraída:
  `sed -i '' 's/^async function buscarTitulosEGtins/export async function buscarTitulosEGtins/' $CLAUDE_JOB_DIR/tmp/ab/base/supabase/functions/_shared/ml/vendas.ts`.
  Esperado: `IDÊNTICO`.

- [ ] **Step 6: Commit (`feat(ml): fatia 2 do /items/bulk — GTIN de vendas e faturamento`), Codex e portão.** Edges: `edges_afetadas.py _shared/ml/vendas.ts _shared/ml/pedidos.ts`.

- [ ] **Step 7: Deploy e observação.**
  - Por id: as 3 próximas vendas reais têm GTIN preenchido na linha de faturamento, igual ao GTIN da fase A para o mesmo item (SQL read-only).
  - `reconciliar-faturamento` (cron `0 * * * *`) sem erro.

---

### Task T3 (F3): kit virtual

**Files:**
- Modify: `_shared/ml/kit-virtual.ts:74` (comentário), `:91`, `:97`
- Create: `buscar-componentes-kit-virtual/leitura-ml.ts` (extração)
- Modify: `buscar-componentes-kit-virtual/index.ts:46-72` (passa a importar), `processar.ts:26` (comentário)
- Test: `_shared/ml/__tests__/kit-virtual-status.test.ts`, **novo** `buscar-componentes-kit-virtual/__tests__/leitura-ml.test.ts`

- [ ] **Step 1: Caracterização da leitura de componentes (endpoint antigo), falhando**

`buscar-componentes-kit-virtual/__tests__/leitura-ml.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buscarUserProductIdsML } from '../leitura-ml.ts';
afterEach(() => vi.unstubAllGlobals());
const resp = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe('buscarUserProductIdsML', () => {
  it('blocos de 20, mapeia user_product_id/price/category_id e ignora não-200', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `MLB${i}`);
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(u);
      const q = (new URL(u).searchParams.get('ids') ?? '').split(',');
      return resp(q.map((id) => (id === 'MLB3' ? { code: 404, body: { id } } : { code: 200, body: { id, user_product_id: `UP${id}`, price: 10, category_id: 'MLB1' } })));
    }));
    const r = await buscarUserProductIdsML('t', ids);
    expect(urls).toHaveLength(2);
    expect(r).toHaveLength(20);
    expect(r[0]).toEqual({ itemId: 'MLB0', userProductId: 'UPMLB0', precoAtualML: 10, categoriaMlId: 'MLB1' });
  });
  it('bloco com HTTP de erro (mlGet devolve null) é pulado sem derrubar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({}, 500)));
    expect(await buscarUserProductIdsML('t', ['MLB1'])).toEqual([]);
  });
});
```

Essa versão usa o envelope `code`, porque é caracterização do comportamento atual. No commit do bulk (Step 4), o primeiro teste troca para `status_code`, o `MLB3` passa a responder `{ status_code: 404 }` sem body e entra uma asserção de URL do bulk.

- [ ] **Step 2: Extração (P-Extração).** Criar `buscar-componentes-kit-virtual/leitura-ml.ts` com:
  - o comentário das linhas 45-50;
  - `export async function buscarUserProductIdsML(...)`, copiada **sem alteração** de `index.ts:51-72`;
  - `const API = 'https://api.mercadolibre.com';`;
  - os imports `import { mlGet } from '../_shared/ml/http.ts';` e `import type { ItemBridge } from './processar.ts';`.

  Em `index.ts`: apagar a função e importar `import { buscarUserProductIdsML } from './leitura-ml.ts';`. Remover de `index.ts` o import `mlGet` e o `const API` **só** se ficarem órfãos (`grep -n "mlGet\|API" index.ts`).
  - Rodar o teste → PASS.
  - `git diff --color-moved=zebra` → só movimento.
  - Commit `refactor(kit): extrair leitura de componentes do ML (sem mudança de comportamento)`.
  - A/B de extração: baseline = pai, árvore nova = este commit, cenário `componentes`. Esperado: `IDÊNTICO`.

- [ ] **Step 3: Testes do bulk, falhando.**
  - `kit-virtual-status.test.ts:122`: a expectativa vira `'https://api.mercadolibre.com/items/bulk?ids=MLB1,MLB2&attributes=status_code,body.id,body.listing_type_id'`, e o mock desse teste responde `status_code`.
  - Novo teste com o fixture real do kit **mais um 404 inserido**:

```ts
import bulkKit from './fixtures/bulk-kit-bulk.json' with { type: 'json' };
import idsKit from './fixtures/bulk-kit-ids.json' with { type: 'json' };
it('fixture real do kit + 404 sem body: o 404 fica fora do mapa, os demais entram', async () => {
  const ids = (idsKit as string[]).filter((i) => i !== 'MLB0000000001');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([...(bulkKit as unknown[]), { status_code: 404 }]))));
  const m = await buscarListingTypeItensML('t', [...ids, 'MLB0000000001']);
  expect([...m.keys()].sort()).toEqual([...ids].sort());
});
```

  E o teste de componentes migra para o bulk, como descrito no Step 1.

- [ ] **Step 4: Implementar.**
  - `kit-virtual.ts:91`: `` `https://api.mercadolibre.com${caminhoMultiget(bloco, 'id,listing_type_id')}` ``.
  - `kit-virtual.ts:97`: `const arr = comoEnvelopeAntigo(await resp.json().catch(() => null), bloco);`.
  - `kit-virtual.ts:74` (comentário): `(\`GET /items/bulk?ids=...&attributes=...\`, ADR-0177)`.
  - `leitura-ml.ts`: `const url = \`${API}${caminhoMultiget(bloco, 'id,user_product_id,price,category_id')}\`;` e `const arr = comoEnvelopeAntigo(await mlGet(url, token), bloco);`.
  - `processar.ts:26` (comentário): `GET /items/bulk?ids=...&attributes=status_code,body.id,body.user_product_id,body.price,body.category_id`.
  - Imports do adaptador.

- [ ] **Step 5: Testes (`_shared/ml`, `buscar-componentes-kit-virtual`, `criar-kit-virtual`, `status-publicados`) → PASS.** Depois `deno check`.

- [ ] **Step 6: A/B `F3`** (baseline = commit da extração). Esperado: `IDÊNTICO`, com a DSA mostrando `kits=2`.

- [ ] **Step 7: Commit (`feat(ml): fatia 3 do /items/bulk — kit virtual`), Codex e portão.** Edges: `edges_afetadas.py _shared/ml/kit-virtual.ts buscar-componentes-kit-virtual/index.ts buscar-componentes-kit-virtual/leitura-ml.ts`.

- [ ] **Step 8: Deploy e observação.**
  - `status-publicados` com os 2 kits DSA: o `listing_type_id` de cada componente é igual ao da fase A.
  - `buscar-componentes-kit-virtual` e `criar-kit-virtual` ficam com observação passiva até 24 h.

---

### Task T4 (F4): promoções, operações, órfãos, família UP

**Files:**
- Modify: `_shared/promocoes/ml.ts:126-127`
- Modify: `_shared/operacoes/ml.ts:40-43`
- Modify: `_shared/ml/varrer-itens.ts:83-94`
- Modify: `_shared/ml/descobrir-familia-up.ts:129-133`
- Test: `_shared/promocoes/__tests__/ml.test.ts` (+ `fixtures/multiget.json`), `_shared/operacoes/__tests__/ml.test.ts`, `_shared/ml/__tests__/varrer-itens.test.ts`, `_shared/ml/__tests__/descobrir-familia-up.test.ts`

- [ ] **Step 1: Testes falhando**
  - `operacoes/__tests__/ml.test.ts:125-126`:
    - `` `${API}/items/bulk?ids=MLB1&attributes=status_code,body.id,body.catalog_listing,body.item_relations` ``;
    - `` `${API}/items/bulk?ids=MLB2&attributes=status_code,body.id,body.catalog_listing` ``.

    Os mocks do arquivo passam a responder `status_code`. Nos testes de 404 (linhas 138 e 146), a resposta vira `{ status_code: 404 }` sem body, e o comportamento esperado (rejeita; Error) **não muda**. Adicionar:

```ts
it('relacionado repetido em item_relations: uma consulta só, resultado igual', async () => {
  const f = vi.fn(async (u: string) => {
    if (u.includes('body.item_relations')) return new Response(JSON.stringify([{ status_code: 200, body: { id: 'MLB1', catalog_listing: false, item_relations: [{ id: 'MLB2' }, { id: 'MLB2' }] } }]));
    return new Response(JSON.stringify([{ status_code: 200, body: { id: 'MLB2', catalog_listing: true } }]));
  });
  const r = await criarClienteML('t', f as unknown as typeof fetch).lerRelacoes('MLB1');
  expect(new URL(String(f.mock.calls[1][0])).searchParams.get('ids')).toBe('MLB2');
  expect(r).toEqual(RELACOES_ESPERADAS_REPETIDO);
});
```

    `RELACOES_ESPERADAS_REPETIDO` é caracterização. Rodar o teste em `main` com o envelope `code` (o antigo deduplicava), ler o resultado e fixar.

  - `promocoes/__tests__/ml.test.ts`: o fixture `fixtures/multiget.json` passa a ter `status_code` (`sed -i '' 's/"code":/"status_code":/'` e conferir com `grep -c`). O cast da linha 135 vira `{ status_code: number; … }`. O teste da linha 94 ganha a asserção:

```ts
expect(chamadas[0]).toMatch(/^\/items\/bulk\?ids=[^&]+&attributes=status_code,body\.id,body\.title,body\.thumbnail,body\.secure_thumbnail,body\.permalink,body\.listing_type_id,body\.category_id,body\.seller_custom_field,body\.attributes,body\.variations&include_attributes=all$/);
```

    Usar o nome real da variável que guarda as chamadas no teste.

    Mais um teste com os fixtures reais alinhados `bulk-promocoes-*`: `buscarItensML` com um `GetJson` falso que devolve o bulk, e outro que devolve o antigo, nos mesmos ids. Os resultados devem ser iguais (`toEqual` dos dois `Map`).
  - `varrer-itens.test.ts`: mocks com `status_code`. Asserção de URL: `toContain('&attributes=status_code,body.id,body.title,body.status,body.permalink,body.available_quantity,body.seller_custom_field,body.catalog_listing')`. Mais um par com os fixtures reais `bulk-varrer-itens-*`, comparado como multiconjunto por `id`.
  - `descobrir-familia-up.test.ts:35` e `:163`: rotas `'/items/bulk?ids='`. O fake responde `status_code`. Mais um teste de **permutação**: os mesmos irmãos em duas ordens dão o mesmo resultado (`porCor` comparado como conjunto e o mesmo `familyName`). O spec §4.3 define que nomes divergentes vão ao Diego, e esse caso não é testado como "certo".

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar.**
  - `promocoes/ml.ts:126-127`:

```ts
    const r = comoEnvelopeAntigo(await get(caminhoMultiget(bloco, ATRIBUTOS_ITEM, '&include_attributes=all')), bloco);
    for (const x of lista(r)) {
```

    O `encodeURIComponent(bloco.join(','))` some: o adaptador codifica id a id. Diferença de forma, não de conteúdo: o spike mediu `%2C` e vírgula crua como equivalentes.
  - `operacoes/ml.ts:40-43`:

```ts
    const r = await chamar('GET', caminhoMultiget(xs, atributos));
    if (!r.ok) throw await falha(r);
    const m = new Map<string, Obj>();
    for (const x of lista(comoEnvelopeAntigo(await r.json(), xs))) {
```

    Remover o helper `ids` (linha 22) **só** se ficar órfão.
  - `varrer-itens.ts:83-87`:

```ts
    const url = `${API}${caminhoMultiget(bloco, 'id,title,status,permalink,available_quantity,seller_custom_field,catalog_listing')}`;
    const resp = await fetchLike(url, { headers });
    if (!resp.ok) throw new Error(`detalhes dos anúncios: ML respondeu ${resp.status}`);
    const arr = comoEnvelopeAntigo(await resp.json(), bloco) as Array<{
```

    O tipo que vem depois (linhas 88-94) fica.
  - `descobrir-familia-up.ts:129-133`:

```ts
    const url = `${API}${caminhoMultiget(bloco, 'id,seller_id,category_id,family_id,family_name,status,variations,attributes')}`;
    const resp = await fetchLike(url, { headers });
    if (!resp.ok) throw new Error(`multiget de família migrada (${resp.status})`);
    const arr = comoEnvelopeAntigo(await resp.json(), bloco) as Array<{ code?: number; body?: ItemBruto }>;
```

  - Imports do adaptador nos quatro arquivos.

- [ ] **Step 4: Testes (`_shared`, `operacoes-massa`, `sincronizar-promocoes`, `coletar-ads-ml`, `coletar-trafego-ml`, `varrer-anuncios-orfaos`, `update-familia-ml`) → PASS.** Depois `deno check`.

- [ ] **Step 5: A/B `F4`.** Esperado: `IDÊNTICO`.

- [ ] **Step 6: Commit (`feat(ml): fatia 4 do /items/bulk — promoções, operações, órfãos e família UP`), Codex e portão.** Edges: `edges_afetadas.py _shared/promocoes/ml.ts _shared/operacoes/ml.ts _shared/ml/varrer-itens.ts _shared/ml/descobrir-familia-up.ts`. A lista precisa incluir `coletar-trafego-ml`.

- [ ] **Step 7: Deploy e observação.**
  - `sincronizar-promocoes` (cron `10 */6 * * *`): por id, 10 itens da Central (categoria, título, cor) iguais aos da rodada anterior para os mesmos ids (SQL read-only nas tabelas de promoção; localizar com `grep -n "^### " docs/reference/modelo-de-dados.md | grep -i promo`).
  - `coletar-trafego-ml` (cron `17 9`): sem erro.
  - `operacoes-massa` e `varrer-anuncios-orfaos`: observação passiva até 24 h.

---

### Task T5 (F5): Pulse e PxV

**Files:**
- Modify: `pulse-coletar/processar.ts:682-691` (extração para `export async function lerSituacaoAnuncios`)
- Create: `acompanhar-migracao-pxv/leitura-ml.ts` (`lerCoresML`, `lerEstoqueVivoML`)
- Modify: `acompanhar-migracao-pxv/index.ts:93-108`, `:172-183`
- Modify: `_shared/pulse/parse.ts:91` (só comentário)
- Test: **novos** `pulse-coletar/__tests__/situacao.test.ts`, `acompanhar-migracao-pxv/__tests__/leitura-ml.test.ts`

- [ ] **Step 1: Caracterização (endpoint antigo), falhando**

`acompanhar-migracao-pxv/__tests__/leitura-ml.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lerCoresML, lerEstoqueVivoML } from '../leitura-ml.ts';
afterEach(() => vi.unstubAllGlobals());
const resp = (b: unknown, status = 200) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status });

describe('lerCoresML', () => {
  it('uma requisição com todos os ids; cor por item; não-200 fica fora', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return resp([
      { code: 200, body: { id: 'MLB1', attributes: [{ id: 'COLOR', value_name: 'Azul' }] } },
      { code: 404, body: { id: 'MLB2' } },
    ]); }));
    const m = await lerCoresML('t', ['MLB1', 'MLB2']);
    expect(urls).toHaveLength(1);
    expect([...m.keys()]).toEqual(['MLB1']);
  });
  it('HTTP de erro → lança (o worker reagenda)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({}, 503)));
    await expect(lerCoresML('t', ['MLB1'])).rejects.toThrow('multiget de cores falhou (503)');
  });
  it('resposta objeto (não-array) → lança TypeError, como hoje (reagenda, não marca erro)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({ message: 'x' })));
    await expect(lerCoresML('t', ['MLB1'])).rejects.toThrow(TypeError);
  });
  it('resposta null → mapa vazio, como hoje (json ?? [])', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp('null')));
    expect((await lerCoresML('t', ['MLB1'])).size).toBe(0);
  });
});
describe('lerEstoqueVivoML', () => {
  it('available_quantity por item; ausente vira 0; HTTP de erro → mapa vazio (sem lançar)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp([{ code: 200, body: { id: 'MLB1', available_quantity: 4 } }, { code: 200, body: { id: 'MLB2' } }])));
    expect(Object.fromEntries(await lerEstoqueVivoML('t', ['MLB1', 'MLB2']))).toEqual({ MLB1: 4, MLB2: 0 });
    vi.stubGlobal('fetch', vi.fn(async () => resp({}, 500)));
    expect((await lerEstoqueVivoML('t', ['MLB1'])).size).toBe(0);
  });
  it('resposta objeto com HTTP 200 → lança TypeError, como hoje', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({ message: 'x' })));
    await expect(lerEstoqueVivoML('t', ['MLB1'])).rejects.toThrow(TypeError);
  });
});
```

`corDaVariacaoML` decide se `[{id:'COLOR', value_name}]` é o formato certo. Conferir em `_shared/ml/atualizar-item.ts:51` e, se esperar `attribute_combinations`, usar o formato que a função lê, mantendo a asserção sobre `keys`.

`pulse-coletar/__tests__/situacao.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lerSituacaoAnuncios } from '../processar.ts';
afterEach(() => vi.unstubAllGlobals());

describe('lerSituacaoAnuncios', () => {
  it('blocos de 20; situação por item; não-200 fora; bloco com erro não derruba', async () => {
    const ids = Array.from({ length: 41 }, (_, i) => `MLB${i}`);
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      n++;
      if (n === 2) return new Response('x', { status: 500 });
      const q = (new URL(u).searchParams.get('ids') ?? '').split(',');
      return new Response(JSON.stringify(q.map((id) => ({ code: 200, body: { id, status: 'active', sub_status: [], category_id: 'C', listing_type_id: 'gold_pro', price: 9 } }))));
    }));
    const m = await lerSituacaoAnuncios(ids, 't');
    expect(n).toBe(3);
    expect([...m.keys()].sort()).toEqual([...ids.slice(0, 20), ids[40]].sort());
    expect(m.get('MLB0')).toEqual({ item_id: 'MLB0', status: 'active', sub_status: [], category_id: 'C', listing_type_id: 'gold_pro', price: 9 });
  });
});
```

Se `mlGet` fizer retry em 500 (só em 429 hoje: `http.ts:11`), a contagem `n` continua 3.

- [ ] **Step 2: Extração (P-Extração).**

`acompanhar-migracao-pxv/leitura-ml.ts`:

```ts
// Leituras multiget do worker PxV, extraídas de index.ts para teste (ADR-0177). Mesma semântica de antes.
import { corDaVariacaoML } from '../_shared/ml/atualizar-item.ts';

const API = 'https://api.mercadolibre.com';

/** COLOR dos anúncios NOVOS. Lança em HTTP de erro (o worker reagenda). */
export async function lerCoresML(token: string, itemIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const url = `${API}/items?ids=${itemIds.join(',')}&attributes=id,attributes`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  // Lança em vez de devolver mapa vazio: um 5xx transitório do ML viraria "nenhuma cor lida" →
  // casamento falho → `erro` definitivo, com a migração já concluída do outro lado. O catch do
  // worker trata como transitório e reagenda dentro do orçamento.
  if (!resp.ok) throw new Error(`multiget de cores falhou (${resp.status})`);
  const json = await resp.json() as Array<{ code?: number; body?: { id?: string; attributes?: unknown } }>;
  for (const linha of json ?? []) {
    if (linha?.code !== 200 || !linha.body?.id) continue;
    out.set(String(linha.body.id), corDaVariacaoML(linha.body.attributes));
  }
  return out;
}

/** Estoque vivo por item. HTTP de erro → mapa vazio (sem lançar), como antes. */
export async function lerEstoqueVivoML(token: string, ids: string[]): Promise<Map<string, number>> {
  const vivoPorItem = new Map<string, number>();
  const url = `${API}/items?ids=${ids.join(',')}&attributes=id,available_quantity`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (resp.ok) {
    const json = await resp.json() as Array<{ code?: number; body?: { id?: string; available_quantity?: number } }>;
    for (const l of json ?? []) {
      if (l?.code === 200 && l.body?.id) vivoPorItem.set(String(l.body.id), l.body.available_quantity ?? 0);
    }
  }
  return vivoPorItem;
}
```

Antes de colar, comparar linha a linha com `index.ts:93-108` e `:172-183`. Se o original tiver qualquer linha a mais dentro do trecho (por exemplo, um `return out` em outra posição), copiar o original, não o texto acima.

Em `index.ts`, `lerCores` passa a ser:

```ts
    lerCores: async (itemIds) => {
      if (itemIds.length === 0) return new Map();
      return lerCoresML(await getToken(), itemIds);
    },
```

E o estoque vivo:

```ts
      const ids = [...itemPorSku.values()];
      const vivoPorItem = ids.length > 0 ? await lerEstoqueVivoML(await getToken(), ids) : new Map<string, number>();
```

`getToken()` continua sendo chamado uma vez, só quando há ids e antes do fetch, como hoje. Import: `import { lerCoresML, lerEstoqueVivoML } from './leitura-ml.ts';`. Remover de `index.ts` o import de `corDaVariacaoML` só se ficar órfão.

`pulse-coletar/processar.ts`: extrair o laço das linhas 684-691 para uma função exportada no mesmo arquivo, perto do topo das funções de ML:

```ts
/** Situação dos NOSSOS anúncios pelo multiget (blocos de 20). Exportada para teste (ADR-0177). */
export async function lerSituacaoAnuncios(ids: string[], token: string): Promise<Map<string, AnuncioMultiget>> {
  const infoPorItem = new Map<string, AnuncioMultiget>();
  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20);
    const json = await mlGet(
      `${API}/items?ids=${lote.join(',')}&attributes=id,status,sub_status,category_id,listing_type_id,price`,
      token,
    );
    for (const st of parseStatusAnuncios(json)) infoPorItem.set(st.item_id, st);
  }
  return infoPorItem;
}
```

No lugar original fica `const infoPorItem = await lerSituacaoAnuncios(ids, token);`. Conferir que `API` e `AnuncioMultiget` estão no escopo do módulo (`grep -n "const API\|AnuncioMultiget" processar.ts`).

- Rodar os testes de caracterização → PASS.
- `git diff --color-moved=zebra` → só movimento.
- Commit `refactor(pulse,pxv): extrair leituras do ML (sem mudança de comportamento)`.
- A/B de extração: baseline = pai, árvore nova = este commit, cenários F5. Esperado: `IDÊNTICO`.

- [ ] **Step 3: Testes do bulk, falhando.** Converter os testes de caracterização para o bulk: respostas com `status_code`, 404 como `{ status_code: 404 }` e asserção de URL:
  - `lerCoresML`: `…/items/bulk?ids=MLB1,MLB2&attributes=status_code,body.id,body.attributes`;
  - `lerEstoqueVivoML`: `…&attributes=status_code,body.id,body.available_quantity`;
  - Pulse: `…&attributes=status_code,body.id,body.status,body.sub_status,body.category_id,body.listing_type_id,body.price`.

  Os testes de não-array (objeto → TypeError, `null` → vazio) **ficam iguais**: eles provam que o adaptador não muda isso. Mais um teste: `lerCoresML('t', ['MLB1', 'MLB1'])` → URL com `ids=MLB1`.

- [ ] **Step 4: Implementar.**
  - Em `leitura-ml.ts`: as URLs passam a `` `${API}${caminhoMultiget(itemIds, 'id,attributes')}` `` e `` `${API}${caminhoMultiget(ids, 'id,available_quantity')}` ``.
  - O `json` lido passa por `comoEnvelopeAntigo(await resp.json(), itemIds)` e por `comoEnvelopeAntigo(await resp.json(), ids)`. Os tipos e os laços ficam.
  - Em `processar.ts`: `` `${API}${caminhoMultiget(lote, 'id,status,sub_status,category_id,listing_type_id,price')}` `` e `parseStatusAnuncios(comoEnvelopeAntigo(json, lote))`.
  - O comentário de `parse.ts:91` cita `/items/bulk` (ADR-0177) e o envelope antigo entregue pelo adaptador.

- [ ] **Step 5: Testes (`_shared`, `pulse-coletar`, `pulse-analise-secoes237`, `acompanhar-migracao-pxv`) → PASS.** Depois `deno check`.

- [ ] **Step 6: A/B `F5`** (baseline = commit da extração). Esperado: `IDÊNTICO`, inclusive `coresPxV21distintos` falhando igual nos dois lados (400 preservado).

- [ ] **Step 7: Commit (`feat(ml): fatia 5 do /items/bulk — Pulse e migração PxV`), Codex e portão.** Edges: `edges_afetadas.py pulse-coletar/processar.ts acompanhar-migracao-pxv/index.ts acompanhar-migracao-pxv/leitura-ml.ts`.

- [ ] **Step 8: Deploy e observação.**
  - `pulse-coletar` tier quente (cron `0 */6 * * *`): por id, 10 anúncios cuja situação gravada (status, sub_status, preço) é igual à da fase A, para itens sem mudança real entre as rodadas.
  - PxV: SQL read-only para ver se há migração ativa. Sem migração ativa, registrar "não observado; A/B + testes".

---

### Task T6 (F6): varredura final e docs

**Files:**
- Modify: `docs/reference/edge-functions.md`, `obsidian-vault/03-Módulos/Estoque.md:231`, `docs/runbooks/coletar-trafego-ml.md:102`, `obsidian-vault/04-Decisões/Índice de ADRs.md`, `docs/project-status.md`, `docs/TASKS.md`, `obsidian-vault/09-Logs/Changelog.md`. Seguir a skill `docs-update-checklist`.

- [ ] **Step 1: Varredura** (código executável separado de comentário):
  - `grep -rn "items?ids=" supabase/functions src tests --include=*.ts --include=*.tsx | grep -v "^\S*:\s*//\|^\S*:\s*\*"` → **vazio**.
  - `grep -rn "items?ids=" supabase/functions src tests` → só comentários históricos datados: `coletar-trafego-ml/deps.ts:135`, `vendedores-do-catalogo.ts:3` e comentários de teste que descrevem o envelope antigo do adaptador.
  - `grep -rnE "(code|status_code)\s*\?\?" supabase/functions --include=*.ts | grep -v __tests__` → `fiacao.ts:76` e `multiget.ts`.
  - `python3 $CLAUDE_JOB_DIR/tmp/edges_afetadas.py _shared/ml/multiget.ts`, seguido de `manifesto.py conferir <SHA_MAIN> <todas>` → nenhuma divergência. Isso prova que **toda** edge que importa o adaptador está com o código da `main`.

- [ ] **Step 2: Docs.** Uma linha por arquivo, citando a ADR-0177. Em `Estoque.md:231`: `multiget /items/bulk (ADR-0177)`. Em `edge-functions.md`: nota de que os filtros de log usam `/items/bulk`. Depois atualizar o Graphify (skill `graphify-update-maintenance`).

- [ ] **Step 3: Pré-merge.**
  - `pnpm preflight`;
  - CI verde;
  - P-Revisão Codex do **diff completo** da branch (`3b68f702..HEAD`);
  - OK do Diego;
  - merge.
  - No fim, remover a branch e o worktree (`rm -rf` + `git worktree prune`, conforme a memória sobre iCloud).

---

## Resposta aos 18 achados do Codex (v1 → v2)

| # | Achado | Onde a v2 responde |
|---|---|---|
| 1 | fixtures com ids diferentes | T0 Step 1 (alinhados por id, GTIN/COLOR preservados), comparação por id com `tags` ordenado |
| 2 | PxV: não-array virava erro definitivo | adaptador devolve não-array intacto; T5 testa objeto → TypeError e `null` → vazio |
| 3 | `%20` no inventário de edges | `edges_afetadas.py` com `unquote`, grafo sem erro, recusa lista vazia, sanidade obrigatória |
| 4 | F5 comparando erros | cenários com cobertura positiva obrigatória, `esperaErro` explícito, transportes reais (funções extraídas), blocos de ≤20 |
| 5 | dedup global mudava decisões | dedup só por requisição; particionamento intacto; teste "ambíguo" em T1 |
| 6 | filtro comum ≠ filtros atuais | sem filtro comum: o adaptador devolve o envelope antigo e os predicados não mudam |
| 7 | ordem dos envelopes | medido (o antigo era arbitrário); spec §4.3; multiconjunto declarado; teste de permutação na descoberta |
| 8 | propagação >20 virava melhoria | sem blocos novos (fora de escopo); justificativa sobre duplicados corrigida (o antigo deduplicava antes do limite) |
| 9 | A/B não cobria adaptadores | cenários para `buscarItemPorSku`, componentes, `descobrirFamiliaUP`, Pulse e as 2 leituras PxV |
| 10 | falhas iguais aprovavam | `ok:false` reprova, salvo `esperaErro`; 401/403 encerra; orgs e amostra mínima obrigatórias |
| 11 | decisões de escrita sem prova | propagação nos dois envelopes, casos mistos nos dois sentidos, sequência caracterizada; reativação com `lerStatus` real |
| 12 | guarda sem teste positivo | `fetchReal` espião; `Request` e `init.method`; porta 443; `--no-prompt`; escrita só por rota prevista |
| 13 | testes fracos | respostas derivadas dos ids pedidos, saídas exatas, bloco do meio com erro, 404 explícito no kit |
| 14 | rollback incompleto | snapshot baixado por edge, `--project-ref`, `verify_jwt` do manifesto, reversão via CI |
| 15 | versão não prova conteúdo | manifesto com hash por arquivo contra o SHA, antes e depois; deploy parcial bloqueia |
| 16 | observação por contagem | comparação por id e campo, prazo de 24 h, "não observado" registrado |
| 17 | varreduras erradas | grep separando código de comentário, inclui `tests/`, exceções nomeadas |
| 18 | "mesmos logs" | spec §4.3 declara a mudança de logs e de filtros; descrição correta de `mlGet` (não lança) |
