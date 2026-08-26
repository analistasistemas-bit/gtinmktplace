# Cadastro Fiscal + Faturador do ML — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastro fiscal completo de empresa (org) e produto (família), push dos dados por SKU para a API `fiscal_information` do ML, e semáforo `can_invoice` — a emissão fica com o Faturador do ML.

**Architecture:** Fiscal por família / push por SKU; obrigatoriedade nasce no gate de ativação do módulo `fiscal` (constraint no banco impede PF); worker QStash idempotente empurra e lê prontidão; UI reusa o dialog de cadastro (etapa fiscal + modo edição em fila).

**Tech Stack:** Supabase (Postgres/RLS/Edge Functions Deno), QStash, React + react-query + PostgREST, OpenRouter (sugestão de NCM), vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-cadastro-fiscal-faturador-ml-design.md` (ADR-0135; supersede parcialmente o ADR-0114).

## Global Constraints

- Migrations **só** via `supabase migration new` + `supabase db push` (ADR-0043). O worktree **não vem linkado**: rodar `supabase link --project-ref txvncrgkoynoxwopfkbp` antes do primeiro push. `db push` não é transacional → todo DDL re-run-safe (`if not exists` / `drop ... if exists` antes de `create policy`).
- **GRANT além da policy** — sem grant a policy é letra morta ("permission denied").
- Parâmetro fiscal **nunca** defaulta em silêncio: falha LOUD nomeando campo e família/org (regra inviolável; incidente ORIGEM 2026-07-14).
- Org **sem** o módulo `fiscal`: **zero mudança de comportamento** (AVIL e orgs PF publicam como hoje; planilha atual passa intacta).
- Copy da UI em pt-BR com acentuação correta.
- Gate por task: `pnpm lint` + `pnpm test` verdes. Gate final: + `npx tsc -b --force` + `pnpm check:functions` + `pnpm build`.
- `src/lib/database.types.ts` está **desatualizado** (faltam `chave_cadastro`, `titulo_descartes`, `catalogo_categoria_sugerida_*`): a Task 1 o regenera; commits desse arquivo carregam junto as colunas atrasadas — esperado, não reverter.
- Mudança em `supabase/functions/_shared/**` → redeploy de **todas** as funções afetadas (checklist na Task 15).
- Testes de edge functions são **vitest** (não Deno test), em `supabase/functions/**/__tests__/*.test.ts`, com deps injetadas.
- `verificarAssinatura`/QStash: workers novos seguem a casca de `sincronizar-estoque/index.ts` byte a byte na estrutura.

**Decisões de execução registradas** (divergências pequenas da letra da spec, mantendo a intenção — comunicadas ao Diego no handoff):
1. Spec §6.2 pedia etapas "dados / fiscal / variações". O dialog atual junta dados+variações numa etapa e a etapa 2 é a tela de fotos pós-save. Implementamos: **etapa 1 = dados+variações (como hoje), etapa 2 = fiscal (nova, só com módulo), etapa 3 = fotos**. Sem módulo: idêntico a hoje ("etapa 1 de 2").
2. Spec §4 pedia `can_invoice` na "reconciliação horária existente". O cron horário real (`reconciliar-faturamento`) tem orçamento de 120s já apertado. O worker de status de anúncio é `monitorar-moderados` (6/6h) — o passo de `can_invoice` entra **lá**, e o push fiscal atualiza o semáforo na hora, então a defasagem de 6h só afeta mudanças feitas por fora, no painel do ML.
3. "Modo edição" do produto = **edição dos campos fiscais** (dialog dedicado), conforme o Diego pediu ("habilitando somente os campos obrigatórios").

---

### Task 1: Migration + types + prova da constraint

**Files:**
- Create: `supabase/migrations/<timestamp>_adr135_cadastro_fiscal.sql` (via `supabase migration new adr135_cadastro_fiscal`)
- Create: `scripts/verificar-constraint-fiscal.ts`
- Create: `supabase/functions/_shared/fiscal/__tests__/schema.test.ts`
- Modify: `src/lib/database.types.ts` (regenerado)

**Interfaces:**
- Produces: tabelas/colunas — `organizations.tipo_pessoa`, constraint `organizations_fiscal_exige_pj`, tabela `empresa_fiscal`, colunas fiscais em `familias` (`ncm, cest, origem_nfe, fci, ex_tipi, tributacao_icms, tributacao_icms_regime, can_invoice, can_invoice_causa, can_invoice_em, fiscal_sincronizado_em`).

- [ ] **Step 1: Criar a migration**

Rodar `supabase migration new adr135_cadastro_fiscal` e preencher o arquivo gerado com:

```sql
-- ADR-0135 — Cadastro fiscal e emissão via Faturador do ML.
-- Re-run-safe: db push não é transacional.

-- 1) tipo_pessoa na org. Default 'pf' é o default SEGURO (PF não emite).
alter table public.organizations
  add column if not exists tipo_pessoa text not null default 'pf';
alter table public.organizations drop constraint if exists organizations_tipo_pessoa_check;
alter table public.organizations add constraint organizations_tipo_pessoa_check
  check (tipo_pessoa in ('pf','pj'));
-- PF jamais liga o módulo fiscal — trava no BANCO, não só na UI (ADR-0135 D-2).
alter table public.organizations drop constraint if exists organizations_fiscal_exige_pj;
alter table public.organizations add constraint organizations_fiscal_exige_pj
  check (not ('fiscal' = any(modulos_habilitados)) or tipo_pessoa = 'pj');

-- 2) empresa_fiscal: 1 por org. Tudo nullable — a obrigatoriedade é do gate de
--    ativação do módulo (edge `usuarios`), não do INSERT (spec §2.2).
create table if not exists public.empresa_fiscal (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  cnpj text,
  razao_social text,
  nome_fantasia text,
  inscricao_estadual text,
  regime_tributario text check (regime_tributario is null or regime_tributario in ('simples','normal')),
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  municipio text,
  municipio_ibge text check (municipio_ibge is null or municipio_ibge ~ '^[0-9]{7}$'),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  natureza_operacao text,
  cfop_dentro_uf text,
  cfop_fora_uf_nao_contribuinte text,
  cfop_fora_uf_contribuinte text,
  cst_pis text,
  cst_cofins text,
  origin_type text check (origin_type is null or origin_type in ('manufacturer','reseller','imported')),
  emissao_a_partir_de date,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.empresa_fiscal enable row level security;
-- Template B (CRUD pelo app): leitura por qualquer membro; escrita só admin da org
-- (mesma variante de `configuracoes` em 20260705165828_e7_rls_org.sql:41-46).
drop policy if exists "empresa_fiscal: select org" on public.empresa_fiscal;
create policy "empresa_fiscal: select org" on public.empresa_fiscal
  for select to authenticated using (org_id = (select public.current_org_id()));
drop policy if exists "empresa_fiscal: insert admin org" on public.empresa_fiscal;
create policy "empresa_fiscal: insert admin org" on public.empresa_fiscal
  for insert to authenticated
  with check (org_id = (select public.current_org_id()) and public.is_admin());
drop policy if exists "empresa_fiscal: update admin org" on public.empresa_fiscal;
create policy "empresa_fiscal: update admin org" on public.empresa_fiscal
  for update to authenticated
  using (org_id = (select public.current_org_id()) and public.is_admin())
  with check (org_id = (select public.current_org_id()) and public.is_admin());
grant select, insert, update on public.empresa_fiscal to authenticated;

-- 3) fiscal por família (ADR-0135 D-4). Nullable: quem obriga é o gate de
--    publicação (D-7), nunca um DEFAULT. `origem` (binário do imposto) NÃO é tocada.
alter table public.familias
  add column if not exists ncm text check (ncm is null or ncm ~ '^[0-9]{8}$'),
  add column if not exists cest text check (cest is null or cest ~ '^[0-9]{7}$'),
  add column if not exists origem_nfe smallint check (origem_nfe is null or origem_nfe between 0 and 8),
  add column if not exists fci text,
  add column if not exists ex_tipi text,
  add column if not exists tributacao_icms text,
  add column if not exists tributacao_icms_regime text
    check (tributacao_icms_regime is null or tributacao_icms_regime in ('simples','normal')),
  add column if not exists can_invoice boolean,
  add column if not exists can_invoice_causa text,
  add column if not exists can_invoice_em timestamptz,
  add column if not exists fiscal_sincronizado_em timestamptz;
```

- [ ] **Step 2: Linkar e aplicar**

Run: `supabase link --project-ref txvncrgkoynoxwopfkbp && supabase db push && npm run db:check`
Expected: push aplica 1 migration nova; `db:check` sem divergência.

- [ ] **Step 3: Regenerar o snapshot de schema**

Run: `supabase gen types typescript --linked > src/lib/database.types.ts && git diff --stat src/lib/database.types.ts`
Expected: diff inclui `empresa_fiscal`, `tipo_pessoa` e as colunas fiscais de `familias` (e as 5 colunas atrasadas pré-existentes).

- [ ] **Step 4: Teste de schema (padrão ADR-0129 — lê o snapshot versionado)**

`supabase/functions/_shared/fiscal/__tests__/schema.test.ts`:

```ts
// ADR-0135. Padrão ADR-0129: valida contra o snapshot de schema versionado, não lista à mão.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function colunasDe(tabela: string): string[] {
  const arquivo = readFileSync(resolve(process.cwd(), 'src/lib/database.types.ts'), 'utf8');
  const re = new RegExp(`\\n      ${tabela}: \\{\\n        Row: \\{\\n([\\s\\S]*?)\\n        \\}\\n`);
  const bloco = re.exec(arquivo);
  if (!bloco) throw new Error(`bloco Row de \`${tabela}\` não encontrado em database.types.ts`);
  const colunas = bloco[1].split('\n')
    .map((l) => /^\s{10}([a-z0-9_]+)\??:/.exec(l)?.[1])
    .filter((c): c is string => !!c);
  if (colunas.length === 0) throw new Error(`parse de ${tabela} devolveu 0 colunas`);
  return colunas;
}

describe('schema fiscal (ADR-0135)', () => {
  it('empresa_fiscal tem os campos do superconjunto mínimo', () => {
    const cols = colunasDe('empresa_fiscal');
    for (const c of ['cnpj', 'razao_social', 'inscricao_estadual', 'regime_tributario',
      'cep', 'logradouro', 'numero', 'bairro', 'municipio', 'municipio_ibge', 'uf',
      'natureza_operacao', 'cfop_dentro_uf', 'cfop_fora_uf_nao_contribuinte',
      'cfop_fora_uf_contribuinte', 'cst_pis', 'cst_cofins', 'origin_type',
      'emissao_a_partir_de']) {
      expect(cols, `coluna ${c}`).toContain(c);
    }
  });
  it('familias ganhou as colunas fiscais', () => {
    const cols = colunasDe('familias');
    for (const c of ['ncm', 'cest', 'origem_nfe', 'fci', 'ex_tipi', 'tributacao_icms',
      'tributacao_icms_regime', 'can_invoice', 'can_invoice_causa', 'fiscal_sincronizado_em']) {
      expect(cols, `coluna ${c}`).toContain(c);
    }
  });
  it('organizations ganhou tipo_pessoa', () => {
    expect(colunasDe('organizations')).toContain('tipo_pessoa');
  });
});
```

Run: `pnpm test -- fiscal` → Expected: PASS.

- [ ] **Step 5: Prova da constraint contra o Postgres REAL (lição ADR-0129 — mock não basta)**

`scripts/verificar-constraint-fiscal.ts` (espelha `scripts/verificar-isolamento-tenant.ts`: hermético, limpa no finally):

```ts
/**
 * Prova executável da constraint organizations_fiscal_exige_pj (ADR-0135 D-2).
 * Cria org sintética PF, tenta ligar o módulo fiscal via service_role e EXIGE a recusa;
 * vira a org para PJ e exige o aceite. Limpa tudo no finally. Exit 1 em qualquer furo.
 * Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm dlx tsx scripts/verificar-constraint-fiscal.ts
 */
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const slug = `constraint-fiscal-${Date.now()}`;
let orgId: string | null = null;

async function main() {
  const { data: org, error } = await db.from('organizations')
    .insert({ nome: 'TESTE constraint fiscal', slug, is_test: true }).select('id').single();
  if (error) throw new Error(`setup falhou: ${error.message}`);
  orgId = org.id;

  const pf = await db.from('organizations')
    .update({ modulos_habilitados: ['fiscal'] }).eq('id', org.id);
  if (!pf.error) throw new Error('FURO: org PF aceitou o módulo fiscal — constraint ausente');
  if (!/fiscal_exige_pj/.test(pf.error.message)) {
    throw new Error(`recusou pelo motivo errado: ${pf.error.message}`);
  }
  console.log('✓ PF + fiscal recusado pela constraint');

  const pj = await db.from('organizations')
    .update({ tipo_pessoa: 'pj', modulos_habilitados: ['fiscal'] }).eq('id', org.id);
  if (pj.error) throw new Error(`PJ + fiscal deveria passar: ${pj.error.message}`);
  console.log('✓ PJ + fiscal aceito');
}

main()
  .then(() => console.log('OK'))
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(async () => { if (orgId) await db.from('organizations').delete().eq('id', orgId); });
```

Run (com os secrets do projeto): `pnpm dlx tsx scripts/verificar-constraint-fiscal.ts`
Expected: `✓ PF + fiscal recusado pela constraint`, `✓ PJ + fiscal aceito`, `OK`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*adr135* src/lib/database.types.ts scripts/verificar-constraint-fiscal.ts supabase/functions/_shared/fiscal/__tests__/schema.test.ts
git commit -m "feat(fiscal): schema do cadastro fiscal — empresa_fiscal, tipo_pessoa e colunas por família (ADR-0135)"
```

---

### Task 2: Domínio fiscal compartilhado (`_shared/fiscal/validar.ts`)

**Files:**
- Create: `supabase/functions/_shared/fiscal/validar.ts`
- Test: `supabase/functions/_shared/fiscal/__tests__/validar.test.ts`

**Interfaces:**
- Produces (usado pelas Tasks 3–9):
  - `ORIGENS_NFE_POR_ORIGEM: Record<'nacional'|'importado', number[]>`
  - `validarCoerenciaOrigem(origem, origemNfe): string | null`
  - `interface CamposFiscaisFamilia { ncm; cest; origem_nfe; fci; ex_tipi; tributacao_icms; tributacao_icms_regime; unidade; origem }`
  - `camposFiscaisFaltantes(f: CamposFiscaisFamilia, regimeOrg: 'simples'|'normal'): string[]`
  - `validarCnpj(cnpj: string): boolean`
  - `UNIDADES_FISCAIS: readonly string[]`

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
import { describe, expect, it } from 'vitest';
import {
  camposFiscaisFaltantes, validarCnpj, validarCoerenciaOrigem, UNIDADES_FISCAIS,
} from '../validar.ts';

const base = {
  ncm: '39269090', cest: null, origem_nfe: 0, fci: null, ex_tipi: null,
  tributacao_icms: '102', tributacao_icms_regime: 'simples' as const,
  unidade: 'UN', origem: 'nacional' as const,
};

describe('coerência origem binária × origem_nfe (D-5, nunca derivação)', () => {
  it('nacional aceita 0/3/4/5/8 e recusa 1/2/6/7', () => {
    for (const ok of [0, 3, 4, 5, 8]) expect(validarCoerenciaOrigem('nacional', ok)).toBeNull();
    for (const nao of [1, 2, 6, 7]) expect(validarCoerenciaOrigem('nacional', nao)).toMatch(/incompatível/);
  });
  it('importado aceita 1/2/6/7 e recusa 0', () => {
    for (const ok of [1, 2, 6, 7]) expect(validarCoerenciaOrigem('importado', ok)).toBeNull();
    expect(validarCoerenciaOrigem('importado', 0)).toMatch(/incompatível/);
  });
});

describe('camposFiscaisFaltantes — LOUD nomeando o campo (D-7)', () => {
  it('família completa não tem faltas', () => {
    expect(camposFiscaisFaltantes(base, 'simples')).toEqual([]);
  });
  it('sem ncm, sem origem_nfe e sem csosn: três faltas nomeadas', () => {
    const faltas = camposFiscaisFaltantes(
      { ...base, ncm: null, origem_nfe: null, tributacao_icms: null }, 'simples');
    expect(faltas.join(' ')).toMatch(/ncm/);
    expect(faltas.join(' ')).toMatch(/origem_nfe/);
    expect(faltas.join(' ')).toMatch(/csosn/);
  });
  it('origem 3/5/8 exige FCI', () => {
    expect(camposFiscaisFaltantes({ ...base, origem_nfe: 3 }, 'simples').join(' ')).toMatch(/fci/);
  });
  it('regime da família ≠ regime da org exige recadastro (troca detectada, D-6)', () => {
    expect(camposFiscaisFaltantes(base, 'normal').join(' ')).toMatch(/recadastre/);
  });
  it('unidade fora do vocabulário controlado falha nomeando as opções', () => {
    const faltas = camposFiscaisFaltantes({ ...base, unidade: 'CAIXA GRANDE' }, 'simples');
    expect(faltas.join(' ')).toContain('UN');
  });
  it('ncm com 7 dígitos é inválido', () => {
    expect(camposFiscaisFaltantes({ ...base, ncm: '3926909' }, 'simples').join(' ')).toMatch(/ncm/);
  });
});

describe('validarCnpj (dígito verificador)', () => {
  it('aceita CNPJ válido com e sem máscara', () => {
    expect(validarCnpj('11.222.333/0001-81')).toBe(true);
    expect(validarCnpj('11222333000181')).toBe(true);
  });
  it('recusa dígito errado e sequência repetida', () => {
    expect(validarCnpj('11222333000180')).toBe(false);
    expect(validarCnpj('00000000000000')).toBe(false);
  });
});

it('UNIDADES_FISCAIS contém as unidades em uso hoje', () => {
  expect(UNIDADES_FISCAIS).toContain('UN');
  expect(UNIDADES_FISCAIS).toContain('PAR');
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `pnpm test -- validar` → Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `validar.ts`**

```ts
// ADR-0135 — regras puras do cadastro fiscal (sem imports Deno: testável por vitest).
// Parâmetro fiscal NUNCA defaulta em silêncio: tudo aqui falha nomeando o campo.

// D-5: dois campos de origem, sem derivação. A tabela é a da spec §2.3.
export const ORIGENS_NFE_POR_ORIGEM: Record<'nacional' | 'importado', number[]> = {
  nacional: [0, 3, 4, 5, 8],
  importado: [1, 2, 6, 7],
};

export function validarCoerenciaOrigem(
  origem: 'nacional' | 'importado', origemNfe: number,
): string | null {
  if (!ORIGENS_NFE_POR_ORIGEM[origem].includes(origemNfe)) {
    return `origem_nfe ${origemNfe} é incompatível com origem "${origem}" — ` +
      `códigos válidos: ${ORIGENS_NFE_POR_ORIGEM[origem].join(', ')} (ADR-0135 D-5)`;
  }
  return null;
}

// Vocabulário inicial (NF-e usuais). Congelar contra a lista do ML é o item
// "A verificar #3" do ADR-0135 — ajustar aqui é mudança de dado, não de código.
export const UNIDADES_FISCAIS = [
  'UN', 'PC', 'PAR', 'KIT', 'CX', 'PCT', 'RL', 'SC', 'KG', 'G', 'L', 'ML', 'M', 'CM', 'M2',
] as const;

export interface CamposFiscaisFamilia {
  ncm: string | null;
  cest: string | null;
  origem_nfe: number | null;
  fci: string | null;
  ex_tipi: string | null;
  tributacao_icms: string | null;
  tributacao_icms_regime: string | null;
  unidade: string | null;
  origem: 'nacional' | 'importado';
}

/** Lista TODAS as faltas de uma vez (spec §7) — nunca uma por tentativa. */
export function camposFiscaisFaltantes(
  f: CamposFiscaisFamilia, regimeOrg: 'simples' | 'normal',
): string[] {
  const faltas: string[] = [];
  if (!f.ncm || !/^\d{8}$/.test(f.ncm)) faltas.push('ncm (8 dígitos)');
  if (f.origem_nfe == null) {
    faltas.push('origem_nfe (código 0–8)');
  } else {
    const incoerencia = validarCoerenciaOrigem(f.origem, f.origem_nfe);
    if (incoerencia) faltas.push(incoerencia);
    if ([3, 5, 8].includes(f.origem_nfe) && !f.fci?.trim()) {
      faltas.push('fci (obrigatório para origem_nfe 3, 5 ou 8)');
    }
  }
  if (!f.tributacao_icms?.trim()) {
    faltas.push(regimeOrg === 'simples' ? 'csosn (tributacao_icms)' : 'cst de ICMS (tributacao_icms)');
  } else if (f.tributacao_icms_regime !== regimeOrg) {
    faltas.push(
      `tributacao_icms gravado sob regime "${f.tributacao_icms_regime ?? 'nenhum'}" mas a ` +
      `organização é "${regimeOrg}" — recadastre o campo (ADR-0135 D-4)`,
    );
  }
  const unidade = f.unidade?.toUpperCase().trim() ?? '';
  if (!(UNIDADES_FISCAIS as readonly string[]).includes(unidade)) {
    faltas.push(`unidade fiscal (use uma de: ${UNIDADES_FISCAIS.join(', ')})`);
  }
  if (f.cest && !/^\d{7}$/.test(f.cest)) faltas.push('cest (7 dígitos)');
  return faltas;
}

export function validarCnpj(cnpj: string): boolean {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: string): number => {
    let peso = base.length - 7;
    let soma = 0;
    for (const ch of base) {
      soma += Number(ch) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
}
```

- [ ] **Step 4: Rodar e ver passar** — Run: `pnpm test -- validar` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/fiscal/
git commit -m "feat(fiscal): domínio compartilhado — coerência de origem, faltas LOUD, CNPJ, unidades"
```

---

### Task 3: Módulo `fiscal` + ativação validada + `tipo_pessoa`

**Files:**
- Create: `supabase/functions/_shared/fiscal/ativacao.ts`
- Test: `supabase/functions/_shared/fiscal/__tests__/ativacao.test.ts`
- Modify: `supabase/functions/usuarios/index.ts:170-186` (case `set_modulos_org`) + novo case `set_tipo_pessoa_org`
- Modify: `src/lib/modulos.ts`

**Interfaces:**
- Consumes: `validarCnpj` (Task 2).
- Produces:
  - `interface EmpresaFiscalRow` (campos da tabela, todos `string | null`; `emissao_a_partir_de: string | null`)
  - `pendenciasAtivacaoFiscal(org: { tipoPessoa: 'pf'|'pj' }, empresa: EmpresaFiscalRow | null, ufConfiguracoes: string | null): string[]`
  - Edge `usuarios`: action `set_tipo_pessoa_org` (`{ org_id, tipo_pessoa: 'pf'|'pj' }` → `{ ok: true }` | `{ error }`), e `set_modulos_org` recusando `fiscal` com pendências (400, todas listadas de uma vez).
  - `src/lib/modulos.ts`: `ModuloId` ganha `'fiscal'`; `Modulo.menu` vira **opcional** (o módulo fiscal não tem menu próprio) e `menusDeModulosDesabilitados` filtra `m.menu != null`.

- [ ] **Step 1: Testes de `pendenciasAtivacaoFiscal` (falhando)**

```ts
import { describe, expect, it } from 'vitest';
import { pendenciasAtivacaoFiscal, type EmpresaFiscalRow } from '../ativacao.ts';

const completa: EmpresaFiscalRow = {
  cnpj: '11222333000181', razao_social: 'DSA LTDA', nome_fantasia: null,
  inscricao_estadual: '123456', regime_tributario: 'simples',
  cep: '50000000', logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro',
  municipio: 'Recife', municipio_ibge: '2611606', uf: 'PE',
  natureza_operacao: 'Venda de mercadoria', cfop_dentro_uf: '5102',
  cfop_fora_uf_nao_contribuinte: '6108', cfop_fora_uf_contribuinte: null,
  cst_pis: '49', cst_cofins: '49', origin_type: 'reseller',
  emissao_a_partir_de: '2026-10-01',
};

describe('pendenciasAtivacaoFiscal (spec §5.3 — lista tudo de uma vez)', () => {
  it('org PJ completa e UF coerente: zero pendências', () => {
    expect(pendenciasAtivacaoFiscal({ tipoPessoa: 'pj' }, completa, 'PE')).toEqual([]);
  });
  it('org PF é pendência mesmo com empresa completa', () => {
    expect(pendenciasAtivacaoFiscal({ tipoPessoa: 'pf' }, completa, 'PE').join(' '))
      .toMatch(/pessoa jurídica/);
  });
  it('sem empresa_fiscal: pendência única dizendo o que falta', () => {
    expect(pendenciasAtivacaoFiscal({ tipoPessoa: 'pj' }, null, 'PE')[0]).toMatch(/empresa/i);
  });
  it('campos vazios são listados TODOS de uma vez, nomeados', () => {
    const p = pendenciasAtivacaoFiscal(
      { tipoPessoa: 'pj' }, { ...completa, cnpj: null, cep: null, cst_pis: null }, 'PE');
    expect(p.length).toBeGreaterThanOrEqual(3);
    expect(p.join(' ')).toMatch(/CNPJ/);
    expect(p.join(' ')).toMatch(/CEP/);
    expect(p.join(' ')).toMatch(/PIS/);
  });
  it('CNPJ com dígito errado é pendência própria', () => {
    expect(pendenciasAtivacaoFiscal({ tipoPessoa: 'pj' }, { ...completa, cnpj: '11222333000180' }, 'PE')
      .join(' ')).toMatch(/dígito/);
  });
  it('Regime Normal é recusado com mensagem de v2 (D-6)', () => {
    expect(pendenciasAtivacaoFiscal({ tipoPessoa: 'pj' }, { ...completa, regime_tributario: 'normal' }, 'PE')
      .join(' ')).toMatch(/Simples/);
  });
  it('UF divergente de configuracoes.uf_empresa nomeia AS DUAS (trava ADR-0112)', () => {
    const p = pendenciasAtivacaoFiscal({ tipoPessoa: 'pj' }, completa, 'SP').join(' ');
    expect(p).toContain('PE');
    expect(p).toContain('SP');
  });
  it('sem uf_empresa em configuracoes também é pendência', () => {
    expect(pendenciasAtivacaoFiscal({ tipoPessoa: 'pj' }, completa, null).join(' '))
      .toMatch(/ADR-0112|Configurações/);
  });
  it('sem emissao_a_partir_de é pendência (D-8)', () => {
    expect(pendenciasAtivacaoFiscal({ tipoPessoa: 'pj' }, { ...completa, emissao_a_partir_de: null }, 'PE')
      .join(' ')).toMatch(/início da emissão/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `pnpm test -- ativacao` → FAIL.

- [ ] **Step 3: Implementar `ativacao.ts`**

```ts
// ADR-0135 D-2/D-3 — checklist de ativação do módulo fiscal. Puro (vitest).
import { validarCnpj } from './validar.ts';

export interface EmpresaFiscalRow {
  cnpj: string | null; razao_social: string | null; nome_fantasia: string | null;
  inscricao_estadual: string | null; regime_tributario: string | null;
  cep: string | null; logradouro: string | null; numero: string | null;
  complemento: string | null; bairro: string | null; municipio: string | null;
  municipio_ibge: string | null; uf: string | null;
  natureza_operacao: string | null; cfop_dentro_uf: string | null;
  cfop_fora_uf_nao_contribuinte: string | null; cfop_fora_uf_contribuinte: string | null;
  cst_pis: string | null; cst_cofins: string | null; origin_type: string | null;
  emissao_a_partir_de: string | null;
}

// cfop_fora_uf_contribuinte, nome_fantasia e complemento são OPCIONAIS (spec §2.2).
const OBRIGATORIOS: Array<[keyof EmpresaFiscalRow, string]> = [
  ['cnpj', 'CNPJ'], ['razao_social', 'razão social'],
  ['inscricao_estadual', 'inscrição estadual'], ['regime_tributario', 'regime tributário'],
  ['cep', 'CEP'], ['logradouro', 'logradouro'], ['numero', 'número'], ['bairro', 'bairro'],
  ['municipio', 'município'], ['municipio_ibge', 'código IBGE do município'], ['uf', 'UF'],
  ['natureza_operacao', 'natureza da operação'], ['cfop_dentro_uf', 'CFOP dentro da UF'],
  ['cfop_fora_uf_nao_contribuinte', 'CFOP fora da UF (não contribuinte)'],
  ['cst_pis', 'CST de PIS'], ['cst_cofins', 'CST de COFINS'],
  ['origin_type', 'papel da empresa (origin_type)'],
  ['emissao_a_partir_de', 'data de início da emissão (emissao_a_partir_de)'],
];

export function pendenciasAtivacaoFiscal(
  org: { tipoPessoa: 'pf' | 'pj' },
  empresa: EmpresaFiscalRow | null,
  ufConfiguracoes: string | null,
): string[] {
  const p: string[] = [];
  if (org.tipoPessoa !== 'pj') {
    p.push('a organização precisa ser pessoa jurídica (pessoa física jamais emite — ADR-0135 D-2)');
  }
  if (!empresa) {
    p.push('cadastro da empresa não preenchido (card "Empresa" em Configurações)');
    return p;
  }
  for (const [campo, rotulo] of OBRIGATORIOS) {
    if (!String(empresa[campo] ?? '').trim()) p.push(`${rotulo} não preenchido`);
  }
  if (empresa.cnpj?.trim() && !validarCnpj(empresa.cnpj)) {
    p.push('CNPJ inválido (dígito verificador não confere)');
  }
  if (empresa.regime_tributario && empresa.regime_tributario !== 'simples') {
    p.push('a v1 cobre só Simples Nacional — Regime Normal fica para a v2 (ADR-0135 D-6)');
  }
  if (empresa.uf?.trim()) {
    if (!ufConfiguracoes?.trim()) {
      p.push('UF da empresa em Configurações (alíquota interna, ADR-0112) não preenchida');
    } else if (empresa.uf.trim() !== ufConfiguracoes.trim()) {
      p.push(
        `UF do endereço fiscal (${empresa.uf.trim()}) diverge da UF da empresa em ` +
        `Configurações (${ufConfiguracoes.trim()}) — corrija uma das duas (trava ADR-0112)`,
      );
    }
  }
  return p;
}
```

- [ ] **Step 4: Rodar e ver passar** — Run: `pnpm test -- ativacao` → PASS.

- [ ] **Step 5: Edge `usuarios` — ampliar `set_modulos_org` e criar `set_tipo_pessoa_org`**

Em `supabase/functions/usuarios/index.ts`: adicionar o import
`import { pendenciasAtivacaoFiscal } from '../_shared/fiscal/ativacao.ts';`
No case `set_modulos_org` (linha ~175): `const MODULOS_VALIDOS = ['estoque', 'pulse', 'fiscal'];` e, logo após montar `modulos`, inserir:

```ts
      // ADR-0135 D-2/D-7.3: ligar o módulo fiscal exige o checklist completo — as
      // pendências saem TODAS de uma vez. A constraint fiscal_exige_pj é a rede no banco;
      // esta é a mensagem legível.
      if (modulos.includes('fiscal')) {
        const [{ data: org }, { data: empresa }, { data: cfg }] = await Promise.all([
          db.from('organizations').select('tipo_pessoa').eq('id', alvo).maybeSingle(),
          db.from('empresa_fiscal').select('*').eq('org_id', alvo).maybeSingle(),
          db.from('configuracoes').select('uf_empresa').eq('org_id', alvo).maybeSingle(),
        ]);
        const pendencias = pendenciasAtivacaoFiscal(
          { tipoPessoa: (org?.tipo_pessoa ?? 'pf') as 'pf' | 'pj' },
          empresa ?? null,
          cfg?.uf_empresa ?? null,
        );
        if (pendencias.length) {
          return json({ error: `Módulo fiscal não pode ser ligado:\n- ${pendencias.join('\n- ')}` }, 400);
        }
      }
```

Novo case, ao lado de `set_modulos_org`:

```ts
    case 'set_tipo_pessoa_org': {
      if (!me.is_super_admin) return json({ error: 'forbidden' }, 403);
      const alvo = String(body.org_id ?? '');
      const tipo = String(body.tipo_pessoa ?? '');
      if (!alvo || !['pf', 'pj'].includes(tipo)) {
        return json({ error: 'org_id e tipo_pessoa (pf|pj) obrigatórios' }, 400);
      }
      if (tipo === 'pf') {
        // A constraint recusaria de qualquer forma; aqui a mensagem explica a ordem certa.
        const { data: o } = await db.from('organizations')
          .select('modulos_habilitados').eq('id', alvo).maybeSingle();
        if (((o?.modulos_habilitados ?? []) as string[]).includes('fiscal')) {
          return json({ error: 'Desligue o módulo fiscal antes de voltar a organização para pessoa física.' }, 400);
        }
      }
      const { error } = await db.from('organizations')
        .update({ tipo_pessoa: tipo, atualizado_em: new Date().toISOString() }).eq('id', alvo);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
```

Acrescentar `'set_tipo_pessoa_org'` ao array `platformAction` (linha ~30) — sem isso o super-admin sem org é barrado antes do case.
Em `list_orgs` (linhas ~108 e ~115): acrescentar `tipo_pessoa` ao select e ao objeto de resposta.

- [ ] **Step 6: Front `src/lib/modulos.ts`**

```ts
export type ModuloId = 'estoque' | 'pulse' | 'fiscal';

export interface Modulo {
  id: ModuloId;
  nome: string;
  descricao: string;
  /** Menu que só aparece com o módulo habilitado. O módulo fiscal não tem menu próprio. */
  menu?: MenuKey;
}
```

No array `MODULOS`, acrescentar:

```ts
  {
    id: 'fiscal',
    nome: 'Fiscal',
    descricao: 'Cadastro fiscal de empresa e produtos + prontidão de nota no Faturador do ML (ADR-0135). Exige organização PJ.',
  },
```

E em `menusDeModulosDesabilitados`:

```ts
  return MODULOS.filter((m) => m.menu != null && !ativos.has(m.id)).map((m) => m.menu!);
```

- [ ] **Step 7: Rodar suíte inteira** — Run: `pnpm test` → PASS (nenhum teste existente de módulos quebra: lista só cresceu).

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/fiscal/ supabase/functions/usuarios/index.ts src/lib/modulos.ts
git commit -m "feat(fiscal): módulo fiscal com ativação validada e tipo_pessoa por org (ADR-0135 D-2)"
```

---

### Task 4: `cadastrar-produto` aceita e exige fiscal (org com módulo)

**Files:**
- Modify: `supabase/functions/_shared/produto/validar.ts` (interfaces + `montarLinhasProduto`)
- Modify: `supabase/functions/cadastrar-produto/index.ts:32-60`
- Test: `supabase/functions/cadastrar-produto/__tests__/fiscal.test.ts`

**Interfaces:**
- Consumes: `camposFiscaisFaltantes` (Task 2).
- Produces: `ProdutoEntrada` ganha `fiscal?: FiscalEntrada`; `montarLinhasProduto` grava as colunas fiscais quando `fiscal` presente.

```ts
export interface FiscalEntrada {
  ncm: string;
  cest?: string | null;
  origemNfe: number;
  fci?: string | null;
  exTipi?: string | null;
  tributacaoIcms: string;
}
```

- [ ] **Step 1: Testes (falhando)** — `fiscal.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { montarLinhasProduto, type ProdutoEntrada } from '../../_shared/produto/validar.ts';
import { validarFiscalDaEntrada } from '../processar.ts';

const entrada: ProdutoEntrada = {
  nomePai: 'Produto X', origem: 'nacional', unidade: 'UN',
  chaveCadastro: '00000000-0000-4000-8000-000000000001',
  variacoes: [{ preco: 10 }],
  fiscal: { ncm: '39269090', origemNfe: 0, tributacaoIcms: '102' },
};

describe('fiscal no cadastro manual (ADR-0135)', () => {
  it('org SEM módulo: fiscal ausente passa e nenhuma coluna fiscal é gravada', () => {
    const r = validarFiscalDaEntrada({ ...entrada, fiscal: undefined }, false, 'simples');
    expect(r).toEqual([]);
  });
  it('org COM módulo: fiscal ausente falha nomeando os campos', () => {
    const faltas = validarFiscalDaEntrada({ ...entrada, fiscal: undefined }, true, 'simples');
    expect(faltas.join(' ')).toMatch(/ncm/);
  });
  it('org COM módulo: incoerência origem × origem_nfe falha LOUD', () => {
    const faltas = validarFiscalDaEntrada(
      { ...entrada, fiscal: { ...entrada.fiscal!, origemNfe: 1 } }, true, 'simples');
    expect(faltas.join(' ')).toMatch(/incompatível/);
  });
  it('montarLinhasProduto grava colunas fiscais + regime da org', () => {
    const { familia } = montarLinhasProduto(entrada, {
      loteId: 'l', userId: 'u', orgId: 'o', codigoPai: '00100',
      codigos: ['00101'], chaveCadastro: entrada.chaveCadastro, regimeOrg: 'simples',
    });
    expect(familia.ncm).toBe('39269090');
    expect(familia.origem_nfe).toBe(0);
    expect(familia.tributacao_icms).toBe('102');
    expect(familia.tributacao_icms_regime).toBe('simples');
  });
  it('sem fiscal na entrada, montarLinhasProduto não inventa colunas', () => {
    const { familia } = montarLinhasProduto({ ...entrada, fiscal: undefined }, {
      loteId: 'l', userId: 'u', orgId: 'o', codigoPai: '00100',
      codigos: ['00101'], chaveCadastro: entrada.chaveCadastro,
    });
    expect(familia.ncm).toBeUndefined();
  });
});
```

- [ ] **Step 2: Ver falhar** — `pnpm test -- cadastrar-produto` → FAIL.

- [ ] **Step 3: Implementar**

Em `_shared/produto/validar.ts`: adicionar `FiscalEntrada` (acima), `fiscal?: FiscalEntrada` em `ProdutoEntrada`, e no `ctx` de `montarLinhasProduto` o campo opcional `regimeOrg?: 'simples' | 'normal'`. No objeto `familia` montado:

```ts
    // ADR-0135 D-4: colunas fiscais só quando a entrada trouxe fiscal (org com módulo).
    // O regime que gerou o valor fica gravado junto (detecção de troca de regime, D-6).
    ...(p.fiscal ? {
      ncm: p.fiscal.ncm,
      cest: p.fiscal.cest?.trim() || null,
      origem_nfe: p.fiscal.origemNfe,
      fci: p.fiscal.fci?.trim() || null,
      ex_tipi: p.fiscal.exTipi?.trim() || null,
      tributacao_icms: p.fiscal.tributacaoIcms,
      tributacao_icms_regime: ctx.regimeOrg ?? 'simples',
    } : {}),
```

Em `cadastrar-produto/processar.ts` (guards puros), exportar:

```ts
import { camposFiscaisFaltantes } from '../_shared/fiscal/validar.ts';
import type { ProdutoEntrada } from '../_shared/produto/validar.ts';

/** Org com módulo fiscal exige entrada fiscal completa; sem módulo, ignora (spec §5). */
export function validarFiscalDaEntrada(
  p: ProdutoEntrada, moduloFiscalAtivo: boolean, regimeOrg: 'simples' | 'normal',
): string[] {
  if (!moduloFiscalAtivo) return [];
  return camposFiscaisFaltantes({
    ncm: p.fiscal?.ncm ?? null,
    cest: p.fiscal?.cest ?? null,
    origem_nfe: p.fiscal?.origemNfe ?? null,
    fci: p.fiscal?.fci ?? null,
    ex_tipi: p.fiscal?.exTipi ?? null,
    tributacao_icms: p.fiscal?.tributacaoIcms ?? null,
    tributacao_icms_regime: regimeOrg,
    unidade: p.unidade ?? null,
    origem: p.origem,
  }, regimeOrg);
}
```

Em `cadastrar-produto/index.ts`, logo após o `exigirModulo(admin, orgId, 'estoque')` (linha ~39):

```ts
  const moduloFiscal = await exigirModulo(admin, orgId, 'fiscal');
  let regimeOrg: 'simples' | 'normal' = 'simples';
  if (moduloFiscal) {
    const { data: emp } = await admin.from('empresa_fiscal')
      .select('regime_tributario').eq('org_id', orgId).maybeSingle();
    regimeOrg = (emp?.regime_tributario ?? 'simples') as 'simples' | 'normal';
  }
```

Depois de `validarProdutoNovo` (linha ~47):

```ts
  const faltasFiscais = validarFiscalDaEntrada(produto, moduloFiscal, regimeOrg);
  if (faltasFiscais.length > 0) {
    return json({ erros: faltasFiscais.map((mensagem) => ({ campo: 'fiscal', mensagem })) }, 400);
  }
```

E no call de `montarLinhasProduto` (linha ~179): acrescentar `regimeOrg` ao ctx.

- [ ] **Step 4: Ver passar** — `pnpm test -- cadastrar-produto` → PASS (suíte existente do cadastro intacta).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/produto/validar.ts supabase/functions/cadastrar-produto/
git commit -m "feat(fiscal): cadastro manual exige fiscal completo em org com módulo (ADR-0135 D-7)"
```

---

### Task 5: `ingest-lote` — coluna NCM (aborta o lote na org fiscal)

**Files:**
- Create: `supabase/functions/ingest-lote/verificar-fiscal.ts`
- Modify: `supabase/functions/_shared/types.ts` (PlanilhaRow + FamiliaAgrupada)
- Modify: `supabase/functions/ingest-lote/index.ts:111-125` e `ingest-lote/mapear-linha.ts`
- Modify: onde `FamiliaAgrupada` vira INSERT em `familias` (localizar em `ingest-lote/` a montagem da row — mesma função que grava `origem`)
- Test: `supabase/functions/ingest-lote/__tests__/verificar-fiscal.test.ts`

**Interfaces:**
- Produces: `exigirFiscalExplicito(rowsRaw): void` (throw = aborta o lote, mesmo contrato de `exigirOrigemExplicita`); `PlanilhaRow` ganha `NCM?`, `CEST?`, `ORIGEM_NFE?`, `CSOSN?`; `FamiliaAgrupada` ganha `ncm?: string | null; cest?: string | null; origem_nfe?: number | null; tributacao_icms?: string | null`.
- **`COLUNAS_OBRIGATORIAS` NÃO muda** — a coluna `NCM` é exigida condicionalmente (só org fiscal), então a obrigatoriedade fica em `exigirFiscalExplicito`, chamada só quando o módulo está ativo. Planilha de org sem módulo passa byte a byte como hoje.

- [ ] **Step 1: Testes (falhando)** — espelhar `verificar-origem`:

```ts
import { describe, expect, it } from 'vitest';
import { exigirFiscalExplicito } from '../verificar-fiscal.ts';

const pai = (extra: Record<string, unknown>) => ({ CODIGO: '00100', PAI: '0', ...extra });

describe('exigirFiscalExplicito (org com módulo fiscal — ADR-0135)', () => {
  it('PAI com NCM de 8 dígitos passa', () => {
    expect(() => exigirFiscalExplicito([pai({ NCM: '39269090' })])).not.toThrow();
  });
  it('PAI sem NCM aborta nomeando o código', () => {
    expect(() => exigirFiscalExplicito([pai({})])).toThrow(/00100.*NCM.*vazio/s);
  });
  it('NCM com máscara 3926.90.90 é normalizado e passa', () => {
    expect(() => exigirFiscalExplicito([pai({ NCM: '3926.90.90' })])).not.toThrow();
  });
  it('acumula TODOS os PAIs problemáticos numa mensagem só', () => {
    expect(() => exigirFiscalExplicito([
      pai({}), { CODIGO: '00200', PAI: '0', NCM: 'abc' },
    ])).toThrow(/2 produto\(s\) PAI/);
  });
  it('linha filha (PAI != 0) é ignorada', () => {
    expect(() => exigirFiscalExplicito([{ CODIGO: '00101', PAI: '00100' }])).not.toThrow();
  });
  it('ORIGEM_NFE presente mas inválida aborta (opcional ≠ silencioso)', () => {
    expect(() => exigirFiscalExplicito([pai({ NCM: '39269090', ORIGEM_NFE: '9' })]))
      .toThrow(/ORIGEM_NFE/);
  });
});
```

- [ ] **Step 2: Ver falhar** — `pnpm test -- verificar-fiscal` → FAIL.

- [ ] **Step 3: Implementar `verificar-fiscal.ts`** (mesma mecânica de `verificar-origem.ts:13-33`, usando `normalizarCodigo` de `_shared/parser.ts`):

```ts
// ADR-0135 — NCM obrigatório na planilha SÓ para org com módulo fiscal (spec §5.2).
// Mesmo contrato do ADR-0107: aborta o lote ANTES de persistir qualquer coisa.
import { normalizarCodigo } from '../_shared/parser.ts';

export function normalizarNcm(bruto: unknown): string {
  return String(bruto ?? '').replace(/\D/g, '');
}

export function exigirFiscalExplicito(rowsRaw: Record<string, unknown>[]): void {
  const problemas: string[] = [];
  const vistos = new Set<string>();
  for (const r of rowsRaw) {
    const paiCampo = String(r.PAI ?? '').trim();
    if (paiCampo !== '0' && paiCampo !== '') continue;
    const cod = normalizarCodigo(String(r.CODIGO ?? ''));
    if (vistos.has(cod)) continue;
    vistos.add(cod);
    const ncm = normalizarNcm(r.NCM);
    if (!/^\d{8}$/.test(ncm)) {
      const cru = String(r.NCM ?? '').trim();
      problemas.push(`${cod} (NCM = ${cru === '' ? 'vazio' : `"${cru}"`})`);
    }
    // Colunas opcionais: presença com valor inválido também aborta —
    // parâmetro fiscal nunca degrada em silêncio.
    const origemNfe = String(r.ORIGEM_NFE ?? '').trim();
    if (origemNfe !== '' && !/^[0-8]$/.test(origemNfe)) {
      problemas.push(`${cod} (ORIGEM_NFE = "${origemNfe}" — use um código de 0 a 8)`);
    }
    const cest = String(r.CEST ?? '').replace(/\D/g, '');
    if (String(r.CEST ?? '').trim() !== '' && !/^\d{7}$/.test(cest)) {
      problemas.push(`${cod} (CEST = "${String(r.CEST).trim()}" — 7 dígitos)`);
    }
  }
  if (problemas.length) {
    throw new Error(
      `NCM ausente ou campo fiscal inválido em ${problemas.length} produto(s) PAI: ` +
      `${problemas.join(', ')}. Esta organização emite nota fiscal — corrija a planilha e ` +
      `reenvie; o dado fiscal não pode ser presumido (ADR-0135).`,
    );
  }
}
```

- [ ] **Step 4: Ver passar** — `pnpm test -- verificar-fiscal` → PASS.

- [ ] **Step 5: Fiação no ingest**

1. `_shared/types.ts`: `PlanilhaRow` ganha `NCM?: string; CEST?: string; ORIGEM_NFE?: string; CSOSN?: string;`; `FamiliaAgrupada` ganha os 4 campos opcionais (`ncm`, `cest`, `origem_nfe`, `tributacao_icms`).
2. `ingest-lote/mapear-linha.ts`: mapear as 4 colunas cruas (ao lado de `ORIGEM: lerOrigemCrua(r)` na linha ~27).
3. `ingest-lote/index.ts` (linha ~113, logo após `exigirOrigemExplicita(rowsRaw)`): o ingest já tem `orgId` e `admin` no escopo — conferir e reusar:

```ts
    // ADR-0135: NCM obrigatório SÓ quando a org emite nota — org sem o módulo segue intacta.
    const moduloFiscal = await exigirModulo(admin, orgId, 'fiscal');
    if (moduloFiscal) exigirFiscalExplicito(rowsRaw);
```

(import: `exigirModulo` de `../_shared/produto/modulo.ts`, `exigirFiscalExplicito` de `./verificar-fiscal.ts`).
4. Onde o grupo vira linha de `familias` (mesma função que grava `origem` — seguir o fluxo de `agruparPorPai` até o INSERT): gravar `ncm: normalizarNcm(g.ncm)`, `origem_nfe`, `cest`, `tributacao_icms` (da coluna `CSOSN`) **apenas quando `moduloFiscal`**, com `tributacao_icms_regime: 'simples'` quando `CSOSN` veio preenchido. `agruparPorPai` lê esses campos da linha PAI, como faz com `ORIGEM`.

- [ ] **Step 6: Rodar a suíte do ingest** — `pnpm test -- ingest-lote` → PASS (testes existentes intactos: nada muda sem o módulo).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/types.ts supabase/functions/ingest-lote/
git commit -m "feat(fiscal): planilha ganha NCM/CEST/ORIGEM_NFE/CSOSN — aborta lote na org fiscal (ADR-0135)"
```

---

### Task 6: Gate de publicação e de UPDATE

**Files:**
- Create: `supabase/functions/_shared/fiscal/gate.ts`
- Modify: `supabase/functions/publish-familia-ml/processar.ts:96-114` (dentro do `try`, antes de `montarAnuncioCanonico`)
- Modify: `supabase/functions/update-familia-ml/processar.ts:95-110` (após carregar a família, antes do roteamento UP/legacy)
- Test: `supabase/functions/_shared/fiscal/__tests__/gate.test.ts`

**Interfaces:**
- Consumes: `camposFiscaisFaltantes` (Task 2).
- Produces: `exigirFiscalCompletoSePreciso(admin: SupabaseClient, familia: { id; org_id; nome_pai; unidade; origem; ncm; cest; origem_nfe; fci; ex_tipi; tributacao_icms; tributacao_icms_regime }): Promise<boolean>` — retorna `false` (org sem módulo, no-op), `true` (módulo ativo e família completa) ou **lança** `Error` com todas as faltas (cai no catch existente do worker → `familias.status='erro'` + `erro_mensagem`, o LOUD do projeto). O boolean é reusado na Task 7 para decidir o enqueue do push.

- [ ] **Step 1: Testes (falhando)** — com `admin` fake injetável:

```ts
import { describe, expect, it } from 'vitest';
import { exigirFiscalCompletoSePreciso } from '../gate.ts';

function adminFake(modulos: string[], regime: string | null) {
  return {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => tabela === 'organizations'
            ? { data: { modulos_habilitados: modulos } }
            : { data: regime ? { regime_tributario: regime } : null },
        }),
      }),
    }),
  } as never;
}

const completa = {
  id: 'f1', org_id: 'o1', nome_pai: 'X', unidade: 'UN', origem: 'nacional' as const,
  ncm: '39269090', cest: null, origem_nfe: 0, fci: null, ex_tipi: null,
  tributacao_icms: '102', tributacao_icms_regime: 'simples',
};

describe('exigirFiscalCompletoSePreciso (ADR-0135 D-7)', () => {
  it('org sem módulo: no-op, retorna false', async () => {
    await expect(exigirFiscalCompletoSePreciso(adminFake(['estoque'], null), { ...completa, ncm: null }))
      .resolves.toBe(false);
  });
  it('org com módulo e família completa: retorna true', async () => {
    await expect(exigirFiscalCompletoSePreciso(adminFake(['fiscal'], 'simples'), completa))
      .resolves.toBe(true);
  });
  it('org com módulo e família sem ncm: lança nomeando o campo e a família', async () => {
    await expect(exigirFiscalCompletoSePreciso(adminFake(['fiscal'], 'simples'), { ...completa, ncm: null }))
      .rejects.toThrow(/ncm/);
  });
  it('regime da família diverge do da org: lança pedindo recadastro', async () => {
    await expect(exigirFiscalCompletoSePreciso(adminFake(['fiscal'], 'normal'), completa))
      .rejects.toThrow(/recadastre/);
  });
});
```

- [ ] **Step 2: Ver falhar** — `pnpm test -- gate` → FAIL.

- [ ] **Step 3: Implementar `gate.ts`**

```ts
// ADR-0135 D-7 — gate de escrita de anúncio: org com módulo fiscal não publica família
// fiscalmente incompleta. LOUD via throw (cai no catch do worker → status='erro' visível).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { camposFiscaisFaltantes, type CamposFiscaisFamilia } from './validar.ts';

export interface FamiliaFiscalRow extends CamposFiscaisFamilia {
  id: string;
  org_id: string;
  nome_pai: string;
}

/** @returns false = org sem módulo (nada a fazer); true = módulo ativo e família OK. */
export async function exigirFiscalCompletoSePreciso(
  admin: SupabaseClient, familia: FamiliaFiscalRow,
): Promise<boolean> {
  const { data: org } = await admin.from('organizations')
    .select('modulos_habilitados').eq('id', familia.org_id).maybeSingle();
  if (!((org?.modulos_habilitados ?? []) as string[]).includes('fiscal')) return false;

  const { data: empresa } = await admin.from('empresa_fiscal')
    .select('regime_tributario').eq('org_id', familia.org_id).maybeSingle();
  const regime = (empresa?.regime_tributario ?? 'simples') as 'simples' | 'normal';

  const faltas = camposFiscaisFaltantes(familia, regime);
  if (faltas.length) {
    throw new Error(
      `Cadastro fiscal incompleto em "${familia.nome_pai}" — preencha antes de publicar: ` +
      `${faltas.join('; ')} (ADR-0135 D-7)`,
    );
  }
  return true;
}
```

- [ ] **Step 4: Ver passar** — `pnpm test -- gate` → PASS.

- [ ] **Step 5: Fiar nos dois workers**

`publish-familia-ml/processar.ts`, dentro do `try` (linha ~97), antes do gate de atributos:

```ts
    // ADR-0135 D-7: fiscal completo antes de QUALQUER escrita no ML (org com módulo).
    const fiscalAtivo = await exigirFiscalCompletoSePreciso(admin, familia);
```

(o `familia` vem de `select('*')` — todas as colunas fiscais já estão lá; guardar `fiscalAtivo` numa variável do escopo do `try` para a Task 7).

`update-familia-ml/processar.ts`, em `executarAtualizacaoFamilia` logo após montar `ctx` (linha ~110):

```ts
  // ADR-0135 D-7: mesmo gate do publish. `somenteEstoque` NÃO passa por aqui —
  // reposição de estoque e preço não são bloqueadas pela pendência fiscal (spec §5.1).
  let fiscalAtivo = false;
  if (!job.somenteEstoque) {
    fiscalAtivo = await exigirFiscalCompletoSePreciso(admin, familia);
  }
```

O throw precisa cair no caminho de erro definitivo existente do update (o equivalente do catch do publish) — conferir onde `processarAtualizacaoFamilia` trata exceção e garantir que a mensagem chega em `erro_mensagem`.

- [ ] **Step 6: Rodar suítes dos workers** — `pnpm test -- publish-familia update-familia` → PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/fiscal/gate.ts supabase/functions/publish-familia-ml/ supabase/functions/update-familia-ml/
git commit -m "feat(fiscal): publicação e UPDATE bloqueiam família fiscalmente incompleta (ADR-0135 D-7)"
```

---

### Task 7: Porta fiscal ML + worker `sincronizar-fiscal-ml` + enqueue pós-publicação

**Files:**
- Create: `supabase/functions/_shared/canais/fiscal-ml.ts`
- Create: `supabase/functions/sincronizar-fiscal-ml/index.ts` + `processar.ts`
- Modify: `supabase/functions/_shared/queue.ts` (novo helper)
- Modify: `supabase/functions/publish-familia-ml/processar.ts` (~linha 190, após persistir `ml_item_id`)
- Modify: `supabase/config.toml` (nova entrada)
- Test: `supabase/functions/sincronizar-fiscal-ml/__tests__/processar.test.ts`

**Interfaces:**
- Consumes: `camposFiscaisFaltantes`, `resolverConexao`, `getValidAccessTokenConexao`, `qstashClient`, `verificarAssinatura`, `fiscalAtivo` (Task 6).
- Produces:
  - `montarFiscalInformation(familia, variacao, empresa): Record<string, unknown>`
  - `empurrarFiscalSku(token: string, payload: Record<string, unknown>): Promise<void>` (upsert POST→409→PUT; lança `Error & { status?: number }`)
  - `vincularSkuAnuncio(token, v: { sku: string; item_id: string; variation_id?: string }): Promise<void>`
  - `lerCanInvoice(token, itemId: string): Promise<{ pronto: boolean; causa: string | null } | null>`
  - `queue.ts`: `interface SincronizarFiscalJob { familia_id: string }` + `enfileirarSincronizacaoFiscal(familiaId: string): Promise<string>` (copiar a construção de URL de `enfileirarFamilia`, `queue.ts:39-46`, trocando o path para `sincronizar-fiscal-ml`, `retries: 3`)
  - `processarSincronizacaoFiscal(deps, job): Promise<{ status: number; body: unknown }>` com deps injetadas `{ admin, resolverConexao, getToken, portas }` (padrão `sincronizar-estoque`)

- [ ] **Step 1: Testes do processar (falhando)** — deps injetadas, sem rede:

```ts
import { describe, expect, it, vi } from 'vitest';
import { processarSincronizacaoFiscal } from '../processar.ts';

const familia = {
  id: 'f1', org_id: 'o1', nome_pai: 'X', ml_item_id: 'MLB1', unidade: 'UN',
  origem: 'nacional', ncm: '39269090', cest: null, origem_nfe: 0, fci: null,
  ex_tipi: null, tributacao_icms: '102', tributacao_icms_regime: 'simples',
};
const variacoes = [{ codigo: '00101', gtin: '7891234567895', peso_gramas: 200, ml_variation_id: 'v1' }];

function deps(over: Partial<Record<string, unknown>> = {}) {
  const updates: Record<string, unknown>[] = [];
  const admin = {
    from: (t: string) => ({
      select: () => ({
        eq: (_c: string, _v: string) => ({
          single: async () => ({ data: t === 'familias' ? familia : null }),
          maybeSingle: async () => ({
            data: t === 'organizations' ? { modulos_habilitados: ['fiscal'] }
              : t === 'empresa_fiscal' ? { origin_type: 'reseller', regime_tributario: 'simples' }
              : null,
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({ eq: async () => { updates.push(patch); return { error: null }; } }),
    }),
  };
  // Variações vêm por select próprio — o fake acima cobre; simplificação aceitável no teste.
  return {
    admin: admin as never,
    resolverConexao: vi.fn(async () => ({ id: 'cx1' })),
    getToken: vi.fn(async () => 'tok'),
    listarVariacoes: vi.fn(async () => variacoes),
    portas: {
      empurrarFiscalSku: vi.fn(async () => {}),
      vincularSkuAnuncio: vi.fn(async () => {}),
      lerCanInvoice: vi.fn(async () => ({ pronto: true, causa: null })),
    },
    updates,
    ...over,
  };
}

describe('processarSincronizacaoFiscal (ADR-0135 D-1/D-10)', () => {
  it('caminho feliz: empurra cada SKU, vincula, lê can_invoice e persiste', async () => {
    const d = deps();
    const r = await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(r.status).toBe(200);
    expect(d.portas.empurrarFiscalSku).toHaveBeenCalledTimes(1);
    expect(d.portas.vincularSkuAnuncio).toHaveBeenCalledWith('tok', {
      sku: '00101', item_id: 'MLB1', variation_id: 'v1',
    });
    expect(d.updates.some((u) => u.can_invoice === true)).toBe(true);
  });
  it('org sem módulo: skip 200 sem tocar o ML', async () => {
    const d = deps();
    (d.admin as never as { _semModulo?: boolean })._semModulo = true;
    // trocar o fake: organizations devolve { modulos_habilitados: [] }
  });
  it('4xx do ML: definitivo — 200 com can_invoice=false + causa, sem retry', async () => {
    const d = deps();
    const e = Object.assign(new Error('bad request'), { status: 400 });
    (d.portas.empurrarFiscalSku as ReturnType<typeof vi.fn>).mockRejectedValue(e);
    const r = await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(r.status).toBe(200);
    expect(d.updates.some((u) => u.can_invoice === false)).toBe(true);
  });
  it('5xx/timeout do ML: transitório — status 500 para o QStash retentar', async () => {
    const d = deps();
    const e = Object.assign(new Error('gateway'), { status: 502 });
    (d.portas.empurrarFiscalSku as ReturnType<typeof vi.fn>).mockRejectedValue(e);
    const r = await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(r.status).toBe(500);
  });
  it('replay: segunda chamada com mesmo job repete upsert sem efeito colateral novo (idempotente)', async () => {
    const d = deps();
    await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(d.portas.empurrarFiscalSku).toHaveBeenCalledTimes(2); // PUT-upsert: replay é inofensivo
  });
});
```

(No teste "org sem módulo", montar um `deps` variante cujo fake de `organizations` devolve `[]` e asserir `empurrarFiscalSku` não chamado + `r.status === 200`.)

- [ ] **Step 2: Ver falhar** — `pnpm test -- sincronizar-fiscal` → FAIL.

- [ ] **Step 3: Implementar `_shared/canais/fiscal-ml.ts`**

```ts
// ADR-0135 D-1 — porta de dados fiscais do canal ML (fiscal_information + can_invoice).
// Payload conforme developers.mercadolivre.com.br/pt_br/envio-dos-dados-fiscais.
// ⚠ Semântica de upsert (POST→409→PUT) e unidades de peso: "A verificar #2" do ADR —
// validar em conta real antes de ligar para cliente.
const BASE = 'https://api.mercadolibre.com';

function erroMl(op: string, status: number, corpo: string): Error & { status: number } {
  const e = new Error(`${op} → ${status}: ${corpo.slice(0, 300)}`) as Error & { status: number };
  e.status = status;
  return e;
}

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
});

export interface FamiliaFiscalPush {
  nome_pai: string; unidade: string | null; ncm: string | null; cest: string | null;
  origem_nfe: number | null; fci: string | null; ex_tipi: string | null;
  tributacao_icms: string | null;
}
export interface VariacaoFiscalPush {
  codigo: string; gtin: string | null; peso_gramas: number | null; ml_variation_id: string | null;
}

export function montarFiscalInformation(
  familia: FamiliaFiscalPush,
  variacao: VariacaoFiscalPush,
  empresa: { origin_type: string | null },
): Record<string, unknown> {
  const tax: Record<string, unknown> = {
    ncm: familia.ncm,
    origin_detail: String(familia.origem_nfe),
    csosn: familia.tributacao_icms, // v1 é Simples-only; o gate (D-7) garante isso antes.
  };
  if (familia.cest) tax.cest = familia.cest;
  if (familia.fci) tax.fci = familia.fci;
  if (familia.ex_tipi) tax.ex_tipi = familia.ex_tipi;
  if (variacao.gtin) tax.ean = variacao.gtin;
  return {
    sku: variacao.codigo,
    title: familia.nome_pai,
    type: 'single',
    measurement_unit: (familia.unidade ?? 'UN').toUpperCase().trim(),
    origin_type: empresa.origin_type,
    ...(variacao.peso_gramas != null
      ? { gross_weight: Number((variacao.peso_gramas / 1000).toFixed(3)) }
      : {}),
    tax_information: tax,
  };
}

/** Upsert por SKU: POST cria; 409 (SKU já existe) → PUT atualiza. Idempotente por natureza. */
export async function empurrarFiscalSku(token: string, payload: Record<string, unknown>): Promise<void> {
  const post = await fetch(`${BASE}/items/fiscal_information`, {
    method: 'POST', headers: headers(token), body: JSON.stringify(payload),
  });
  if (post.ok) return;
  if (post.status === 409) {
    const put = await fetch(`${BASE}/items/fiscal_information/${payload.sku}`, {
      method: 'PUT', headers: headers(token), body: JSON.stringify(payload),
    });
    if (put.ok) return;
    throw erroMl('PUT fiscal_information', put.status, await put.text());
  }
  throw erroMl('POST fiscal_information', post.status, await post.text());
}

export async function vincularSkuAnuncio(
  token: string, v: { sku: string; item_id: string; variation_id?: string },
): Promise<void> {
  const resp = await fetch(`${BASE}/items/fiscal_information/items`, {
    method: 'POST', headers: headers(token), body: JSON.stringify(v),
  });
  // 409 = vínculo já existe (replay do QStash) — sucesso idempotente.
  if (resp.ok || resp.status === 409) return;
  throw erroMl('POST fiscal_information/items', resp.status, await resp.text());
}

export async function lerCanInvoice(
  token: string, itemId: string,
): Promise<{ pronto: boolean; causa: string | null } | null> {
  const resp = await fetch(`${BASE}/can_invoice/items/${itemId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    console.warn(`can_invoice ${resp.status} para ${itemId}`);
    return null;
  }
  const j = await resp.json() as { status?: boolean } & Record<string, unknown>;
  const pronto = j.status === true;
  return { pronto, causa: pronto ? null : JSON.stringify(j).slice(0, 500) };
}
```

- [ ] **Step 4: Implementar o worker**

`sincronizar-fiscal-ml/processar.ts`:

```ts
// ADR-0135 — miolo do push fiscal, deps injetadas (padrão sincronizar-estoque).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { SincronizarFiscalJob } from '../_shared/queue.ts';
import {
  montarFiscalInformation, type FamiliaFiscalPush, type VariacaoFiscalPush,
} from '../_shared/canais/fiscal-ml.ts';

export interface DepsFiscal {
  admin: SupabaseClient;
  resolverConexao: (admin: SupabaseClient, orgId: string, canal: string) => Promise<{ id: string } | null>;
  getToken: (conexao: unknown) => Promise<string>;
  listarVariacoes: (admin: SupabaseClient, familiaId: string) => Promise<VariacaoFiscalPush[]>;
  portas: {
    empurrarFiscalSku: (token: string, payload: Record<string, unknown>) => Promise<void>;
    vincularSkuAnuncio: (token: string, v: { sku: string; item_id: string; variation_id?: string }) => Promise<void>;
    lerCanInvoice: (token: string, itemId: string) => Promise<{ pronto: boolean; causa: string | null } | null>;
  };
}

const ehTransitorio = (e: unknown): boolean => {
  const s = (e as { status?: number }).status;
  return s == null || s === 429 || s >= 500;
};

export async function processarSincronizacaoFiscal(
  deps: DepsFiscal, job: SincronizarFiscalJob,
): Promise<{ status: number; body: unknown }> {
  const { admin } = deps;
  const { data: familia } = await admin.from('familias')
    .select('id, org_id, nome_pai, ml_item_id, unidade, origem, ncm, cest, origem_nfe, fci, ex_tipi, tributacao_icms, tributacao_icms_regime')
    .eq('id', job.familia_id).single();
  if (!familia) return { status: 404, body: { erro: 'família não encontrada' } };

  const { data: org } = await admin.from('organizations')
    .select('modulos_habilitados').eq('id', familia.org_id).maybeSingle();
  if (!((org?.modulos_habilitados ?? []) as string[]).includes('fiscal')) {
    return { status: 200, body: { skip: 'org sem módulo fiscal' } };
  }
  const { data: empresa } = await admin.from('empresa_fiscal')
    .select('origin_type, regime_tributario').eq('org_id', familia.org_id).maybeSingle();

  const conexao = await deps.resolverConexao(admin, familia.org_id, 'mercado_livre');
  if (!conexao) return { status: 200, body: { erro: 'org sem conexão com o Mercado Livre' } };
  const token = await deps.getToken(conexao);
  const variacoes = await deps.listarVariacoes(admin, familia.id);
  const agora = () => new Date().toISOString();

  try {
    for (const v of variacoes) {
      const payload = montarFiscalInformation(familia as FamiliaFiscalPush, v, {
        origin_type: empresa?.origin_type ?? null,
      });
      await deps.portas.empurrarFiscalSku(token, payload);
      if (familia.ml_item_id) {
        await deps.portas.vincularSkuAnuncio(token, {
          sku: v.codigo, item_id: familia.ml_item_id,
          ...(v.ml_variation_id ? { variation_id: v.ml_variation_id } : {}),
        });
      }
    }
  } catch (e) {
    if (ehTransitorio(e)) {
      // 5xx/timeout: 500 (texto) → QStash retenta; o upsert torna o replay inofensivo.
      return { status: 500, body: (e as Error).message };
    }
    // 4xx: definitivo — pendência visível no semáforo, sem retry (D-9 do ADR-0114, herdado).
    await admin.from('familias').update({
      can_invoice: false,
      can_invoice_causa: `push fiscal recusado: ${(e as Error).message}`,
      can_invoice_em: agora(),
    }).eq('id', familia.id);
    return { status: 200, body: { erro: (e as Error).message } };
  }

  if (familia.ml_item_id) {
    const pront = await deps.portas.lerCanInvoice(token, familia.ml_item_id);
    if (pront) {
      await admin.from('familias').update({
        can_invoice: pront.pronto, can_invoice_causa: pront.causa, can_invoice_em: agora(),
      }).eq('id', familia.id);
    }
  }
  await admin.from('familias').update({ fiscal_sincronizado_em: agora() }).eq('id', familia.id);
  return { status: 200, body: { ok: true } };
}
```

`sincronizar-fiscal-ml/index.ts` — casca idêntica à de `sincronizar-estoque/index.ts` (assinatura QStash + parse + delegação), com as deps reais:

```ts
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura, type SincronizarFiscalJob } from '../_shared/queue.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { empurrarFiscalSku, lerCanInvoice, vincularSkuAnuncio } from '../_shared/canais/fiscal-ml.ts';
import { processarSincronizacaoFiscal } from './processar.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  let job: SincronizarFiscalJob;
  try { job = JSON.parse(body); }
  catch { return new Response('Body inválido', { status: 400, headers: corsHeaders }); }

  const r = await processarSincronizacaoFiscal({
    admin: adminClient(),
    resolverConexao,
    getToken: (cx) => getValidAccessTokenConexao(cx as never),
    listarVariacoes: async (admin, familiaId) => {
      const { data } = await admin.from('variacoes')
        .select('codigo, gtin, peso_gramas, ml_variation_id').eq('familia_id', familiaId);
      return data ?? [];
    },
    portas: { empurrarFiscalSku, vincularSkuAnuncio, lerCanInvoice },
  }, job);
  return new Response(
    typeof r.body === 'string' ? r.body : JSON.stringify(r.body),
    { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
```

`queue.ts` (ao lado de `enfileirarFamilia`, copiando a construção de URL dele):

```ts
export interface SincronizarFiscalJob { familia_id: string }

/** ADR-0135: push dos dados fiscais da família pro ML (worker sincronizar-fiscal-ml). */
export async function enfileirarSincronizacaoFiscal(familiaId: string): Promise<string> {
  const target = `${Deno.env.get('SUPABASE_URL')!}/functions/v1/sincronizar-fiscal-ml`;
  const { messageId } = await qstashClient().publishJSON({
    url: target,
    body: { familia_id: familiaId } satisfies SincronizarFiscalJob,
    retries: 3,
  });
  return messageId;
}
```

(⚠ conferir como `enfileirarFamilia` monta o `target` em `queue.ts:39` e usar a MESMA forma — se lá for outra env/base, seguir a existente.)

`publish-familia-ml/processar.ts`, após persistir `ml_item_id` (~linha 190), usando o `fiscalAtivo` da Task 6:

```ts
    // ADR-0135: push fiscal pós-publicação. Falha de enqueue NÃO desfaz a publicação (spec §3).
    if (fiscalAtivo) {
      try { await enfileirarSincronizacaoFiscal(job.familia_id); }
      catch (e) { console.error('enfileirar push fiscal falhou:', (e as Error).message); }
    }
```

Mesmo bloco no update (`update-familia-ml/processar.ts`), no caminho de sucesso do UPDATE, guardado pelo `fiscalAtivo` da Task 6.

`supabase/config.toml` (após a última entrada):

```toml
# ADR-0135: worker QStash do push fiscal (fiscal_information + can_invoice).
[functions.sincronizar-fiscal-ml]
verify_jwt = false
```

- [ ] **Step 5: Ver passar** — `pnpm test -- sincronizar-fiscal` → PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/canais/fiscal-ml.ts supabase/functions/sincronizar-fiscal-ml/ supabase/functions/_shared/queue.ts supabase/functions/publish-familia-ml/processar.ts supabase/functions/update-familia-ml/processar.ts supabase/config.toml
git commit -m "feat(fiscal): porta fiscal do ML + worker de push por SKU + semáforo can_invoice (ADR-0135 D-1)"
```

---

### Task 8: Reconciliação do `can_invoice` no `monitorar-moderados`

**Files:**
- Modify: `supabase/functions/monitorar-moderados/index.ts` (novo passo por conexão)
- Test: `supabase/functions/monitorar-moderados/__tests__/can-invoice.test.ts`

**Interfaces:**
- Consumes: `lerCanInvoice` (Task 7).
- Produces: `reconciliarCanInvoice(admin, orgId, token, lerFn): Promise<number>` — exportada do próprio `index.ts` (ou arquivo irmão `can-invoice.ts` se o index não exportar nada hoje; seguir o estilo do arquivo).

- [ ] **Step 1: Teste (falhando)**

```ts
import { describe, expect, it, vi } from 'vitest';
import { reconciliarCanInvoice } from '../can-invoice.ts';

describe('reconciliarCanInvoice (ADR-0135 D-10 — o estado exibido é o do ML)', () => {
  it('só roda para org com módulo; grava can_invoice por família publicada', async () => {
    const updates: Array<{ id: string; can_invoice: boolean }> = [];
    const admin = {
      from: (t: string) => ({
        select: () => ({
          eq: (_c: string, _v: unknown) => ({
            maybeSingle: async () => ({ data: { modulos_habilitados: ['fiscal'] } }),
            not: () => ({
              eq: async () => ({ data: [{ id: 'f1', ml_item_id: 'MLB1' }, { id: 'f2', ml_item_id: 'MLB2' }] }),
            }),
          }),
        }),
        update: (patch: { can_invoice: boolean }) => ({
          eq: async (_c: string, id: string) => { updates.push({ id, ...patch }); return { error: null }; },
        }),
      }),
    } as never;
    const ler = vi.fn(async (_t: string, itemId: string) =>
      ({ pronto: itemId === 'MLB1', causa: itemId === 'MLB1' ? null : '{"status":false}' }));
    const n = await reconciliarCanInvoice(admin, 'o1', 'tok', ler);
    expect(n).toBe(2);
    expect(updates.find((u) => u.id === 'f1')?.can_invoice).toBe(true);
    expect(updates.find((u) => u.id === 'f2')?.can_invoice).toBe(false);
  });
});
```

- [ ] **Step 2: Ver falhar** — FAIL.

- [ ] **Step 3: Implementar `monitorar-moderados/can-invoice.ts`**

```ts
// ADR-0135 D-10 — reconciliação do semáforo fiscal, pendurada no worker de status (6/6h).
// Decisão de execução: o cron horário (reconciliar-faturamento) tem orçamento de 120s já
// apertado; o push fiscal atualiza o semáforo na hora, então 6h só afeta mudança por fora.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

type LerCanInvoice = (token: string, itemId: string) =>
  Promise<{ pronto: boolean; causa: string | null } | null>;

export async function reconciliarCanInvoice(
  admin: SupabaseClient, orgId: string, token: string, ler: LerCanInvoice,
): Promise<number> {
  const { data: org } = await admin.from('organizations')
    .select('modulos_habilitados').eq('id', orgId).maybeSingle();
  if (!((org?.modulos_habilitados ?? []) as string[]).includes('fiscal')) return 0;

  const { data: familias } = await admin.from('familias')
    .select('id, ml_item_id').eq('org_id', orgId).not('ml_item_id', 'is', null)
    .eq('status', 'publicado');
  let atualizadas = 0;
  for (const f of familias ?? []) {
    const pront = await ler(token, f.ml_item_id as string);
    if (!pront) continue; // falha de leitura não regride o estado gravado
    const { error } = await admin.from('familias').update({
      can_invoice: pront.pronto, can_invoice_causa: pront.causa,
      can_invoice_em: new Date().toISOString(),
    }).eq('id', f.id);
    if (!error) atualizadas += 1;
  }
  return atualizadas;
}
```

(Ajustar a cadeia do fake/real: se o encadeamento `.not().eq()` do PostgREST diferir, inverter a ordem — o teste acompanha o código real.)

Fiar no `monitorar-moderados/index.ts`, dentro do loop de conexões (após `processarConexao`, onde `admin`, `orgId` e o token já existem — espelhar a linha 55 que monta o token):

```ts
    try {
      const n = await reconciliarCanInvoice(admin, orgId, token, (t, id) => lerCanInvoice(t, id));
      if (n > 0) console.log(`can_invoice reconciliado: ${n} famílias (org ${orgId})`);
    } catch (e) { console.warn('reconciliar can_invoice falhou:', (e as Error).message); }
```

- [ ] **Step 4: Ver passar** — `pnpm test -- can-invoice` → PASS.
- [ ] **Step 5: Commit**

```bash
git add supabase/functions/monitorar-moderados/
git commit -m "feat(fiscal): reconciliação do can_invoice no worker de status (ADR-0135 D-10)"
```

---

### Task 9: Edge `atualizar-fiscal-familia` (edição fiscal + re-push)

**Files:**
- Create: `supabase/functions/atualizar-fiscal-familia/index.ts` + `processar.ts`
- Modify: `supabase/config.toml`
- Test: `supabase/functions/atualizar-fiscal-familia/__tests__/processar.test.ts`

**Interfaces:**
- Consumes: `requireUserOrg`, `exigirModulo`, `camposFiscaisFaltantes`, `enfileirarSincronizacaoFiscal`.
- Produces: edge POST `{ familiaId: string; fiscal: { ncm; cest?; origemNfe; fci?; exTipi?; tributacaoIcms } }` → `200 { ok: true, pushEnfileirado: boolean }` | `400 { erros: [{ campo, mensagem }] }` | `403 | 404`. Usada pelo front (Tasks 12–14).

- [ ] **Step 1: Teste do miolo (falhando)** — `processarAtualizacaoFiscal(deps, entrada)` com deps injetadas; casos: (a) família de outra org → 404; (b) fiscal incompleto → lista de erros, nada gravado; (c) completo → update com `tributacao_icms_regime` = regime da org e `pushEnfileirado=true` quando `ml_item_id` existe; (d) família não publicada → grava sem enfileirar. Estrutura de fakes igual à Task 7.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar**

`processar.ts`:

```ts
// ADR-0135 D-9 — edição fiscal de família existente (o "modo edição" que faltava).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { camposFiscaisFaltantes } from '../_shared/fiscal/validar.ts';

export interface EntradaFiscal {
  familiaId: string;
  fiscal: {
    ncm: string; cest?: string | null; origemNfe: number;
    fci?: string | null; exTipi?: string | null; tributacaoIcms: string;
  };
}
export interface DepsAtualizarFiscal {
  admin: SupabaseClient;
  orgId: string;
  enfileirarPush: (familiaId: string) => Promise<string>;
}
export type ResultadoFiscal =
  | { tipo: 'nao_encontrada' }
  | { tipo: 'invalido'; erros: string[] }
  | { tipo: 'ok'; pushEnfileirado: boolean };

export async function processarAtualizacaoFiscal(
  deps: DepsAtualizarFiscal, entrada: EntradaFiscal,
): Promise<ResultadoFiscal> {
  const { admin, orgId } = deps;
  const { data: familia } = await admin.from('familias')
    .select('id, org_id, nome_pai, unidade, origem, ml_item_id, status')
    .eq('id', entrada.familiaId).eq('org_id', orgId).maybeSingle();
  if (!familia) return { tipo: 'nao_encontrada' };

  const { data: emp } = await admin.from('empresa_fiscal')
    .select('regime_tributario').eq('org_id', orgId).maybeSingle();
  const regime = (emp?.regime_tributario ?? 'simples') as 'simples' | 'normal';

  const f = entrada.fiscal;
  const erros = camposFiscaisFaltantes({
    ncm: f.ncm ?? null, cest: f.cest ?? null, origem_nfe: f.origemNfe ?? null,
    fci: f.fci ?? null, ex_tipi: f.exTipi ?? null,
    tributacao_icms: f.tributacaoIcms ?? null, tributacao_icms_regime: regime,
    unidade: familia.unidade, origem: familia.origem,
  }, regime);
  if (erros.length) return { tipo: 'invalido', erros };

  const { error } = await admin.from('familias').update({
    ncm: f.ncm, cest: f.cest?.trim() || null, origem_nfe: f.origemNfe,
    fci: f.fci?.trim() || null, ex_tipi: f.exTipi?.trim() || null,
    tributacao_icms: f.tributacaoIcms, tributacao_icms_regime: regime,
    atualizado_em: new Date().toISOString(),
  }).eq('id', familia.id);
  if (error) return { tipo: 'invalido', erros: [error.message] };

  let pushEnfileirado = false;
  if (familia.ml_item_id) {
    try { await deps.enfileirarPush(familia.id); pushEnfileirado = true; }
    catch (e) { console.error('push fiscal não enfileirado:', (e as Error).message); }
  }
  return { tipo: 'ok', pushEnfileirado };
}
```

`index.ts` — casca com `requireUserOrg({ access: 'write' })` (padrão `cadastrar-produto/index.ts:32-41`), depois `exigirModulo(admin, orgId, 'fiscal')` → 403 `"Módulo fiscal não habilitado para esta organização."`, parse do body, delega e mapeia: `nao_encontrada`→404, `invalido`→400 `{ erros: erros.map((mensagem) => ({ campo: 'fiscal', mensagem })) }`, `ok`→200.

`config.toml`:

```toml
# ADR-0135: edição dos campos fiscais da família, chamada pelo APP com JWT.
[functions.atualizar-fiscal-familia]
verify_jwt = true
```

- [ ] **Step 4: Ver passar** — `pnpm test -- atualizar-fiscal` → PASS.
- [ ] **Step 5: Commit** — `git add supabase/functions/atualizar-fiscal-familia/ supabase/config.toml && git commit -m "feat(fiscal): edge de edição fiscal com re-push (ADR-0135 D-9)"`

---

### Task 10: Edge `sugerir-ncm` (IA sugere, NUNCA grava)

**Files:**
- Create: `supabase/functions/sugerir-ncm/index.ts` + `prompt.ts`
- Modify: `supabase/config.toml`
- Test: `supabase/functions/sugerir-ncm/__tests__/prompt.test.ts`

**Interfaces:**
- Consumes: `openrouterClient`, `resolverModeloTexto`, `requireUserOrg`, `exigirModulo`.
- Produces: POST com **dois formatos de body** — `{ familiaId: string }` (família existente: a edge carrega `nome_pai, descricao_pai, categoria_nome`) **ou** `{ nome: string, descricao?: string, categoria?: string }` (cadastro em andamento, família ainda não existe — usado pela etapa fiscal do dialog, Task 12). Resposta única: `200 { ncm: string | null, justificativa: string }`. **Nenhuma escrita em banco** — a confirmação é do operador (D-9).

- [ ] **Step 1: Teste do parser (falhando)** — `prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extrairSugestaoNcm, montarPromptNcm } from '../prompt.ts';

describe('sugerir-ncm — parser defensivo (a IA sugere, nunca decide)', () => {
  it('NCM de 8 dígitos passa', () => {
    expect(extrairSugestaoNcm('{"ncm":"39269090","justificativa":"artigo de plástico"}'))
      .toEqual({ ncm: '39269090', justificativa: 'artigo de plástico' });
  });
  it('NCM fora do formato vira null (nunca um chute mascarado de certeza)', () => {
    expect(extrairSugestaoNcm('{"ncm":"3926.90","justificativa":"x"}').ncm).toBeNull();
    expect(extrairSugestaoNcm('nao é json').ncm).toBeNull();
  });
  it('prompt inclui nome, descrição e categoria', () => {
    const p = montarPromptNcm({ nome: 'Zíper 20cm', descricao: 'Zíper de nylon', categoria: 'Aviamentos' });
    expect(p).toContain('Zíper 20cm');
    expect(p).toContain('Aviamentos');
  });
});
```

- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar**

`prompt.ts`:

```ts
// ADR-0135 D-9 — a IA SUGERE o NCM; gravar é ato do operador, sempre.
export function montarPromptNcm(p: { nome: string; descricao: string | null; categoria: string | null }): string {
  return [
    `Produto: ${p.nome}`,
    p.descricao ? `Descrição: ${p.descricao.slice(0, 500)}` : null,
    p.categoria ? `Categoria no Mercado Livre: ${p.categoria}` : null,
    'Sugira o NCM (Nomenclatura Comum do Mercosul, 8 dígitos) mais provável para este produto',
    'vendido no varejo brasileiro. Responda APENAS JSON: {"ncm":"XXXXXXXX","justificativa":"..."}.',
    'Se não tiver confiança razoável, responda {"ncm":null,"justificativa":"motivo"}.',
  ].filter(Boolean).join('\n');
}

export function extrairSugestaoNcm(raw: string): { ncm: string | null; justificativa: string } {
  try {
    const j = JSON.parse(raw) as { ncm?: unknown; justificativa?: unknown };
    const ncm = typeof j.ncm === 'string' && /^\d{8}$/.test(j.ncm) ? j.ncm : null;
    return { ncm, justificativa: typeof j.justificativa === 'string' ? j.justificativa : '' };
  } catch {
    return { ncm: null, justificativa: 'resposta da IA fora do formato esperado' };
  }
}
```

`index.ts`: `requireUserOrg` → `exigirModulo(admin, orgId, 'fiscal')` → carrega `familias.select('nome_pai, descricao_pai, categoria_nome').eq('id', familiaId).eq('org_id', orgId)` (404 se nada) → chamada no padrão de `atributos-llm.ts:13-39` (`response_format: { type: 'json_object' }`, `temperature: 0`, `AbortSignal.timeout(30_000)`, modelo de `resolverModeloTexto(admin, orgId)`) → `extrairSugestaoNcm` → `json({ ncm, justificativa })`. Erro do OpenRouter → `json({ ncm: null, justificativa: 'sugestão indisponível agora — preencha manualmente' })` (200; a sugestão é conveniência, nunca bloqueio).

`config.toml`:

```toml
# ADR-0135: sugestão de NCM por IA — só sugere, nunca grava; chamada pelo APP com JWT.
[functions.sugerir-ncm]
verify_jwt = true
```

- [ ] **Step 4: Ver passar** — `pnpm test -- sugerir-ncm` → PASS.
- [ ] **Step 5: Commit** — `git add supabase/functions/sugerir-ncm/ supabase/config.toml && git commit -m "feat(fiscal): edge sugerir-ncm — IA sugere, operador confirma (ADR-0135 D-9)"`

---

### Task 11: Front — card "Empresa" em /configuracoes

**Files:**
- Create: `src/lib/fiscal.ts`
- Modify: `src/lib/queries.ts` (fetch/upsert empresa_fiscal)
- Modify: `src/hooks/useConfiguracoes.ts` (2 hooks novos)
- Modify: `src/pages/Configuracoes.tsx` (card novo)
- Test: `tests/pages/ConfiguracoesEmpresa.test.tsx` + atualizar o `vi.mock('@/hooks/useConfiguracoes')` de `tests/pages/Configuracoes.test.tsx` (todo hook novo precisa entrar lá, senão quebra)

**Interfaces:**
- Consumes: tabela `empresa_fiscal` via PostgREST (policies da Task 1), `effectiveOrgId()`, padrão `onBlur` + `✓ Salvo` do card de alíquotas.
- Produces:
  - `src/lib/fiscal.ts`: `ORIGENS_NFE_POR_ORIGEM`, `UNIDADES_FISCAIS`, `validarCnpj` — **duplicata deliberada** do `_shared/fiscal/validar.ts` (Deno não compartilha módulo com o front; mesmo precedente de `notificacoes-categorias`). Comentário cruzado nos dois arquivos: "manter em sincronia".
  - `queries.ts`: `type EmpresaFiscalRow = Database['public']['Tables']['empresa_fiscal']['Row']`; `fetchEmpresaFiscal(): Promise<EmpresaFiscalRow | null>`; `upsertEmpresaFiscal(patch: Partial<EmpresaFiscalRow>): Promise<void>` (upsert `{ org_id, ...patch, atualizado_em }` com `onConflict: 'org_id'`).
  - hooks: `useEmpresaFiscal()` (queryKey `['configuracoes', 'empresa-fiscal']`), `useSalvarEmpresaFiscal()` (mutation + invalidate).

- [ ] **Step 1: Teste (falhando)** — `ConfiguracoesEmpresa.test.tsx`, padrão A de `Configuracoes.test.tsx` (mock do módulo de hooks inteiro, incluindo TODOS os hooks existentes + os 2 novos):

```tsx
// (mocks idênticos aos de Configuracoes.test.tsx, acrescentando:)
const salvarEmpresa = vi.fn();
vi.mock('@/hooks/useConfiguracoes', () => ({
  /* ...todos os hooks já mockados no Configuracoes.test.tsx... */
  useEmpresaFiscal: () => ({ data: { cnpj: null, razao_social: null, regime_tributario: null } }),
  useSalvarEmpresaFiscal: () => ({ mutate: salvarEmpresa, isPending: false, isSuccess: false }),
}));

it('card Empresa aparece e salva CNPJ válido no blur', () => {
  renderPage();
  const cnpj = screen.getByLabelText(/CNPJ/i);
  fireEvent.change(cnpj, { target: { value: '11.222.333/0001-81' } });
  fireEvent.blur(cnpj);
  expect(salvarEmpresa).toHaveBeenCalledWith(expect.objectContaining({ cnpj: '11222333000181' }));
});

it('CNPJ com dígito errado não salva e mostra o erro', () => {
  renderPage();
  const cnpj = screen.getByLabelText(/CNPJ/i);
  fireEvent.change(cnpj, { target: { value: '11222333000180' } });
  fireEvent.blur(cnpj);
  expect(salvarEmpresa).not.toHaveBeenCalled();
  expect(screen.getByText(/dígito verificador/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar**

Card em `Configuracoes.tsx` (dentro do container `max-w-2xl`, após o card de imposto). Helper local para não repetir 18 inputs:

```tsx
function CampoEmpresa({ id, rotulo, valor, onSalvar, disabled, placeholder, erro, largura = 'w-full' }: {
  id: string; rotulo: string; valor: string; disabled: boolean;
  onSalvar: (v: string) => void; placeholder?: string; erro?: string | null; largura?: string;
}) {
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium">{rotulo}</label>
      <Input id={id} className={cn('h-8 text-sm', largura)} value={v} placeholder={placeholder}
        disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={() => onSalvar(v)} />
      {erro && <p className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}
```

O card:
- Título "Empresa"; linha informativa com o tipo da org — o front não tem `organizations` no PostgREST, então o tipo chega por um select leve: `supabase.from('organizations').select('tipo_pessoa').eq('id', orgId)` **não existe para authenticated** → usar o dado já disponível: adicionar `tipo_pessoa` à resposta de `modulos_habilitados_da_org`? Não — mais simples: nova RPC não; o card mostra o bloco fiscal **quando `useEmpresaFiscal()` retorna acesso** e uma nota fixa: "Emissão fiscal exige organização PJ — quem marca é o administrador da plataforma." (O gate real é a ativação; a UI não precisa do tipo para funcionar.)
- Grupos: **Identidade** (CNPJ com `validarCnpj` no blur — inválido mostra erro e não salva; razão social; nome fantasia; IE; regime `<select>` simples/normal), **Endereço** (CEP, logradouro, número, complemento, bairro, município, código IBGE com validação `^\d{7}$`, UF 2 letras uppercase), **Operação fiscal** (natureza da operação, CFOP dentro/fora/contribuinte-opcional, CST PIS, CST COFINS, `origin_type` `<select>` com rótulos "Fabricante/Revendedor/Importador"), **Emissão** (`emissao_a_partir_de` `<input type="date">` com a legenda "Vendas anteriores a esta data nunca entram no fluxo fiscal").
- Cada campo salva patch individual via `salvarEmpresa.mutate({ campo: valor })` no blur; indicador `✓ Salvo` idêntico ao card de alíquotas.
- Rodapé fixo (instrução das pernas manuais): "No painel do Mercado Livre (Preferências de venda → Emissor de NF-e): ativar o Faturador, enviar o certificado A1 e configurar a série. O PubliAI verifica a prontidão pelo próprio ML (semáforo nos Publicados)."
- `disabled={!isAdmin}` em tudo (mesma regra do card de alíquotas).

- [ ] **Step 4: Ver passar** — `pnpm test -- Configuracoes` → PASS (os dois arquivos).
- [ ] **Step 5: Commit** — `git add src/lib/fiscal.ts src/lib/queries.ts src/hooks/useConfiguracoes.ts src/pages/Configuracoes.tsx tests/pages/ && git commit -m "feat(fiscal): card Empresa em /configuracoes (ADR-0135 D-3)"`

---

### Task 12: Front — etapa fiscal no dialog de cadastro

**Files:**
- Create: `src/components/estoque/etapa-fiscal-form.tsx`
- Modify: `src/components/estoque/dialog-cadastro-produto.tsx`
- Modify: `src/lib/produtos-saldo.ts` (`montarPayload`/tipos — `ProdutoEntrada.fiscal`)
- Test: `src/components/estoque/__tests__/etapa-fiscal-form.test.tsx`

**Interfaces:**
- Consumes: `useModulosHabilitados`, `ORIGENS_NFE_POR_ORIGEM`/`UNIDADES_FISCAIS` (`src/lib/fiscal.ts`), edge `sugerir-ncm` (via `supabase.functions.invoke`), padrão visual de sugestão de `card-categoria.tsx` (botão-cartão + `StatusPill` info + `Sparkles`).
- Produces:

```tsx
export interface FiscalForm {
  ncm: string; cest: string; origemNfe: string; fci: string; exTipi: string; tributacaoIcms: string;
}
export function fiscalVazio(): FiscalForm;
export function fiscalCompleto(f: FiscalForm, origem: 'nacional' | 'importado' | null): boolean;
export function EtapaFiscalForm(props: {
  valor: FiscalForm;
  origem: 'nacional' | 'importado' | null;
  onMudar: (patch: Partial<FiscalForm>) => void;
  sugestaoNcm: { ncm: string; justificativa: string } | null;
  carregandoSugestao: boolean;
  onAplicarSugestao: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Testes do form (falhando)**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EtapaFiscalForm, fiscalCompleto, fiscalVazio } from '../etapa-fiscal-form';

describe('EtapaFiscalForm (ADR-0135 D-9)', () => {
  it('origem nacional só oferece códigos 0/3/4/5/8 no select de origem fiscal', () => {
    render(<EtapaFiscalForm valor={fiscalVazio()} origem="nacional" onMudar={vi.fn()}
      sugestaoNcm={null} carregandoSugestao={false} onAplicarSugestao={vi.fn()} />);
    const select = screen.getByLabelText(/origem fiscal/i) as HTMLSelectElement;
    const valores = Array.from(select.options).map((o) => o.value).filter(Boolean);
    expect(valores).toEqual(['0', '3', '4', '5', '8']);
  });
  it('sugestão de NCM aparece marcada como sugestão e só entra no clique', () => {
    const aplicar = vi.fn();
    render(<EtapaFiscalForm valor={fiscalVazio()} origem="nacional" onMudar={vi.fn()}
      sugestaoNcm={{ ncm: '39269090', justificativa: 'plástico' }} carregandoSugestao={false}
      onAplicarSugestao={aplicar} />);
    expect(screen.getByText(/Sugerida por IA — confira/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /39269090/ }));
    expect(aplicar).toHaveBeenCalled();
  });
  it('fiscalCompleto exige ncm 8 dígitos + origemNfe coerente + csosn', () => {
    expect(fiscalCompleto(fiscalVazio(), 'nacional')).toBe(false);
    expect(fiscalCompleto({ ...fiscalVazio(), ncm: '39269090', origemNfe: '0', tributacaoIcms: '102' }, 'nacional')).toBe(true);
    expect(fiscalCompleto({ ...fiscalVazio(), ncm: '39269090', origemNfe: '1', tributacaoIcms: '102' }, 'nacional')).toBe(false);
  });
});
```

- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar `etapa-fiscal-form.tsx`**

Campos: NCM (`Input` com máscara só-dígitos, maxLength 8, hint "8 dígitos — a Nomenclatura Comum do Mercosul do produto"); botão-cartão de sugestão (padrão `SugestaoCatalogo` de `card-categoria.tsx:18-50`: `border-info/40 bg-info/5`, spinner quando `carregandoSugestao`, texto `Sugestão (IA): {ncm} — {justificativa}`) + `StatusPill tone="info"` com `Sparkles` "Sugerida por IA — confira" enquanto o valor do campo for igual ao sugerido; **origem fiscal** `<select aria-label="Origem fiscal (NF-e)">` com opções filtradas por `ORIGENS_NFE_POR_ORIGEM[origem]` e rótulos oficiais (0 Nacional; 1 Estrangeira – importação direta; 2 Estrangeira – adquirida no mercado interno; 3 Nacional >40% importado; 4 Nacional – processos básicos; 5 Nacional ≤40% importado; 6 Estrangeira – importação direta sem similar; 7 Estrangeira – mercado interno sem similar; 8 Nacional >70% importado); **CSOSN** `<select>` (101, 102, 103, 201, 202, 203, 300, 400, 500, 900 — com rótulo curto por código); CEST (opcional, 7 dígitos); FCI (visível só quando origemNfe ∈ {3,5,8}, obrigatório nesse caso); EX TIPI (opcional). `fiscalCompleto` valida com as mesmas regras do backend (`/^\d{8}$/`, coerência, csosn não vazio, fci condicional).

- [ ] **Step 4: Integrar no `dialog-cadastro-produto.tsx`**

1. `const { data: modulos } = useModulosHabilitados(); const fiscalAtivo = !!modulos?.includes('fiscal');`
2. Estados novos: `const [etapaFiscal, setEtapaFiscal] = useState(false);` `const [fiscal, setFiscal] = useState<FiscalForm>(fiscalVazio());` `const [sugestaoNcm, setSugestaoNcm] = useState<{ncm: string; justificativa: string} | null>(null);` (resetar ambos no `useEffect` de fechar, linhas 157-173).
3. Título (linha ~351): sem módulo, intacto; com módulo — `Cadastrar produto · etapa ${etapaFiscal ? 2 : 1} de 3` e a tela de fotos vira `etapa 3 de 3`.
4. Corpo: a ramificação `{!resultado ? ... : ...}` ganha o caso intermediário — `{!resultado && !etapaFiscal && (etapa 1 atual)} {!resultado && etapaFiscal && <EtapaFiscalForm ... />} {resultado && (fotos)}`.
5. Footer (linhas 636-659): sem módulo, intacto. Com módulo: etapa 1 → `Cancelar` + `Avançar` (`disabled={!podeSalvar}`, `onClick={() => setEtapaFiscal(true)}`); etapa fiscal → `Voltar` (`onClick={() => setEtapaFiscal(false)}`) + `Cadastrar` (`disabled={!fiscalCompleto(fiscal, origem) || salvando}`).
6. Ao entrar na etapa fiscal, disparar a sugestão (uma vez): `supabase.functions.invoke('sugerir-ncm', ...)` **não serve** — a família ainda não existe. Para o cadastro novo, a sugestão usa nome/descrição digitados: chamar a edge com `{ nome: nomePai, descricao: descricaoPai }` — **ajuste na Task 10**: o body aceita `{ familiaId }` OU `{ nome, descricao, categoria? }` (quando sem `familiaId`, monta o prompt direto dos campos; mesma resposta). Executor da Task 10 já implementa os dois formatos.
7. `montarPayload` (produtos-saldo/dialog): quando `fiscalAtivo`, incluir `fiscal: { ncm: fiscal.ncm, cest: fiscal.cest || null, origemNfe: Number(fiscal.origemNfe), fci: fiscal.fci || null, exTipi: fiscal.exTipi || null, tributacaoIcms: fiscal.tributacaoIcms }` no `ProdutoEntrada` (tipo do front em `produtos-saldo.ts` espelha o da edge).
8. `viabilidade-linha.tsx:300` e `dialog-adicionar-variacao.tsx` não mudam (o segundo não passa pela etapa fiscal — variação herda o fiscal da família, D-4).

- [ ] **Step 5: Ver passar** — `pnpm test -- etapa-fiscal dialog-cadastro` → PASS (suíte existente do dialog intacta no caminho sem módulo).
- [ ] **Step 6: Commit** — `git add src/components/estoque/ src/lib/produtos-saldo.ts supabase/functions/sugerir-ncm/ && git commit -m "feat(fiscal): etapa fiscal no cadastro com sugestão de NCM confirmável (ADR-0135 D-9)"`

---

### Task 13: Front — dialog de edição fiscal + filtro "Fiscal pendente" + fila

**Files:**
- Create: `src/components/estoque/dialog-fiscal-produto.tsx`
- Modify: `src/lib/produtos-saldo.ts` (resumo ganha campos fiscais), `src/lib/produtos-saldo-filtro.ts`, `src/components/estoque/barra-filtros-estoque.tsx`, `src/pages/Estoque.tsx`
- Test: `src/components/estoque/__tests__/dialog-fiscal-produto.test.tsx` + teste do filtro em `tests/lib/` (seguir onde `filtrarProdutos` já é testado)

**Interfaces:**
- Consumes: `EtapaFiscalForm` (Task 12), edge `atualizar-fiscal-familia` (Task 9), edge `sugerir-ncm`.
- Produces:

```tsx
export function DialogFiscalProduto(props: {
  familiaId: string | null;          // null = fechado
  fila: string[];                    // ids ordenados dos pendentes (para "Salvar e próximo")
  onFechar: () => void;
  onAvancar: (proximoId: string) => void;
  onSalvo: () => void;               // invalidate da lista
}): JSX.Element;
```

- `FiltroEstoque` ganha `'fiscal-pendente'`; `filtrarProdutos` ganha o branch; `fetchProdutosEstoqueResumo` passa a selecionar `ncm, origem_nfe, tributacao_icms, can_invoice` e expõe `fiscalPendente: boolean` (`!ncm || origem_nfe == null || !tributacao_icms || can_invoice === false`).

- [ ] **Step 1: Testes (falhando)** — filtro: produto sem `ncm` aparece só em `fiscal-pendente` e em `todos`; dialog: carrega valores existentes, `Salvar` chama `atualizar-fiscal-familia` com o shape da Task 9, erro 400 da edge renderiza as mensagens, `Salvar e próximo` chama `onAvancar` com o próximo id da fila e só aparece quando `fila.length > 1`.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar**

`DialogFiscalProduto`: carrega a família via PostgREST (`supabase.from('familias').select('nome_pai, origem, ncm, cest, origem_nfe, fci, ex_tipi, tributacao_icms').eq('id', familiaId).maybeSingle()`), popula `FiscalForm`, renderiza `EtapaFiscalForm` (com sugestão via `sugerir-ncm` passando `{ familiaId }`), footer: `Fechar` + `Salvar` + (`fila.length > 1` ? `Salvar e próximo` : null). Salvar → `supabase.functions.invoke('atualizar-fiscal-familia', { body: { familiaId, fiscal: {...} } })` com `corpoDoErroDaEdge` para exibir os `erros`; sucesso → `toast.success('✓ Fiscal salvo')` + `onSalvo()`; "Salvar e próximo" → mesmo fluxo e depois `onAvancar(fila[fila.indexOf(familiaId)+1])`.

`Estoque.tsx`: estado `const [fiscalAberto, setFiscalAberto] = useState<string | null>(null);`; a fila = `lista.filter((p) => p.fiscalPendente).map((p) => p.familiaId)` (conferir o shape do resumo para o id correto); o filtro novo só aparece com `modulos?.includes('fiscal')` (prop nova `mostrarFiscal` na `BarraFiltrosEstoque`, rótulo "Fiscal pendente"); cada linha pendente ganha ação "Preencher fiscal" abrindo o dialog.

- [ ] **Step 4: Ver passar.** — `pnpm test -- fiscal-produto filtro` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(fiscal): edição fiscal em fila com Salvar e próximo (ADR-0135 D-9)"` (com os arquivos da task).

---

### Task 14: Front — badge fiscal nos Publicados + tipo_pessoa em /organizacoes

**Files:**
- Modify: `src/lib/publicados.ts` (item ganha `canInvoice: boolean | null` + `fiscalPendente`), `src/pages/Publicados.tsx`, `src/pages/Organizacoes.tsx`
- Test: `tests/pages/Publicados.test.tsx` (caso novo) — atenção aos dois `colSpan={9}` → `10` (linhas 359 e 876)

**Interfaces:**
- Consumes: `familias.can_invoice` (select do `usePublicados` — localizar o select em `src/lib/publicados.ts` e acrescentar a coluna), `StatusPill`, action `set_tipo_pessoa_org` (Task 3) via `callUsuarios`.
- Produces: `BadgeFiscal` no padrão `BadgeStatus` (`Publicados.tsx:74-101`); célula/coluna nova só quando a org tem o módulo (`useModulosHabilitados`).

- [ ] **Step 1: Teste (falhando)** — org com módulo: item com `canInvoice=false` mostra pill "Fiscal pendente" (tone danger) e o clique dispara o handler de preencher; item com `canInvoice=true` mostra "Fiscal OK"; org sem módulo: coluna ausente (header não contém "Fiscal").
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar**

```tsx
function BadgeFiscal({ canInvoice, onPreencher }: { canInvoice: boolean | null; onPreencher: () => void }) {
  if (canInvoice === true) return <StatusPill tone="success">Fiscal OK</StatusPill>;
  if (canInvoice === false) {
    return (
      <button type="button" onClick={onPreencher} className="text-left"
        title="O ML ainda não consegue emitir a nota deste anúncio — complete o cadastro fiscal.">
        <StatusPill tone="danger">Fiscal pendente</StatusPill>
      </button>
    );
  }
  return <StatusPill tone="neutral" title="Prontidão ainda não verificada pelo ML.">Fiscal —</StatusPill>;
}
```

Clique abre o `DialogFiscalProduto` (Task 13) com `familiaId` do item e `fila=[]`. Anúncio externo/migrado **sem família** (item sem `familiaId`): pill neutra "Sem cadastro fiscal — vincular a produto" (D-10, nunca some em silêncio). Header + os dois `colSpan` ajustados condicionalmente (coluna só existe com o módulo — manter `colSpan={temFiscal ? 10 : 9}`).

`Organizacoes.tsx`: na linha de cada org (a resposta de `list_orgs` agora traz `tipo_pessoa`), um `<select>` PF/PJ que chama `callUsuarios({ action: 'set_tipo_pessoa_org', org_id, tipo_pessoa })` e refaz a lista; erro da edge (ex.: módulo fiscal ligado) vira toast com a mensagem.

- [ ] **Step 4: Ver passar** — `pnpm test -- Publicados` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(fiscal): semáforo can_invoice nos Publicados e tipo_pessoa em /organizacoes (ADR-0135 D-10)"`

---

### Task 15: Docs, Graphify, gates finais e deploy

**Files:**
- Modify: `docs/reference/modelo-de-dados.md` (seção `## Fiscal (ADR-0135)` após Estoque: `empresa_fiscal`, colunas de `familias`, `organizations.tipo_pessoa` + constraint), `docs/reference/edge-functions.md` (3 funções novas + verify_jwt + nota de que **nenhum schedule novo** foi criado — `can_invoice` pega carona no `monitorar-moderados`), `docs/reference/glossario.md` (NCM, CSOSN, origem 0–8, Faturador do ML, `can_invoice`), `docs/explanation/arquitetura.md` (porta fiscal), `docs/project-status.md` + `docs/TASKS.md`, `obsidian-vault/06-Roadmap/Sprint Atual.md` e nota do módulo fiscal no vault
- Modify: planilha modelo/documentação do operador que lista as colunas (buscar onde `COLUNAS_OBRIGATORIAS` é documentado para o usuário — `docs/tutorials/`) e registrar `NCM/CEST/ORIGEM_NFE/CSOSN` como colunas da org fiscal

- [ ] **Step 1: Atualizar todos os docs acima** (conteúdo espelha o ADR-0135 e a spec — nada novo é decidido aqui).
- [ ] **Step 2: Gates finais**

Run: `pnpm lint && pnpm test && npx tsc -b --force && pnpm check:functions && pnpm build`
Expected: tudo verde (o `tsc -b --force` é o que reproduz o CI — build incremental mente).

- [ ] **Step 3: Graphify** — re-ingerir os arquivos novos/alterados e rodar `python3 scripts/graphify-podar-falsos.py --aplicar` + reclusterização (regra do CLAUDE.md).
- [ ] **Step 4: Commit + push da branch**

```bash
git add docs/ obsidian-vault/ graphify-out/
git commit -m "docs(fiscal): modelo de dados, edge functions, glossário e roadmap do módulo fiscal (ADR-0135)"
git push
```

- [ ] **Step 5: Deploy das edge functions (após merge na main — CI verde antes)**

Mudança em `_shared/` (fiscal/, canais/, queue.ts, produto/validar.ts, types.ts) → redeploy de **todas** as funções que importam esses módulos, além das novas:

```bash
supabase functions deploy usuarios cadastrar-produto ingest-lote publish-familia-ml update-familia-ml publicar-split-ml sincronizar-estoque sincronizar-fiscal-ml atualizar-fiscal-familia sugerir-ncm monitorar-moderados reconciliar-faturamento reconciliar-convergencia-up entrada-estoque adicionar-variacoes-familia
```

Conferir a versão pós-deploy de cada uma (regra do projeto: deploy nunca defasado). Nenhum schedule novo no QStash.

- [ ] **Step 6: Validação pós-deploy (runtime real, regra de fim de branch)** — org de teste (is_test): marcar PJ, preencher empresa, ligar módulo (esperar recusa com pendências ao faltar campo), cadastrar produto com fiscal, ver o gate recusar publicação sem NCM, e comparar a tela 1:1 (ultraqa/browser-use conforme memória de validação).

---

## Fora deste plano (V2 — já nomeadas no ADR-0135)

Consumo da nota emitida · entrada por XML do fornecedor · Regime Normal (`tax_rules`) · IE por UF (`state_registry`) · adaptador de emissor externo.
