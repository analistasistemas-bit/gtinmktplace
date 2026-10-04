# Multiget ML `/items?ids=` → `/items/bulk` — Implementation Plan (v3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** trocar as 14 chamadas a `GET /items?ids=` (13 arquivos) por `GET /items/bulk?ids=` antes de 25/10/2026, mantendo equivalentes as decisões de negócio e sem nenhuma escrita no Mercado Livre fora do fluxo do app.

**Architecture:**
- Um **adaptador** puro (`_shared/ml/multiget.ts`) monta a URL do bulk, com dedup dentro da requisição.
- O adaptador converte as entradas **no formato bulk** para o envelope antigo `[{code, body}]`. Só o caso medido do 404 sem body ganha `body: {id}`, e só quando as posições estão confirmadas pelos ids presentes. Entradas já no formato antigo passam intactas.
- Cada módulo troca só a URL e passa o JSON pelo adaptador; laços, predicados e erros não mudam.
- As leituras inline ganham uma extração mínima, para serem testáveis.
- Cada fatia passa por:
  - TDD;
  - testes de fronteira nos dois envelopes;
  - A/B em duas fases (gravação e replay, só GET ao vivo, escrita simulada só na rota permitida e com registro fatal de violações);
  - revisão do Codex.
- Depois do merge vem o deploy, com manifesto de hash por arquivo e por edge. A igualdade de hash com a árvore que passou no A/B é a prova de que o código implantado é o testado.

**Tech Stack:** Deno (Supabase Edge Functions), TypeScript, vitest (`pnpm test`), Supabase CLI 2.101, Codex CLI.

**Spec:** `docs/superpowers/specs/2026-10-03-ml-items-bulk-design.md` (v2): §2 é o contrato medido, §3 o inventário, §4.3 as diferenças aceitas e §5 a validação. Onde este plano for mais restrito que a spec (regra do adaptador, A/B pós-deploy), **vale o plano**, e a T6 alinha a spec.

**Histórico:**
- v1: REVISAR do Codex `gpt-6.1-sol` high, com 18 achados.
- v2: incorporou a consultoria `gpt-6-astra` high. Teve REVISAR: 6 resolvidos, 12 parciais e 16 novos.
- v3: responde os 12 parciais e os 16 novos (tabelas no fim). Na r3 do Codex, o adaptador ficou resolvido e sobraram 12 itens.
- v3.1: corrige os 12 itens da r3:
  - `deno eval` sem `--no-prompt`;
  - cobertura de `Map` com `has/size/values`;
  - corpo interrompido vira violação fatal;
  - propagação com prova de relacionados;
  - erro esperado com prova do GET de 21 ids;
  - SKU e catálogo também dos filhos UP;
  - `SHA_AB_APROVADO` (merge que muda `supabase/` exige novo A/B);
  - `verify_jwt` efetivo conferido antes do deploy;
  - dependências do rollback como risco declarado;
  - caracterização de relacionado repetido sem URL pré-mudança;
  - mock de `token.ts` no teste do Pulse;
  - comentário do teste de kit;
  - `get.mock.calls`.
- **Próxima revisão (por pedido do Diego): Grok 4.7 high via `cursor-agent`.**

## Global Constraints

- **No ML, só GET** em spike, A/B e validação. **Nunca** PUT, POST ou DELETE em anúncio fora do fluxo normal do app, nem para teste.
- O token ML é lido por SQL read-only (`get_connection_tokens`) via Management API (`SUPABASE_ACCESS_TOKEN` do `.env.local` da raiz). **Nunca** renovar, imprimir ou gravar o token. 401/403 encerra o A/B.
- Scripts descartáveis ficam em `$CLAUDE_JOB_DIR/tmp` (`/Users/diego/.claude/jobs/b87cbc02/tmp`).
- **Equivalência estrita:** os módulos mantêm particionamento, predicados, transporte, `throw`/`[]`/`continue`, comportamento diante de não-array, contagem **e momento** das chamadas a `getToken()`. Diferenças aceitas: as do spec §4.3.
- **Regra do adaptador:** só reinterpreta entradas **sem** a chave `code` (formato bulk). Só cria body para `status_code === 404` sem `body`, com cardinalidade igual **e** todos os ids presentes nas suas posições. Nunca cria body para 200, 500 ou outro código. Entrada com `code` (formato antigo) volta byte a byte igual.
- Fora de escopo: melhorias funcionais (mais de 20 ids onde não há blocos, dedup global).
- O helper não divide em blocos, não filtra, não faz `trim` e não lança.
- `fiacao.ts` e `coletar-trafego-ml/deps.ts` não mudam.
- **SHAs:**
  - `SHA_PRODUCAO` = commit cujo conteúdo está implantado, conferido por manifesto;
  - `SHA_BASELINE_AB` = commit anterior ao commit do bulk da fatia. Numa fatia com extração, é o commit da extração.
  - Não confundir os dois.
- Deploy **só depois do merge**:
  - edges por `deno info`, com o grafo inteiro resolvido e o caminho decodificado;
  - `--project-ref txvncrgkoynoxwopfkbp`;
  - manifesto antes e depois, com versão, `verify_jwt` e `ezbr_sha256` estáveis em volta de cada download e hash por arquivo.
- Merge: fast-forward, com CI verde (`frontend`, `backend-lint`) e **OK do Diego por fatia**. Nunca `--admin` nem force-push.
- Revisão: o Codex `gpt-6.1-sol` high revisa o plano, cada fatia e o pré-merge (`codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only - < <prompt> > <saída>`). A consultoria é o `gpt-6-astra` high.
- git no worktree: `/usr/bin/git` com comando simples e commit por `-F <arquivo em $CLAUDE_JOB_DIR/tmp>`. Fim de toda mensagem: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prazo: em produção até **15/10/2026**.
- Datas-alvo:
  - T0 + T1: 06/10
  - T2: 07/10
  - T3: 09/10
  - T4: 10/10
  - T5: 13/10
  - T6: 14/10

## Review Focus

1. **Mesmo id em dois blocos, com 200 num e 404 sem body no outro (`lerStatus`).** Esperado: igual ao antigo (`indisponivel`). Teste em T1.
2. **Bulk responde 200 sem body, ou resposta desalinhada com a mesma cardinalidade.** Esperado: nada é fabricado, e o item fica fora (no antigo, `{code:200}` sem body também ficava fora). Testes em T0, e fronteira de `lerRelacoes` em T4 (não pode virar `catalog_listing:false`).
3. **Resposta não-array (objeto, `null`) no PxV e nos demais.** Esperado: o mesmo de hoje (TypeError que reagenda, ou vazio onde já era vazio). Testes em T0 e T5.
4. **Relacionados mistos nos dois sentidos.** Esperado: a mesma sequência de PUTs de hoje, inclusive o PUT antes do 502, caracterizado. Teste em T1.
5. **`lerStatus` real alimentando a reativação no `sincronizar-estoque`.** Esperado: pausado → reativa; 404 sem body → não reativa. Teste em T1.

---

## File Structure

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `supabase/functions/_shared/ml/multiget.ts` (novo) | `caminhoMultiget`, `comoEnvelopeAntigo` | T0 |
| `supabase/functions/_shared/ml/__tests__/multiget.test.ts` (novo) | contrato do adaptador, fixtures reais | T0 |
| `supabase/functions/_shared/ml/__tests__/fixtures/bulk-*.json` (novos) | pares reais antigo/bulk alinhados por id, **sem cortar atributos** | T0 |
| `docs/decisions/0177-multiget-ml-items-bulk.md` (novo) | ADR | T0 |
| `$CLAUDE_JOB_DIR/tmp/ab/*`, `edges_afetadas.py`, `manifesto.py` (fora do repo) | ferramental | T0 |
| `_shared/canais/mercado-livre.ts`, `_shared/ml/buscar-item.ts`, `_shared/ml/atualizar-item.ts` + testes | F1 | T1 |
| `_shared/ml/vendas.ts`, `_shared/ml/pedidos.ts` + testes | F2 | T2 |
| `_shared/ml/kit-virtual.ts`, `buscar-componentes-kit-virtual/{index.ts, leitura-ml.ts, processar.ts}` + testes | F3 | T3 |
| `_shared/promocoes/ml.ts`, `_shared/operacoes/ml.ts`, `_shared/ml/varrer-itens.ts`, `_shared/ml/descobrir-familia-up.ts` + testes | F4 | T4 |
| `pulse-coletar/processar.ts`, `acompanhar-migracao-pxv/{index.ts, leitura-ml.ts}`, `_shared/pulse/parse.ts` (comentário) + testes | F5 | T5 |
| docs vivas + alinhamento da spec | F6 | T6 |

Caminhos que começam por `_shared/` ou pelo nome de uma edge são relativos a `supabase/functions/`. Worktree: `/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/verif-items-bulk`, branch `worktree-ml-items-bulk`.

---

## Procedimentos comuns

### P-A/B (T1–T5)

1. Extrair `SHA_BASELINE_AB`:
   `rm -rf $CLAUDE_JOB_DIR/tmp/ab/base && mkdir -p $CLAUDE_JOB_DIR/tmp/ab/base && /usr/bin/git archive <SHA_BASELINE_AB> supabase/functions | tar -x -C $CLAUDE_JOB_DIR/tmp/ab/base`
2. `python3 $CLAUDE_JOB_DIR/tmp/ab/rodar.py <fatia> $CLAUDE_JOB_DIR/tmp/ab/base/supabase/functions <worktree>/supabase/functions`. Para cada org (as 4):
   - fase A: baseline, com gravação;
   - fase B: árvore nova, com replay;
   - fase A': baseline com replay, só se houver diferença.
3. **Critério:**
   - B == A, sob a canonização do cenário;
   - **registro de violações vazio** nas duas fases;
   - escritas simuladas idênticas, em sequência, com método, rota e corpo;
   - nenhuma gravação sobrando;
   - nenhum GET com HTTP ≥ 400, exceto 404 e o erro **declarado** do cenário;
   - cobertura por capacidade satisfeita (ver `CAPACIDADES` em T0 Step 7).
   - Se A ≠ B e A' == B, é deriva de dados ao vivo: repetir até 3 vezes.
   - Qualquer outra diferença bloqueia até ser explicada e aceita pelo Diego.
4. **Não há A/B pós-deploy.** O que prova que o código implantado é o código que passou no A/B é o manifesto: o hash de cada arquivo baixado de cada edge é igual ao do mesmo arquivo em `SHA_MAIN`, e a árvore de `SHA_MAIN` é a que passou no A/B, já que a fatia entra em fast-forward.

### P-Extração (T3, T5)

O A/B ao vivo **não** valida a extração: os símbolos novos não existem no commit anterior (Codex r2, achado 7). A validação da extração é:
1. Testes de caracterização da função extraída, com URL e envelope **antigos**. Eles fixam o comportamento atual e passam no commit da extração.
2. Commit de extração **só de movimento**: `/usr/bin/git diff --color-moved=zebra --color-moved-ws=allow-indentation-change HEAD~1 -- <arquivos>` mostra só blocos movidos, mais import/export e a chamada no lugar antigo. Qualquer linha alterada dentro do bloco movido precisa estar listada e justificada no commit (por exemplo, `getToken` passado como parâmetro).
3. O Codex revisa o commit de extração **isolado**, antes do commit do bulk.
4. O A/B da fatia usa `SHA_BASELINE_AB` = commit da extração. O manifesto pré-deploy compara a produção com `SHA_PRODUCAO`, que ainda é o anterior à extração. Só os arquivos que **não** mudaram na extração precisam bater.

### P-Deploy (T1–T5, só depois do merge)

1. `python3 $CLAUDE_JOB_DIR/tmp/edges_afetadas.py <arquivos alterados na fatia>`. O script recusa lista vazia e grafo com qualquer erro.
2. **Rollback pronto antes do deploy:**
   - `rm -rf $CLAUDE_JOB_DIR/tmp/rollback-<fatia> && mkdir -p $CLAUDE_JOB_DIR/tmp/rollback-<fatia> && /usr/bin/git archive <SHA_PRODUCAO> supabase | tar -x -C $CLAUDE_JOB_DIR/tmp/rollback-<fatia>`. Isso traz o projeto completo: `supabase/config.toml`, `supabase/functions/deno.json`, `_shared` e os `deno.lock` versionados.
   - `deno check` no `index.ts` de cada edge da lista dentro desse diretório.
3. `python3 $CLAUDE_JOB_DIR/tmp/manifesto.py antes <fatia> <SHA_PRODUCAO> <SHA_MAIN> <edges>`. Para cada edge:
   - lê a listagem, baixa o snapshot e lê a listagem de novo;
   - exige versão, `verify_jwt` e `ezbr_sha256` estáveis e conhecidos;
   - grava o hash de cada arquivo;
   - cada arquivo baixado deve bater com `SHA_PRODUCAO`, **exceto** os que a fatia altera, que batem com `SHA_PRODUCAO` e diferem de `SHA_MAIN`.
   Qualquer outra divergência bloqueia.
4. Conferir que `origin/main` == HEAD local e que nenhuma edge da lista mudou de versão desde o passo 3. O manifesto `antes` grava as versões; `manifesto.py estavel <fatia>` compara com uma listagem nova.
5. `supabase functions deploy <edges…> --project-ref txvncrgkoynoxwopfkbp`, na raiz do worktree.
6. `python3 $CLAUDE_JOB_DIR/tmp/manifesto.py depois <fatia> <SHA_MAIN> <edges>`. Para cada edge:
   - cada arquivo baixado bate com `SHA_MAIN`;
   - `verify_jwt` igual ao de antes;
   - versão incrementada;
   - `ezbr_sha256` mudou se e só se algum arquivo do bundle mudou.
   Qualquer falha é **deploy parcial**: completar o deploy da edge que faltou ou fazer rollback de todas, e não avançar de fatia.
7. **Rollback** (só até 25/10):
   - `supabase functions deploy <edges…> --project-ref txvncrgkoynoxwopfkbp --workdir $CLAUDE_JOB_DIR/tmp/rollback-<fatia>`. O `config.toml` do `SHA_PRODUCAO` define `verify_jwt`.
   - Depois, `manifesto.py depois <fatia>-rollback <SHA_PRODUCAO> <edges>`, que confere arquivos e `verify_jwt` contra o manifesto `antes`.
   - O código volta por branch `revert/<fatia>` → CI → fast-forward.
   - Depois de 25/10 não há rollback para o endpoint antigo, só correção para a frente.
   - **Risco aceito, decisão do Diego (Codex r3, achado 8):** a CLI 2.101 resolve dependências no bundler remoto, e há imports por faixa (`jsr:@supabase/supabase-js@2`, `npm:@upstash/qstash@^2`). Por isso o rollback reconstrói as **mesmas fontes** com resolução de dependências do momento, igual a qualquer deploy de rotina deste projeto, e não reproduz byte a byte o bundle antigo. A conferência pós-rollback prova as fontes e o `verify_jwt`. O `ezbr_sha256` pode diferir do antigo, e isso fica registrado, sem bloquear. Congelar dependências (vendor) seria mudança de infraestrutura fora do escopo.

### P-Observação (T1–T5)

- Logs pelo endpoint de analytics da Management API, com `iso_timestamp_start/end`: do deploy até a 1ª execução real + 10 min.
- Procurar `items/bulk`, `Too many IDs`, `Duplicate item id`, ` 400`, `TypeError` e `multiget`.
- Critério: zero erro novo e a comparação **por id e campo** definida na fatia.
- Prazo: 24 h. Sem execução real, registrar "não observado; coberto por teste + A/B + manifesto".

### P-Revisão Codex (T0–T6)

`/usr/bin/git diff <SHA_BASELINE_AB>..HEAD > $CLAUDE_JOB_DIR/tmp/diff-<fatia>.patch`. Prompt em `$CLAUDE_JOB_DIR/tmp/prompt-rev-<fatia>.txt`:

```
Revisão MINUCIOSA do diff em $CLAUDE_JOB_DIR/tmp/diff-<fatia>.patch (fatia <N> da migração /items?ids= → /items/bulk; spec docs/superpowers/specs/2026-10-03-ml-items-bulk-design.md; plano docs/superpowers/plans/2026-10-03-ml-items-bulk.md v3). Leia o código completo dos arquivos tocados. Promessa: decisões de negócio equivalentes; diferenças só as do spec §4.3; regra do adaptador das Global Constraints. Procure: mudança de particionamento, predicado, throw/[]/continue, não-array, contagem/momento de getToken; adaptador aplicado com ids errados; teste que não prova o que diz; risco de escrita no ML. Achados com arquivo:linha e severidade (BLOQUEANTE/IMPORTANTE/MENOR). Termine com VEREDITO: APROVADO ou VEREDITO: REVISAR.
```

`codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only - < $CLAUDE_JOB_DIR/tmp/prompt-rev-<fatia>.txt > $CLAUDE_JOB_DIR/tmp/rev-<fatia>.txt 2>&1`, em background. Corrigir os bloqueantes. Correção estrutural volta ao Codex uma vez.

### P-Portão de merge (T1–T6)

1. `pnpm preflight`.
2. `/usr/bin/git push origin worktree-ml-items-bulk` e `gh run watch` (CI verde).
3. **Parar e reportar ao Diego:**
   - testes;
   - A/B (orgs, n de ids, capacidades cobertas ou N/A, 0 diferenças, 0 violações);
   - Codex;
   - edges;
   - decisões.
   Esperar o OK.
4. Registrar `SHA_AB_APROVADO` (o HEAD que passou no A/B, na revisão e no OK do Diego) em `$CLAUDE_JOB_DIR/tmp/aprovado-<fatia>.txt`.
5. Com o OK: `/usr/bin/git fetch origin`. Se a `origin/main` andou:
   - `/usr/bin/git merge origin/main`, testes e CI de novo;
   - **se `/usr/bin/git diff --stat <SHA_AB_APROVADO> HEAD -- supabase` não estiver vazio, a árvore mudou**: novo A/B (com `SHA_BASELINE_AB` = `origin/main` antes da fatia), revisão do Codex só do merge e novo OK do Diego. Só então o novo HEAD vira `SHA_AB_APROVADO`.
   - Nunca implantar uma árvore cujo `supabase/` difere do `SHA_AB_APROVADO`.
6. `/usr/bin/git push origin HEAD:main`, depois P-Deploy e P-Observação.

---

### Task T0: adaptador, fixtures, ADR-0177 e ferramental (sem deploy)

**Files:**
- Create: `supabase/functions/_shared/ml/multiget.ts`, `supabase/functions/_shared/ml/__tests__/multiget.test.ts`, `supabase/functions/_shared/ml/__tests__/fixtures/bulk-<conj>-{antigo,bulk,ids}.json`, `docs/decisions/0177-multiget-ml-items-bulk.md`
- Create (fora do repo): `$CLAUDE_JOB_DIR/tmp/ab/{guarda.ts, guarda.test.ts, cenarios.ts, ab.ts, rodar.py}`, `$CLAUDE_JOB_DIR/tmp/{fixtures.py, edges_afetadas.py, manifesto.py}`

**Interfaces:**
- Produces:
  - `caminhoMultiget(ids: readonly string[], campos: string, extra?: string): string`
  - `comoEnvelopeAntigo(json: unknown, idsPedidos: readonly string[]): unknown`

- [ ] **Step 1: Fixtures alinhados por id, sem cortar atributos**

`$CLAUDE_JOB_DIR/tmp/fixtures.py`:

```python
import json, pathlib
SPK = pathlib.Path('/Users/diego/.claude/jobs/b87cbc02/tmp/spike')
DST = pathlib.Path('/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/verif-items-bulk/supabase/functions/_shared/ml/__tests__/fixtures')
DST.mkdir(parents=True, exist_ok=True)
INVALIDO = 'MLB0000000001'
USADOS = {'GTIN', 'COLOR', 'UNITS_PER_PACK', 'SALE_FORMAT', 'BRAND', 'MODEL'}  # atributos lidos pelos consumidores

def carregar(nome): return json.loads((SPK / nome).read_text())
def por_id(arr): return {(e.get('body') or {}).get('id'): e for e in arr if (e.get('body') or {}).get('id')}

def escolher(antigo):
    ok = [i for i, e in por_id(antigo).items() if e.get('code') == 200]
    def peso(i):
        b = por_id(antigo)[i]['body']
        attrs = {a.get('id') for a in (b.get('attributes') or [])}
        return (-len(attrs & USADOS), -int(bool(b.get('variations'))), i)
    return sorted(ok, key=peso)[:3]

def gravar(conj, antigo, bulk, ids, com_invalido):
    A, B = por_id(antigo), por_id(bulk)
    assert all(i in A and i in B for i in ids), (conj, ids)
    lado_antigo = [A[i] for i in ids]
    lado_bulk = [B[i] for i in ids]
    if com_invalido:
        lado_antigo += [e for e in antigo if (e.get('body') or {}).get('id') == INVALIDO][:1]
        lado_bulk += [e for e in bulk if e.get('status_code') == 404 and not e.get('body')][:1]
        assert len(lado_antigo) == len(lado_bulk) == len(ids) + 1, conj
    for lado, arr in (('antigo', lado_antigo), ('bulk', lado_bulk)):
        (DST / f'bulk-{conj}-{lado}.json').write_text(json.dumps(arr, ensure_ascii=False, indent=1) + '\n')
    (DST / f'bulk-{conj}-ids.json').write_text(json.dumps(ids + ([INVALIDO] if com_invalido else [])) + '\n')

for conj in ['canais', 'atualizar_item', 'buscar_item', 'descobrir_familia', 'varrer_itens', 'vendas',
             'pedidos_pxv_cores', 'kit_virtual', 'componentes_kit', 'operacoes', 'pulse', 'pxv_estoque', 'promocoes']:
    antigo, bulk = carregar(f'{conj}-antigo.json'), carregar(f'{conj}-bulk.json')
    gravar(conj.replace('_', '-'), antigo, bulk, escolher(antigo), True)
for org, nome in [('DSA', 'kit'), ('Avil', 'catalogo'), ('Avil', 'relacionados')]:
    antigo, bulk = carregar(f'{org}-{nome}-antigo.json'), carregar(f'{org}-{nome}-bulk.json')
    gravar(nome, antigo, bulk, sorted(set(por_id(antigo)) & set(por_id(bulk)))[:3], False)
for p in sorted(DST.glob('bulk-*-bulk.json')): print(p.name, p.stat().st_size)
```

Run: `python3 $CLAUDE_JOB_DIR/tmp/fixtures.py`. Conferir:
- `grep -L status_code fixtures/bulk-*-bulk.json` → vazio;
- `grep -l '"code"' fixtures/bulk-*-bulk.json` → vazio;
- `grep -c '"GTIN"' fixtures/bulk-pedidos-pxv-cores-antigo.json fixtures/bulk-vendas-antigo.json` → ≥1 cada;
- `grep -c '"COLOR"' fixtures/bulk-pedidos-pxv-cores-antigo.json` → ≥1.

Tamanho total esperado: menos de 150 KB.

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
/** Por id (a ordem do antigo é arbitrária), `tags` ordenado, body de erro reduzido ao id (spec §4.3). */
const normalizar = (arr: unknown) =>
  (arr as Env[]).map((e) => ({
    code: e.code,
    body: e.code === 200 ? { ...e.body, ...(e.body?.tags ? { tags: [...e.body.tags].sort() } : {}) } : { id: e.body?.id },
  })).sort((a, b) => String(a.body.id).localeCompare(String(b.body.id)));

describe('caminhoMultiget', () => {
  it('status_code primeiro e prefixo body. em cada campo, na ordem dada', () => {
    expect(caminhoMultiget(['MLB1', 'MLB2'], 'id,status,price'))
      .toBe('/items/bulk?ids=MLB1,MLB2&attributes=status_code,body.id,body.status,body.price');
  });
  it('deduplica DENTRO da requisição, preservando a 1ª ocorrência', () => {
    expect(caminhoMultiget(['MLB2', 'MLB1', 'MLB2'], 'id')).toBe('/items/bulk?ids=MLB2,MLB1&attributes=status_code,body.id');
  });
  it('21 posições com 20 únicos → 20 na URL (o antigo deduplicava antes do limite)', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `MLB${i}`);
    expect(new URL(`https://x${caminhoMultiget([...ids, ids[0]], 'id')}`).searchParams.get('ids')!.split(',')).toEqual(ids);
  });
  it('não divide, não filtra, não lança', () => {
    const ids = Array.from({ length: 21 }, (_, i) => `MLB${i}`);
    expect(new URL(`https://x${caminhoMultiget(ids, 'id')}`).searchParams.get('ids')!.split(',')).toHaveLength(21);
    expect(() => caminhoMultiget([], 'id')).not.toThrow();
  });
  it('extra no fim e id codificado', () => {
    expect(caminhoMultiget(['MLB 1'], 'id', '&include_attributes=all'))
      .toBe('/items/bulk?ids=MLB%201&attributes=status_code,body.id&include_attributes=all');
  });
});

describe('comoEnvelopeAntigo', () => {
  it.each(CONJUNTOS)('%s: bulk real vira o envelope antigo dos mesmos ids', async (c) => {
    const ids = (await carregar(c, 'ids')) as string[];
    expect(normalizar(comoEnvelopeAntigo(await carregar(c, 'bulk'), ids))).toEqual(normalizar(await carregar(c, 'antigo')));
  });
  it('404 sem body recebe o id pela posição, com as posições confirmadas', () => {
    expect(comoEnvelopeAntigo(
      [{ status_code: 200, body: { id: 'MLB1' } }, { status_code: 404 }, { status_code: 200, body: { id: 'MLB3' } }],
      ['MLB1', 'MLB2', 'MLB3'],
    )).toEqual([{ code: 200, body: { id: 'MLB1' } }, { code: 404, body: { id: 'MLB2' } }, { code: 200, body: { id: 'MLB3' } }]);
  });
  it('posição conta sobre os ids únicos enviados', () => {
    expect(comoEnvelopeAntigo([{ status_code: 200, body: { id: 'MLB1' } }, { status_code: 404 }], ['MLB1', 'MLB1', 'MLB2']))
      .toEqual([{ code: 200, body: { id: 'MLB1' } }, { code: 404, body: { id: 'MLB2' } }]);
  });
  it('posições contraditórias (mesma cardinalidade) → nenhum id fabricado', () => {
    expect(comoEnvelopeAntigo([{ status_code: 200, body: { id: 'MLB2' } }, { status_code: 404 }], ['MLB1', 'MLB2']))
      .toEqual([{ code: 200, body: { id: 'MLB2' } }, { code: 404 }]);
  });
  it('cardinalidade diferente → só traduz o código', () => {
    expect(comoEnvelopeAntigo([{ status_code: 404 }], ['MLB1', 'MLB2'])).toEqual([{ code: 404 }]);
  });
  it('200 ou 500 sem body NUNCA ganham body (no antigo ficavam fora; senão lerRelacoes aceitaria item vazio)', () => {
    expect(comoEnvelopeAntigo([{ status_code: 200 }], ['MLB1'])).toEqual([{ code: 200 }]);
    expect(comoEnvelopeAntigo([{ status_code: 500 }], ['MLB1'])).toEqual([{ code: 500 }]);
  });
  it('entrada no formato antigo volta intacta (inclusive sem body e com code null)', () => {
    const antigo = [{ code: 404, body: { id: 'MLB9', message: 'x' } }, { code: 404 }, { code: null, status_code: 200 }];
    const r = comoEnvelopeAntigo(antigo, ['MLB9', 'MLB8', 'MLB7']) as unknown[];
    expect(r).toEqual(antigo);
    r.forEach((e, i) => expect(e).toBe(antigo[i]));
  });
  it('não-array volta intacto', () => {
    const obj = { message: 'erro' };
    expect(comoEnvelopeAntigo(obj, ['MLB1'])).toBe(obj);
    expect(comoEnvelopeAntigo(null, ['MLB1'])).toBeNull();
    expect(comoEnvelopeAntigo('x', ['MLB1'])).toBe('x');
  });
  it('entrada que não é objeto volta intacta; o resto segue a regra (alinhamento desligado pelas não-objeto)', () => {
    expect(comoEnvelopeAntigo([null, 5, { status_code: 404 }], ['MLB1', 'MLB2', 'MLB3'])).toEqual([null, 5, { code: 404 }]);
  });
  it('body existente sem id é preservado', () => {
    expect(comoEnvelopeAntigo([{ status_code: 500, body: { message: 'x' } }], ['MLB1'])).toEqual([{ code: 500, body: { message: 'x' } }]);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar.** `pnpm test supabase/functions/_shared/ml/__tests__/multiget.test.ts` → FAIL (import).

- [ ] **Step 4: Implementar**

`supabase/functions/_shared/ml/multiget.ts`:

```ts
// Multiget de anúncios do ML via `/items/bulk` (`/items?ids=` sai do ar em 25/10/2026, ADR-0177).
// ADAPTADOR, não parser: entrega a resposta no envelope antigo `[{code, body}]` para que nenhum
// módulo mude predicado, laço ou tratamento de erro. Contrato medido em 03/10/2026 (spec §2):
// - seleção com `status_code` + `body.<campo>`; id repetido → 400 (o antigo deduplicava antes do limite);
// - id inexistente → `{status_code:404}` SEM body, na posição do id pedido.

const unicos = (ids: readonly string[]): string[] => [...new Set(ids)];

/** Caminho relativo do bulk. Dedup só dentro da requisição; não divide, não filtra, não lança. */
export function caminhoMultiget(ids: readonly string[], campos: string, extra = ''): string {
  const sel = campos.split(',').map((c) => `body.${c}`).join(',');
  return `/items/bulk?ids=${unicos(ids).map(encodeURIComponent).join(',')}&attributes=status_code,${sel}${extra}`;
}

type Obj = Record<string, unknown>;
const ehObj = (e: unknown): e is Obj => !!e && typeof e === 'object' && !Array.isArray(e);
const idDe = (e: Obj): unknown => (ehObj(e.body) ? e.body.id : undefined);

/**
 * Resposta do bulk → envelope antigo. Regras (Codex r2, achados 1 e 2):
 * - não-array volta intacto; entrada não-objeto ou já no formato antigo (tem `code`) volta intacta;
 * - entrada bulk vira `{code: status_code, body?}`;
 * - SÓ o 404 sem body ganha `body: {id}`, pela posição, e só se a cardinalidade bate com os ids
 *   únicos enviados E todo id presente está na sua posição. 200/500 sem body nunca ganham body.
 */
export function comoEnvelopeAntigo(json: unknown, idsPedidos: readonly string[]): unknown {
  if (!Array.isArray(json)) return json;
  const enviados = unicos(idsPedidos);
  const alinhado = json.length === enviados.length && json.every((e, i) => {
    if (!ehObj(e)) return false;
    const id = idDe(e);
    return id === undefined || id === enviados[i];
  });
  return json.map((e, i) => {
    if (!ehObj(e) || 'code' in e) return e;
    const out: Obj = { code: e.status_code };
    if ('body' in e) out.body = e.body;
    else if (alinhado && e.status_code === 404) out.body = { id: enviados[i] };
    return out;
  });
}
```

- [ ] **Step 5: Rodar e ver passar.** → PASS.

- [ ] **Step 6: Guarda com replay, allowlist por cenário e registro fatal**

`$CLAUDE_JOB_DIR/tmp/ab/guarda.ts`:

```ts
// Guarda do A/B. Fase 'gravar': GET em api.mercadolibre.com vai à rede e é gravado (exceto multiget).
// Fase 'replay': GET não-multiget sai da gravação; multiget vai à rede. Escrita só se o cenário
// corrente permitir a rota e os campos do corpo; resposta simulada, sem rede. TODA violação vai para
// `violacoes`, um registro fatal que o runner reprova mesmo se o consumidor engolir a exceção.
export type Gravacao = { url: string; status: number; corpo: string };
export type Escrita = { cenario: string; metodo: string; url: string; corpo: string | null };
export type ChamadaGet = { cenario: string; url: string; status: number | 'falha' };
export type Permissao = { metodo: 'PUT'; rota: RegExp; camposCorpo: string[]; valores?: Record<string, unknown[]> };
const MULTIGET = /\/items(\/bulk)?\?ids=/;

export function criarGuarda(opts: { fase: 'gravar' | 'replay'; gravadas?: Gravacao[]; fetchReal?: typeof fetch }) {
  const fetchReal = opts.fetchReal ?? globalThis.fetch.bind(globalThis);
  const fila = new Map<string, Gravacao[]>();
  for (const g of opts.gravadas ?? []) fila.set(g.url, [...(fila.get(g.url) ?? []), g]);
  const estado = { cenario: '-', permissoes: [] as Permissao[] };
  const gravacoes: Gravacao[] = [], escritas: Escrita[] = [], gets: ChamadaGet[] = [], violacoes: string[] = [];
  const violar = (msg: string): never => { violacoes.push(`[${estado.cenario}] ${msg}`); throw new Error(`GUARDA: ${msg}`); };

  const fetchGuardado = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const u = new URL(req.url);
    if (u.protocol !== 'https:' || u.hostname !== 'api.mercadolibre.com' || (u.port && u.port !== '443')) violar(`destino proibido ${u.origin}`);
    if (req.method !== 'GET') {
      const corpo = req.body ? await req.text() : null;
      escritas.push({ cenario: estado.cenario, metodo: req.method, url: req.url, corpo });
      const p = estado.permissoes.find((x) => x.metodo === req.method && x.rota.test(u.pathname));
      let obj: Record<string, unknown> = {};
      try { obj = corpo ? JSON.parse(corpo) : {}; } catch { violar(`corpo não-JSON em ${req.method} ${u.pathname}`); }
      const okCampos = p && Object.keys(obj).every((k) => p.camposCorpo.includes(k))
        && Object.entries(p.valores ?? {}).every(([k, vs]) => vs.includes(obj[k]));
      if (!okCampos) violar(`escrita não permitida ${req.method} ${u.pathname} ${corpo ?? ''}`);
      return new Response(JSON.stringify({ id: u.pathname.split('/')[2], ...obj }), { status: 200 });
    }
    if (opts.fase === 'replay' && !MULTIGET.test(req.url)) {
      const g = fila.get(req.url)?.shift();
      if (!g) violar(`GET sem gravação no replay ${req.url}`);
      gets.push({ cenario: estado.cenario, url: req.url, status: g!.status });
      return new Response(g!.corpo, { status: g!.status });
    }
    let r: Response;
    let corpo: string;
    try {
      r = await fetchReal(req);
      if (r.status === 401 || r.status === 403) {
        gets.push({ cenario: estado.cenario, url: req.url, status: r.status });
        return violar(`HTTP ${r.status} (token expirado? não renovar) ${u.pathname}`);
      }
      corpo = await r.text(); // corpo interrompido também é falha de transporte fatal
    } catch (e) {
      if ((e as Error).message.startsWith('GUARDA:')) throw e;
      gets.push({ cenario: estado.cenario, url: req.url, status: 'falha' });
      return violar(`falha de transporte ${u.pathname}: ${(e as Error).message}`);
    }
    gets.push({ cenario: estado.cenario, url: req.url, status: r.status });
    if (!MULTIGET.test(req.url)) gravacoes.push({ url: req.url, status: r.status, corpo });
    return new Response(corpo, { status: r.status, headers: r.headers });
  };
  return {
    fetchGuardado, gravacoes, escritas, gets, violacoes,
    entrarCenario: (nome: string, permissoes: Permissao[] = []) => { estado.cenario = nome; estado.permissoes = permissoes; },
    sobras: () => [...fila.values()].flat().map((g) => g.url),
  };
}
```

`$CLAUDE_JOB_DIR/tmp/ab/guarda.test.ts`:

```ts
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { criarGuarda } from './guarda.ts';

function espiao() {
  const vistos: Array<{ metodo: string; url: string }> = [];
  const f = ((input: RequestInfo | URL, init?: RequestInit) => {
    const r = new Request(input, init); vistos.push({ metodo: r.method, url: r.url });
    return Promise.resolve(new Response('[]', { status: 200 }));
  }) as typeof fetch;
  return { f, vistos };
}
const STATUS = [{ metodo: 'PUT' as const, rota: /^\/items\/MLB\d+$/, camposCorpo: ['status'], valores: { status: ['paused', 'active'] } }];

Deno.test('GET no ML vai ao fetch real; gravado exceto multiget', async () => {
  const { f, vistos } = espiao();
  const g = criarGuarda({ fase: 'gravar', fetchReal: f });
  await g.fetchGuardado('https://api.mercadolibre.com/items/MLB1?attributes=id');
  await g.fetchGuardado('https://api.mercadolibre.com/items/bulk?ids=MLB1&attributes=status_code,body.id');
  assertEquals(vistos.map((v) => v.metodo), ['GET', 'GET']);
  assertEquals(g.gravacoes.map((x) => x.url), ['https://api.mercadolibre.com/items/MLB1?attributes=id']);
  assertEquals(g.violacoes, []);
});
Deno.test('PUT de status permitido no cenário: simulado, sem rede, registrado (string, Request, init.method)', async () => {
  const { f, vistos } = espiao();
  const g = criarGuarda({ fase: 'gravar', fetchReal: f });
  g.entrarCenario('propagar', STATUS);
  await g.fetchGuardado('https://api.mercadolibre.com/items/MLB1', { method: 'PUT', body: '{"status":"paused"}' });
  await g.fetchGuardado(new Request('https://api.mercadolibre.com/items/MLB2', { method: 'PUT', body: '{"status":"active"}' }));
  await g.fetchGuardado(new Request('https://api.mercadolibre.com/items/MLB3'), { method: 'PUT', body: '{"status":"paused"}' });
  assertEquals(vistos, []);
  assertEquals(g.escritas.map((e) => e.url.slice(-4)), ['MLB1', 'MLB2', 'MLB3']);
  assertEquals(g.violacoes, []);
});
Deno.test('PUT com outro campo (preço/estoque) ou fora do cenário → violação fatal, mesmo se engolida', async () => {
  const { f, vistos } = espiao();
  const g = criarGuarda({ fase: 'gravar', fetchReal: f });
  g.entrarCenario('propagar', STATUS);
  await g.fetchGuardado('https://api.mercadolibre.com/items/MLB1', { method: 'PUT', body: '{"price":1}' }).catch(() => {});
  g.entrarCenario('lerStatus');
  await g.fetchGuardado('https://api.mercadolibre.com/items/MLB1', { method: 'PUT', body: '{"status":"paused"}' }).catch(() => {});
  await g.fetchGuardado('https://api.mercadolibre.com/items', { method: 'POST', body: '{}' }).catch(() => {});
  await g.fetchGuardado('https://api.mercadolibre.com/items/MLB1', { method: 'DELETE' }).catch(() => {});
  assertEquals(vistos, []);
  assertEquals(g.violacoes.length, 4);
});
Deno.test('destino proibido → violação, sem rede', async () => {
  const { f, vistos } = espiao();
  const g = criarGuarda({ fase: 'gravar', fetchReal: f });
  for (const u of ['https://example.com/', 'http://api.mercadolibre.com/items/MLB1', 'https://api.mercadolibre.com:8443/x']) {
    await assertRejects(() => g.fetchGuardado(u), Error, 'destino proibido');
  }
  assertEquals(vistos, []);
  assertEquals(g.violacoes.length, 3);
});
Deno.test('replay: não-multiget da gravação; faltante e sobra detectáveis; multiget vai à rede', async () => {
  const { f, vistos } = espiao();
  const g = criarGuarda({ fase: 'replay', fetchReal: f, gravadas: [
    { url: 'https://api.mercadolibre.com/a', status: 200, corpo: '{"x":1}' },
    { url: 'https://api.mercadolibre.com/b', status: 200, corpo: '{}' },
  ] });
  assertEquals(await (await g.fetchGuardado('https://api.mercadolibre.com/a')).json(), { x: 1 });
  assertEquals(g.sobras(), ['https://api.mercadolibre.com/b']);
  await g.fetchGuardado('https://api.mercadolibre.com/a').catch(() => {});
  assertEquals(g.violacoes.length, 1);
  await g.fetchGuardado('https://api.mercadolibre.com/items/bulk?ids=MLB1&attributes=status_code,body.id');
  assertEquals(vistos.length, 1);
});
Deno.test('401, falha de transporte e corpo interrompido → violação fatal', async () => {
  const g1 = criarGuarda({ fase: 'gravar', fetchReal: (() => Promise.resolve(new Response('{}', { status: 401 }))) as typeof fetch });
  await g1.fetchGuardado('https://api.mercadolibre.com/items/MLB1').catch(() => {});
  assertEquals(g1.violacoes.length, 1);
  const g2 = criarGuarda({ fase: 'gravar', fetchReal: (() => Promise.reject(new Error('reset'))) as typeof fetch });
  await g2.fetchGuardado('https://api.mercadolibre.com/items/MLB1').catch(() => {});
  assertEquals(g2.violacoes.length, 1);
  assertEquals(g2.gets[0].status, 'falha');
  const quebrado = new ReadableStream({ start(c) { c.error(new Error('corpo cortado')); } });
  const g3 = criarGuarda({ fase: 'gravar', fetchReal: (() => Promise.resolve(new Response(quebrado, { status: 200 }))) as typeof fetch });
  await g3.fetchGuardado('https://api.mercadolibre.com/items/MLB1').catch(() => {});
  assertEquals(g3.violacoes.length, 1);
  assertEquals(g3.gets[0].status, 'falha');
});
```

Run: `deno test --no-prompt --allow-read $CLAUDE_JOB_DIR/tmp/ab/guarda.test.ts` (sem `--allow-net`) → 6 passed.

- [ ] **Step 7: Cenários, capacidades e runner**

`$CLAUDE_JOB_DIR/tmp/ab/cenarios.ts`:

```ts
import type { Permissao } from './guarda.ts';
export type Ctx = {
  token: string; imp: (p: string) => Promise<any>;
  amostra: { ids: string[]; catalogo: string[]; kits: string[]; sellerId: string; skuPorItem: Record<string, string> };
};
/** capacidade: o que o cenário prova quando há dado; 'na' = a org não tem o dado (não conta como coberto). */
export type Cobertura = 'coberto' | 'na';
export type Cenario = {
  nome: string; fatia: string; capacidade: string; permissoes?: Permissao[];
  rodar: (c: Ctx) => Promise<unknown>; canon: (v: unknown) => unknown;
  cobertura: (v: any, c: Ctx) => Cobertura | 'falhou';
  erroEsperado?: { status: number; mensagem: RegExp; idsNoGet: number };
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
const comRepetidos = (xs: string[]) => [...xs, xs[0], xs[1]];
const INVALIDO = 'MLB0000000001';
const STATUS: Permissao[] = [{ metodo: 'PUT', rota: /^\/items\/MLB\d+$/, camposCorpo: ['status'], valores: { status: ['paused', 'active'] } }];
const getItem = async (c: Ctx, id: string, campos: string) =>
  (await fetch(`https://api.mercadolibre.com/items/${id}?attributes=${campos}`, { headers: { Authorization: `Bearer ${c.token}` } })).json();

const propagar = (status: 'paused' | 'active'): Cenario['rodar'] => async (c) => {
  const { propagarStatusRelacionadosML } = await c.imp('_shared/ml/atualizar-item.ts');
  const out: Record<string, unknown> = {};
  for (const id of c.amostra.catalogo) {
    // evidência: quantos relacionados o item tem (sem relacionado não há multiget nem PUT para provar nada)
    const rel = ((await getItem(c, id, 'id,item_relations')).item_relations ?? []).length;
    try { await propagarStatusRelacionadosML(c.token, id, status); out[id] = { ok: true, relacionados: rel }; }
    catch (e) { out[id] = { erro: (e as Error).message, relacionados: rel }; }
  }
  return out; // as escritas simuladas são comparadas em sequência pelo runner
};
const coberturaPropagar: Cenario['cobertura'] = (v, c) => {
  if (c.amostra.catalogo.length === 0) return 'na';
  const rs = Object.values(v) as Array<{ ok?: boolean; relacionados: number }>;
  if (!rs.every((r) => r.ok)) return 'falhou';
  return rs.some((r) => r.relacionados > 0) ? 'coberto' : 'na';
};
const descobrirCanon = (v: unknown) => ord(Object.fromEntries(Object.entries(v as Record<string, any>).map(([k, r]) => [k,
  r?.tipo === 'achada' ? { ...r, familia: { ...r.familia, itemPorCor: Object.fromEntries([...r.familia.itemPorCor.entries()]), coresAmbiguas: [...r.familia.coresAmbiguas].sort() } }
  : r?.tipo === 'ambigua' ? { ...r, familyIds: [...r.familyIds].sort() } : r])));

export const CENARIOS: Cenario[] = [
  // F1
  { nome: 'lerStatus', fatia: 'F1', capacidade: 'status', canon: estrito,
    rodar: async (c) => (await c.imp('_shared/canais/mercado-livre.ts')).mercadoLivreConnector
      .lerStatus({ getToken: async () => c.token }, comRepetidos([...c.amostra.ids, ...c.amostra.catalogo, INVALIDO])),
    cobertura: (v) => (Object.values(v).some((s: any) => s.status !== 'indisponivel') && v[INVALIDO]?.status === 'indisponivel' ? 'coberto' : 'falhou') },
  { nome: 'propagarPausar', fatia: 'F1', capacidade: 'catalogo', permissoes: STATUS, canon: estrito, rodar: propagar('paused'), cobertura: coberturaPropagar },
  { nome: 'propagarAtivar', fatia: 'F1', capacidade: 'catalogo', permissoes: STATUS, canon: estrito, rodar: propagar('active'), cobertura: coberturaPropagar },
  { nome: 'buscarItemPorSku', fatia: 'F1', capacidade: 'adocao', canon: estrito,
    rodar: async (c) => {
      const { buscarItemPorSku } = await c.imp('_shared/ml/buscar-item.ts');
      const out: Record<string, unknown> = {};
      for (const [item, sku] of Object.entries(c.amostra.skuPorItem)) {
        const det = await getItem(c, item, 'id,category_id,family_name');
        if (!det.family_name) continue;
        out[item] = await buscarItemPorSku(fetch, { accessToken: c.token, sellerId: c.amostra.sellerId,
          categoriaId: det.category_id, familyName: det.family_name, desdeMs: 0 }, sku);
        if (Object.keys(out).length >= 3) break;
      }
      return out;
    },
    cobertura: (v) => (Object.keys(v).length === 0 ? 'na' : Object.values(v).some((r: any) => r.tipo === 'um' || r.tipo === 'ambiguo') ? 'coberto' : 'falhou') },
  // F2
  { nome: 'gtinsPedidos', fatia: 'F2', capacidade: 'gtin', canon: estrito,
    rodar: async (c) => (await c.imp('_shared/ml/pedidos.ts')).buscarGtinsDosItens(c.token, comRepetidos([...c.amostra.ids, INVALIDO])),
    cobertura: (v) => (Object.keys(v).length > 0 ? 'coberto' : 'na') },
  { nome: 'titulosEGtins', fatia: 'F2', capacidade: 'titulos', canon: estrito,
    rodar: async (c) => (await c.imp('_shared/ml/vendas.ts')).buscarTitulosEGtins(c.token, comRepetidos([...c.amostra.ids, INVALIDO]), AbortSignal.timeout(60_000)),
    cobertura: (v, c) => (Object.keys(v.titulos).length >= c.amostra.ids.length ? 'coberto' : 'falhou') },
  // F3
  { nome: 'listingTypes', fatia: 'F3', capacidade: 'kit', canon: estrito,
    rodar: async (c) => (await c.imp('_shared/ml/kit-virtual.ts')).buscarListingTypeItensML(c.token, comRepetidos([...c.amostra.ids, ...c.amostra.kits, INVALIDO])),
    cobertura: (v: Map<string, string>, c) => (c.amostra.kits.length === 0 ? 'na' : c.amostra.kits.every((k) => v.has(k)) ? 'coberto' : 'falhou') },
  { nome: 'componentes', fatia: 'F3', capacidade: 'userProduct', canon: multiconjunto((x) => x.itemId),
    rodar: async (c) => (await c.imp('buscar-componentes-kit-virtual/leitura-ml.ts')).buscarUserProductIdsML(c.token, comRepetidos([...c.amostra.ids, INVALIDO])),
    cobertura: (v) => (v.some((x: any) => x.userProductId) ? 'coberto' : 'na') },
  // F4
  { nome: 'promocoesItens', fatia: 'F4', capacidade: 'promocoes', canon: estrito,
    rodar: async (c) => { const m = await c.imp('_shared/promocoes/ml.ts'); return m.buscarItensML(m.criarGetJson(c.token), comRepetidos([...c.amostra.ids, INVALIDO])); },
    cobertura: (v: Map<string, unknown>, c) => (v.size >= c.amostra.ids.length ? 'coberto' : 'falhou') },
  { nome: 'lerRelacoes', fatia: 'F4', capacidade: 'catalogo', canon: estrito,
    rodar: async (c) => {
      const cli = (await c.imp('_shared/operacoes/ml.ts')).criarClienteML(c.token);
      const out: Record<string, unknown> = {};
      for (const id of c.amostra.catalogo) { try { out[id] = await cli.lerRelacoes(id); } catch (e) { out[id] = { erro: (e as Error).message }; } }
      return out;
    },
    cobertura: (v, c) => (c.amostra.catalogo.length === 0 ? 'na' : Object.values(v).every((r: any) => !r.erro) ? 'coberto' : 'falhou') },
  { nome: 'detalharItens', fatia: 'F4', capacidade: 'orfaos', canon: multiconjunto((x) => x.id),
    rodar: async (c) => (await c.imp('_shared/ml/varrer-itens.ts')).detalharItens(fetch, c.token, comRepetidos([...c.amostra.ids, INVALIDO])),
    cobertura: (v, c) => (v.length >= c.amostra.ids.length ? 'coberto' : 'falhou') },
  { nome: 'descobrirFamiliaUP', fatia: 'F4', capacidade: 'familiaUP', canon: descobrirCanon,
    rodar: async (c) => {
      const { descobrirFamiliaUP } = await c.imp('_shared/ml/descobrir-familia-up.ts');
      const out: Record<string, unknown> = {};
      for (const item of c.amostra.ids.slice(0, 5)) {
        const det = await getItem(c, item, 'id,title,category_id');
        // o próprio item real faz o papel de "morto": fica fora dos candidatos, como a função espera
        out[item] = await descobrirFamiliaUP(fetch, { getToken: async () => c.token, sellerId: c.amostra.sellerId,
          titulo: det.title, categoriaId: det.category_id, itemMortoId: item });
      }
      return out;
    },
    cobertura: (v) => (Object.values(v).some((r: any) => r.tipo === 'achada') ? 'coberto' : 'na') },
  // F5
  { nome: 'situacaoPulse', fatia: 'F5', capacidade: 'pulse', canon: estrito,
    rodar: async (c) => (await c.imp('pulse-coletar/processar.ts')).lerSituacaoAnuncios([...new Set([...c.amostra.ids, INVALIDO])], c.token),
    cobertura: (v: Map<string, unknown>, c) => (v.size >= c.amostra.ids.length ? 'coberto' : 'falhou') },
  { nome: 'coresPxV', fatia: 'F5', capacidade: 'cor', canon: estrito,
    rodar: async (c) => (await c.imp('acompanhar-migracao-pxv/leitura-ml.ts')).lerCoresML(c.token, comRepetidos([...c.amostra.ids.slice(0, 17), INVALIDO])),
    cobertura: (v: Map<string, string | null>) => (v.size === 0 ? 'falhou' : [...v.values()].some((cor) => cor) ? 'coberto' : 'na') },
  { nome: 'estoqueVivoPxV', fatia: 'F5', capacidade: 'estoque', canon: estrito,
    rodar: async (c) => (await c.imp('acompanhar-migracao-pxv/leitura-ml.ts')).lerEstoqueVivoML(async () => c.token, comRepetidos([...c.amostra.ids.slice(0, 17), INVALIDO])),
    cobertura: (v: Map<string, number>) => (v.size >= 17 ? 'coberto' : 'falhou') },
  { nome: 'coresPxV21distintos', fatia: 'F5', capacidade: 'limite', canon: estrito,
    // o ab.ts também exige a prova: um GET multiget deste cenário com 21 ids distintos que voltou 400
    erroEsperado: { status: 400, mensagem: /multiget de cores falhou \(400\)/, idsNoGet: 21 },
    rodar: async (c) => (await c.imp('acompanhar-migracao-pxv/leitura-ml.ts')).lerCoresML(c.token, c.amostra.ids.slice(0, 21)),
    cobertura: () => 'coberto' },
];
/** Capacidade que precisa estar 'coberto' em PELO MENOS uma org (as demais podem ser 'na'). */
export const CAPACIDADES_OBRIGATORIAS: Record<string, string[]> = {
  F1: ['status', 'catalogo', 'adocao'], F2: ['gtin', 'titulos'], F3: ['kit', 'userProduct'],
  F4: ['promocoes', 'catalogo', 'orfaos', 'familiaUP'], F5: ['pulse', 'cor', 'estoque', 'limite'],
};
```

`$CLAUDE_JOB_DIR/tmp/ab/ab.ts` roda uma fase de uma árvore numa org, com seleção opcional de cenários (`AB_CENARIOS=nome1,nome2`):

```ts
import { criarGuarda, type Gravacao } from './guarda.ts';
import { CENARIOS } from './cenarios.ts';

const fase = Deno.env.get('AB_FASE') as 'gravar' | 'replay';
const arq = Deno.env.get('AB_GRAVADAS')!;
const guarda = criarGuarda({ fase, gravadas: fase === 'replay' ? JSON.parse(await Deno.readTextFile(arq)) as Gravacao[] : [] });
globalThis.fetch = guarda.fetchGuardado as typeof fetch; // ANTES de qualquer import do app
const arvore = Deno.env.get('AB_ARVORE')!;
const ctx = { token: Deno.env.get('ML_TOKEN')!, amostra: JSON.parse(Deno.env.get('AB_AMOSTRA')!), imp: (p: string) => import(`file://${arvore}/${p}`) };
const fatia = Deno.args[0];
const filtro = Deno.env.get('AB_CENARIOS')?.split(',');
const resultado: Record<string, unknown> = {};
for (const c of CENARIOS.filter((x) => x.fatia === fatia && (!filtro || filtro.includes(x.nome)))) {
  guarda.entrarCenario(c.nome, c.permissoes ?? []);
  try {
    const v = await c.rodar(ctx);
    resultado[c.nome] = c.erroEsperado ? { erroAusente: true } : { valor: c.canon(v), cobertura: c.cobertura(v, ctx) };
  } catch (e) {
    const msg = (e as Error).message;
    const ee = c.erroEsperado;
    // prova do erro esperado: a mensagem E um GET multiget deste cenário, com N ids distintos, que voltou com o status declarado
    const provado = !!ee && ee.mensagem.test(msg) && !msg.startsWith('GUARDA') && guarda.gets.some((g) =>
      g.cenario === c.nome && g.status === ee.status && /\/items(\/bulk)?\?ids=/.test(g.url)
      && new Set((new URL(g.url).searchParams.get('ids') ?? '').split(',')).size === ee.idsNoGet);
    resultado[c.nome] = provado ? { erroEsperado: msg.replace(/MLB\d+/g, 'MLB#') } : { erroInesperado: msg.slice(0, 300) };
  }
}
guarda.entrarCenario('-');
if (fase === 'gravar') await Deno.writeTextFile(arq, JSON.stringify(guarda.gravacoes));
const esperado = (g: { cenario: string; url: string; status: number | 'falha' }) => {
  const ee = CENARIOS.find((c) => c.nome === g.cenario)?.erroEsperado;
  return !!ee && g.status === ee.status && /\/items(\/bulk)?\?ids=/.test(g.url);
};
console.log(JSON.stringify({
  resultado,
  escritas: guarda.escritas,
  violacoes: guarda.violacoes,
  sobras: fase === 'replay' ? guarda.sobras() : [],
  getsComErro: guarda.gets.filter((g) => g.status === 'falha' || ((g.status as number) >= 400 && g.status !== 404 && !esperado(g))),
}));
```

`$CLAUDE_JOB_DIR/tmp/ab/rodar.py <fatia> <arvore_base> <arvore_nova>`:

```python
import json, os, subprocess, sys, pathlib
sys.path.insert(0, '/Users/diego/.claude/jobs/b87cbc02/tmp')
import spike_bulk as s
AB = pathlib.Path('/Users/diego/.claude/jobs/b87cbc02/tmp/ab'); (AB / 'out').mkdir(exist_ok=True)
fatia, base, nova = sys.argv[1], sys.argv[2], sys.argv[3]
ORGS = {'Avil', 'DSA', 'Daludi Shop', 'Hairfly Cosmeticos'}
OBRIG = json.loads(subprocess.run(['deno', 'eval',
    f"import {{ CAPACIDADES_OBRIGATORIAS as C, CENARIOS }} from '{AB}/cenarios.ts'; console.log(JSON.stringify({{obrig: C['{fatia}'], cap: Object.fromEntries(CENARIOS.map((c) => [c.nome, c.capacidade]))}}))"],
    capture_output=True, text=True, check=True).stdout)

def rodar(arvore, fase, grav, tok, amostra):
    env = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'], 'ML_TOKEN': tok, 'AB_ARVORE': arvore,
           'AB_AMOSTRA': json.dumps(amostra), 'AB_FASE': fase, 'AB_GRAVADAS': str(grav)}
    p = subprocess.run(['deno', 'run', '--no-prompt', '--allow-net=api.mercadolibre.com:443', '--allow-read', f'--allow-write={grav}',
                        '--allow-env', str(AB / 'ab.ts'), fatia], env=env, capture_output=True, text=True, timeout=900)
    if p.returncode != 0: raise SystemExit(f'deno falhou ({fase}): {p.stderr[-1500:]}')
    return json.loads(p.stdout.strip().splitlines()[-1])

def amostra_de(org):
    q = (f"with ids as (select item_externo_id as item, codigo_pai from public.anuncios_externos where org_id='{org['id']}' and status='publicado' and item_externo_id like 'MLB%' "
         f"union select i.item_externo_id, a.codigo_pai from public.anuncios_externos_itens i join public.anuncios_externos a on a.id=i.anuncio_externo_id "
         f"where i.org_id='{org['id']}' and i.item_externo_id like 'MLB%' and not i.retirado) select distinct item from ids order by item limit 40")
    ids = [r['item'] for r in s.sql(q)]
    arr = f"array{ids or ['-']}::text[]"
    # SKU e catálogo vêm das DUAS fontes: legado (variacoes_externas) e filhos técnicos UP (anuncios_externos_itens)
    skus = s.sql(f"select item, min(sku) as sku from ("
                 f"select a.item_externo_id as item, e.k as sku from public.anuncios_externos a, jsonb_each(a.variacoes_externas) e(k, v) "
                 f"where a.org_id='{org['id']}' and a.status='publicado' and a.item_externo_id = any({arr}) "
                 f"union all select i.item_externo_id, i.sku from public.anuncios_externos_itens i "
                 f"where i.org_id='{org['id']}' and not i.retirado and i.item_externo_id = any({arr})) x group by 1 order by 1 limit 10")
    catalogo = s.sql(f"select distinct x from ("
                     f"select v->>'catalog_listing_id' as x from public.anuncios_externos a, jsonb_each(a.variacoes_externas) e(k, v) where a.org_id='{org['id']}' "
                     f"union select i.catalog_listing_id from public.anuncios_externos_itens i where i.org_id='{org['id']}' and not i.retirado"
                     f") c where x like 'MLB%' order by 1 limit 5")
    return {'ids': ids, 'skuPorItem': {r['item']: r['sku'] for r in skus},
            'catalogo': [r['x'] for r in catalogo],
            'kits': [r['ml_item_id'] for r in s.sql(f"select ml_item_id from public.kits_virtuais where org_id='{org['id']}' and ml_item_id is not null order by 1 limit 5")],
            'sellerId': str(org['seller'])}

orgs = s.sql("select o.id, o.nome, c.id as cx, c.conta_externa_id as seller from public.organizations o "
             "join public.marketplace_connections c on c.org_id=o.id and c.canal::text ilike '%livre%'")
if ORGS - {o['nome'] for o in orgs}: raise SystemExit(f'orgs faltando: {ORGS - {o["nome"] for o in orgs}}')
falhas, coberto = [], {c: False for c in OBRIG['obrig']}
for org in orgs:
    amostra = amostra_de(org); nome = org['nome'].replace(' ', '_')
    if len(amostra['ids']) < 21: falhas.append(f"{org['nome']}: {len(amostra['ids'])} ids (<21)"); continue
    grav = AB / 'out' / f'{fatia}-{nome}-gravadas.json'
    tok = s.sql(f"select access_token from public.get_connection_tokens('{org['cx']}'::uuid)")[0]['access_token']
    a = rodar(base, 'gravar', grav, tok, amostra); b = rodar(nova, 'replay', grav, tok, amostra); del tok
    for lado, r in (('A', a), ('B', b)): (AB / 'out' / f'{fatia}-{nome}-{lado}.json').write_text(json.dumps(r, ensure_ascii=False, indent=1))
    prob = []
    for lado, r in (('A', a), ('B', b)):
        if r['violacoes']: prob.append(f'violações {lado}: {r["violacoes"][:3]}')
        if r['getsComErro']: prob.append(f'HTTP inesperado {lado}: {r["getsComErro"][:3]}')
        for cen, x in r['resultado'].items():
            if 'erroInesperado' in x or 'erroAusente' in x or x.get('cobertura') == 'falhou': prob.append(f'{cen} {lado}: {x}'[:300])
    if b['sobras']: prob.append(f"sobras: {b['sobras'][:3]}")
    if a['escritas'] != b['escritas']: prob.append('escritas simuladas diferentes')
    dif = [c for c in a['resultado'] if a['resultado'][c] != b['resultado'].get(c)]
    if dif:
        tok = s.sql(f"select access_token from public.get_connection_tokens('{org['cx']}'::uuid)")[0]['access_token']
        a2 = rodar(base, 'replay', grav, tok, amostra); del tok
        deriva = all(a2['resultado'].get(c) == b['resultado'].get(c) for c in dif)
        prob.append(f"A≠B em {dif} ({'deriva: repetir' if deriva else 'diferença REAL'})")
    for cen, x in b['resultado'].items():
        cap = OBRIG['cap'][cen]
        if cap in coberto and (x.get('cobertura') == 'coberto' or 'erroEsperado' in x): coberto[cap] = True
    print(f"{org['nome']}: ids={len(amostra['ids'])} catalogo={len(amostra['catalogo'])} kits={len(amostra['kits'])} "
          f"→ {'IDÊNTICO' if not prob else ' | '.join(prob)} | cobertura={ {c: x.get('cobertura', 'erroEsperado' if 'erroEsperado' in x else '?') for c, x in b['resultado'].items()} }")
    falhas += [f"{org['nome']}: {p}" for p in prob]
faltou = [c for c, ok in coberto.items() if not ok]
if faltou: falhas.append(f'capacidades sem cobertura em nenhuma org: {faltou}')
print('FALHAS:', falhas or 'nenhuma'); sys.exit(1 if falhas else 0)
```

Sanidade, antes do 1º uso real: rodar `rodar.py F1` com **as duas árvores = baseline**, ou seja, A/B da `main` contra ela mesma. O esperado é `IDÊNTICO` nas 4 orgs, 0 violações e as capacidades de F1 cobertas. Isso calibra o harness antes de ele julgar código novo.

- [ ] **Step 8: Edges afetadas e manifesto**

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
    erros = [m for m in g['modules'] if m.get('error')]
    if erros: raise SystemExit(f'grafo com erro em {idx.parent.name}: {erros[:2]}')
    locais = {pathlib.Path(unquote(urlparse(m['specifier']).path)).resolve() for m in g['modules'] if m['specifier'].startswith('file:')}
    if locais & alvos: afetadas.append(idx.parent.name)
if not afetadas: raise SystemExit('lista de edges VAZIA: recusado')
print(len(afetadas)); print(' '.join(afetadas))
```

Sanidade, antes do 1º uso:
- `edges_afetadas.py _shared/trafego/fiacao.ts` precisa conter `coletar-trafego-ml`;
- `edges_afetadas.py _shared/canais/mercado-livre.ts` precisa conter `status-publicados` e `sincronizar-estoque`.

Se `deno info` acusar erro de grafo em alguma edge **na main**, parar e reportar: é um problema que já existia, e a regra é não deployar às cegas.

`$CLAUDE_JOB_DIR/tmp/manifesto.py`. Modos:
- `antes <fatia> <SHA_PRODUCAO> <SHA_MAIN> <edges…>`
- `depois <fatia> <SHA_ESPERADO> <edges…>`
- `estavel <fatia>`
- `conferir <SHA> <edges…>`

```python
import hashlib, json, pathlib, subprocess, sys, shutil
REF = 'txvncrgkoynoxwopfkbp'
TMP = pathlib.Path('/Users/diego/.claude/jobs/b87cbc02/tmp')
WT = '/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/verif-items-bulk'

def listagem():
    p = subprocess.run(['supabase', 'functions', 'list', '--project-ref', REF, '-o', 'json'], capture_output=True, text=True, timeout=120)
    if p.returncode != 0: raise SystemExit(f'functions list: {p.stderr[-300:]}')
    out = {}
    for f in json.loads(p.stdout):
        if not isinstance(f.get('version'), int) or not isinstance(f.get('verify_jwt'), bool) or not f.get('ezbr_sha256'):
            raise SystemExit(f"metadado ausente/inválido em {f.get('slug')}: {f}")
        out[f['slug']] = {'versao': f['version'], 'verify_jwt': f['verify_jwt'], 'ezbr': f['ezbr_sha256']}
    return out

def jwt_efetivo(sha, edge):
    """verify_jwt que a CLI aplicará ao deployar a árvore `sha`: [functions.<edge>] do config.toml, padrão true."""
    import tomllib
    p = subprocess.run(['/usr/bin/git', 'show', f'{sha}:supabase/config.toml'], cwd=WT, capture_output=True)
    if p.returncode != 0: raise SystemExit(f'config.toml ausente em {sha}')
    return tomllib.loads(p.stdout.decode()).get('functions', {}).get(edge, {}).get('verify_jwt', True)

def hash_no_sha(sha, rel):
    p = subprocess.run(['/usr/bin/git', 'show', f'{sha}:{rel}'], cwd=WT, capture_output=True)
    return hashlib.sha256(p.stdout).hexdigest() if p.returncode == 0 else None

def snapshot(edge, destino):
    shutil.rmtree(destino, ignore_errors=True); (destino / 'supabase').mkdir(parents=True)
    l1 = listagem()
    if edge not in l1: raise SystemExit(f'edge ausente na produção: {edge}')
    p = subprocess.run(['supabase', 'functions', 'download', edge, '--project-ref', REF, '--use-api', '--workdir', str(destino)],
                       capture_output=True, text=True, timeout=300)
    if p.returncode != 0: raise SystemExit(f'download {edge}: {p.stderr[-300:]}')
    l2 = listagem()
    if l1[edge] != l2[edge]: raise SystemExit(f'{edge} mudou durante o download: {l1[edge]} → {l2[edge]}')
    base = destino / 'supabase' / 'functions'
    arqs = {('supabase/functions/' + str(a.relative_to(base))): hashlib.sha256(a.read_bytes()).hexdigest() for a in sorted(base.rglob('*')) if a.is_file()}
    if f'supabase/functions/{edge}/index.ts' not in arqs: raise SystemExit(f'{edge}: download sem index.ts')
    return {**l2[edge], 'arquivos': arqs}

modo = sys.argv[1]
if modo == 'estavel':
    m = json.loads((TMP / f'manifesto-{sys.argv[2]}-antes.json').read_text()); l = listagem()
    mud = [e for e, v in m['edges'].items() if {k: l[e][k] for k in ('versao', 'verify_jwt', 'ezbr')} != {k: v[k] for k in ('versao', 'verify_jwt', 'ezbr')}]
    print('MUDARAM:', mud or 'nenhuma'); sys.exit(1 if mud else 0)
if modo == 'antes': fatia, sha_prod, sha_main, edges = sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5:]
elif modo == 'depois': fatia, sha_prod, sha_main, edges = sys.argv[2], None, sys.argv[3], sys.argv[4:]
else: fatia, sha_prod, sha_main, edges = '-', sys.argv[2], None, sys.argv[3:]
assert edges, 'sem edges'
manif, div = {}, []
for edge in edges:
    snap = snapshot(edge, TMP / 'dl' / f'{fatia}-{modo}' / edge)
    for rel, h in snap['arquivos'].items():
        if modo == 'depois':
            if h != hash_no_sha(sha_main, rel): div.append(f'{edge}: {rel} ≠ {sha_main}')
        else:
            if h != hash_no_sha(sha_prod, rel): div.append(f'{edge}: {rel} ≠ produção esperada {sha_prod}')
    if modo == 'antes':
        # política JWT conferida ANTES de aplicar: a do deploy (SHA_MAIN) e a do rollback (SHA_PRODUCAO) = a de produção
        for nome_sha, sha in (('deploy', sha_main), ('rollback', sha_prod)):
            if jwt_efetivo(sha, edge) != snap['verify_jwt']:
                div.append(f"{edge}: verify_jwt do {nome_sha} ({sha}) = {jwt_efetivo(sha, edge)} ≠ produção {snap['verify_jwt']}")
    manif[edge] = snap
(TMP / f'manifesto-{fatia}-{modo}.json').write_text(json.dumps({'projeto': REF, 'sha_prod': sha_prod, 'sha_main': sha_main, 'edges': manif}, indent=1))
if modo == 'depois':
    antes = json.loads((TMP / f"manifesto-{fatia.removesuffix('-rollback')}-antes.json").read_text())['edges']
    for e in edges:
        if manif[e]['verify_jwt'] != antes[e]['verify_jwt']: div.append(f'{e}: verify_jwt mudou')
        if fatia.endswith('-rollback'):
            if manif[e]['arquivos'] != antes[e]['arquivos']: div.append(f'{e}: rollback não restaurou os arquivos')
        else:
            if not manif[e]['versao'] > antes[e]['versao']: div.append(f'{e}: versão não incrementou')
            if (manif[e]['arquivos'] != antes[e]['arquivos']) != (manif[e]['ezbr'] != antes[e]['ezbr']): div.append(f'{e}: ezbr incoerente com os arquivos')
print(json.dumps({e: {k: v for k, v in m.items() if k != 'arquivos'} | {'n_arquivos': len(m['arquivos'])} for e, m in manif.items()}, indent=1))
print('DIVERGÊNCIAS:', div or 'nenhuma'); sys.exit(1 if div else 0)
```

Sanidade, antes do 1º uso: `python3 $CLAUDE_JOB_DIR/tmp/manifesto.py conferir 3b68f702 coletar-trafego-ml`. O esperado é "nenhuma". Se houver divergência, achar o SHA que bate (`git log -- <arquivos divergentes>`) e anotar. Esse é o `SHA_PRODUCAO` daquela edge.

- [ ] **Step 9: ADR-0177.** Antes, `/usr/bin/git fetch origin` e `/usr/bin/git ls-tree --name-only origin/main docs/decisions/ | sort | tail -3`; se a 0177 já existir, usar o próximo número livre em todo lugar.

`docs/decisions/0177-multiget-ml-items-bulk.md`:

```markdown
# ADR-0177 — Multiget do Mercado Livre via `/items/bulk`

**Status:** Aceito (2026-10-03). **Prazo externo:** o ML desliga `GET /items?ids=` em 25/10/2026.

## Contexto
14 chamadas em 13 arquivos usavam `/items?ids=`. O substituto `GET /items/bulk?ids=` muda o envelope
(`status_code` no lugar de `code`). Spikes reais de 03/10/2026 (4 orgs, só GET) mediram:
- bodies idênticos;
- seleção com `status_code` + `body.`;
- id repetido → HTTP 400 (o antigo deduplicava antes do limite);
- 21 ids → 400;
- id inexistente → `{status_code:404}` sem body, na posição pedida;
- ordem dos envelopes = a pedida (a do antigo era arbitrária).

## Decisão
- **Adaptador, não parser** (`_shared/ml/multiget.ts`):
  - `caminhoMultiget`: URL com dedup dentro da requisição;
  - `comoEnvelopeAntigo`: converte entradas bulk para `[{code, body}]`. Só o 404 sem body ganha
    `body:{id}`, e só com as posições confirmadas. Entradas no formato antigo passam intactas.
  - Nenhum módulo muda predicado, particionamento ou tratamento de erro.
- Leituras inline (componentes de kit, PxV, Pulse) ganham uma extração mínima, só para teste.
- `fiacao.ts` (`6f8f6c9b`) não muda.
- Validação por fatia:
  - testes de fronteira nos dois envelopes;
  - A/B em duas fases (só GET ao vivo, escrita simulada por cenário, violação fatal);
  - deploy com manifesto de hash por arquivo e por edge.

## Consequências
- As decisões de negócio ficam equivalentes.
- A ordem das listas segue a pedida, e logs que imprimem a URL mostram `/items/bulk`.
- Mais de 20 ids onde não há blocos continua respondendo 400.
- Um módulo novo que precise de multiget usa o adaptador. Escrever `/items?ids=` à mão é regressão.
```

- [ ] **Step 10: Codex + commit.**
  - `pnpm test supabase/functions/_shared/ml` → PASS.
  - Sanidade do harness (Step 7), das edges e do manifesto (Step 8) feita e registrada.
  - P-Revisão Codex da T0, com o ferramental de `$CLAUDE_JOB_DIR/tmp/ab` e os dois `.py` no prompt.
  - `/usr/bin/git add supabase/functions/_shared/ml/multiget.ts supabase/functions/_shared/ml/__tests__/multiget.test.ts supabase/functions/_shared/ml/__tests__/fixtures docs/decisions/0177-multiget-ml-items-bulk.md`
  - `/usr/bin/git commit -F $CLAUDE_JOB_DIR/tmp/msg-t0.txt`, com a mensagem `feat(ml): adaptador /items/bulk → envelope antigo + fixtures reais + ADR-0177`.
  - Sem deploy.

---

### Task T1 (F1): `lerStatus`, `buscar-item`, `atualizar-item`

**Files:**
- Modify: `_shared/canais/mercado-livre.ts:414-420`, `_shared/ml/buscar-item.ts:79-83`, `_shared/ml/atualizar-item.ts:183-184`
- Test: `_shared/canais/__tests__/mercado-livre.test.ts`, `_shared/ml/__tests__/buscar-item.test.ts`, `sincronizar-estoque/__tests__/processar.test.ts`

- [ ] **Step 1: Testes falhando**

Em `mercado-livre.test.ts`, depois do `describe('lerStatus — catalogForewarning (E5 fase3)')`:

```ts
import bulkCanais from '../../ml/__tests__/fixtures/bulk-canais-bulk.json' with { type: 'json' };
import antigoCanais from '../../ml/__tests__/fixtures/bulk-canais-antigo.json' with { type: 'json' };
import idsCanais from '../../ml/__tests__/fixtures/bulk-canais-ids.json' with { type: 'json' };

describe('lerStatus via /items/bulk (ADR-0177)', () => {
  const ctx = { getToken: async () => 't' };
  it('URL do bulk e resultado igual ao do envelope antigo nos mesmos ids', async () => {
    const urls: string[] = [];
    globalThis.fetch = ((u: string) => { urls.push(u); return Promise.resolve(new Response(JSON.stringify(bulkCanais))); }) as typeof fetch;
    const novo = await mercadoLivreConnector.lerStatus(ctx, idsCanais as string[]);
    expect(urls).toEqual([`https://api.mercadolibre.com/items/bulk?ids=${(idsCanais as string[]).join(',')}&attributes=status_code,body.id,body.status,body.sub_status,body.available_quantity,body.price,body.listing_type_id,body.tags`]);
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify(antigoCanais)))) as typeof fetch;
    expect(novo).toEqual(await mercadoLivreConnector.lerStatus(ctx, idsCanais as string[]));
    expect(novo['MLB0000000001'].status).toBe('indisponivel');
  });
  it('id repetido no bloco: URL sem repetição', async () => {
    const urls: string[] = [];
    globalThis.fetch = ((u: string) => { urls.push(u); return Promise.resolve(new Response('[]')); }) as typeof fetch;
    await mercadoLivreConnector.lerStatus(ctx, ['MLB1', 'MLB2', 'MLB1']);
    expect(new URL(urls[0]).searchParams.get('ids')).toBe('MLB1,MLB2');
  });
  it('mesmo id em dois blocos: 200 pausado no 1º, 404 sem body no 2º → indisponivel (igual ao antigo)', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `MLB${100 + i}`);
    globalThis.fetch = ((u: string) => {
      const q = new URL(u).searchParams.get('ids')!.split(',');
      return Promise.resolve(new Response(JSON.stringify(q.length === 20
        ? q.map((id) => ({ status_code: 200, body: { id, status: 'paused', sub_status: [] } }))
        : q.map(() => ({ status_code: 404 })))));
    }) as typeof fetch;
    const r = await mercadoLivreConnector.lerStatus(ctx, [...ids, ids[0]]);
    expect(r[ids[0]].status).toBe('indisponivel');
    expect(r[ids[1]].status).toBe('pausado');
  });
  it('pausado e preço chegam ao StatusCanal (entradas da reativação e da faixa do split)', async () => {
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify([
      { status_code: 200, body: { id: 'MLB1', status: 'paused', sub_status: [], price: 49.9, available_quantity: 3 } },
    ])))) as typeof fetch;
    const r = await mercadoLivreConnector.lerStatus(ctx, ['MLB1']);
    expect(r.MLB1.status).toBe('pausado');
    expect(r.MLB1.preco).toBe(49.9);
  });
  it('200 sem body no bulk → indisponivel (como {code:200} sem body no antigo)', async () => {
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify([{ status_code: 200 }])))) as typeof fetch;
    expect((await mercadoLivreConnector.lerStatus(ctx, ['MLB1'])).MLB1.status).toBe('indisponivel');
  });
});
```

Antes de rodar, conferir os rótulos `'pausado'` e `'indisponivel'` em `_shared/ml/status.ts` (`grep -n "'pausado'\|'indisponivel'"`) e o nome `preco` em `StatusParsed` (`status.ts:52-55`).

A propagação (`describe('atualizarStatus propaga…')`, linhas 531-597) passa a rodar nos dois envelopes. O `describe(` vira `describe.each(['code', 'status_code'] as const)('atualizarStatus propaga para o anúncio de catálogo relacionado [%s]', (campo) => {`, e o retorno do multiget em `stubRelacionados` fica:

```ts
      if (url.includes('/items/MLB1?')) return json({ id: 'MLB1', item_relations: relacionados.map((r) => ({ id: r.id })) });
      if (campo === 'status_code') expect(url).toMatch(/\/items\/bulk\?ids=[^&]+&attributes=status_code,body\.id,body\.status,body\.sub_status$/);
      return json(relacionados.map((r) => (r.id === opts.ilegivel
        ? (campo === 'status_code' ? { status_code: 404 } : { code: 404, body: { message: 'not found' } })
        : { [campo]: 200, body: r })));
```

Casos novos dentro do `describe.each`. Os valores são caracterização do código atual, conferida pelo Codex na revisão r2 (achado 12):

```ts
  it('mistos ao pausar: [ativo, ilegível] → PUT no ativo ANTES do 502 (comportamento atual, caracterizado)', async () => {
    const puts = stubRelacionados([{ id: 'MLB8', status: 'active' }, { id: 'MLB9', status: 'active' }], { ilegivel: 'MLB9' });
    const res = await mercadoLivreConnector.atualizarStatus(ctxFake, 'MLB1', 'pausado');
    expect(res.ok).toBe(false);
    expect(res.erro?.retentavel).toBe(true);
    expect(puts).toEqual([{ id: 'MLB8', status: 'paused' }]);
  });
  it('mistos ao reativar: [pausado, ativo] → só o pausado e o próprio item', async () => {
    const puts = stubRelacionados([{ id: 'MLB8', status: 'paused' }, { id: 'MLB9', status: 'active' }]);
    await mercadoLivreConnector.atualizarStatus(ctxFake, 'MLB1', 'ativo');
    expect(puts).toEqual([{ id: 'MLB8', status: 'active' }, { id: 'MLB1', status: 'active' }]);
  });
```

O teste "mistos ao pausar" precisa **passar antes** da mudança de produção (rodar com `campo='code'` no Step 2). Se não passar, corrigir **o teste** com o valor real e anotar.

Em `buscar-item.test.ts`, o `fakeFetch` (linhas 13-29) é substituído por:

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
    const results = [...Array.from({ length: 20 }, (_, i) => `MLB${i + 1}`), 'MLB1'];
    const f = fakeFetch([{ results, total: 21 }], { MLB1: item() });
    expect(await buscarItemPorSku(f, CRIT, 's1')).toEqual({ tipo: 'ambiguo' });
  });
```

O 2º teste é caracterização e passa antes da mudança. Se não passar, corrigir o teste com o valor real.

Em `sincronizar-estoque/__tests__/processar.test.ts`, **dentro** do `describe('processarSincronizacao — reativação ao repor estoque (ADR-0111)')` existente, para usar `umAnuncio`, `chamadasDeStatus`, `deps`, `JOB` e o `beforeEach` dele:

```ts
  describe('com o lerStatus REAL lendo /items/bulk', () => {
    let fetchOriginal: typeof fetch;
    beforeEach(() => { fetchOriginal = globalThis.fetch; });
    afterEach(() => { globalThis.fetch = fetchOriginal; vi.restoreAllMocks(); });
    it.each([
      ['pausado no bulk → reativa', [{ status_code: 200, body: { id: 'FK1', status: 'paused', sub_status: [] } }], [{ itemExternoId: 'FK1', status: 'ativo' }]],
      ['404 sem body → não reativa', [{ status_code: 404 }], []],
      ['ativo no bulk → não reativa', [{ status_code: 200, body: { id: 'FK1', status: 'active', sub_status: [] } }], []],
    ])('%s', async (_n, resposta, esperado) => {
      globalThis.fetch = ((u: string) => Promise.resolve(new Response(JSON.stringify(u.includes('/items/bulk') ? resposta : {})))) as typeof fetch;
      vi.spyOn(fakeConnector, 'lerStatus').mockImplementation((ctx, ids) => mercadoLivreConnector.lerStatus(ctx, ids));
      await processarSincronizacao(deps(umAnuncio(7)), { ...JOB, reativar: true });
      expect(chamadasDeStatus()).toEqual(esperado);
    });
  });
```

Imports no topo do arquivo, se ainda não existirem: `import { afterEach, beforeEach, vi } from 'vitest';` (juntar ao import existente) e `import { mercadoLivreConnector } from '../../_shared/canais/mercado-livre.ts';`. O `fakeConnector` é uma instância de classe (`_shared/canais/fake.ts:126`), então `vi.spyOn` intercepta o método do protótipo pela instância, e `vi.restoreAllMocks()` desfaz. Validar com `pnpm test supabase/functions/sincronizar-estoque` (arquivo inteiro), que prova a ausência de contaminação entre testes.

- [ ] **Step 2: Rodar e ver falhar.**
  - `pnpm test supabase/functions/_shared/canais supabase/functions/_shared/ml supabase/functions/sincronizar-estoque` → FAIL nos novos de URL/bulk.
  - Os de caracterização (mistos, ambiguo, `[code]`) → PASS.

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

Imports nos dois. **Nenhuma outra linha muda.**

- [ ] **Step 4: Rodar e ver passar.** `pnpm test supabase/functions` → PASS. Depois `deno check` nos `index.ts` de `status-publicados`, `sincronizar-estoque`, `update-familia-ml`, `publicar-split-ml`, `monitorar-moderados` e `remover-publicado`.

- [ ] **Step 5: A/B `F1`** (`SHA_BASELINE_AB` = commit da T0). Esperado: `IDÊNTICO`, 0 violações, capacidades `status`, `catalogo` e `adocao` cobertas.

- [ ] **Step 6: Varredura, commit, Codex e portão.**
  - `grep -n "items?ids=" <3 arquivos>` → vazio.
  - Commit `feat(ml): fatia 1 do /items/bulk — lerStatus, adoção e propagação de status`.
  - P-Revisão Codex.
  - P-Portão, com as edges de `edges_afetadas.py _shared/ml/multiget.ts _shared/canais/mercado-livre.ts _shared/ml/buscar-item.ts _shared/ml/atualizar-item.ts`.

- [ ] **Step 7: Deploy e observação.**
  - P-Deploy, com `SHA_PRODUCAO` conferido no Step 8 da T0.
  - Logs de `sincronizar-estoque`, `monitorar-moderados` e `status-publicados`.
  - Por id: 10 anúncios Avil, com o status na tela Publicados igual ao status da fase A do A/B (pedir ao Diego que abra a tela, ou conferir pela próxima chamada logada).

---

### Task T2 (F2): `vendas.ts`, `pedidos.ts`

**Files:**
- Modify: `_shared/ml/vendas.ts:127` (`export`), `:139-142`; `_shared/ml/pedidos.ts:35-38`
- Test: `_shared/ml/__tests__/vendas.test.ts`, **novo** `_shared/ml/__tests__/pedidos-gtin.test.ts`

- [ ] **Step 1: Testes falhando.** Conferir antes o formato aceito por `extrairGtin` em `pedidos.ts:12-21` (`value_name` ou `values[0].name`) e usar esse formato no atributo sintético.

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
    expect(novo).toEqual(await buscarGtinsDosItens('t', ids as string[]));
    expect(Object.keys(novo).length).toBeGreaterThan(0);
  });
  it('bloco do meio com HTTP 500: os outros dois sobrevivem com os GTINs certos', async () => {
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

Em `vendas.test.ts`, o mesmo par para `buscarTitulosEGtins`, agora exportada: fixtures `bulk-vendas-*`, URL `&attributes=status_code,body.id,body.title,body.attributes`, igualdade com o antigo e `Object.keys(r.titulos).length === 3`.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar.**
  - `vendas.ts:127`: `export async function buscarTitulosEGtins(`.
  - `vendas.ts:139`: `` const url = `${API}${caminhoMultiget(bloco, 'id,title,attributes')}`; ``
  - `vendas.ts:142`: `const arr = comoEnvelopeAntigo(await resp.json(), bloco) as any; // [{ code, body }] (ADR-0177)`. Hoje `arr` é `any` implícito, porque vem de `resp.json()`.
  - `pedidos.ts:35`: `` const url = `${API}${caminhoMultiget(bloco, 'id,attributes')}`; ``
  - `pedidos.ts:38`: `const arr = comoEnvelopeAntigo(await resp.json(), bloco) as any;`
  - Imports de `./multiget.ts`.

- [ ] **Step 4: Testes de `_shared`, `sync-venda`, `reconciliar-faturamento`, `backfill-faturamento` e `sync-devolucao` → PASS.** Depois `deno check`.

- [ ] **Step 5: A/B `F2`.** Antes, aplicar o `export` também na baseline extraída:
  `sed -i '' 's/^async function buscarTitulosEGtins/export async function buscarTitulosEGtins/' $CLAUDE_JOB_DIR/tmp/ab/base/supabase/functions/_shared/ml/vendas.ts`
  Isso muda só a visibilidade, e o `diff` entre as duas cópias desse arquivo deve mostrar só essa linha. Esperado: `IDÊNTICO`.

- [ ] **Step 6: Commit (`feat(ml): fatia 2 do /items/bulk — GTIN de vendas e faturamento`), Codex e portão.** Edges: `edges_afetadas.py _shared/ml/vendas.ts _shared/ml/pedidos.ts`.

- [ ] **Step 7: Deploy e observação.**
  - Por id: nas 3 próximas vendas reais, o GTIN da linha de faturamento é igual ao GTIN da fase A para o mesmo item (SQL read-only).
  - `reconciliar-faturamento` sem erro.

---

### Task T3 (F3): kit virtual

**Files:**
- Modify: `_shared/ml/kit-virtual.ts:74` (comentário), `:91`, `:97`; `buscar-componentes-kit-virtual/index.ts:45-72`; `buscar-componentes-kit-virtual/processar.ts:26` (comentário)
- Create: `buscar-componentes-kit-virtual/leitura-ml.ts`
- Test: `_shared/ml/__tests__/kit-virtual-status.test.ts`, **novo** `buscar-componentes-kit-virtual/__tests__/leitura-ml.test.ts`

- [ ] **Step 1: Caracterização (endpoint antigo), que deve falhar só pelo import.**

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
    expect(r.find((x) => x.itemId === 'MLB3')).toBeUndefined();
    expect(r[0]).toEqual({ itemId: 'MLB0', userProductId: 'UPMLB0', precoAtualML: 10, categoriaMlId: 'MLB1' });
  });
  it('bloco com HTTP de erro (mlGet devolve null) é pulado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({}, 500)));
    expect(await buscarUserProductIdsML('t', ['MLB1'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Extração (P-Extração).** Criar `buscar-componentes-kit-virtual/leitura-ml.ts` com:
  - o comentário de `index.ts:45-50`;
  - `export async function buscarUserProductIdsML(...)`, copiada **sem alteração** de `index.ts:51-72`;
  - `const API = 'https://api.mercadolibre.com';`;
  - os imports `import { mlGet } from '../_shared/ml/http.ts';` e `import type { ItemBridge } from './processar.ts';`.

  Em `index.ts`: apagar a função e o comentário e importar `import { buscarUserProductIdsML } from './leitura-ml.ts';`. Remover `mlGet` e `API` de `index.ts` **só** se ficarem órfãos.
  - Teste → PASS.
  - Diff só de movimento.
  - Commit `refactor(kit): extrair leitura de componentes do ML (sem mudança de comportamento)`.
  - Codex revisa este commit isolado.

- [ ] **Step 3: Testes do bulk, falhando.**
  - `kit-virtual-status.test.ts:122` passa a esperar `'https://api.mercadolibre.com/items/bulk?ids=MLB1,MLB2&attributes=status_code,body.id,body.listing_type_id'`, e o mock desse teste responde `status_code`. O comentário da linha 118 passa a dizer `GET /items/bulk?ids=...&attributes=...` (ADR-0177).
  - Teste novo com o kit real, mais o 404 inserido:

```ts
import bulkKit from './fixtures/bulk-kit-bulk.json' with { type: 'json' };
import idsKit from './fixtures/bulk-kit-ids.json' with { type: 'json' };
it('kit real + 404 sem body: o 404 fica fora do mapa, os demais entram com o listing_type certo', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([...(bulkKit as unknown[]), { status_code: 404 }]))));
  const m = await buscarListingTypeItensML('t', [...(idsKit as string[]), 'MLB0000000001']);
  expect(Object.fromEntries(m)).toEqual(Object.fromEntries((bulkKit as Array<{ body: { id: string; listing_type_id: string } }>).map((e) => [e.body.id, e.body.listing_type_id])));
});
```

  - O teste de componentes passa para o bulk: `{ status_code: 200, body }`, o `MLB3` vira `{ status_code: 404 }` sem body, e entra a asserção `urls[0]` contendo `/items/bulk?ids=` e `&attributes=status_code,body.id,body.user_product_id,body.price,body.category_id`.

- [ ] **Step 4: Implementar.**
  - `kit-virtual.ts:91`: `` `https://api.mercadolibre.com${caminhoMultiget(bloco, 'id,listing_type_id')}` ``.
  - `kit-virtual.ts:97`: `const arr = comoEnvelopeAntigo(await resp.json().catch(() => null), bloco);`.
  - `kit-virtual.ts:74` (comentário): `(\`GET /items/bulk?ids=...&attributes=...\`, ADR-0177)`.
  - `leitura-ml.ts`: `` const url = `${API}${caminhoMultiget(bloco, 'id,user_product_id,price,category_id')}`; `` e `const arr = comoEnvelopeAntigo(await mlGet(url, token), bloco);`.
  - `processar.ts:26` (comentário): `GET /items/bulk?ids=...&attributes=status_code,body.id,body.user_product_id,body.price,body.category_id`.
  - Imports do adaptador.

- [ ] **Step 5: Testes (`_shared/ml`, `buscar-componentes-kit-virtual`, `criar-kit-virtual`, `status-publicados`) → PASS.** Depois `deno check`.

- [ ] **Step 6: A/B `F3`** (`SHA_BASELINE_AB` = commit da extração). Esperado: `IDÊNTICO`, com `kit` coberto pela DSA.

- [ ] **Step 7: Commit (`feat(ml): fatia 3 do /items/bulk — kit virtual`), Codex e portão.** Edges: `edges_afetadas.py _shared/ml/kit-virtual.ts buscar-componentes-kit-virtual/index.ts buscar-componentes-kit-virtual/leitura-ml.ts`. O manifesto pré-deploy usa `SHA_PRODUCAO`, anterior à extração.

- [ ] **Step 8: Deploy e observação.**
  - `status-publicados` com os 2 kits DSA: `listing_type_id` de cada componente igual ao da fase A.
  - Componentes e criação de kit: observação passiva até 24 h.

---

### Task T4 (F4): promoções, operações, órfãos, família UP

**Files:**
- Modify: `_shared/promocoes/ml.ts:126-127`, `_shared/operacoes/ml.ts:40-43`, `_shared/ml/varrer-itens.ts:83-87`, `_shared/ml/descobrir-familia-up.ts:129-133`
- Test: `_shared/promocoes/__tests__/ml.test.ts` (+ `fixtures/multiget.json`), `_shared/operacoes/__tests__/ml.test.ts`, `_shared/ml/__tests__/varrer-itens.test.ts`, `_shared/ml/__tests__/descobrir-familia-up.test.ts`

- [ ] **Step 1: Testes falhando**

`operacoes/__tests__/ml.test.ts`:
- As linhas 125-126 passam a esperar `` `${API}/items/bulk?ids=MLB1&attributes=status_code,body.id,body.catalog_listing,body.item_relations` `` e `` `${API}/items/bulk?ids=MLB2&attributes=status_code,body.id,body.catalog_listing` ``.
- Os mocks respondem `status_code`. Os testes de 404 (linhas 138 e 146) respondem `{ status_code: 404 }` sem body, com o mesmo comportamento esperado (rejeita; Error).
- Testes de **fronteira** (a saída de `lerRelacoes` é a entrada única do `decidir`, `_shared/operacoes/decidir.ts:32`):

```ts
describe.each(['code', 'status_code'] as const)('lerRelacoes — fronteira do motor de promoções [%s]', (campo) => {
  const cli = (r1: unknown, r2?: unknown) => {
    const f = vi.fn(async (u: string) => new Response(JSON.stringify(u.includes('body.item_relations') || u.includes('item_relations&') || f.mock.calls.length === 1 ? r1 : r2)));
    return { f, c: criarClienteML('t', f as unknown as typeof fetch) };
  };
  it('item principal 200 SEM body → lança (não vira catalog_listing:false, que liberaria a inscrição)', async () => {
    const { c } = cli([{ [campo]: 200 }]);
    await expect(c.lerRelacoes('MLB1')).rejects.toThrow();
  });
  it('relacionado 200 SEM body → rejeita (igual ao 404)', async () => {
    const { c } = cli([{ [campo]: 200, body: { id: 'MLB1', catalog_listing: false, item_relations: [{ id: 'MLB2' }] } }], [{ [campo]: 200 }]);
    await expect(c.lerRelacoes('MLB1')).rejects.toThrow();
  });
  it('relacionado repetido em item_relations: retorno conserva a repetição', async () => {
    const { c } = cli(
      [{ [campo]: 200, body: { id: 'MLB1', catalog_listing: false, item_relations: [{ id: 'MLB2' }, { id: 'MLB2' }] } }],
      [{ [campo]: 200, body: { id: 'MLB2', catalog_listing: true } }],
    );
    expect(await c.lerRelacoes('MLB1')).toEqual({
      catalog_listing: false,
      relacionados: [{ id: 'MLB2', catalog_listing: true }, { id: 'MLB2', catalog_listing: true }],
    });
  });
});

// Só depois da migração (Step 3): hoje o código envia `ids=MLB2,MLB2` e quem deduplica é o servidor.
it('lerRelacoes: relacionado repetido vai UMA vez na URL do bulk', async () => {
  const f = vi.fn(async (u: string) => new Response(JSON.stringify(f.mock.calls.length === 1
    ? [{ status_code: 200, body: { id: 'MLB1', catalog_listing: false, item_relations: [{ id: 'MLB2' }, { id: 'MLB2' }] } }]
    : [{ status_code: 200, body: { id: 'MLB2', catalog_listing: true } }])));
  await criarClienteML('t', f as unknown as typeof fetch).lerRelacoes('MLB1');
  expect(new URL(String(f.mock.calls[1][0]), 'https://x').searchParams.get('ids')).toBe('MLB2');
});
```

Esses valores são a caracterização conferida pelo Codex (r2, achado 12). No envelope `code`, os três testes precisam **passar antes** da mudança, porque são caracterização. O roteamento `cli` decide pela ordem da chamada: 1ª = item, 2ª = relacionados. Ajustar se o transporte `chamar` montar a URL de outro jeito (`operacoes/ml.ts:25-37`).

`promocoes/__tests__/ml.test.ts`:
- `fixtures/multiget.json`: `sed -i '' 's/"code":/"status_code":/'`, depois conferir com `grep -c`.
- Linha 135: o cast passa a `{ status_code: number; … }`.
- Teste da linha 94: asserção `expect(get.mock.calls[0][0]).toMatch(/^\/items\/bulk\?ids=[^&]+&attributes=status_code,body\.id,body\.title,body\.thumbnail,body\.secure_thumbnail,body\.permalink,body\.listing_type_id,body\.category_id,body\.seller_custom_field,body\.attributes,body\.variations&include_attributes=all$/)`, usando o nome real da variável de chamadas.
- Par real: `buscarItensML` com `GetJson` falso devolvendo `bulk-promocoes-bulk.json` contra o mesmo com `bulk-promocoes-antigo.json` (mesmos ids, `bulk-promocoes-ids.json`). Os dois `Map` devem ser iguais (`toEqual`), e os valores normalizados de um item devem conter `UNITS_PER_PACK`/`SALE_FORMAT` quando o fixture tiver esses atributos (`normalizarItemML`, `promocoes/ml.ts:61`).

`varrer-itens.test.ts`:
- Mocks com `status_code`.
- Asserção de URL: `toContain('&attributes=status_code,body.id,body.title,body.status,body.permalink,body.available_quantity,body.seller_custom_field,body.catalog_listing')`.
- Par real `bulk-varrer-itens-*`, comparado como multiconjunto por `id`.

`descobrir-familia-up.test.ts`:
- Linhas 35 e 163: a rota passa a `'/items/bulk?ids='` e o fake responde `status_code`.
- Teste de **permutação**: os mesmos irmãos em duas ordens dão `tipo`, `familyId`, `familyName`, `itemPorCor` e `coresAmbiguas` (ordenado) iguais.
- Irmãos com `family_name` **diferentes** ficam caracterizados como dependentes de ordem, com o valor atual (o primeiro não vazio) e um comentário apontando o spec §4.3.

- [ ] **Step 2: Rodar e ver falhar** (caracterização passa).

- [ ] **Step 3: Implementar.**

`promocoes/ml.ts:126-127`:

```ts
    const r = comoEnvelopeAntigo(await get(caminhoMultiget(bloco, ATRIBUTOS_ITEM, '&include_attributes=all')), bloco);
    for (const x of lista(r)) {
```

`operacoes/ml.ts:40-43`:

```ts
    const r = await chamar('GET', caminhoMultiget(xs, atributos));
    if (!r.ok) throw await falha(r);
    const m = new Map<string, Obj>();
    for (const x of lista(comoEnvelopeAntigo(await r.json(), xs))) {
```

Remover o helper `ids` (linha 22) só se ficar órfão.

`varrer-itens.ts:83-87`:

```ts
    const url = `${API}${caminhoMultiget(bloco, 'id,title,status,permalink,available_quantity,seller_custom_field,catalog_listing')}`;
    const resp = await fetchLike(url, { headers });
    if (!resp.ok) throw new Error(`detalhes dos anúncios: ML respondeu ${resp.status}`);
    const arr = comoEnvelopeAntigo(await resp.json(), bloco) as Array<{
```

`descobrir-familia-up.ts:129-133`:

```ts
    const url = `${API}${caminhoMultiget(bloco, 'id,seller_id,category_id,family_id,family_name,status,variations,attributes')}`;
    const resp = await fetchLike(url, { headers });
    if (!resp.ok) throw new Error(`multiget de família migrada (${resp.status})`);
    const arr = comoEnvelopeAntigo(await resp.json(), bloco) as Array<{ code?: number; body?: ItemBruto }>;
```

Imports do adaptador nos quatro.

- [ ] **Step 4: Testes (`_shared`, `operacoes-massa`, `sincronizar-promocoes`, `coletar-ads-ml`, `coletar-trafego-ml`, `varrer-anuncios-orfaos`, `update-familia-ml`) → PASS.** Depois `deno check`.

- [ ] **Step 5: A/B `F4`.** Esperado: `IDÊNTICO`; capacidades `promocoes`, `catalogo`, `orfaos` e `familiaUP` cobertas.

- [ ] **Step 6: Commit (`feat(ml): fatia 4 do /items/bulk — promoções, operações, órfãos e família UP`), Codex e portão.** Edges: `edges_afetadas.py _shared/promocoes/ml.ts _shared/operacoes/ml.ts _shared/ml/varrer-itens.ts _shared/ml/descobrir-familia-up.ts` (inclui `coletar-trafego-ml`).

- [ ] **Step 7: Deploy e observação.**
  - `sincronizar-promocoes` (cron `10 */6 * * *`): por id, 10 itens da Central com categoria, título e cor iguais aos da rodada anterior (SQL read-only; tabelas via `grep -n "^### " docs/reference/modelo-de-dados.md | grep -i promo`).
  - `coletar-trafego-ml` (cron `17 9`) sem erro.
  - `operacoes-massa` e `varrer-anuncios-orfaos`: observação passiva até 24 h.

**Por que não há teste integrado do motor de promoções nem do split (Codex r2, achado 3):**
- O motor (`_shared/operacoes/executar.ts`) e o `publicar-split-ml` **não mudam**. A única entrada deles que muda de origem é a saída de `lerRelacoes` e de `lerStatus`.
- Os testes de fronteira provam saída idêntica (ou o mesmo `throw`) nos dois envelopes, inclusive nos casos que liberariam escrita: 200 sem body, relacionado ilegível, repetido.
- Função de jusante inalterada + entrada idêntica ⇒ mesma decisão.
- Esta é uma limitação declarada. Se o Diego quiser o teste integrado, ele entra como tarefa extra, com a fábrica de `deps` de `executar.test.ts`.

---

### Task T5 (F5): Pulse e PxV

**Files:**
- Modify: `pulse-coletar/processar.ts:682-691` (extração para `export async function lerSituacaoAnuncios`); `acompanhar-migracao-pxv/index.ts:93-108`, `:172-183`; `_shared/pulse/parse.ts:91` (comentário)
- Create: `acompanhar-migracao-pxv/leitura-ml.ts`
- Test: **novos** `pulse-coletar/__tests__/situacao.test.ts`, `acompanhar-migracao-pxv/__tests__/leitura-ml.test.ts`

- [ ] **Step 1: Caracterização (endpoint antigo), que deve falhar só pelo import**

`acompanhar-migracao-pxv/__tests__/leitura-ml.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lerCoresML, lerEstoqueVivoML } from '../leitura-ml.ts';
afterEach(() => vi.unstubAllGlobals());
const resp = (b: unknown, status = 200) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status });

describe('lerCoresML', () => {
  it('uma requisição; cor por item com o VALOR certo; não-200 fica fora', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return resp([
      { code: 200, body: { id: 'MLB1', attributes: [{ id: 'COLOR', value_name: 'Azul' }] } },
      { code: 200, body: { id: 'MLB3', attributes: [{ id: 'BRAND', value_name: 'X' }] } },
      { code: 404, body: { id: 'MLB2' } },
    ]); }));
    const m = await lerCoresML('t', ['MLB1', 'MLB2', 'MLB3']);
    expect(urls).toHaveLength(1);
    expect(Object.fromEntries(m)).toEqual({ MLB1: 'Azul', MLB3: null });
  });
  it('HTTP de erro → lança (o worker reagenda)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({}, 503)));
    await expect(lerCoresML('t', ['MLB1'])).rejects.toThrow('multiget de cores falhou (503)');
  });
  it('resposta objeto → TypeError, como hoje', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({ message: 'x' })));
    await expect(lerCoresML('t', ['MLB1'])).rejects.toThrow(TypeError);
  });
  it('resposta null → mapa vazio, como hoje (json ?? [])', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp('null')));
    expect((await lerCoresML('t', ['MLB1'])).size).toBe(0);
  });
});

describe('lerEstoqueVivoML', () => {
  it('available_quantity por item; ausente vira 0; HTTP de erro → mapa vazio sem lançar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp([{ code: 200, body: { id: 'MLB1', available_quantity: 4 } }, { code: 200, body: { id: 'MLB2' } }])));
    expect(Object.fromEntries(await lerEstoqueVivoML(async () => 't', ['MLB1', 'MLB2']))).toEqual({ MLB1: 4, MLB2: 0 });
    vi.stubGlobal('fetch', vi.fn(async () => resp({}, 500)));
    expect((await lerEstoqueVivoML(async () => 't', ['MLB1'])).size).toBe(0);
  });
  it('resposta objeto com HTTP 200 → TypeError, como hoje', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({ message: 'x' })));
    await expect(lerEstoqueVivoML(async () => 't', ['MLB1'])).rejects.toThrow(TypeError);
  });
  it('getToken chamado UMA vez, depois de montar a URL e antes do fetch; rejeição de getToken → sem fetch', async () => {
    const ordem: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => { ordem.push('fetch'); return resp([]); }));
    await lerEstoqueVivoML(async () => { ordem.push('token'); return 't'; }, ['MLB1']);
    expect(ordem).toEqual(['token', 'fetch']);
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    await expect(lerEstoqueVivoML(() => Promise.reject(new Error('sem token')), ['MLB1'])).rejects.toThrow('sem token');
    expect(f).not.toHaveBeenCalled();
  });
});
```

`pulse-coletar/__tests__/situacao.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
// processar.ts → token.ts → supabase.ts alcança import `jsr:`; mesmo mock dos testes existentes do Pulse.
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));
import { lerSituacaoAnuncios } from '../processar.ts';
afterEach(() => vi.unstubAllGlobals());

describe('lerSituacaoAnuncios', () => {
  it('blocos de 20; 404 individual fora; bloco com HTTP 500 não derruba os outros', async () => {
    const ids = Array.from({ length: 41 }, (_, i) => `MLB${i}`);
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      n++;
      if (n === 2) return new Response('x', { status: 500 });
      const q = (new URL(u).searchParams.get('ids') ?? '').split(',');
      return new Response(JSON.stringify(q.map((id) => (id === 'MLB5'
        ? { code: 404, body: { id } }
        : { code: 200, body: { id, status: 'active', sub_status: [], category_id: 'C', listing_type_id: 'gold_pro', price: 9 } }))));
    }));
    const m = await lerSituacaoAnuncios(ids, 't');
    expect(n).toBe(3);
    expect([...m.keys()].sort()).toEqual([...ids.slice(0, 20).filter((i) => i !== 'MLB5'), ids[40]].sort());
    expect(m.get('MLB0')).toEqual({ item_id: 'MLB0', status: 'active', sub_status: [], category_id: 'C', listing_type_id: 'gold_pro', price: 9 });
  });
});
```

- [ ] **Step 2: Extração (P-Extração).**

`acompanhar-migracao-pxv/leitura-ml.ts`. Antes de colar, comparar linha a linha com `index.ts:93-108` e `:172-183`, e copiar o **original** se houver qualquer diferença:

```ts
// Leituras multiget do worker PxV, extraídas de index.ts para teste (ADR-0177). Mesma semântica de antes.
import { corDaVariacaoML } from '../_shared/ml/atualizar-item.ts';

const API = 'https://api.mercadolibre.com';

/** COLOR dos anúncios NOVOS. Lança em HTTP de erro (o worker reagenda). Quem chama já pegou o token. */
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

/** Estoque vivo por item. HTTP de erro → mapa vazio. `getToken` é chamado depois de montar a URL, como no original. */
export async function lerEstoqueVivoML(getToken: () => Promise<string>, ids: string[]): Promise<Map<string, number>> {
  const vivoPorItem = new Map<string, number>();
  const url = `${API}/items?ids=${ids.join(',')}&attributes=id,available_quantity`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}` } });
  if (resp.ok) {
    const json = await resp.json() as Array<{ code?: number; body?: { id?: string; available_quantity?: number } }>;
    for (const l of json ?? []) {
      if (l?.code === 200 && l.body?.id) vivoPorItem.set(String(l.body.id), l.body.available_quantity ?? 0);
    }
  }
  return vivoPorItem;
}
```

Em `index.ts`, a função `lerCores` fica:

```ts
    lerCores: async (itemIds) => {
      if (itemIds.length === 0) return new Map();
      return lerCoresML(await getToken(), itemIds);
    },
```

A ordem do original se mantém: checar a lista vazia, depois `getToken`, depois montar a URL e chamar `fetch`.

Estoque vivo:

```ts
      const ids = [...itemPorSku.values()];
      const vivoPorItem = ids.length > 0 ? await lerEstoqueVivoML(getToken, ids) : new Map<string, number>();
```

Ordem do original: montar a URL, chamar `getToken` dentro dos headers e depois `fetch`. A função recebe `getToken` justamente para preservar isso.

Import: `import { lerCoresML, lerEstoqueVivoML } from './leitura-ml.ts';`. Remover o import de `corDaVariacaoML` de `index.ts` só se ficar órfão.

`pulse-coletar/processar.ts`: extrair as linhas 684-691 para uma função exportada no mesmo arquivo:

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

No lugar original fica `const infoPorItem = await lerSituacaoAnuncios(ids, token);`. Conferir que `API`, `mlGet`, `parseStatusAnuncios` e `AnuncioMultiget` estão no escopo do módulo (`grep -n "const API\|AnuncioMultiget\|parseStatusAnuncios" processar.ts`); `mlGet` é importado na linha 5.

- Testes → PASS.
- Diff só de movimento: as diferenças justificadas são o `getToken` como parâmetro e os wrappers em `index.ts`.
- Commit `refactor(pulse,pxv): extrair leituras do ML (sem mudança de comportamento)`.
- Codex revisa este commit isolado.

- [ ] **Step 3: Testes do bulk, falhando.** Converter os testes para o bulk: respostas com `status_code`, 404 como `{ status_code: 404 }` e asserção de URL:
  - cores: `…/items/bulk?ids=MLB1,MLB2,MLB3&attributes=status_code,body.id,body.attributes`;
  - estoque: `&attributes=status_code,body.id,body.available_quantity`;
  - Pulse: `&attributes=status_code,body.id,body.status,body.sub_status,body.category_id,body.listing_type_id,body.price`.

  Os testes de não-array e de ordem de `getToken` **ficam iguais**. Mais um teste: `lerCoresML('t', ['MLB1', 'MLB1'])` → URL com `ids=MLB1`.

- [ ] **Step 4: Implementar.**
  - `leitura-ml.ts`: as URLs passam a `` `${API}${caminhoMultiget(itemIds, 'id,attributes')}` `` e `` `${API}${caminhoMultiget(ids, 'id,available_quantity')}` ``.
  - O JSON lido passa por `comoEnvelopeAntigo(await resp.json(), itemIds)` e por `comoEnvelopeAntigo(await resp.json(), ids)`, mantendo o cast e o laço.
  - `processar.ts`: `` `${API}${caminhoMultiget(lote, 'id,status,sub_status,category_id,listing_type_id,price')}` `` e `parseStatusAnuncios(comoEnvelopeAntigo(json, lote))`.
  - O comentário de `parse.ts:91` cita `/items/bulk` (ADR-0177) e o envelope antigo entregue pelo adaptador.

- [ ] **Step 5: Testes (`_shared`, `pulse-coletar`, `pulse-analise-secoes237`, `acompanhar-migracao-pxv`) → PASS.** Depois `deno check`.

- [ ] **Step 6: A/B `F5`** (`SHA_BASELINE_AB` = commit da extração). Esperado: `IDÊNTICO`, com `coresPxV21distintos` em `erroEsperado` nos dois lados.

- [ ] **Step 7: Commit (`feat(ml): fatia 5 do /items/bulk — Pulse e migração PxV`), Codex e portão.** Edges: `edges_afetadas.py pulse-coletar/processar.ts acompanhar-migracao-pxv/index.ts acompanhar-migracao-pxv/leitura-ml.ts`.

- [ ] **Step 8: Deploy e observação.**
  - `pulse-coletar` quente: por id, 10 anúncios com situação gravada (status, sub_status, preço) igual à da fase A, para itens sem mudança real.
  - PxV: SQL read-only para ver se há migração ativa. Sem migração ativa, registrar "não observado".

---

### Task T6 (F6): varredura final, docs e spec

**Files:** `docs/reference/edge-functions.md`, `obsidian-vault/03-Módulos/Estoque.md:231`, `docs/runbooks/coletar-trafego-ml.md:102`, `obsidian-vault/04-Decisões/Índice de ADRs.md`, `docs/project-status.md`, `docs/TASKS.md`, `obsidian-vault/09-Logs/Changelog.md` (skill `docs-update-checklist`), e a spec (§4.1 com a regra restrita do adaptador; §5.5 sem A/B pós-deploy).

- [ ] **Step 1: Varredura.**
  - **Produção** (sem testes): `grep -rn "items?ids=" supabase/functions src --include=*.ts --include=*.tsx | grep -v "/__tests__/"` → só estas exceções exatas, todas comentários:
    - `coletar-trafego-ml/deps.ts:135`;
    - `_shared/analise/vendedores-do-catalogo.ts:3`;
    - o comentário de cabeçalho de `_shared/ml/multiget.ts`.

    Qualquer outra linha é bug.
  - **Testes:** `grep -rln "items?ids=" supabase/functions tests --include=*.ts | grep "__tests__\|^tests/"` → só os arquivos de caracterização nomeados neste plano: `buscar-item.test.ts`, `mercado-livre.test.ts` (o `describe.each` com `code`), `multiget.test.ts`, `operacoes/__tests__/ml.test.ts` (fronteira com `code`), e os testes de caracterização de T3 e T5, se mantiverem o envelope antigo.
  - `grep -rnE "(code|status_code)\s*\?\?" supabase/functions --include=*.ts | grep -v __tests__` → só `fiacao.ts:76`.
  - `python3 $CLAUDE_JOB_DIR/tmp/edges_afetadas.py _shared/ml/multiget.ts`, seguido de `manifesto.py conferir <SHA_MAIN> <todas>` → nenhuma divergência. Isso prova que toda edge que importa o adaptador está com o código da `main`.

- [ ] **Step 2: Docs e spec.** Uma linha por arquivo, citando a ADR-0177. Alinhar a spec ao plano v3. Atualizar o Graphify (skill `graphify-update-maintenance`).

- [ ] **Step 3: Pré-merge.**
  - `pnpm preflight`;
  - CI verde;
  - P-Revisão Codex do diff completo (`3b68f702..HEAD`);
  - OK do Diego;
  - merge.
  - No fim, remover a branch e o worktree (`rm -rf` + `git worktree prune`).

---

## Respostas à rodada 2 do Codex

### Achados da v1 que estavam PARCIAIS

| # | O que faltava | v3 |
|---|---|---|
| 3 | grafo só checava `file:` | `edges_afetadas.py` reprova **qualquer** erro de grafo |
| 4 | cenário negativo reprovava | `erroEsperado` com status e mensagem; GETs marcados por cenário; erro de import ou da guarda continua fatal |
| 6 | body fabricado para outros códigos | regra restrita: só bulk 404 sem body, posições confirmadas; formato antigo intacto |
| 7 | canon da descoberta | `descobrirCanon` pela união discriminada (`familia.itemPorCor`, `coresAmbiguas`, `familyIds`); `familyName` preservado; teste de permutação |
| 9 | baselines e bundles | extração validada por P-Extração (sem A/B impossível); A/B pós-deploy removido (manifesto de hash é a prova) |
| 10 | erros engolidos e vazio passando | `violacoes` fatal; cobertura por capacidade com `na` separado; capacidade obrigatória coberta em ≥1 org |
| 11 | gates de escrita | reativação com `lerStatus` real no escopo certo (`vi.spyOn` + restore); fronteira de `lerRelacoes` (200 sem body, ilegível, repetido) nos dois envelopes; motor e split inalterados (limitação declarada na T4) |
| 12 | guarda sem registro fatal | registro de violações; allowlist por cenário, método, rota e campos do corpo |
| 13 | placeholders e testes fracos | constantes fixadas; cores com valor; Pulse com 404 individual |
| 14 | rollback sem config/deps | rollback de `git archive <SHA_PRODUCAO> supabase` (projeto completo), `deno check` antes, conferência de arquivos e JWT depois |
| 15 | metadados | listagem antes e depois de cada download; versão, `verify_jwt` e `ezbr` obrigatórios e estáveis; hash por arquivo persistido |
| 17 | varredura contraditória | regra de produção separada da lista exata de testes de caracterização |

### Achados novos da r2

| # | v3 |
|---|---|
| 1 | adaptador não cria body para 200/500; teste e fronteira `lerRelacoes` (T4) |
| 2 | alinhamento exige ids nas posições; formato antigo intacto; `code:null` intacto |
| 3 | fronteira nos dois envelopes + justificativa declarada (T4) |
| 4 | fixtures sem corte de atributos; conferência de `UNITS_PER_PACK`/`SALE_FORMAT` normalizados |
| 5 | `violacoes` fatal; allowlist por cenário com campos do corpo |
| 6 | `erroEsperado` específico; GETs por cenário |
| 7 | `SHA_PRODUCAO` × `SHA_BASELINE_AB`; P-Extração sem A/B impossível |
| 8 | sem A/B pós-deploy; prova por hash contra a árvore testada |
| 9 | capacidades com `na`; amostra das duas tabelas (`anuncios_externos` + `_itens`), distinta antes do limite |
| 10 | canon pela união discriminada; `itemMortoId` = item real; instrução inexata removida |
| 11 | teste dentro do `describe` existente, `vi.spyOn` + `restoreAllMocks`, arquivo inteiro rodado |
| 12 | constantes do Codex fixadas; cores com valor; 404 individual no Pulse |
| 13 | metadados obrigatórios, estáveis e com hash por arquivo |
| 14 | rollback do projeto completo no `SHA_PRODUCAO` |
| 15 | grafo inteiro; exceções exatas |
| 16 | `lerEstoqueVivoML(getToken, ids)` preserva a ordem URL → token → fetch; teste de ordem e de rejeição |
