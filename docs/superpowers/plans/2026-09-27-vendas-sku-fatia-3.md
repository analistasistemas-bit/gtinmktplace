# Vendas SKU — Fatia 3 (recompra, exportação XLSX e atalhos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Três entregas independentes sobre a Vendas SKU:
- um bloco **Recompra** no dossiê do SKU e da família, calculado no navegador, só com agregados;
- **XLSX** do ranking (solto ou agrupado por família) e da série do dossiê, com os mesmos objetos da tela;
- **atalhos só de navegação** no dossiê (Analisar família, Ver em Publicados, Ver campanha), com guarda de permissão e de módulo.

**Architecture:**
- **Recompra.** Nenhuma RPC nem migration.
  - O dossiê já carrega, via `vendas_sku_dossie_ids` (sem filtro de data), todas as vendas do código desde a entrada da org. O `SELECT_VENDAS` já traz `comprador_id`.
  - A lib pura `src/lib/sku-recompra.ts` conta **ocasiões** (`pack_id ?? order_id`) por **conta compradora** (`org_id:comprador_id`) sobre `Venda[]`. Por isso o `SELECT_VENDAS` ganha só a coluna `org_id`.
  - `buscarDevolucoes` passa a paginar, porque é a fonte da elegibilidade (`returns`) e hoje trava em 1.000 linhas.
- **Exportação.** Reusa `src/lib/export/` (`montarWorkbook` + `BotaoExportar`) com três ajustes:
  - `Coluna.formato` aplica o formato numérico no Excel;
  - `null` vira célula ausente;
  - o botão aceita `formatos` e `limiteLinhas`.
  - Os adapters novos recebem as `LinhaSku`/`LinhaFamilia`/`PontoSerie` que a tela desenha e não recalculam dinheiro.
- **Atalhos.** `podeAbrirMenu` (pura, em `menus.ts`) replica a regra do `MenuGuard` em modo fail-closed. O hook `useAcessoMenus` a expõe para o dossiê.

**Tech Stack:** React 18 + TS, TanStack Query v5, SheetJS (`xlsx`), Tailwind v4 + shadcn/ui, Vitest (`TZ=America/Sao_Paulo` em `vitest.config.ts:14`), Postgres local (teste SQL).

**Spec:** `docs/superpowers/specs/2026-09-26-vendas-sku-design.md`, seção "Fatia 3", revisada pelo GPT-6 Astra (as decisões dela são vinculantes). Evidências da revisão: `/Users/diego/.claude/jobs/1e464c62/tmp/codex-f3-review.md`. Também: ADR-0172, glossário "Vendas SKU", ADR-0060 (pausar é só admin), ADR-0170 (Promoções só leitura).

## Global Constraints

- **Idioma.** Texto de UI, comentário, teste e commit em português com acentos.
- **Fuso.** Testes rodam com `TZ=America/Sao_Paulo`, já fixado em `vitest.config.ts:14`. Datas de exportação e de UI saem em horário de Brasília.
- **Nenhuma escrita no ML.**
  - Nenhum atalho publica, pausa, reativa, altera preço ou estoque, nem adere a promoção ou sai dela.
  - O dossiê não importa mutations de Publicados, Estoque nem Promoções.
- **Sem integração nesta fatia.** Nada de merge, `supabase db push` nem deploy.
  - Esta fatia não cria migration.
  - Se alguma surgir: só por `supabase migration new`, com RLS por `current_org_id()`, e vira ADR antes.
- **Recompra: definição.**
  - A métrica é **"compradores recorrentes do SKU no período"**:
    - numerador: compradores identificados com compra elegível no período **e** outra ocasião anterior do **mesmo código**;
    - denominador: compradores identificados com compra elegível no período.
  - Nunca reusar `pctRecompra` de `calcularKpisPedidos`.
- **Recompra: identidade e ocasião.**
  - Identidade = `(org_id, ml_vendas.comprador_id)`. Nunca nome nem nickname.
  - ID ausente fica fora da conta e aparece como cobertura.
  - Ocasião = `pack_id ?? order_id`. Várias unidades ou várias orders do mesmo pack são uma compra só.
- **Recompra: elegibilidade** (na compra anterior e na atual). Saem:
  - as vendas que `ehFaturavel` recusa (canceladas);
  - `status = 'refunded'`;
  - `order_id` com claim `returns`, aberto ou fechado (`orderIdsComDevolucaoReal`).
  - `partially_refunded` sem claim `returns` continua. Os KPIs financeiros não mudam.
- **Recompra: escopo.**
  - Outra cor não conta no SKU. Na família conta, com rótulo próprio, deduplicando pessoa e ocasião entre as irmãs.
  - Kit vinculado (código próprio) fica separado e sai da recompra da família.
  - Compra dentro de Kit Virtual (`kit_item_id`) fica fora, com aviso.
  - Com menos de **20** compradores identificados elegíveis, a tela mostra "amostra insuficiente", sem percentual.
- **Recompra: histórico.** "Observado desde" é o `historicoDesde` da org (1ª venda faturável), o mesmo de `montarVendasSku`. "Primeira compra observada" não significa cliente novo.
- **LGPD.**
  - Tela e XLSX só levam agregados: nenhum ID de comprador, nome, nickname, endereço, cidade, rastreio ou `raw`.
  - Fixtures são sintéticas. O isolamento entre orgs é provado no teste SQL (RPC + RLS) e na lib (chave `org_id:comprador_id`).
  - A troca de conta ou de sessão de suporte já limpa o cache de queries: `src/stores/auth-store.ts:60,72` e `src/components/support-banner.tsx:26`.
- **XLSX: formato.**
  - Só XLSX: CSV e PDF ficam fora da Vendas SKU.
  - Dinheiro vai como número, arredondado com `round2`, com formato `#,##0.00`. Percentual vai como fração, com formato `0.0%`.
  - Indisponível vai como **célula vazia** (`null`), nunca 0. Código vai como **texto**, preservando zeros à esquerda.
- **XLSX: conteúdo.**
  - A planilha distingue "Total das linhas exportadas" de "KPIs gerais do período".
  - Ela registra o período em BRT, a comparação, os filtros, a ordenação, o instante da extração e a contagem de linhas.
- **XLSX: completude.** Nenhum arquivo é truncado. Acima de `TETO_LINHAS_XLSX` o botão bloqueia e pede um período menor. O teto é confirmado por medição na Task 9.
- **Atalhos.**
  - Cada atalho aparece só se `podeAbrirMenu(menuDestino)` for verdadeiro: menu no perfil **e** módulo contratado.
  - Enquanto os módulos carregam, ou se a leitura deles falhou (`undefined`), o atalho some.
- **Shell e git.** Git só por `/usr/bin/git`, em comandos simples, um por chamada.
  - O commit é sempre `/usr/bin/git commit -F <arquivo>`, com a mensagem gravada antes pelo Write em `/Users/diego/.claude/jobs/1e464c62/tmp/`.
  - Toda mensagem termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Nada de `git -C`, de comando composto nem de `bash script.sh` (o guard do worktree barra).
- **UI premium.**
  - Skill `frontend-design-fable5` em modo system work.
  - Tier 1: `bash /Users/diego/.claude/skills/frontend-design-fable5/scripts/preflight.sh --allow-lucide <arquivos>` sai com código 0.
  - Tier 2: auditoria adversarial com **nota ≥ 8/10**, feita pelo **controlador** (nunca o implementador).
  - Cobrir estados vazios, 390 px e escuro/claro.

## Review Focus

1. **Compra anterior fora da janela do ranking.**
   - Caso: comprador que comprou o código em janeiro e de novo no período.
   - Esperado: ele conta como recorrente. O dossiê traz o histórico inteiro pela RPC, sem filtro de data.
   - Onde: Task 2 (teste "compra anterior antes do período") e Task 3 (montarDossie).
2. **Pack com order cancelada e order paga do mesmo SKU.**
   - Esperado: a ocasião conta uma vez, pela order paga. No XLSX, as unidades canceladas saem em "Canceladas (un.)", e o faturamento bate ao centavo com a tabela.
   - Onde: Task 2 e Task 6.
3. **Tabela filtrada (busca, família, "só sem custo").**
   - Esperado: o total das linhas exportadas ≠ os KPIs gerais, e cada um vem rotulado. Ninguém lê o total filtrado como o faturamento do período.
   - Onde: Task 6.
4. **Membro com a org dona do módulo Promoções, mas sem `promocoes` em `allowed_menus`.**
   - Esperado: a campanha continua listada, sem o link "Ver campanha".
   - Caso irmão: módulos ainda carregando também escondem o link.
   - Onde: Task 8.
5. **Org com mais de 1.000 claims.**
   - Esperado: a elegibilidade da recompra e a taxa de devolução exportada usam a lista inteira, sem corte silencioso em 1.000.
   - Onde: Task 1.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/devolucoes.ts` (modificar) | `buscarDevolucoes` pagina e busca pack/estorno em lotes de 80 |
| `src/lib/faturamento.ts` (modificar) | `SELECT_VENDAS` ganha `org_id` |
| `src/lib/vendas-sku.ts` (modificar) | remove o ponytail do teto de 1.000 devoluções |
| `supabase/tests/vendas_sku_dossie.sql` (modificar) | mesmo `comprador_id` em duas orgs |
| `src/lib/sku-recompra.ts` (criar) | `calcularRecompra`: lógica pura, só agregados |
| `src/lib/sku-dossie.ts` (modificar) | `DossieSku.recompra`; `situacaoCampanhas` preserva `promocaoId` |
| `src/components/sku-dossie/recompra-dossie.tsx` (criar) | bloco Recompra |
| `src/lib/export/tipos.ts`, `src/lib/export/excel.ts` (modificar) | `Coluna.formato`; `null` → célula vazia |
| `src/components/export/botao-exportar.tsx` (modificar) | `formatos`, `limiteLinhas` |
| `src/lib/export/vendas-sku-xlsx.ts` (criar) | `buildRankingSkuReport`, `buildSerieDossieReport`, `TETO_LINHAS_XLSX` |
| `src/hooks/useVendasSku.ts`, `src/hooks/useSkuDossie.ts` (modificar) | devolvem `janela` (e `anterior`) para o cabeçalho do XLSX |
| `src/components/faturamento/aba-vendas-sku.tsx` (modificar) | botão "Exportar Excel" do ranking |
| `src/lib/menus.ts` (modificar) | `podeAbrirMenu` |
| `src/hooks/useAcessoMenus.ts` (criar) | perfil + suporte + módulos → `(menu) => boolean` |
| `src/components/sku-dossie/atalhos-dossie.tsx` (criar) | Analisar família / Ver em Publicados |
| `src/components/sku-dossie/campanhas-dossie.tsx` (modificar) | link "Ver campanha" por campanha |
| `src/pages/SkuDossie.tsx` (modificar) | monta recompra, atalhos, exportação da série |

---

### Task 1: Fontes completas: devoluções paginadas, `org_id` nas vendas e isolamento SQL

**Files:**
- Modify: `src/lib/devolucoes.ts:31-60` (`buscarDevolucoes`), `src/lib/faturamento.ts:12` (`SELECT_VENDAS`), `src/lib/vendas-sku.ts:370-371` (comentário ponytail), `supabase/tests/vendas_sku_dossie.sql`
- Create: `tests/lib/devolucoes-busca.test.ts`
- Test: `tests/lib/sku-dossie-dados.test.ts` (1 caso novo)

**Interfaces:**
- Consumes: `buscarTodasPaginas` (`src/lib/paginacao-supabase.ts`).
- Produces:
  - `buscarDevolucoes(): Promise<Devolucao[]>`: mesma assinatura, agora completa, ordenada por `aberto_em desc, id`;
  - `SELECT_VENDAS` inclui `org_id`, então `Venda.org_id` vem preenchido nas vendas do dossiê e da aba.

- [ ] **Step 1: Failing test.** Criar `tests/lib/devolucoes-busca.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mesmo padrão de tests/lib/sku-dossie-dados.test.ts: client mockado, sem rede.
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mockFrom } }));

const { buscarDevolucoes } = await import('@/lib/devolucoes');

const claim = (i: number) => ({
  id: `d${i}`, claim_id: i, order_id: 10_000 + i, stage: null, status: 'closed', type: 'returns', reason_id: null,
  reason_texto: null, valor_em_jogo: null, return_status: null, return_status_money: null, acoes_pendentes: null,
  aberto_em: '2026-09-01T12:00:00Z', fechado_em: null,
});

/** ml_devolucoes responde pela faixa do .range(); ml_vendas devolve 1 linha por order_id do .in(). */
function mockTabelas(totalClaims: number, erroNaPagina?: number) {
  const lotesIn: number[][] = [];
  mockFrom.mockImplementation((tabela: string) => {
    let de = 0; let ate = 0; let ids: number[] = [];
    const chain: any = {
      select: () => chain,
      order: () => chain,
      range: (a: number, b: number) => { de = a; ate = b; return chain; },
      in: (_c: string, v: number[]) => { ids = v; lotesIn.push(v); return chain; },
      then: (resolve: any, reject: any) => {
        if (tabela === 'ml_devolucoes') {
          if (erroNaPagina != null && de === erroNaPagina * 1000) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve, reject);
          const fim = Math.min(ate + 1, totalClaims);
          return Promise.resolve({ data: Array.from({ length: Math.max(0, fim - de) }, (_, k) => claim(de + k)), error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: ids.map((o) => ({ order_id: o, pack_id: o + 1, estorno: 5 })), error: null }).then(resolve, reject);
      },
    };
    return chain;
  });
  return lotesIn;
}

describe('buscarDevolucoes', () => {
  beforeEach(() => { mockFrom.mockReset(); });

  it('2.500 claims: lê as 3 páginas (sem o teto de 1.000) e busca pack/estorno em lotes de até 80', async () => {
    const lotesIn = mockTabelas(2500);
    const lista = await buscarDevolucoes();
    expect(lista).toHaveLength(2500);
    expect(lotesIn.every((l) => l.length <= 80)).toBe(true);
    expect(new Set(lotesIn.flat()).size).toBe(2500);
    expect(lista[2499]).toMatchObject({ order_id: 12_499, pack_id: 12_500, valor_estornado: 5 });
  });

  it('erro numa página rejeita tudo (nunca lista parcial)', async () => {
    mockTabelas(2500, 1);
    await expect(buscarDevolucoes()).rejects.toThrow('boom');
  });
});
```

  Em `tests/lib/sku-dossie-dados.test.ts`, acrescentar ao `describe('buscarVendasPorIds')`:

```ts
  it('o select das vendas traz org_id e comprador_id (identidade da recompra, Fatia 3)', async () => {
    const { SELECT_VENDAS } = await import('@/lib/faturamento');
    const colunas = SELECT_VENDAS.split(', itens:')[0].split(', ');
    expect(colunas).toEqual(expect.arrayContaining(['org_id', 'comprador_id']));
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/lib/devolucoes-busca.test.ts tests/lib/sku-dossie-dados.test.ts`
Expected: FAIL.
- No teste de 2.500, o mock sem `.range` devolve a mesma faixa e a lista não chega a 2.500.
- O teste de `org_id` falha porque a coluna não existe.

- [ ] **Step 3: Implement.** Em `src/lib/devolucoes.ts`, acrescentar ao topo `import { buscarTodasPaginas } from './paginacao-supabase';` e trocar `buscarDevolucoes` inteira por:

```ts
const SELECT_DEVOLUCOES = 'id, claim_id, order_id, stage, status, type, reason_id, reason_texto, valor_em_jogo, return_status, return_status_money, acoes_pendentes, aberto_em, fechado_em';
/** Lote do `.in('order_id', …)`: 80 order_ids de ~16 dígitos ≈ 1,4 KB de URL (mesmo lote do dossiê). */
const LOTE_ORDERS = 80;

/** Lê TODAS as devoluções/claims (mais recentes primeiro), página a página: sem o teto de 1.000
 *  linhas do PostgREST. A taxa de devolução e a elegibilidade da recompra (Vendas SKU, ADR-0172
 *  Fatia 3) dependem da lista inteira; qualquer página com erro rejeita tudo. RLS por org. */
export async function buscarDevolucoes(): Promise<Devolucao[]> {
  const devolucoes = await buscarTodasPaginas<Devolucao>((de, ate) => supabase
    .from('ml_devolucoes')
    .select(SELECT_DEVOLUCOES)
    .order('aberto_em', { ascending: false })
    .order('id')
    .range(de, ate) as unknown as PromiseLike<{ data: Devolucao[] | null; error: { message: string } | null }>);

  const orderIds = [...new Set(devolucoes.map((d) => d.order_id).filter((id): id is number => id != null))];
  const packMap = new Map<number, number | null>();
  const estornoMap = new Map<number, number | null>();
  for (let i = 0; i < orderIds.length; i += LOTE_ORDERS) {
    const { data, error } = await supabase
      .from('ml_vendas')
      .select('order_id, pack_id, estorno')
      .in('order_id', orderIds.slice(i, i + LOTE_ORDERS));
    if (error) throw new Error(error.message);
    for (const v of data ?? []) { packMap.set(v.order_id, v.pack_id); estornoMap.set(v.order_id, v.estorno); }
  }
  for (const d of devolucoes) {
    if (d.order_id == null) continue;
    d.pack_id = packMap.get(d.order_id) ?? null;
    d.valor_estornado = estornoMap.get(d.order_id) ?? null;
  }
  return devolucoes;
}
```

  Em `src/lib/faturamento.ts:12`, no início da string de `SELECT_VENDAS`, trocar `'id, order_id, ` por `'id, org_id, order_id, `. Não mexer em mais nenhum caractere.

  Em `src/lib/vendas-sku.ts`, apagar as duas linhas de comentário `// ponytail: p.devolucoes vem de buscarDevolucoes, que não pagina …` e `// (175 em 2026-09-27). Passando disso, paginar como buscarVendas.`: o teto deixou de existir.

  Em `supabase/tests/vendas_sku_dossie.sql`, logo antes de `set local role authenticated;`, inserir:

```sql
-- Fatia 3 (recompra): o MESMO comprador_id nas duas orgs. A conta compradora é (org_id, comprador_id):
-- a org 1 nunca pode enxergar a venda da org 2, nem pela RPC nem pela tabela.
update public.ml_vendas set comprador_id = 777001
 where id in ('93000000-0000-0000-0000-000000000501', '93000000-0000-0000-0000-000000000506');
```

  Dentro do primeiro bloco `do $$ … $$` (usuário da org 1), logo depois da asserção de `ids`, inserir:

```sql
  if (select count(*) from public.ml_vendas where comprador_id = 777001) <> 1
    then raise exception 'comprador da org 2 visível para a org 1 (RLS de ml_vendas)'; end if;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/lib/devolucoes-busca.test.ts tests/lib/sku-dossie-dados.test.ts`
Expected: PASS.

Com o Supabase local no ar, rodar:

`docker exec -i -e PGPASSWORD=postgres supabase_db_txvncrgkoynoxwopfkbp psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < "/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/vendas-sku-design/supabase/tests/vendas_sku_dossie.sql"`

Expected: termina em `ROLLBACK`, sem `ERROR`.

Depois: `pnpm preflight:static`, então `pnpm test`. Expected: verde.

- [ ] **Step 5: Commit.** Com o Write, gravar `/Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t1.txt`:

```
fix(vendas-sku): devoluções completas e org_id nas vendas (base da recompra)

buscarDevolucoes pagina (teto de 1.000 do PostgREST) e busca pack/estorno em lotes de 80.
SELECT_VENDAS traz org_id: a conta compradora da recompra é (org_id, comprador_id).
Teste SQL: mesmo comprador_id em duas orgs não vaza pela RPC nem pela RLS.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

  Rodar um comando por vez:

  `/usr/bin/git add src/lib/devolucoes.ts src/lib/faturamento.ts src/lib/vendas-sku.ts supabase/tests/vendas_sku_dossie.sql tests/lib/devolucoes-busca.test.ts tests/lib/sku-dossie-dados.test.ts`

  `/usr/bin/git commit -F /Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t1.txt`

---

### Task 2: Lib pura da recompra

**Files:**
- Create: `src/lib/sku-recompra.ts`, `tests/lib/sku-recompra.test.ts`

**Interfaces:**
- Consumes:
  - `Venda` de `@/lib/faturamento`, com `org_id` preenchido (Task 1);
  - `ehFaturavel` de `./resumo-vendas`;
  - `SEM_CODIGO` de `./vendas-sku`;
  - `Janela` de `./metricas`.
- Produces:

```ts
export const MIN_COMPRADORES_RECOMPRA = 20;
export interface Recompra {
  escopo: 'sku' | 'familia';
  compradoresIdentificados: number;
  recorrentes: number;
  /** Ocasiões elegíveis do período sem comprador_id — cada uma conta como 1 na cobertura "N de M". */
  comprasSemIdentificacao: number;
  /** recorrentes ÷ identificados; null com amostra insuficiente. */
  taxa: number | null;
  amostraInsuficiente: boolean;
  /** Ocasiões do período dentro de Kit Virtual, fora da conta (aviso). */
  comprasEmKitVirtual: number;
  observadoDesde: string | null;
}
export function vendaElegivelRecompra(v: Pick<Venda, 'status' | 'order_id'>, devolvidas: Set<number>): boolean;
export function calcularRecompra(p: {
  vendas: Venda[]; codigos: string[]; janela: Janela; devolvidas: Set<number>;
  escopo: 'sku' | 'familia'; observadoDesde: string | null;
}): Recompra;
```

- [ ] **Step 1: Write the failing test.** `tests/lib/sku-recompra.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calcularRecompra, MIN_COMPRADORES_RECOMPRA } from '@/lib/sku-recompra';
import type { Venda, VendaItem } from '@/lib/faturamento';

// Dados sintéticos (LGPD): IDs, nomes e rastreios inventados.
function item(over: Partial<VendaItem> = {}): VendaItem {
  return { id: 'it', ml_item_id: 'MLB1', variation_id: null, titulo: 'Camiseta', codigo: 'A', cor: null,
    ean: null, quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true, ...over };
}
let seq = 0;
function venda(over: Partial<Venda> = {}): Venda {
  seq += 1;
  return { id: `v${seq}`, org_id: 'org-1', order_id: 1000 + seq, pack_id: null, status: 'paid', status_detail: null,
    date_closed: '2026-09-15T12:00:00Z', date_created: null, comprador_nick: 'NICK_SECRETO', comprador_nome: 'Nome Secreto',
    comprador_id: 555_000 + seq, uf: 'SP', cidade: 'Cidade Secreta', total_amount: 10, paid_amount: 10, liquido: 9,
    sale_fee_total: 1, frete_vendedor: null, estorno: null, money_release_date: null, sacado_em: null, sacado_por: null,
    atualizado_em: '2026-09-15T12:00:00Z', currency: 'BRL', shipping_id: null, shipping_status: null,
    shipping_substatus: null, shipping_logistic: null, tracking_number: 'RASTREIO_SECRETO', is_publiai: true,
    tem_devolucao: false, kit_item_id: null, itens: [item()], ...over };
}

// Período: setembro/2026 em BRT.
const JANELA = { desde: '2026-09-01T03:00:00.000Z', ate: '2026-10-01T02:59:59.999Z' };
const ANTES = '2026-01-10T12:00:00Z';
const DURANTE = '2026-09-15T12:00:00Z';
const DURANTE_DEPOIS = '2026-09-20T12:00:00Z';
/** n compradores distintos com 1 compra cada no período (enchem a amostra). */
const novos = (n: number) => Array.from({ length: n }, () => venda());
const calc = (vendas: Venda[], over: Partial<Parameters<typeof calcularRecompra>[0]> = {}) => calcularRecompra({
  vendas, codigos: ['A'], janela: JANELA, devolvidas: new Set(), escopo: 'sku', observadoDesde: '2026-01-02T12:00:00Z', ...over,
});

describe('calcularRecompra', () => {
  it('recorrente = compra anterior do mesmo código, mesmo antes do período (histórico observado)', () => {
    const r = calc([venda({ comprador_id: 1, date_closed: ANTES }), venda({ comprador_id: 1, date_closed: DURANTE }), ...novos(19)]);
    expect(r).toMatchObject({ compradoresIdentificados: 20, recorrentes: 1, taxa: 0.05, amostraInsuficiente: false });
  });

  it('a compra anterior pode estar dentro do período', () => {
    const r = calc([venda({ comprador_id: 1, date_closed: DURANTE }), venda({ comprador_id: 1, date_closed: DURANTE_DEPOIS }), ...novos(19)]);
    expect(r).toMatchObject({ compradoresIdentificados: 20, recorrentes: 1 });
  });

  it('compra DEPOIS do período não torna recorrente a compra do período', () => {
    const r = calc([venda({ comprador_id: 1, date_closed: DURANTE }), venda({ comprador_id: 1, date_closed: '2026-10-05T12:00:00Z' })]);
    expect(r).toMatchObject({ compradoresIdentificados: 1, recorrentes: 0 });
  });

  it('pack com várias orders e várias unidades é UMA ocasião: não é recompra', () => {
    const r = calc([
      venda({ comprador_id: 1, pack_id: 9, date_closed: DURANTE, itens: [item({ quantity: 3 })] }),
      venda({ comprador_id: 1, pack_id: 9, date_closed: '2026-09-15T12:00:05Z' }),
    ]);
    expect(r).toMatchObject({ compradoresIdentificados: 1, recorrentes: 0 });
  });

  it('duas orgs: o mesmo comprador_id em outra org não é recompra', () => {
    const r = calc([
      venda({ org_id: 'org-2', comprador_id: 1, date_closed: ANTES }),
      venda({ org_id: 'org-1', comprador_id: 1, date_closed: DURANTE }),
    ]);
    expect(r).toMatchObject({ compradoresIdentificados: 1, recorrentes: 0 });
  });

  it('ID ausente fica fora e vira cobertura; nunca identifica por nickname', () => {
    const r = calc([
      venda({ comprador_id: null, comprador_nick: 'MESMO', date_closed: ANTES }),
      venda({ comprador_id: null, comprador_nick: 'MESMO', date_closed: DURANTE }),
    ]);
    expect(r).toMatchObject({ compradoresIdentificados: 0, recorrentes: 0, comprasSemIdentificacao: 1, taxa: null });
  });

  it('cancelada, reembolsada integralmente e devolvida não contam como compra anterior; reembolso parcial conta', () => {
    const devolvida = venda({ comprador_id: 3, date_closed: ANTES });
    const r = calc([
      venda({ comprador_id: 1, status: 'cancelled', date_closed: ANTES }), venda({ comprador_id: 1, date_closed: DURANTE }),
      venda({ comprador_id: 2, status: 'refunded', date_closed: ANTES }), venda({ comprador_id: 2, date_closed: DURANTE }),
      devolvida, venda({ comprador_id: 3, date_closed: DURANTE }),
      venda({ comprador_id: 4, status: 'partially_refunded', date_closed: ANTES }), venda({ comprador_id: 4, date_closed: DURANTE }),
    ], { devolvidas: new Set([devolvida.order_id]) });
    expect(r).toMatchObject({ compradoresIdentificados: 4, recorrentes: 1 });
  });

  it('compra atual cancelada ou devolvida sai do denominador', () => {
    const atualDevolvida = venda({ comprador_id: 2, date_closed: DURANTE });
    const r = calc([
      venda({ comprador_id: 1, date_closed: ANTES }), venda({ comprador_id: 1, status: 'cancelled', date_closed: DURANTE }),
      venda({ comprador_id: 2, date_closed: ANTES }), atualDevolvida,
    ], { devolvidas: new Set([atualDevolvida.order_id]) });
    expect(r).toMatchObject({ compradoresIdentificados: 0, recorrentes: 0 });
  });

  it('pack com order cancelada e order paga do mesmo SKU: a ocasião conta uma vez, pela paga', () => {
    const r = calc([
      venda({ comprador_id: 1, date_closed: ANTES }),
      venda({ comprador_id: 1, pack_id: 7, status: 'cancelled', date_closed: DURANTE }),
      venda({ comprador_id: 1, pack_id: 7, date_closed: DURANTE }),
    ]);
    expect(r).toMatchObject({ compradoresIdentificados: 1, recorrentes: 1 });
  });

  it('outra cor não conta no SKU; na família conta, com escopo próprio', () => {
    const vendas = [venda({ comprador_id: 1, date_closed: ANTES, itens: [item({ codigo: 'B' })] }), venda({ comprador_id: 1, date_closed: DURANTE })];
    expect(calc(vendas).recorrentes).toBe(0);
    expect(calc(vendas, { codigos: ['A', 'B'], escopo: 'familia' })).toMatchObject({ escopo: 'familia', compradoresIdentificados: 1, recorrentes: 1 });
  });

  it('família: duas irmãs no mesmo pack são uma ocasião (pessoa e ocasião deduplicadas)', () => {
    const r = calc([
      venda({ comprador_id: 1, pack_id: 8, date_closed: DURANTE, itens: [item({ codigo: 'A' })] }),
      venda({ comprador_id: 1, pack_id: 8, date_closed: DURANTE, itens: [item({ codigo: 'B' })] }),
    ], { codigos: ['A', 'B'], escopo: 'familia' });
    expect(r).toMatchObject({ compradoresIdentificados: 1, recorrentes: 0 });
  });

  it('kit vinculado (código próprio) não é compra anterior do SKU base', () => {
    const r = calc([venda({ comprador_id: 1, date_closed: ANTES, itens: [item({ codigo: 'K1' })] }), venda({ comprador_id: 1, date_closed: DURANTE })]);
    expect(r).toMatchObject({ compradoresIdentificados: 1, recorrentes: 0 });
  });

  it('Kit Virtual fica fora (anterior e atual) e é contado para o aviso', () => {
    const r = calc([
      venda({ comprador_id: 1, kit_item_id: 'MLBKIT', date_closed: ANTES }), venda({ comprador_id: 1, date_closed: DURANTE }),
      venda({ comprador_id: 2, kit_item_id: 'MLBKIT', date_closed: DURANTE }),
    ]);
    expect(r).toMatchObject({ compradoresIdentificados: 1, recorrentes: 0, comprasEmKitVirtual: 1 });
  });

  it(`amostra: ${MIN_COMPRADORES_RECOMPRA - 1} identificados → sem percentual; ${MIN_COMPRADORES_RECOMPRA} → com`, () => {
    expect(calc(novos(MIN_COMPRADORES_RECOMPRA - 1))).toMatchObject({ compradoresIdentificados: 19, taxa: null, amostraInsuficiente: true });
    expect(calc(novos(MIN_COMPRADORES_RECOMPRA))).toMatchObject({ compradoresIdentificados: 20, taxa: 0, amostraInsuficiente: false });
  });

  it('LGPD: o resultado só tem agregados (nenhum ID, nome, nickname, cidade ou rastreio)', () => {
    const r = calc([venda({ comprador_id: 987_654_321, date_closed: ANTES }), venda({ comprador_id: 987_654_321, date_closed: DURANTE })]);
    const json = JSON.stringify(r);
    for (const proibido of ['987654321', 'NICK_SECRETO', 'Nome Secreto', 'RASTREIO_SECRETO', 'Cidade Secreta']) expect(json).not.toContain(proibido);
    expect(Object.keys(r).sort()).toEqual([
      'amostraInsuficiente', 'comprasEmKitVirtual', 'comprasSemIdentificacao', 'compradoresIdentificados',
      'escopo', 'observadoDesde', 'recorrentes', 'taxa',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/lib/sku-recompra.test.ts`
Expected: FAIL com `Failed to resolve import "@/lib/sku-recompra"`.

- [ ] **Step 3: Write minimal implementation.** `src/lib/sku-recompra.ts`:

```ts
// Recompra do SKU (Vendas SKU, ADR-0172 Fatia 3). Conta compradores, nunca dinheiro: nada daqui
// entra em KPI financeiro. Identidade = conta compradora (org_id, comprador_id), nunca nome ou
// nickname. Ocasião = pack_id ?? order_id: várias orders ou unidades do mesmo carrinho são UMA compra.
// Só devolve agregados (LGPD): nenhum ID sai daqui.
import type { Venda } from './faturamento';
import type { Janela } from './metricas';
import { ehFaturavel } from './resumo-vendas';
import { SEM_CODIGO } from './vendas-sku';

/** Mínimo de compradores identificados para mostrar o percentual. Limite de produto, não garantia estatística. */
export const MIN_COMPRADORES_RECOMPRA = 20;

export interface Recompra {
  escopo: 'sku' | 'familia';
  compradoresIdentificados: number;
  recorrentes: number;
  /** Ocasiões elegíveis do período sem comprador_id. Sem ID não dá para deduplicar a pessoa, então
   *  cada uma conta como 1 na cobertura "N de M compradores identificados". */
  comprasSemIdentificacao: number;
  /** recorrentes ÷ identificados; null com amostra insuficiente. */
  taxa: number | null;
  amostraInsuficiente: boolean;
  /** Ocasiões do período dentro de Kit Virtual, fora da conta: comprar o conjunto não comprova preferência pelo item. */
  comprasEmKitVirtual: number;
  /** 1ª venda faturável da org: antes disso o PubliAI não tem registro. */
  observadoDesde: string | null;
}

/** Elegível para recompra: faturável, sem reembolso integral e sem claim `returns` (aberto ou fechado).
 *  Regra só da recompra: não muda os KPIs financeiros. */
export function vendaElegivelRecompra(v: Pick<Venda, 'status' | 'order_id'>, devolvidas: Set<number>): boolean {
  return ehFaturavel(v.status) && v.status !== 'refunded' && !devolvidas.has(v.order_id);
}

export function calcularRecompra(p: {
  vendas: Venda[]; codigos: string[]; janela: Janela; devolvidas: Set<number>;
  escopo: 'sku' | 'familia'; observadoDesde: string | null;
}): Recompra {
  const cods = new Set(p.codigos);
  const ini = Date.parse(p.janela.desde);
  const fim = Date.parse(p.janela.ate);
  const noPeriodo = (t: number) => t >= ini && t <= fim;
  const porComprador = new Map<string, Map<string, number>>(); // conta → ocasião → 1º instante
  const comId = new Set<string>();
  const semId = new Set<string>();
  const emKit = new Set<string>();

  for (const v of p.vendas) {
    if (!v.date_closed || !v.itens.some((it) => cods.has(it.codigo?.trim() || SEM_CODIGO))) continue;
    if (!vendaElegivelRecompra(v, p.devolvidas)) continue;
    const t = Date.parse(v.date_closed);
    const ocasiao = String(v.pack_id ?? v.order_id);
    if (v.kit_item_id != null) { if (noPeriodo(t)) emKit.add(ocasiao); continue; }
    if (v.comprador_id == null) { if (noPeriodo(t)) semId.add(ocasiao); continue; }
    if (noPeriodo(t)) comId.add(ocasiao);
    const conta = `${v.org_id ?? ''}:${v.comprador_id}`;
    const ocasioes = porComprador.get(conta) ?? new Map<string, number>();
    ocasioes.set(ocasiao, Math.min(ocasioes.get(ocasiao) ?? Infinity, t));
    porComprador.set(conta, ocasioes);
  }

  let identificados = 0;
  let recorrentes = 0;
  for (const ocasioes of porComprador.values()) {
    const tempos = [...ocasioes.values()];
    const doPeriodo = tempos.filter(noPeriodo);
    if (!doPeriodo.length) continue;
    identificados += 1;
    const primeira = Math.min(...tempos);
    // ponytail: empate exato de instante entre duas ocasiões não conta como recompra (anterior = estritamente antes).
    if (doPeriodo.some((t) => t > primeira)) recorrentes += 1;
  }
  const amostraInsuficiente = identificados < MIN_COMPRADORES_RECOMPRA;
  return {
    escopo: p.escopo,
    compradoresIdentificados: identificados,
    recorrentes,
    comprasSemIdentificacao: [...semId].filter((o) => !comId.has(o)).length,
    taxa: amostraInsuficiente ? null : recorrentes / identificados,
    amostraInsuficiente,
    comprasEmKitVirtual: [...emKit].filter((o) => !comId.has(o) && !semId.has(o)).length,
    observadoDesde: p.observadoDesde,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/lib/sku-recompra.test.ts`
Expected: PASS (15 testes).

Depois: `pnpm preflight:static`.

- [ ] **Step 5: Commit.** Com o Write, gravar `/Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t2.txt`:

```
feat(vendas-sku): recompra do SKU — lib pura, só agregados

Compradores recorrentes do SKU no período: conta compradora (org_id, comprador_id),
ocasião pack_id ?? order_id, elegibilidade sem canceladas/reembolsadas/returns, Kit Virtual
fora com aviso, mínimo de 20 compradores identificados.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

  `/usr/bin/git add src/lib/sku-recompra.ts tests/lib/sku-recompra.test.ts`

  `/usr/bin/git commit -F /Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t2.txt`

---

### Task 3: Recompra no `montarDossie`

**Files:**
- Modify:
  - `src/lib/sku-dossie.ts`: `DossieSku`, `montarDossie`;
  - `src/pages/__tests__/SkuDossie.test.tsx`: fixture `dossie()`;
  - toda fixture de `DossieSku` que o `tsc` apontar.
- Test: `tests/lib/sku-dossie.test.ts`

**Interfaces:**
- Consumes: `calcularRecompra`, `Recompra` (Task 2).
- Produces:
  - `DossieSku.recompra: Recompra`.
  - SKU: `codigos = [codigo]`, `escopo 'sku'`.
  - Família: códigos da família **sem os kits** (`ehKit`), `escopo 'familia'`.
  - `observadoDesde` = `historicoDesde` da org, vindo de `montarVendasSku` sobre o catálogo inteiro.

- [ ] **Step 1: Failing test.** Em `tests/lib/sku-dossie.test.ts`, depois do `describe('montarDossie: estoque com kit')`, acrescentar:

```ts
describe('montarDossie: recompra', () => {
  const cat = (codigo: string, over: Partial<CatalogoSku> = {}): CatalogoSku => ({
    codigo, codigoPai: 'P', nomeFamilia: 'Fam', nome: codigo, cor: null, tamanho: null, estoque: 10, fornecedor: null,
    origem: 'nacional', ehKit: false, primeiraVenda: '2026-09-01T12:00:00Z', ultimaVenda: '2026-09-22T12:00:00Z',
    kitMultiplicador: null, kitBaseCodigo: null, estoqueKit: null, ...over,
  });
  // Outro produto da org, sem relação com a família: é ele que define "observado desde" (1ª venda da org).
  const outro = cat('Z', { codigoPai: 'Q', primeiraVenda: '2026-01-05T12:00:00Z' });
  const vendas = [
    venda({ id: 'b0', order_id: 11, comprador_id: 1, date_closed: '2026-08-01T12:00:00Z', itens: [item({ id: 'x1', codigo: 'B' })] }),
    venda({ id: 'k0', order_id: 12, comprador_id: 2, date_closed: '2026-08-01T12:00:00Z', itens: [item({ id: 'x2', codigo: 'K' })] }),
    venda({ id: 'a1', order_id: 13, comprador_id: 1, date_closed: '2026-09-22T12:00:00Z', itens: [item({ id: 'x3', codigo: 'A' })] }),
    venda({ id: 'a2', order_id: 14, comprador_id: 2, date_closed: '2026-09-22T12:00:00Z', itens: [item({ id: 'x4', codigo: 'A' })] }),
  ];
  const monta = (alvo: { tipo: 'sku'; codigo: string } | { tipo: 'familia'; codigoPai: string }, codigos: string[]) => montarDossie({
    alvo, codigos, vendas, agrupar, devolucoes: [],
    catalogo: [cat('A'), cat('B'), cat('K', { ehKit: true, kitMultiplicador: 2, kitBaseCodigo: 'A', estoqueKit: 5 }), outro],
    janela: { desde: '2026-09-16T03:00:00.000Z', ate: '2026-09-27T02:59:59.999Z' },
    anterior: { desde: '2026-09-05T03:00:00.000Z', ate: '2026-09-16T02:59:59.999Z' },
    hoje: { desde: '2026-08-28T03:00:00.000Z', ate: '2026-09-27T02:59:59.999Z' },
    hojeAnterior: { desde: '2026-07-29T03:00:00.000Z', ate: '2026-08-28T02:59:59.999Z' },
    intervalos: IVS, mlbs: new Map(), movimentos: [], moderacoes: [], perguntas: [], campanhas: [],
  }).dados!;

  it('SKU: outra cor antes não conta; observado desde = 1ª venda da org, não do código', () => {
    expect(monta({ tipo: 'sku', codigo: 'A' }, ['A']).recompra).toMatchObject({
      escopo: 'sku', compradoresIdentificados: 2, recorrentes: 0, observadoDesde: '2026-01-05T12:00:00Z',
    });
  });

  it('família: outra cor conta (escopo família); kit vinculado da família fica fora', () => {
    expect(monta({ tipo: 'familia', codigoPai: 'P' }, ['A', 'B', 'K']).recompra).toMatchObject({
      escopo: 'familia', compradoresIdentificados: 2, recorrentes: 1,
    });
  });
});
```

  (`venda()`, `item()`, `agrupar`, `IVS` e `CatalogoSku` já existem no topo do arquivo. O `venda()` de lá não define `org_id`, e a chave vira `':1'`, igual para todos: o teste continua válido.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/lib/sku-dossie.test.ts -t recompra`
Expected: FAIL (`recompra` undefined).

- [ ] **Step 3: Implement.** Em `src/lib/sku-dossie.ts`:
  - Imports: `import { calcularRecompra, type Recompra } from './sku-recompra';`
  - Em `DossieSku`, depois de `qualidade`:

```ts
  /** Compradores recorrentes no período (Fatia 3). Só agregados; família = qualquer variação, sem kits vinculados. */
  recompra: Recompra;
```

  - No objeto `dados` de `montarDossie`, depois de `qualidade: …`:

```ts
    recompra: calcularRecompra({
      vendas: p.vendas,
      // Kit vinculado tem código próprio e fica separado da base: fora da recompra da família.
      codigos: familia == null ? p.codigos : p.codigos.filter((c) => !catMap.get(c)?.ehKit),
      janela: p.janela, devolvidas,
      escopo: familia == null ? 'sku' : 'familia',
      observadoDesde: periodo.historicoDesde,
    }),
```

  (`devolvidas`, `catMap`, `familia` e `periodo` já existem em `montarDossie`. `periodo.historicoDesde` é o mesmo "Histórico desde" da aba Vendas SKU.)

  Em `src/pages/__tests__/SkuDossie.test.tsx`, na fixture `dossie()`, depois de `qualidade: …`, acrescentar:

```ts
  recompra: { escopo: 'sku', compradoresIdentificados: 0, recorrentes: 0, comprasSemIdentificacao: 0, taxa: null,
    amostraInsuficiente: true, comprasEmKitVirtual: 0, observadoDesde: null },
```

  Rodar `pnpm exec tsc -b --force` e completar do mesmo jeito qualquer outra fixture de `DossieSku` apontada.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/lib/sku-dossie.test.ts src/pages/__tests__/SkuDossie.test.tsx src/hooks/__tests__/useSkuDossie.test.ts`
Expected: PASS.

Depois: `pnpm preflight:static`.

- [ ] **Step 5: Commit.** Gravar `/Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t3.txt`:

```
feat(vendas-sku): recompra no dossiê (SKU exato; família sem kits)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

  `/usr/bin/git add src/lib/sku-dossie.ts tests/lib/sku-dossie.test.ts src/pages/__tests__/SkuDossie.test.tsx`

  Se o `tsc` apontou outras fixtures, acrescentá-las a este mesmo `git add`.

  `/usr/bin/git commit -F /Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t3.txt`

---

### Task 4: Bloco "Recompra" no dossiê (UI premium)

> Invocar `frontend-design-fable5` em system work. Referências de linguagem visual:
> - `BlocoDossie` (título + linha do relógio);
> - `Fato` (hairline em `dl`, de `cabecalho-dossie.tsx`);
> - `CampanhasDossie` (cartão com `divide-y`);
> - `EmptyState`.
>
> Nada de gráfico novo: um número grande, os fatos e as notas.

**Files:**
- Create: `src/components/sku-dossie/recompra-dossie.tsx`, `src/components/sku-dossie/__tests__/recompra-dossie.test.tsx`
- Modify: `src/pages/SkuDossie.tsx`

**Interfaces:**
- Consumes: `Recompra`, `MIN_COMPRADORES_RECOMPRA` (Task 2); `DossieSku.recompra` (Task 3); `Fato` (`cabecalho-dossie.tsx`); `dataBR`, `pctBR` (`formato-dossie.ts`); `BlocoDossie`.
- Produces: `RecompraDossie({ recompra, className }: { recompra: Recompra; className?: string })`.

- [ ] **Step 1: Failing test.** `src/components/sku-dossie/__tests__/recompra-dossie.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RecompraDossie } from '../recompra-dossie';
import type { Recompra } from '@/lib/sku-recompra';

const base: Recompra = {
  escopo: 'sku', compradoresIdentificados: 40, recorrentes: 6, comprasSemIdentificacao: 2, taxa: 0.15,
  amostraInsuficiente: false, comprasEmKitVirtual: 0, observadoDesde: '2026-05-10T12:00:00Z',
};

describe('RecompraDossie', () => {
  it('mostra a taxa, os recorrentes, a cobertura "N de M" e desde quando observa', () => {
    render(<RecompraDossie recompra={base} />);
    expect(screen.getByRole('heading', { name: 'Recompra' })).toBeInTheDocument();
    expect(screen.getByText('15,0%')).toBeInTheDocument();
    expect(screen.getByText(/já tinham comprado este código antes/)).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('40 de 42')).toBeInTheDocument();
    expect(screen.getByText(/2 compras sem conta compradora identificada/)).toBeInTheDocument();
    expect(screen.getAllByText(/10\/05\/2026/).length).toBeGreaterThan(0);
    expect(screen.getByText(/não significa cliente novo/)).toBeInTheDocument();
  });

  it('amostra insuficiente: diz quantos faltam e não mostra percentual', () => {
    render(<RecompraDossie recompra={{ ...base, compradoresIdentificados: 12, recorrentes: 3, taxa: null, amostraInsuficiente: true }} />);
    expect(screen.getByText('Amostra insuficiente')).toBeInTheDocument();
    expect(screen.getByText(/a partir de 20/)).toBeInTheDocument();
    expect(screen.queryByText(/\d+,\d%/)).not.toBeInTheDocument();
  });

  it('família: rótulo próprio (qualquer variação) e aviso de Kit Virtual', () => {
    render(<RecompraDossie recompra={{ ...base, escopo: 'familia', comprasEmKitVirtual: 3 }} />);
    expect(screen.getByRole('heading', { name: 'Recompra na família' })).toBeInTheDocument();
    expect(screen.getByText(/qualquer variação desta família/)).toBeInTheDocument();
    expect(screen.getByText(/3 compras dentro de Kit Virtual/)).toBeInTheDocument();
  });

  it('sem compra elegível no período: estado vazio', () => {
    render(<RecompraDossie recompra={{ ...base, compradoresIdentificados: 0, recorrentes: 0, comprasSemIdentificacao: 0, taxa: null, amostraInsuficiente: true }} />);
    expect(screen.getByText('Nenhuma compra elegível no período')).toBeInTheDocument();
  });
});
```

  Em `src/pages/__tests__/SkuDossie.test.tsx`, acrescentar:

```tsx
  it('mostra o bloco de recompra (só agregados) quando há vendas', () => {
    renderPagina('ok', dossie());
    expect(screen.getByRole('heading', { name: 'Recompra' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/components/sku-dossie/__tests__/recompra-dossie.test.tsx src/pages/__tests__/SkuDossie.test.tsx`
Expected: FAIL (módulo inexistente; heading ausente).

- [ ] **Step 3: Implement.** `src/components/sku-dossie/recompra-dossie.tsx`:

```tsx
import { Repeat } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { fmtInt } from '@/lib/formato';
import { MIN_COMPRADORES_RECOMPRA, type Recompra } from '@/lib/sku-recompra';
import { BlocoDossie } from './bloco-dossie';
import { Fato } from './cabecalho-dossie';
import { dataBR, pctBR } from './formato-dossie';

const plural = (n: number, um: string, varios: string) => `${fmtInt(n)} ${n === 1 ? um : varios}`;

/** Recompra (Fatia 3): só agregados, nunca quem comprou. "Primeira compra observada" não é
 *  "cliente novo": antes da entrada da org no PubliAI não há registro. */
export function RecompraDossie({ recompra: r, className }: { recompra: Recompra; className?: string }) {
  const familia = r.escopo === 'familia';
  const alvo = familia ? 'qualquer variação desta família' : 'este código';
  const total = r.compradoresIdentificados + r.comprasSemIdentificacao;
  const desde = r.observadoDesde ? dataBR(r.observadoDesde) : null;
  const notas = [
    r.comprasSemIdentificacao > 0 && `${plural(r.comprasSemIdentificacao, 'compra sem conta compradora identificada ficou', 'compras sem conta compradora identificada ficaram')} fora da conta.`,
    r.comprasEmKitVirtual > 0 && `${plural(r.comprasEmKitVirtual, 'compra dentro de Kit Virtual ficou', 'compras dentro de Kit Virtual ficaram')} fora: comprar o conjunto não comprova preferência pelo item.`,
    familia ? 'Cada comprador conta uma vez, em qualquer variação; kits vinculados ficam fora.' : 'Compra de outra cor não conta.',
    'Canceladas, reembolsadas integralmente e devolvidas não contam.',
    `Primeira compra observada não significa cliente novo${desde ? `: antes de ${desde} o PubliAI não tem registro` : ''}.`,
  ].filter((n): n is string => !!n);

  return (
    <BlocoDossie id="dossie-recompra" titulo={familia ? 'Recompra na família' : 'Recompra'} className={className}
      relogio={`Período escolhido · compras anteriores observadas${desde ? ` desde ${desde}` : ''}`}>
      {total === 0 ? (
        <EmptyState icon={Repeat} title="Nenhuma compra elegível no período"
          description="Canceladas, reembolsadas integralmente e devolvidas ficam fora da recompra." />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="px-4 py-3">
            {r.amostraInsuficiente ? (
              <>
                <p className="text-sm font-medium">Amostra insuficiente</p>
                <p className="text-xs text-muted-foreground">
                  {`${plural(r.compradoresIdentificados, 'comprador identificado', 'compradores identificados')} no período; o percentual aparece a partir de ${MIN_COMPRADORES_RECOMPRA}.`}
                </p>
              </>
            ) : (
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-2xl font-semibold tabular-nums tracking-[-0.01em]">{pctBR(r.taxa ?? 0)}</span>
                <span className="text-sm text-muted-foreground">{`dos compradores do período já tinham comprado ${alvo} antes`}</span>
              </p>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-px border-t bg-border">
            <Fato rotulo="Compradores recorrentes">{fmtInt(r.recorrentes)}</Fato>
            <Fato rotulo="Compradores identificados">{`${fmtInt(r.compradoresIdentificados)} de ${fmtInt(total)}`}</Fato>
          </dl>
          <ul className="space-y-1 border-t px-4 py-2.5 text-xs text-muted-foreground">
            {notas.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      )}
    </BlocoDossie>
  );
}
```

  Em `src/pages/SkuDossie.tsx`:
  - Import: `import { RecompraDossie } from '@/components/sku-dossie/recompra-dossie';`
  - Logo depois de `{estado !== 'sem_vendas' && dados.mix && <MixFamilia mix={dados.mix} voltar={voltar} />}`, inserir:

```tsx
      {estado !== 'sem_vendas' && <RecompraDossie recompra={dados.recompra} />}
```

- [ ] **Step 4: Run and verify.**
  - Run: `pnpm vitest run src/components/sku-dossie/__tests__/recompra-dossie.test.tsx src/pages/__tests__/SkuDossie.test.tsx`. Expected: PASS.
  - Run: `bash /Users/diego/.claude/skills/frontend-design-fable5/scripts/preflight.sh --allow-lucide src/components/sku-dossie/recompra-dossie.tsx src/pages/SkuDossie.tsx`. Expected: exit 0.
  - Depois: `pnpm preflight:static`, então `pnpm test`.
  - **Controlador:** auditoria Tier 2 da skill sobre o bloco (prints da Task 9 ou do dev local com dados injetados), nos quatro estados: ok, amostra insuficiente, família com Kit Virtual e vazio, em 1440/390 e escuro/claro. Só aprova com ≥ 8/10; abaixo disso, a Task volta ao implementador com os achados.

- [ ] **Step 5: Commit.** Gravar `/Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t4.txt`:

```
feat(vendas-sku): bloco de recompra no dossiê

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

  `/usr/bin/git add src/components/sku-dossie/recompra-dossie.tsx src/components/sku-dossie/__tests__/recompra-dossie.test.tsx src/pages/SkuDossie.tsx src/pages/__tests__/SkuDossie.test.tsx`

  `/usr/bin/git commit -F /Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t4.txt`

---

### Task 5: Infraestrutura de exportação: células tipadas e botão só-XLSX com teto

**Files:**
- Modify: `src/lib/export/tipos.ts` (`Coluna`), `src/lib/export/excel.ts`, `src/components/export/botao-exportar.tsx`
- Test: `tests/lib/export/export.test.ts`
- Create: `src/components/export/__tests__/botao-exportar.test.tsx`

**Interfaces:**
- Produces:
  - `export type FormatoCelula = 'dinheiro' | 'percentual' | 'inteiro';`
  - `Coluna.formato?: FormatoCelula`.
  - `montarWorkbook`:
    - célula `null`/ausente vira **ausente** (vazia de verdade), nos Dados e no Resumo (`valor: ''`);
    - número em coluna com `formato` recebe `z` (`#,##0.00` / `0.0%` / `0`);
    - string continua `t: 's'`.
  - `BotaoExportar` ganha `formatos?: ExportFormato[]` (padrão: os 4 de hoje) e `limiteLinhas?: number`.
    - Com um só formato vira botão direto "Exportar Excel".
    - Com `totalLinhas > limiteLinhas`, o botão fica desabilitado, com o aviso "reduza o período".

- [ ] **Step 1: Failing tests.** Em `tests/lib/export/export.test.ts`, acrescentar:

```ts
describe('montarWorkbook: células tipadas (Vendas SKU, Fatia 3)', () => {
  const data: ReportData = {
    titulo: 'T',
    blocos: [{ titulo: 'Total', itens: [{ label: 'Lucro', valor: '' }] }],
    colunas: [
      { chave: 'codigo', titulo: 'Código' },
      { chave: 'lucro', titulo: 'Lucro', formato: 'dinheiro' },
      { chave: 'margem', titulo: 'Margem', formato: 'percentual' },
      { chave: 'unidades', titulo: 'Unidades', formato: 'inteiro' },
    ],
    linhas: [
      { celulas: { codigo: '00123', lucro: null, margem: 0.125, unidades: 3 } },
      { celulas: { codigo: '0456', lucro: 10.5, margem: null, unidades: 0 } },
    ],
  };

  it('código é texto com zeros; null é célula ausente (nunca 0); número recebe formato', () => {
    const ws = montarWorkbook(data).Sheets.Dados;
    expect(ws.A2).toMatchObject({ t: 's', v: '00123' });
    expect(ws.B2).toBeUndefined();
    expect(ws.C2).toMatchObject({ t: 'n', v: 0.125, z: '0.0%' });
    expect(ws.D2).toMatchObject({ t: 'n', v: 3, z: '0' });
    expect(ws.B3).toMatchObject({ t: 'n', v: 10.5, z: '#,##0.00' });
    expect(ws.C3).toBeUndefined();
    expect(ws.D3).toMatchObject({ t: 'n', v: 0 });
  });

  it('sobrevive à escrita e releitura do .xlsx', () => {
    const buf = XLSX.write(montarWorkbook(data), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const ws = XLSX.read(buf, { type: 'array' }).Sheets.Dados;
    expect(ws.A2.v).toBe('00123');
    expect(ws.B2).toBeUndefined();
    expect(ws.B3.v).toBe(10.5);
  });

  it('valor vazio no Resumo é célula ausente', () => {
    const ws = montarWorkbook(data).Sheets.Resumo;
    const rotulo = Object.keys(ws).find((k) => !k.startsWith('!') && ws[k].v === 'Lucro')!;
    const { r } = XLSX.utils.decode_cell(rotulo);
    expect(ws[XLSX.utils.encode_cell({ r, c: 1 })]).toBeUndefined();
  });
});
```

  `src/components/export/__tests__/botao-exportar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BotaoExportar } from '../botao-exportar';

const { exportarMock } = vi.hoisted(() => ({ exportarMock: vi.fn() }));
vi.mock('@/lib/export', async (original) => ({ ...(await original<typeof import('@/lib/export')>()), exportar: exportarMock }));

const report = { titulo: 'T', colunas: [], linhas: [] };

describe('BotaoExportar', () => {
  it('formatos=[excel]: botão direto, sem PDF/CSV/Imprimir', async () => {
    const montar = vi.fn(() => report);
    render(<BotaoExportar formatos={['excel']} montarReport={montar} />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar Excel' }));
    expect(screen.queryByText('PDF')).not.toBeInTheDocument();
    expect(screen.queryByText('CSV')).not.toBeInTheDocument();
    expect(montar).toHaveBeenCalledWith({ formato: 'excel', expandido: false, incluirKpis: false });
    expect(exportarMock).toHaveBeenCalledWith(report, 'excel');
  });

  it('acima do teto: desabilitado e pede período menor (nunca arquivo cortado)', () => {
    render(<BotaoExportar formatos={['excel']} montarReport={() => report} totalLinhas={10_001} limiteLinhas={10_000} />);
    expect(screen.getByRole('button', { name: /Exportar Excel/ })).toBeDisabled();
    expect(screen.getByText(/reduza o período/)).toBeInTheDocument();
  });

  it('sem formatos: continua com os 4 de antes (regressão das outras telas)', async () => {
    render(<BotaoExportar montarReport={() => report} />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    for (const f of ['PDF', 'Excel', 'CSV', 'Imprimir']) expect(await screen.findByRole('menuitem', { name: f })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/lib/export/export.test.ts src/components/export/__tests__/botao-exportar.test.tsx`
Expected: FAIL:
- `ws.B2` é `{ t: 's', v: '' }`;
- `z` ausente;
- não existe botão "Exportar Excel".

- [ ] **Step 3: Implement.** Em `src/lib/export/tipos.ts`:

```ts
/** Formato numérico da coluna no Excel. Sem formato: texto (código, rótulo). */
export type FormatoCelula = 'dinheiro' | 'percentual' | 'inteiro';

export interface Coluna {
  chave: string;
  titulo: string;
  alinhamento?: Alinhamento;
  formato?: FormatoCelula;
}
```

  Em `src/lib/export/excel.ts`, trocar o import para `import type { ReportData, Celula, Coluna, FormatoCelula } from './tipos';` e:

```ts
const FORMATO_EXCEL: Record<FormatoCelula, string> = { dinheiro: '#,##0.00', percentual: '0.0%', inteiro: '0' };

// null/ausente fica null: o SheetJS omite a célula (vazia de verdade), em vez de uma string '' (Fatia 3:
// indisponível nunca vira 0 nem texto).
function valoresLinha(colunas: Coluna[], celulas: Celula): Array<string | number | null> {
  return colunas.map((c) => celulas[c.chave] ?? null);
}
```

  Ainda em `montarWorkbook`, fazer três trocas:
  - nos dois `push` de itens do Resumo, trocar `k.valor` e `it.valor` por `k.valor === '' ? null : k.valor` e `it.valor === '' ? null : it.valor`;
  - trocar `XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dados), 'Dados');` por:

```ts
  const wsDados = XLSX.utils.aoa_to_sheet(dados);
  data.colunas.forEach((c, col) => {
    if (!c.formato) return;
    for (let r = 1; r < dados.length; r++) {
      const cel = wsDados[XLSX.utils.encode_cell({ r, c: col })];
      if (cel?.t === 'n') cel.z = FORMATO_EXCEL[c.formato];
    }
  });
  XLSX.utils.book_append_sheet(wb, wsDados, 'Dados');
```

  Em `src/components/export/botao-exportar.tsx`:
  - Import `useId`.
  - Props novas:

```ts
  /** Formatos oferecidos (padrão: PDF, Excel, CSV, Imprimir). Com um só, vira botão direto. */
  formatos?: ExportFormato[];
  /** Teto de linhas medido: acima dele o export é bloqueado (nunca um arquivo cortado). */
  limiteLinhas?: number;
```

  - Constantes de módulo:

```ts
const TODOS: ExportFormato[] = ['pdf', 'excel', 'csv', 'imprimir'];
const ICONE: Record<ExportFormato, typeof FileText> = { pdf: FileText, excel: FileSpreadsheet, csv: FileSpreadsheet, imprimir: Printer };
const ITEM: Record<ExportFormato, string> = { pdf: 'PDF', excel: 'Excel', csv: 'CSV', imprimir: 'Imprimir' };
```

  - No componente: desestruturar `formatos = TODOS, limiteLinhas` e acrescentar:

```ts
  const idAviso = useId();
  const acimaDoTeto = limiteLinhas != null && totalLinhas != null && totalLinhas > limiteLinhas;
```

  - Na 1ª linha de `escolher`, pôr `if (acimaDoTeto) return;`.
  - Trocar o bloco `<DropdownMenu>…</DropdownMenu>` por:

```tsx
      {formatos.length === 1 ? (
        <Button variant="outline" size={size} className={className} disabled={acimaDoTeto || gerando}
          aria-describedby={acimaDoTeto ? idAviso : undefined} onClick={() => escolher(formatos[0])}>
          <Download data-icon="inline-start" />
          {`Exportar ${ITEM[formatos[0]]}`}
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size={size} className={className} disabled={acimaDoTeto}
              aria-describedby={acimaDoTeto ? idAviso : undefined}>
              <Download data-icon="inline-start" />
              Exportar
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {formatos.map((f) => {
              const Icone = ICONE[f];
              return (
                <DropdownMenuItem key={f} onSelect={() => escolher(f)}>
                  <Icone className="h-4 w-4" /> {ITEM[f]}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {acimaDoTeto && (
        <p id={idAviso} className="text-xs text-warning">
          {`Mais de ${limiteLinhas!.toLocaleString('pt-BR')} linhas: reduza o período ou filtre a tabela para exportar.`}
        </p>
      )}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/lib/export src/components/export`
Expected: PASS, incluindo os testes antigos (`01/06`, sublinhas, PK).

Depois: `pnpm preflight:static`, então `pnpm test`.

- [ ] **Step 5: Commit.** Gravar `/Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t5.txt`:

```
feat(export): células tipadas no Excel e botão com formatos e teto de linhas

Indisponível vira célula vazia (nunca '' nem 0); dinheiro/percentual com formato;
BotaoExportar aceita só-XLSX e bloqueia acima do teto medido.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

  `/usr/bin/git add src/lib/export/tipos.ts src/lib/export/excel.ts src/components/export/botao-exportar.tsx tests/lib/export/export.test.ts src/components/export/__tests__/botao-exportar.test.tsx`

  `/usr/bin/git commit -F /Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t5.txt`

---

### Task 6: XLSX do ranking (solto e por família) + botão na aba

**Files:**
- Create: `src/lib/export/vendas-sku-xlsx.ts`, `tests/lib/export/vendas-sku-xlsx.test.ts`, `src/components/faturamento/__tests__/ranking-sku-export.test.tsx`
- Modify: `src/hooks/useVendasSku.ts` (retorna `janela`, `anterior`), `src/components/faturamento/aba-vendas-sku.tsx`, `src/components/faturamento/__tests__/aba-vendas-sku.test.tsx`

**Interfaces:**
- Consumes:
  - `FormatoCelula`, `Coluna`, `BotaoExportar({ formatos, limiteLinhas })` (Task 5);
  - `LinhaSku`, `LinhaFamilia`, `KpisSku`, `somarAcumuladores`, `metricas`, `SEM_CODIGO` (`vendas-sku.ts`);
  - `TENDENCIA`, `ALERTA` (`rotulos-sku.ts`).
- Produces:

```ts
export const TETO_LINHAS_XLSX = 10_000;
export const instanteBRT: (d: string | Date) => string;   // "27/09/2026, 14:05"
export const janelaBRT: (j: Janela) => string;
export interface RankingSkuArgs {
  linhas: LinhaSku[];               // `filtradas`, na ordem da tela
  familias: LinhaFamilia[] | null;  // agrupado, na ordem da tela
  kpis: KpisSku;                    // gerais do período (antes dos filtros da tabela)
  janela: Janela; anterior: Janela;
  filtros: string[];                // já formatados pela tela
  ordem: string;                    // rótulo da ordenação
  baseAbc: 'lucro' | 'bruto';
  abc: Map<string, ClasseAbc>;
  tendencias: Map<string, Tendencia>;
  alertas: Map<string, Alerta[]>;
  agora: Date;
}
export function buildRankingSkuReport(a: RankingSkuArgs): ReportData;
/** Nº de linhas de dados que o export terá (família + variações quando agrupado). */
export function contarLinhasRanking(linhas: LinhaSku[], familias: LinhaFamilia[] | null): number;
```

- `useVendasSku(periodo)` passa a devolver também `janela: Janela` e `anterior: Janela`, os mesmos objetos memoizados que alimentam `montarVendasSku`.

- [ ] **Step 1: Failing tests.** `tests/lib/export/vendas-sku-xlsx.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { agruparPorPedido } from '@/lib/pedidos-faturamento';
import { agruparPorFamilia, montarVendasSku, curvaAbc } from '@/lib/vendas-sku';
import { buildRankingSkuReport, contarLinhasRanking } from '@/lib/export/vendas-sku-xlsx';
import { montarWorkbook } from '@/lib/export/excel';
import { fmtBRL, round2 } from '@/lib/formato';
import type { Venda, VendaItem } from '@/lib/faturamento';
import type { CatalogoSku } from '@/lib/vendas-sku-catalogo';
import type { CustoResolver } from '@/lib/resumo-vendas';

function item(over: Partial<VendaItem> = {}): VendaItem {
  return { id: 'it', ml_item_id: 'MLB1', variation_id: null, titulo: 'Camiseta', codigo: '00123', cor: null,
    ean: null, quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true, ...over };
}
function venda(over: Partial<Venda> = {}): Venda {
  return { id: 'v', org_id: 'org-1', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
    date_closed: '2026-09-10T12:00:00Z', date_created: null, comprador_nick: 'NICK_SECRETO', comprador_nome: 'Nome Secreto',
    comprador_id: 424242, uf: 'SP', cidade: 'Cidade Secreta', total_amount: 10, paid_amount: 10, liquido: 9,
    sale_fee_total: 1, frete_vendedor: null, estorno: null, money_release_date: null, sacado_em: null, sacado_por: null,
    atualizado_em: '2026-09-10T12:00:00Z', currency: 'BRL', shipping_id: null, shipping_status: null,
    shipping_substatus: null, shipping_logistic: null, tracking_number: 'RASTREIO_SECRETO', is_publiai: true,
    tem_devolucao: false, kit_item_id: null, itens: [item()], ...over };
}
const cat = (codigo: string, codigoPai: string): CatalogoSku => ({
  codigo, codigoPai, nomeFamilia: `Família ${codigoPai}`, nome: `Produto ${codigo}`, cor: null, tamanho: null, estoque: 5,
  fornecedor: 'Forn', origem: 'nacional', ehKit: false, primeiraVenda: '2026-06-01T12:00:00Z', ultimaVenda: '2026-09-10T12:00:00Z',
  kitMultiplicador: null, kitBaseCodigo: null, estoqueKit: null,
});

// Pack 9: 00123 pago + 0456 cancelado (pack com order cancelada); 0789 com custo parcial (i4 sem custo).
const vendas = [
  venda({ id: 'a', order_id: 1, pack_id: 9, shipping_id: 77, frete_vendedor: 6, total_amount: 30, sale_fee_total: 3, liquido: 21,
    itens: [item({ id: 'i1', codigo: '00123', quantity: 2, unit_price: 15 })] }),
  venda({ id: 'b', order_id: 2, pack_id: 9, shipping_id: 77, status: 'cancelled', total_amount: 20, liquido: 0,
    itens: [item({ id: 'i2', codigo: '0456', unit_price: 20 })] }),
  venda({ id: 'c', order_id: 3, total_amount: 50, sale_fee_total: 5, liquido: 45, itens: [item({ id: 'i3', codigo: '0789', unit_price: 50 })] }),
  venda({ id: 'd', order_id: 4, total_amount: 50, sale_fee_total: 5, liquido: 45, itens: [item({ id: 'i4', codigo: '0789', unit_price: 50 })] }),
  venda({ id: 'e', order_id: 5, total_amount: 12.34, sale_fee_total: 1.11, liquido: 11.23, itens: [item({ id: 'i5', codigo: '0999', unit_price: 12.34 })] }),
];
const custo: CustoResolver = (it) => (it.id === 'i4' ? null : 4);
const catalogo = new Map([['00123', cat('00123', 'P1')], ['0456', cat('0456', 'P1')], ['0789', cat('0789', 'P2')], ['0999', cat('0999', 'P2')]]);
const janela = { desde: '2026-09-01T03:00:00.000Z', ate: '2026-10-01T02:59:59.999Z' };
const anterior = { desde: '2026-08-02T03:00:00.000Z', ate: '2026-09-01T02:59:59.999Z' };
const dados = montarVendasSku({ vendas, agrupar: (vs) => agruparPorPedido(vs, custo), janela, anterior, catalogo, devolucoes: [] });
const base = {
  kpis: dados.kpis, janela, anterior, ordem: 'Lucro', baseAbc: 'lucro' as const,
  tendencias: dados.tendencias, alertas: dados.alertas, agora: new Date('2026-09-27T17:05:00Z'),
};

describe('buildRankingSkuReport', () => {
  it('fixture cobre pack com order cancelada e custo parcial', () => {
    expect(dados.linhas.find((l) => l.codigo === '0456')?.acc.canceladas).toBe(1);
    expect(dados.linhas.find((l) => l.codigo === '0789')?.m.fonteCusto).toBe('parcial');
  });

  it('paridade centavo a centavo com as LinhaSku da tabela, na mesma ordem; indisponível vazio; código texto', () => {
    const filtradas = dados.linhas;
    const r = buildRankingSkuReport({ ...base, linhas: filtradas, familias: null, filtros: [], abc: curvaAbc(filtradas, 'lucro') });
    expect(r.linhas).toHaveLength(filtradas.length + 1);
    filtradas.forEach((l, i) => {
      const c = r.linhas[i].celulas;
      expect(c.codigo).toBe(l.codigo);
      expect(c.faturamento).toBe(round2(l.acc.bruto));
      expect(fmtBRL(c.faturamento as number)).toBe(fmtBRL(l.acc.bruto));
      expect(c.lucro).toBe(l.m.lucro);
      expect(c.unidades).toBe(l.acc.unidades);
      expect(c.canceladas).toBe(l.acc.canceladas);
    });
    const soCancelada = r.linhas.find((x) => x.celulas.codigo === '0456')!.celulas;
    expect(soCancelada).toMatchObject({ lucro: null, markup: null, margem: null, ticket: null, devolucao: null });
    const total = r.linhas.at(-1)!.celulas;
    expect(total.nivel).toBe('Total das linhas exportadas');
    expect(total.faturamento).toBe(round2(filtradas.reduce((s, l) => s + l.acc.bruto, 0)));
    expect(total.faturamento).toBe(dados.kpis.bruto); // sem filtro, o total bate com o KPI geral
  });

  it('com filtro: total das linhas ≠ KPIs gerais, e os dois vêm rotulados no Resumo', () => {
    const filtradas = dados.linhas.filter((l) => l.codigo === '0999');
    const r = buildRankingSkuReport({ ...base, linhas: filtradas, familias: null, filtros: ['Busca: "0999"'], abc: new Map() });
    expect(r.linhas.at(-1)!.celulas.faturamento).toBe(12.34);
    const titulos = r.blocos!.map((b) => b.titulo);
    expect(titulos).toEqual(['Contexto da extração', 'Total das linhas exportadas (com os filtros da tabela)', 'KPIs gerais do período (sem os filtros da tabela)']);
    expect(r.blocos![2].itens.find((k) => k.label === 'Faturamento')!.valor).toBe(fmtBRL(dados.kpis.bruto));
    const contexto = Object.fromEntries(r.blocos![0].itens.map((k) => [k.label, k.valor]));
    expect(contexto).toMatchObject({ 'Linhas exportadas': '1', 'Ordenado por': 'Lucro', 'Extraído em': '27/09/2026, 14:05 (horário de Brasília)' });
    expect(contexto['Comparação']).toBe('período anterior: 02/08/2026, 00:00 a 31/08/2026, 23:59 (horário de Brasília)');
    expect(r.periodo).toBe('01/09/2026, 00:00 a 30/09/2026, 23:59 (horário de Brasília)');
    expect(r.filtros).toEqual(['Busca: "0999"']);
  });

  it('agrupado: família seguida das variações; o total soma só as famílias (sem somar duas vezes)', () => {
    const familias = agruparPorFamilia(dados.linhas);
    const r = buildRankingSkuReport({ ...base, linhas: dados.linhas, familias, filtros: ['Agrupado por família'], abc: new Map() });
    expect(r.linhas).toHaveLength(contarLinhasRanking(dados.linhas, familias) + 1);
    expect(contarLinhasRanking(dados.linhas, familias)).toBe(familias.length + dados.linhas.length);
    const niveis = r.linhas.map((x) => x.celulas.nivel);
    expect(niveis[0]).toBe('Família');
    expect(niveis.filter((n) => n === 'Variação')).toHaveLength(dados.linhas.length);
    const somaFamilias = r.linhas.filter((x) => x.celulas.nivel === 'Família').reduce((s, x) => s + (x.celulas.faturamento as number), 0);
    expect(r.linhas.at(-1)!.celulas.faturamento).toBe(round2(somaFamilias));
    expect(r.linhas.at(-1)!.celulas.faturamento).toBe(dados.kpis.bruto);
  });

  it('no arquivo: código texto, lucro indisponível vazio, nenhum dado de comprador', () => {
    const r = buildRankingSkuReport({ ...base, linhas: dados.linhas, familias: null, filtros: [], abc: new Map() });
    const wb = montarWorkbook(r);
    const ws = wb.Sheets.Dados;
    const linhaCancelada = r.linhas.findIndex((x) => x.celulas.codigo === '0456') + 1; // +1: cabeçalho
    const col = (chave: string) => r.colunas.findIndex((c) => c.chave === chave);
    expect(ws[XLSX.utils.encode_cell({ r: linhaCancelada, c: col('codigo') })]).toMatchObject({ t: 's', v: '0456' });
    expect(ws[XLSX.utils.encode_cell({ r: linhaCancelada, c: col('lucro') })]).toBeUndefined();
    const tudo = JSON.stringify(r);
    for (const proibido of ['424242', 'NICK_SECRETO', 'Nome Secreto', 'RASTREIO_SECRETO', 'Cidade Secreta']) expect(tudo).not.toContain(proibido);
  });
});
```

  `src/components/faturamento/__tests__/ranking-sku-export.test.tsx` faz a paridade com a tabela desenhada, **por posição de célula**. Colunas do `RankingSku`: 0 expandir, 1 SKU, 2 Lucro, 3 Lucro/un., 4 Markup, 5 Margem, 6 Faturamento (1º `div` = bruto), 7 Unidades.

```tsx
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RankingSku } from '@/components/faturamento/ranking-sku';
import { buildRankingSkuReport } from '@/lib/export/vendas-sku-xlsx';
import { agruparPorFamilia, metricas, somarAcumuladores, type LinhaSku, type LinhaFamilia } from '@/lib/vendas-sku';
import { fmtBRL, fmtBRLSinal } from '@/lib/formato';

function linha(codigo: string, codigoPai: string, bruto: number, lucro: number | null): LinhaSku {
  const acc = somarAcumuladores([]);
  acc.bruto = bruto; acc.unidades = 3; acc.liquido = bruto * 0.8; acc.pedidos = 2;
  if (lucro != null) { acc.itensComCusto = 2; acc.unidadesComCusto = 3; acc.liquidoComCusto = bruto * 0.8; acc.custo = bruto * 0.8 - lucro; acc.brutoComCusto = bruto; acc.brutoCustoReal = bruto; }
  else acc.itensSemCusto = 2;
  return { codigo, titulo: `Produto ${codigo}`, imagemPath: null, codigoPai, nomeFamilia: `Fam ${codigoPai}`, fornecedor: null, origem: null,
    ehKit: false, estoque: 1, primeiraVenda: null, acc, m: metricas(acc), pedidoChaves: ['1', '2'] };
}
const kz = { bruto: 0, lucro: null, markup: null, margemSVenda: null, unidades: 0, skusComVenda: 0, skusVendaUnica: 0, concentracaoTop5: null, pctBrutoCustoReal: null, prejuizo: 0 };
const report = (linhas: LinhaSku[], familias: LinhaFamilia[] | null) => buildRankingSkuReport({
  linhas, familias, kpis: kz, filtros: [], ordem: 'Lucro', baseAbc: 'lucro', abc: new Map(), tendencias: new Map(), alertas: new Map(), agora: new Date(),
  janela: { desde: '2026-09-01T03:00:00.000Z', ate: '2026-10-01T02:59:59.999Z' }, anterior: { desde: '2026-08-02T03:00:00.000Z', ate: '2026-09-01T02:59:59.999Z' },
});
const desenhar = (linhas: LinhaSku[], familias: LinhaFamilia[] | null) => render(<MemoryRouter><RankingSku linhas={linhas} familias={familias}
  tendencias={new Map()} coberturas={new Map()} alertas={new Map()} abc={new Map()} ordem="lucro" onOrdem={() => {}} /></MemoryRouter>);
/** [lucro, faturamento] como a tela desenha, linha a linha (sem o cabeçalho). */
const desenhadas = () => screen.getAllByRole('row').slice(1).map((row) => {
  const cels = within(row).getAllByRole('cell');
  return [cels[2].firstChild?.textContent ?? '', cels[6].querySelector('div')?.textContent ?? ''];
});
const esperado = (c: Record<string, unknown>) => [c.lucro == null ? '—' : fmtBRLSinal(c.lucro as number), fmtBRL(c.faturamento as number)];
const linhas = [linha('00123', 'P1', 1234.567, 210.4), linha('0456', 'P1', 99.995, null), linha('0789', 'P2', 10, -3.21)];

describe('XLSX × tabela desenhada (centavo a centavo)', () => {
  it('ranking solto: lucro e faturamento de cada linha exportada = os da mesma linha na tela', () => {
    desenhar(linhas, null);
    const r = report(linhas, null);
    expect(desenhadas()).toEqual(r.linhas.slice(0, -1).map((x) => esperado(x.celulas)));
  });

  it('agrupado por família (recolhido): cada linha de família exportada = a linha de família da tela', () => {
    const familias = agruparPorFamilia(linhas);
    desenhar(linhas, familias);
    const r = report(linhas, familias);
    const doArquivo = r.linhas.filter((x) => x.celulas.nivel === 'Família').map((x) => esperado(x.celulas));
    expect(desenhadas()).toEqual(doArquivo);
  });
});
```

  (Na célula de Lucro, `firstChild` é o texto do valor: o `*` e o sr-only do "parcial" são nós irmãos. Se o `render` do 2º teste somar ao do 1º, chamar `cleanup()` do Testing Library no início dele.)

  Em `src/components/faturamento/__tests__/aba-vendas-sku.test.tsx`:
  - O mock de `useVendasSku` passa a devolver também `janela: { desde: '2026-09-01T03:00:00.000Z', ate: '2026-10-01T02:59:59.999Z' }, anterior: { desde: '2026-08-02T03:00:00.000Z', ate: '2026-09-01T02:59:59.999Z' }`.
  - Acrescentar o mock e o teste:

```tsx
const { exportarMock } = vi.hoisted(() => ({ exportarMock: vi.fn() }));
vi.mock('@/lib/export', async (original) => ({ ...(await original<typeof import('@/lib/export')>()), exportar: exportarMock }));

  it('Exportar Excel leva as linhas FILTRADAS, na ordem da tela, e rotula os filtros', async () => {
    renderAba();
    fireEvent.change(screen.getByLabelText('Buscar SKU'), { target: { value: 'Produto C' } });
    fireEvent.click(screen.getByRole('button', { name: 'Exportar Excel' }));
    await vi.waitFor(() => expect(exportarMock).toHaveBeenCalled());
    const [report, formato] = exportarMock.mock.calls.at(-1)!;
    expect(formato).toBe('excel');
    expect(report.linhas.map((l: { celulas: { codigo: unknown } }) => l.celulas.codigo)).toEqual(['C', undefined]);
    expect(report.filtros).toEqual(['Busca: "Produto C"']);
  });

  it('filtro sem resultado: sem botão de exportar (nada de arquivo só com o total zerado)', () => {
    renderAba();
    fireEvent.change(screen.getByLabelText('Buscar SKU'), { target: { value: 'não existe' } });
    expect(screen.queryByRole('button', { name: 'Exportar Excel' })).not.toBeInTheDocument();
  });
```

  (A linha de total não tem `codigo`: fica `undefined`.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/lib/export/vendas-sku-xlsx.test.ts src/components/faturamento/__tests__/ranking-sku-export.test.tsx src/components/faturamento/__tests__/aba-vendas-sku.test.tsx`
Expected: FAIL (módulo inexistente; botão ausente).

- [ ] **Step 3: Implement.** `src/lib/export/vendas-sku-xlsx.ts`:

```ts
// Exportação XLSX da Vendas SKU (ADR-0172 Fatia 3). Exporta os MESMOS objetos que a tela desenha
// (LinhaSku, LinhaFamilia, PontoSerie): nenhum dinheiro é recalculado aqui.
// - Número vai como número, em centavos por round2, igual ao fmtBRL da tela.
// - Indisponível vai como null (célula vazia), nunca 0.
// - Código vai como texto: zeros à esquerda preservados.
// - Nenhum dado de comprador: PontoSerie.pedidos nunca é lido.
import { fmtBRL, fmtBRLSinal, fmtInt, fmtMarkup, round2 } from '@/lib/formato';
import { ALERTA, TENDENCIA } from '@/components/faturamento/rotulos-sku';
import {
  SEM_CODIGO, metricas, somarAcumuladores,
  type AcumuladorSku, type Alerta, type ClasseAbc, type FonteCusto, type KpisSku, type LinhaFamilia, type LinhaSku,
  type MetricasSku, type Tendencia,
} from '@/lib/vendas-sku';
import type { Janela } from '@/lib/metricas';
import type { Passo } from '@/lib/calendario-brt';
import type { DossieSku } from '@/lib/sku-dossie';
import type { Celula, Coluna, Kpi, Linha, ReportData } from './tipos';

/** Teto de linhas por arquivo, confirmado por medição na Task 9 (montagem + escrita em memória).
 *  Acima dele o botão pede um período menor: arquivo cortado é proibido. */
export const TETO_LINHAS_XLSX = 10_000;

const BRT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
export const instanteBRT = (d: string | Date) => BRT.format(new Date(d));
export const janelaBRT = (j: Janela) => `${instanteBRT(j.desde)} a ${instanteBRT(j.ate)} (horário de Brasília)`;

const FONTE: Record<FonteCusto, string> = { real: 'custo real', estimado: 'custo estimado', parcial: 'lucro parcial', sem_custo: 'sem custo' };
const pct1 = (v: number | null) => (v == null ? '' : `${(v * 100).toFixed(1).replace('.', ',')}%`);
const custoReal = (acc: AcumuladorSku) => (acc.bruto > 0 ? acc.brutoCustoReal / acc.bruto : null);

/** Colunas numéricas, iguais para SKU, família e total. */
function numeros(acc: AcumuladorSku, m: MetricasSku): Celula {
  return {
    lucro: m.lucro, lucroPorUnidade: m.lucroPorUnidade, markup: m.markup, margem: m.margemSVenda,
    faturamento: round2(acc.bruto), ticket: acc.unidades > 0 ? m.ticket : null, unidades: acc.unidades,
    canceladas: acc.canceladas, devolucao: m.taxaDevolucao, fonteCusto: FONTE[m.fonteCusto], custoReal: custoReal(acc),
  };
}

/** Resumo em texto, formatado como na tela; '' = indisponível (vira célula vazia). */
function resumo(acc: AcumuladorSku, m: MetricasSku): Kpi[] {
  return [
    { label: 'Faturamento', valor: fmtBRL(acc.bruto) },
    { label: 'Lucro', valor: m.lucro == null ? '' : fmtBRLSinal(m.lucro) },
    { label: 'Markup', valor: m.markup == null ? '' : fmtMarkup(m.markup) },
    { label: 'Margem s/ venda', valor: pct1(m.margemSVenda) },
    { label: 'Unidades', valor: fmtInt(acc.unidades) },
    { label: 'Fonte do custo', valor: FONTE[m.fonteCusto] },
    { label: 'Faturamento com custo real', valor: pct1(custoReal(acc)) },
  ];
}

const COLS_RANKING: Coluna[] = [
  { chave: 'nivel', titulo: 'Nível' },
  { chave: 'codigo', titulo: 'Código' },
  { chave: 'titulo', titulo: 'Produto' },
  { chave: 'familia', titulo: 'Código da família' },
  { chave: 'nomeFamilia', titulo: 'Família' },
  { chave: 'fornecedor', titulo: 'Fornecedor' },
  { chave: 'origem', titulo: 'Origem' },
  { chave: 'lucro', titulo: 'Lucro (R$)', formato: 'dinheiro' },
  { chave: 'lucroPorUnidade', titulo: 'Lucro por unidade (R$)', formato: 'dinheiro' },
  { chave: 'markup', titulo: 'Markup', formato: 'percentual' },
  { chave: 'margem', titulo: 'Margem s/ venda', formato: 'percentual' },
  { chave: 'faturamento', titulo: 'Faturamento (R$)', formato: 'dinheiro' },
  { chave: 'ticket', titulo: 'Preço médio (R$)', formato: 'dinheiro' },
  { chave: 'unidades', titulo: 'Unidades', formato: 'inteiro' },
  { chave: 'canceladas', titulo: 'Canceladas (un.)', formato: 'inteiro' },
  { chave: 'devolucao', titulo: 'Taxa de devolução', formato: 'percentual' },
  { chave: 'fonteCusto', titulo: 'Fonte do custo' },
  { chave: 'custoReal', titulo: 'Faturamento com custo real', formato: 'percentual' },
  { chave: 'abc', titulo: 'ABC' },
  { chave: 'tendencia', titulo: 'Tendência' },
  { chave: 'alertas', titulo: 'Alertas' },
];

export interface RankingSkuArgs {
  linhas: LinhaSku[];
  familias: LinhaFamilia[] | null;
  kpis: KpisSku;
  janela: Janela;
  anterior: Janela;
  filtros: string[];
  ordem: string;
  baseAbc: 'lucro' | 'bruto';
  abc: Map<string, ClasseAbc>;
  tendencias: Map<string, Tendencia>;
  alertas: Map<string, Alerta[]>;
  agora: Date;
}

export function contarLinhasRanking(linhas: LinhaSku[], familias: LinhaFamilia[] | null): number {
  return familias ? familias.reduce((s, f) => s + 1 + f.filhos.length, 0) : linhas.length;
}

export function buildRankingSkuReport(a: RankingSkuArgs): ReportData {
  const alertasTexto = (xs: Alerta[]) => (xs.length ? xs.map((x) => ALERTA[x].label).join('; ') : null);
  const sku = (l: LinhaSku, nivel: string, abc: ClasseAbc | undefined): Linha => {
    const t = a.tendencias.get(l.codigo);
    return { celulas: {
      nivel, codigo: l.codigo === SEM_CODIGO ? null : l.codigo, titulo: l.titulo, familia: l.codigoPai,
      nomeFamilia: l.nomeFamilia, fornecedor: l.fornecedor,
      origem: l.origem === 'nacional' ? 'Nacional' : l.origem === 'importado' ? 'Importado' : null,
      ...numeros(l.acc, l.m), abc: abc ?? null, tendencia: t ? TENDENCIA[t].label : null,
      alertas: alertasTexto(a.alertas.get(l.codigo) ?? []),
    } };
  };

  const linhas: Linha[] = [];
  const topo: AcumuladorSku[] = [];
  if (a.familias) {
    for (const f of a.familias) {
      const semFamilia = f.codigoPai.startsWith('sem-familia:');
      linhas.push({ celulas: {
        nivel: 'Família', codigo: semFamilia ? null : f.codigoPai, titulo: f.nomeFamilia ?? f.filhos[0].titulo,
        familia: semFamilia ? null : f.codigoPai, nomeFamilia: f.nomeFamilia,
        ...numeros(f.acc, f.m), abc: a.abc.get(f.codigoPai) ?? null,
        alertas: alertasTexto([...new Set(f.filhos.flatMap((x) => a.alertas.get(x.codigo) ?? []))]),
      } });
      topo.push(f.acc);
      // Como na tela: ABC só na linha de cima (a família), tendência por variação.
      for (const x of f.filhos) linhas.push(sku(x, 'Variação', undefined));
    }
  } else {
    for (const l of a.linhas) {
      linhas.push(sku(l, l.codigo === SEM_CODIGO ? 'Sem código' : 'SKU', a.abc.get(l.codigo)));
      topo.push(l.acc);
    }
  }
  const total = somarAcumuladores(topo);
  const mTotal = metricas(total);
  const exportadas = linhas.length;
  linhas.push({ celulas: { nivel: 'Total das linhas exportadas', ...numeros(total, mTotal) } });

  const k = a.kpis;
  return {
    titulo: a.familias ? 'Vendas SKU · Famílias' : 'Vendas SKU · Ranking',
    periodo: janelaBRT(a.janela),
    filtros: a.filtros.length ? a.filtros : ['Nenhum filtro'],
    blocos: [
      { titulo: 'Contexto da extração', itens: [
        { label: 'Comparação', valor: `período anterior: ${janelaBRT(a.anterior)}` },
        { label: 'Ordenado por', valor: a.ordem },
        { label: 'Curva ABC por', valor: a.baseAbc === 'lucro' ? 'lucro' : 'faturamento' },
        { label: 'Extraído em', valor: `${instanteBRT(a.agora)} (horário de Brasília)` },
        { label: 'Linhas exportadas', valor: fmtInt(exportadas) },
        ...(a.familias ? [{ label: 'Leitura', valor: 'Cada família vem seguida das variações; o total soma só as linhas de família.' }] : []),
      ] },
      { titulo: 'Total das linhas exportadas (com os filtros da tabela)', itens: resumo(total, mTotal) },
      { titulo: 'KPIs gerais do período (sem os filtros da tabela)', itens: [
        { label: 'Faturamento', valor: fmtBRL(k.bruto) },
        { label: 'Lucro', valor: k.lucro == null ? '' : fmtBRLSinal(k.lucro) },
        { label: 'Markup', valor: k.markup == null ? '' : fmtMarkup(k.markup) },
        { label: 'Margem s/ venda', valor: pct1(k.margemSVenda) },
        { label: 'Unidades', valor: fmtInt(k.unidades) },
        { label: 'SKUs com venda', valor: fmtInt(k.skusComVenda) },
        { label: 'Faturamento com custo real', valor: pct1(k.pctBrutoCustoReal) },
        { label: 'Prejuízo total', valor: fmtBRLSinal(k.prejuizo) },
      ] },
    ],
    colunas: COLS_RANKING,
    linhas,
  };
}
```

  (A série do dossiê entra neste mesmo arquivo na Task 7. Os imports de `Passo` e `DossieSku` só entram lá: não acrescentar agora para o lint não reclamar de import sem uso.)

  Em `src/hooks/useVendasSku.ts`, no objeto devolvido, acrescentar `janela, anterior,` logo depois de `dados,`.

  Em `src/components/faturamento/aba-vendas-sku.tsx`:
  - Imports:

```ts
import { BotaoExportar } from '@/components/export/botao-exportar';
import { buildRankingSkuReport, contarLinhasRanking, TETO_LINHAS_XLSX } from '@/lib/export/vendas-sku-xlsx';
```

  - Constante de módulo:

```ts
const ROTULO_ORDEM: Record<ChaveOrdem, string> = { lucro: 'Lucro', bruto: 'Faturamento', unidades: 'Unidades', lucroPorUnidade: 'Lucro por unidade' };
```

  - Trocar a desestruturação do hook por `const { dados, janela, anterior, isLoading, isFetching, isError, refetch } = useVendasSku(periodo);`.
  - Logo depois de `const nPrejuizo = …`, acrescentar:

```ts
  const filtrosTexto = [
    busca && `Busca: "${busca}"`, familia && `Família: ${familia}`, fornecedor && `Fornecedor: ${fornecedor}`,
    origem && `Origem: ${origem === 'nacional' ? 'Nacional' : 'Importado'}`,
    soSemCusto && 'Só sem custo ou lucro parcial', porFamilia && 'Agrupado por família',
  ].filter((x): x is string => !!x);
```

  - No fim da barra de filtros, depois do `<span className="ml-auto …">` da contagem, inserir o botão abaixo. Sem nenhuma linha (filtro vazio), não há o que exportar: o botão não aparece, e o corpo da tabela já mostra "Nenhum SKU com esses filtros".

```tsx
        {contarLinhasRanking(filtradas, familias) > 0 && <BotaoExportar formatos={['excel']} className={BOTAO} totalLinhas={contarLinhasRanking(filtradas, familias)}
          limiteLinhas={TETO_LINHAS_XLSX}
          montarReport={() => buildRankingSkuReport({
            linhas: filtradas, familias, kpis, janela, anterior, filtros: filtrosTexto, ordem: ROTULO_ORDEM[ordem],
            baseAbc, abc, tendencias: dados.tendencias, alertas: dados.alertas, agora: new Date(),
          })} />}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/lib/export src/components/faturamento`
Expected: PASS.

Depois:
- `bash /Users/diego/.claude/skills/frontend-design-fable5/scripts/preflight.sh --allow-lucide src/components/faturamento/aba-vendas-sku.tsx src/components/export/botao-exportar.tsx`. Expected: exit 0.
- `pnpm preflight:static`, então `pnpm test`.

- [ ] **Step 5: Commit.** Gravar `/Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t6.txt`:

```
feat(vendas-sku): exportação XLSX do ranking (solto e por família)

Mesmas LinhaSku da tabela, centavo a centavo; total das linhas separado dos KPIs gerais;
período BRT, comparação, filtros e instante no Resumo; sem dados de comprador.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

  `/usr/bin/git add src/lib/export/vendas-sku-xlsx.ts tests/lib/export/vendas-sku-xlsx.test.ts src/components/faturamento/__tests__/ranking-sku-export.test.tsx src/hooks/useVendasSku.ts src/components/faturamento/aba-vendas-sku.tsx src/components/faturamento/__tests__/aba-vendas-sku.test.tsx`

  `/usr/bin/git commit -F /Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t6.txt`

---

### Task 7: XLSX da série do dossiê + botão (UI premium)

**Files:**
- Modify: `src/lib/export/vendas-sku-xlsx.ts`, `src/hooks/useSkuDossie.ts` (retorna `janela`), `src/pages/SkuDossie.tsx`
- Test: `tests/lib/export/vendas-sku-xlsx.test.ts`, `src/pages/__tests__/SkuDossie.test.tsx`

**Interfaces:**
- Consumes: `DossieSku` (`serie`, `linhaPeriodo`, `codigos`, `titulo`, `catalogo`), `Passo`, `instanteBRT`, `janelaBRT`, `TETO_LINHAS_XLSX` (Task 6).
- Produces:
  - `buildSerieDossieReport(a: { dados: DossieSku; familia: boolean; passo: Passo; janela: Janela; agora: Date }): ReportData`;
  - `useSkuDossie` devolve também `janela: Janela`.

- [ ] **Step 1: Failing tests.** Em `tests/lib/export/vendas-sku-xlsx.test.ts`, acrescentar `buildSerieDossieReport` ao import de `@/lib/export/vendas-sku-xlsx`, e aos imports do topo `import { intervalosBRT } from '@/lib/calendario-brt';` e `import type { DossieSku, PontoSerie } from '@/lib/sku-dossie';`. No fim do arquivo:

```ts
describe('buildSerieDossieReport', () => {
  const ivs = intervalosBRT('2026-09-14T03:00:00.000Z', '2026-09-27T02:59:59.999Z', 'semana', new Date('2026-09-25T12:00:00Z'));
  const pedidoComComprador = agruparPorPedido([venda()])[0]; // carrega nick/nome: não pode vazar
  const ponto = (i: number, over: Partial<PontoSerie>): PontoSerie => ({
    intervalo: ivs[i], unidades: 0, bruto: 0, lucro: null, fonteCusto: 'real', precoMedio: null, precoMin: null,
    precoMax: null, unidadesKit: 0, pedidos: [pedidoComComprador], ...over,
  });
  const serie = [
    ponto(0, { unidades: 3, bruto: 33.335, lucro: 18.1, fonteCusto: 'estimado', precoMedio: 11.11, precoMin: 10, precoMax: 13.34 }),
    ponto(1, { unidades: 1, bruto: 50, lucro: null, fonteCusto: 'sem_custo', precoMedio: 50, precoMin: 50, precoMax: 50, unidadesKit: 1 }),
  ];
  const dossie = { codigos: ['00123'], titulo: 'Camiseta Azul', catalogo: [cat('00123', 'P1')], serie, linhaPeriodo: dados.linhas[0] } as unknown as DossieSku;
  const r = buildSerieDossieReport({ dados: dossie, familia: false, passo: 'semana', janela, agora: new Date('2026-09-27T17:05:00Z') });

  it('uma linha por ponto da série, com os mesmos números; intervalo corrente marcado parcial', () => {
    expect(r.linhas).toHaveLength(3);
    expect(r.linhas[0].celulas).toMatchObject({ intervalo: 'Semana de 14/09', situacao: 'completo', unidades: 3, faturamento: 33.335, lucro: 18.1, fonteCusto: 'custo estimado', precoMedio: 11.11 });
    expect(r.linhas[1].celulas).toMatchObject({ situacao: 'parcial (em andamento)', lucro: null, fonteCusto: 'sem custo', unidadesKit: 1 });
    expect(r.linhas[0].celulas.inicio).toBe('14/09/2026, 00:00');
    expect(r.linhas[0].celulas.fim).toBe('20/09/2026, 23:59');
  });

  it('total das linhas: soma unidades e faturamento; lucro parcial quando um ponto não tem custo', () => {
    expect(r.linhas[2].celulas).toMatchObject({
      intervalo: 'Total das linhas exportadas', unidades: 4, faturamento: round2(83.335), lucro: 18.1, fonteCusto: 'lucro parcial', unidadesKit: 1,
    });
    expect(r.blocos!.map((b) => b.titulo)).toEqual(['Contexto da extração', 'Total das linhas exportadas', 'KPIs do período escolhido']);
  });

  it('nenhum dado de comprador (PontoSerie.pedidos nunca é lido)', () => {
    const tudo = JSON.stringify(r);
    for (const proibido of ['424242', 'NICK_SECRETO', 'Nome Secreto', 'RASTREIO_SECRETO', 'Cidade Secreta']) expect(tudo).not.toContain(proibido);
  });
});
```

  Em `src/pages/__tests__/SkuDossie.test.tsx`:
  - Em `renderPagina`, no `mockReturnValue`, acrescentar `janela: { desde: '2026-09-01T03:00:00.000Z', ate: '2026-10-01T02:59:59.999Z' }`.
  - Acrescentar:

```tsx
  it('série tem botão "Exportar Excel"; sem vendas, não', () => {
    renderPagina('ok', dossie());
    expect(screen.getByRole('button', { name: 'Exportar Excel' })).toBeInTheDocument();
    cleanup();
    renderPagina('sem_vendas', dossie({ linhaPeriodo: null, tendencia: null, historicoDesde: null, ultimaVenda: null }));
    expect(screen.queryByRole('button', { name: 'Exportar Excel' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/lib/export/vendas-sku-xlsx.test.ts src/pages/__tests__/SkuDossie.test.tsx`
Expected: FAIL (`buildSerieDossieReport` não existe; botão ausente).

- [ ] **Step 3: Implement.** Em `src/lib/export/vendas-sku-xlsx.ts`, acrescentar os imports `import type { Passo } from '@/lib/calendario-brt';` e `import type { DossieSku } from '@/lib/sku-dossie';`, e depois:

```ts
const COLS_SERIE: Coluna[] = [
  { chave: 'intervalo', titulo: 'Intervalo' },
  { chave: 'inicio', titulo: 'Início (horário de Brasília)' },
  { chave: 'fim', titulo: 'Fim (horário de Brasília)' },
  { chave: 'situacao', titulo: 'Situação' },
  { chave: 'unidades', titulo: 'Unidades', formato: 'inteiro' },
  { chave: 'faturamento', titulo: 'Faturamento (R$)', formato: 'dinheiro' },
  { chave: 'lucro', titulo: 'Lucro (R$)', formato: 'dinheiro' },
  { chave: 'fonteCusto', titulo: 'Fonte do custo' },
  { chave: 'precoMedio', titulo: 'Preço médio vendido (R$)', formato: 'dinheiro' },
  { chave: 'precoMin', titulo: 'Preço mín. (R$)', formato: 'dinheiro' },
  { chave: 'precoMax', titulo: 'Preço máx. (R$)', formato: 'dinheiro' },
  { chave: 'unidadesKit', titulo: 'Unidades em Kit Virtual', formato: 'inteiro' },
];

/** Série semanal/mensal do dossiê. Lê só campos escalares de PontoSerie (nunca `pedidos`). */
export function buildSerieDossieReport(a: { dados: DossieSku; familia: boolean; passo: Passo; janela: Janela; agora: Date }): ReportData {
  const s = a.dados.serie;
  const linhas: Linha[] = s.map((p) => ({ celulas: {
    intervalo: a.passo === 'semana' ? `Semana de ${p.intervalo.rotulo}` : p.intervalo.rotulo,
    inicio: instanteBRT(p.intervalo.inicio),
    fim: instanteBRT(new Date(Date.parse(p.intervalo.fim) - 1)), // [inicio, fim): mostra o último instante
    situacao: p.intervalo.incompleto ? 'parcial (em andamento)' : 'completo',
    unidades: p.unidades, faturamento: p.bruto, lucro: p.lucro,
    fonteCusto: p.unidades > 0 ? FONTE[p.fonteCusto] : null,
    precoMedio: p.precoMedio, precoMin: p.precoMin, precoMax: p.precoMax, unidadesKit: p.unidadesKit,
  } }));

  const comVenda = s.filter((p) => p.unidades > 0);
  const lucros = comVenda.flatMap((p) => (p.lucro == null ? [] : [p.lucro]));
  const fontes = new Set(comVenda.map((p) => p.fonteCusto));
  const fonteTotal: FonteCusto | null = !comVenda.length ? null
    : fontes.has('sem_custo') || fontes.has('parcial') ? (lucros.length ? 'parcial' : 'sem_custo')
      : fontes.has('estimado') ? 'estimado' : 'real';
  const unidades = s.reduce((t, p) => t + p.unidades, 0);
  const faturamento = round2(s.reduce((t, p) => t + p.bruto, 0));
  const lucro = lucros.length ? round2(lucros.reduce((t, v) => t + v, 0)) : null;
  const unidadesKit = s.reduce((t, p) => t + p.unidadesKit, 0);
  linhas.push({ celulas: {
    intervalo: 'Total das linhas exportadas', unidades, faturamento, lucro,
    fonteCusto: fonteTotal ? FONTE[fonteTotal] : null, unidadesKit,
  } });

  const codigo = a.familia ? a.dados.catalogo[0]?.codigoPai ?? a.dados.codigos[0] : a.dados.codigos[0];
  const lp = a.dados.linhaPeriodo;
  return {
    titulo: `Dossiê · ${a.familia ? 'família' : 'SKU'} ${codigo}`,
    periodo: janelaBRT(a.janela),
    blocos: [
      { titulo: 'Contexto da extração', itens: [
        { label: a.familia ? 'Família' : 'Código', valor: `${codigo} · ${a.dados.titulo}` },
        { label: 'Agrupamento', valor: a.passo === 'semana' ? 'semana (segunda a domingo, horário de Brasília)' : 'mês civil (horário de Brasília)' },
        { label: 'Bordas', valor: 'o 1º e o último intervalo podem passar das bordas do período; os KPIs do período ficam no bloco abaixo' },
        { label: 'Extraído em', valor: `${instanteBRT(a.agora)} (horário de Brasília)` },
        { label: 'Linhas exportadas', valor: fmtInt(s.length) },
      ] },
      { titulo: 'Total das linhas exportadas', itens: [
        { label: 'Faturamento', valor: fmtBRL(faturamento) },
        { label: 'Lucro', valor: lucro == null ? '' : fmtBRLSinal(lucro) },
        { label: 'Unidades', valor: fmtInt(unidades) },
        { label: 'Fonte do custo', valor: fonteTotal ? FONTE[fonteTotal] : '' },
      ] },
      { titulo: 'KPIs do período escolhido', itens: lp ? resumo(lp.acc, lp.m) : [{ label: 'Resultado', valor: 'sem vendas no período' }] },
    ],
    colunas: COLS_SERIE,
    linhas,
  };
}
```

  Em `src/hooks/useSkuDossie.ts`, no objeto devolvido, acrescentar `janela,` logo depois de `estado: r.estado, dados,`.

  Em `src/pages/SkuDossie.tsx`:
  - Imports:

```ts
import { BotaoExportar } from '@/components/export/botao-exportar';
import { buildSerieDossieReport, TETO_LINHAS_XLSX } from '@/lib/export/vendas-sku-xlsx';
```

  - Desestruturar `janela` de `useSkuDossie(...)`.
  - Trocar o `<TabsList aria-label="Série do período">…</TabsList>` por:

```tsx
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList aria-label="Série do período">
              <TabsTrigger value="vendas" className="px-3">Vendas</TabsTrigger>
              <TabsTrigger value="trafego" className="px-3">Tráfego e oferta</TabsTrigger>
            </TabsList>
            {estado !== 'sem_vendas' && (
              <BotaoExportar formatos={['excel']} totalLinhas={dados.serie.length} limiteLinhas={TETO_LINHAS_XLSX}
                montarReport={() => buildSerieDossieReport({ dados, familia, passo, janela, agora: new Date() })} />
            )}
          </div>
```

- [ ] **Step 4: Run and verify.**
  - Run: `pnpm vitest run tests/lib/export src/pages/__tests__/SkuDossie.test.tsx src/hooks/__tests__/useSkuDossie.test.ts`. Expected: PASS.
  - Run: `bash /Users/diego/.claude/skills/frontend-design-fable5/scripts/preflight.sh --allow-lucide src/pages/SkuDossie.tsx src/components/faturamento/aba-vendas-sku.tsx src/components/export/botao-exportar.tsx`. Expected: exit 0.
  - Depois: `pnpm preflight:static`, então `pnpm test`.
  - **Controlador:** auditoria Tier 2 dos dois botões de exportação (aba e dossiê), cobrindo:
    - alinhamento com os filtros e as abas;
    - estado desabilitado com o aviso "reduza o período";
    - 390 px sem estourar a barra;
    - escuro/claro.

    Só aprova com ≥ 8/10.

- [ ] **Step 5: Commit.** Gravar `/Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t7.txt`:

```
feat(vendas-sku): exportação XLSX da série do dossiê

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

  `/usr/bin/git add src/lib/export/vendas-sku-xlsx.ts tests/lib/export/vendas-sku-xlsx.test.ts src/hooks/useSkuDossie.ts src/pages/SkuDossie.tsx src/pages/__tests__/SkuDossie.test.tsx`

  `/usr/bin/git commit -F /Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t7.txt`

---

### Task 8: Atalhos só de navegação, com guarda de permissão e de módulo (UI premium)

**Files:**
- Modify:
  - `src/lib/menus.ts` (`podeAbrirMenu`);
  - `src/lib/sku-dossie.ts` (`situacaoCampanhas` preserva `promocaoId`);
  - `src/components/sku-dossie/campanhas-dossie.tsx`;
  - `src/pages/SkuDossie.tsx`.
- Create: `src/hooks/useAcessoMenus.ts`, `src/components/sku-dossie/atalhos-dossie.tsx`
- Test: `src/lib/__tests__/menus.test.ts`, `tests/lib/sku-dossie.test.ts`, `src/pages/__tests__/SkuDossie.test.tsx`

**Interfaces:**
- Consumes: `visibleMenus`, `MenuProfile`, `MenuKey` (`menus.ts`); `MODULOS`, `menusDeModulosDesabilitados` (`modulos.ts`); `useProfile`, `useSupportStore`, `useModulosHabilitados`.
- Produces:

```ts
// src/lib/menus.ts
export function podeAbrirMenu(key: MenuKey, c: { profile: MenuProfile | null | undefined; suporte: boolean; modulos: string[] | undefined }): boolean;
// src/hooks/useAcessoMenus.ts
export function useAcessoMenus(): (key: MenuKey) => boolean;
// src/components/sku-dossie/atalhos-dossie.tsx
export function AtalhosDossie(p: { dados: DossieSku; familia: boolean; estado: EstadoDossie; voltar: string; pode: (k: MenuKey) => boolean }): JSX.Element | null;
// situacaoCampanhas(...)[n].promocaoId: string | null   (null quando a campanha saiu de ml_promocoes)
// CampanhasDossie ganha a prop podeVerCampanha?: boolean
```

- [ ] **Step 1: Failing tests.** Em `src/lib/__tests__/menus.test.ts`, acrescentar:

```ts
import { podeAbrirMenu } from '@/lib/menus';

describe('podeAbrirMenu (atalhos do dossiê)', () => {
  const membro = (allowed: string[]) => ({ is_admin: false, is_active: true, allowed_menus: allowed });
  const admin = { is_admin: true, is_active: true, allowed_menus: [] };

  it('membro sem o menu de destino: some', () => {
    expect(podeAbrirMenu('publicados', { profile: membro(['faturamento']), suporte: false, modulos: [] })).toBe(false);
    expect(podeAbrirMenu('publicados', { profile: membro(['faturamento', 'publicados']), suporte: false, modulos: [] })).toBe(true);
  });

  it('módulo não contratado: some até para admin', () => {
    expect(podeAbrirMenu('promocoes', { profile: admin, suporte: false, modulos: ['estoque'] })).toBe(false);
    expect(podeAbrirMenu('promocoes', { profile: admin, suporte: false, modulos: ['promocoes'] })).toBe(true);
  });

  it('org com o módulo, mas membro sem o menu: some', () => {
    expect(podeAbrirMenu('promocoes', { profile: membro(['faturamento']), suporte: false, modulos: ['promocoes'] })).toBe(false);
  });

  it('módulos carregando ou com erro (undefined): fail-closed para menu de módulo; menu comum segue o perfil', () => {
    expect(podeAbrirMenu('promocoes', { profile: admin, suporte: false, modulos: undefined })).toBe(false);
    expect(podeAbrirMenu('publicados', { profile: admin, suporte: false, modulos: undefined })).toBe(true);
  });

  it('sem perfil carregado: nada abre', () => {
    expect(podeAbrirMenu('faturamento', { profile: null, suporte: false, modulos: [] })).toBe(false);
  });
});
```

  O arquivo já importa `describe`/`expect`/`it` e `../menus`: acrescentar `podeAbrirMenu` a esse import, em vez da linha de import acima.

  Em `tests/lib/sku-dossie.test.ts`, acrescentar:

```ts
describe('situacaoCampanhas: identidade da campanha', () => {
  it('preserva promocaoId; campanha fora de ml_promocoes fica sem link (null)', () => {
    const promo = { promocao_id: 'P-1', nome: 'Setembro', tipo: 'DEAL', status: 'started', inicio: null, fim: null, sincronizado_em: '2026-09-27T10:00:00Z' };
    const [a, b] = situacaoCampanhas([
      { promocao_id: 'P-1', ml_item_id: 'MLB1', status: 'started', preco_promo: 9.9, sincronizado_em: '2026-09-27T10:00:00Z', promocao: promo },
      { promocao_id: 'P-2', ml_item_id: 'MLB1', status: 'candidate', preco_promo: null, sincronizado_em: '2026-09-27T10:00:00Z', promocao: null },
    ]);
    expect(a.promocaoId).toBe('P-1');
    expect(b.promocaoId).toBeNull();
  });
});
```

  Em `src/pages/__tests__/SkuDossie.test.tsx`:
  - Aos imports do topo, acrescentar `afterEach` ao import do vitest, `import { useAcessoMenus } from '@/hooks/useAcessoMenus';` e `import type { MenuKey } from '@/lib/menus';`.
  - Logo depois do `vi.mock('@/hooks/useSkuDossie', …)`, acrescentar:

```tsx
vi.mock('@/hooks/useAcessoMenus', () => ({ useAcessoMenus: vi.fn(() => () => true) }));
```

  - A fixture de campanha que já existe no arquivo (teste por volta da linha 572, `dossie({ campanhas: [{ … }] })`) ganha `promocaoId: null`: o tipo agora exige o campo.

  - E os testes:

```tsx
describe('SkuDossie: atalhos só de navegação', () => {
  const comCampanha = () => dossie({ campanhas: [{
    mlb: 'MLB1', promocaoId: 'PROMO1', nome: 'Setembro', tipo: 'DEAL', statusItem: 'started', statusCampanha: 'started',
    precoPromo: 9.9, vigencia: { inicio: null, fim: null }, sincronizadoEm: '2026-09-27T10:00:00Z',
  }] });
  const acesso = (nega: MenuKey[]) => vi.mocked(useAcessoMenus).mockReturnValue((k: MenuKey) => !nega.includes(k));
  afterEach(() => { acesso([]); }); // o mockReturnValue persiste: não vazar a negação para os testes seguintes

  it('com permissão: Analisar família, Ver em Publicados (busca) e Ver campanha — todos links, nenhum botão de ação', () => {
    acesso([]);
    renderPagina('ok', comCampanha());
    expect(screen.getByRole('link', { name: 'Analisar família' })).toHaveAttribute('href', '/faturamento/sku/familia/P1');
    expect(screen.getByRole('link', { name: 'Ver em Publicados' })).toHaveAttribute('href', '/publicados?q=00123');
    expect(screen.getByRole('link', { name: /Ver campanha/ })).toHaveAttribute('href', '/promocoes/PROMO1');
    expect(within(screen.getByRole('navigation', { name: 'Atalhos' })).queryByRole('button')).not.toBeInTheDocument();
  });

  it('sem o menu Promoções (ou sem o módulo): a campanha continua listada, sem o link', () => {
    acesso(['promocoes']);
    renderPagina('ok', comCampanha());
    expect(screen.getByText('Setembro')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Ver campanha/ })).not.toBeInTheDocument();
  });

  it('sem o menu Publicados: o atalho some', () => {
    acesso(['publicados']);
    renderPagina('ok', dossie());
    expect(screen.queryByRole('link', { name: 'Ver em Publicados' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Analisar família' })).toBeInTheDocument();
  });

  it('sem cadastro atual: nenhum atalho de família ou Publicados', () => {
    acesso([]);
    renderPagina('sem_cadastro', dossie({ catalogo: [] }));
    expect(screen.queryByRole('navigation', { name: 'Atalhos' })).not.toBeInTheDocument();
  });

  it('família: Ver em Publicados busca pelo código pai; sem "Analisar família"', () => {
    acesso([]);
    renderPagina('ok', dossie({ codigos: ['00123', '00124'] }), '/faturamento/sku/familia/P1');
    expect(screen.getByRole('link', { name: 'Ver em Publicados' })).toHaveAttribute('href', '/publicados?q=P1');
    expect(screen.queryByRole('link', { name: 'Analisar família' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/menus.test.ts tests/lib/sku-dossie.test.ts src/pages/__tests__/SkuDossie.test.tsx`
Expected: FAIL. `podeAbrirMenu`, `promocaoId`, o módulo `useAcessoMenus` e os links ainda não existem.

- [ ] **Step 3: Implement.** Em `src/lib/menus.ts`, acrescentar no topo `import { MODULOS, menusDeModulosDesabilitados } from './modulos';`. `modulos.ts` só importa **tipo** de `menus.ts`, então não há ciclo em runtime. No fim do arquivo:

```ts
/** Atalho de navegação (Vendas SKU, Fatia 3): aparece só quando o perfil abre o menu de destino E o
 *  módulo dono dele está habilitado, a mesma regra do MenuGuard. Diferente do guard, é fail-closed
 *  com módulos desconhecidos (carregando ou erro): um atalho que leva a "Módulos indisponíveis" não ajuda. */
export function podeAbrirMenu(
  key: MenuKey,
  c: { profile: MenuProfile | null | undefined; suporte: boolean; modulos: string[] | undefined },
): boolean {
  if (!c.profile && !c.suporte) return false;
  if (!visibleMenus(c.profile ?? { is_admin: false, is_active: true, allowed_menus: [] }, c.suporte).includes(key)) return false;
  if (!MODULOS.some((m) => m.menu === key)) return true;
  return c.modulos !== undefined && !menusDeModulosDesabilitados(c.modulos).includes(key);
}
```

  `src/hooks/useAcessoMenus.ts`:

```ts
import { useCallback } from 'react';
import { useProfile } from '@/hooks/useProfile';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { useSupportStore } from '@/stores/support-store';
import { podeAbrirMenu, type MenuKey } from '@/lib/menus';

/** `(menu) => pode abrir?` com perfil + sessão de suporte + módulos da org (atalhos do dossiê). */
export function useAcessoMenus(): (key: MenuKey) => boolean {
  const { profile } = useProfile();
  const suporte = useSupportStore((s) => s.context) != null;
  const { data: modulos } = useModulosHabilitados();
  return useCallback((key: MenuKey) => podeAbrirMenu(key, { profile, suporte, modulos }), [profile, suporte, modulos]);
}
```

  Em `src/lib/sku-dossie.ts`, dentro de `situacaoCampanhas`, acrescentar ao objeto, logo depois de `mlb: i.ml_item_id,`:

```ts
    // Identidade da campanha para o link "Ver campanha" (Fatia 3); null quando ela saiu de ml_promocoes.
    promocaoId: i.promocao ? i.promocao_id : null,
```

  `src/components/sku-dossie/atalhos-dossie.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { Layers, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MenuKey } from '@/lib/menus';
import type { DossieSku, EstadoDossie } from '@/lib/sku-dossie';

interface Atalho { chave: string; to: string; state?: unknown; icone: typeof Layers; rotulo: string; dica?: string }

/** Atalhos do dossiê: SÓ navegação. Nenhuma ação escreve no Mercado Livre (publicar, pausar, preço,
 *  estoque, promoção). Cada um exige o menu de destino no perfil e o módulo contratado (`pode`). */
export function AtalhosDossie({ dados, familia, estado, voltar, pode }: {
  dados: DossieSku; familia: boolean; estado: EstadoDossie; voltar: string; pode: (k: MenuKey) => boolean;
}) {
  // Sem cadastro atual não há família nem anúncio para achar: nada de atalho fictício.
  if (estado === 'sem_cadastro') return null;
  const cat = dados.catalogo[0];
  const busca = familia ? cat?.codigoPai : dados.codigos[0];
  const itens: Atalho[] = [];
  if (!familia && cat?.codigoPai && pode('faturamento')) {
    itens.push({ chave: 'familia', to: `/faturamento/sku/familia/${encodeURIComponent(cat.codigoPai)}`, state: { de: voltar },
      icone: Layers, rotulo: 'Analisar família' });
  }
  if (busca && pode('publicados')) {
    // Publicados filtra por busca (casa código e código pai): é uma busca, não a seleção de um anúncio.
    itens.push({ chave: 'publicados', to: `/publicados?${new URLSearchParams({ q: busca })}`, icone: Search,
      rotulo: 'Ver em Publicados', dica: `Busca "${busca}" em Publicados` });
  }
  if (!itens.length) return null;
  return (
    <nav aria-label="Atalhos" className="flex flex-wrap gap-2">
      {itens.map(({ chave, to, state, icone: Icone, rotulo, dica }) => (
        <Button key={chave} asChild variant="outline" size="sm">
          <Link to={to} state={state} title={dica}><Icone data-icon="inline-start" />{rotulo}</Link>
        </Button>
      ))}
    </nav>
  );
}
```

  Em `src/components/sku-dossie/campanhas-dossie.tsx`:
  - Imports: `import { Link } from 'react-router-dom';` e `ArrowUpRight` junto de `Megaphone` no import do lucide.
  - Assinatura: `export function CampanhasDossie({ campanhas, className, podeVerCampanha = false }: { campanhas: DossieSku['campanhas']; className?: string; podeVerCampanha?: boolean })`.
  - Logo depois do `<p className="text-xs tabular-nums text-muted-foreground">{`${c.mlb} · ${vigencia(c.vigencia)}`}</p>`, inserir:

```tsx
                  {podeVerCampanha && c.promocaoId && (
                    <Link to={`/promocoes/${encodeURIComponent(c.promocaoId)}`} aria-label={`Ver campanha ${c.nome ?? c.promocaoId}`}
                      className="inline-flex w-fit items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Ver campanha<ArrowUpRight className="h-3 w-3" aria-hidden />
                    </Link>
                  )}
```

  Em `src/pages/SkuDossie.tsx`:
  - Imports:

```ts
import { AtalhosDossie } from '@/components/sku-dossie/atalhos-dossie';
import { useAcessoMenus } from '@/hooks/useAcessoMenus';
```

  - Logo depois de `useSkuDossie(...)`: `const pode = useAcessoMenus();`.
  - Logo depois do `<CabecalhoDossie … />`: `<AtalhosDossie dados={dados} familia={familia} estado={estado} voltar={voltar} pode={pode} />`.
  - Trocar `<CampanhasDossie campanhas={dados.campanhas} className="order-4" />` por `<CampanhasDossie campanhas={dados.campanhas} podeVerCampanha={pode('promocoes')} className="order-4" />`.

- [ ] **Step 4: Run and verify.**
  - Run: `pnpm vitest run src/lib/__tests__/menus.test.ts tests/lib/sku-dossie.test.ts src/pages/__tests__/SkuDossie.test.tsx`. Expected: PASS.
  - Run: `bash /Users/diego/.claude/skills/frontend-design-fable5/scripts/preflight.sh --allow-lucide src/components/sku-dossie/atalhos-dossie.tsx src/components/sku-dossie/campanhas-dossie.tsx src/pages/SkuDossie.tsx`. Expected: exit 0.
  - Depois: `pnpm preflight:static`, então `pnpm test`.
  - **Controlador:** auditoria Tier 2 dos atalhos e do link de campanha, cobrindo:
    - hierarquia visual contra a trilha (que já tem o link da família);
    - foco por teclado;
    - 390 px;
    - escuro/claro.

    Só aprova com ≥ 8/10.

- [ ] **Step 5: Commit.** Gravar `/Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t8.txt`:

```
feat(vendas-sku): atalhos do dossiê só de navegação, com permissão e módulo

Analisar família, Ver em Publicados (busca) e Ver campanha (promocao_id preservado).
Cada atalho exige o menu de destino e o módulo contratado; fail-closed com módulos
desconhecidos. Nenhuma escrita no ML.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

  `/usr/bin/git add src/lib/menus.ts src/lib/__tests__/menus.test.ts src/hooks/useAcessoMenus.ts src/lib/sku-dossie.ts tests/lib/sku-dossie.test.ts src/components/sku-dossie/atalhos-dossie.tsx src/components/sku-dossie/campanhas-dossie.tsx src/pages/SkuDossie.tsx src/pages/__tests__/SkuDossie.test.tsx`

  `/usr/bin/git commit -F /Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t8.txt`

---

### Task 9: Validação (testes, teto, runtime com dados injetados, dado real read-only) e docs

- [ ] **Step 1: Suítes.**
  - `pnpm test` e `pnpm preflight`: verdes.
  - Rodar de novo o teste SQL da Task 1 (`docker exec … psql … < supabase/tests/vendas_sku_dossie.sql`): termina em `ROLLBACK`.

- [ ] **Step 2: Medir o teto do XLSX.** Criar o arquivo **temporário, não commitado** `tests/lib/export/medir-teto.test.ts`:

```ts
import { it } from 'vitest';
import * as XLSX from 'xlsx';
import { montarWorkbook } from '@/lib/export/excel';
import { buildRankingSkuReport } from '@/lib/export/vendas-sku-xlsx';
import { metricas, somarAcumuladores, type LinhaSku } from '@/lib/vendas-sku';

const sintetica = (i: number): LinhaSku => {
  const acc = somarAcumuladores([]);
  acc.bruto = 100 + i; acc.unidades = 3; acc.liquido = 80; acc.itensComCusto = 1; acc.unidadesComCusto = 3;
  acc.custo = 50; acc.liquidoComCusto = 80; acc.brutoComCusto = 100 + i; acc.brutoCustoReal = 100 + i;
  return { codigo: String(i).padStart(8, '0'), titulo: `Produto sintético ${i} com um título de tamanho realista`, imagemPath: null,
    codigoPai: `P${Math.floor(i / 5)}`, nomeFamilia: `Família ${Math.floor(i / 5)}`, fornecedor: 'Fornecedor', origem: 'nacional',
    ehKit: false, estoque: 10, primeiraVenda: null, acc, m: metricas(acc), pedidoChaves: ['1'] };
};

it.each([5_000, 10_000, 20_000])('%i linhas', (n) => {
  const linhas = Array.from({ length: n }, (_, i) => sintetica(i));
  const t0 = performance.now();
  const r = buildRankingSkuReport({ linhas, familias: null, kpis: { bruto: 0, lucro: null, markup: null, margemSVenda: null, unidades: 0, skusComVenda: 0, skusVendaUnica: 0, concentracaoTop5: null, pctBrutoCustoReal: null, prejuizo: 0 },
    janela: { desde: '2026-09-01T03:00:00.000Z', ate: '2026-10-01T02:59:59.999Z' }, anterior: { desde: '2026-08-02T03:00:00.000Z', ate: '2026-09-01T02:59:59.999Z' },
    filtros: [], ordem: 'Lucro', baseAbc: 'lucro', abc: new Map(), tendencias: new Map(), alertas: new Map(), agora: new Date() });
  const buf = XLSX.write(montarWorkbook(r), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  console.log(`[teto] ${n} linhas: ${Math.round(performance.now() - t0)} ms, ${(buf.byteLength / 1024).toFixed(0)} KB`);
}, 60_000);
```

  - Rodar com `pnpm vitest run tests/lib/export/medir-teto.test.ts`.
  - Critério: o teto é a maior contagem medida com montagem + escrita < 3 s.
    - Se 10.000 passar, `TETO_LINHAS_XLSX` fica.
    - Se não passar, baixar a constante para a maior medida que passou e commitar só essa linha na Step 5.
  - Registrar ms e KB no relatório e apagar o arquivo.

- [ ] **Step 3: Dado real, só leitura** (Management API SQL, sem escrita; ver memória "Referência ops"). `<ORG_AVIL>` é o `org_id` da Avil, lido de `organizations` na mesma sessão read-only.
  1. **Cobertura do `comprador_id`** (a pergunta do Astra sobre estabilidade e completude do ID):

```sql
select to_char(date_trunc('month', date_closed at time zone 'America/Sao_Paulo'), 'YYYY-MM') as mes,
       count(*) as vendas,
       count(*) filter (where comprador_id is null) as sem_id,
       round(100.0 * count(*) filter (where comprador_id is null) / nullif(count(*), 0), 2) as pct_sem_id
  from public.ml_vendas
 where org_id = '<ORG_AVIL>'
 group by 1 order by 1;
```

  2. **Paridade da recompra.**
     - Escolher o código de maior volume dos últimos 90 dias: `select i.codigo, sum(i.quantity) from public.ml_vendas_itens i join public.ml_vendas v on v.id = i.venda_id where v.org_id = '<ORG_AVIL>' and v.date_closed >= now() - interval '90 days' group by 1 order by 2 desc limit 1`.
     - Aplicar a mesma regra da lib, com `<CODIGO>` e a janela de 90 dias:

```sql
with elegiveis as (
  select distinct v.org_id, v.comprador_id, coalesce(v.pack_id, v.order_id) as ocasiao, v.date_closed
    from public.ml_vendas v
    join public.ml_vendas_itens i on i.venda_id = v.id and i.codigo = '<CODIGO>'
   where v.org_id = '<ORG_AVIL>'
     and v.status in ('paid', 'partially_refunded')
     and v.kit_item_id is null
     and not exists (select 1 from public.ml_devolucoes d where d.order_id = v.order_id and d.type = 'returns')
), ocasioes as (
  select org_id, comprador_id, ocasiao, min(date_closed) as em from elegiveis group by 1, 2, 3
), por_conta as (
  select org_id, comprador_id, min(em) as primeira,
         bool_or(em >= now() - interval '90 days') as comprou_no_periodo
    from ocasioes where comprador_id is not null group by 1, 2
)
select count(*) filter (where p.comprou_no_periodo) as identificados,
       count(*) filter (where p.comprou_no_periodo and exists (
         select 1 from ocasioes o where o.org_id = p.org_id and o.comprador_id = p.comprador_id
            and o.em >= now() - interval '90 days' and o.em > p.primeira)) as recorrentes,
       (select count(distinct ocasiao) from ocasioes where comprador_id is null and em >= now() - interval '90 days') as sem_id
  from por_conta p;
```

  3. Exportar as vendas desse código para `/Users/diego/.claude/jobs/1e464c62/tmp/recompra-real.json`:
     - as colunas de `SELECT_VENDAS` + itens, com `org_id`, só as vendas que contêm o código;
     - junto, os `order_id` com claim `returns` (`devolvidas`), o código, `desde`/`ate` = a mesma janela de 90 dias em ISO, e o resultado do SQL em `esperado`.

     Depois rodar o teste vitest **temporário** `tests/lib/recompra-real.test.ts`:

```ts
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { calcularRecompra } from '@/lib/sku-recompra';
import type { Venda } from '@/lib/faturamento';

it('recompra real = SQL', () => {
  const { vendas, devolvidas, codigo, desde, ate, esperado } = JSON.parse(readFileSync('/Users/diego/.claude/jobs/1e464c62/tmp/recompra-real.json', 'utf8')) as {
    vendas: Venda[]; devolvidas: number[]; codigo: string; desde: string; ate: string;
    esperado: { identificados: number; recorrentes: number; sem_id: number };
  };
  const r = calcularRecompra({ vendas, codigos: [codigo], janela: { desde, ate }, devolvidas: new Set(devolvidas), escopo: 'sku', observadoDesde: null });
  expect([r.compradoresIdentificados, r.recorrentes, r.comprasSemIdentificacao]).toEqual([esperado.identificados, esperado.recorrentes, esperado.sem_id]);
});
```

  4. Apagar o JSON e o teste temporário: dado pessoal real nunca vai para o repo nem fica no disco. No relatório, só os agregados.

- [ ] **Step 4: Runtime com dados injetados.** Skill `playwright-cli`; memórias "validação visual a partir de worktree" e "validar UI com dados injetados".
  - **Preparação.**
    - Copiar `.env.local` para o worktree, `pnpm dev`, `playwright-cli -s=ui3`, login na conta VALIDATION.
    - Injetar respostas por `route` com arquivo (`run-code`), nunca JSON inline, para:
      - `rpc/vendas_sku_dossie_ids`, `ml_vendas` (vendas sintéticas com `org_id` e `comprador_id` fictícios);
      - `rpc/vendas_sku_catalogo`, `ml_devolucoes`, `ml_promocao_itens`, `ml_promocoes`;
      - `rpc/modulos_habilitados_da_org`.
  - **Screenshots** 1440 e 390, escuro e claro, de:
    - (a) aba Vendas SKU com "Exportar Excel", solta e agrupada;
    - (b) dossiê com recompra ≥ 20 compradores;
    - (c) amostra insuficiente;
    - (d) sem compra elegível;
    - (e) família com Kit Virtual;
    - (f) atalhos + "Ver campanha";
    - (g) org sem módulo Promoções (injetar `[]` em `modulos_habilitados_da_org`): campanha listada, sem link;
    - (h) botão desabilitado acima do teto (injetar mais linhas que o teto, ou baixar o teto só no dev).
  - **Download real.** Baixar o XLSX da aba e o do dossiê pelo navegador e abrir com `XLSX.read` num script `node --experimental-strip-types` em tmp. Conferir:
    - código `t: 's'` com zero à esquerda;
    - lucro indisponível ausente;
    - total ≠ KPIs gerais com filtro;
    - nenhum nick ou ID fictício no arquivo;
    - contagem de linhas = contagem da tela.
  - Console limpo. Clicar cada atalho e confirmar que só navega.
  - **Controlador:** Tier 2 final da Fatia 3 inteira sobre os prints. Só aprova com ≥ 8/10.

- [ ] **Step 5: Docs pela skill `docs-update-checklist`.**
  - `docs/reference/glossario.md`, seção "Vendas SKU", ganha:
    - **Compradores recorrentes do SKU (recompra):** métrica, conta compradora, ocasião, elegibilidade, outra cor/família, Kit Virtual, amostra de 20, "observado desde", diferença para `pctRecompra`.
    - **Exportação XLSX da Vendas SKU:** mesmos objetos da tela; total das linhas × KPIs gerais; vazio ≠ 0; código texto; teto.
    - **Atalhos do dossiê:** só navegação; permissão + módulo.
  - `docs/decisions/0172-vendas-sku-analise-por-variacao.md` ganha a seção `## Nota — Fatia 3: recompra, exportação e atalhos (2026-09-27)`, com:
    - as decisões de contrato;
    - "sem RPC/migration; `SELECT_VENDAS` + `org_id`; `buscarDevolucoes` paginada";
    - o teto medido;
    - a cobertura real do `comprador_id`;
    - a paridade real da recompra;
    - status segue "Proposto".
  - `docs/project-status.md`: linha da Fatia 3 validada (sem merge nem deploy).
  - Commit: gravar `/Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t9.txt` com `docs(vendas-sku): Fatia 3 validada` + linha em branco + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

    `/usr/bin/git add docs/reference/glossario.md docs/decisions/0172-vendas-sku-analise-por-variacao.md docs/project-status.md`

    Acrescentar a esse `git add` `src/lib/export/vendas-sku-xlsx.ts`, só se o teto mudou.

    `/usr/bin/git commit -F /Users/diego/.claude/jobs/1e464c62/tmp/commit-f3-t9.txt`
