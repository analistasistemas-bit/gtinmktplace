# ADR-0061: Orquestração multicanal — fan-out por (família, canal)

> **Nota de numeração:** o plano E6 (2026-07-02) reservou "ADR-0053", mas esse número
> foi ocupado pelo ADR de marca-saque no mesmo dia. Este ADR é o **0061** (próximo livre).
> Onde o plano/código citar "ADR-0053 (orquestração)", leia **ADR-0061**.

**Status:** Aceito (2026-07-05)
**Data:** 2026-07-02 (plano) · 2026-07-05 (aceito no início do E6, pós-E7)
**Decisores:** Diego
**Relaciona:** [evolução SaaS multicanal](../superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md) (E6); [plano E6](../superpowers/plans/2026-07-02-e6-orquestracao-multicanal.md); depende de ADR-0027 (E7 multi-tenancy), refina ADR-0024 (abstração de canais), ADR-0025 (`anuncios_externos`), ADR-0034 (serialização), ADR-0048 (split)

## Contexto

Publicar hoje é mono-canal por construção: `getConnector('mercado_livre')` aparece **literal** em 5 workers (`publish-familia-ml`, `update-familia-ml`, `publicar-split-ml`, `status-publicados`, `metricas-vendas`), a identidade CREATE/UPDATE está atada a `familias.ml_item_id`, e o roteador `publicar-familias` só conhece o caminho ML. O E6 do doc mestre pede publicar **1 família em N canais** a partir da fonte única, com **falha de um canal nunca afetando outro** — sem tocar no caminho ML que fatura.

Pós-E7, os pré-requisitos existem: conexões por org (`marketplace_connections`, `resolverConexao`, `getValidAccessTokenConexao`) e a identidade por canal já é `anuncios_externos(org_id, canal, codigo_pai, particao)`. Falta o fan-out: transformar `canal` em parâmetro e dar a cada `(família, canal)` seu próprio job/estado/idempotência.

## Decisão

Strangler fig sobre a infraestrutura existente (`ChannelConnector` + registry + `anuncios_externos` + fila QStash serial). Decisões travadas:

| # | Decisão | Racional |
|---|---------|----------|
| **D-E6.1** | **ML não migra para o worker genérico neste épico** — `publicar-anuncio` atende só canais ≠ ML; o cutover do ML fica para depois do E5 validar o genérico com um 2º canal real | Strangler: o caminho auditado que fatura não se move por elegância. Risco ~zero. |
| **D-E6.2** | **Estado por canal vive em `anuncios_externos.status`** (`pendente → publicando → publicado \| erro`), claim atômico por linha; `familias.status` continua sendo a visão do fluxo ML/ingest | 1 família × N canais exige N máquinas de estado; a tabela já é a identidade por canal (ADR-0025/0048). |
| **D-E6.3** | **CREATE vs UPDATE por canal** = `anuncios_externos.item_externo_id` nulo/preenchido; `familias.operacao` segue sendo a decisão do ingest para o ML | Um produto pode ser UPDATE no ML e CREATE na Shopee. |
| **D-E6.4** | **Fila serial por `(canal, org)`**: `publish-{canal}-{orgId}` | Rate limit é por conta de vendedor por canal (ADR-0034 + lição do lote #28); canais paralelos entre si, serial dentro do canal. |
| **D-E6.5** | **Conector fake** (`_shared/canais/fake.ts`) instalável no registry só em teste, via `registrarConectorParaTeste()` | Prova o worker genérico ponta a ponta sem canal real; some do bundle de produção por não ser importado fora de testes. |
| **D-E6.6** | `Capabilities` passa a ser **consultado** no worker genérico (descrição separada, atacado, catálogo); `classificarErroCanal` ganha só `AUTENTICACAO` e `RATE_LIMIT` | O genérico não pode assumir os recursos do ML; códigos extras só os que mudam decisão de retry (YAGNI nos outros 9). |
| **D-E6.7** | Critério de saída **ajustado com honestidade**: infraestrutura provada com fake + regressão ML real; "ML + Shopee simultâneos" fecha no encerramento do E5 | O critério original do doc mestre pressupõe E5 pronto. |

### Fan-out (diagrama)

```
publicar-familias { familia_ids, canais[] }
   ├─ canal 'mercado_livre'  → fluxo ATUAL intocado (enfileirarPublicacao/Atualizacao/Split → workers ML)
   └─ cada canal ≠ ML        → por (família, canal):
                                garantirAnuncioExterno → claimAnuncioExterno (pendente/erro → publicando)
                                → enfileirarPublicacaoCanal (fila serial publish-{canal}-{orgId})
                                → worker genérico `publicar-anuncio`:
                                     resolverConexao(org, canal) → getConnector(canal)
                                     → montarAnuncioCanonico → criar/atualizar → persiste em anuncios_externos
```

Cada job `(família, canal)` escreve **apenas** na sua linha de `anuncios_externos` — nunca em `familias.status` (isolamento entre canais).

## Alternativas rejeitadas

- **Migrar o ML para o worker genérico já** — introduz risco no caminho que fatura sem nenhum 2º canal para justificar; cutover só depois do E5 provar o genérico (D-E6.1).
- **Estado por canal em colunas de `familias`** — repete exatamente o erro que o ADR-0025 corrigiu (N colunas por canal); a identidade por canal é `anuncios_externos`.
- **Fila única global** — rate limit é por conta/canal; uma fila serial por `(canal, org)` isola sem serializar canais entre si (D-E6.4).

## Consequências

- **E5 (Shopee) vira "preencher a interface"**: implementar `ShopeeConnector` + registrar no registry + adicionar valor no enum `canal_externo`. Nada mais no orquestrador.
- **Dívida explícita**: cutover do ML para o worker genérico fica pós-E5 (quando o genérico estiver provado com 2 canais reais).
- `anuncios_externos.status` ganha check-constraint (`pendente|publicando|publicado|erro`) + `qstash_message_id`; linhas existentes (espelho ML, default `publicado`) não mudam.
- `classificarErroCanal` distingue `AUTENTICACAO` (reconectar, não retentável) e `RATE_LIMIT` (retentável).
- Critério de saída do E6 (D-E6.7): infra provada por fake + regressão ML idêntica; "ML + Shopee simultâneos" fecha com o E5.
