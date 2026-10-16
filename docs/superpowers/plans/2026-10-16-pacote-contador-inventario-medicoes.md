# Plano 2b-2 (inventário) — medições em produção (2026-10-16)

Insumo das Tasks 3–5 do [plano](2026-10-16-pacote-contador-inventario.md). Só leitura (`select`/`show` via Management API); nada foi escrito no banco. Sem dado de cliente: só contagens e nomes de função/config.

## (a) Volume

| Medida | Resultado | Consulta |
|---|---|---|
| Maior nº de movimentos numa org | 3.756 | `select max(n) from (select org_id, count(*) n from estoque_movimentos group by 1) t` |
| Maior nº de variações numa org | 11.717 | `select max(n) from (select org_id, count(*) n from variacoes group by 1) t` |
| Total de movimentos (custo do backfill de `ordem`) | 5.288 | `select count(*) from estoque_movimentos` |
| Orgs com movimento | 5 | `select count(distinct org_id) from estoque_movimentos` |

Leitura: o backfill de `ordem` toca ~5,3 mil linhas (trivial). O volume sintético da Task 3 pode usar 3.756 movimentos / 11.717 variações numa org como teto realista de hoje.

## (a2) Caminhos que gravam `variacoes.estoque` (inspeção de código, sem banco)

Escrita em `variacoes.estoque` por SQL só nas 4 RPCs (`baixar_estoque`, `estornar_estoque`, `registrar_entrada`, `ajustar_estoque`); o trigger `bloquear_escrita_direta_estoque` (`20260729084329_e6b_estoque_movimentos.sql:330-343`) barra só `authenticated` (`auth.uid() is not null`), então `service_role` das edges poderia escrever, mas nenhuma edge faz `update` de `estoque` (os `update` de `variacoes` nas edges só tocam `ml_*`, `preco_publicado_ml`, fotos). O que insere linhas com `estoque ≠ 0`:

| Caminho | Insere estoque | Classe | Obs. |
|---|---|---|---|
| `ingest-lote/index.ts:367` (`estoque: v.ESTOQUE`), insert em `:416` (CREATE e UPDATE) | planilha (qualquer valor) | **marco** (lote 'planilha'); salto fora do ledger | `variacoesCreate` e `variacoesUpdate` são dois inserts; uma família cai inteira em um só (a divisão é por família: `cas` definido → Update, senão → Create, `:343-413`) |
| `adicionar-variacoes-familia/index.ts:362-380` (`clonarVariacao` + `montarVariacaoNova`) | clones levam `estoqueCanonico ?? row.estoque` (`processar.ts:535`); novas nascem `estoque: 0` (`processar.ts:576`) | **contínuo** (clone, mesma linhagem; código vivo) + **saldo 0 + ledger** (novas) | clones e novas vão num único `insert([...clones, ...novas])` (`index.ts:380`). Risco herdado: corrida do clone (spec §Limitações) |
| `cadastrar-produto/index.ts:274-276` (linhas de `montarLinhasProduto`) | `estoque: 0` (`_shared/produto/validar.ts:240`) | **saldo 0 + ledger** (`registrar_entrada` com ref `cadastro:{familiaId}:{codigo}`) | todas as variações da família num único insert |
| `criar-kit-vinculado/processar.ts:172` (insert em `:548`) | `estoque: 0`, `estoque_anterior: 0` | **saldo 0** (kit vinculado não tem estoque próprio; `registrar_entrada`/`ajustar_estoque` recusam kit) | 1 variação por insert |
| Demais edges (`publicar-*`, `update-familia-ml`, `upload-imagens-lote`, `remover-publicado`, `pulse-*`, `sincronizar-estoque`...) | nenhum | só leem `estoque` ou gravam colunas `ml_*`/preço/foto | confirmado por `grep` em `supabase/functions` (`from('variacoes')` + `.insert/.update`) |

Triggers de insert relevantes: `validar_variacao_no_tenant` (`20260820143736_guard_estoque_update_manual.sql`) proíbe `estoque ≠ 0` em lote `manual`, exceto família de UPDATE (clone, ADR-0129); em lote `planilha` não há restrição, por isso o marco. Confirmado: as variações de uma família entram num único insert em todos os caminhos (spec §Universo de SKUs).

## (b) Códigos com movimento `nfe:` e outro movimento (corte da Task 3)

Em produção hoje **não há nenhum movimento `nfe:`** (a org de validação do Plano 1 foi limpa), então o corte é vazio:

| Medida | Resultado |
|---|---|
| (org, código) com algum movimento `nfe:` | 0 |
| (org, código) com `nfe:` **e** outro movimento | 0 |
| (org, código) só com `nfe:` | 0 |
| Movimentos `nfe:` / orgs com `nfe:` | 0 / 0 |

Consulta do corte (a migration da Task 3 deve **recalcular por SQL** no momento do `db push`, não confiar nesta contagem):

```sql
select count(*) from (
  select org_id, codigo from estoque_movimentos
  group by 1, 2
  having bool_or(referencia_externa like 'nfe:%')
     and bool_or(referencia_externa is null or referencia_externa not like 'nfe:%')
) t;
```

## (c) Mesmo código em mais de um movimento `nfe:` com o mesmo `criado_em`

0 (`select count(*) from (select org_id, codigo, criado_em from estoque_movimentos where referencia_externa like 'nfe:%' group by 1,2,3 having count(*)>1) t`). Trivial hoje por não haver movimento `nfe:`; o caso continua possível no desenho (uma nota com o mesmo código em dois itens grava os dois movimentos na mesma transação, mesmo `now()`), então a ordenação por `ordem` da Task 3 deve ser o desempate, não `criado_em`.

## (d) Config de tempo

| Item | Valor |
|---|---|
| `select setting from pg_settings where name = 'cron.timezone'` | `GMT` |
| `select rolconfig from pg_roles where rolname = 'postgres'` | `["search_path=\"$user\", public, extensions"]` (sem `statement_timeout` na role) |
| `show statement_timeout` (sessão da Management API) | `2min` |

Implicação para a Task 4: `cron.timezone = GMT`, então o agendamento de "31/12 23:59 America/Sao_Paulo" precisa ser expresso em UTC (São Paulo é UTC-3 fixo, sem horário de verão: 02:59 UTC de 01/01, ou 23:59 BRT convertido) ou o job precisa calcular o dia em `America/Sao_Paulo` dentro da função. O `2min` observado é o da sessão da API e não prova o timeout da role do `pg_cron`; o job da foto deve ser rápido (5,3 mil movimentos / 11,7 mil variações no maior caso) ou definir `set local statement_timeout` próprio.

## (e) Quem preenche `estoque_resultante`

`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and prosrc ilike '%estoque_resultante%'` → exatamente `ajustar_estoque`, `baixar_estoque`, `estornar_estoque`, `registrar_entrada`. Triggers não internos em `estoque_movimentos`: nenhum (consulta em `pg_trigger` retornou vazio). Logo a Task 3 não precisa de `before insert`.

Ordem conferida nos corpos (insert com resultante nulo → `for update` da variação → `update` de `variacoes` → `update` do movimento com `estoque_resultante`):

| Função (definição vigente) | insert | `for update` da variação | update da variação | update do movimento |
|---|---|---|---|---|
| `registrar_entrada` (`20260903002527_kit_vinculado_guards.sql`) | `:61` | `:71` | `:73-77` | `:79-81` |
| `ajustar_estoque` (`20260903002527_kit_vinculado_guards.sql`) | `:121` | `:130` | `:136-138` | `:140-141` |
| `baixar_estoque` (`20260729084329_e6b_estoque_movimentos.sql`) | `:108` | `:147` | `:150` | `:157-161` |
| `estornar_estoque` (`20260729084329_e6b_estoque_movimentos.sql`) | `:213` | `:237` | `:239` | `:243-244` |

Pontos para a Task 3:
- `estornar_estoque` tem também `for update` no movimento da venda original (`:191-195`) antes do insert; não muda a ordem em relação à variação.
- Movimentos que **nunca** recebem `estoque_resultante` (ficam com `ordem` nula): tombstones `cancelamento_sem_baixa` (`:200-203`), `estorno_sku_nao_encontrado` (`:229-233`, quantidade zerada) e, em `baixar_estoque`, `venda_sku_nao_encontrado` (`:140`) e `venda_cancelada_antes` (`:123-126`, reaproveita o tombstone). A Task 3 deve ignorá-los (`quantidade = 0`, sem efeito no saldo) e o backfill não pode exigir `ordem` não nula em toda linha.
- `registrar_entrada_nota_pendente` (`20261015234006_adr181_rpc_nota_compra.sql:168`) delega a `registrar_entrada`; não grava resultante por conta própria.

## (f) Orçamento de `inventario_calcular` (Task 3, Step 5)

Volume sintético = o maior medido em (a), numa org de teste dentro de `teste-sql-desfeito.py` (transação desfeita): 11.717 variações (2.930 famílias de planilha) e 3.756 movimentos, com o pior caso de recursão (um SKU com cadeia de 1.000 movimentos + 689 SKUs com 4) e 889 entradas de nota importada. Teste: `supabase/tests/inventario_calculo_volume.sql`.

| Medida | Resultado | Critério |
|---|---|---|
| `explain (analyze) select * from inventario_calcular(org)` — Execution Time | **297 ms** (11.717 linhas) | ≤ 10 s |

Leitura: folga de ~30×; o índice `(org_id, codigo, ordem)` não foi criado (o plano só o pede acima de 10 s).
