# PubliAI — Documentação do Projeto

Sistema interno que transforma planilhas de produtos da empresa em anúncios publicados no Mercado Livre, usando IA como copywriter especializado em aviamentos.

## Visão rápida

- **Problema:** publicar manualmente dezenas de milhares de produtos no marketplace é lento, repetitivo e produz anúncios de baixa qualidade.
- **Solução:** pipeline web interno que recebe planilha + imagens, gera copy persuasiva via IA (com vision para detectar cor quando ausente), verifica concorrência no ML, oferece revisão em lote e publica via API.
- **Primeiro escopo:** aviamentos (linha, botão, fita) → tecidos em versão futura.
- **Usuário-operador:** 1 funcionário interno; lotes típicos de ~50 produtos por família.

## Documentação técnica (Diátaxis)

Documentação organizada pelo framework [Diátaxis](https://diataxis.fr/). Comece por aqui para
entender e operar o sistema:

| Quero... | Vá para |
|---|---|
| Entender como o sistema funciona ponta a ponta | [explanation/arquitetura.md](explanation/arquitetura.md) |
| Ver os diagramas (C4, ERD, sequências) | [diagrams/](diagrams/) |
| Saber o significado exato de um termo do domínio | [reference/glossario.md](reference/glossario.md) |
| Consultar o schema do banco (tabelas, RLS, enums) | [reference/modelo-de-dados.md](reference/modelo-de-dados.md) |
| Consultar as Edge Functions (trigger, verify_jwt, idempotência) | [reference/edge-functions.md](reference/edge-functions.md) |
| Saber por que um endpoint ML/MP pode estar bloqueado (permissão/reputação da conta) | [reference/ml-permissao-reputacao-padrao.md](reference/ml-permissao-reputacao-padrao.md) |
| Rodar o projeto localmente | [how-to/desenvolvimento-local.md](how-to/desenvolvimento-local.md) |
| Fazer deploy de functions / migrations | [how-to/deploy-e-migrations.md](how-to/deploy-e-migrations.md) |
| Executar operações rotineiras (reprocessar, OAuth, faturamento) | [how-to/operacoes-rotineiras.md](how-to/operacoes-rotineiras.md) |

> `tutorials/` está reservada para a documentação **de usuário** (guias passo a passo de
> operação do app), próxima fase do esforço de documentação.

## Estrutura desta documentação

> Contagens abaixo são um retrato de 2026-07-12 — cada pasta cresce sem que este índice
> precise ser tocado; use o índice de ADRs (acima) e `ls` para o estado exato.

```
docs/
├── README.md                      ← você está aqui (índice geral)
├── project-status.md              ← estado atual curto e confiável
├── project-history.md             ← marcos históricos resumidos
├── ROADMAP.md                     ← visão estratégica das fases (vivo)
├── Roadmap-Estrategico-PubliAI-v2.md ← revisão de CTO do roadmap (8 fases, 2026-07-12)
├── TASKS.md                       ← checklist operacional do dia a dia (vivo)
├── decisions/                     ← ADRs: Architecture Decision Records (imutáveis) — 70 arquivos, 0001-0070
│   └── README.md                  ← como ler e escrever ADRs
├── reference/                     ← schema, edge functions, glossário, permissões ML
├── explanation/                   ← arquitetura ponta a ponta
├── how-to/                        ← deploy, dev local, operações rotineiras
├── diagrams/                      ← C4, ERD, sequências
├── spikes/                        ← investigações pontuais antes de virar ADR/plano
├── runbooks/                      ← procedimento de incidente específico
├── design-system/                 ← tokens visuais derivados do código
├── brand/                         ← briefings de identidade visual
└── superpowers/
    ├── specs/                     ← spec formal do design (1 por marco de planejamento) — 56 arquivos
    └── plans/                     ← plano de execução por marco — 52 arquivos
```

## Documentos vivos vs imutáveis

- **Vivos** (`ROADMAP.md`, `TASKS.md`) — atualize livremente conforme o projeto avança. São o "agora" do projeto.
- **Snapshot operacional** (`project-status.md`) — resumo curto do estado real atual; consulte antes de usar `ROADMAP.md` como fotografia do presente.
- **Memória institucional** (`project-history.md`) — marcos e mudanças relevantes sem poluir o bootstrap do projeto.
- **Imutáveis** (`decisions/*`) — uma vez aceito, um ADR não é editado. Se uma decisão muda, criamos um novo ADR que substitui (com referência ao antigo via "Substituído por").
- **Spec formal** (`superpowers/specs/*`) — congela o estado de uma fase de planejamento. Nova fase = novo spec.

## Onde encontrar o quê

| Quero saber... | Vá para |
|---|---|
| Em que estado o projeto está hoje, sem ler changelog | [project-status.md](project-status.md) |
| Quais foram os marcos principais até aqui | [project-history.md](project-history.md) |
| Por que escolhemos Supabase + Render + Upstash | [decisions/0001](decisions/0001-stack-tecnologico.md) |
| Por que começamos por aviamentos, não tecidos | [decisions/0002](decisions/0002-mvp-aviamentos-primeiro.md) |
| Como variações funcionam no anúncio do ML | [decisions/0003](decisions/0003-variacoes-agrupadas-por-pai.md) |
| Como o sistema descobre a cor de cada variação | [decisions/0004](decisions/0004-atribuicao-de-cor.md) |
| O que acontece quando re-importa uma família já publicada | [decisions/0005](decisions/0005-lifecycle-publish-and-update.md) |
| Por que usamos QStash em vez de fila no Postgres | [decisions/0006](decisions/0006-qstash-em-vez-de-postgres-queue.md) |
| Schema do banco e por que essas tabelas | [decisions/0007](decisions/0007-modelo-de-dados-4-tabelas.md) |
| Como o sistema decide entre preço próprio e competitivo | [decisions/0008](decisions/0008-estrategia-de-preco-condicional.md) |
| Quais campos do payload ML existem e como a categoria é definida | [decisions/0009](decisions/0009-campos-payload-ml-e-categoria-deterministica.md) |
| Por que usamos OpenRouter em vez de OpenAI direto | [decisions/0010](decisions/0010-openrouter-em-vez-de-openai-direto.md) |
| Por que o redirect URI do OAuth ML aponta para Edge Function e não pro frontend | [decisions/0011](decisions/0011-redirect-uri-via-edge-function.md) |
| Como o refresh de token OAuth ML evita corrida (lock Redis) | [decisions/0012](decisions/0012-refresh-token-oauth-ml-com-lock-redis.md) |
| Como o ingest trata edge cases da planilha (duplicado, órfão, PAI vazio) | [decisions/0013](decisions/0013-edge-cases-da-planilha-no-ingest.md) |
| Como a busca de concorrência no ML funciona (granularidade, GTIN→título) | [decisions/0014](decisions/0014-busca-de-concorrencia.md) |
| **Visão de evolução para SaaS multicanal** (Shopee/Amazon, multi-tenant, billing, qualquer produto) | [superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md](superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md) |
| Camada de abstração de canais (Ports & Adapters) | [decisions/0024](decisions/0024-camada-de-abstracao-de-canais.md) |
| Modelo de dados multicanal (`anuncios_externos`) | [decisions/0025](decisions/0025-modelo-de-dados-multicanal.md) |
| Generalização da categorização/atributos por IA | [decisions/0026](decisions/0026-generalizacao-categorizacao-atributos-por-ia.md) |
| Multi-tenancy (organizations + org_id) | [decisions/0027](decisions/0027-multi-tenancy-organizations.md) |
| Monetização e billing (Asaas + planos) | [decisions/0028](decisions/0028-monetizacao-e-billing.md) |

> A tabela acima é uma seleção curada. O **índice completo** (0001–0072) está logo abaixo.

## Índice completo de ADRs (0001–0072)

> A antiga colisão de numeração (dois `0035` e dois `0037`) foi **resolvida em 2026-06-27**:
> `cor-no-titulo-mono-cor` virou **0044** e `vendas-catalogo-match-ean` virou **0045**. Cada
> número agora mapeia para um único ADR. Detalhe em `docs/decisions/README.md`.

| ADR | Decisão |
|---|---|
| 0001 | [Stack tecnológico](decisions/0001-stack-tecnologico.md) |
| 0002 | [MVP: aviamentos primeiro](decisions/0002-mvp-aviamentos-primeiro.md) |
| 0003 | [Variações agrupadas por PAI](decisions/0003-variacoes-agrupadas-por-pai.md) |
| 0004 | [Atribuição de cor](decisions/0004-atribuicao-de-cor.md) |
| 0005 | [Lifecycle publish/update](decisions/0005-lifecycle-publish-and-update.md) |
| 0006 | [QStash em vez de fila no Postgres](decisions/0006-qstash-em-vez-de-postgres-queue.md) |
| 0007 | [Modelo de dados (4 tabelas)](decisions/0007-modelo-de-dados-4-tabelas.md) |
| 0008 | [Estratégia de preço condicional](decisions/0008-estrategia-de-preco-condicional.md) |
| 0009 | [Campos do payload ML + categoria determinística](decisions/0009-campos-payload-ml-e-categoria-deterministica.md) |
| 0010 | [OpenRouter em vez de OpenAI direto](decisions/0010-openrouter-em-vez-de-openai-direto.md) |
| 0011 | [Redirect URI via Edge Function](decisions/0011-redirect-uri-via-edge-function.md) |
| 0012 | [Refresh token OAuth ML com lock Redis](decisions/0012-refresh-token-oauth-ml-com-lock-redis.md) |
| 0013 | [Edge cases da planilha no ingest](decisions/0013-edge-cases-da-planilha-no-ingest.md) |
| 0014 | [Busca de concorrência](decisions/0014-busca-de-concorrencia.md) |
| 0015 | [Potencial de venda via proxies](decisions/0015-potencial-de-venda-via-proxies.md) |
| 0016 | [Publicação UPDATE / reposição de estoque](decisions/0016-publicacao-update-reposicao-estoque.md) |
| 0017 | [Selo de desconto via API de promoções](decisions/0017-selo-de-desconto-via-api-de-promocoes.md) |
| 0018 | [Dimensões e peso no payload ML](decisions/0018-dimensoes-e-peso-no-payload-ml.md) |
| 0019 | [Exclusão de lote preserva publicados](decisions/0019-exclusao-lote-preserva-publicados.md) |
| 0020 | [Estratégia de preço líquido mínimo](decisions/0020-estrategia-de-preco-liquido-minimo.md) |
| 0021 | [Vinculação automática ao catálogo ML](decisions/0021-vinculacao-automatica-ao-catalogo-ml.md) |
| 0022 | [Categoria "cola" e seletor manual](decisions/0022-categoria-cola-e-seletor-manual.md) |
| 0023 | [Preço acima do abismo de tarifa fixa](decisions/0023-preco-acima-do-abismo-de-tarifa-fixa.md) |
| 0024 | [Camada de abstração de canais](decisions/0024-camada-de-abstracao-de-canais.md) |
| 0025 | [Modelo de dados multicanal](decisions/0025-modelo-de-dados-multicanal.md) |
| 0026 | [Generalização da categorização/atributos por IA](decisions/0026-generalizacao-categorizacao-atributos-por-ia.md) |
| 0027 | [Multi-tenancy (organizations)](decisions/0027-multi-tenancy-organizations.md) |
| 0028 | [Monetização e billing](decisions/0028-monetizacao-e-billing.md) |
| 0029 | [Cor sem foto entra desmarcada no CREATE](decisions/0029-cor-sem-foto-entra-desmarcada-no-create.md) |
| 0030 | [Reprocessamento de família em erro](decisions/0030-reprocessamento-de-familia-em-erro.md) |
| 0031 | [Integração financeira Mercado Pago](decisions/0031-integracao-financeira-mercado-pago.md) |
| 0032 | [KPIs de Publicados contam a conta inteira](decisions/0032-kpis-publicados-contam-conta-inteira.md) |
| 0033 | [Retry interno de foto em processamento](decisions/0033-retry-interno-foto-em-processamento.md) |
| 0034 | [Serialização da publicação ML](decisions/0034-serializacao-publicacao-ml.md) |
| 0035 | [Monitoramento de anúncios moderados](decisions/0035-monitoramento-anuncios-moderados.md) |
| 0036 | [Alerta de catálogo sem match](decisions/0036-alerta-catalogo-no-match.md) |
| 0037 | [Módulo Faturamento (webhooks ML)](decisions/0037-modulo-faturamento-webhooks-ml.md) |
| 0038 | [Fonte única `ml_vendas` para KPIs](decisions/0038-fonte-unica-ml-vendas-kpis.md) |
| 0039 | [Faturamento por pedido + geografia + KPIs](decisions/0039-faturamento-por-pedido-geografia-kpis.md) |
| 0040 | [Financeiro: caixa, evolução, notificação](decisions/0040-financeiro-caixa-evolucao-notificacao.md) |
| 0041 | [Preço de atacado PxQ B2B](decisions/0041-preco-atacado-pxq-b2b.md) |
| 0042 | [Líquido econômico (cross-docking)](decisions/0042-liquido-economico-cross-docking.md) |
| 0043 | [Fluxo canônico de migrations](decisions/0043-fluxo-canonico-de-migrations.md) |
| 0044 | [Cor no título mono-cor — anti-duplicado ML](decisions/0044-cor-no-titulo-mono-cor.md) *(ex-0035)* |
| 0045 | [Atribuição de venda por EAN (catálogo ML)](decisions/0045-vendas-catalogo-match-ean.md) *(ex-0037)* |
| 0046 | [verify_jwt=false p/ webhook e workers de faturamento](decisions/0046-verify-jwt-false-workers-webhook-faturamento.md) |
| 0047 | [Operação compartilhada — RBAC no menu](decisions/0047-operacao-compartilhada-rbac-menu.md) |
| 0048 | [Split de produto em N anúncios ML](decisions/0048-split-produto-n-anuncios-ml.md) |
| 0049 | [Atributos opcionais e numéricos por IA](decisions/0049-atributos-opcionais-e-numericos-por-ia.md) |
| 0050 | [Frete no gross-up do preço próprio](decisions/0050-frete-no-gross-up-preco-proprio.md) |
| 0051 | [Tipo de aviamento derivado da categoria do preditor](decisions/0051-tipo-aviamento-derivado-da-categoria-do-preditor.md) |
| 0052 | [Camada 2 de atributos — IA-first com fallback](decisions/0052-camada2-atributos-ia-first-com-fallback.md) |
| 0053 | [Marca de saque manual em ML Vendas](decisions/0053-marca-saque-manual-ml-vendas.md) |
| 0054 | [Categoria/título — tipo de produto genérico via IA](decisions/0054-categoria-titulo-tipo-produto-generico.md) |
| 0055 | [Imposto por origem — nacional vs. importado](decisions/0055-imposto-por-origem-nacional-importado.md) |
| 0056 | [Enriquecimento ao vivo — escopo da operação](decisions/0056-enriquecimento-ao-vivo-escopo-da-operacao.md) |
| 0057 | [Categoria: seleção livre + sugestão por concorrente](decisions/0057-categoria-selecao-livre-e-sugestao-concorrente.md) |
| 0058 | [Categoria genérica como fallback visível](decisions/0058-categoria-generica-fallback-visivel.md) |
| 0059 | [Desconto sobre concorrência configurável](decisions/0059-desconto-concorrencia-configuravel.md) |
| 0060 | [Pausar/reativar anúncio ML](decisions/0060-pausar-reativar-anuncio-ml.md) |
| 0061 | [Orquestração multicanal](decisions/0061-orquestracao-multicanal.md) |
| 0062 | [UPDATE de cor existente + fotos comuns](decisions/0062-update-cor-existente-e-fotos-comuns.md) |
| 0063 | [Publicação de kit — preço/categoria/concorrência](decisions/0063-publicacao-kit-preco-categoria-concorrencia.md) |
| 0064 | [Concorrência agregada por variação](decisions/0064-concorrencia-agregada-por-variacao.md) |
| 0065 | [Reâncora de preço — piso do líder](decisions/0065-reancora-preco-piso-lider.md) |
| 0066 | [Financeiro: líquido nunca desconta imposto](decisions/0066-financeiro-liquido-nunca-desconta-imposto.md) |
| 0067 | [Mensagens pós-venda ML](decisions/0067-mensagens-pos-venda-ml.md) |
| 0068 | [Notificações Telegram por destinatário e categoria](decisions/0068-notificacoes-telegram-por-destinatario-e-categoria.md) |
| 0069 | [Liveness da integração ML](decisions/0069-liveness-integracao-ml.md) |
| 0070 | [Título: corrige sinônimo de tipo de fio/linha errado](decisions/0070-titulo-sinonimo-tipo-fio-grounded-errado.md) |
| 0071 | [UNITS_PER_PACK real força SALE_FORMAT=Kit](decisions/0071-units-per-pack-forca-sale-format-kit.md) |
| 0072 | [Título: duplicação de tipo de produto/cor por checagem exata demais](decisions/0072-titulo-duplicacao-tipo-e-cor-fora-de-ordem.md) |

## Status do projeto

- O snapshot confiável fica em [project-status.md](project-status.md).
- `ROADMAP.md` mantém a visão estratégica.
- `TASKS.md` mantém o checklist operacional detalhado.

## Stack confirmado

- **Frontend:** React 18 + TypeScript + Vite + shadcn/ui + Tailwind + TanStack Query + Zustand
- **Backend / DB / Storage / Auth:** Supabase (Postgres + Edge Functions + Storage + Realtime)
- **Hospedagem do frontend:** Render Static Site
- **Fila + cache:** Upstash QStash (fila assíncrona com retry) + Upstash Redis (cache de concorrência)
- **IA:** OpenRouter (gateway compatível com OpenAI SDK) com modelos OpenAI — GPT-4o-mini (copy) + GPT-4o Vision (detecção de cor por foto) — ver ADR-0010
- **Integração externa:** Mercado Livre API (OAuth 2.0)

## Autoria

- **Brainstorming:** Diego (cliente + desenvolvedor, funcionário interno da empresa) + Claude Code
- **Proposta original:** Leonardo Freitas (proposta comercial v1.1, 21/05/2026 — inviável financeiramente)
- **Data de início:** 25/05/2026
