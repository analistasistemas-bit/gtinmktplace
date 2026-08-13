# Catálogo em risco — Plano de implementação (Fase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O worker de catálogo volta a perguntar a elegibilidade de variações `pendente` (backoff longo em vez de retry curto do QStash), o alerta do ADR-0036 passa a cobrir `pendente` residual, falha de leitura de elegibilidade nunca finaliza a rodada, as 93 famílias congeladas são re-enfileiradas, e a tela Publicados ganha o card "Catálogo em risco".

**Architecture:** Correções em funções puras de `_shared/ml/catalogo.ts` (decisão de rodada, alerta) + guard no orquestrador + simplificação do worker `vincular-catalogo`. Tela: função pura de agregação em `src/lib/`, query PostgREST nova em `src/lib/queries.ts`, hook e card seguindo o padrão do banner de moderados em `Publicados.tsx`. Backfill: script Deno de manutenção reutilizando `enfileirarVinculacaoCatalogo`.

**Tech Stack:** Deno (edge functions Supabase), vitest, React + TanStack Query + PostgREST, QStash.

**Spec:** `docs/superpowers/specs/2026-08-12-catalogo-em-risco-design.md`

## Fora de escopo (decidido)

- **Fase 3 (extensão de navegador)** fica fora: depende da incógnita do formato do `productId` no PATCH interno do ML (seção "Incógnita conhecida" da spec). As Partes 1 e 2 não dependem dela. Por consequência, o botão "Resolver todos no ML" **não entra** nesta fase — a tela entrega lista + link por anúncio, que a spec declara ter valor isolado.
- Nenhuma migration, nenhum `catalog_status` novo (decisão explícita da spec).

## Global Constraints

- A trava `fichaEquivalente` (ADR-0021 pós-incidente do kit) permanece intacta — nenhuma tarefa a toca.
- `CATALOGO_BACKOFF_SEGUNDOS = [3600, 21600, 86400, 172800]` e `CATALOGO_MAX_TENTATIVAS = 5` não mudam.
- Nenhuma escrita direta na API do ML fora do fluxo do app. O backfill dispara o worker existente (fluxo sancionado do ADR-0021), nunca chamadas manuais.
- Toda consulta da feature filtra `ml_variation_id is not null` (sem isso, 2.234 falsos positivos).
- `pendente` residual na finalização é reportado como está — **não** é reetiquetado para outro status.
- Testes: `pnpm test` (exige `.env.test`). Lint: `pnpm lint`.
- Commits em português, terminando com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Achados da análise crítica (verificados contra o código)

1. **A causa raiz da spec confere.** `decidirResultadoRodadaCatalogo` (catalogo.ts:421) devolve `aguardar_elegibilidade` para `pendente > 0`, o worker responde 500 (index.ts:74-76) e o QStash retenta 5× em minutos. Esgotado, ninguém pergunta de novo. `deveAlertarCatalogoNoMatch` exige `pendente === 0` (catalogo.ts:384) — silêncio duplo confirmado.
2. **O guard 1.2 procede, mas o bug é PRÉ-existente**, não introduzido pela correção 1.1: hoje o `catch` de `buscarElegibilidadeCatalogo` (catalogo.ts:455-458) devolve resumo zerado, que já cai em `finalizar` sem alerta (pendente=0, nao_elegivel=0). A correção continua necessária e ganha urgência com 1.1.
3. **Nuance não coberta pela spec:** `mlGet` devolve `null` em HTTP não-ok (não lança). Nesse caso o mapa de elegibilidade sai vazio e TODAS as variações viram `pendente` — que, com 1.1, reagenda pelo backoff (comportamento aceitável, autocorretivo). O guard 1.2 cobre apenas exceções (timeout/rede). Nenhum código extra necessário; registrado para não "consertar" errado depois.
4. **Caminho UP (ADR-0088):** herda 1.1 e 1.3 de graça (o worker aplica `decidirResultadoRodadaCatalogo`/`deveAlertarCatalogoNoMatch` sobre o resumo de qualquer rota). Mas o análogo do 1.2 NÃO é herdado: em `vincularItensCatalogoUP`, uma falha do GET de elegibilidade cai no catch por item e **persiste `catalog_status='erro'`** — "não perguntei" tratado como estado final do item. Task 4 corrige (falha de leitura → `pendente`, retentável).
5. **Implementação do 1.2 escolhida: exceção propagada** (a spec oferecia "campo `elegibilidade_falhou` ou exceção"). Propagar reaproveita o catch externo do worker que já devolve 500 — zero campo novo, e `aguardar_elegibilidade` vira código morto e é removido.
6. **Testes que quebram com a mudança** (atualizados nas tasks): `catalogo.test.ts:77` ("pendente>0 SEMPRE vence... → aguardar_elegibilidade") e `catalogo-alerta.test.ts:28` ("NÃO alerta enquanto pendente>0"). Nenhum outro teste referencia `aguardar_elegibilidade`.
7. **Imprecisões menores da spec** (não invalidam o plano): (a) `enfileirarVinculacaoCatalogo` usa `publishJSON`, não fila serializada por usuário — a "serialização por usuário já existente" citada na seção 1.4 não existe nesse caminho; o script escalona os delays para compensar. (b) A consequência do alerta exige também nova causa em `montarMensagemCatalogoNoMatch` (telegram.ts) e a inclusão de `pendente` nos filtros de cores do worker — sem isso o alerta de `elegibilidade_nao_resolvida` sairia sem cores.
8. **Números confirmados no banco (2026-08-13, read-only):** 93 famílias / 296 variações `pendente` com `ml_variation_id` e `ml_item_id` não nulos — idêntico à spec.
9. **Deploy:** o ÚNICO importador de `_shared/ml/catalogo.ts` é `vincular-catalogo` (index.ts e vinculacao.ts — verificado por grep). Mas a Task 2 muda `_shared/notificacoes/telegram.ts`, importado por 8 funções — pela regra do CLAUDE.md (mudança em `_shared/` → redeploy de todas as afetadas), todas entram na lista da Task 9.

---

### Task 1: `pendente` entra no backoff longo (correção 1.1)

**Files:**
- Modify: `supabase/functions/_shared/ml/catalogo.ts:410-427` (tipo `ResultadoRodadaCatalogo` + `decidirResultadoRodadaCatalogo`)
- Test: `supabase/functions/_shared/ml/__tests__/catalogo.test.ts`

**Interfaces:**
- Produces: `ResultadoRodadaCatalogo` SEM o membro `{ acao: 'aguardar_elegibilidade' }` (união passa a ser só `reagendar` | `finalizar`). Assinatura de `decidirResultadoRodadaCatalogo(resumo, tentativaAtual)` inalterada. A Task 5 depende da união reduzida.

- [ ] **Step 1: Ajustar o teste existente que descreve o comportamento antigo e escrever os novos (falhando)**

Em `catalogo.test.ts`, substituir o teste da linha 77-80 (`'pendente>0 SEMPRE vence, mesmo com nao_elegivel misturado...'` — esperava `aguardar_elegibilidade`) e adicionar os novos dentro do `describe('decidirResultadoRodadaCatalogo', ...)`:

```ts
  it('pendente>0 reagenda pelo backoff longo (não é mais 500/retry curto do QStash)', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, pendente: 2 }, 1);
    expect(r).toEqual({ acao: 'reagendar', delaySegundos: CATALOGO_BACKOFF_SEGUNDOS[0], proximaTentativa: 2 });
  });

  it('pendente e nao_elegivel misturados compartilham o MESMO orçamento de tentativas', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, pendente: 2, nao_elegivel: 3 }, 3);
    expect(r).toEqual({ acao: 'reagendar', delaySegundos: CATALOGO_BACKOFF_SEGUNDOS[2], proximaTentativa: 4 });
  });

  it('pendente na ÚLTIMA tentativa finaliza (com alerta), em vez de esperar para sempre', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, pendente: 2 }, CATALOGO_MAX_TENTATIVAS);
    expect(r).toEqual({ acao: 'finalizar', deveAlertar: true });
  });
```

Nota: o terceiro teste só passa por completo após a Task 2 (`deveAlertar` para `pendente`). Nesta task, escrever com `deveAlertar: true` já — ele guia as duas tasks (RED aqui, GREEN na Task 2). Os dois primeiros devem passar ao fim DESTA task.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- catalogo.test`
Expected: FAIL — os 3 novos testes esperam `reagendar`/`finalizar` e recebem `{ acao: 'aguardar_elegibilidade' }`.

- [ ] **Step 3: Implementar**

Em `catalogo.ts`, substituir o tipo e a função (linhas 410-427):

```ts
export type ResultadoRodadaCatalogo =
  | { acao: 'reagendar'; delaySegundos: number; proximaTentativa: number }
  | { acao: 'finalizar'; deveAlertar: boolean };

/**
 * Decide uma única ação por rodada. `pendente` (elegibilidade ainda não computada) e
 * `nao_elegivel` (transitório do ML) compartilham o MESMO orçamento de tentativas do backoff
 * longo (1h/6h/24h/48h). Antes, `pendente` dependia só do retry curto do QStash (minutos) e
 * congelava para sempre ao esgotar — 93 famílias em produção (spec 2026-08-12). Na última
 * tentativa, finaliza e reporta o que sobrou como está (sem reetiquetar).
 */
export function decidirResultadoRodadaCatalogo(
  resumo: ResumoCatalogo,
  tentativaAtual: number,
): ResultadoRodadaCatalogo {
  tentativaAtual = normalizarTentativaCatalogo(tentativaAtual);
  if ((resumo.pendente > 0 || resumo.nao_elegivel > 0) && tentativaAtual < CATALOGO_MAX_TENTATIVAS) {
    const idx = tentativaAtual - 1;
    return { acao: 'reagendar', delaySegundos: CATALOGO_BACKOFF_SEGUNDOS[idx], proximaTentativa: tentativaAtual + 1 };
  }
  return { acao: 'finalizar', deveAlertar: deveAlertarCatalogoNoMatch(resumo) };
}
```

Efeito colateral aceito (intenção da spec): publicação nova cuja elegibilidade ainda não computou aos 10 min do primeiro job espera +1h (antes: retries do QStash em minutos). A maioria assenta antes da primeira rodada, então o impacto é raro e limitado.

- [ ] **Step 4: Rodar os testes**

Run: `pnpm test -- catalogo.test`
Expected: PASS, exceto o teste `'pendente na ÚLTIMA tentativa finaliza (com alerta)'` que ainda falha em `deveAlertar` (vira GREEN na Task 2). Todos os demais do arquivo passam.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/catalogo.ts supabase/functions/_shared/ml/__tests__/catalogo.test.ts
git commit -m "fix(catalogo): pendente reagenda pelo backoff longo em vez de 500/retry curto

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: alerta cobre `pendente` residual + motivo `elegibilidade_nao_resolvida` (correção 1.3)

**Files:**
- Modify: `supabase/functions/_shared/ml/catalogo.ts:383-397` (`deveAlertarCatalogoNoMatch`, `decidirMotivoAlertaCatalogo`)
- Modify: `supabase/functions/_shared/notificacoes/telegram.ts:35-62` (`CatalogoNoMatchAlerta.motivo`, `montarMensagemCatalogoNoMatch`)
- Test: `supabase/functions/_shared/ml/__tests__/catalogo-alerta.test.ts`

**Interfaces:**
- Consumes: `ResumoCatalogo` (inalterado).
- Produces: `decidirMotivoAlertaCatalogo` devolve `'elegibilidade_esgotada' | 'sem_variation_id' | 'elegibilidade_nao_resolvida' | undefined`; `CatalogoNoMatchAlerta.motivo` aceita o novo literal. O worker (Task 5) já repassa `decidirMotivoAlertaCatalogo(resumo)` direto — nenhuma mudança de chamada.

- [ ] **Step 1: Ajustar o teste antigo e escrever os novos (falhando)**

Em `catalogo-alerta.test.ts`, substituir o teste da linha 28-30 (`'NÃO alerta enquanto a elegibilidade ainda computa (pendente>0)...'` — esperava `false`) por:

```ts
  it('alerta com pendente residual (a garantia de "1 alerta por publicação" vive no gate de finalizar do worker, não aqui)', () => {
    expect(deveAlertarCatalogoNoMatch({ ...base, pendente: 2 })).toBe(true);
    expect(deveAlertarCatalogoNoMatch({ ...base, ficha_divergente: 1, pendente: 2 })).toBe(true);
  });
```

E adicionar (importando `decidirMotivoAlertaCatalogo` de `'../catalogo'`):

```ts
describe('decidirMotivoAlertaCatalogo — elegibilidade_nao_resolvida', () => {
  it('pendente sobrevivente até a última tentativa → elegibilidade_nao_resolvida', () => {
    expect(decidirMotivoAlertaCatalogo({ ...base, pendente: 2 })).toBe('elegibilidade_nao_resolvida');
  });

  it('ficha_divergente/sem_produto têm precedência (mensagem genérica de no-match)', () => {
    expect(decidirMotivoAlertaCatalogo({ ...base, pendente: 2, ficha_divergente: 1 })).toBeUndefined();
  });

  it('pendente misturado com nao_elegivel → elegibilidade_nao_resolvida (o caso mais incerto manda)', () => {
    expect(decidirMotivoAlertaCatalogo({ ...base, pendente: 1, nao_elegivel: 2 })).toBe('elegibilidade_nao_resolvida');
  });
});

it('mensagem do novo motivo cita a elegibilidade sem resposta', () => {
  const mensagem = montarMensagemCatalogoNoMatch({
    ml_item_id: 'MLB123', titulo: 'Produto', cores: ['Azul'], motivo: 'elegibilidade_nao_resolvida',
  });
  expect(mensagem).toContain('sem resposta de elegibilidade');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- catalogo-alerta`
Expected: FAIL — `deveAlertarCatalogoNoMatch` devolve `false` com pendente>0; `decidirMotivoAlertaCatalogo` não conhece o motivo novo; TS acusa o literal inexistente em `motivo`.

- [ ] **Step 3: Implementar**

Em `catalogo.ts` (substitui as funções das linhas 383-397; atualizar o docstring de `deveAlertarCatalogoNoMatch` — a frase sobre "esperar pendente === 0" sai; a garantia de alerta único passa a ser citada como "só avaliado quando a rodada finaliza, no worker"):

```ts
export function deveAlertarCatalogoNoMatch(resumo: ResumoCatalogo): boolean {
  return resumo.ficha_divergente > 0 || resumo.sem_produto > 0 ||
    resumo.nao_elegivel > 0 || resumo.sem_variation_id > 0 || resumo.pendente > 0;
}

export function decidirMotivoAlertaCatalogo(
  resumo: ResumoCatalogo,
): 'elegibilidade_esgotada' | 'sem_variation_id' | 'elegibilidade_nao_resolvida' | undefined {
  if (resumo.ficha_divergente > 0 || resumo.sem_produto > 0) return undefined;
  if (resumo.pendente > 0) return 'elegibilidade_nao_resolvida';
  if (resumo.sem_variation_id > 0 && resumo.nao_elegivel === 0) return 'sem_variation_id';
  if (resumo.nao_elegivel + resumo.sem_variation_id > 0) return 'elegibilidade_esgotada';
  return undefined;
}
```

Em `telegram.ts`, ampliar o tipo e a causa:

```ts
export interface CatalogoNoMatchAlerta {
  ml_item_id: string;
  titulo: string | null;
  cores: string[];
  motivo?: 'elegibilidade_esgotada' | 'sem_variation_id' | 'elegibilidade_nao_resolvida';
}
```

E na cadeia de `causa` dentro de `montarMensagemCatalogoNoMatch` (linhas 51-55), acrescentar o ramo:

```ts
  const causa = item.motivo === 'elegibilidade_esgotada'
    ? `${item.cores.length === 1 ? 'teve' : 'tiveram'} elegibilidade esgotada após múltiplas tentativas`
    : item.motivo === 'elegibilidade_nao_resolvida'
    ? `${item.cores.length === 1 ? 'ficou' : 'ficaram'} sem resposta de elegibilidade do Mercado Livre após todas as tentativas`
    : item.motivo === 'sem_variation_id'
    ? 'não tem identificador de variação no Mercado Livre'
    : 'não tem ficha equivalente';
```

- [ ] **Step 4: Rodar os testes**

Run: `pnpm test -- catalogo`
Expected: PASS — inclusive o teste pendurado da Task 1 (`finaliza (com alerta)`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/catalogo.ts supabase/functions/_shared/notificacoes/telegram.ts supabase/functions/_shared/ml/__tests__/catalogo-alerta.test.ts
git commit -m "feat(catalogo): alerta no-match cobre pendente residual com motivo elegibilidade_nao_resolvida

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: falha de leitura de elegibilidade nunca finaliza — Legacy (correção 1.2)

**Files:**
- Modify: `supabase/functions/_shared/ml/catalogo.ts:452-458` (`vincularVariacoesCatalogo`)
- Create: `supabase/functions/_shared/ml/__tests__/catalogo-elegibilidade-falha.test.ts`

**Interfaces:**
- Produces: `vincularVariacoesCatalogo` LANÇA quando o GET de elegibilidade lança (timeout/rede), em vez de devolver resumo zerado. O worker já trata: o catch externo de `vincular-catalogo/index.ts:126-131` devolve 500 → retry do QStash. Nenhum campo novo em `ResumoCatalogo`.

- [ ] **Step 1: Escrever o teste (falhando)**

Criar `catalogo-elegibilidade-falha.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { vincularVariacoesCatalogo, type VarCatalogoRow } from '../catalogo';

// Guard da spec 2026-08-12 (seção 1.2): "não perguntei" precisa ser distinguível de "perguntei e
// não havia dado". Falha de LEITURA da elegibilidade propaga (worker devolve 500 p/ retry);
// devolver resumo zerado finalizava a rodada em silêncio e consumia uma tentativa.
describe('vincularVariacoesCatalogo — falha de leitura da elegibilidade', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('GET de elegibilidade lança (timeout/rede) → propaga, sem resumo zerado e sem writes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      if (String(input).includes('/catalog_listing_eligibility')) throw new Error('timeout');
      return new Response('{}', { status: 200 });
    }));
    const writes: unknown[] = [];
    const admin = {
      from: () => ({
        update: (values: Record<string, unknown>) => ({
          eq: (_c: string, id: unknown) => { writes.push({ id, values }); return Promise.resolve({ error: null }); },
        }),
      }),
    };
    const vars: VarCatalogoRow[] = [{
      id: 'v1', codigo: '001', gtin: null, ml_variation_id: '123',
      catalog_product_id: null, catalog_listing_id: null,
    }];
    await expect(vincularVariacoesCatalogo('tok', admin as never, 'MLB-X', vars)).rejects.toThrow('timeout');
    expect(writes.length).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- catalogo-elegibilidade-falha`
Expected: FAIL — a promise resolve com resumo zerado (o catch atual engole a exceção).

- [ ] **Step 3: Implementar**

Em `vincularVariacoesCatalogo`, substituir o bloco try/catch das linhas 452-458 por leitura direta (a exceção propaga):

```ts
  // Falha de LEITURA da elegibilidade propaga (spec 2026-08-12 §1.2): "não perguntei" não pode
  // virar rodada finalizada — o resumo zerado cairia em `finalizar` sem alerta. O worker devolve
  // 500 e o QStash retenta.
  const elig = await buscarElegibilidadeCatalogo(token, itemId);
```

Atualizar o docstring da função: a frase "Erros por variação não lançam" continua válida; acrescentar que a falha do GET de elegibilidade (pré-loop) lança de propósito.

- [ ] **Step 4: Rodar os testes**

Run: `pnpm test -- catalogo`
Expected: PASS (o novo arquivo e todos os existentes — `catalogo-item-plano.test.ts` stubba a elegibilidade com resposta válida, não é afetado).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/catalogo.ts supabase/functions/_shared/ml/__tests__/catalogo-elegibilidade-falha.test.ts
git commit -m "fix(catalogo): falha de leitura da elegibilidade propaga em vez de finalizar rodada zerada

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: falha de leitura de elegibilidade no caminho UP → `pendente`, não `erro`

**Files:**
- Modify: `supabase/functions/_shared/ml/catalogo.ts:565` (`vincularItensCatalogoUP`, leitura da elegibilidade)
- Test: `supabase/functions/_shared/ml/__tests__/catalogo-up.test.ts`

**Interfaces:**
- Consumes: `buscarElegibilidadeItem(token, itemId)` (inalterada).
- Produces: no resumo UP, falha do GET de elegibilidade conta em `pendente` (retentável pelo backoff da Task 1) e NÃO persiste `catalog_status='erro'`.

Justificativa (achado 4 da análise): o UP herda 1.1/1.3 de graça via worker, mas o análogo do guard 1.2 não — hoje o catch por item persiste `erro` para uma falha transitória de rede, finalizando o item em silêncio. Mesma classe de bug que a spec corrige no Legacy.

- [ ] **Step 1: Escrever o teste (falhando)**

Em `catalogo-up.test.ts`, dentro do `describe('vincularItensCatalogoUP — ...')` (que já tem `fakeAdmin`/`filho`):

```ts
  it('falha de LEITURA da elegibilidade → pendente (retentável), NÃO persiste erro', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      if (String(input).includes('/catalog_listing_eligibility')) throw new Error('timeout');
      return new Response('{}', { status: 200 });
    }));
    const { admin, writes } = fakeAdmin();
    const resumo = await vincularItensCatalogoUP('tok', admin, [filho()]);
    expect(resumo.pendente).toBe(1);
    expect(resumo.erro).toBe(0);
    expect(writes.length).toBe(0); // "não perguntei" não é estado do item — nada a persistir
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- catalogo-up`
Expected: FAIL — hoje conta `erro: 1` e persiste `catalog_status='erro'`.

- [ ] **Step 3: Implementar**

Em `vincularItensCatalogoUP`, substituir a linha `const elig = await buscarElegibilidadeItem(token, f.item_externo_id);` por:

```ts
      // Falha de LEITURA não é estado do item (spec 2026-08-12 §1.2, análogo UP): conta como
      // pendente (retentável pelo backoff) sem persistir 'erro' — "não perguntei" ≠ recusa do ML.
      let elig: EligVar | undefined;
      try {
        elig = await buscarElegibilidadeItem(token, f.item_externo_id);
      } catch (e) {
        console.warn(`elegibilidade do item ${f.item_externo_id} falhou: ${(e as Error).message}`);
        resumo.pendente++;
        continue;
      }
```

- [ ] **Step 4: Rodar os testes**

Run: `pnpm test -- catalogo-up`
Expected: PASS (novo e existentes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/catalogo.ts supabase/functions/_shared/ml/__tests__/catalogo-up.test.ts
git commit -m "fix(catalogo): falha de leitura de elegibilidade no caminho UP conta como pendente, nao erro

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: worker `vincular-catalogo` — remover branch morto e incluir `pendente` nas cores do alerta

**Files:**
- Modify: `supabase/functions/vincular-catalogo/index.ts:17` (set `NO_MATCH`), `:74-76` (branch `aguardar_elegibilidade`), `:102-105` (filtro de cores Legacy)

**Interfaces:**
- Consumes: `ResultadoRodadaCatalogo` reduzido da Task 1 (`reagendar` | `finalizar`).
- Produces: nada novo — glue do worker.

Sem teste unitário próprio (o worker Deno.serve não tem harness no projeto; toda a lógica decidida vive nas puras já testadas). Verificação: lint + suíte completa.

- [ ] **Step 1: Remover o branch morto**

Deletar as linhas 74-76:

```ts
    if (resultado.acao === 'aguardar_elegibilidade') {
      return new Response(`elegibilidade ainda não computada (${resumo.pendente} pendentes)`, { status: 500, headers: corsHeaders });
    }
```

(Após a Task 1 esse membro não existe mais na união — o TypeScript/lint acusaria a comparação impossível.) Atualizar o comentário do topo do arquivo (linhas 32-34): trocar "enquanto a elegibilidade não estiver computada (variações `pendente`), devolve 500" por "variações `pendente` reagendam pelo mesmo backoff longo de `nao_elegivel` (1h/6h/24h/48h); 500 fica só para falha real (token/rede/leitura de elegibilidade)".

- [ ] **Step 2: Incluir `pendente` nos filtros de cores do alerta**

Linha 17 (UP):

```ts
const NO_MATCH = new Set(['ficha_divergente', 'sem_produto', 'nao_elegivel', 'pendente']);
```

Linhas 102-105 (Legacy):

```ts
      cores = [...new Set((varsEspelho ?? [])
        .filter((v) => v.catalog_status === 'ficha_divergente' || v.catalog_status === 'sem_produto' || v.catalog_status === 'nao_elegivel' || v.catalog_status === 'pendente')
        .map((v) => (v as { cor?: string | null }).cor)
        .filter((c): c is string => !!c))];
```

Sem isso, o alerta `elegibilidade_nao_resolvida` (família 100% `pendente`) sairia com lista de cores vazia.

- [ ] **Step 3: Verificar**

Run: `pnpm lint && pnpm test`
Expected: ambos PASS, zero referência restante a `aguardar_elegibilidade` no repo (`grep -rn aguardar_elegibilidade supabase/ src/` vazio).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/vincular-catalogo/index.ts
git commit -m "chore(vincular-catalogo): remove branch aguardar_elegibilidade e inclui pendente nas cores do alerta

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: agregação pura da tela — `src/lib/catalogo-risco.ts`

**Files:**
- Create: `src/lib/catalogo-risco.ts`
- Test: `src/lib/__tests__/catalogo-risco.test.ts`

**Interfaces:**
- Produces (Tasks 7 e 8 consomem exatamente estes nomes):

```ts
export const STATUS_RISCO = ['ficha_divergente', 'sem_produto', 'nao_elegivel', 'pendente'] as const;
export type StatusRisco = (typeof STATUS_RISCO)[number];
export interface FamiliaRiscoRow {
  id: string;
  ml_item_id: string | null;
  titulo_ml: string | null;
  nome_pai: string | null;
  variacoes: Array<{ catalog_status: string | null; ml_variation_id: string | null }>;
}
export interface AnuncioEmRisco {
  mlItemId: string;
  titulo: string;
  qtdSemFicha: number;
  motivoPredominante: StatusRisco;
  url: string; // https://www.mercadolivre.com.br/produzir/catalogo/<item>
}
export function agruparCatalogoRisco(rows: FamiliaRiscoRow[]): AnuncioEmRisco[];
export const ROTULO_RISCO: Record<StatusRisco, string>;
```

- [ ] **Step 1: Escrever os testes (falhando)**

Criar `src/lib/__tests__/catalogo-risco.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { agruparCatalogoRisco, ROTULO_RISCO, STATUS_RISCO, type FamiliaRiscoRow } from '../catalogo-risco';

const fam = (over: Partial<FamiliaRiscoRow> = {}): FamiliaRiscoRow => ({
  id: 'f1', ml_item_id: 'MLB100', titulo_ml: 'Fita Cetim N.3', nome_pai: 'FITA CETIM',
  variacoes: [], ...over,
});
const v = (catalog_status: string | null, ml_variation_id: string | null = '111') =>
  ({ catalog_status, ml_variation_id });

describe('agruparCatalogoRisco', () => {
  it('agrega os quatro status de risco e conta por anúncio', () => {
    const r = agruparCatalogoRisco([fam({
      variacoes: [v('ficha_divergente'), v('sem_produto'), v('nao_elegivel'), v('pendente'), v('vinculado')],
    })]);
    expect(r).toHaveLength(1);
    expect(r[0].qtdSemFicha).toBe(4);
    expect(r[0].url).toBe('https://www.mercadolivre.com.br/produzir/catalogo/MLB100');
  });

  it('REGRESSÃO: variação com ml_variation_id nulo (nunca publicada) não conta — família só com elas não aparece', () => {
    const r = agruparCatalogoRisco([fam({ variacoes: [v('pendente', null), v('pendente', null)] })]);
    expect(r).toHaveLength(0);
  });

  it('motivo predominante = status com mais variações; empate resolve pela ordem de STATUS_RISCO', () => {
    const r = agruparCatalogoRisco([fam({
      variacoes: [v('pendente'), v('pendente'), v('sem_produto')],
    })]);
    expect(r[0].motivoPredominante).toBe('pendente');
    const empate = agruparCatalogoRisco([fam({ variacoes: [v('sem_produto'), v('pendente')] })]);
    expect(empate[0].motivoPredominante).toBe('sem_produto'); // sem_produto vem antes na ordem
  });

  it('família sem ml_item_id ou sem variação em risco não aparece', () => {
    expect(agruparCatalogoRisco([fam({ ml_item_id: null, variacoes: [v('pendente')] })])).toHaveLength(0);
    expect(agruparCatalogoRisco([fam({ variacoes: [v('vinculado'), v('family_diff')] })])).toHaveLength(0);
  });

  it('famílias que compartilham ml_item_id (ciclos de UPDATE) somam num anúncio só', () => {
    const r = agruparCatalogoRisco([
      fam({ id: 'f1', variacoes: [v('pendente')] }),
      fam({ id: 'f2', titulo_ml: null, variacoes: [v('sem_produto')] }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].qtdSemFicha).toBe(2);
  });

  it('título cai para nome_pai e por fim para o ml_item_id', () => {
    const r = agruparCatalogoRisco([fam({ titulo_ml: null, variacoes: [v('pendente')] })]);
    expect(r[0].titulo).toBe('FITA CETIM');
  });

  it('rótulos pt-BR cobrem todos os status', () => {
    for (const s of STATUS_RISCO) expect(ROTULO_RISCO[s]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- catalogo-risco`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `src/lib/catalogo-risco.ts`:

```ts
// Tela "Catálogo em risco" (spec 2026-08-12). Só variações PUBLICADAS contam
// (ml_variation_id não nulo) — sem esse filtro, 2.234 falsos positivos (linhas
// nunca publicadas carregam o default 'pendente' da coluna).
export const STATUS_RISCO = ['ficha_divergente', 'sem_produto', 'nao_elegivel', 'pendente'] as const;
export type StatusRisco = (typeof STATUS_RISCO)[number];

export const ROTULO_RISCO: Record<StatusRisco, string> = {
  ficha_divergente: 'Ficha divergente',
  sem_produto: 'Sem ficha no catálogo',
  nao_elegivel: 'Não elegível',
  pendente: 'Elegibilidade não resolvida',
};

export interface FamiliaRiscoRow {
  id: string;
  ml_item_id: string | null;
  titulo_ml: string | null;
  nome_pai: string | null;
  variacoes: Array<{ catalog_status: string | null; ml_variation_id: string | null }>;
}

export interface AnuncioEmRisco {
  mlItemId: string;
  titulo: string;
  qtdSemFicha: number;
  motivoPredominante: StatusRisco;
  url: string;
}

const ehRisco = (s: string | null): s is StatusRisco => (STATUS_RISCO as readonly string[]).includes(s ?? '');

export function agruparCatalogoRisco(rows: FamiliaRiscoRow[]): AnuncioEmRisco[] {
  // Agrega por ml_item_id: várias famílias compartilham o mesmo anúncio após ciclos de UPDATE
  // (mesmo dedupe de fetchPublicados).
  const porItem = new Map<string, { titulo: string; contagem: Map<StatusRisco, number> }>();
  for (const f of rows) {
    if (!f.ml_item_id) continue;
    const emRisco = f.variacoes.filter((v) => v.ml_variation_id != null && ehRisco(v.catalog_status));
    if (emRisco.length === 0) continue;
    const atual = porItem.get(f.ml_item_id) ?? {
      titulo: f.titulo_ml ?? f.nome_pai ?? f.ml_item_id,
      contagem: new Map<StatusRisco, number>(),
    };
    if (atual.titulo === f.ml_item_id && (f.titulo_ml ?? f.nome_pai)) atual.titulo = f.titulo_ml ?? f.nome_pai!;
    for (const v of emRisco) {
      const s = v.catalog_status as StatusRisco;
      atual.contagem.set(s, (atual.contagem.get(s) ?? 0) + 1);
    }
    porItem.set(f.ml_item_id, atual);
  }
  return [...porItem.entries()].map(([mlItemId, { titulo, contagem }]) => {
    let motivoPredominante: StatusRisco = STATUS_RISCO[0];
    let max = -1;
    for (const s of STATUS_RISCO) {
      const n = contagem.get(s) ?? 0;
      if (n > max) { max = n; motivoPredominante = s; }
    }
    const qtdSemFicha = [...contagem.values()].reduce((a, b) => a + b, 0);
    return {
      mlItemId, titulo, qtdSemFicha, motivoPredominante,
      url: `https://www.mercadolivre.com.br/produzir/catalogo/${mlItemId}`,
    };
  });
}
```

- [ ] **Step 4: Rodar os testes**

Run: `pnpm test -- catalogo-risco`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalogo-risco.ts src/lib/__tests__/catalogo-risco.test.ts
git commit -m "feat(publicados): agregacao pura do card catalogo em risco

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: query PostgREST + hook

**Files:**
- Modify: `src/lib/queries.ts` (nova função ao lado de `fetchPublicados`, linha ~867; nova chave em `QK`)
- Create: `src/hooks/useCatalogoEmRisco.ts`

**Interfaces:**
- Consumes: `FamiliaRiscoRow`, `STATUS_RISCO` da Task 6.
- Produces: `fetchCatalogoEmRisco(): Promise<FamiliaRiscoRow[]>`; `QK.catalogoRisco`; hook `useCatalogoEmRisco()` devolvendo `useQuery<FamiliaRiscoRow[]>`.

Sem teste unitário próprio (funções de rede do projeto não são testadas — o padrão é lógica pura no lib, já coberta na Task 6). Verificação por lint + render na Task 8.

- [ ] **Step 1: Adicionar a query em `queries.ts`**

Na definição de `QK`, adicionar `catalogoRisco: ['catalogo-risco'] as const,` (seguir o formato das chaves vizinhas). Depois de `fetchPublicados`:

```ts
import { STATUS_RISCO, type FamiliaRiscoRow } from '@/lib/catalogo-risco';

/**
 * Famílias publicadas com variação PUBLICADA em status de risco de catálogo (spec 2026-08-12).
 * O `!inner` + filtros garantem no servidor a regra "ml_variation_id is not null" — sem ela a
 * tela mostraria 2.234 variações nunca publicadas (default 'pendente' da coluna).
 */
export async function fetchCatalogoEmRisco(): Promise<FamiliaRiscoRow[]> {
  const { data, error } = await supabase
    .from('familias')
    .select('id, ml_item_id, titulo_ml, nome_pai, variacoes!inner(catalog_status, ml_variation_id)')
    .not('ml_item_id', 'is', null)
    .not('variacoes.ml_variation_id', 'is', null)
    .in('variacoes.catalog_status', [...STATUS_RISCO]);
  if (error) throw error;
  return (data ?? []) as FamiliaRiscoRow[];
}
```

- [ ] **Step 2: Criar o hook**

`src/hooks/useCatalogoEmRisco.ts` (mesmo shape de `usePublicados.ts`):

```ts
import { useQuery } from '@tanstack/react-query';
import { QK, fetchCatalogoEmRisco } from '@/lib/queries';
import type { FamiliaRiscoRow } from '@/lib/catalogo-risco';

export function useCatalogoEmRisco() {
  return useQuery<FamiliaRiscoRow[]>({
    queryKey: QK.catalogoRisco,
    queryFn: fetchCatalogoEmRisco,
  });
}
```

- [ ] **Step 3: Verificar**

Run: `pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries.ts src/hooks/useCatalogoEmRisco.ts
git commit -m "feat(publicados): query e hook do catalogo em risco

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: card "Catálogo em risco" em Publicados

**Files:**
- Create: `src/components/catalogo-em-risco.tsx`
- Modify: `src/pages/Publicados.tsx` (render após o banner de moderados, linha ~682; imports no topo)
- Test: `src/components/__tests__/catalogo-em-risco.test.tsx`

**Interfaces:**
- Consumes: `AnuncioEmRisco`, `ROTULO_RISCO` (Task 6); `useCatalogoEmRisco` + `agruparCatalogoRisco` (na página).
- Produces: `<CatalogoEmRisco itens={AnuncioEmRisco[]} />` — componente de props puras (a página faz o fetch/agregação), o que o torna testável sem mock de rede.

- [ ] **Step 1: Escrever o teste de renderização (falhando)**

Criar `src/components/__tests__/catalogo-em-risco.test.tsx` (seguir o setup dos testes vizinhos, ex.: `status-badge.test.tsx`):

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CatalogoEmRisco } from '../catalogo-em-risco';
import type { AnuncioEmRisco } from '@/lib/catalogo-risco';

const item = (over: Partial<AnuncioEmRisco> = {}): AnuncioEmRisco => ({
  mlItemId: 'MLB100', titulo: 'Fita Cetim N.3', qtdSemFicha: 4,
  motivoPredominante: 'pendente', url: 'https://www.mercadolivre.com.br/produzir/catalogo/MLB100', ...over,
});

describe('CatalogoEmRisco', () => {
  it('lista título, contagem, motivo e link direto para o catálogo do ML', () => {
    render(<CatalogoEmRisco itens={[
      item(),
      item({ mlItemId: 'MLB200', titulo: 'Linha Xik', motivoPredominante: 'sem_produto', qtdSemFicha: 1 }),
      item({ mlItemId: 'MLB300', titulo: 'Fita Gorgurão', motivoPredominante: 'ficha_divergente' }),
      item({ mlItemId: 'MLB400', titulo: 'Barbante', motivoPredominante: 'nao_elegivel' }),
    ]} />);
    expect(screen.getByText(/4 anúncios com variações sem ficha/i)).toBeInTheDocument();
    expect(screen.getByText('Fita Cetim N.3')).toBeInTheDocument();
    expect(screen.getByText('Elegibilidade não resolvida')).toBeInTheDocument();
    expect(screen.getByText('Sem ficha no catálogo')).toBeInTheDocument();
    expect(screen.getByText('Ficha divergente')).toBeInTheDocument();
    expect(screen.getByText('Não elegível')).toBeInTheDocument();
    const link = screen.getAllByRole('link', { name: /resolver no ml/i })[0];
    expect(link).toHaveAttribute('href', 'https://www.mercadolivre.com.br/produzir/catalogo/MLB100');
  });

  it('sem itens, não renderiza nada', () => {
    const { container } = render(<CatalogoEmRisco itens={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- catalogo-em-risco`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implementar o componente**

Criar `src/components/catalogo-em-risco.tsx` — mesmo padrão visual do banner de moderados (`border-warning/30 bg-warning/10 text-warning`, `AlertTriangle`), expandindo em lista via `<details>` nativo:

```tsx
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { ROTULO_RISCO, type AnuncioEmRisco } from '@/lib/catalogo-risco';

/**
 * Card "Catálogo em risco" (spec 2026-08-12): anúncios com variações publicadas sem ficha de
 * catálogo — o ML pode pausar o anúncio inteiro. Mesmo padrão visual do banner de moderados.
 * O botão "Resolver todos no ML" é da Fase 3 (extensão) e fica de fora por ora — o link por
 * anúncio já resolve (mesma URL que o alerta de Telegram monta).
 */
export function CatalogoEmRisco({ itens }: { itens: AnuncioEmRisco[] }) {
  if (itens.length === 0) return null;
  return (
    <details className="mb-4 rounded-md border border-warning/30 bg-warning/10 text-sm text-warning motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-enter">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 hover:bg-warning/20">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          {itens.length === 1
            ? '1 anúncio com variações sem ficha de catálogo — o ML pode pausá-lo. Clique para ver.'
            : `${itens.length} anúncios com variações sem ficha de catálogo — o ML pode pausá-los. Clique para ver.`}
        </span>
      </summary>
      <ul className="divide-y divide-warning/20 border-t border-warning/20">
        {itens.map((i) => (
          <li key={i.mlItemId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
            <span className="font-medium text-foreground">{i.titulo}</span>
            <span>{i.qtdSemFicha === 1 ? '1 variação' : `${i.qtdSemFicha} variações`}</span>
            <span className="rounded bg-warning/20 px-1.5 py-0.5 text-xs">{ROTULO_RISCO[i.motivoPredominante]}</span>
            <a
              href={i.url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 underline underline-offset-2 hover:opacity-80"
            >
              Resolver no ML <ExternalLink className="h-3 w-3" />
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
```

- [ ] **Step 4: Integrar na página**

Em `Publicados.tsx`: importar `CatalogoEmRisco`, `useCatalogoEmRisco`, `agruparCatalogoRisco`; junto aos outros hooks do componente:

```tsx
  const { data: familiasRisco } = useCatalogoEmRisco();
  const itensRisco = useMemo(() => agruparCatalogoRisco(familiasRisco ?? []), [familiasRisco]);
```

E logo APÓS o bloco do banner de moderados (depois da linha ~682):

```tsx
      {/* Catálogo em risco (spec 2026-08-12): variações publicadas sem ficha — ML pode pausar */}
      <CatalogoEmRisco itens={itensRisco} />
```

O card é do canal Mercado Livre; como a fonte (`familias.ml_item_id`) é ML-only, não precisa de filtro por `canalAtivo` — em outros canais a lista vem do mesmo dado e continua correta. (Se Diego preferir escondê-lo fora da tab ML, é um `canalAtivo !== 'shopee'`-style guard de uma linha — decisão de UI, não de dado.)

- [ ] **Step 5: Rodar testes e lint**

Run: `pnpm test -- catalogo && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Validação visual (runtime real)**

Conforme memória de validação de UI: subir dev (`pnpm dev`, copiar `.env.local` para a worktree antes) e validar com a skill browser-use/playwright-cli em modo leitura, com screenshot real (não só snapshot de acessibilidade). Como a conta de validação pode estar em org sem dados, injetar a resposta do PostgREST via `playwright-cli route` + `reload` para ver o card populado com os quatro motivos.

- [ ] **Step 7: Commit**

```bash
git add src/components/catalogo-em-risco.tsx src/components/__tests__/catalogo-em-risco.test.tsx src/pages/Publicados.tsx
git commit -m "feat(publicados): card catalogo em risco com link direto para o ML

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: deploy das edge functions

**Files:** nenhum — operação de deploy.

Funções a deployar e por quê (regra do CLAUDE.md: mudança em `_shared/` → redeploy de todas as afetadas):

- `vincular-catalogo` — único importador de `_shared/ml/catalogo.ts` (verificado por grep) e importador de `telegram.ts`. **Obrigatória.**
- Importadores de `_shared/notificacoes/telegram.ts` (mudou na Task 2): `monitorar-moderados`, `sync-venda`, `sync-pergunta`, `sync-mensagem`, `sync-devolucao`, `notificar-liberacao`, `reconciliar-faturamento`.

- [ ] **Step 1: Linkar o projeto (worktree nova nunca vem linkada)**

Run: `supabase link --project-ref <ref do projeto>` (ref em `reference_ops`/`.env.local`).

- [ ] **Step 2: Deploy**

```bash
supabase functions deploy vincular-catalogo monitorar-moderados sync-venda sync-pergunta sync-mensagem sync-devolucao notificar-liberacao reconciliar-faturamento
```

- [ ] **Step 3: Conferir versão pós-deploy**

Run: `supabase functions list`
Expected: versão de cada função incrementada em relação ao valor pré-deploy (anotar antes).

Nota de ordem: o deploy acontece quando a branch for mergeada na main (fluxo do projeto: push/merge NÃO deploya funções — o deploy é etapa explícita). O backfill (Task 10) SÓ roda depois deste deploy, senão re-enfileirar as famílias reproduz o bug antigo (500 até o QStash desistir).

---

### Task 10: backfill das 93 famílias congeladas (correção 1.4 — operação de produção)

**Files:**
- Create: `scripts/backfill-catalogo-pendente.ts` (Deno — precisa ser Deno porque importa `_shared/queue.ts`, que usa `npm:@upstash/qstash` e `Deno.env`)

**Interfaces:**
- Consumes: `enfileirarVinculacaoCatalogo(familiaId, delaySeconds, tentativa, retries)` de `supabase/functions/_shared/queue.ts`.

**Cuidados de produção (ler antes de executar):**
- **Pré-requisito absoluto:** Task 9 concluída (worker corrigido em produção). Conferir versão via `supabase functions list`.
- O script NÃO escreve no ML nem no banco: só publica jobs QStash para o worker existente. Todo opt-in que resultar passa pelas travas do ADR-0021 (`fichaEquivalente`, `podeTentarOptin`) — é o fluxo sancionado, não edição manual de anúncio.
- **Efeito colateral esperado:** famílias que finalizarem com no-match disparam alerta de Telegram — potencialmente dezenas ao longo de horas/dias (1 por família, na finalização). A spec trata isso como "trabalho visível". Avisar Diego antes de executar.
- Dry-run é o default; a execução real exige `--executar`.
- Delays escalonados (60s + 30s por família ≈ janela de 47 min) — `enfileirarVinculacaoCatalogo` usa `publishJSON` (SEM fila serializada por usuário, apesar do que a spec diz), então o escalonamento é o que evita martelar a API do ML.

- [ ] **Step 1: Escrever o script**

```ts
// Backfill das famílias congeladas em catalog_status='pendente' (spec 2026-08-12 §1.4).
// Re-enfileira vincular-catalogo com tentativa=1 via QStash — NÃO toca ML nem banco.
//
// Uso (na raiz do repo, env de PRODUÇÃO):
//   SUPABASE_URL=https://<ref>.supabase.co QSTASH_TOKEN=... \
//     deno run --allow-net --allow-env --allow-read \
//     scripts/backfill-catalogo-pendente.ts familias.txt [--executar]
//
// familias.txt: um familia_id (uuid) por linha. Sem --executar: dry-run (só imprime).
// A saída da execução real (familia_id<TAB>messageId<TAB>delay) DEVE ser salva — os
// messageIds são o mecanismo de reversão (DELETE na API do QStash antes da entrega).
import { enfileirarVinculacaoCatalogo } from '../supabase/functions/_shared/queue.ts';

const [arquivo, flag] = Deno.args;
if (!arquivo) { console.error('uso: backfill-catalogo-pendente.ts <familias.txt> [--executar]'); Deno.exit(1); }
const ids = (await Deno.readTextFile(arquivo)).split('\n').map((s) => s.trim()).filter(Boolean);
console.error(`${ids.length} famílias no arquivo`);

if (flag !== '--executar') {
  for (const [i, id] of ids.entries()) console.log(`${id}\t(dry-run)\tdelay=${60 + i * 30}s`);
  console.error('dry-run — nada enfileirado. Rode com --executar para valer.');
  Deno.exit(0);
}

for (const [i, id] of ids.entries()) {
  const delay = 60 + i * 30; // escalona p/ não martelar a API do ML (publishJSON não serializa)
  const messageId = await enfileirarVinculacaoCatalogo(id, delay, 1, 5);
  console.log(`${id}\t${messageId}\tdelay=${delay}s`);
}
console.error('concluído — salve esta saída (messageIds = reversão).');
```

- [ ] **Step 2: Gerar a lista de famílias (SQL somente-leitura, Management API)**

```sql
select distinct v.familia_id
from variacoes v join familias f on f.id = v.familia_id
where v.catalog_status = 'pendente'
  and v.ml_variation_id is not null
  and f.ml_item_id is not null;
```

Salvar como `familias.txt` (fora do repo — dado de produção). Expected: **93 linhas** (conferido em 2026-08-13: 93 famílias / 296 variações). Divergência grande → parar e investigar antes de seguir.

- [ ] **Step 3: Dry-run**

Run: `deno run --allow-net --allow-env --allow-read scripts/backfill-catalogo-pendente.ts familias.txt`
Expected: 93 linhas de dry-run, nada enfileirado.

- [ ] **Step 4: Executar (com aprovação do Diego) e guardar a saída**

Run: `... backfill-catalogo-pendente.ts familias.txt --executar | tee backfill-$(date +%Y%m%d-%H%M).log`
Expected: 93 linhas com messageId.

- [ ] **Step 5: Como reverter**

Antes da entrega (janela = delay de cada mensagem), cancelar mensagens individuais:

```bash
curl -X DELETE "https://qstash.upstash.io/v2/messages/<messageId>" -H "Authorization: Bearer $QSTASH_TOKEN"
```

Após a entrega não há rollback — nem é necessário: o worker é idempotente e best-effort; o pior resultado é o `catalog_status` refletir a verdade atual do ML (que é o objetivo). Lembrete da memória de ops: QStash 200 não prova resultado — conferir pelo banco (Step 6).

- [ ] **Step 6: Conferir o resultado (algumas horas depois e no dia seguinte)**

SQL somente-leitura:

```sql
select v.catalog_status, count(*) as variacoes, count(distinct v.familia_id) as familias
from variacoes v join familias f on f.id = v.familia_id
where v.ml_variation_id is not null and f.ml_item_id is not null
group by 1 order by 2 desc;
```

Expected: `pendente` cai de 296/93 para perto de zero na primeira rodada (a evidência da spec — MLB6928315454 com 74/74 já respondidos — indica que a elegibilidade já está madura; ex.: os 74 devem virar `family_diff`). O que sobrar em `pendente` entra no backoff e resolve/alerta em até ~79h. Conferir também os logs do worker (`supabase functions logs vincular-catalogo`) e a tela da Task 8 (deve encolher).

- [ ] **Step 7: Commit do script**

```bash
git add scripts/backfill-catalogo-pendente.ts
git commit -m "chore(catalogo): script de backfill das familias congeladas em pendente

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: documentação e Graphify

**Files:**
- Modify: `docs/reference/edge-functions.md` — comportamento novo de `vincular-catalogo` (pendente → backoff longo; 500 só para falha real; alerta cobre `elegibilidade_nao_resolvida`).
- Modify: `docs/decisions/0021-vinculacao-automatica-ao-catalogo-ml.md` — nota de revisão (2026-08): revoga o trecho da revisão 2026-07-15 que dizia "`pendente` continua usando o retry técnico do QStash e tem precedência sobre o backoff de negócio"; `pendente` passa a compartilhar o backoff. Referenciar a spec.
- Modify: `docs/decisions/0036-alerta-catalogo-no-match.md` — nota de revisão: o gate `pendente === 0` sai de `deveAlertarCatalogoNoMatch`; a garantia de 1 alerta por publicação passa a ser o gate de finalização no worker; novo motivo `elegibilidade_nao_resolvida`.
- Modify: `docs/how-to/operacoes-rotineiras.md` — procedimento do backfill (gerar lista → dry-run → executar → conferir → reverter), apontando para o script.
- Modify: `docs/TASKS.md` — registrar a entrega.
- Modify: `obsidian-vault/06-Roadmap/Sprint Atual.md` — refletir o épico em andamento/concluído (impacto funcional: tela nova + worker).

- [ ] **Step 1: Editar os arquivos acima** (conteúdo conforme descrito em cada bullet — texto factual, sem placeholder; os números medidos estão na spec e no achado 8 deste plano).

- [ ] **Step 2: Atualizar o Graphify**

Conforme CLAUDE.md: atualizar o grafo canônico `graphify-out/` na raiz para os arquivos novos/alterados e encerrar com:

```bash
python3 scripts/graphify-podar-falsos.py --aplicar
```

e a reclusterização.

- [ ] **Step 3: Gate final**

Run: `pnpm lint && pnpm test`
Expected: PASS. Informar explicitamente: documentação atualizada.

- [ ] **Step 4: Commit**

```bash
git add docs/ obsidian-vault/ graphify-out/
git commit -m "docs(catalogo): revisoes ADR-0021/0036, edge-functions e procedimento de backfill

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Ordem de execução e gates

1. Tasks 1-5 (backend) — sequenciais (5 depende do tipo reduzido de 1).
2. Tasks 6-8 (tela) — sequenciais entre si; podem correr em paralelo com 1-5 (arquivos disjuntos), exceto que o gate final exige tudo verde.
3. Task 11 (docs) — após 1-8.
4. Merge na main (CI verde: `frontend`, `backend-lint`) → **Task 9 (deploy)** → **Task 10 (backfill, com aprovação explícita do Diego)**.

O backfill NUNCA antes do deploy. O deploy NUNCA dado por concluído sem conferir a versão (`supabase functions list`).
