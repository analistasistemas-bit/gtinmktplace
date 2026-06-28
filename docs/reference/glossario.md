# Glossário — Linguagem ubíqua do PubliAI

> **Tipo:** Reference (Diátaxis). Fonte única dos termos do domínio. Sempre que um termo
> aparecer em código, ADR, doc ou conversa, deve significar o que está aqui. Mudou o
> significado? Atualize este arquivo no mesmo PR.

## Domínio de produto

| Termo | Definição |
|---|---|
| **Lote** | Um upload de planilha + imagens. Inicia o pipeline de importação que cria famílias e variações. Exibido como "Lote #N" (`lotes.numero`). |
| **Família** | Um PAI = um produto único que vira **1 anúncio** no marketplace com N variações. Agrega metadados, resultado da IA e estado de publicação. Tabela `familias`. |
| **Variação** | Um SKU/cor dentro da família = **1 variação** do anúncio. Tem preço, estoque, dimensões, cor e foto próprios. Tabela `variacoes`. |
| **PAI** | Coluna da planilha que agrupa variações. `PAI = 0` marca o **agrupador** (a própria família), **nunca um item vendável**. Os filhos referenciam o código do pai. |
| **CODIGO** | Identificador do item na planilha. Da família = `codigo_pai`; da variação = `codigo`. Único dentro do seu escopo. |
| **GTIN / EAN** | Código de barras do produto. Usado para vínculo de catálogo no ML e para atribuir vendas ao produto (`variacoes.gtin`). |
| **Aviamento** | Categoria de produto do MVP: linha, botão, fita, cola, outro (`tipo_aviamento`). Primeiro escopo do produto (ADR-0002). |

## Lifecycle e operações

| Termo | Definição |
|---|---|
| **CREATE** | Operação que cria um anúncio novo no marketplace (`operacao_ml = CREATE`). |
| **UPDATE** | Operação que atualiza um anúncio existente — reposição de estoque, preço ou cor nova (`operacao_ml = UPDATE`). Ver ADR-0005, ADR-0016. |
| **Revisão humana** | Etapa obrigatória entre processamento e publicação. Nenhum anúncio vai ao ar sem aprovação do operador (regra inegociável). |
| **Reprocessar** | Re-enfileirar uma família travada em `erro` resetando o status para `pendente` (ADR-0030, função `reprocessar-familia`). |
| **Publicável / viabilidade** | Conjunto de checagens (foto, cor, preço, categoria) que liberam ou bloqueiam a publicação. Fonte única em `src/lib/publicavel.ts`. |

## Estados (enums)

| Enum | Valores | Onde |
|---|---|---|
| `lote_status` | `importando`, `processando`, `revisao`, `publicando`, `concluido`, `erro` | `lotes.status` |
| `familia_status` | `pendente`, `processando`, `pronto`, `publicando`, `publicado`, `erro` | `familias.status` |
| `operacao_ml` | `CREATE`, `UPDATE` | `familias.operacao` |
| `tipo_aviamento` | `linha`, `botao`, `fita`, `cola`, `outro` | `familias.tipo_aviamento` |
| `tipo_origem` | `regex`, `ia`, `manual`, `preditor` | origem da categorização |
| `estrategia_preco` | `proprio`, `competitivo`, `manual` | `familias.estrategia_preco` |
| `cor_origem` | `descricao`, `vision`, `manual` | `variacoes.cor_origem` |
| `canal_externo` | `mercado_livre` | `anuncios_externos.canal` (único valor hoje) |

## Multicanal

| Termo | Definição |
|---|---|
| **Canal** | Um marketplace de destino (hoje só Mercado Livre). Abstraído pela camada de conectores (ADR-0024). |
| **Conector (ChannelConnector)** | Interface única de operações de anúncio por canal. `getConnector('mercado_livre')` resolve a implementação. `_shared/canais/`. |
| **Anúncio externo** | Espelho normalizado de um produto-canal, com identidade estável `(user_id, canal, codigo_pai)`. Tabela `anuncios_externos` (ADR-0025). |
| **Dual-write** | Workers gravam tanto em `familias`/`variacoes` (fonte de verdade hoje) quanto em `anuncios_externos` (espelho, pronto para o 2º canal). |
| **Catálogo (ML)** | Ficha oficial de produto do Mercado Livre. Vínculo opt-in via GTIN (ADR-0021). Estado por variação em `catalog_status`. |
| **Ficha equivalente / divergente** | Ficha de catálogo cujo formato de venda casa (equivalente) ou não casa (divergente, ex.: kit) com a variação. Divergente não deve vincular para não pausar o anúncio. |

## Infraestrutura

| Termo | Definição |
|---|---|
| **Edge Function** | Função Deno serverless no Supabase. 32 no projeto. Devem ser **idempotentes** (regra inegociável). Ver [edge-functions.md](edge-functions.md). |
| **QStash** | Fila assíncrona da Upstash, com retry automático. Orquestra os workers (ADR-0006). |
| **Worker** | Edge Function disparada pelo QStash (não pelo frontend). Autentica pela assinatura QStash, não por JWT. |
| **Fila serial** | Fila QStash com `parallelism=1` por usuário, que serializa publicações no ML (ADR-0034) para evitar travamento por foto assíncrona. |
| **Redis** | Cache + locks distribuídos da Upstash. Cache de cor/concorrência/tarifa (6h) e lock do refresh de token OAuth (ADR-0012). |
| **Vault** | Cofre criptografado do Supabase onde ficam os tokens OAuth do ML. Tokens nunca em texto puro (regra inegociável). |
| **RLS** | Row Level Security do Postgres. Toda tabela de domínio isola por `user_id` (ADR-0027). |
| **verify_jwt** | Flag por função no `config.toml`. `true` = o gateway exige JWT Supabase válido; `false` = função pública que autentica por conta própria (assinatura QStash, webhook, ou JWT manual). |

## Integrações externas

| Termo | Definição |
|---|---|
| **ML** | Mercado Livre. Marketplace primário. OAuth 2.0, API de items, webhooks. |
| **MP** | Mercado Pago. Origem dos dados financeiros (líquido, liberação). Token único em `MP_ACCESS_TOKEN` (ADR-0031). |
| **OpenRouter** | Gateway de IA compatível com OpenAI SDK. Copy + Vision (ADR-0010). |
| **Telegram** | Canal de alertas operacionais (moderação, vendas, perguntas, liberações) (ADR-0035). |
