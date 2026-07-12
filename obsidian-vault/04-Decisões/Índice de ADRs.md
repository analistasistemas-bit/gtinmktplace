---
tags: [adr, indice]
atualizado: 2026-07-12
---

# Índice de ADRs

`docs/decisions/` é a fonte de verdade (69 ADRs, `0001`–`0069`). Este índice espelha só os
títulos, pra navegação rápida a partir do vault — o conteúdo completo (contexto, alternativas,
consequências) fica sempre no arquivo `docs/decisions/NNNN-titulo.md` linkado. Ver também
[[ADR-001]] / [[ADR-002]] (exemplos de mirror completo) e [[ADR Template]].

| ADR | Decisão |
|---|---|
| 0001 | [Stack tecnológico](../../docs/decisions/0001-stack-tecnologico.md) |
| 0002 | [MVP: aviamentos primeiro](../../docs/decisions/0002-mvp-aviamentos-primeiro.md) |
| 0003 | [Variações agrupadas por PAI](../../docs/decisions/0003-variacoes-agrupadas-por-pai.md) |
| 0004 | [Atribuição de cor](../../docs/decisions/0004-atribuicao-de-cor.md) |
| 0005 | [Lifecycle publish/update](../../docs/decisions/0005-lifecycle-publish-and-update.md) |
| 0006 | [QStash em vez de fila no Postgres](../../docs/decisions/0006-qstash-em-vez-de-postgres-queue.md) |
| 0007 | [Modelo de dados (4 tabelas)](../../docs/decisions/0007-modelo-de-dados-4-tabelas.md) |
| 0008 | [Estratégia de preço condicional](../../docs/decisions/0008-estrategia-de-preco-condicional.md) |
| 0009 | [Campos do payload ML + categoria determinística](../../docs/decisions/0009-campos-payload-ml-e-categoria-deterministica.md) |
| 0010 | [OpenRouter em vez de OpenAI direto](../../docs/decisions/0010-openrouter-em-vez-de-openai-direto.md) |
| 0011 | [Redirect URI via Edge Function](../../docs/decisions/0011-redirect-uri-via-edge-function.md) |
| 0012 | [Refresh token OAuth ML com lock Redis](../../docs/decisions/0012-refresh-token-oauth-ml-com-lock-redis.md) |
| 0013 | [Edge cases da planilha no ingest](../../docs/decisions/0013-edge-cases-da-planilha-no-ingest.md) |
| 0014 | [Busca de concorrência](../../docs/decisions/0014-busca-de-concorrencia.md) |
| 0015 | [Potencial de venda via proxies](../../docs/decisions/0015-potencial-de-venda-via-proxies.md) |
| 0016 | [Publicação UPDATE / reposição de estoque](../../docs/decisions/0016-publicacao-update-reposicao-estoque.md) |
| 0017 | [Selo de desconto via API de promoções](../../docs/decisions/0017-selo-de-desconto-via-api-de-promocoes.md) |
| 0018 | [Dimensões e peso no payload ML](../../docs/decisions/0018-dimensoes-e-peso-no-payload-ml.md) |
| 0019 | [Exclusão de lote preserva publicados](../../docs/decisions/0019-exclusao-lote-preserva-publicados.md) |
| 0020 | [Estratégia de preço líquido mínimo](../../docs/decisions/0020-estrategia-de-preco-liquido-minimo.md) |
| 0021 | [Vinculação automática ao catálogo ML](../../docs/decisions/0021-vinculacao-automatica-ao-catalogo-ml.md) |
| 0022 | [Categoria "cola" e seletor manual](../../docs/decisions/0022-categoria-cola-e-seletor-manual.md) |
| 0023 | [Preço acima do abismo de tarifa fixa](../../docs/decisions/0023-preco-acima-do-abismo-de-tarifa-fixa.md) |
| 0024 | [Camada de abstração de canais](../../docs/decisions/0024-camada-de-abstracao-de-canais.md) |
| 0025 | [Modelo de dados multicanal](../../docs/decisions/0025-modelo-de-dados-multicanal.md) |
| 0026 | [Generalização da categorização/atributos por IA](../../docs/decisions/0026-generalizacao-categorizacao-atributos-por-ia.md) |
| 0027 | [Multi-tenancy (organizations)](../../docs/decisions/0027-multi-tenancy-organizations.md) |
| 0028 | [Monetização e billing](../../docs/decisions/0028-monetizacao-e-billing.md) |
| 0029 | [Cor sem foto entra desmarcada no CREATE](../../docs/decisions/0029-cor-sem-foto-entra-desmarcada-no-create.md) |
| 0030 | [Reprocessamento de família em erro](../../docs/decisions/0030-reprocessamento-de-familia-em-erro.md) |
| 0031 | [Integração financeira Mercado Pago](../../docs/decisions/0031-integracao-financeira-mercado-pago.md) |
| 0032 | [KPIs de Publicados contam a conta inteira](../../docs/decisions/0032-kpis-publicados-contam-conta-inteira.md) |
| 0033 | [Retry interno de foto em processamento](../../docs/decisions/0033-retry-interno-foto-em-processamento.md) |
| 0034 | [Serialização da publicação ML](../../docs/decisions/0034-serializacao-publicacao-ml.md) |
| 0035 | [Monitoramento de anúncios moderados](../../docs/decisions/0035-monitoramento-anuncios-moderados.md) |
| 0036 | [Alerta de catálogo sem match](../../docs/decisions/0036-alerta-catalogo-no-match.md) |
| 0037 | [Módulo Faturamento (webhooks ML)](../../docs/decisions/0037-modulo-faturamento-webhooks-ml.md) |
| 0038 | [Fonte única `ml_vendas` para KPIs](../../docs/decisions/0038-fonte-unica-ml-vendas-kpis.md) |
| 0039 | [Faturamento por pedido + geografia + KPIs](../../docs/decisions/0039-faturamento-por-pedido-geografia-kpis.md) |
| 0040 | [Financeiro: caixa, evolução, notificação](../../docs/decisions/0040-financeiro-caixa-evolucao-notificacao.md) |
| 0041 | [Preço de atacado PxQ B2B](../../docs/decisions/0041-preco-atacado-pxq-b2b.md) |
| 0042 | [Líquido econômico (cross-docking)](../../docs/decisions/0042-liquido-economico-cross-docking.md) |
| 0043 | [Fluxo canônico de migrations](../../docs/decisions/0043-fluxo-canonico-de-migrations.md) |
| 0044 | [Cor no título mono-cor — anti-duplicado ML](../../docs/decisions/0044-cor-no-titulo-mono-cor.md) *(ex-0035)* |
| 0045 | [Atribuição de venda por EAN (catálogo ML)](../../docs/decisions/0045-vendas-catalogo-match-ean.md) *(ex-0037)* |
| 0046 | [verify_jwt=false p/ webhook e workers de faturamento](../../docs/decisions/0046-verify-jwt-false-workers-webhook-faturamento.md) |
| 0047 | [Operação compartilhada — RBAC no menu](../../docs/decisions/0047-operacao-compartilhada-rbac-menu.md) |
| 0048 | [Split de produto em N anúncios ML](../../docs/decisions/0048-split-produto-n-anuncios-ml.md) |
| 0049 | [Atributos opcionais e numéricos por IA](../../docs/decisions/0049-atributos-opcionais-e-numericos-por-ia.md) |
| 0050 | [Frete no gross-up do preço próprio](../../docs/decisions/0050-frete-no-gross-up-preco-proprio.md) |
| 0051 | [Tipo de aviamento derivado da categoria do preditor](../../docs/decisions/0051-tipo-aviamento-derivado-da-categoria-do-preditor.md) |
| 0052 | [Camada 2 de atributos — IA-first com fallback](../../docs/decisions/0052-camada2-atributos-ia-first-com-fallback.md) |
| 0053 | [Marca de saque manual em ML Vendas](../../docs/decisions/0053-marca-saque-manual-ml-vendas.md) |
| 0054 | [Categoria/título — tipo de produto genérico via IA](../../docs/decisions/0054-categoria-titulo-tipo-produto-generico.md) |
| 0055 | [Imposto por origem — nacional vs. importado](../../docs/decisions/0055-imposto-por-origem-nacional-importado.md) |
| 0056 | [Enriquecimento ao vivo — escopo da operação](../../docs/decisions/0056-enriquecimento-ao-vivo-escopo-da-operacao.md) |
| 0057 | [Categoria: seleção livre + sugestão por concorrente](../../docs/decisions/0057-categoria-selecao-livre-e-sugestao-concorrente.md) |
| 0058 | [Categoria genérica como fallback visível](../../docs/decisions/0058-categoria-generica-fallback-visivel.md) |
| 0059 | [Desconto sobre concorrência configurável](../../docs/decisions/0059-desconto-concorrencia-configuravel.md) |
| 0060 | [Pausar/reativar anúncio ML](../../docs/decisions/0060-pausar-reativar-anuncio-ml.md) |
| 0061 | [Orquestração multicanal](../../docs/decisions/0061-orquestracao-multicanal.md) |
| 0062 | [UPDATE de cor existente + fotos comuns](../../docs/decisions/0062-update-cor-existente-e-fotos-comuns.md) |
| 0063 | [Publicação de kit — preço/categoria/concorrência](../../docs/decisions/0063-publicacao-kit-preco-categoria-concorrencia.md) |
| 0064 | [Concorrência agregada por variação](../../docs/decisions/0064-concorrencia-agregada-por-variacao.md) |
| 0065 | [Reâncora de preço — piso do líder](../../docs/decisions/0065-reancora-preco-piso-lider.md) |
| 0066 | [Financeiro: líquido nunca desconta imposto](../../docs/decisions/0066-financeiro-liquido-nunca-desconta-imposto.md) |
| 0067 | [Mensagens pós-venda ML](../../docs/decisions/0067-mensagens-pos-venda-ml.md) |
| 0068 | [Notificações Telegram por destinatário e categoria](../../docs/decisions/0068-notificacoes-telegram-por-destinatario-e-categoria.md) |
| 0069 | [Liveness da integração ML](../../docs/decisions/0069-liveness-integracao-ml.md) |

Ver [[Arquitetura Geral]] para os ADRs mais citados no dia a dia.
