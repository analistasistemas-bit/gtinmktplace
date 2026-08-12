# Plano — Financeiro: resolver os 2 críticos e os 6 altos

**Origem:** `.code-review-fable5/code-review-v11.md` (BLOQUEAR, 42/100) + design `2026-08-12-financeiro-controle-de-liberacao-design.md`
**Branch:** `worktree-review-financeiro` · **Modo:** superpowers-sentinel, Mode A (Ponytail ativo)
**Decisões do Diego:** enxugar o menu · esconder cancelados com filtro · apagar compras + travar ingestão · desfazer os 46 saques · **saque restrito a admin (2026-08-12)**

## Restrições globais (valem para toda task)

- `pnpm lint` e `pnpm test` verdes ao fim de cada task. Baseline: **3.009 testes**.
- Migrations só por `supabase migration new` + `supabase db push --linked` + `npm run db:check`. Nunca painel, nunca `apply_migration` (ADR-0043).
- Edge functions idempotentes. `sync-venda` continua `verify_jwt` conforme `config.toml` — não passar flag manual.
- Venda faturável = `status in ('paid','partially_refunded','refunded')` (ADR-0038). Markup desconta imposto (ADR-0055).
- Nunca gravar segredo em código. Não alterar `package.json`/lock.
- **Ordem de deploy da Fase 1: `supabase functions deploy sync-venda` ANTES da migration.** O código novo é só um filtro, não depende de coluna; apagar as linhas com o worker antigo no ar permitiria reinserção pelo próximo webhook.

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/functions/_shared/faturamento/venda.ts` | modificar | Tipo `PedidoML` ganha `seller` |
| `supabase/functions/sync-venda/index.ts` | modificar | Rejeita pedido cujo vendedor não é a conta |
| `supabase/functions/sync-venda/__tests__/guarda-seller.test.ts` | criar | Prova a rejeição |
| `supabase/migrations/<ts>_financeiro_saque_e_compras.sql` | criar | Limpeza + travas de status e admin |
| `src/lib/resumo-vendas.ts` | modificar | `estornos` conta cancelado; novo `aSacar` |
| `src/lib/__tests__/resumo-estorno-asacar.test.ts` | criar | Prova os dois |
| `src/pages/Financeiro.tsx` | modificar | 6 KPIs em vez de 11 |
| `src/lib/export/adapters.ts` | modificar | Export do Financeiro acompanha os KPIs |
| `src/pages/DetalheFinanceiro.tsx` | modificar | Filtro faturável, busca, paginação |
| `tests/lib/financeiro-detalhe-filtro.test.ts` | criar | Prova o filtro e os totais sob paginação |

---

## T1 — Ingestão rejeita pedido de compra (C1, parte 1)

**Arquivos:** `_shared/faturamento/venda.ts`, `sync-venda/index.ts`, `sync-venda/__tests__/guarda-seller.test.ts` (novo)

**Passo 1.** Em `venda.ts`, na interface `PedidoML` (linha 110), adicionar o campo abaixo logo após `buyer`:

```ts
  /** Vendedor do pedido. O webhook `orders_v2` notifica pedidos em que a conta é comprador OU
   *  vendedor — este campo é o que distingue os dois casos. */
  seller?: { id?: number | string | null; nickname?: string | null } | null;
```

**Passo 2.** Em `sync-venda/index.ts`, imediatamente após o bloco `try { pedido = await buscarPedido(token, orderId); } catch { ... }` e **antes** de `const { idsPubliai, ... } = await carregarCatalogo(...)`, inserir:

```ts
  // O webhook `orders_v2` também notifica pedidos em que a conta é COMPRADORA. Sem esta guarda
  // cada compra da empresa entra em ml_vendas como venda e infla o faturamento (23 linhas,
  // R$ 8.810,50 em `paid`, medido em 2026-08-12). Mesmo papel do filtro `collector_id` no
  // caminho do Mercado Pago (ADR-0031). 200 e não erro: ignorar é o resultado certo, não falha —
  // devolver 4xx/5xx faria o QStash re-tentar para sempre.
  const sellerDoPedido = pedido.seller?.id != null ? String(pedido.seller.id) : null;
  if (conexao.contaExternaId && sellerDoPedido !== String(conexao.contaExternaId)) {
    return new Response(
      JSON.stringify({ ok: true, ignorado: 'compra-da-conta', order_id: String(pedido.id) }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
```

**Passo 3.** Criar `supabase/functions/sync-venda/__tests__/guarda-seller.test.ts`. A guarda é uma comparação pura — extrair a decisão para uma função testável em `venda.ts` e testá-la, em vez de montar o worker inteiro:

Em `venda.ts`, junto de `calcularLiquido`:

```ts
/** O pedido pertence à conta conectada como VENDEDOR? `false` = é uma compra da empresa e não
 *  pode virar linha de venda. Sem `contaExternaId` conhecido, não há como decidir: aceita
 *  (comportamento anterior) em vez de descartar venda legítima. */
export function ehVendaDaConta(
  pedido: Pick<PedidoML, 'seller'>, contaExternaId: string | null | undefined,
): boolean {
  if (!contaExternaId) return true;
  const seller = pedido.seller?.id != null ? String(pedido.seller.id) : null;
  return seller === String(contaExternaId);
}
```

e o Passo 2 passa a usar `if (!ehVendaDaConta(pedido, conexao.contaExternaId)) { ... }`.

Teste:

```ts
import { describe, it, expect } from 'vitest';
import { ehVendaDaConta } from '../../_shared/faturamento/venda.ts';

describe('ehVendaDaConta', () => {
  it('aceita pedido em que a conta é o vendedor', () => {
    expect(ehVendaDaConta({ seller: { id: 1003820507 } }, '1003820507')).toBe(true);
  });

  it('recusa COMPRA da empresa (conta é o comprador, outro é o vendedor)', () => {
    // Caso real: pedido 2000017632520548, memória RAM comprada pela AVILBV em 28/07/2026.
    expect(ehVendaDaConta({ seller: { id: 987654321 } }, '1003820507')).toBe(false);
  });

  it('recusa pedido sem seller quando a conta é conhecida', () => {
    expect(ehVendaDaConta({ seller: null }, '1003820507')).toBe(false);
  });

  it('aceita quando a conta externa é desconhecida (não descarta venda legítima)', () => {
    expect(ehVendaDaConta({ seller: { id: 42 } }, null)).toBe(true);
  });
});
```

**Comando:** `pnpm test -- guarda-seller` → 4 testes passando.
**Estado final:** commitável. `pnpm lint && pnpm test` verdes.

---

## T2 — Migration: limpeza e travas (C1 parte 2, C2, A6)

**Arquivos:** migration nova via `supabase migration new financeiro_saque_e_compras`

Conteúdo (as quatro operações são idempotentes; `is_admin()` existe e segue em uso pós-E7 — `20260705165828_e7_rls_org.sql`):

```sql
-- ============================================================================
-- Financeiro — compras da própria conta e saque de pedido sem dinheiro.
-- Revisão code-review-v11 (2026-08-12): o webhook orders_v2 notifica pedidos em que a conta é
-- COMPRADORA, e sync-venda gravava todos como venda (23 linhas, R$ 37.118,27). E a RPC de saque
-- nunca olhava o status, deixando marcar como sacado pedido devolvido (46 linhas, R$ 2.849,54).
-- A guarda na ingestão (deploy de sync-venda) precede esta migration.
-- ============================================================================

-- 1) Devoluções abertas sobre COMPRAS: não são devolução de venda. Sem FK para ml_vendas, então
--    não caem por cascade — apagar antes das vendas, enquanto o vínculo ainda existe.
delete from public.ml_devolucoes d
 where d.order_id in (
   select v.order_id from public.ml_vendas v
     join public.ml_credentials c on c.ml_user_id::bigint = v.comprador_id
 );

-- 2) As compras. ml_vendas_itens e venda_item_custo saem por cascade (FKs venda_id ON DELETE CASCADE).
delete from public.ml_vendas v
 using public.ml_credentials c
 where c.ml_user_id::bigint = v.comprador_id;

-- 3) Saques marcados em pedido que não é venda faturável: o dinheiro voltou ao comprador.
update public.ml_vendas
   set sacado_em = null, sacado_por = null
 where sacado_em is not null
   and status not in ('paid', 'partially_refunded', 'refunded');

-- 4) Travas: saque só em venda faturável e só por admin (mesmo predicado do ADR-0060).
create or replace function public.registrar_saque_ml_vendas(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_count integer;
begin
  v_org := public.current_org_id();
  if v_org is null or not public.is_admin() then
    raise exception 'not allowed';
  end if;

  update public.ml_vendas
     set sacado_em = now(),
         sacado_por = auth.uid()
   where id = any(p_ids)
     and org_id = v_org
     -- Só venda faturável tem dinheiro a sacar (ADR-0038).
     and status in ('paid', 'partially_refunded', 'refunded')
     and money_release_date is not null
     and money_release_date <= now()
     and sacado_em is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.desfazer_saque_ml_vendas(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_count integer;
begin
  v_org := public.current_org_id();
  if v_org is null or not public.is_admin() then
    raise exception 'not allowed';
  end if;

  update public.ml_vendas
     set sacado_em = null,
         sacado_por = null
   where id = any(p_ids)
     and org_id = v_org
     and sacado_em is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.registrar_saque_ml_vendas(uuid[]) from public;
revoke all on function public.desfazer_saque_ml_vendas(uuid[]) from public;
grant execute on function public.registrar_saque_ml_vendas(uuid[]) to authenticated;
grant execute on function public.desfazer_saque_ml_vendas(uuid[]) to authenticated;
```

**Verificação pós-push** (contagens esperadas, medidas em 2026-08-12):

```sql
select count(*) from ml_vendas v join ml_credentials c on c.ml_user_id::bigint = v.comprador_id;      -- 0
select count(*) from ml_vendas where sacado_em is not null
  and status not in ('paid','partially_refunded','refunded');                                          -- 0
```

**Comandos:** `supabase link --project-ref txvncrgkoynoxwopfkbp --yes` → `supabase db push --linked --dry-run --yes` → `supabase db push --linked --yes` → `npm run db:check`.

---

## T3 — Agregador: estornos reais e "a sacar" (A1, A2)

**Arquivos:** `src/lib/resumo-vendas.ts`, `src/lib/__tests__/resumo-estorno-asacar.test.ts` (novo)

**Passo 1.** Em `ResumoVendas`, após o campo `aLiberar`, adicionar:

```ts
  /** Σ líquido já liberado que ainda NÃO foi marcado como sacado — o saldo que dá para tirar hoje. */
  aSacar: number;
```

**Passo 2.** Declarar o acumulador junto de `liberado`/`aLiberar` (`let liberado = 0, aLiberar = 0, ...`): acrescentar `aSacar = 0`.

**Passo 3.** No laço de `vendas`, mover a soma de estorno para **antes** do `continue` de faturável:

```ts
  for (const v of vendas) {
    // Estorno é dinheiro que voltou ao comprador e conta SEMPRE — inclusive em pedido `cancelled`,
    // que é como o ML fecha uma devolução concluída. Sem isto o card mostrava R$ 12,55 de
    // R$ 3.394,20 reais (30 dias, medido em 2026-08-12). Os demais KPIs seguem só faturáveis.
    estornos += v.estorno ?? 0;
    if (!ehFaturavel(v.status)) continue;
    const liq = liqRateado.get(v.id)?.liquido ?? v.liquido ?? 0;
    const est = v.estorno ?? 0;
    bruto += v.total_amount;
    liquido += liq;
```

(`est` continua declarado porque `vendasResumo.push` usa `estorno: round2(est)`; remover apenas a linha `estornos += est;` que existia abaixo.)

**Passo 4.** No bloco de liberação, acrescentar o `aSacar`:

```ts
      if (ms <= agoraMs) {
        liberado += liq;
        // Liberado e ainda não sacado: a pergunta que o menu Financeiro existe para responder.
        if (v.sacado_em == null) aSacar += liq;
      } else {
```

**Passo 5.** Incluir `aSacar: round2(aSacar)` no objeto de retorno, junto de `liberado`/`aLiberar`.

**Passo 6.** Teste `src/lib/__tests__/resumo-estorno-asacar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calcularResumo } from '@/lib/resumo-vendas';
import type { Venda, VendaItem } from '@/lib/faturamento';

function item(over: Partial<VendaItem> = {}): VendaItem {
  return {
    id: 'it1', ml_item_id: 'MLB1', variation_id: null, titulo: 'FITA', codigo: '001', cor: null,
    ean: '789', quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true, ...over,
  };
}
function venda(over: Partial<Venda> = {}): Venda {
  return {
    id: 'v1', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
    date_closed: '2026-08-01T00:00:00Z', date_created: null, comprador_nick: 'c', comprador_id: 1,
    total_amount: 100, paid_amount: 100, sale_fee_total: 10, frete_vendedor: null, liquido: 90,
    estorno: null, money_release_date: null, currency: 'BRL', shipping_id: null,
    shipping_status: null, shipping_substatus: null, shipping_logistic: null, tracking_number: null,
    is_publiai: true, tem_devolucao: false, itens: [item()], ...over,
  };
}

const PASSADO = '2026-08-01T00:00:00Z';
const FUTURO = '2099-01-01T00:00:00Z';

describe('estornos', () => {
  it('soma estorno de pedido cancelado — devolução concluída vira cancelled no ML', () => {
    const r = calcularResumo([
      venda({ id: 'a', order_id: 1, estorno: 12.55 }),
      venda({ id: 'b', order_id: 2, status: 'cancelled', total_amount: 384.8, estorno: 384.8, tem_devolucao: true }),
    ]);
    expect(r.estornos).toBe(397.35);
    expect(r.bruto).toBe(100); // a cancelada segue fora do faturamento (ADR-0038)
  });
});

describe('aSacar', () => {
  it('conta só o liberado que ainda não foi sacado', () => {
    const r = calcularResumo([
      venda({ id: 'a', order_id: 1, liquido: 90, money_release_date: PASSADO, sacado_em: '2026-08-05T00:00:00Z' }),
      venda({ id: 'b', order_id: 2, liquido: 50, money_release_date: PASSADO, sacado_em: null }),
      venda({ id: 'c', order_id: 3, liquido: 30, money_release_date: FUTURO, sacado_em: null }),
    ]);
    expect(r.liberado).toBe(140); // histórico: liberado independe de saque
    expect(r.aSacar).toBe(50);    // só o que dá para tirar hoje
    expect(r.aLiberar).toBe(30);
  });

  it('pedido cancelado não entra em aSacar mesmo com data de liberação no passado', () => {
    const r = calcularResumo([
      venda({ id: 'a', order_id: 1, status: 'cancelled', liquido: 90, money_release_date: PASSADO, estorno: 100 }),
    ]);
    expect(r.aSacar).toBe(0);
  });
});
```

`Venda` já declara `sacado_em`; se o tipo do teste reclamar, conferir o campo em `src/lib/faturamento.ts` antes de alterar qualquer coisa.

**Comando:** `pnpm test -- resumo-estorno-asacar` → 3 testes passando; depois `pnpm test` completo (esperado ≥ 3.012).

---

## T4 — Tela Financeiro: 6 KPIs (escopo enxuto)

**Arquivos:** `src/pages/Financeiro.tsx`, `src/lib/export/adapters.ts`

**Passo 1.** Trocar o card "Já liberado" pelo hero de caixa. O bloco atual (linhas 199-218) passa a:

```tsx
      {/* Caixa: o que o ML já liberou desta base de vendas. NÃO é o "a receber" do MP. */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          size="compact"
          icon={Wallet}
          label="Liberado a sacar"
          value={fmtBRL(r?.aSacar ?? 0)}
          tom="success"
          hint="já no saldo do ML e ainda não marcado como sacado"
        />
        <KpiCard
          size="compact"
          icon={CalendarClock}
          label="A liberar"
          value={fmtBRL(r?.aLiberar ?? 0)}
          tom="warning"
          hint={r?.proximaLiberacao ? formatProximaLiberacao(r.proximaLiberacao) : 'nada pendente de liberação'}
        />
        <KpiCard
          size="compact"
          icon={CheckCircle2}
          label="Já sacado no período"
          value={fmtBRL(Math.max(0, (r?.liberado ?? 0) - (r?.aSacar ?? 0)))}
          hint="marcado como sacado no Detalhe do líquido"
        />
      </div>
```

Importar `CheckCircle2` de `lucide-react` na linha 3.

**Passo 2.** Remover o bloco inteiro de "Quantidade de vendas + markup do período" (linhas 221-255: os três `KpiCard` de Vendas no período, Markup e Lucro líquido) e a constante `markup` (linhas 61-63).

**Passo 3.** No grid de KPIs de venda (linhas 190-195), remover o card "Ticket médio líquido" e a constante `ticketLiquido` (linha 39). Ficam: Faturamento bruto, Taxas e frete (ML), Estornos.

**Passo 4.** Em `adapters.ts`, `FinanceiroArgs` perde `ticketLiquido` e a lista de KPIs do `buildFinanceiroReport` passa a espelhar a tela:

```ts
          { label: 'Líquido das vendas', valor: fmtBRL(r.liquido) },
          { label: 'Faturamento bruto', valor: fmtBRL(r.bruto) },
          { label: 'Taxas e frete (ML)', valor: fmtBRL(r.descontos) },
          { label: 'Estornos', valor: fmtBRL(r.estornos) },
          { label: 'Liberado a sacar', valor: fmtBRL(r.aSacar) },
          { label: 'A liberar', valor: fmtBRL(r.aLiberar) },
```

Ajustar a chamada em `Financeiro.tsx` (`buildFinanceiroReport({ r, serie, periodo, config })`) e os testes de `tests/lib/export/adapters.test.ts` que referenciem `ticketLiquido` ou os KPIs removidos.

**Passo 5.** Encurtar o parágrafo de rodapé (linhas 262-269) para duas frases: o que é o líquido e por que o "a receber" do MP não aparece.

**Comando:** `pnpm lint && pnpm test`.

---

## T5 — Detalhe: lista só de venda faturável, com filtro dedicado (A3)

**Arquivos:** `src/pages/DetalheFinanceiro.tsx`, `tests/lib/financeiro-detalhe-filtro.test.ts` (novo)

**Passo 1.** A regra de filtro sai do componente para um módulo puro (é regra de negócio e precisa de teste). Em `src/lib/pedidos-faturamento.ts`, ao lado de `totaisFinanceiro`:

```ts
export type FiltroFinanceiro = 'todos' | 'liberado' | 'aliberar' | 'sacado' | 'devolvidos';

/** Pedidos visíveis no Detalhe do líquido. Esta tela é de RECEBIMENTO: pedido sem dinheiro a
 *  receber (cancelado/devolvido) fica fora por padrão e só aparece no filtro `devolvidos` — o que
 *  não está na lista não pode ser selecionado nem sacado (ADR-0038). */
export function filtrarPedidosFinanceiro(
  pedidos: Pedido[], filtro: FiltroFinanceiro,
  statusDe: (p: Pedido) => 'aliberar' | 'liberado' | 'sacado' | 'sem_data',
): Pedido[] {
  return pedidos.filter((p) => {
    if (filtro === 'devolvidos') return !p.faturavel;
    if (!p.faturavel) return false;
    if (filtro === 'todos') return true;
    return statusDe(p) === filtro;
  });
}
```

**Passo 2.** Em `DetalheFinanceiro.tsx`, substituir o `useMemo` de `pedidosFiltrados` (linhas 241-252) por:

```tsx
  const pedidosFiltrados = useMemo(() => {
    const now = Date.now();
    return filtrarPedidosFinanceiro(pedidos, filtroLib, (p) => statusLiberacao({
      money_release_date: p.money_release_date,
      sacado_em: p.sacado_em,
      temMembrosSemDataLiberacao: p.temMembrosSemDataLiberacao,
    }, now));
  }, [pedidos, filtroLib]);
```

Trocar o tipo local `FiltroLib` pelo importado `FiltroFinanceiro` e adicionar o botão `Devolvidos` ao grupo de filtros existente.

**Passo 3.** Teste `tests/lib/financeiro-detalhe-filtro.test.ts` cobrindo: `todos` exclui o não faturável; `devolvidos` traz só ele; `liberado` nunca traz não faturável mesmo com data no passado.

**Comando:** `pnpm test -- financeiro-detalhe-filtro`.

---

## T6 — Detalhe: busca e paginação (A5, A4)

**Arquivos:** `src/pages/DetalheFinanceiro.tsx`, `tests/lib/financeiro-detalhe-filtro.test.ts` (estende)

**Passo 1.** Busca — `pedidoCasaBusca` já existe (`pedidos-faturamento.ts:313`) e já é usada em `aba-vendas.tsx:223`. Adicionar estado e campo:

```tsx
  const [busca, setBusca] = useSessionState('busca:detalhe-financeiro', '');
```

```tsx
  <Input
    value={busca}
    onChange={(e) => setBusca(e.target.value)}
    placeholder="Buscar por comprador, nº do pedido, produto, código ou valor"
    className="h-8 max-w-xs text-sm"
    aria-label="Buscar pedido"
  />
```

Aplicar no mesmo `useMemo` do filtro: `.filter((p) => pedidoCasaBusca(p, busca))` após `filtrarPedidosFinanceiro`.

**Passo 2.** Paginação client-side de 50 (os dados já estão em memória; nada muda na query):

```tsx
  const POR_PAGINA = 50;
  const [pagina, setPagina] = useState(1);
  const totalPaginas = Math.max(1, Math.ceil(pedidosOrdenados.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const pedidosPagina = useMemo(
    () => pedidosOrdenados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA),
    [pedidosOrdenados, paginaAtual],
  );
```

`useEffect` que volta para a página 1 quando `busca` ou `filtroLib` mudam. O `.map` do corpo da tabela passa a iterar `pedidosPagina`; controles "Anterior / página X de Y / Próxima" abaixo da tabela.

**Passo 3 — invariantes que a paginação NÃO pode quebrar:**
- `totaisFiltrados` continua sobre `pedidosFiltrados` (o filtro inteiro), nunca sobre a página — senão o rodapé mente.
- `selecionarVisiveis` passa a operar sobre `pedidosPagina` (o rótulo diz "visíveis"; com paginação, visível é a página).
- O export continua recebendo `pedidosOrdenados` inteiro — exportar meia página seria pior que o problema original.

**Passo 4.** Estender o teste de T5 com: totais somam o filtro inteiro, não a página (120 pedidos, página de 50, total = 120).

**Comando:** `pnpm lint && pnpm test`.

---

## Self-review do plano

**(a) Cobertura — cada item do escopo aponta para uma task:**

| Item | Task |
|---|---|
| C1 compras (trava) | T1 |
| C1 compras (histórico) | T2 op. 1-2 |
| C2 saque em cancelado (trava) | T2 op. 4 |
| C2 saque em cancelado (46 linhas) | T2 op. 3 |
| A1 estornos | T3 |
| A2 aSacar | T3 + T4 |
| A3 cancelado na lista | T5 |
| A4 paginação | T6 |
| A5 busca | T6 |
| A6 admin no saque | T2 op. 4 |

Gap encontrado e corrigido: as **25 linhas de `ml_devolucoes`** apontando para as compras não estavam no design — não têm FK para `ml_vendas`, logo não caem por cascade. Viraram a operação 1 da T2, que roda **antes** do delete das vendas.

Gap aceito conscientemente: `upsertDevolucao` (`devolucoes-io.ts:63`) também não valida se a order é uma venda, então um claim de compra pode recriar linha em `ml_devolucoes`. **Não corrigido aqui** — é o menu Faturamento, fora do escopo pedido, e a trava óbvia (exigir venda existente) arriscaria descartar devolução legítima cuja venda ainda não sincronizou. Registrado para a próxima rodada.

**(b) Placeholders:** nenhum. Todo passo tem código real; os dois testes novos estão escritos por extenso; os comandos têm saída esperada.

**(c) Consistência de tipos entre tasks:**
- `ehVendaDaConta(pedido, contaExternaId)` — produzida em T1, consumida em T1.
- `ResumoVendas.aSacar: number` — produzida em T3, consumida em T4 (`Financeiro.tsx`) e `adapters.ts`.
- `FiltroFinanceiro` e `filtrarPedidosFinanceiro` — produzidas em T5, consumidas em T5 e T6.
- `Pedido.faturavel: boolean` — já existe (commit `e96b35d2`), consumida em T5.
- `pedidoCasaBusca(p, query)` — já existe, consumida em T6.

## Ordem de execução

T1 → **deploy `sync-venda`** → T2 (migration) → T3 → T4 → T5 → T6 → revisão final da branch.
