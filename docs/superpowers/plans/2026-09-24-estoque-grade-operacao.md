# Estoque para produtos de grade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operar produto de grade (cor × tamanho) publicado pela tela Estoque: mostrar o tamanho onde a variação é identificada e permitir acrescentar cores/tamanhos a um anúncio de grade já publicado no ML.

**Architecture:** Três partes na mesma branch. (A) as RPCs de estoque devolvem `tamanho` e um rótulo único `cor · tamanho` é usado por lista, Entrada, Ajuste e Movimentos. (B) "Adicionar variação" roteia produto de grade para um dialog novo. (C) o dialog estende a matriz Cor × Tamanho com as células publicadas travadas, a edge `adicionar-variacoes-familia` aceita tamanho (códigos gerados pelo sistema), e o UPDATE User Products passa a montar `SIZE`/`SIZE_GRID_ID`/`SIZE_GRID_ROW_ID` por SKU sem herdar os do irmão.

**Tech Stack:** React 19 + TS + TanStack Query + Tailwind v4 + shadcn (front); Supabase Edge Functions (Deno, testadas com vitest); Postgres (migrations via Supabase CLI).

**Spec:** `docs/superpowers/specs/2026-09-24-estoque-grade-operacao-design.md` (+ amendment 2026-09-24c no ADR-0166).

## Global Constraints

- INV-1: produto/org sem tamanho → UI, payload e comportamento byte a byte iguais aos de hoje.
- Migrations só por `supabase migration new` + `supabase db push`; validar com `npm run db:check` (ADR-0043). Nunca editar migration antiga.
- Git neste worktree: usar `/usr/bin/git` (o hook RTK barra `git`), commit com `-F <arquivo absoluto>`; mensagem termina com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Testes: `pnpm test <caminho>` (vitest; exige `.env.test` — copiar de `/Users/diego/Desktop/IA/Anuncios MktPlace/.env.test` se faltar, junto com `.env.local`).
- Portão antes de push: `pnpm preflight:static`; antes do merge: `pnpm preflight`.
- Teto de variações por grade: `LIMITE_VARIACOES_GERADAS = 60` (existentes + novas).
- Nunca herdar do irmão: `COLOR`, `GTIN`, `EMPTY_GTIN_REASON`, `SELLER_SKU` (como hoje). **Só no SKU novo com tamanho**: também `SIZE`, `SIZE_GRID_ID`, `SIZE_GRID_ROW_ID` e `GENDER` (este vem de `familias.genero`). Sem tamanho, a herança fica exatamente como hoje.
- `familias.genero` ∈ `'masculino'|'feminino'|'unissex'`; tamanho ∈ `tamanhosValidosParaTipos(tipos da org)`.
- Revisão humana antes de publicar continua valendo para CREATE; este fluxo (ADR-0129) é UPDATE direto e só pode ser acionado por admin.
- Roteamento de modelo: Tasks 1, 4, 5 → **opus** (migration / publicação no ML); Tasks 2, 3, 6, 7 → **sonnet**; Task 8–9 no loop principal.

## Review Focus

0. Revisão Codex gpt-6-sol do plano (VERDICT:REVISE, 12 achados) incorporada: reconciliador com `preservarPublicadas` (T4), GENDER de `familias.genero` no UPDATE (T4), ledger reaplicado no retry (T5), UP detectado pela raiz (T5), travadas = última publicada (T7), picker geral da Entrada (T3), limite 60 sem dupla contagem (T7), roteador pelo dado (T7), numeração sem guia bloqueada (T7), fixture SQL com profile (T1), dry-run sem escrita + prova real (T8), caracterização de payload (T4/T7).
0b. Revisão Codex r2 (VERDICT:REVISE, 9 achados) incorporada: tipo da grade inferido da família e validado na UI e na edge (T5/T7), intenção do retry gravada em `mudanca_estrutural.intencao` com 409 para incompleto/divergente (T5), `ehFluxoAddVariacao` falha alto (T4), numeração não publicável recusada na edge (T5), Movimentos sem mudança para produto comum (T3), roteador síncrono por `temTamanho` do resumo (T1/T2/T7), aceite real pendente formal + reversão (T9), fixtures de 8 dígitos (T5), chart fora do cache falha alto (T4).
0c. Revisão Codex r3 (VERDICT:REVISE, 5 achados) incorporada: grade/tipo decididos só pelas incluídas, excluídas travadas e contando no par (T5/T7); intenção completa normalizada no retry (T5); `POR_SKU` global intocado, SIZE*/GENDER filtrados só no ramo com tamanho + caracterização com irmão COM SIZE* (T4); `publicar-split-ml` no deploy (T9); três RPCs conferidas pós-push (T9).
0f. Revisão Codex r6 (3 achados) incorporada: índice `familias_org_codigo_pai_publicada_idx` + medição do SELECT interno antes/depois (T1/T9), eixos do dialog só das incluídas (T7), fixture SQL com canônica ≠ publicada nos dois sentidos (T1).
0e. Revisão Codex r5 (2 achados) incorporada: `tem_tamanho` calculado sobre a última publicada (T1), tipo do dialog só das incluídas (T7).
0d. Revisão Codex r4 (2 achados) incorporada: `classificarFamilia` como fonte única de "é grade" (incluídas), usada por resumo, dialog e edge, com fallback do dialog de grade para o antigo (T1/T5/T7); consultas de tipo e UP só no ramo de grade (T5).
1. Irmão tem `SIZE`/`SIZE_GRID_ROW_ID` na ficha e a família tem `SIZE` em `atributos_ml` → o SKU novo sai com **um** `SIZE` e é o dele (Task 4, teste "um SIZE só").
2. Cor nova de tamanho existente + tamanho novo de cor existente na MESMA submissão → só as células faltantes viram SKU; nenhuma célula publicada vai no payload (Task 7, teste de `celulasNovas`; Task 5, teste de par duplicado).
3. Retry com a mesma `chave` depois de os códigos terem sido reservados → devolve o resultado anterior, não reserva códigos novos nem duplica SKU (Task 5, teste de idempotência reaproveitado + ordem: idempotência antes da reserva).
4. Foto herdada de cor cujo único SKU vivo está sem `imagem_path` (só `ml_picture_id`) → herda o `ml_picture_id`, não recusa (Task 5, teste `resolverFotoHerdada`).
5. Produto sem tamanho numa org COM tipo habilitado → continua abrindo o dialog antigo, pedindo código digitado (Task 7, teste de roteamento).

---

### Task 1: RPCs de estoque devolvem `tamanho` (opus)

**Files:**
- Create: `supabase/migrations/<timestamp>_estoque_rpc_tamanho.sql` (via `supabase migration new estoque_rpc_tamanho`)
- Create: `supabase/tests/estoque_rpc_tamanho.sql`

**Interfaces:**
- Produces: `variacoes_estoque_produto(text)` e `skus_estoque_org()` passam a incluir a chave `tamanho` (text|null) em cada objeto JSON; `produtos_estoque_resumo()` passa a incluir `tem_tamanho` (boolean) em cada produto da lista (Codex r2 #6: o roteador decide sem consulta extra nem espera). Nada mais muda (corpo, ordem, grants).

- [ ] **Step 1: Criar a migration**

Run: `supabase migration new estoque_rpc_tamanho`

Conteúdo: copiar **literalmente** as definições B e C de `supabase/migrations/20260903030505_estoque_rpc_exclui_kit.sql` (linhas 188–313: as duas `create or replace function`, `revoke` e `grant`), com exatamente duas alterações:
- em `variacoes_estoque_produto`, dentro do `json_build_object`, logo após `'cor', v.cor,` acrescentar `'tamanho', v.tamanho,`
- em `skus_estoque_org`, logo após `'cor', v.cor,` acrescentar `'tamanho', v.tamanho,`

E a definição A (`produtos_estoque_resumo()`, mesmo arquivo, l.19–179, com `revoke`/`grant`), também literal, acrescentando ao `json_build_object` de cada produto (ao lado de `'qtd_skus'`) a chave `tem_tamanho` calculada sobre a **última família PUBLICADA** do `codigo_pai` — a mesma que a edge clona (`adicionar-variacoes-familia/index.ts:115-128`: `ml_item_id not null`, `publicado_em desc nulls last`) — e não sobre a canônica (Codex r5 #1: uma família canônica reingerida pela planilha nasce sem tamanho enquanto a publicada é grade). Só SKU **incluído** conta (mesma regra de `classificarFamilia`, Codex r4 #1):
```sql
'tem_tamanho', exists (
  select 1 from public.variacoes vp
  where vp.familia_id = (
      select fp.id from public.familias fp
      where fp.org_id = org.id and fp.codigo_pai = <alias do produto>.codigo_pai
        and fp.kit_multiplicador is null and fp.ml_item_id is not null
      order by fp.publicado_em desc nulls last limit 1)
    and vp.tamanho is not null and not vp.excluida_da_publicacao
),
```
Ler a função inteira antes e usar o alias real do produto. Produto nunca publicado → `false` (o item "Adicionar variação" já fica desabilitado nele).

**Índice (Codex r6 #1)** — `familias` só tem índice por `(user_id, codigo_pai)`; a subconsulta acima roda uma vez por produto e precisa de um índice próprio, criado na MESMA migration, antes das funções:
```sql
create index if not exists familias_org_codigo_pai_publicada_idx
  on public.familias (org_id, codigo_pai, publicado_em desc nulls last)
  where ml_item_id is not null and kit_multiplicador is null;
```
Medição: `explain analyze` da função não mostra o plano interno (é `security definer` em SQL). Medir o `SELECT` **interno** — o corpo da função com `public.current_org_id()` trocado pelo `org_id` literal da org de maior volume (AVIL) — por SQL read-only no projeto remoto, **antes** do `db push` (sem o índice) e **depois** (Task 9 Step 3). Critério: a subconsulta usa `familias_org_codigo_pai_publicada_idx` (Index Scan / Index Only Scan) e o tempo total não passa de 2× o de antes. Se passar, parar e reportar.

Cabeçalho do arquivo:
```sql
-- ADR-0166 amendment 2026-09-24c: as telas do Estoque identificam a variação por cor · tamanho.
-- As duas funções retornam `setof json` — acrescentar a chave não muda o tipo de retorno, então
-- `create or replace` basta (sem janela sem função). Corpo idêntico a 20260903030505 + `tamanho`.
```

- [ ] **Step 2: Escrever o teste SQL**

`supabase/tests/estoque_rpc_tamanho.sql` — fixture mínima (org, usuário, lote manual, família com `chave_cadastro`, duas variações com códigos de 8 dígitos, uma com `tamanho='M'` e outra com `tamanho=null`), impersona o usuário e confere as chaves:
```sql
\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('92000000-0000-0000-0000-000000000001', 'Grade test', 'grade-test');
insert into auth.users (id, email, raw_user_meta_data) values
  ('92000000-0000-0000-0000-000000000101', 'grade@test.local',
   '{"org_id":"92000000-0000-0000-0000-000000000001"}'::jsonb);
-- current_org_id() lê public.profiles ativo, não o metadado do auth.users (Codex #10). Upsert
-- porque um trigger de signup pode já ter criado a linha.
insert into public.profiles (id, org_id, is_active) values
  ('92000000-0000-0000-0000-000000000101', '92000000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('92000000-0000-0000-0000-000000000201', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', 'processando', 'manual');
-- ml_item_id/publicado_em: `tem_tamanho` olha a última família PUBLICADA (Codex r5 #1).
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, ml_item_id, publicado_em)
values ('92000000-0000-0000-0000-000000000301', '92000000-0000-0000-0000-000000000201',
  '92000000-0000-0000-0000-000000000101', '92000000-0000-0000-0000-000000000001',
  '09200000', 'Camiseta teste', 'CREATE', 'nacional', gen_random_uuid(), 'MLB-TESTE-GRADE', now());
-- Codex r6 #3: canônica ≠ publicada nos dois sentidos. `tem_tamanho` olha a última PUBLICADA; uma
-- implementação que lesse a canônica erraria os dois casos (09500000 e 09300000).
-- Produto próprio (09500000) para não mexer na canônica de 09200000, que as asserções de
-- variacoes_estoque_produto usam: 302 = publicada COM tamanho; 305 = canônica posterior SEM.
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, ml_item_id, publicado_em)
values ('92000000-0000-0000-0000-000000000302', '92000000-0000-0000-0000-000000000201',
  '92000000-0000-0000-0000-000000000101', '92000000-0000-0000-0000-000000000001',
  '09500000', 'Jaqueta teste', 'CREATE', 'nacional', gen_random_uuid(), 'MLB-TESTE-GRADE2', now());
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, criado_em)
values ('92000000-0000-0000-0000-000000000305', '92000000-0000-0000-0000-000000000201',
  '92000000-0000-0000-0000-000000000101', '92000000-0000-0000-0000-000000000001',
  '09500000', 'Jaqueta teste', 'UPDATE', 'nacional', gen_random_uuid(), now() + interval '1 minute');
-- Sentido inverso: produto 09300000 publicado SEM tamanho e canônica posterior COM tamanho → false.
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, ml_item_id, publicado_em)
values ('92000000-0000-0000-0000-000000000303', '92000000-0000-0000-0000-000000000201',
  '92000000-0000-0000-0000-000000000101', '92000000-0000-0000-0000-000000000001',
  '09300000', 'Fita teste', 'CREATE', 'nacional', gen_random_uuid(), 'MLB-TESTE-SIMPLES', now());
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, criado_em)
values ('92000000-0000-0000-0000-000000000304', '92000000-0000-0000-0000-000000000201',
  '92000000-0000-0000-0000-000000000101', '92000000-0000-0000-0000-000000000001',
  '09300000', 'Fita teste', 'UPDATE', 'nacional', gen_random_uuid(), now() + interval '1 minute');
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
values
  ('92000000-0000-0000-0000-000000000302', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', '09500001', 'Preto', 'Preto', 'G', 50, 0),
  ('92000000-0000-0000-0000-000000000305', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', '09500011', 'Preto', 'Preto', null, 50, 0),
  ('92000000-0000-0000-0000-000000000303', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', '09300001', 'Azul', 'Azul', null, 50, 0),
  ('92000000-0000-0000-0000-000000000304', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', '09300011', 'Azul', 'Azul', 'M', 50, 0);
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
values
  ('92000000-0000-0000-0000-000000000301', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', '09200001', 'Preto', 'Preto', 'M', 50, 0),
  ('92000000-0000-0000-0000-000000000301', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', '09200002', 'Azul', 'Azul', null, 50, 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"92000000-0000-0000-0000-000000000101","role":"authenticated"}';

do $$
declare r json; n int;
begin
  -- Sem estas contagens, uma RPC que devolve VAZIO (perfil/org não resolvidos) passaria calada.
  select count(*) into n from public.variacoes_estoque_produto('09200000');
  if n <> 2 then raise exception 'variacoes_estoque_produto devolveu % linhas, esperado 2', n; end if;
  select count(*) into n from public.skus_estoque_org() x where x->>'codigo' in ('09200001', '09200002');
  if n <> 2 then raise exception 'skus_estoque_org devolveu % linhas da fixture, esperado 2', n; end if;
  select x into r from public.variacoes_estoque_produto('09200000') x where x->>'codigo' = '09200001';
  if r->>'tamanho' is distinct from 'M' then raise exception 'variacoes_estoque_produto sem tamanho: %', r; end if;
  select x into r from public.variacoes_estoque_produto('09200000') x where x->>'codigo' = '09200002';
  if not (r::jsonb ? 'tamanho') or r->>'tamanho' is not null then raise exception 'tamanho null deveria vir como chave nula: %', r; end if;
  select x into r from public.skus_estoque_org() x where x->>'codigo' = '09200001';
  if r->>'tamanho' is distinct from 'M' then raise exception 'skus_estoque_org sem tamanho: %', r; end if;
  -- Localizar o array de produtos no JSON do resumo pelo nome real da chave (ler a função; ex.: 'produtos').
  select p into r from json_array_elements(public.produtos_estoque_resumo()->'produtos') p where p->>'codigo_pai' = '09200000';
  if (r->>'tem_tamanho')::boolean is distinct from true then raise exception 'resumo sem tem_tamanho: %', r; end if;
  select p into r from json_array_elements(public.produtos_estoque_resumo()->'produtos') p where p->>'codigo_pai' = '09500000';
  if (r->>'tem_tamanho')::boolean is distinct from true then raise exception 'tem_tamanho deveria vir da última PUBLICADA (grade): %', r; end if;
  select p into r from json_array_elements(public.produtos_estoque_resumo()->'produtos') p where p->>'codigo_pai' = '09300000';
  if (r->>'tem_tamanho')::boolean is distinct from false then raise exception 'tem_tamanho deveria vir da última PUBLICADA (simples): %', r; end if;
end $$;
rollback;
```
Se algum `insert` da fixture falhar por constraint que não é o objeto do teste (coluna NOT NULL nova, check de origem), ajuste **só a fixture** com o valor mínimo válido — nunca a asserção.

- [ ] **Step 3: Rodar o teste — antes da migration deve falhar**

Run (stack local): `supabase start` (se não estiver no ar). Prova de RED: comente temporariamente as duas linhas `'tamanho', v.tamanho,` da migration nova, `supabase db reset`, rode o teste → FAIL com "sem tamanho". Restaure as linhas, `supabase db reset`, rode de novo → PASS.
Comando do teste: `psql "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres" -f supabase/tests/estoque_rpc_tamanho.sql`
Expected: com a chave → sem saída de erro (`ROLLBACK`); sem a chave → `ERROR: variacoes_estoque_produto sem tamanho`.
Se o stack local não subir: registrar isso no relatório e validar depois do `db push` (Task 9) com a mesma asserção via SQL read-only no projeto remoto.

- [ ] **Step 4: `npm run db:check`** — Expected: sem erro.

- [ ] **Step 5: Commit**
```bash
/usr/bin/git add supabase/migrations/*_estoque_rpc_tamanho.sql supabase/tests/estoque_rpc_tamanho.sql
/usr/bin/git commit -F <msg>   # "feat(estoque): RPCs de estoque devolvem tamanho (ADR-0166 2026-09-24c)"
```

---

### Task 2: Tipos, rótulo único e ordenação (sonnet)

**Files:**
- Create: `src/lib/rotulo-variacao.ts`
- Create: `src/lib/__tests__/rotulo-variacao.test.ts`
- Modify: `src/lib/produtos-saldo.ts` (tipos `VariacaoComSaldo`, `SkuEstoqueOrg`, `LinhaVariacaoRpc`; `mapVariacaoRpc`; `fetchVariacoesProduto`; `fetchSkusEstoqueOrg`)
- Test: `src/lib/__tests__/produtos-saldo*.test.ts` (o que já cobre `fetchVariacoesProduto`/`mapVariacaoRpc` — localizar com `ls src/lib/__tests__ | grep produtos-saldo`)

**Interfaces:**
- Consumes: Task 1 (chave `tamanho` no JSON).
- Produces:
  - `VariacaoComSaldo.tamanho: string | null`, `SkuEstoqueOrg.tamanho: string | null`
  - `rotuloVariacao(v: { cor: string | null; nome: string | null; tamanho?: string | null }): string | null` — `null` quando não há cor nem nome.
  - `ordenarVariacoesGrade<T extends { cor: string | null; nome: string | null; tamanho?: string | null }>(vs: T[]): T[]`

- [ ] **Step 1: Teste do rótulo e da ordenação**
```ts
// src/lib/__tests__/rotulo-variacao.test.ts
import { describe, it, expect } from 'vitest';
import { rotuloVariacao, ordenarVariacoesGrade } from '@/lib/rotulo-variacao';

describe('rotuloVariacao', () => {
  it('sem tamanho = cor ?? nome (INV-1, igual ao de hoje)', () => {
    expect(rotuloVariacao({ cor: 'Preto', nome: 'Preto X' })).toBe('Preto');
    expect(rotuloVariacao({ cor: null, nome: 'Fita' })).toBe('Fita');
    expect(rotuloVariacao({ cor: null, nome: null })).toBeNull();
    expect(rotuloVariacao({ cor: 'Preto', nome: null, tamanho: null })).toBe('Preto');
    expect(rotuloVariacao({ cor: 'Preto', nome: null, tamanho: '  ' })).toBe('Preto');
  });
  it('com tamanho = "cor · tamanho"', () => {
    expect(rotuloVariacao({ cor: 'Preto', nome: 'Preto', tamanho: 'M' })).toBe('Preto · M');
    expect(rotuloVariacao({ cor: null, nome: null, tamanho: '42' })).toBe('42');
  });
});

describe('ordenarVariacoesGrade', () => {
  it('ordena por cor e, dentro da cor, na ordem canônica do tamanho', () => {
    const vs = [
      { codigo: '3', cor: 'Preto', nome: 'Preto', tamanho: 'G' },
      { codigo: '1', cor: 'Azul', nome: 'Azul', tamanho: 'P' },
      { codigo: '2', cor: 'Preto', nome: 'Preto', tamanho: 'P' },
      { codigo: '4', cor: 'Preto', nome: 'Preto', tamanho: 'M' },
    ];
    expect(ordenarVariacoesGrade(vs).map((v) => v.codigo)).toEqual(['1', '2', '4', '3']);
  });
  it('sem tamanho em nenhuma variação devolve a lista na MESMA ordem (INV-1)', () => {
    const vs = [{ cor: 'Z', nome: 'Z' }, { cor: 'A', nome: 'A' }];
    expect(ordenarVariacoesGrade(vs)).toEqual(vs);
  });
  it('numeração de calçado em ordem numérica canônica', () => {
    const vs = [{ cor: 'Preto', nome: null, tamanho: '40' }, { cor: 'Preto', nome: null, tamanho: '38' }];
    expect(ordenarVariacoesGrade(vs).map((v) => v.tamanho)).toEqual(['38', '40']);
  });
});
```

- [ ] **Step 2: Rodar** — `pnpm test src/lib/__tests__/rotulo-variacao.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**
```ts
// src/lib/rotulo-variacao.ts
// ADR-0166 amendment 2026-09-24c: rótulo ÚNICO da variação nas telas do Estoque. Antes cada tela
// fazia `cor ?? nome` por conta própria e nenhuma mostrava o tamanho — numa grade, cinco SKUs
// "Preto" indistinguíveis na hora de dar entrada. Sem tamanho o resultado é idêntico ao antigo.
import { TAMANHOS_ROUPA, NUMERACOES_CALCADO } from '@/lib/tamanhos';
import { compararCor } from '@/lib/cor';

type Identificavel = { cor: string | null; nome: string | null; tamanho?: string | null };

export function rotuloVariacao(v: Identificavel): string | null {
  const base = v.cor ?? v.nome;
  const tamanho = v.tamanho?.trim();
  if (!tamanho) return base;
  return base ? `${base} · ${tamanho}` : tamanho;
}

const ORDEM_TAMANHO: readonly string[] = [...TAMANHOS_ROUPA, ...NUMERACOES_CALCADO];

function indiceTamanho(t: string | null | undefined): number {
  const i = t ? ORDEM_TAMANHO.indexOf(t) : -1;
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/** Cor (mesma regra de `compararCor`) e, dentro da cor, tamanho na ordem canônica. Sem tamanho
 *  em nenhuma linha, devolve a lista intacta — a ordem por cor já vem de `fetchVariacoesProduto`. */
export function ordenarVariacoesGrade<T extends Identificavel>(vs: T[]): T[] {
  if (!vs.some((v) => v.tamanho?.trim())) return vs;
  return [...vs].sort((a, b) => compararCor(a, b) || indiceTamanho(a.tamanho) - indiceTamanho(b.tamanho));
}
```
Antes de fechar: abrir `src/lib/cor.ts` e confirmar a assinatura de `compararCor` (usada hoje em `.sort(compararCor)` sobre `VariacaoComSaldo`). Se ela exigir campos além de `cor`/`nome`, ajustar o tipo `Identificavel` para os campos que ela lê — não mudar `compararCor`.

- [ ] **Step 4: Tipos e fetch em `produtos-saldo.ts`**
  - `VariacaoComSaldo`: acrescentar `/** ADR-0166: null = variação sem eixo de tamanho. */ tamanho: string | null;`
  - `SkuEstoqueOrg`: acrescentar `tamanho: string | null;`
  - `LinhaVariacaoRpc`: acrescentar `tamanho?: string | null;`
  - `mapVariacaoRpc`: acrescentar `tamanho: l.tamanho ?? null,`
  - `fetchVariacoesProduto`: `return ordenarVariacoesGrade((...).map(mapVariacaoRpc).sort(compararCor));`
  - `fetchSkusEstoqueOrg`: acrescentar `tamanho?: string | null` aos dois tipos inline e `tamanho: s.tamanho ?? null` no map.
  - `ProdutoEstoqueResumo`: acrescentar `/** ADR-0166: alguma variação da família canônica tem tamanho. */ temTamanho: boolean;`; o tipo cru do resumo ganha `tem_tamanho?: boolean` e o mapeamento (`mapResumoEstoqueRpc`) faz `temTamanho: !!p.tem_tamanho`. Teste em `mapResumoEstoqueRpc`: ausente → `false`, `true` → `true`.
  - Corrigir fixtures de testes existentes que constroem `VariacaoComSaldo`/`SkuEstoqueOrg` literais (o `tsc` vai apontar): acrescentar `tamanho: null`.

- [ ] **Step 5: Rodar** — `pnpm test src/lib` e `pnpm exec tsc -b --force` → PASS.

- [ ] **Step 6: Commit** — `feat(estoque): rotulo unico cor · tamanho e ordenacao de grade`

---

### Task 3: Telas do Estoque mostram o tamanho (sonnet)

**Files:**
- Modify: `src/components/estoque/variacao-estoque-linha.tsx:113`
- Modify: `src/components/estoque/variacao-estoque-card.tsx` (onde exibe `cor ?? nome`)
- Modify: `src/components/estoque/dialog-entrada.tsx:30-33` e o ponto onde monta `SkuEntradaCru` para `montarOpcoesSku` (~l.79)
- Modify: `src/lib/dialog-entrada-busca.ts:12-28` (`SkuEntradaCru`, `montarOpcaoSku` — picker GERAL da Entrada, Codex #6)
- Modify: `src/components/estoque/dialog-ajuste.tsx:15-18`
- Modify: `src/components/estoque/filtros-movimentos.tsx:12-15` (+ onde rotula a opção)
- Modify: `src/components/movimentos-estoque.tsx:121`
- Modify: `src/components/estoque/produto-card.tsx:520-524`
- Test: `src/components/estoque/__tests__/` (arquivos existentes de entrada/ajuste/linha/movimentos — `ls src/components/estoque/__tests__ src/components/__tests__ | grep -i "entrada\|ajuste\|movimento\|variacao-estoque"`)

**Interfaces:**
- Consumes: `rotuloVariacao`, `VariacaoComSaldo.tamanho`, `SkuEstoqueOrg.tamanho` (Task 2).
- Produces: `VariacaoFiltro = { codigo: string; cor: string | null; nome?: string | null; tamanho?: string | null }`.

- [ ] **Step 1: Testes que falham** — em cada suíte existente, acrescentar um caso com uma variação `{ cor: 'Preto', nome: 'Preto', tamanho: 'M' }` e esperar o texto `Preto · M`:
  - linha expandida: `screen.getByText('Preto · M')`
  - Entrada e Ajuste (lista aberta pelo card): a opção do seletor com `'<codigo> · Preto · M'`
  - Picker GERAL da Entrada (`src/lib/__tests__/dialog-entrada-busca*.test.ts`, criar se não existir):
    `montarOpcaoSku({ codigo: '09200001', nome: 'Preto', cor: 'Preto', tamanho: 'M', codigoPai: '09200000', estoque: 1 })`
    → `rotulo === '09200001 · Preto (Preto) · M'` e `textoBusca` contém `m`; sem `tamanho` o rótulo é
    exatamente o de hoje (`'09200001 · Preto (Preto)'`).
  - Movimentos: linha do movimento do código `09200001` mostra `09200001 · Preto · M` quando `variacoes` traz esse código com tamanho; mostra só `09200001` quando não traz; e mostra só `09200001` (texto de hoje, INV-1 — Codex r2 #5) quando traz a variação **sem** tamanho.
  - Filtro de Movimentos: opção de variação sem tamanho tem exatamente o rótulo de hoje (fixar com `getByRole('option', { name: <texto atual> })`).
  Manter os casos antigos intactos (INV-1).

- [ ] **Step 2: Rodar** — FAIL nos casos novos.

- [ ] **Step 3: Implementar**
  - `variacao-estoque-linha.tsx:113`: `{rotuloVariacao(v) ?? '—'}`; idem em `variacao-estoque-card.tsx`.
  - `dialog-entrada.tsx` e `dialog-ajuste.tsx`: a função local vira
    ```ts
    function rotuloComCodigo(v: { codigo: string; cor: string | null; nome: string | null; tamanho?: string | null }): string {
      const complemento = rotuloVariacao(v);
      return complemento ? `${v.codigo} · ${complemento}` : v.codigo;
    }
    ```
    importando `rotuloVariacao` de `@/lib/rotulo-variacao` e trocando os usos de `rotuloVariacao` local por `rotuloComCodigo`. Se o picker filtra por texto digitado, incluir o rótulo novo no texto filtrável.
  - `dialog-entrada-busca.ts`: `SkuEntradaCru` ganha `tamanho?: string | null`; em `montarOpcaoSku`,
    `const sufixoTamanho = s.tamanho?.trim() ? \` · ${s.tamanho.trim()}\` : '';` e
    `rotulo = \`${s.codigo} · ${s.nome}${complemento}${sufixoTamanho}\`` (o `textoBusca` já deriva do
    rótulo). Em `dialog-entrada.tsx`, repassar `tamanho` de `SkuEstoqueOrg` ao montar os `SkuEntradaCru`.
  - `filtros-movimentos.tsx`: `VariacaoFiltro` ganha `nome?: string | null; tamanho?: string | null`; o rótulo da opção só muda quando há tamanho: `v.tamanho?.trim() ? \`${<rótulo atual>} · ${v.tamanho.trim()}\` : <rótulo atual>` — onde `<rótulo atual>` é a expressão que o arquivo já usa hoje (não trocar por `rotuloVariacao`, que para variação sem cor usaria `nome` e mudaria o texto).
  - `produto-card.tsx:523`: `variacoes={(variacoes ?? []).map((v) => ({ codigo: v.codigo, cor: v.cor, nome: v.nome, tamanho: v.tamanho }))}`
  - `movimentos-estoque.tsx`: 
    ```ts
    // Só variação COM tamanho ganha sufixo: produto comum mantém a linha "só código" de hoje (INV-1).
    const rotuloPorCodigo = useMemo(
      () => new Map(variacoes.filter((v) => v.tamanho?.trim())
        .map((v) => [v.codigo, rotuloVariacao({ cor: v.cor, nome: v.nome ?? null, tamanho: v.tamanho })])),
      [variacoes],
    );
    ```
    e na linha 121: `<span className="font-mono">{m.codigo}</span>{rotuloPorCodigo.get(m.codigo) && <span className="text-muted-foreground"> · {rotuloPorCodigo.get(m.codigo)}</span>}` — conferir no teste que o layout da linha (grid) não quebra; se a coluna for estreita, usar `truncate`.

- [ ] **Step 4: Rodar** — `pnpm test src/components` → PASS; `pnpm exec tsc -b --force` → PASS.

- [ ] **Step 5: Commit** — `feat(estoque): lista, entrada, ajuste e movimentos mostram o tamanho`

---

### Task 4: UPDATE User Products monta o tamanho por SKU (opus)

**Files:**
- Modify: `supabase/functions/_shared/update/fluxo-add-variacao.ts` (falha alto)
- Modify: `supabase/functions/_shared/user-products/atualizar-familia-up.ts` (tipos `VariacaoUP`, `AtualizarFamiliaUPArgs`; `criarPlano` ~l.219)
- Modify: `supabase/functions/update-familia-ml/processar.ts:166` (select de variações)
- Modify: `supabase/functions/reconciliar-convergencia-up/processar.ts:54,65` (selects)
- Test: `supabase/functions/_shared/user-products/__tests__/atualizar-familia-up-ficha.test.ts`, `supabase/functions/_shared/update/__tests__/fluxo-add-variacao.test.ts` (criar se não existir), suíte do reconciliador

**Interfaces:**
- Produces:
  - `VariacaoUP.tamanho?: string | null`
  - `AtualizarFamiliaUPArgs.familia.genero?: string | null`
  - `AtualizarFamiliaUPArgs.garantirChartFn?: typeof garantirChart` (injeção em teste; produção usa `garantirChart`)

- [ ] **Step 1: `atributosDeFicha` NÃO muda** (Codex r3 #3): mexer no `POR_SKU` global mudaria o payload de produto sem tamanho cujo irmão remoto tenha `SIZE*` — quebra de INV-1. A remoção de `SIZE*`/`GENDER` herdados acontece só dentro de `criarPlano`, no ramo com tamanho (Step 4). `atributos-irmao.ts` fica intocado; o teste de caracterização abaixo usa um irmão COM `SIZE*` para provar isso.

- [ ] **Step 2: Testes de `criarPlano` com tamanho** — em `atualizar-familia-up-ficha.test.ts`, novo `describe`:
```ts
describe('atualizarFamiliaUP — SKU novo de grade (ADR-0166 2026-09-24c)', () => {
  const IRMAO_GRADE = [
    ...ATRIBUTOS_DO_IRMAO,
    { id: 'GENDER', value_id: '339666', value_name: 'Masculino' },
    { id: 'SIZE', value_name: 'M' },
    { id: 'SIZE_GRID_ID', value_name: 'CH1' },
    { id: 'SIZE_GRID_ROW_ID', value_name: 'CH1:2' },
  ];
  const chartFake = vi.fn(async () => ({
    chartId: 'CH1',
    linhaPorTamanho: new Map([['M', { rowId: 'CH1:2', sizeLabel: 'M' }], ['G', { rowId: 'CH1:3', sizeLabel: 'G' }]]),
  }));
  function argsGrade(over: Partial<AtualizarFamiliaUPArgs> = {}) {
    const base = args();
    return args({
      familia: { ...(base.familia as object), genero: 'masculino', categoria_ml_id: 'MLB1', atributos_ml: [{ id: 'SIZE', value_name: 'XX' }] } as never,
      variacoes: [
        { codigo: 'A', cor: 'Azul-petróleo', tamanho: 'M', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: 'P1' },
        { codigo: 'NOVA', cor: 'Preto', tamanho: 'G', estoque: 40, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: 'P2' },
      ] as never,
      garantirChartFn: chartFake as never,
      ...over,
    });
  }
  beforeEach(() => {
    chartFake.mockClear();
    globalThis.fetch = (async () => new Response(JSON.stringify({ attributes: IRMAO_GRADE }), { status: 200 })) as typeof fetch;
  });

  it('SKU novo leva o SIZE e a linha do chart DELE, não os do irmão — e um SIZE só', async () => {
    await atualizarFamiliaUP(argsGrade());
    const attrs = atributosEnviados();
    expect(attrs.filter((a) => a.id === 'SIZE')).toEqual([{ id: 'SIZE', value_name: 'G' }]);
    expect(attrs.filter((a) => a.id === 'SIZE_GRID_ROW_ID')).toEqual([{ id: 'SIZE_GRID_ROW_ID', value_name: 'CH1:3' }]);
    expect(attrs.filter((a) => a.id === 'SIZE_GRID_ID')).toEqual([{ id: 'SIZE_GRID_ID', value_name: 'CH1' }]);
  });

  it('chart resolvido uma vez, com gênero e todos os tamanhos da família', async () => {
    await atualizarFamiliaUP(argsGrade());
    expect(chartFake).toHaveBeenCalledTimes(1);
    expect(chartFake.mock.calls[0]!.slice(2)).toEqual(['c', 'MLB1', 'masculino', ['M', 'G']]);
  });

  it('família com tamanho e sem gênero falha alto, sem criar item', async () => {
    await expect(atualizarFamiliaUP(argsGrade({
      familia: { ...(args().familia as object), genero: null, categoria_ml_id: 'MLB1' } as never,
    }))).rejects.toThrow(/genero/i);
    expect(criarItemSpy).not.toHaveBeenCalled();
  });

  it('GENDER vem de familias.genero, nunca do irmão nem de atributos_ml (Codex #2)', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      attributes: IRMAO_GRADE.map((a) => (a.id === 'GENDER' ? { id: 'GENDER', value_id: '339665', value_name: 'Feminino' } : a)),
    }), { status: 200 })) as typeof fetch;
    await atualizarFamiliaUP(argsGrade({
      familia: { ...(args().familia as object), genero: 'masculino', categoria_ml_id: 'MLB1',
        atributos_ml: [{ id: 'GENDER', value_id: '110461' }] } as never,
    }));
    expect(atributosEnviados().filter((a) => a.id === 'GENDER')).toEqual([{ id: 'GENDER', value_id: '339666' }]);
  });

  it('GET do irmão falhou → GENDER e SIZE continuam certos', async () => {
    globalThis.fetch = (async () => new Response('erro', { status: 500 })) as typeof fetch;
    await atualizarFamiliaUP(argsGrade());
    const attrs = atributosEnviados();
    expect(attrs.filter((a) => a.id === 'GENDER')).toEqual([{ id: 'GENDER', value_id: '339666' }]);
    expect(attrs.filter((a) => a.id === 'SIZE')).toEqual([{ id: 'SIZE', value_name: 'G' }]);
  });
});

// Caracterização (Codex #12): ANTES de tocar em atualizar-familia-up.ts, capture o payload COMPLETO
// que o código atual gera para a família sem tamanho do `args()` padrão e fixe-o com
// `expect(criarItemSpy.mock.calls[0]![1]).toEqual(PAYLOAD_SEM_TAMANHO_ATUAL)` — o objeto literal
// é copiado do valor impresso pela 1ª execução (rodar o teste com `console.log(JSON.stringify(...))`
// no código de hoje, colar o literal, remover o log). Commitar ESTE teste passando no código atual
// antes de implementar o Step 4; ele tem que continuar passando depois (INV-1 byte a byte).
describe('atualizarFamiliaUP — família sem tamanho (INV-1)', () => {
  it('payload completo idêntico ao de antes da feature, e chart nunca é chamado', async () => {
    const chartFake = vi.fn();
    await atualizarFamiliaUP(args({ garantirChartFn: chartFake as never }));
    expect(chartFake).not.toHaveBeenCalled();
    expect(criarItemSpy.mock.calls[0]![1]).toEqual(PAYLOAD_SEM_TAMANHO_ATUAL);
  });
  // Codex r3 #3: irmão remoto COM SIZE* e banco sem tamanho → payload exatamente como hoje
  // (hoje o SIZE* do irmão é herdado; continua sendo). Capturar PAYLOAD_SEM_TAMANHO_IRMAO_COM_SIZE
  // do código atual, como o anterior.
  it('irmão remoto com SIZE* e variação sem tamanho: payload idêntico ao atual', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ attributes: [
      ...ATRIBUTOS_DO_IRMAO, { id: 'SIZE', value_name: 'M' }, { id: 'SIZE_GRID_ID', value_name: 'CH1' },
      { id: 'SIZE_GRID_ROW_ID', value_name: 'CH1:2' },
    ] }), { status: 200 })) as typeof fetch;
    await atualizarFamiliaUP(args());
    expect(criarItemSpy.mock.calls[0]![1]).toEqual(PAYLOAD_SEM_TAMANHO_IRMAO_COM_SIZE);
  });
});
```
Se `atualizarFamiliaUP` capturar a exceção da porta e devolver `{ estado: 'erro' }` em vez de rejeitar, troque a asserção do 3º caso para `expect(r.estado).toBe('erro')` + `expect(r.mensagem).toMatch(/genero/i)` — o requisito é "não cria item e diz o porquê".

- [ ] **Step 3: Rodar** — `pnpm test supabase/functions/_shared/user-products` → FAIL nos novos.

- [ ] **Step 4: Implementar**
  - `atributos-irmao.ts`: **sem mudança** (ver Step 1).
  - `atualizar-familia-up.ts`:
    - import: `import { garantirChart, type ChartResolvido, type Genero } from '../ml/size-chart.ts';`
    - `VariacaoUP`: `/** ADR-0166. null/ausente = sem eixo de tamanho (INV-1). */ tamanho?: string | null;`
    - `familia`: `genero?: string | null;`
    - args: `garantirChartFn?: typeof garantirChart;`
    - antes de `criarPlano`:
      ```ts
      // ADR-0166 2026-09-24c: SKU novo de grade precisa do chart ANTES do payload. Resolvido uma vez
      // por execução (SIZE_GRID_ID é o mesmo para a família inteira). O chart nasce com o superset de
      // tamanhos (ADR-0167 D2), então isto é cache hit. Tamanho fora do chart em cache: garantirChart
      // LANÇA (size-chart.ts:259-270) — falha alto, sem rotação automática (Codex r2 #9).
      const IDS_TAMANHO = new Set(['SIZE', 'SIZE_GRID_ID', 'SIZE_GRID_ROW_ID']);
      let chartPromessa: Promise<ChartResolvido | null> | null = null;
      const resolverChart = (): Promise<ChartResolvido | null> => (chartPromessa ??= (async () => {
        const tamanhos = [...new Set(variacoes.map((v) => v.tamanho?.trim()).filter((t): t is string => !!t))];
        if (tamanhos.length === 0) return null;
        if (!familia.genero) {
          throw new Error(`Família ${familia.id}: SKU com tamanho mas familias.genero ausente — o ML exige GENDER com o guia de tamanhos (ADR-0167 D6).`);
        }
        if (!familia.categoria_ml_id) throw new Error(`Família ${familia.id}: sem categoria_ml_id para resolver o guia de tamanhos.`);
        return (args.garantirChartFn ?? garantirChart)(
          admin, await ctx.getToken(), conexao.id, familia.categoria_ml_id, familia.genero as Genero, tamanhos,
        );
      })());
      ```
    - dentro de `criarPlano`, antes de `montarPayloadItem`:
      ```ts
      const chart = v.tamanho ? await resolverChart() : null;
      const linha = v.tamanho ? chart?.linhaPorTamanho.get(v.tamanho) ?? null : null;
      const atributosMesclados = mesclarAtributos(familia.atributos_ml, await lerFichaDoIrmao());
      // SIZE* vão por SKU em montarPayloadItem; se a família também os tiver em atributos_ml
      // (IA/Revisão), duplicariam — mesma limpeza de publicar-familia-up.ts (IDS_SUBSTITUIDOS).
      // GENDER: mesma regra do CREATE (publicar-familia-up.ts:74-92) — familias.genero, escolhido
      // pelo operador, é a fonte de verdade; o do irmão/IA pode divergir ou faltar (Codex #2).
      const atributos = v.tamanho
        ? [
          ...atributosMesclados.filter((a) => !a.id || (!IDS_TAMANHO.has(a.id) && a.id !== 'GENDER')),
          { id: 'GENDER', value_id: GENDER_VALUE[familia.genero as Genero].id },
        ]
        : atributosMesclados;
      ```
      (import de `GENDER_VALUE` junto com `garantirChart`; `resolverChart()` já garantiu `familia.genero` não nulo antes desta linha.)
      e no payload: `{ ...familiaInput, atributos_ml: atributos }` e na variação acrescentar
      `tamanho: v.tamanho ?? null, sizeLabel: linha?.sizeLabel ?? null, sizeGridId: chart?.chartId ?? null, sizeGridRowId: linha?.rowId ?? null,`.
      (Tamanho sem linha → o guard de `montarPayloadItem` já lança "sem guia de tamanhos resolvida".)
  - `update-familia-ml/processar.ts:166`: acrescentar `tamanho` ao select (a `familia` já é `select('*')` e leva `genero`).
  - `reconciliar-convergencia-up/processar.ts`: `familias` select + `, genero, lote_id`; `variacoes` select + `, tamanho`; e **passar `preservarPublicadas`** (Codex #1, BLOQUEANTE — hoje a retomada de uma composição interrompida do fluxo "Adicionar variação" roda sem ela e pode reenviar preço/atributos às irmãs; defeito pré-existente do ADR-0129 que a grade torna mais provável):
    ```ts
    import { ehFluxoAddVariacao } from '../_shared/update/fluxo-add-variacao.ts';
    // ... depois de resolver `familia`:
    const preservarPublicadas = await ehFluxoAddVariacao(admin, familia.lote_id);
    // ... na chamada:
    const resultado = await atualizarFamiliaUP({ ...(como hoje), preservarPublicadas });
    ```
    **E `ehFluxoAddVariacao` passa a falhar alto** (Codex r2 #3 — hoje ignora o `error` e devolve `false`, reabrindo o repreço das irmãs): em `_shared/update/fluxo-add-variacao.ts`,
    ```ts
    const { data, error } = await admin.from('lotes').select('origem').eq('id', loteId).maybeSingle();
    if (error) throw new Error(`ler origem do lote ${loteId}: ${error.message}`);
    if (!data) throw new Error(`lote ${loteId} não encontrado ao decidir preservarPublicadas`);
    return data.origem === 'manual';
    ```
    Os dois chamadores (`update-familia-ml/processar.ts:195` e o reconciliador) já estão dentro de caminhos cujo `throw` vira retry — conferir isso no código antes de fechar (no worker, o catch retenta; no reconciliador, a rodada falha e é retomada). Teste do helper: erro → lança; lote ausente → lança; manual → true; planilha → false.
    Teste em `supabase/functions/reconciliar-convergencia-up/__tests__/` (seguir o fake de admin existente nessa suíte): lote com `origem='manual'` → `atualizarFamiliaUP` recebe `preservarPublicadas: true`; lote de planilha → `false`; erro lendo o lote → `atualizarFamiliaUP` **não** é chamado. Injetar `atualizarFamiliaUP` do mesmo jeito que a suíte já faz; se ela não tiver ponto de injeção, acrescentar `deps.atualizarUP` como em `update-familia-ml/processar.ts:100`.

- [ ] **Step 5: Rodar** — `pnpm test supabase/functions/_shared/user-products supabase/functions/update-familia-ml supabase/functions/reconciliar-convergencia-up` → PASS; `pnpm check:functions` → PASS.

- [ ] **Step 6: Commit** — `fix(up): SKU novo de grade monta SIZE/SIZE_GRID_ROW_ID proprios, nunca os do irmao`

---

### Task 5: Edge `adicionar-variacoes-familia` aceita grade (opus)

**Files:**
- Modify: `supabase/functions/adicionar-variacoes-familia/processar.ts`
- Modify: `supabase/functions/adicionar-variacoes-familia/index.ts`
- Modify: `supabase/functions/_shared/produto/codigos.ts` (novo `derivarCodigosSku`)
- Test: `supabase/functions/adicionar-variacoes-familia/__tests__/processar.test.ts`, `supabase/functions/_shared/produto/__tests__/codigos.test.ts` (criar se não existir)

**Interfaces:**
- Consumes: Task 4 (publicação monta o tamanho).
- Produces (contrato do body, usado pela Task 7):
  ```ts
  export interface VariacaoNovaEntrada {
    codigo?: string;            // obrigatório SEM tamanho; PROIBIDO com tamanho (gerado pelo sistema)
    nome: string;               // a cor
    tamanho?: string;           // obrigatório em família de grade
    gtin: string | null;
    preco: number; custo: number | null; estoqueInicial: number;
    pesoGramas: number | null; alturaCm: number | null; larguraCm: number | null; comprimentoCm: number | null;
    imagemPath?: string;        // foto enviada agora
    fotoDeCodigo?: string;      // OU: herda a foto do SKU vivo com este código (mesma cor) — só em grade
  }
  ```
  Resposta: `{ loteId, familiaId, publicacaoOk, falhasEstoque, codigos: string[] }` (`codigos` = SKUs novos, 8 dígitos, na ordem de `variacoes`; também no ramo `jaExistia`, lidos de `familias.mudanca_estrutural.novas`).
  - `derivarCodigosSku(ultimo: number, qtd: number): string[]`
  - `classificarFamilia(vivas: Array<{ tamanho: string | null; excluida_da_publicacao: boolean }>): 'simples' | 'grade' | 'mista'` — pura, **fonte única** da regra "é grade" (Codex r4 #1): só as incluídas contam; todas sem tamanho → `simples`; todas com → `grade`; misto → `mista`. Mora em `_shared/produto/tipos-produto-valores.ts` e é reexportada em `@/lib/tamanhos` para o dialog usar a mesma. `validarGrade` usa ela em vez de recalcular.
  - `validarGrade(entrada: VariacaoNovaEntrada[], ctx: { vivas: Array<{ codigo: string; cor: string | null; tamanho: string | null; excluida_da_publicacao: boolean }>; tiposHabilitados: readonly string[]; genero: string | null; ehUP: boolean }): ErroValidacao[]`
    — "é grade" e o tipo vêm só das **incluídas** (`excluida_da_publicacao=false`); incluídas misturando tamanho e ausência dele → 400 antes de qualquer escrita; a checagem de par duplicado usa **todas** as vivas, inclusive as excluídas (Codex r3 #1).
  - Em `supabase/functions/_shared/produto/tipos-produto-valores.ts` (fonte única, reexportada pelo front):
    - `tipoDaGrade(tamanhos: readonly string[]): TipoProduto | null` — `'roupa'` se todos ∈ `TAMANHOS_ROUPA`, `'calcado'` se todos ∈ `NUMERACOES_CALCADO`, `null` se vazio, misto ou desconhecido (as listas são disjuntas).
    - `tamanhosDoTipo(tipo: TipoProduto): readonly string[]`
    - `numeracaoPublicavel(numeracao: string, genero: 'masculino' | 'feminino' | 'unissex'): boolean` — a regra que hoje vive em `src/lib/tamanhos.ts:49-56`, movida para cá (importando `COMPRIMENTO_PE_CM` de `../ml/medidas-valores.ts`); `src/lib/tamanhos.ts` passa a delegar, mantendo a assinatura dele (`genero` vazio → `true`).
  - `resolverFotoHerdada(fotoDeCodigo: string, cor: string, vivas: Array<{ codigo: string; cor: string | null; imagem_path: string | null; ml_picture_id: string | null }>): { imagemPath: string | null; mlPictureId: string | null } | null`

- [ ] **Step 1: Testes puros (falham)**
```ts
// processar.test.ts — novos casos
describe('validarEntrada — grade', () => {
  const base = { familia_id: 'f', chave: '00000000-0000-4000-8000-000000000000' };
  const v = { nome: 'Verde', tamanho: 'P', gtin: null, preco: 10, custo: null, estoqueInicial: 1,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null };
  it('aceita variação sem código quando traz tamanho', () => {
    expect(validarEntrada({ ...base, variacoes: [{ ...v, imagemPath: 'u1/x.jpg' }] }, 'u1')).toEqual([]);
  });
  it('aceita fotoDeCodigo no lugar de imagemPath', () => {
    expect(validarEntrada({ ...base, variacoes: [{ ...v, fotoDeCodigo: '00000001' }] }, 'u1')).toEqual([]);
  });
  it('recusa sem foto nenhuma e com as duas', () => {
    expect(validarEntrada({ ...base, variacoes: [{ ...v }] }, 'u1').map((e) => e.campo)).toContain('variacoes[0].imagemPath');
    expect(validarEntrada({ ...base, variacoes: [{ ...v, imagemPath: 'u1/x', fotoDeCodigo: '1' }] }, 'u1').map((e) => e.campo)).toContain('variacoes[0].imagemPath');
  });
  it('sem tamanho continua exigindo código (fluxo antigo intacto)', () => {
    const { tamanho: _t, ...semTam } = v;
    expect(validarEntrada({ ...base, variacoes: [{ ...semTam, imagemPath: 'u1/x' }] }, 'u1').map((e) => e.campo)).toContain('variacoes[0].codigo');
  });
});

describe('validarGrade', () => {
  const vivas = [
    { codigo: '00000001', cor: 'Preto', tamanho: 'P', excluida_da_publicacao: false },
    { codigo: '00000002', cor: 'Preto', tamanho: 'M', excluida_da_publicacao: false },
  ];
  const ctx = { vivas, tiposHabilitados: ['roupa'], genero: 'masculino', ehUP: true };
  const nova = (cor: string, tamanho?: string, extra: object = {}) => ({ nome: cor, tamanho, gtin: null, preco: 10, custo: null, estoqueInicial: 1,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null, imagemPath: 'u/x', ...extra });
  it('aceita cor nova e tamanho novo', () => {
    expect(validarGrade([nova('Verde', 'P'), nova('Preto', 'G')], ctx)).toEqual([]);
  });
  it('recusa par que já existe e par repetido na submissão', () => {
    expect(validarGrade([nova('Preto', 'M')], ctx)).toHaveLength(1);
    expect(validarGrade([nova('Verde', 'P'), nova('Verde', 'P')], ctx)).toHaveLength(1);
  });
  it('recusa tamanho fora da whitelist, sem tamanho e com código', () => {
    expect(validarGrade([nova('Verde', 'XGG')], ctx)[0]!.mensagem).toMatch(/tamanho/i);
    expect(validarGrade([nova('Verde')], ctx)[0]!.mensagem).toMatch(/tamanho/i);
    expect(validarGrade([nova('Verde', 'P', { codigo: '123' })], ctx)[0]!.mensagem).toMatch(/código/i);
  });
  it('recusa família sem gênero e família não-UP', () => {
    expect(validarGrade([nova('Verde', 'P')], { ...ctx, genero: null })[0]!.mensagem).toMatch(/gênero/i);
    expect(validarGrade([nova('Verde', 'P')], { ...ctx, ehUP: false })[0]!.mensagem).toMatch(/não é suportado/i);
  });
  it('família SEM tamanho: recusa variação com tamanho', () => {
    expect(validarGrade([nova('Verde', 'P', { codigo: '9' })], { ...ctx, vivas: [{ codigo: '00000001', cor: 'Preto', tamanho: null, excluida_da_publicacao: false }] })).toHaveLength(1);
  });
  it('fotoDeCodigo tem que apontar para SKU vivo da MESMA cor', () => {
    expect(validarGrade([nova('Preto', 'G', { imagemPath: undefined, fotoDeCodigo: '00000001' })], ctx)).toEqual([]);
    expect(validarGrade([nova('Verde', 'G', { imagemPath: undefined, fotoDeCodigo: '00000001' })], ctx)).toHaveLength(1);
  });
  it('org com roupa E calçado: jaqueta publicada não aceita numeração (Codex r2 #1)', () => {
    const c = { ...ctx, tiposHabilitados: ['roupa', 'calcado'] };
    expect(validarGrade([nova('Preto', '42')], c)[0]!.mensagem).toMatch(/tamanho/i);
    expect(validarGrade([nova('Preto', 'G')], c)).toEqual([]);
  });
  it('tipo da grade desligado na org depois de publicar → recusa com motivo claro', () => {
    expect(validarGrade([nova('Preto', 'G')], { ...ctx, tiposHabilitados: [] })[0]!.mensagem).toMatch(/desativad/i);
  });
  it('numeração sem guia de tamanhos para o gênero é recusada na edge (Codex r2 #4)', () => {
    const vivasCalc = [{ codigo: '00000001', cor: 'Preto', tamanho: '38', excluida_da_publicacao: false }];
    const c = { ...ctx, vivas: vivasCalc, tiposHabilitados: ['calcado'], genero: 'feminino' };
    expect(validarGrade([nova('Preto', '45')], c)[0]!.mensagem).toMatch(/Mercado Livre/i);
    expect(validarGrade([nova('Preto', '39')], c)).toEqual([]);
  });
  it('grade publicada com tamanhos mistos/desconhecidos → recusa (não adivinha o tipo)', () => {
    const c = { ...ctx, vivas: [{ codigo: '00000001', cor: 'Preto', tamanho: 'P', excluida_da_publicacao: false }, { codigo: '00000002', cor: 'Preto', tamanho: '38', excluida_da_publicacao: false }], tiposHabilitados: ['roupa', 'calcado'] };
    expect(validarGrade([nova('Azul', 'P')], c)).toHaveLength(1);
  });
  it('incluídas com e sem tamanho → recusa antes de escrever (Codex r3 #1)', () => {
    const c = { ...ctx, vivas: [{ codigo: '00000001', cor: 'Preto', tamanho: 'P', excluida_da_publicacao: false }, { codigo: '00000002', cor: 'Azul', tamanho: null, excluida_da_publicacao: false }] };
    expect(validarGrade([nova('Verde', 'P')], c)[0]!.mensagem).toMatch(/com e sem tamanho/);
  });
  it('excluída não decide o tipo, mas bloqueia par duplicado', () => {
    const c = { ...ctx, vivas: [
      { codigo: '00000001', cor: 'Preto', tamanho: 'P', excluida_da_publicacao: false },
      { codigo: '00000002', cor: 'Preto', tamanho: 'M', excluida_da_publicacao: true },
      { codigo: '00000003', cor: 'Azul', tamanho: null, excluida_da_publicacao: true },
    ] };
    expect(validarGrade([nova('Preto', 'G')], c)).toEqual([]);
    expect(validarGrade([nova('Preto', 'M')], c)[0]!.mensagem).toMatch(/já existe/);
  });
});

describe('tipoDaGrade / numeracaoPublicavel', () => {
  it('infere o tipo pelos tamanhos', () => {
    expect(tipoDaGrade(['P', 'GG'])).toBe('roupa');
    expect(tipoDaGrade(['38', '41/42'])).toBe('calcado');
    expect(tipoDaGrade(['P', '38'])).toBeNull();
    expect(tipoDaGrade([])).toBeNull();
  });
  it('mesma regra que o front usava (conferir 45/46 feminino e pares contra COMPRIMENTO_PE_CM)', () => {
    expect(numeracaoPublicavel('45', 'feminino')).toBe(false);
    expect(numeracaoPublicavel('33/34', 'masculino')).toBe(false);
    expect(numeracaoPublicavel('40', 'masculino')).toBe(true);
  });
});

describe('resolverFotoHerdada', () => {
  // Códigos vivos sempre com 8 dígitos (é o que o banco grava); `fotoDeCodigo` pode vir curto e é
  // normalizado por `normalizarCodigo8` antes de comparar (Codex r2 #8).
  it('copia imagem_path e ml_picture_id do irmão da mesma cor', () => {
    expect(resolverFotoHerdada('1', 'Preto', [{ codigo: '00000001', cor: 'Preto', imagem_path: 'o/a.jpg', ml_picture_id: 'PIC' }]))
      .toEqual({ imagemPath: 'o/a.jpg', mlPictureId: 'PIC' });
  });
  it('irmão só com ml_picture_id ainda serve', () => {
    expect(resolverFotoHerdada('00000001', 'Preto', [{ codigo: '00000001', cor: 'Preto', imagem_path: null, ml_picture_id: 'PIC' }]))
      .toEqual({ imagemPath: null, mlPictureId: 'PIC' });
  });
  it('cor diferente ou irmão sem foto nenhuma → null', () => {
    expect(resolverFotoHerdada('00000001', 'Verde', [{ codigo: '00000001', cor: 'Preto', imagem_path: 'x', ml_picture_id: null }])).toBeNull();
    expect(resolverFotoHerdada('00000001', 'Preto', [{ codigo: '00000001', cor: 'Preto', imagem_path: null, ml_picture_id: null }])).toBeNull();
  });
});

describe('montarVariacaoNova — grade', () => {
  it('grava tamanho e a foto resolvida; mantém a paridade de chaves com clonarVariacao', () => {
    const linha = montarVariacaoNova(
      { codigo: '00000009', nome: 'Verde', tamanho: 'P', gtin: null, preco: 10, custo: null, estoqueInicial: 1,
        pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null, imagemPath: 'o/a.jpg', mlPictureId: 'PIC' },
      { familiaId: 'f', userId: 'u', orgId: 'o', precoPublicacao: 10 },
    );
    expect(linha.tamanho).toBe('P');
    expect(linha.imagem_path).toBe('o/a.jpg');
    expect(linha.ml_picture_id).toBe('PIC');
  });
});
```
```ts
// codigos.test.ts
it('derivarCodigosSku reserva N SKUs sem PAI', () => {
  expect(derivarCodigosSku(105, 3)).toEqual(['00000103', '00000104', '00000105']);
  expect(() => derivarCodigosSku(5, 0)).toThrow();
});
```
O teste existente de paridade de chaves `clonarVariacao` × `montarVariacaoNova` precisa continuar passando sem alteração.

- [ ] **Step 2: Rodar** — `pnpm test supabase/functions/adicionar-variacoes-familia supabase/functions/_shared/produto` → FAIL.

- [ ] **Step 3: Implementar `codigos.ts`**
```ts
/** Faixa de SKUs sem PAI — "Adicionar variação" em grade (ADR-0166 2026-09-24c): a família já tem
 *  PAI, só as variações novas precisam de código. Mesmo formato e mesmo teto de `derivarCodigos`. */
export function derivarCodigosSku(ultimo: number, qtd: number): string[] {
  if (!Number.isInteger(ultimo) || !Number.isInteger(qtd) || qtd < 1) throw new Error('Faixa de códigos inválida.');
  const primeiro = ultimo - qtd + 1;
  if (primeiro < 1) throw new Error('Faixa de códigos inválida.');
  if (ultimo > CODIGO_MAX) throw new Error(`Sequência de códigos da organização esgotada (limite ${CODIGO_MAX}).`);
  return Array.from({ length: qtd }, (_, i) => String(primeiro + i).padStart(8, '0'));
}
```

- [ ] **Step 4: Implementar `processar.ts`**
  - `VariacaoNovaEntrada` como na seção Interfaces; novo tipo `VariacaoNovaResolvida = Omit<VariacaoNovaEntrada, 'codigo' | 'imagemPath' | 'fotoDeCodigo'> & { codigo: string; imagemPath: string | null; mlPictureId: string | null }`.
  - `validarEntrada`: o bloco de código só valida quando `v.codigo !== undefined` **ou** `v.tamanho` ausente (sem tamanho → obrigatório, como hoje); foto: exatamente um de `imagemPath`/`fotoDeCodigo` (mensagem no campo `imagemPath`: "Envie a foto ou herde a de um SKU da mesma cor."); `imagemPath`, quando presente, mantém a checagem de prefixo `${userId}/` e `..`; `fotoDeCodigo` precisa ser string de 1–8 dígitos. `tamanho`, quando presente, precisa ser string não vazia.
  - `validarGrade` (nova, pura). Regras, na ordem, uma mensagem por variação:
    ```ts
    export function validarGrade(entrada: VariacaoNovaEntrada[], ctx: {
      vivas: Array<{ codigo: string; cor: string | null; tamanho: string | null }>;
      tiposHabilitados: readonly string[]; genero: string | null; ehUP: boolean;
    }): ErroValidacao[] {
      const erros: ErroValidacao[] = [];
      // Só as INCLUÍDAS definem o que o anúncio é (Codex r3 #1): uma excluída sem tamanho (ou com)
      // não publica e não pode decidir o tipo — mas continua existindo para a checagem de par.
      const incluidas = ctx.vivas.filter((v) => !v.excluida_da_publicacao);
      const classe = classificarFamilia(ctx.vivas);
      if (classe === 'mista') {
        return [{ campo: 'familia_id', mensagem: 'Este produto tem SKUs publicados com e sem tamanho — ajuste pelo suporte antes de adicionar.' }];
      }
      const familiaGrade = classe === 'grade';
      if (familiaGrade && !ctx.ehUP) {
        return [{ campo: 'familia_id', mensagem: 'Este produto usa tamanho mas não está publicado em User Products — adicionar por aqui não é suportado.' }];
      }
      if (familiaGrade && !ctx.genero) {
        return [{ campo: 'familia_id', mensagem: 'Produto de grade sem gênero cadastrado — o Mercado Livre exige gênero junto com a tabela de medidas.' }];
      }
      // O tipo é da FAMÍLIA publicada, não da org (Codex r2 #1): org com roupa e calçado não pode
      // pôr numeração numa jaqueta — o chart de vestuário recusaria DEPOIS de SKU e ledger gravados.
      const tipo = familiaGrade
        ? tipoDaGrade(incluidas.map((v) => (v.tamanho ?? '').trim()))
        : null;
      if (familiaGrade && !tipo) {
        return [{ campo: 'familia_id', mensagem: 'Os tamanhos publicados deste produto não pertencem a um único tipo (roupa ou calçado) — ajuste pelo suporte.' }];
      }
      if (tipo && !ctx.tiposHabilitados.includes(tipo)) {
        return [{ campo: 'familia_id', mensagem: `O tipo ${tipo === 'roupa' ? 'Roupa' : 'Calçado'} está desativado nesta organização — peça ao administrador da plataforma para reativar.` }];
      }
      const tamanhosValidos = tipo ? tamanhosDoTipo(tipo) : [];
      const norm = (s: string | null | undefined) => (s ?? '').trim();
      const pares = new Set(ctx.vivas.map((v) => chaveGradeEdge(norm(v.cor), norm(v.tamanho))));
      entrada.forEach((v, i) => {
        const p = `variacoes[${i}]`;
        const tam = norm(v.tamanho);
        if (!familiaGrade) {
          if (tam) erros.push({ campo: `${p}.tamanho`, mensagem: 'Este produto não usa tamanho.' });
          if (v.fotoDeCodigo) erros.push({ campo: `${p}.imagemPath`, mensagem: 'Envie a foto da cor nova.' });
          return;
        }
        if (!tam) { erros.push({ campo: `${p}.tamanho`, mensagem: 'Tamanho é obrigatório neste produto.' }); return; }
        if (v.codigo !== undefined) { erros.push({ campo: `${p}.codigo`, mensagem: 'Em produto de grade o código é gerado pelo sistema.' }); return; }
        if (!tamanhosValidos.includes(tam)) { erros.push({ campo: `${p}.tamanho`, mensagem: `Tamanho "${tam}" não é válido para este produto.` }); return; }
        if (tipo === 'calcado' && !numeracaoPublicavel(tam, ctx.genero as 'masculino' | 'feminino' | 'unissex')) {
          erros.push({ campo: `${p}.tamanho`, mensagem: `Numeração ${tam} não tem guia de tamanhos no Mercado Livre para este gênero.` }); return;
        }
        const k = chaveGradeEdge(norm(v.nome), tam);
        if (pares.has(k)) { erros.push({ campo: `${p}.tamanho`, mensagem: `${norm(v.nome)} · ${tam} já existe neste produto.` }); return; }
        pares.add(k);
        if (v.fotoDeCodigo) {
          const irma = ctx.vivas.find((x) => x.codigo === normalizarCodigo8(v.fotoDeCodigo!));
          if (!irma || norm(irma.cor) !== norm(v.nome)) {
            erros.push({ campo: `${p}.imagemPath`, mensagem: 'A foto herdada precisa ser de um SKU da mesma cor.' });
          }
        }
      });
      return erros;
    }
    const chaveGradeEdge = (cor: string, tamanho: string) => `${cor}\u0000${tamanho}`;
    ```
  - `resolverFotoHerdada(fotoDeCodigo, cor, vivas)`: acha a viva com `codigo === normalizarCodigo8(fotoDeCodigo)` e `cor` igual (trim); devolve `{ imagemPath: irma.imagem_path, mlPictureId: irma.ml_picture_id }` se algum dos dois não for nulo; senão `null`.
  - `montarVariacaoNova(v: VariacaoNovaResolvida, ctx)`: `imagem_path: v.imagemPath`, `ml_picture_id: v.mlPictureId`, `tamanho: v.tamanho?.trim() || null` (substitui o `tamanho: null` e seu comentário por: "ADR-0166 2026-09-24c: tamanho do SKU novo de grade; null em produto sem eixo (INV-1). Continua presente sempre — paridade de chaves com clonarVariacao.").
  - Atualizar o comentário de `familiaTemTamanho` (a trava agora é só para família não-UP).

- [ ] **Step 5: Implementar `index.ts`** — ordem das etapas depois de carregar `variacoesVivas`:
  1. Remover o bloco `if (familiaTemTamanho(...)) return 400` (l.133–145) e calcular `const classe = classificarFamilia(variacoesVivas)`. **Consultas novas (passos 2 e 3) só quando `classe !== 'simples'`** (Codex r4 #2): o fluxo sem tamanho não ganha nenhuma consulta nem ponto de falha novo — `validarGrade` recebe `ehUP: false, tiposHabilitados: []` nesse ramo e não os lê. Teste (fake de admin que conta chamadas por tabela/RPC): família simples → nenhuma chamada a `anuncios_externos`, `anuncios_externos_itens` nem `tipos_produto_da_org`; body e resposta iguais aos de hoje.
  2. `ehUP` — **mesma detecção do worker** (`update-familia-ml/processar.ts:202-237`: raiz da partição 0 do produto + linhas filhas), nunca por SKU solto na org (Codex #4). Só quando a família tem tamanho (fora disso `ehUP: false`; `validarGrade` não o lê):
     ```ts
     const { data: raiz, error: raizErr } = await admin.from('anuncios_externos').select('id')
       .eq('org_id', orgId).eq('codigo_pai', codigoPai).eq('canal', 'mercado_livre').eq('particao', 0).maybeSingle();
     if (raizErr) return json({ error: `Falha verificando o anúncio: ${raizErr.message}` }, 500);
     let ehUP = false;
     if (raiz) {
       const { count, error: itErr } = await admin.from('anuncios_externos_itens')
         .select('sku', { count: 'exact', head: true }).eq('anuncio_externo_id', raiz.id);
       if (itErr) return json({ error: `Falha verificando o anúncio: ${itErr.message}` }, 500);
       ehUP = (count ?? 0) > 0;
     }
     ```
     Conferir o literal do canal usado em `update-familia-ml/processar.ts` (constante `CANAL`) e usar o mesmo.
     Extrair isto numa função `detectarUP(admin, orgId, codigoPai): Promise<boolean>` em `processar.ts` (lança em erro) para testar com fake: raiz ausente → false; raiz com 0 itens → false; raiz com itens → true; erro na consulta → lança; SKU igual em OUTRA raiz não conta (a consulta é por `anuncio_externo_id`).
  3. `tiposHabilitados = await tiposProdutoDaOrg(admin, orgId)` (import de `../_shared/produto/tipo-produto.ts`, o mesmo de `cadastrar-produto/index.ts:26` — conferir o nome exato).
  4. `const errosGrade = validarGrade(variacoesEntrada, { vivas, tiposHabilitados, genero: anterior.genero ?? null, ehUP }); if (errosGrade.length) return json({ erros: errosGrade }, 400);`
  5. Teto: `if ((variacoesVivas?.length ?? 0) + variacoesEntrada.length > 60) return json({ error: 'Passaria do limite de 60 variações por produto.' }, 400);`
  6. Códigos: se a família é de grade, reservar `variacoesEntrada.length` com `proximo_codigo_produto` + `derivarCodigosSku`, conferir com `codigosJaUsados` e ressincronizar UMA vez com `p_resync: true` — cópia do bloco de `cadastrar-produto/index.ts:175-200` trocando `derivarCodigos(..., qtd)` por `derivarCodigosSku(..., n)` e sem PAI na conferência. Senão, `codigosNovos` continua vindo de `normalizarCodigo8(v.codigo)` + o `codigosJaUsados` que já existe (409 com `conflitos`).
     Resultado: `const codigosNovos: string[]` alinhado por índice com `variacoesEntrada`. **A reserva acontece depois do bloco de idempotência** (`jaExistente`) — que já está antes, não mover.
  7. Fotos: `const fotos = variacoesEntrada.map((v) => v.fotoDeCodigo ? resolverFotoHerdada(v.fotoDeCodigo, v.nome, vivasComFoto) : { imagemPath: v.imagemPath!, mlPictureId: null });` onde `vivasComFoto` vem do `select('*')` que já existe. Qualquer `null` → 400 `{ erros: [{ campo: 'variacoes[i].imagemPath', mensagem: 'O SKU de origem da foto não tem foto — envie uma.' }] }`.
  8. `montarVariacaoNova({ ...v, codigo: codigosNovos[i], imagemPath: fotos[i].imagemPath, mlPictureId: fotos[i].mlPictureId }, ...)`.
  9. Ledger: `aplicarEstoqueInicial(...)` (ver 10b) com `codigosNovos[i]` em vez de `normalizarCodigo8(v.codigo)!`.
  10. Resposta: acrescentar `codigos: codigosNovos`; no ramo `jaExistia`, ler `mudanca_estrutural` da família (`select('id, lote_id, status, mudanca_estrutural')`) e devolver `codigos: (mudanca_estrutural?.novas ?? [])`.
  10b. Ledger no retry (Codex #3 e r2 #2). A intenção original fica **gravada**, e o retry confere contra ela em vez de confiar no body novo:
     - Na criação, `mudanca_estrutural = { novas: codigosNovos, removidas: [], intencao: variacoesEntrada.map((v, i) => ({ codigo: codigosNovos[i], ...normalizarIntencao(v) })) }`, com
       ```ts
       /** Todo campo MATERIAL da submissão, normalizado (Codex r3 #2) — o retry compara TUDO, não uma amostra. */
       export function normalizarIntencao(v: VariacaoNovaEntrada) {
         return {
           nome: v.nome.trim(), tamanho: v.tamanho?.trim() || null, gtin: v.gtin?.trim() || null,
           preco: v.preco, custo: v.custo ?? null, estoqueInicial: v.estoqueInicial,
           pesoGramas: v.pesoGramas ?? null, alturaCm: v.alturaCm ?? null,
           larguraCm: v.larguraCm ?? null, comprimentoCm: v.comprimentoCm ?? null,
           imagemPath: v.imagemPath ?? null, fotoDeCodigo: v.fotoDeCodigo ? normalizarCodigo8(v.fotoDeCodigo) : null,
           codigoDigitado: v.codigo !== undefined ? normalizarCodigo8(v.codigo) : null,
         };
       }
       ```
       (`mudanca_estrutural` é jsonb; o único consumidor, `src/components/familia-row.tsx`, lê só `novas`/`removidas` — conferir antes. `imagemPath` do retry legítimo é o mesmo: o front reusa a `chave` e o path é derivado dela + `clientId` + nome do arquivo.)
     - No ramo `jaExistia` (selecionar também `mudanca_estrutural`), em ordem:
       1. sem `intencao` (família criada por versão anterior da edge) → comportamento de hoje, `falhasEstoque: []`;
       2. `variacoes` da família com `codigo in intencao.codigo` em número menor que `intencao.length` → **409** `'Solicitação em andamento. Tente novamente.'` (retry caiu entre o insert da família e o das variações — `index.ts:209-245`);
       3. body divergente da intenção — comprimento diferente, ou para algum `i` `normalizarIntencao(body[i])` diferente (comparação campo a campo, `codigo` à parte) de `intencao[i]` — → **409** `'Esta solicitação difere da original. Recarregue a tela e confira o produto antes de reenviar.'`;
       4. senão: `aplicarEstoqueInicial` com as quantidades **da intenção** (não do body), mesma `p_ref: \`addvar:${familiaId}:${codigo}\`` (no-op se já aplicou), e devolver as falhas reais em `falhasEstoque`; só então o re-encadeamento de publicação que já existe.
     - Extrair a decisão dos passos 1–3 para `decidirRetry(intencao, body, codigosPersistidos): { tipo: 'legado' } | { tipo: 'incompleto' } | { tipo: 'divergente' } | { tipo: 'reaplicar'; itens: ... }` (pura) e testar os 4 ramos, incluindo `divergente` para CADA campo de `normalizarIntencao` alterado isoladamente (`it.each` sobre as chaves) e `reaplicar` para body idêntico com espaços extras no nome (normalização).
     **Não** muda a regra do ADR-0129 de publicar mesmo com falha de estoque (decisão registrada; o operador vê `falhasEstoque` e corrige por "Dar entrada").
     Extrair o laço de ledger para `aplicarEstoqueInicial(admin, { orgId, familiaId, userId, itens: Array<{ codigo: string; qtd: number; custo: number | null }> }): Promise<string[]>` em `processar.ts` e usá-lo nos dois ramos. Teste: fake de `admin.rpc` que falha para um código → a função devolve `['<codigo>: <mensagem>']`; chamada duas vezes com a mesma entrada usa o mesmo `p_ref`.
  11. `mudanca_estrutural` com `novas`, `removidas` e `intencao` (ver 10b).

- [ ] **Step 6: Rodar** — `pnpm test supabase/functions/adicionar-variacoes-familia supabase/functions/_shared/produto` → PASS; `pnpm lint:functions && pnpm check:functions` → PASS.

- [ ] **Step 7: Commit** — `feat(addvar): adicionar SKUs a grade publicada (UP) com codigo gerado e foto herdada`

---

### Task 6: `GeradorVariacoes` com eixos fixos e `MatrizGrade` com células travadas (sonnet)

**Files:**
- Modify: `src/components/estoque/gerador-variacoes.tsx`
- Modify: `src/components/estoque/matriz-grade.tsx`
- Test: `src/components/estoque/__tests__/gerador-variacoes*.test.tsx`, `src/components/estoque/__tests__/matriz-grade*.test.tsx` (existentes)

**Interfaces:**
- Produces:
  - `GeradorVariacoes` props novas opcionais: `coresFixas?: ReadonlySet<string>`, `tamanhosFixos?: ReadonlySet<string>` — valor fixo aparece marcado e desabilitado (não dá para desmarcar); cor fixa fora de `CORES_POPULARES` aparece como personalizada sem o botão de remover.
  - `MatrizGrade` prop nova opcional: `bloqueadas?: ReadonlyMap<string /* chaveGrade(cor, tamanho) */, { estoque: number }>`.

- [ ] **Step 1: Testes (falham)**
  - Gerador: com `coresFixas={new Set(['Preto'])}` e `cores` contendo 'Preto', o checkbox `Preto` está `checked` e `disabled`; clicar nele não chama `onMudarCores`. Idem tamanho `M`. Sem as props, comportamento atual (testes antigos passam sem mudança).
  - Matriz: `cores=['Preto','Verde']`, `tamanhos=['P','M']`, `linhas` só com Verde·P e Verde·M, `bloqueadas=new Map([[chaveGrade('Preto','P'),{estoque:12}],[chaveGrade('Preto','M'),{estoque:8}]])`:
    - as células Preto·P/Preto·M mostram `12`/`8`, não têm `<input>` e têm `aria-label` contendo "já publicado";
    - não aparecem com o botão "+" de reinclusão;
    - as células Verde têm input normal;
    - o total por coluna/linha/geral considera só as linhas novas (totais vêm de `resolvidas`, que não contém as travadas).

- [ ] **Step 2: Rodar** — FAIL.

- [ ] **Step 3: Implementar**
  - Gerador: `const fixa = coresFixas?.has(cor) ?? false;` → `<Checkbox checked={cores.has(cor)} disabled={desabilitado || fixa || bloqueada} …>`; `title` "Já publicada neste produto." quando `fixa`. Personalizadas: esconder o botão de remover (`X`) quando fixa. Tamanhos: mesma regra com `tamanhosFixos`.
  - Matriz: no render da célula, **antes** do ramo "sem linha / removida":
    ```tsx
    const trava = bloqueadas?.get(chave);
    if (trava) {
      return (
        <td key={chave} className="bg-muted/50 px-2 text-right tabular-nums text-muted-foreground"
            aria-label={`${cor} · ${tamanho}: já publicado, ${trava.estoque} em estoque`}>
          {modo === 'estoqueInicial' ? trava.estoque : '—'}
        </td>
      );
    }
    ```
    Adaptar ao elemento real que a matriz usa por célula (`td`/`div` — seguir o existente), mantendo `data-r`/`data-c` **fora** da célula travada (a navegação por teclado pula ela; conferir que `focarCelula` num alvo inexistente é no-op, como já documentado).

- [ ] **Step 4: Rodar** — `pnpm test src/components/estoque` → PASS (incluindo os testes antigos de `dialog-cadastro-grade`).

- [ ] **Step 5: Commit** — `feat(grade): eixos fixos no gerador e celulas travadas na matriz`

---

### Task 7: `DialogEstenderGrade` + roteamento de "Adicionar variação" (sonnet)

**Files:**
- Create: `src/lib/estender-grade.ts` (miolo puro)
- Create: `src/lib/__tests__/estender-grade.test.ts`
- Create: `src/components/estoque/dialog-estender-grade.tsx`
- Create: `src/components/estoque/__tests__/dialog-estender-grade.test.tsx`
- Create: `src/components/estoque/dialog-adicionar-variacao-roteador.tsx`
- Modify: `src/pages/Estoque.tsx:265-269` (usar o roteador)
- Test: `src/pages/__tests__/Estoque*.test.tsx` (existente)

**Interfaces:**
- Consumes: Task 5 (contrato do body/resposta), Task 6 (props `coresFixas`/`tamanhosFixos`/`bloqueadas`), Task 2 (`VariacaoComSaldo.tamanho`).
- Produces:
  ```ts
  // src/lib/estender-grade.ts
  export interface SkuExistente { codigo: string; cor: string; tamanho: string; estoque: number; temFoto: boolean }
  export function eixosExistentes(skus: SkuExistente[]): { cores: Set<string>; tamanhos: Set<string> };
  export function bloqueadasDe(skus: SkuExistente[]): Map<string, { estoque: number }>;
  /** SKU vivo da mesma cor cuja foto o SKU novo herda; null = cor nova (ou cor sem nenhuma foto). */
  export function fotoHerdavel(cor: string, skus: SkuExistente[]): string | null; // devolve o código
  export function payloadEstender(resolvidas: LinhaResolvida[], skus: SkuExistente[], imagemPorClientId: Map<string, string>): VariacaoGradePayload[];
  ```
  onde `VariacaoGradePayload` é o `VariacaoNovaEntrada` da Task 5 sem `codigo`.

- [ ] **Step 1: Testes do miolo (falham)**
```ts
import { describe, it, expect } from 'vitest';
import { chaveGrade } from '@/lib/cadastro-grade';
import { eixosExistentes, bloqueadasDe, fotoHerdavel, payloadEstender } from '@/lib/estender-grade';

const skus = [
  { codigo: '00000001', cor: 'Preto', tamanho: 'P', estoque: 12, temFoto: true },
  { codigo: '00000002', cor: 'Preto', tamanho: 'M', estoque: 8, temFoto: true },
  { codigo: '00000003', cor: 'Azul', tamanho: 'P', estoque: 0, temFoto: false },
];

it('eixos e bloqueadas vêm dos SKUs vivos', () => {
  expect([...eixosExistentes(skus).cores]).toEqual(['Preto', 'Azul']);
  expect(bloqueadasDe(skus).get(chaveGrade('Preto', 'M'))).toEqual({ estoque: 8 });
});

it('foto herdável: menor código COM foto da mesma cor; cor sem foto ou nova → null', () => {
  expect(fotoHerdavel('Preto', skus)).toBe('00000001');
  expect(fotoHerdavel('Azul', skus)).toBeNull();
  expect(fotoHerdavel('Verde', skus)).toBeNull();
});

it('payload: herda foto quando a linha não tem foto própria e a cor tem foto; senão usa o upload', () => {
  const base = { preco: '10', custo: '', pesoGramas: '', alturaCm: '', larguraCm: '', comprimentoCm: '', gtin: '', estoqueInicial: '3' };
  const r = payloadEstender([
    { clientId: 'a', cor: 'Preto', tamanho: 'G', foto: null, ...base },
    { clientId: 'b', cor: 'Verde', tamanho: 'P', foto: new File(['x'], 'v.jpg'), ...base },
  ] as never, skus, new Map([['b', 'u1/chave/v.jpg']]));
  expect(r[0]).toMatchObject({ nome: 'Preto', tamanho: 'G', fotoDeCodigo: '00000001', estoqueInicial: 3, preco: 10 });
  expect(r[0]).not.toHaveProperty('imagemPath');
  expect(r[1]).toMatchObject({ nome: 'Verde', tamanho: 'P', imagemPath: 'u1/chave/v.jpg' });
  expect(r[1]).not.toHaveProperty('fotoDeCodigo');
  expect(r.every((v) => !('codigo' in v))).toBe(true);
});
```

- [ ] **Step 2: Rodar** — FAIL.

- [ ] **Step 3: Implementar `estender-grade.ts`** — conversão numérica com `parseNumeroPtBr` (mesma de `cadastro-grade.ts`); `custo`/dimensões vazios → `null`; `gtin` vazio → `null`; linha com `foto` (File) usa `imagemPorClientId.get(clientId)`; linha sem foto usa `fotoHerdavel(cor, skus)` (se `null`, a linha não é válida — o gate do dialog impede salvar, ver Step 5).

- [ ] **Step 4: Testes do dialog (falham)** — com `supabase` mockado como nos testes de `dialog-adicionar-variacao`:
  1. abre com a matriz mostrando Preto·P (12) e Preto·M (8) travadas; checkbox Preto fixo;
  2. marcar tamanho `G` cria células Preto·G e Azul·G editáveis; marcar cor Verde cria Verde·P/M/G;
  3. "Salvar" desabilitado enquanto alguma célula nova tem estoque vazio/0, ou é de cor sem foto herdável (Verde, Azul) sem foto enviada;
  4. salvar chama `functions.invoke('adicionar-variacoes-familia', { body: { familia_id, chave, variacoes } })` com o payload da Task 5 (sem `codigo`), e marca `QK.variacoesRecemAdicionadas(codigoPai)` com `data.codigos`;
  5. erro 400 da edge com `erros` mostra a mensagem no toast (usar `corpoDoErroDaEdge` como o dialog atual);
  6. total existentes + novas > 60 bloqueia com mensagem.

- [ ] **Step 5: Implementar `dialog-estender-grade.tsx`** — composição, sem reinventar peças:
  - Dados — **duas** famílias, como a edge (Codex #5):
    - `familia_id` enviado à edge = a canônica (mais recente, `criado_em desc`), igual ao dialog atual (a edge resolve a publicada sozinha).
    - SKUs travados = os da **última família publicada**, com a MESMA resolução da edge (`adicionar-variacoes-familia/index.ts:115-128`): 
      ```ts
      supabase.from('familias')
        .select('id, genero, variacoes(codigo, cor, tamanho, estoque, imagem_path, ml_picture_id, peso_gramas, altura_cm, largura_cm, comprimento_cm, custo, preco, excluida_da_publicacao)')
        .eq('codigo_pai', produto.codigoPai).not('ml_item_id', 'is', null)
        .order('publicado_em', { ascending: false, nullsFirst: false }).limit(1)
      ```
      Uma combinação que só existe numa tentativa de UPDATE que falhou (família mais nova, não publicada) **não** fica travada: aparece como célula nova normal, e a edge a valida contra a publicada. Teste: publicada tem Preto·P; canônica (erro) tem Preto·P + Preto·M → só Preto·P travada, Preto·M editável.
    - Estoque exibido nas travadas vem de `fetchVariacoesProduto` (QK `variacoesEstoque`, saldo canônico) casado por código; se não carregou, usar o da consulta.
  - Classificação: `classificarFamilia` (a MESMA da edge) sobre as variações da família publicada. Com `tem_tamanho` do resumo também calculado sobre a publicada (Task 1), roteador, dialog e edge olham a mesma família; o fallback abaixo cobre só a janela entre o resumo em cache e uma publicação nova. Teste do roteador: canônica simples + publicada grade → resumo `temTamanho: true` → abre o dialog de grade (Codex r5 #1). `'simples'` (o resumo pode divergir da publicada — ex.: tamanho só num SKU excluído de uma tentativa mais nova) → o dialog chama a prop `onNaoEhGrade()` e o roteador abre o `DialogAdicionarVariacao` antigo no lugar (Codex r4 #1 — o fluxo antigo nunca fica inacessível). `'mista'` → aviso de bloqueio. Teste: publicada com incluído sem tamanho + excluído com tamanho e resumo `temTamanho: true` → o dialog antigo abre.
  - `skus: SkuExistente[]` = **todas** as variações da família publicada com `tamanho`, incluídas e excluídas (Codex r3 #1); `SkuExistente` ganha `excluida: boolean`. Excluídas ficam travadas também (a edge recusa o par), com rótulo "fora do anúncio" no `aria-label`/título da célula e sem contar como foto herdável. Tipo inferido só das incluídas; incluídas misturando tamanho e ausência → mesmo aviso de bloqueio da edge ("SKUs publicados com e sem tamanho — fale com o suporte"). `temFoto = !!(imagem_path || ml_picture_id)`.
  - Estado: `cores`/`tamanhos` (Set) iniciados com `eixosExistentes(skus.filter((s) => !s.excluida))` — eixos só das **incluídas** (Codex r6 #2: `Azul·38` excluído numa roupa não pode trazer a coluna `38`, que geraria `Preto·38` editável e recusado pela edge). `bloqueadas` continua com todos os SKUs (incluídos e excluídos): a matriz só desenha as células dos eixos atuais, então uma excluída só aparece travada se os eixos dela estiverem na grade. Teste: roupa com `Preto·P` incluído e `Azul·38` excluído → nenhuma coluna `38`, nenhuma linha `Azul`, nenhuma célula nova com `38`; `removidas`; `linhas: LinhaGrade[]`; `cabecalho: CamposHerdaveis` pré-preenchido pelo SKU de referência (menor código entre os não `excluida_da_publicacao`, mesma regra de `irmaRef` no dialog atual); `fotoPorCor` (só para cores sem foto herdável); `chave` (UUID, regenerada ao fechar).
  - Tipo da grade = `tipoDaGrade(skus.filter((s) => !s.excluida).map((s) => s.tamanho))` — **só incluídas** (Codex r5 #2; excluídas ficam travadas mas não decidem o tipo; teste: roupa com numeração só num SKU excluído → matriz liberada com P/M/G/GG) (reexportado de `@/lib/tamanhos`); os tamanhos oferecidos são **só** os desse tipo (`opcoesDeTamanho([tipo])`), nunca a união dos tipos da org (Codex r2 #1). Estados de bloqueio, antes de qualquer upload e com o botão Salvar desabilitado:
    - `useTiposProdutoHabilitados()` ainda `undefined` e sem erro → skeleton "Carregando…";
    - erro do hook → aviso "Não foi possível confirmar os tipos de produto da organização. Tente de novo." (não assume nada);
    - `tipo === null` (tamanhos mistos/desconhecidos) → aviso "Os tamanhos publicados deste produto não pertencem a um único tipo — fale com o suporte.";
    - `tipo` fora dos tipos habilitados → aviso "O tipo {Roupa|Calçado} está desativado nesta organização — peça ao administrador da plataforma para reativar." (mesma regra da edge; a matriz aparece só para leitura).
    Testes: org com roupa+calçado e jaqueta publicada → nenhum chip de numeração; tipo desligado → aviso e Salvar desabilitado; hook com erro → aviso.
  - Reconciliação: sempre que `cores`/`tamanhos`/`removidas` mudam, `reconciliarGrade(eixos.cores, eixos.tamanhos, removidas, [...linhas, ...skus.map(s => ({ cor: s.cor, tamanho: s.tamanho }))])` — as travadas entram como "já existentes", então nunca aparecem em `novas`; aplicar `novas` com `novaLinhaGrade` e `remover` filtrando `linhas` (nunca as travadas, que não estão em `linhas`). Mesmo padrão de `mudarCores`/`mudarTamanhos` de `dialog-cadastro-grade.tsx` (usar `ordenarEixos` com `tamanhos: opcoesDeTamanho(tipos).flatMap(g => g.valores)`).
  - UI, em ordem: cabeçalho com nome do produto e gênero (só leitura); campos herdáveis (copiar o `campoHerdavel` de `dialog-cadastro-grade.tsx:423-455`); `<GeradorVariacoes coresFixas tamanhosFixos … />` com `coresBloqueadas`/`tamanhosBloqueados`/`bloquearNovaCor` calculados com `totalDaGrade(...)` **direto** contra 60 — o cartesiano já inclui as células travadas, somar `skus.length` contaria duas vezes (Codex #7). Teste: 30 publicadas (6 cores × 5 tamanhos) + 1 cor nova = 36 → permitido; 12 × 5 = 60 → cor nova bloqueada;
  - Numeração sem guia de tamanhos (Codex #9): neste fluxo o UPDATE vai direto ao ML, então tamanho com `numeracaoPublicavel(t, genero) === false` entra em `tamanhosBloqueados` (não é só aviso, como no cadastro); o gerador mostra o motivo via `avisoTamanho` ("não publica no Mercado Livre para este gênero"). Teste: calçado feminino com `45` bloqueado; masculino com `45` liberado (conferir os valores reais em `COMPRIMENTO_PE_CM` antes de fixar o teste). "Foto por cor" só para cores da grade **sem** `fotoHerdavel` (texto: "Cores novas precisam de foto. Tamanhos novos de cores já publicadas usam a foto da cor."); `<MatrizGrade bloqueadas={bloqueadasDe(skusComSaldoCanonico)} … />` com os mesmos handlers de `dialog-cadastro-grade.tsx` (`patchLinha`, `patchOverride`, `destravar`, `voltarAHerdar`, `removerLinha`, `reincluirLinha`, `aplicarMassa`); banner de "atualização em andamento" (`familiaEmVoo`, igual ao dialog atual).
  - Gate `podeSalvar`: `linhas.length > 0` && `!emVoo` && toda resolvida com `estoqueInicial` inteiro > 0 && `CAMPOS_NUMERICOS` sem erro (`erroCampo`) && toda linha tem foto própria **ou** `fotoPorCor[cor]` **ou** `fotoHerdavel(cor, skus)`.
  - Salvar: `canWrite()`; `effectiveOrgId()`; para cada linha cuja foto efetiva é um `File` (própria ou `fotoPorCor`), `uploadFile('imagens', buildStoragePath(owner, chave, \`${clientId}-${file.name}\`), file)` (mesmo `owner` do dialog atual via `storageOwnerForUpload`); `payloadEstender(...)`; `supabase.functions.invoke('adicionar-variacoes-familia', …)`; invalidações iguais às do dialog atual (`familiasNaoPublicadas`, `produtosEstoqueResumo`, `variacoesEstoque(codigoPai)`) e `setQueryData(QK.variacoesRecemAdicionadas(codigoPai), r.codigos)`; toasts iguais (sucesso, `publicacaoOk=false`, `falhasEstoque`).
  - Título: "Adicionar à grade"; descrição: "{nome}. Os SKUs novos vão direto para o Mercado Livre, sem passar pela Revisão. Os já publicados não mudam."; `DialogContent className="max-h-[90vh] sm:max-w-5xl overflow-y-auto"` (o `sm:` é obrigatório — ver comentário em `dialog-cadastro-grade.tsx`).

- [ ] **Step 6: Roteador** — `dialog-adicionar-variacao-roteador.tsx`:
```tsx
// ADR-0166 2026-09-24c: "Adicionar variação" em produto de grade abre a extensão da matriz; o
// resto abre o dialog de sempre, na hora, sem consulta nova (INV-1, Codex r2 #6). Decide pelo DADO
// do produto (`temTamanho`, vindo do resumo — Task 1/2), não pelo tipo habilitado na org (Codex #8).
export function DialogAdicionarVariacaoRoteador({ produto, onFechar }: {
  produto: ProdutoEstoqueResumo | null; onFechar: () => void;
}) {
  // A palavra final é do dialog de grade, que lê a família PUBLICADA com a mesma
  // `classificarFamilia` da edge; se ela disser 'simples', cai para o fluxo antigo (Codex r4 #1).
  const [forcarSimples, setForcarSimples] = useState(false);
  useEffect(() => { setForcarSimples(false); }, [produto?.codigoPai]);
  const ehGrade = !!produto?.temTamanho && !forcarSimples;
  return (
    <>
      <DialogEstenderGrade produto={ehGrade ? produto : null} aberto={produto != null && ehGrade}
        onFechar={onFechar} onNaoEhGrade={() => setForcarSimples(true)} />
      <DialogAdicionarVariacao produto={ehGrade ? null : produto} aberto={produto != null && !ehGrade} onFechar={onFechar} />
    </>
  );
}
```
  Em `Estoque.tsx`, trocar `<DialogAdicionarVariacao produto=… aberto=… onFechar=… />` por `<DialogAdicionarVariacaoRoteador produto={produtoAddVariacao} onFechar={() => setProdutoAddVariacao(null)} />`.
  Testes do roteador: (a) `temTamanho: false` → `DialogAdicionarVariacao` aberto na hora (título "Adicionar variação", campo Código presente — igual ao de hoje) e nenhuma chamada extra a `variacoes_estoque_produto`; (b) `temTamanho: true` → `DialogEstenderGrade`, **mesmo com `tipos_produto_da_org` = `[]`** (o dialog é que mostra o aviso de tipo desativado); (c) `produto = null` → nenhum dialog aberto.
  INV-1 do fluxo antigo (Codex #12): o teste existente de `dialog-adicionar-variacao` que monta o body enviado à edge tem que continuar passando sem alteração — se não houver um que compare o body inteiro, acrescentar um `toEqual` do body completo antes de mexer em `Estoque.tsx`.

- [ ] **Step 7: Rodar** — `pnpm test src/lib src/components/estoque src/pages` → PASS; `pnpm exec tsc -b --force` → PASS.

- [ ] **Step 8: Commit** — `feat(estoque): adicionar a grade publicada pela matriz (DialogEstenderGrade)`

---

### Task 8: Verificação ponta a ponta (loop principal)

- [ ] **Step 1:** `pnpm preflight` (3–4 min) → verde. Falha fora do diff → provar em `origin/main` antes de chamar de pré-existente.
- [ ] **Step 2 — dry-run no ML (sem escrita nenhuma):** script em `$CLAUDE_JOB_DIR/tmp/validar-sku-grade.ts` que, para uma família de grade publicada da org piloto (SQL read-only: `variacoes.tamanho` não nulo + linhas em `anuncios_externos_itens`), monta o payload de um SKU hipotético (cor existente × tamanho ainda não usado) com o caminho de `criarPlano`: `atributosDeFicha` do `GET /items/{irmão}` + chart lido **direto da tabela `ml_size_charts`** por SELECT (nunca `garantirChart`, que em cache miss faz `POST /catalog/charts` e INSERT — Codex #11; se o tamanho não estiver no cache, parar e reportar) + `montarPayloadItem`; envia **só** `POST /items/validate`. Expected: sem erros de `fashion_grid`/`GENDER`. Nunca `POST /items`, nunca PUT.
- [ ] **Step 2b — prova real do critério da spec (depende do Diego):** o `/items/validate` não prova `family_id` igual nem irmãs intocadas. Depois do deploy (Task 9), o Diego adiciona **um** SKU real pela tela nova a um produto de grade escolhido por ele. Eu leio, antes e depois, `GET /items/{id}` de 2 irmãs (preço, `attributes`, `family_id`) e do SKU novo (`SIZE`, `SIZE_GRID_ID`, `SIZE_GRID_ROW_ID`, `GENDER`, `COLOR`, `family_id`), e registro o diff no relatório. Só leitura da minha parte — nenhuma escrita direta no ML fora do fluxo do app.
- [ ] **Step 3 — UI em runtime real (Playwright próprio, conta VALIDATION, skill `playwright-cli`):** dados de grade injetados via `route` no PostgREST (a conta de validação não tem os produtos do Diego — ver memória "Validar UI com dados injetados"); screenshots de: linha expandida com `Preto · M`; Entrada com a opção `código · Preto · M`; Movimentos com rótulo; dialog "Adicionar à grade" com células travadas e novas. Não submeter.
- [ ] **Step 4:** revisão do Codex (modelo mais forte, `--effort high`, `< /dev/null`) sobre o diff completo da branch; tratar achados.

### Task 9: Documentação, deploy e merge (loop principal)

- [ ] **Step 1:** atualizar `docs/project-status.md` e `docs/TASKS.md` (item de grade no Estoque), `docs/reference/edge-functions.md` (contrato novo de `adicionar-variacoes-familia`), obsidian-vault `03-Módulos/Estoque.md`; `pnpm docs:links`.
- [ ] **Step 2:** push da branch → CI verde (`frontend`, `backend-lint`).
- [ ] **Step 3:** `supabase db push` → conferir as **três** RPCs (Codex r3 #5) por SQL read-only sob `set local role authenticated` + `request.jwt.claims` de um usuário da org piloto: `variacoes_estoque_produto`/`skus_estoque_org` com a chave `tamanho` (não nula num produto de grade), e `produtos_estoque_resumo` com `tem_tamanho = true` num produto de grade e `false` num produto sem tamanho. Repetir a medição do `SELECT` interno do resumo (Task 1, "Índice") e comparar com a de antes do push; registrar os dois tempos e o nó do índice no relatório.
- [ ] **Step 4:** deploy de toda função que importa, direta ou transitivamente, um arquivo alterado em `_shared/` — listar com `grep -rl "fluxo-add-variacao\|atualizar-familia-up\|tipos-produto-valores\|produto/codigos" supabase/functions --include=*.ts | grep -v __tests__` e subir até o `index.ts` de cada função. Mínimo esperado: `adicionar-variacoes-familia`, `update-familia-ml`, `reconciliar-convergencia-up`, **`publicar-split-ml`** (importa `ehFluxoAddVariacao`, Codex r3 #4), `cadastrar-produto` (importa `tipos-produto-valores`/`codigos`). Conferir a versão ativa de cada uma com `supabase functions list`.
- [ ] **Step 5:** merge fast-forward na `main` (`/usr/bin/git push origin <sha>:main`). A tela nova só existe para o Diego depois do merge (o front sobe da `main`), então a prova real (Task 8 Step 2b) vem **depois** — e isso fica declarado (Codex r2 #7):
  - relatório final separa **entrega técnica** (CI, preflight, dry-run, deploy conferido) de **aceite real pendente** (Step 2b) — nunca "concluído" sem as duas;
  - se o 2b mostrar irmã alterada, `family_id` divergente ou SIZE/GENDER errado: reverter só o commit do roteador (Task 7, `Estoque.tsx` volta a abrir o dialog antigo, que continua recusando grade na UI) com o mesmo ciclo branch → CI → ff, e abrir o incidente antes de qualquer nova tentativa. As mudanças de edge (Tasks 4–5) são compatíveis com o fluxo antigo e ficam.
- [ ] **Step 6:** depois do 2b aprovado: apagar a branch, remover a worktree (`rm -rf` + `git worktree prune`).
