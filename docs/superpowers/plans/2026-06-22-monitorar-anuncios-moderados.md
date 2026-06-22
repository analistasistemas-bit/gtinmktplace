# Monitoramento de anúncios moderados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avisar proativamente (banner no app + Telegram) quando o ML modera um anúncio, e tornar o motivo legível na tela Publicados.

**Architecture:** Edge function `monitorar-moderados` disparada por QStash Schedule (6h) relê o status dos itens via `lerStatus`/`parseStatusML` (mesma lógica da tela), faz diff contra a tabela `ml_moderacao` e alerta os novos no Telegram. O front conta os moderados do fetch ao vivo já existente e traduz o código do motivo.

**Tech Stack:** Supabase Edge Functions (Deno), Postgres + RLS, QStash (`@upstash/qstash`), React + TypeScript + Vite, vitest.

## Global Constraints

- RLS por `user_id` obrigatória em tabela de domínio (regra do projeto).
- Edge Functions idempotentes; workers QStash validam assinatura (`verificarAssinatura`) e rodam com `verify_jwt = false` no deploy.
- Tokens/segredos nunca em código — só via `Deno.env.get` / secrets do Supabase.
- Reusar `parseStatusML` / `lerStatus`; não duplicar lógica de status.
- Testes front em `tests/**` (alias `@/`); testes de `_shared` em `supabase/functions/**/__tests__/**`. Rodar com `pnpm test`.
- Status que conta como moderado = o que `parseStatusML` devolve como `status === 'moderado'`.

---

### Task 1: Tradução do motivo (front) — função pura + uso na lista

**Files:**
- Create: `src/lib/moderacao.ts`
- Test: `tests/lib/moderacao.test.ts`
- Modify: `src/pages/Publicados.tsx` (BadgeStatus, ~linha 78-80)

**Interfaces:**
- Produces: `traduzirMotivoModeracao(motivo: string | null): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/moderacao.test.ts
import { describe, it, expect } from 'vitest';
import { traduzirMotivoModeracao } from '@/lib/moderacao';

describe('traduzirMotivoModeracao', () => {
  it('traduz códigos conhecidos', () => {
    expect(traduzirMotivoModeracao('forbidden')).toBe('Proibido pelo ML');
    expect(traduzirMotivoModeracao('waiting_for_patch')).toBe('Aguardando correção');
    expect(traduzirMotivoModeracao('poor_quality_thumbnail')).toBe('Foto reprovada');
  });
  it('junta múltiplos sub_status', () => {
    expect(traduzirMotivoModeracao('forbidden, waiting_for_patch')).toBe('Proibido pelo ML · Aguardando correção');
  });
  it('código desconhecido cai no cru; null vira null', () => {
    expect(traduzirMotivoModeracao('outro_codigo')).toBe('outro_codigo');
    expect(traduzirMotivoModeracao(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- moderacao`
Expected: FAIL — `Cannot find module '@/lib/moderacao'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/moderacao.ts
const MOTIVO_LABEL: Record<string, string> = {
  forbidden: 'Proibido pelo ML',
  waiting_for_patch: 'Aguardando correção',
  poor_quality_thumbnail: 'Foto reprovada',
  poor_quality_picture: 'Foto reprovada',
};

/** Traduz o(s) sub_status cru(s) do ML em texto legível. Vários vêm separados por vírgula. */
export function traduzirMotivoModeracao(motivo: string | null): string | null {
  if (!motivo) return null;
  return motivo
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((c) => MOTIVO_LABEL[c] ?? c)
    .join(' · ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- moderacao`
Expected: PASS (3 testes).

- [ ] **Step 5: Usar na lista (Publicados.tsx)**

Adicionar o import no topo do arquivo (junto aos outros `@/lib`):

```ts
import { traduzirMotivoModeracao } from '@/lib/moderacao';
```

Trocar o render do motivo dentro de `BadgeStatus` (hoje em ~linha 78-80):

```tsx
      {status === 'moderado' && motivo && (
        <span className="text-xs text-warning">{traduzirMotivoModeracao(motivo)}</span>
      )}
```

- [ ] **Step 6: Verificar build/typecheck**

Run: `pnpm build`
Expected: build sem erros de tipo.

- [ ] **Step 7: Commit**

```bash
git add src/lib/moderacao.ts tests/lib/moderacao.test.ts src/pages/Publicados.tsx
git commit -m "feat(publicados): traduz motivo de moderação do ML na lista"
```

---

### Task 2: Banner "N anúncios moderados" na tela Publicados

**Files:**
- Modify: `src/pages/Publicados.tsx` (após `<PageHeader ...>`, dentro do `return`, ~linha 369)

**Interfaces:**
- Consumes: `merged` (já existe, ~linha 306) — `PublicadoItem[]` com `status`.

- [ ] **Step 1: Calcular a contagem (memo) logo após `merged`**

Adicionar depois do bloco `const merged = useMemo(... )` (após ~linha 320):

```ts
  const totalModerados = useMemo(
    () => merged.filter((i) => i.status === 'moderado').length,
    [merged],
  );
```

- [ ] **Step 2: Renderizar o banner**

Garantir o import do ícone no topo (o arquivo já importa de `lucide-react`; adicionar `AlertTriangle` à lista):

```ts
import { AlertTriangle } from 'lucide-react';
```

Inserir o banner dentro do `return`, logo após o `<PageHeader ... />` (antes dos filtros):

```tsx
      {totalModerados > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {totalModerados === 1
              ? '1 anúncio moderado pelo Mercado Livre — verifique abaixo.'
              : `${totalModerados} anúncios moderados pelo Mercado Livre — verifique abaixo.`}
          </span>
        </div>
      )}
```

- [ ] **Step 3: Verificar build**

Run: `pnpm build`
Expected: build sem erros. (Se `border-warning/40`/`bg-warning/10` não existirem no tema, usar a cor de warning já usada no projeto — conferir `tailwind.config`/`StatusPill` tone `warning`.)

- [ ] **Step 4: Conferência visual rápida**

Run: `pnpm dev` e abrir Publicados (com a conta que tem moderados). Esperado: banner amarelo no topo com a contagem; some quando não há moderados.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Publicados.tsx
git commit -m "feat(publicados): banner com contagem de anúncios moderados"
```

---

### Task 3: Migration — tabela `ml_moderacao`

**Files:**
- Create: `supabase/migrations/20260622120000_ml_moderacao.sql`

**Interfaces:**
- Produces: tabela `public.ml_moderacao` com colunas abaixo; registro "aberto" = `resolvido_em is null`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Estado de moderação dos anúncios no ML, para diff e dedup do alerta (ADR-0035).
-- 1 linha "aberta" (resolvido_em null) por (user_id, ml_item_id) em estado moderado.
create table public.ml_moderacao (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  ml_item_id    text not null,
  status        text not null,
  motivo        text,
  detectado_em  timestamptz not null default now(),
  alertado_em   timestamptz,
  resolvido_em  timestamptz,
  atualizado_em timestamptz not null default now()
);

-- No máximo 1 registro aberto por item/usuário (evita alerta duplicado).
create unique index ml_moderacao_aberto_uniq
  on public.ml_moderacao (user_id, ml_item_id)
  where resolvido_em is null;

create index ml_moderacao_user_idx on public.ml_moderacao (user_id);

alter table public.ml_moderacao enable row level security;

-- Operador vê os próprios registros; escrita é só do worker (service role, ignora RLS).
create policy "ml_moderacao: select own" on public.ml_moderacao
  for select using ((select auth.uid()) = user_id);
```

- [ ] **Step 2: Aplicar a migration**

Aplicar via MCP `apply_migration` (name: `ml_moderacao`) no projeto `txvncrgkoynoxwopfkbp`, ou `supabase db push` se a CLI estiver disponível.
Expected: tabela criada, sem erro.

- [ ] **Step 3: Verificar**

Rodar via MCP `execute_sql`: `select count(*) from public.ml_moderacao;`
Expected: `0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260622120000_ml_moderacao.sql
git commit -m "feat(db): tabela ml_moderacao para monitoramento de moderação"
```

---

### Task 4: Função pura `diffModerados` (`_shared`)

**Files:**
- Create: `supabase/functions/_shared/moderacao/diff.ts`
- Test: `supabase/functions/_shared/moderacao/__tests__/diff.test.ts`

**Interfaces:**
- Produces:
  - `interface ModeradoCorrente { ml_item_id: string; status: string; motivo: string | null; }`
  - `interface RegistroAberto { ml_item_id: string; }`
  - `interface DiffModeracao { novos: ModeradoCorrente[]; resolvidos: string[]; }`
  - `diffModerados(correntes: ModeradoCorrente[], abertos: RegistroAberto[]): DiffModeracao`

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/_shared/moderacao/__tests__/diff.test.ts
import { describe, it, expect } from 'vitest';
import { diffModerados } from '../diff';

describe('diffModerados', () => {
  it('item moderado sem registro aberto → novo', () => {
    const r = diffModerados(
      [{ ml_item_id: 'MLB1', status: 'moderado', motivo: 'forbidden' }],
      [],
    );
    expect(r.novos.map((n) => n.ml_item_id)).toEqual(['MLB1']);
    expect(r.resolvidos).toEqual([]);
  });
  it('registro aberto que não está mais moderado → resolvido', () => {
    const r = diffModerados([], [{ ml_item_id: 'MLB1' }]);
    expect(r.resolvidos).toEqual(['MLB1']);
    expect(r.novos).toEqual([]);
  });
  it('item moderado que já tem registro aberto → nada', () => {
    const r = diffModerados(
      [{ ml_item_id: 'MLB1', status: 'moderado', motivo: 'forbidden' }],
      [{ ml_item_id: 'MLB1' }],
    );
    expect(r.novos).toEqual([]);
    expect(r.resolvidos).toEqual([]);
  });
  it('mix: um novo, um resolvido, um inalterado', () => {
    const r = diffModerados(
      [
        { ml_item_id: 'NOVO', status: 'moderado', motivo: 'forbidden' },
        { ml_item_id: 'IGUAL', status: 'moderado', motivo: 'forbidden' },
      ],
      [{ ml_item_id: 'IGUAL' }, { ml_item_id: 'SAIU' }],
    );
    expect(r.novos.map((n) => n.ml_item_id)).toEqual(['NOVO']);
    expect(r.resolvidos).toEqual(['SAIU']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- diff`
Expected: FAIL — `Cannot find module '../diff'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// supabase/functions/_shared/moderacao/diff.ts
export interface ModeradoCorrente {
  ml_item_id: string;
  status: string;
  motivo: string | null;
}
export interface RegistroAberto {
  ml_item_id: string;
}
export interface DiffModeracao {
  novos: ModeradoCorrente[];
  resolvidos: string[];
}

/** Compara os moderados de agora com os registros abertos (resolvido_em null). */
export function diffModerados(
  correntes: ModeradoCorrente[],
  abertos: RegistroAberto[],
): DiffModeracao {
  const abertosSet = new Set(abertos.map((a) => a.ml_item_id));
  const correntesSet = new Set(correntes.map((c) => c.ml_item_id));
  const novos = correntes.filter((c) => !abertosSet.has(c.ml_item_id));
  const resolvidos = abertos
    .map((a) => a.ml_item_id)
    .filter((id) => !correntesSet.has(id));
  return { novos, resolvidos };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- diff`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/moderacao/diff.ts supabase/functions/_shared/moderacao/__tests__/diff.test.ts
git commit -m "feat(moderacao): função pura diffModerados (novos/resolvidos)"
```

---

### Task 5: Helper Telegram (`_shared/notificacoes/telegram.ts`)

**Files:**
- Create: `supabase/functions/_shared/notificacoes/telegram.ts`
- Test: `supabase/functions/_shared/notificacoes/__tests__/telegram.test.ts`

**Interfaces:**
- Produces:
  - `interface ItemAlerta { ml_item_id: string; titulo: string | null; motivo: string | null; permalink: string | null; }`
  - `montarMensagemModerados(itens: ItemAlerta[]): string`
  - `enviarTelegram(texto: string): Promise<boolean>` — `false` (no-op) se faltar secret.

- [ ] **Step 1: Write the failing test (só a função pura de mensagem)**

```ts
// supabase/functions/_shared/notificacoes/__tests__/telegram.test.ts
import { describe, it, expect } from 'vitest';
import { montarMensagemModerados } from '../telegram';

describe('montarMensagemModerados', () => {
  it('monta a mensagem com título, motivo traduzido e link', () => {
    const msg = montarMensagemModerados([
      { ml_item_id: 'MLB1', titulo: 'Alfinete N.04', motivo: 'forbidden', permalink: 'https://x/MLB1' },
    ]);
    expect(msg).toContain('1 anúncio moderado');
    expect(msg).toContain('Alfinete N.04');
    expect(msg).toContain('Proibido pelo ML');
    expect(msg).toContain('https://x/MLB1');
  });
  it('plural na contagem', () => {
    const msg = montarMensagemModerados([
      { ml_item_id: 'A', titulo: null, motivo: 'forbidden', permalink: null },
      { ml_item_id: 'B', titulo: null, motivo: 'waiting_for_patch', permalink: null },
    ]);
    expect(msg).toContain('2 anúncios moderados');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- telegram`
Expected: FAIL — `Cannot find module '../telegram'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// supabase/functions/_shared/notificacoes/telegram.ts
export interface ItemAlerta {
  ml_item_id: string;
  titulo: string | null;
  motivo: string | null;
  permalink: string | null;
}

// Mapa local (Deno não compartilha módulo com o front); manter em sincronia com src/lib/moderacao.ts.
const MOTIVO_LABEL: Record<string, string> = {
  forbidden: 'Proibido pelo ML',
  waiting_for_patch: 'Aguardando correção',
  poor_quality_thumbnail: 'Foto reprovada',
  poor_quality_picture: 'Foto reprovada',
};

function traduzir(motivo: string | null): string {
  if (!motivo) return 'moderado';
  return motivo.split(',').map((s) => s.trim()).filter(Boolean)
    .map((c) => MOTIVO_LABEL[c] ?? c).join(' · ');
}

export function montarMensagemModerados(itens: ItemAlerta[]): string {
  const cabecalho = itens.length === 1
    ? '🚫 1 anúncio moderado pelo Mercado Livre:'
    : `🚫 ${itens.length} anúncios moderados pelo Mercado Livre:`;
  const linhas = itens.map((i) => {
    const nome = i.titulo ?? i.ml_item_id;
    const link = i.permalink ? ` — ${i.permalink}` : '';
    return `• ${nome} (${traduzir(i.motivo)})${link}`;
  });
  return [cabecalho, ...linhas].join('\n');
}

/** Envia via Bot API. Sem TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID → no-op (retorna false). */
export async function enviarTelegram(texto: string): Promise<boolean> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!token || !chatId) {
    console.warn('Telegram não configurado (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID); pulando alerta.');
    return false;
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: texto, disable_web_page_preview: true }),
    });
    if (!resp.ok) {
      console.warn(`Telegram sendMessage ${resp.status}: ${await resp.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('Telegram falhou:', (e as Error).message);
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- telegram`
Expected: PASS (2 testes). `enviarTelegram` não é exercido em teste (faz rede); coberto na verificação manual da Task 7.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/notificacoes/
git commit -m "feat(notificacoes): helper Telegram + mensagem de moderados"
```

---

### Task 6: Edge function `monitorar-moderados`

**Files:**
- Create: `supabase/functions/monitorar-moderados/index.ts`

**Interfaces:**
- Consumes: `verificarAssinatura` (`_shared/queue.ts`), `adminClient` (`_shared/supabase.ts`), `getValidAccessToken` (`_shared/ml/token.ts`), `getConnector` (`_shared/canais/registry.ts`), `diffModerados` (Task 4), `montarMensagemModerados`/`enviarTelegram` (Task 5).

- [ ] **Step 1: Escrever a função**

```ts
// supabase/functions/monitorar-moderados/index.ts
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import { diffModerados, type ModeradoCorrente } from '../_shared/moderacao/diff.ts';
import { enviarTelegram, montarMensagemModerados, type ItemAlerta } from '../_shared/notificacoes/telegram.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  const admin = adminClient();
  const conn = getConnector('mercado_livre');

  const { data: contas } = await admin.from('ml_credentials').select('user_id');
  let totalNovos = 0;

  for (const conta of contas ?? []) {
    const userId = conta.user_id as string;

    // Itens publicados desse usuário (ml_item_id + dados p/ a mensagem).
    const { data: familias } = await admin.from('familias')
      .select('ml_item_id, nome_pai, ml_permalink')
      .eq('user_id', userId).not('ml_item_id', 'is', null);
    const porItem = new Map<string, { nome: string | null; permalink: string | null }>();
    for (const f of familias ?? []) {
      porItem.set(f.ml_item_id as string, { nome: f.nome_pai as string | null, permalink: f.ml_permalink as string | null });
    }
    const ids = [...porItem.keys()];
    if (ids.length === 0) continue;

    // Status ao vivo (mesma leitura da tela). Falha de credencial → pula o usuário.
    let statusPorId;
    try {
      statusPorId = await conn.lerStatus({ getToken: () => getValidAccessToken(userId) }, ids);
    } catch {
      console.warn(`monitorar-moderados: sem credencial ML p/ ${userId}, pulando`);
      continue;
    }

    const correntes: ModeradoCorrente[] = ids
      .filter((id) => statusPorId[id]?.status === 'moderado')
      .map((id) => ({ ml_item_id: id, status: 'moderado', motivo: statusPorId[id]?.motivo ?? null }));

    const { data: abertos } = await admin.from('ml_moderacao')
      .select('ml_item_id').eq('user_id', userId).is('resolvido_em', null);

    const { novos, resolvidos } = diffModerados(correntes, (abertos ?? []) as { ml_item_id: string }[]);

    // Marca recuperados.
    if (resolvidos.length > 0) {
      await admin.from('ml_moderacao')
        .update({ resolvido_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
        .eq('user_id', userId).is('resolvido_em', null).in('ml_item_id', resolvidos);
    }

    // Insere novos (registro aberto).
    if (novos.length > 0) {
      await admin.from('ml_moderacao').insert(
        novos.map((n) => ({ user_id: userId, ml_item_id: n.ml_item_id, status: n.status, motivo: n.motivo })),
      );

      // Alerta agrupado no Telegram; só marca alertado_em se enviou.
      const itensAlerta: ItemAlerta[] = novos.map((n) => ({
        ml_item_id: n.ml_item_id,
        titulo: porItem.get(n.ml_item_id)?.nome ?? null,
        motivo: n.motivo,
        permalink: porItem.get(n.ml_item_id)?.permalink ?? null,
      }));
      const enviou = await enviarTelegram(montarMensagemModerados(itensAlerta));
      if (enviou) {
        await admin.from('ml_moderacao')
          .update({ alertado_em: new Date().toISOString() })
          .eq('user_id', userId).is('resolvido_em', null)
          .in('ml_item_id', novos.map((n) => n.ml_item_id));
      }
      totalNovos += novos.length;
    }
  }

  return new Response(JSON.stringify({ ok: true, novos: totalNovos }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 2: Typecheck local da função (Deno)**

Run: `deno check supabase/functions/monitorar-moderados/index.ts` (se o Deno estiver disponível; senão, validar no deploy).
Expected: sem erros de tipo. (Confirmar que `StatusCanal` tem o campo `motivo` — vem de `parseStatusML`.)

- [ ] **Step 3: Rodar a suíte completa**

Run: `pnpm test`
Expected: todos verdes (inclui Tasks 1, 4, 5).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/monitorar-moderados/index.ts
git commit -m "feat(edge): monitorar-moderados — diff + alerta Telegram"
```

---

### Task 7: Deploy, secrets e agendamento QStash

**Files:**
- Create: `docs/runbooks/monitorar-moderados.md` (passo-a-passo de setup/operação)

> Esta task é de operação: deploy + segredos + criar o schedule. Diego valida local antes; o deploy/secret só roda sob comando dele (regra de entrega solo). Documentar tudo no runbook.

- [ ] **Step 1: Escrever o runbook** com:
  - Criar bot no @BotFather → obter `TELEGRAM_BOT_TOKEN`; obter `TELEGRAM_CHAT_ID` (via `https://api.telegram.org/bot<token>/getUpdates` após mandar msg ao bot).
  - Setar secrets no Supabase: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (CLI `supabase secrets set` ou painel).
  - Deploy: `supabase functions deploy monitorar-moderados --no-verify-jwt` (verify_jwt=false; assinatura QStash valida).
  - Criar o QStash Schedule (cron `0 */6 * * *`) apontando p/ `https://<ref>.supabase.co/functions/v1/monitorar-moderados`, com header de assinatura (publish do QStash já assina). Usar o painel do QStash ou MCP `qstash_schedules_manage`.

- [ ] **Step 2: Deploy da função** (sob comando do Diego)

Run: `supabase functions deploy monitorar-moderados --no-verify-jwt`
Expected: deploy ok; conferir versão.

- [ ] **Step 3: Configurar secrets do Telegram** (sob comando do Diego)

Run: `supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...`

- [ ] **Step 4: Teste real ponta-a-ponta**

Disparar o schedule manualmente (ou um publish QStash único) e confirmar:
- Resposta `{ ok: true, novos: N }`.
- Telegram recebeu a mensagem dos moderados atuais (hoje há ~3 alfinetes + 2 outros).
- `select * from ml_moderacao` mostra as linhas abertas com `alertado_em` preenchido.
- Rodar de novo: `novos` = 0 (dedup funcionando).

- [ ] **Step 5: Criar o schedule definitivo (6h)** e commitar o runbook

```bash
git add docs/runbooks/monitorar-moderados.md
git commit -m "docs: runbook do monitoramento de anúncios moderados"
```

---

## Notas de verificação final

- **Cobertura do spec:** tradução (T1), banner (T2), persistência (T3), diff (T4), Telegram (T5), worker (T6), agendamento+deploy (T7). ✓
- **Idempotência:** índice único parcial + `diffModerados` garantem que rodar de novo não duplica alerta nem linha.
- **Sem falso alerta:** bloco que falha em `lerStatus` vira `indisponivel` (não `moderado`).
- **Regra de entrega:** parar após T6 (código pronto, testes verdes) e deixar Diego validar local; T7 (deploy/secrets/schedule) só sob comando dele.
