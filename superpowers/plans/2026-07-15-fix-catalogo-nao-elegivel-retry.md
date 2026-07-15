# Fix: retry limitado quando catálogo do ML devolve "não elegível" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parar de tratar `catalog_status='nao_elegivel'` como definitivo na primeira checagem (10min pós-publish) — dar ao ML mais rodadas espaçadas pra elegibilidade assentar antes de desistir, e só então alertar o operador.

**Architecture:** `decidirAcaoCatalogo` (classificador puro, snapshot de UM ponto no tempo) está correto e não muda. O bug está na camada de cima: o worker `vincular-catalogo` trata a primeira resposta "nem READY_FOR_OPTIN nem FAMILY_DIFF" como final e nunca mais reavalia. Fix = uma função pura nova (`decidirProximaTentativaCatalogo`) que decide se vale a pena reenfileirar, mais um contador `tentativa` explícito no payload do job (não dá pra usar o `Upstash-Retried` do QStash porque o backoff precisa ir a horas/1 dia — fora da janela de retry nativa do QStash pra esse job).

**Tech Stack:** Deno edge functions, QStash (fila com delay explícito), Vitest.

**Evidência do bug (não refazer — já confirmado ao vivo em 2026-07-15):** live `GET /items/MLB4862137331/catalog_listing_eligibility` mostrou as 18 variações como `READY_FOR_OPTIN`+`buy_box_eligible:true` **agora**, enquanto o banco tem `catalog_status='nao_elegivel'` gravado há 8 dias, na única checagem que rodou (exatos ~10min pós-publish, `pendente=0`, zero retries do QStash disparados). Distribuição completa: nenhuma publicação desde 17/06 conseguiu `vinculado`; ~1035 variações presas em `nao_elegivel` desde então. Ver ADR-0021 (mesmo padrão do incidente "lote 25: 79/79 nao_elegivel no publish").

---

### Task 1: Backoff pura em `_shared/ml/catalogo.ts`

**Files:**
- Modify: `supabase/functions/_shared/ml/catalogo.ts`
- Modify: `supabase/functions/_shared/ml/__tests__/catalogo.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// em catalogo.test.ts, junto dos testes existentes de decidirAcaoCatalogo
import { decidirProximaTentativaCatalogo, CATALOGO_MAX_TENTATIVAS, CATALOGO_BACKOFF_SEGUNDOS } from '../catalogo';

describe('decidirProximaTentativaCatalogo', () => {
  const base: ResumoCatalogo = { vinculado: 0, sem_produto: 0, family_diff: 0, nao_elegivel: 0, pendente: 0, erro: 0, pulou: 0, ficha_divergente: 0 };

  it('reagenda quando sobrou nao_elegivel e ainda há tentativas', () => {
    const d = decidirProximaTentativaCatalogo({ ...base, nao_elegivel: 3 }, 1);
    expect(d.tentarDeNovo).toBe(true);
    expect(d.delaySegundos).toBe(CATALOGO_BACKOFF_SEGUNDOS[1]); // 2ª rodada = índice 1
  });

  it('para de reagendar ao esgotar CATALOGO_MAX_TENTATIVAS', () => {
    const d = decidirProximaTentativaCatalogo({ ...base, nao_elegivel: 3 }, CATALOGO_MAX_TENTATIVAS);
    expect(d.tentarDeNovo).toBe(false);
  });

  it('NÃO reagenda quando não há nao_elegivel (sem_produto/ficha_divergente são definitivos, não transitórios)', () => {
    expect(decidirProximaTentativaCatalogo({ ...base, sem_produto: 2 }, 1).tentarDeNovo).toBe(false);
    expect(decidirProximaTentativaCatalogo(base, 1).tentarDeNovo).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run supabase/functions/_shared/ml/__tests__/catalogo.test.ts`
Expected: FAIL — `decidirProximaTentativaCatalogo` não existe.

- [ ] **Step 3: Implementar (adicionar ao final de `catalogo.ts`, perto de `decidirAcaoCatalogo`)**

```ts
// Rodadas extras quando a elegibilidade volta nao_elegivel (ADR-0021 addendum, incidente
// 2026-07-15): uma resposta que não é READY_FOR_OPTIN nem FAMILY_DIFF pode ser transitória por
// MUITO mais tempo que os 10min do 1º check (confirmado ao vivo: MLB4862137331 assentou em
// READY_FOR_OPTIN só dias depois). sem_produto/ficha_divergente/family_diff NÃO reagendam — são
// decisões de conteúdo (ficha errada/família diferente), não de tempo; esperar não muda o dado.
export const CATALOGO_BACKOFF_SEGUNDOS = [600, 3600, 21600, 86400]; // 10min, 1h, 6h, 24h
export const CATALOGO_MAX_TENTATIVAS = CATALOGO_BACKOFF_SEGUNDOS.length;

export interface DecisaoProximaTentativa {
  tentarDeNovo: boolean;
  delaySegundos: number;
}

export function decidirProximaTentativaCatalogo(
  resumo: ResumoCatalogo,
  tentativaAtual: number,
): DecisaoProximaTentativa {
  const tentarDeNovo = resumo.nao_elegivel > 0 && tentativaAtual < CATALOGO_MAX_TENTATIVAS;
  const idx = Math.min(tentativaAtual, CATALOGO_BACKOFF_SEGUNDOS.length - 1);
  return { tentarDeNovo, delaySegundos: CATALOGO_BACKOFF_SEGUNDOS[idx] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run supabase/functions/_shared/ml/__tests__/catalogo.test.ts`
Expected: PASS (todos os testes, incluindo os já existentes de `decidirAcaoCatalogo`/`fichaEquivalente`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/catalogo.ts supabase/functions/_shared/ml/__tests__/catalogo.test.ts
git commit -m "feat(catalogo): decidirProximaTentativaCatalogo p/ retry limitado de nao_elegivel"
```

---

### Task 2: Alerta (ADR-0036) passa a considerar `nao_elegivel` esgotado

**Files:**
- Modify: `supabase/functions/_shared/ml/catalogo.ts`
- Modify: `supabase/functions/_shared/ml/__tests__/catalogo-alerta.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// em catalogo-alerta.test.ts
it('alerta quando nao_elegivel sobrou e pendente=0 (retry já esgotado é decidido por fora)', () => {
  expect(deveAlertarCatalogoNoMatch({ ...base, nao_elegivel: 2 })).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run supabase/functions/_shared/ml/__tests__/catalogo-alerta.test.ts`
Expected: FAIL — hoje `deveAlertarCatalogoNoMatch` só olha `ficha_divergente`/`sem_produto`.

- [ ] **Step 3: Implementar**

```ts
// deveAlertarCatalogoNoMatch em catalogo.ts — adicionar nao_elegivel à condição:
export function deveAlertarCatalogoNoMatch(resumo: ResumoCatalogo): boolean {
  return resumo.pendente === 0 && (resumo.ficha_divergente > 0 || resumo.sem_produto > 0 || resumo.nao_elegivel > 0);
}
```

Nota: esta função continua pura e "míope" (só olha o resumo de UMA rodada) — quem garante que só
dispara depois de esgotar as tentativas é o worker (Task 3), chamando-a só quando
`decidirProximaTentativaCatalogo(...).tentarDeNovo === false`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run supabase/functions/_shared/ml/__tests__/catalogo-alerta.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/catalogo.ts supabase/functions/_shared/ml/__tests__/catalogo-alerta.test.ts
git commit -m "feat(catalogo): alerta ADR-0036 tambem cobre nao_elegivel esgotado"
```

---

### Task 3: Job carrega `tentativa`; `enfileirarVinculacaoCatalogo` aceita backoff explícito

**Files:**
- Modify: `supabase/functions/_shared/queue.ts:115-136`

- [ ] **Step 1: Implementar (sem teste unitário isolado — é infra de fila; a garantia vem do teste do worker na Task 4)**

```ts
export interface VincularCatalogoJob { familia_id: string; tentativa?: number; }

export async function enfileirarVinculacaoCatalogo(
  familiaId: string,
  delaySeconds = 600,
  tentativa = 1,
): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const target = `${url}/functions/v1/vincular-catalogo`;
  const { messageId } = await qstashClient().publishJSON({
    url: target,
    body: { familia_id: familiaId, tentativa } satisfies VincularCatalogoJob,
    delay: delaySeconds,
    retries: 5,
  });
  return messageId;
}
```

Chamadores existentes (`publish-familia-ml`, `update-familia-ml`, `publicar-split-ml`) não mudam —
continuam chamando com só `familiaId` (delay/tentativa default = 600s/1, comportamento idêntico
ao atual no 1º publish).

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/queue.ts
git commit -m "feat(catalogo): job de vinculacao carrega tentativa explicita"
```

---

### Task 4: Worker `vincular-catalogo` reagenda em vez de finalizar cedo

**Files:**
- Modify: `supabase/functions/vincular-catalogo/index.ts`
- Test: `supabase/functions/vincular-catalogo/__tests__/index.test.ts` (novo — hoje não existe teste pra esse worker; se subir custo demais, ao menos cobrir a decisão via teste da Task 1/2 já é suficiente e este arquivo pode virar um teste de integração mínimo)

- [ ] **Step 1: Write a smoke test isolando só a decisão de reagendar (evita mockar QStash/Supabase inteiros)**

```ts
// supabase/functions/vincular-catalogo/__tests__/decisao.test.ts
import { describe, it, expect } from 'vitest';
import { decidirProximaTentativaCatalogo, deveAlertarCatalogoNoMatch, type ResumoCatalogo } from '../../_shared/ml/catalogo';

// Reproduz o incidente real: 8 variações, todas nao_elegivel na 1ª rodada.
describe('fluxo de decisão do worker (regressão do incidente 2026-07-15)', () => {
  const resumoIncidente: ResumoCatalogo = { vinculado: 0, sem_produto: 0, family_diff: 0, nao_elegivel: 8, pendente: 0, erro: 0, pulou: 0, ficha_divergente: 0 };

  it('1ª rodada: reagenda e NÃO alerta ainda', () => {
    const decisao = decidirProximaTentativaCatalogo(resumoIncidente, 1);
    expect(decisao.tentarDeNovo).toBe(true);
    // o worker só chama deveAlertarCatalogoNoMatch quando tentarDeNovo é false — aqui ainda não chamaria.
  });

  it('última rodada ainda nao_elegivel: não reagenda mais e alerta', () => {
    const decisao = decidirProximaTentativaCatalogo(resumoIncidente, 4);
    expect(decisao.tentarDeNovo).toBe(false);
    expect(deveAlertarCatalogoNoMatch(resumoIncidente)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run supabase/functions/vincular-catalogo/__tests__/decisao.test.ts`
Expected: PASS na verdade (a lógica já existe das Tasks 1-2) — este teste serve de trava de
regressão do cenário real, não precisa falhar antes. Confirmar que passa.

- [ ] **Step 3: Implementar no worker — inserir logo após calcular `resumo` (linha ~49 atual), ANTES do bloco `if (resumo.pendente > 0)`**

```ts
const tentativaAtual = job.tentativa ?? 1;
const decisaoRetry = decidirProximaTentativaCatalogo(resumo, tentativaAtual);
if (decisaoRetry.tentarDeNovo) {
  await enfileirarVinculacaoCatalogo(job.familia_id, decisaoRetry.delaySegundos, tentativaAtual + 1);
  console.log(`catálogo (job) ${familia.ml_item_id}: nao_elegivel na tentativa ${tentativaAtual}, reagendado p/ +${decisaoRetry.delaySegundos}s`);
  return new Response(JSON.stringify({ reagendado: true, tentativa: tentativaAtual + 1 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
```

E atualizar os imports/interface do topo:

```ts
import { verificarAssinatura, enfileirarVinculacaoCatalogo, type VincularCatalogoJob } from '../_shared/queue.ts';
import { vincularVariacoesCatalogo, deveAlertarCatalogoNoMatch, decidirProximaTentativaCatalogo } from '../_shared/ml/catalogo.ts';
// ...
type Job = VincularCatalogoJob; // troca a interface local pela do queue.ts (já tem tentativa)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run supabase/functions/vincular-catalogo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/vincular-catalogo/index.ts supabase/functions/vincular-catalogo/__tests__/decisao.test.ts
git commit -m "fix(catalogo): worker reagenda em vez de fechar nao_elegivel na 1a rodada"
```

---

### Task 5: Docs — ADR-0021 addendum, ADR-0036 nota, edge-functions.md, TASKS.md

**Files:**
- Modify: `docs/decisions/0021-vinculacao-automatica-ao-catalogo-ml.md`
- Modify: `docs/decisions/0036-alerta-catalogo-no-match.md`
- Modify: `docs/reference/edge-functions.md`
- Modify: `docs/TASKS.md`

- [ ] **Step 1:** Adicionar seção `## Revisão pós-incidente (2026-07-15) — retry limitado para nao_elegivel transitório` ao ADR-0021, no mesmo formato da revisão de 2026-06-15 já existente: contexto (achado via checagem ao vivo do MLB4862137331), causa raiz (1 única checagem tratando "nem ready nem family_diff" como definitivo), decisão (`CATALOGO_BACKOFF_SEGUNDOS`/`decidirProximaTentativaCatalogo`), consequências.
- [ ] **Step 2:** Nota curta em ADR-0036: alerta agora também cobre `nao_elegivel` esgotado (mesma UX — "Verifique seu produto" no painel do ML), disparado só após a última rodada.
- [ ] **Step 3:** `edge-functions.md`: atualizar a entrada de `vincular-catalogo` com o novo fluxo de reagendamento.
- [ ] **Step 4:** `TASKS.md`: entry curta registrando o fix + o achado do incidente sistêmico (~1035 variações desde 17/06).
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
cria recurso novo no ML). **Isso é uma decisão de operação, não de código — só rodar com o Diego
decidindo o lote/timing, não como parte automática deste plano.**

---

## Resumo do que muda e o que não muda

- `decidirAcaoCatalogo` (classificador puro): **sem mudança** — a leitura pontual sempre esteve certa.
- Novo: `decidirProximaTentativaCatalogo` + `CATALOGO_BACKOFF_SEGUNDOS` (`_shared/ml/catalogo.ts`).
- `deveAlertarCatalogoNoMatch`: +1 condição (`nao_elegivel > 0`).
- `VincularCatalogoJob`/`enfileirarVinculacaoCatalogo`: +campo `tentativa` (default 1, retrocompatível).
- `vincular-catalogo/index.ts`: novo branch de reagendamento antes do branch de `pendente`.
- Nenhuma migration de banco — tudo cabe no payload do job (estado transiente, não precisa persistir).
