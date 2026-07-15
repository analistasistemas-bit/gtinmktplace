# Fix: retry limitado quando catálogo do ML devolve "não elegível" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **v2 (2026-07-15, pós-revisão adversarial com Codex, 2 rounds — ver `../../PLAN-REVIEW-LOG.md`).**
> Se você já implementou a v1 deste plano (função `decidirProximaTentativaCatalogo` separada do
> branch de `pendente`), **descarte esse trabalho** — a v1 tinha um bug real de ordenação
> (`pendente>0` misturado com `nao_elegivel>0` atrasava as variações pendentes) e uma conta de
> backoff errada (~11 dias em vez de ~3,3). Esta v2 substitui por uma única função de decisão.

**Goal:** Parar de tratar `catalog_status='nao_elegivel'` como definitivo na primeira checagem (10min pós-publish) — dar ao ML mais rodadas espaçadas pra elegibilidade assentar antes de desistir, e só então alertar o operador.

**Architecture:** `decidirAcaoCatalogo` (classificador puro, snapshot de UM ponto no tempo) está correto e não muda. O bug está na camada de cima: o worker `vincular-catalogo` trata a primeira resposta "nem READY_FOR_OPTIN nem FAMILY_DIFF" como final e nunca mais reavalia. Fix = **uma única função pura** `decidirResultadoRodadaCatalogo` que decide, numa ordem fixa testada, entre esperar/reagendar/finalizar — eliminando a classe de bug onde `pendente` e `nao_elegivel` misturados interagiam mal.

**Tech Stack:** Deno edge functions, QStash (fila com delay explícito), Vitest.

**Evidência do bug (não refazer — já confirmado ao vivo em 2026-07-15):** live `GET /items/MLB4862137331/catalog_listing_eligibility` mostrou as 18 variações como `READY_FOR_OPTIN`+`buy_box_eligible:true` **agora**, enquanto o banco tem `catalog_status='nao_elegivel'` gravado há 8 dias, na única checagem que rodou (exatos ~10min pós-publish, `pendente=0`, zero retries do QStash disparados). Distribuição completa: nenhuma publicação desde 17/06 conseguiu `vinculado`; ~1035 variações presas em `nao_elegivel` desde então. Ver ADR-0021 (mesmo padrão do incidente "lote 25: 79/79 nao_elegivel no publish").

---

### Task 1: `ResumoCatalogo` ganha `sem_variation_id`; decisão de rodada unificada em `_shared/ml/catalogo.ts`

**Files:**
- Modify: `supabase/functions/_shared/ml/catalogo.ts`
- Modify: `supabase/functions/_shared/ml/__tests__/catalogo.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// em catalogo.test.ts, junto dos testes existentes de decidirAcaoCatalogo
import { decidirResultadoRodadaCatalogo, CATALOGO_MAX_TENTATIVAS, CATALOGO_BACKOFF_SEGUNDOS } from '../catalogo';

describe('decidirResultadoRodadaCatalogo', () => {
  const base: ResumoCatalogo = { vinculado: 0, sem_produto: 0, family_diff: 0, nao_elegivel: 0, pendente: 0, erro: 0, pulou: 0, ficha_divergente: 0, sem_variation_id: 0 };

  it('pendente>0 SEMPRE vence, mesmo com nao_elegivel misturado (bug real encontrado na revisão)', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, pendente: 2, nao_elegivel: 3 }, 1);
    expect(r.acao).toBe('aguardar_elegibilidade');
  });

  it('reagenda quando sobrou nao_elegivel, pendente=0, e ainda há tentativa', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 3 }, 1);
    expect(r).toEqual({ acao: 'reagendar', delaySegundos: CATALOGO_BACKOFF_SEGUNDOS[0], proximaTentativa: 2 });
  });

  it('avança pelo backoff correto rodada a rodada', () => {
    expect(decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 1 }, 2).acao === 'reagendar' &&
      (decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 1 }, 2) as any).delaySegundos).toBe(CATALOGO_BACKOFF_SEGUNDOS[1]);
    expect((decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 1 }, 3) as any).delaySegundos).toBe(CATALOGO_BACKOFF_SEGUNDOS[2]);
    expect((decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 1 }, 4) as any).delaySegundos).toBe(CATALOGO_BACKOFF_SEGUNDOS[3]);
  });

  it('finaliza (com alerta) ao esgotar CATALOGO_MAX_TENTATIVAS', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 3 }, CATALOGO_MAX_TENTATIVAS);
    expect(r).toEqual({ acao: 'finalizar', deveAlertar: true });
  });

  it('sem_variation_id é ESTRUTURAL — finaliza direto na 1ª rodada, não reagenda', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, sem_variation_id: 2 }, 1);
    expect(r).toEqual({ acao: 'finalizar', deveAlertar: true });
  });

  it('sem nada pendente/problemático, finaliza sem alertar', () => {
    expect(decidirResultadoRodadaCatalogo({ ...base, vinculado: 5 }, 1)).toEqual({ acao: 'finalizar', deveAlertar: false });
  });
});
```

E adicionar o campo novo no teste existente de `deveAlertarCatalogoNoMatch` (arquivo `catalogo-alerta.test.ts`, ver Task 2) e no fixture `base` de `catalogo.test.ts` onde `ResumoCatalogo` já é usado (adicionar `sem_variation_id: 0`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run supabase/functions/_shared/ml/__tests__/catalogo.test.ts`
Expected: FAIL — `decidirResultadoRodadaCatalogo`/`sem_variation_id` não existem ainda.

- [ ] **Step 3: Implementar em `catalogo.ts`**

Primeiro, adicionar `sem_variation_id` à interface existente:

```ts
export interface ResumoCatalogo {
  vinculado: number; sem_produto: number; family_diff: number; nao_elegivel: number;
  pendente: number; erro: number; pulou: number; ficha_divergente: number;
  sem_variation_id: number; // estrutural: variação nunca teve ml_variation_id — NÃO é um novo
                             // catalog_status no banco (o check constraint não muda); a linha
                             // continua gravando 'nao_elegivel'. Só existe pra decisão de retry
                             // não tratar isso como transitório (esperar não resolve).
}
```

Depois, no orquestrador `vincularVariacoesCatalogo`, trocar a linha que conta o caso de
`ml_variation_id` ausente (hoje incrementa `resumo.nao_elegivel++`) para incrementar
`resumo.sem_variation_id++` em vez disso — **sem mudar o valor gravado no banco** (continua
`catalog_status: 'nao_elegivel'`):

```ts
// ANTES:
// if (!v.ml_variation_id) { resumo.nao_elegivel++; await setVar(v.id, { catalog_status: 'nao_elegivel' }); continue; }
// DEPOIS:
if (!v.ml_variation_id) { resumo.sem_variation_id++; await setVar(v.id, { catalog_status: 'nao_elegivel' }); continue; }
```

E inicializar `sem_variation_id: 0` no `resumo` inicial da função (mesmo lugar dos outros contadores).

Por fim, adicionar ao final de `catalogo.ts`, perto de `decidirAcaoCatalogo`:

```ts
// Retry limitado quando a elegibilidade volta nao_elegivel (ADR-0021 addendum, incidente
// 2026-07-15): uma resposta que não é READY_FOR_OPTIN nem FAMILY_DIFF pode ser transitória por
// MUITO mais tempo que os 10min do 1º check (confirmado ao vivo: MLB4862137331 assentou em
// READY_FOR_OPTIN só dias depois). sem_produto/ficha_divergente/family_diff/sem_variation_id NÃO
// reagendam — são decisões de CONTEÚDO ou estruturais (ficha errada, família diferente, variação
// sem ID no ML), não de tempo de processamento; esperar não muda o dado.
//
// Backoff a partir da 2ª rodada (a 1ª é a existente, 10min, inalterada). Total até desistir:
// 10min + 1h + 6h + 24h + 48h ≈ 3,3 dias — deliberadamente NÃO estendido a ~9-11 dias: o propósito
// do alerta (ADR-0036) é avisar o operador ANTES do ML pausar o anúncio, e não temos o SLA real de
// settle do ML pra apostar numa janela maior sem risco de o alerta chegar tarde demais.
export const CATALOGO_BACKOFF_SEGUNDOS = [3600, 21600, 86400, 172800]; // 1h, 6h, 24h, 48h
export const CATALOGO_MAX_TENTATIVAS = CATALOGO_BACKOFF_SEGUNDOS.length + 1; // 5 (1ª rodada existente + 4 daqui)

export type ResultadoRodadaCatalogo =
  | { acao: 'aguardar_elegibilidade' }
  | { acao: 'reagendar'; delaySegundos: number; proximaTentativa: number }
  | { acao: 'finalizar'; deveAlertar: boolean };

/**
 * Decisão única por rodada, ordem fixa (elimina o bug de ordenação encontrado na revisão: uma
 * família com `pendente>0` E `nao_elegivel>0` misturados SEMPRE espera pelas pendentes primeiro —
 * nunca posterga o retry rápido nativo do QStash pro backoff longo de negócio).
 */
export function decidirResultadoRodadaCatalogo(
  resumo: ResumoCatalogo,
  tentativaAtual: number,
): ResultadoRodadaCatalogo {
  if (resumo.pendente > 0) return { acao: 'aguardar_elegibilidade' };
  if (resumo.nao_elegivel > 0 && tentativaAtual < CATALOGO_MAX_TENTATIVAS) {
    const idx = tentativaAtual - 1; // tentativa 1 -> idx 0 (1h) ... tentativa 4 -> idx 3 (48h)
    return { acao: 'reagendar', delaySegundos: CATALOGO_BACKOFF_SEGUNDOS[idx], proximaTentativa: tentativaAtual + 1 };
  }
  return { acao: 'finalizar', deveAlertar: deveAlertarCatalogoNoMatch(resumo) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run supabase/functions/_shared/ml/__tests__/catalogo.test.ts`
Expected: PASS (todos, incluindo os já existentes de `decidirAcaoCatalogo`/`fichaEquivalente`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/catalogo.ts supabase/functions/_shared/ml/__tests__/catalogo.test.ts
git commit -m "feat(catalogo): decidirResultadoRodadaCatalogo unifica decisao de retry (v2 pos-revisao)"
```

---

### Task 2: Alerta (ADR-0036) passa a considerar `nao_elegivel`/`sem_variation_id` esgotados, com motivo

**Files:**
- Modify: `supabase/functions/_shared/ml/catalogo.ts`
- Modify: `supabase/functions/_shared/ml/__tests__/catalogo-alerta.test.ts`
- Modify: `supabase/functions/_shared/notificacoes/telegram.ts`

- [ ] **Step 1: Write the failing test**

```ts
// em catalogo-alerta.test.ts — atualizar `base` com sem_variation_id: 0 e adicionar:
it('alerta quando nao_elegivel sobrou e pendente=0 (retry já esgotado é decidido por fora)', () => {
  expect(deveAlertarCatalogoNoMatch({ ...base, nao_elegivel: 2 })).toBe(true);
});

it('alerta quando sem_variation_id sobrou (estrutural, sempre alerta)', () => {
  expect(deveAlertarCatalogoNoMatch({ ...base, sem_variation_id: 2 })).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run supabase/functions/_shared/ml/__tests__/catalogo-alerta.test.ts`
Expected: FAIL — hoje `deveAlertarCatalogoNoMatch` só olha `ficha_divergente`/`sem_produto`.

- [ ] **Step 3: Implementar**

```ts
// deveAlertarCatalogoNoMatch em catalogo.ts:
export function deveAlertarCatalogoNoMatch(resumo: ResumoCatalogo): boolean {
  return resumo.pendente === 0 && (
    resumo.ficha_divergente > 0 || resumo.sem_produto > 0 ||
    resumo.nao_elegivel > 0 || resumo.sem_variation_id > 0
  );
}
```

Adicionar parâmetro opcional `motivo` em `montarMensagemCatalogoNoMatch` (`_shared/notificacoes/telegram.ts`)
pra diferenciar a frase entre "ficha de kit/divergente" (motivo atual, default) e "elegibilidade
esgotada após múltiplas tentativas" (quando a causa for só `nao_elegivel`/`sem_variation_id`) — sem
criar um sistema de template novo, só um branch de texto a mais na mesma função.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run supabase/functions/_shared/ml/__tests__/catalogo-alerta.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/catalogo.ts supabase/functions/_shared/ml/__tests__/catalogo-alerta.test.ts supabase/functions/_shared/notificacoes/telegram.ts
git commit -m "feat(catalogo): alerta ADR-0036 cobre nao_elegivel/sem_variation_id esgotados, com motivo"
```

---

### Task 3: Job carrega `tentativa` validado; `enfileirarVinculacaoCatalogo` aceita backoff/retries explícitos

**Files:**
- Modify: `supabase/functions/_shared/queue.ts:115-136`

- [ ] **Step 1: Implementar**

```ts
export interface VincularCatalogoJob { familia_id: string; tentativa?: number; }

export async function enfileirarVinculacaoCatalogo(
  familiaId: string,
  delaySeconds = 600,
  tentativa = 1,
  retries = 5, // reenfileiramentos EXPLÍCITOS (reagendar) devem passar retries=2 — o backoff já é
               // de negócio, não precisa do envelope nativo de 5 do QStash empilhado em cima.
): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const target = `${url}/functions/v1/vincular-catalogo`;
  const { messageId } = await qstashClient().publishJSON({
    url: target,
    body: { familia_id: familiaId, tentativa } satisfies VincularCatalogoJob,
    delay: delaySeconds,
    retries,
  });
  return messageId;
}
```

Chamadores existentes (`publish-familia-ml`, `update-familia-ml`, `publicar-split-ml`) não mudam —
continuam chamando com só `familiaId` (delay/tentativa/retries default = 600s/1/5, comportamento
idêntico ao atual no 1º publish).

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/queue.ts
git commit -m "feat(catalogo): job de vinculacao carrega tentativa validada; retries configuravel"
```

---

### Task 4: Worker `vincular-catalogo` usa a decisão unificada

**Files:**
- Modify: `supabase/functions/vincular-catalogo/index.ts`
- Test: `supabase/functions/vincular-catalogo/__tests__/decisao.test.ts` (novo)

- [ ] **Step 1: Write a regression test for the exact bug the review found (mixed pendente+nao_elegivel)**

```ts
// supabase/functions/vincular-catalogo/__tests__/decisao.test.ts
import { describe, it, expect } from 'vitest';
import { decidirResultadoRodadaCatalogo, deveAlertarCatalogoNoMatch, type ResumoCatalogo } from '../../_shared/ml/catalogo';

describe('fluxo de decisão do worker (regressão do incidente 2026-07-15 + bug de ordenação da revisão)', () => {
  const base: ResumoCatalogo = { vinculado: 0, sem_produto: 0, family_diff: 0, nao_elegivel: 0, pendente: 0, erro: 0, pulou: 0, ficha_divergente: 0, sem_variation_id: 0 };

  it('mistura pendente+nao_elegivel: NUNCA reagenda pro backoff longo — sempre aguarda o retry rápido nativo primeiro', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, pendente: 3, nao_elegivel: 5 }, 1);
    expect(r.acao).toBe('aguardar_elegibilidade');
  });

  it('1ª rodada só com nao_elegivel: reagenda e NÃO alerta ainda', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 8 }, 1);
    expect(r.acao).toBe('reagendar');
  });

  it('última rodada ainda nao_elegivel: finaliza e alerta', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 8 }, 5);
    expect(r).toEqual({ acao: 'finalizar', deveAlertar: true });
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (a lógica já existe da Task 1 — este é o teste de regressão do cenário real, confirmar que passa)

Run: `pnpm vitest run supabase/functions/vincular-catalogo/__tests__/decisao.test.ts`
Expected: PASS.

- [ ] **Step 3: Implementar no worker**

Trocar a interface local `Job` pela do `queue.ts` e importar a decisão unificada:

```ts
import { verificarAssinatura, enfileirarVinculacaoCatalogo, type VincularCatalogoJob } from '../_shared/queue.ts';
import { vincularVariacoesCatalogo, deveAlertarCatalogoNoMatch, decidirResultadoRodadaCatalogo } from '../_shared/ml/catalogo.ts';
// ...
type Job = VincularCatalogoJob;
```

Logo após calcular `resumo` (onde hoje está `if (resumo.pendente > 0) { return 500 }`), substituir
esse bloco inteiro por:

```ts
const tentativaAtual = Number.isInteger(job.tentativa) && (job.tentativa as number) >= 1 ? (job.tentativa as number) : 1;
const resultado = decidirResultadoRodadaCatalogo(resumo, tentativaAtual);

if (resultado.acao === 'aguardar_elegibilidade') {
  return new Response(`elegibilidade ainda não computada (${resumo.pendente} pendentes)`, { status: 500, headers: corsHeaders });
}
if (resultado.acao === 'reagendar') {
  await enfileirarVinculacaoCatalogo(job.familia_id, resultado.delaySegundos, resultado.proximaTentativa, 2);
  console.log(`catálogo (job) ${familia.ml_item_id}: nao_elegivel na tentativa ${tentativaAtual}, reagendado p/ tentativa ${resultado.proximaTentativa} em +${resultado.delaySegundos}s`);
  return new Response(JSON.stringify({ reagendado: true, proximaTentativa: resultado.proximaTentativa }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
// resultado.acao === 'finalizar' — segue o fluxo existente de espelhar + (se resultado.deveAlertar) alertar,
// usando resultado.deveAlertar no lugar de chamar deveAlertarCatalogoNoMatch(resumo) direto.
```

E no filtro de cores do alerta (mais abaixo no mesmo arquivo), incluir `nao_elegivel` (e opcionalmente
`sem_variation_id` — mas essa não é gravada como status distinto no banco, então já cai em
`nao_elegivel`):

```ts
const cores = [...new Set((varsEspelho ?? [])
  .filter((v) => v.catalog_status === 'ficha_divergente' || v.catalog_status === 'sem_produto' || v.catalog_status === 'nao_elegivel')
  .map((v) => v.cor).filter(Boolean))];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run supabase/functions/vincular-catalogo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/vincular-catalogo/index.ts supabase/functions/vincular-catalogo/__tests__/decisao.test.ts
git commit -m "fix(catalogo): worker usa decisao unificada — corrige bug de ordenacao pendente+nao_elegivel"
```

---

### Task 5: Docs — ADR-0021 addendum, ADR-0036 nota, edge-functions.md, TASKS.md

**Files:**
- Modify: `docs/decisions/0021-vinculacao-automatica-ao-catalogo-ml.md`
- Modify: `docs/decisions/0036-alerta-catalogo-no-match.md`
- Modify: `docs/reference/edge-functions.md`
- Modify: `docs/TASKS.md`

- [ ] **Step 1:** Adicionar seção `## Revisão pós-incidente (2026-07-15) — retry limitado para nao_elegivel transitório` ao ADR-0021: contexto (achado via checagem ao vivo do MLB4862137331), causa raiz (1 única checagem tratando "nem ready nem family_diff" como definitivo), decisão (`CATALOGO_BACKOFF_SEGUNDOS`/`decidirResultadoRodadaCatalogo`, ~3,3 dias, `sem_variation_id` separado), riscos aceitos (idempotência pré-existente do opt-in, chains paralelos em republish), consequências.
- [ ] **Step 2:** Nota curta em ADR-0036: alerta agora também cobre `nao_elegivel`/`sem_variation_id` esgotados, disparado só após a última rodada, com mensagem categorizada por `motivo`.
- [ ] **Step 3:** `edge-functions.md`: atualizar a entrada de `vincular-catalogo` com o novo fluxo de reagendamento (~3,3 dias, decisão unificada).
- [ ] **Step 4:** `TASKS.md`: entry curta registrando o fix + o achado do incidente sistêmico (~1035 variações desde 17/06) + nota que a revisão adversarial (Codex) corrigiu um bug de ordenação real antes de qualquer código ser escrito.
- [ ] **Step 5: Commit**

```bash
git add docs/decisions/0021-vinculacao-automatica-ao-catalogo-ml.md docs/decisions/0036-alerta-catalogo-no-match.md docs/reference/edge-functions.md docs/TASKS.md
git commit -m "docs: registra incidente + fix de retry no vincular-catalogo (ADR-0021/0036)"
```

---

### Task 6 (NÃO EXECUTAR SEM O DIEGO): remediação das ~1035 variações já presas

Depois do deploy do fix (Tasks 1-5 + `supabase functions deploy vincular-catalogo`), as famílias
publicadas entre 17/06 e hoje continuam com `catalog_status='nao_elegivel'` já persistido — o fix
só afeta publicações NOVAS. Recuperar as antigas exige reenfileirar `vincular-catalogo` com
`tentativa=1` pra cada família afetada:

```sql
-- só leitura, pra dimensionar antes de decidir
select f.id, f.ml_item_id, count(*) as variacoes_nao_elegivel
from familias f join variacoes v on v.familia_id = f.id
where v.catalog_status = 'nao_elegivel'
group by f.id, f.ml_item_id
order by variacoes_nao_elegivel desc;
```

Reenfileirar dispara chamadas reais à API do ML e, se a elegibilidade já assentou, um **opt-in real**
(cria anúncio de catálogo paralelo de verdade). Não é reversível de forma trivial (ADR-0021: opt-in
cria recurso novo no ML). Fazer em **lotes pequenos** (ex.: 20-50 famílias por vez, espaçados),
conferindo o `resumo` de cada rodada antes de continuar — evita gerar uma rajada de opt-ins reais
sem supervisão. **Isso é uma decisão de operação, não de código — só rodar com o Diego decidindo o
lote/timing, não como parte automática deste plano.**

---

## Resumo do que muda e o que não muda (v2)

- `decidirAcaoCatalogo` (classificador puro): **sem mudança** — a leitura pontual sempre esteve certa.
- Novo: `decidirResultadoRodadaCatalogo` (função ÚNICA — substitui a `decidirProximaTentativaCatalogo`
  da v1, que tinha um bug de ordenação encontrado na revisão) + `CATALOGO_BACKOFF_SEGUNDOS` (~3,3 dias,
  não ~9-11 como a v1 calculava errado).
- `ResumoCatalogo`: +campo `sem_variation_id` (só em memória, não é status novo no banco).
- `deveAlertarCatalogoNoMatch`: +condições `nao_elegivel > 0` e `sem_variation_id > 0`.
- `montarMensagemCatalogoNoMatch`: +parâmetro opcional `motivo`.
- `VincularCatalogoJob`/`enfileirarVinculacaoCatalogo`: +campo `tentativa` (validado no worker) e
  +parâmetro `retries` (2 nos reenfileiramentos explícitos, 5 no enqueue original — default).
- `vincular-catalogo/index.ts`: usa `decidirResultadoRodadaCatalogo` no lugar dos dois branches soltos
  da v1; filtro de cores do alerta inclui `nao_elegivel`.
- Nenhuma migration de banco.
- Riscos conhecidos e conscientemente NÃO resolvidos (documentados, fora de escopo): idempotência do
  opt-in sob entrega duplicada do QStash (pré-existente), chains de retry paralelos quando uma família
  é republicada no meio da janela.
