# Alíquota interna por UF da empresa — design

**Data:** 2026-08-11
**ADR:** [ADR-0112](../../decisions/0112-aliquota-interna-por-uf-da-empresa.md)
**Refina:** ADR-0055 (imposto por origem)

## Problema

A AVIL é de Pernambuco e paga 1% de imposto quando vende para cliente do próprio estado.
O sistema só conhece duas alíquotas — 8% (nacional) e 16% (importado), pela origem do produto —
então toda venda intraestadual aparece com imposto muito acima do real, e líquido, lucro e markup
saem errados nas telas de apuração.

## Solução

Um parâmetro por organização — UF da empresa + percentual — que sobrepõe a alíquota por origem
quando a UF de entrega do pedido é a mesma da empresa. Sem o parâmetro, nada muda.

### Escopo

| Entra | Fica de fora |
|---|---|
| Apuração pós-venda: Faturamento, Financeiro, Dashboard, Publicados, Detalhe de vendas, exports | Preço sugerido / gross-up (`_shared/preco/sugerir.ts`) |
| Configurações: novos campos admin-only | `etiquetaParaMinimo` e "Você recebe" pré-publicação |
| | Atributo ORIGIN do anúncio no ML |
| | Backfill de `uf` em pedidos antigos |

Motivo da exclusão da precificação: um anúncio tem preço único para o país e a UF do comprador só
existe depois do pedido. Usar 1% no gross-up subprecificaria toda venda para fora do estado.

## Arquitetura

### Dados

Migration (via `supabase migration new`, ADR-0043) adiciona a `configuracoes`:

```sql
alter table public.configuracoes
  add column uf_empresa text,
  add column aliquota_interna_pct numeric;
```

Ambas nullable, sem default. Constraint de coerência no banco (os dois preenchidos ou os dois
nulos) e validação equivalente na UI.

`uf_empresa` guarda a sigla em maiúsculas, sem prefixo `BR-` — mesmo formato de `ml_vendas.uf`,
produzido por `extrairGeo`.

### Leitura da configuração

`fetchAliquotas` (`src/lib/queries.ts`) passa a devolver:

```ts
{ nacional: number; importado: number; confirmada: boolean;
  ufEmpresa: string | null; internaPct: number | null }
```

Nenhum call site de `montarAliquotaResolver` muda: todos já repassam o objeto inteiro do
`useAliquotas()`.

### Resolução da alíquota

`AliquotaResolver` ganha a UF do pedido como **parâmetro obrigatório**:

```ts
export type AliquotaResolver = (item: VendaItem, uf: string | null) => number | null;
```

Obrigatório, não opcional: com parâmetro opcional, um call site esquecido devolveria a alíquota
por origem — número plausível e errado num caminho financeiro. Obrigatório, o compilador enumera
os call sites.

Ordem de decisão dentro de `montarAliquotaResolver` (`src/lib/custos.ts`):

1. Config não carregada → `null` (sem imposto; comportamento atual, ADR-0055).
2. `ufEmpresa` e `internaPct` preenchidos **e** `uf` do pedido igual (case-insensitive) →
   `internaPct`.
3. Origem `importado` → `aliquotas.importado`; `nacional` → `aliquotas.nacional`.
4. Origem não resolvida → `null`.

A alíquota interna vem antes da origem de propósito: sobrepõe nacional e importado.

### Propagação da UF

Três call sites, todos com a venda em escopo:

| Arquivo | Ponto | UF |
|---|---|---|
| `src/lib/resumo-vendas.ts` | `impostoDaVenda` → `impostoDoItem` | `v.uf` |
| `src/lib/pedidos-faturamento.ts` | loop de itens em `agruparPorPedido` | `primeiro.uf` |
| `src/lib/detalhe-vendas.ts` | loop de itens em `montarDetalheVendas` | `v.uf` |

`impostoDoItem(it, resolver, uf)` repassa. Nenhum hook, página ou componente muda.

### UI

No card "Imposto por origem" de `src/pages/Configuracoes.tsx`, um bloco novo: select de UF
(27 siglas + opção vazia) e input de percentual, ambos `disabled={!isAdmin}`, com o mesmo
feedback inline "✓ Salvo" dos campos existentes.

Texto de apoio: "Vendas entregues nesta UF usam esta alíquota, no lugar de nacional/importado.
Em branco, vale sempre a alíquota por origem."

Recusa de meia-configuração: preencher só um dos dois mostra o erro e não salva.

## Recálculo retroativo

Não há recálculo a executar. Imposto e markup não existem em nenhuma coluna — são derivados na
leitura por `impostoDoItem`. Confirmado por varredura em `supabase/migrations/` e
`src/lib/database.types.ts`. Salvar o parâmetro faz todas as telas recalcularem na próxima
consulta.

**Limite conhecido:** pedidos com `ml_vendas.uf` nula permanecem na regra por origem — vendas
fechadas antes de 2026-06-23 (nascimento da coluna) e pedidos sem envio registrado. O volume
afetado será medido na tela após o deploy; um backfill via API do ML fica como decisão posterior,
fora deste escopo.

## Testes

`src/lib/__tests__/pedidos-aliquota.test.ts`, seguindo TDD:

1. Pedido com `uf: 'PE'` e empresa em PE → alíquota 1%, imposto sobre `unit_price × quantity`.
2. Mesma família, pedido com `uf: 'SP'` → 8% (nacional) / 16% (importado).
3. Alíquota interna sobrepõe também produto importado.
4. `uf: null` → regra por origem.
5. Parâmetro não configurado (`ufEmpresa`/`internaPct` nulos) → regra por origem em tudo.
6. UF case-insensitive: `'pe'` casa com `'PE'`.

Teste de unidade da coerência do parâmetro (só um dos campos preenchido é recusado).

`pnpm lint` e `pnpm test` verdes antes da entrega.

## Documentação

- ADR-0112 (escrito antes da implementação) + entrada em
  `obsidian-vault/04-Decisões/Índice de ADRs.md`
- `docs/reference/modelo-de-dados.md` — colunas novas
- `docs/TASKS.md` — registro da entrega
