# Plan 005: Classificar retry do `process-familia` por status, não por regex no texto do erro

> **Executor instructions**: Follow step by step. Run every verification command and
> confirm the expected result before moving on. If anything in "STOP conditions"
> occurs, stop and report — do not improvise. When done, update the status row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 7222675..HEAD -- supabase/functions/process-familia/index.ts supabase/functions/_shared/publicacao/retry.ts`
> Se algum desses arquivos mudou desde `7222675`, compare os excerpts de "Current state"
> com o código atual antes de prosseguir; divergência = STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `7222675`, 2026-06-26

## Why this matters

O worker `process-familia` decide se o QStash deve retentar um job inspecionando o **texto** da
mensagem de erro com a regex `/4\d\d/`. Isso classifica errado o erro mais transitório de todos:
um `429` (rate limit do OpenRouter/ML) casa `/4\d\d/` → `retry = false` → a família trava em
`status='erro'` e precisa de reprocesso manual, justamente quando bastava retentar. Mensagens como
`timeout after 4000ms` também casam por acidente. O worker irmão `publish-familia-ml` já faz o
certo: decide por `err.status >= 500` (sinal estruturado), não pelo texto.

## Current state

`supabase/functions/process-familia/index.ts:268-280` (o `catch` do handler):

```ts
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from('familias').update({
      status: 'erro',
      erro_mensagem: msg,
    }).eq('id', job.familia_id);
    // 5xx → QStash retenta. 4xx (já consumido com erro persistido) → 200.
    const retry = !/4\d\d/.test(msg);
    return new Response(`Erro: ${msg}`, {
      status: retry ? 500 : 200,
      headers: corsHeaders,
    });
  }
```

Padrão correto já usado em `supabase/functions/publish-familia-ml/index.ts:281-295`:

```ts
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;
    const retentavelFoto = (err as { retentavel?: boolean }).retentavel === true;
    ...
    if (status && status >= 500) {
      return new Response(msg, { status: 500, headers: corsHeaders });
    }
```

- Os erros do ML já carregam `.status` e `.retentavel` (anexados em `_shared/ml/criar-item.ts` /
  `_shared/ml/erro-ml.ts`). Erros locais (persistência, validação) podem **não** ter `.status`.
- **Comportamento atual para erro sem dígitos "4xx" na mensagem**: `retry = true`. Portanto o
  default histórico já é "retentar quando não dá pra classificar". A correção deve **preservar**
  esse default (retry no desconhecido) e só corrigir os casos hoje mal classificados (429, "4xx"
  no texto que é na verdade transitório, e 4xx real que carrega `.status`).
- Já existe um módulo de retry testável: `supabase/functions/_shared/publicacao/retry.ts` (com teste
  em `supabase/functions/_shared/publicacao/__tests__/retry.test.ts`) — é onde a decisão pura entra.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Test (un só arquivo) | `pnpm vitest run supabase/functions/_shared/publicacao/__tests__/retry.test.ts` | todos passam, incl. os novos |
| Test (suíte completa) | `pnpm test` | todos passam |
| Typecheck FE | `pnpm exec tsc -b` | exit 0 (não cobre Deno, mas garante que nada do FE quebrou) |

## Scope

**In scope**:
- `supabase/functions/_shared/publicacao/retry.ts` (adicionar função pura `decidirRetryPorErro`)
- `supabase/functions/_shared/publicacao/__tests__/retry.test.ts` (adicionar casos)
- `supabase/functions/process-familia/index.ts` (usar a função no `catch`)

**Out of scope**:
- `publish-familia-ml/index.ts` — já faz certo; NÃO mexer.
- Não alterar a lógica de persistência de `status='erro'` nem o `erro_mensagem`.

## Git workflow

- Worktree já isolado. Commit estilo conventional, ex.:
  `fix(process-familia): decide retry por status do erro, não por regex no texto (#005)`
- NÃO push/PR sem o operador pedir.

## Steps

### Step 1: Adicionar a decisão pura em `_shared/publicacao/retry.ts`

Leia o arquivo para casar o estilo, e adicione uma função pura exportada:

```ts
/** Decide se um erro do worker deve ser retentado pelo QStash.
 *  Transitórios (5xx, 429, marcados `retentavel`) → retenta.
 *  Default conservador: status desconhecido → retenta (não estrandar a família).
 *  4xx conhecido (carrega `.status` 400–499, exceto 429) → não retenta. */
export function decidirRetryPorErro(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  const retentavel = (err as { retentavel?: boolean } | null)?.retentavel === true;
  if (retentavel) return true;
  if (status === undefined) return true;
  if (status >= 500 || status === 429) return true;
  return false;
}
```

**Verify**: `pnpm exec tsc -b` → exit 0 (sanidade do FE; o arquivo é Deno, mas a sintaxe TS é a mesma).

### Step 2: Cobrir com teste

Em `_shared/publicacao/__tests__/retry.test.ts`, seguindo o estilo do arquivo, adicione casos para
`decidirRetryPorErro`: (a) erro com `status:429` → `true`; (b) `status:503` → `true`;
(c) `status:400` → `false`; (d) erro sem `.status` (ex.: `new Error('Persist final: ...')`) → `true`;
(e) erro com `retentavel:true` e `status:400` → `true`; (f) `Error('429 Too Many Requests')` sem
`.status` (mensagem com "429") → `true` (o ponto do bug: texto não decide mais).

**Verify**: `pnpm vitest run supabase/functions/_shared/publicacao/__tests__/retry.test.ts` → todos passam.

### Step 3: Usar a função no `catch` do `process-familia`

Substitua `const retry = !/4\d\d/.test(msg);` por `const retry = decidirRetryPorErro(err);` e
importe `decidirRetryPorErro` de `../_shared/publicacao/retry.ts` (confira o caminho relativo real;
outros imports do arquivo mostram o padrão). Mantenha tudo o mais no `catch` igual.

**Verify**: `grep -n "decidirRetryPorErro\|/4\\\\d\\\\d/" supabase/functions/process-familia/index.ts`
→ mostra a chamada e **não** mostra mais a regex.

## Test plan

- Novos casos em `_shared/publicacao/__tests__/retry.test.ts` cobrindo os 6 cenários do Step 2
  (happy path 5xx, o bug do 429, 4xx definitivo, default desconhecido, retentavel, "429" no texto).
- Modelo estrutural: o próprio `retry.test.ts` existente.
- Verificação: `pnpm test` → todos passam, incluindo os novos.

## Done criteria

Todos devem valer:

- [ ] `pnpm test` exit 0; novos casos de `decidirRetryPorErro` existem e passam.
- [ ] `grep` em `process-familia/index.ts` não acha mais `/4\d\d/`; acha `decidirRetryPorErro`.
- [ ] `pnpm exec tsc -b` exit 0.
- [ ] Nenhum arquivo fora do escopo modificado (`git status`).
- [ ] Linha de status atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte se:

- `_shared/publicacao/retry.ts` não existir ou tiver estrutura muito diferente da esperada.
- Após a troca, algum teste existente do `retry.test.ts` quebrar (sinal de colisão de nome/escopo).
- O import relativo de `process-familia` para `_shared/publicacao/retry.ts` não resolver (confira a
  profundidade do caminho — `process-familia/` está um nível abaixo de `functions/`).

## Maintenance notes

- Se no futuro mais workers precisarem dessa decisão (ex.: `update-familia-ml`, `publicar-familias`),
  reusar `decidirRetryPorErro` em vez de recriar.
- Revisor deve checar: o default permanece "retry no desconhecido" (não inverter), senão erros
  locais transitórios passam a estrandar famílias.
- Para o efeito ser real em produção, precisa redeploy do `process-familia` (passo do operador).
