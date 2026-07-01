---
tags: [home, glossario]
atualizado: 2026-07-01
---

# Glossário

Espelho do glossário oficial em `docs/reference/glossario.md` (fonte de verdade — atualize lá
primeiro). Aqui os termos ganham links internos do vault.

## Domínio de produto

| Termo | Definição |
|---|---|
| **Lote** | Um upload de planilha + imagens. Inicia o pipeline que cria famílias e variações. Ver [[Upload Planilha]]. |
| **Família** | Um PAI = um produto único que vira **1 anúncio** com N variações. Tabela `familias`. Ver [[Produtos]]. |
| **Variação** | Um SKU/cor dentro da família = **1 variação** do anúncio. Tabela `variacoes`. |
| **PAI** | Coluna da planilha que agrupa variações. `PAI = 0` marca o agrupador, nunca um item vendável. |
| **CODIGO** | Identificador do item na planilha. Da família = `codigo_pai`; da variação = `codigo`. |
| **GTIN / EAN** | Código de barras. Usado para vínculo de catálogo no ML e atribuição de vendas. |
| **Aviamento** | Categoria de produto do MVP: linha, botão, fita, cola, outro (`tipo_aviamento`). |

## Lifecycle e operações

| Termo | Definição |
|---|---|
| **CREATE** | Cria um anúncio novo (`operacao_ml = CREATE`). Ver [[Publicação Mercado Livre]]. |
| **UPDATE** | Atualiza anúncio existente — estoque, preço ou cor nova (`operacao_ml = UPDATE`). |
| **Revisão humana** | Etapa obrigatória entre processamento e publicação. Regra inegociável do projeto. |
| **Reprocessar** | Re-enfileira uma família travada em `erro`, resetando para `pendente`. |
| **Publicável / viabilidade** | Checagens (foto, cor, preço, categoria) que liberam/bloqueiam a publicação (`src/lib/publicavel.ts`). |

## Multicanal

| Termo | Definição |
|---|---|
| **Canal** | Um marketplace de destino (hoje só Mercado Livre). Abstraído pelo [[Integrações\|conector de canal]]. |
| **Conector (ChannelConnector)** | Interface única de operações de anúncio por canal (`_shared/canais/`). |
| **Anúncio externo** | Espelho normalizado de produto-canal, identidade `(user_id, canal, codigo_pai)`. Tabela `anuncios_externos`. |
| **Dual-write** | Workers gravam em `familias`/`variacoes` (fonte de verdade hoje) e em `anuncios_externos` (espelho). |
| **Catálogo (ML)** | Ficha oficial de produto do ML. Vínculo opt-in via GTIN. |

## Infraestrutura

| Termo | Definição |
|---|---|
| **Edge Function** | Função Deno serverless no Supabase. Devem ser idempotentes. Ver [[Edge Functions]]. |
| **QStash** | Fila assíncrona da Upstash, com retry automático. Orquestra os workers. |
| **Worker** | Edge Function disparada pelo QStash, autentica por assinatura QStash (não JWT). |
| **Redis** | Cache + locks distribuídos da Upstash (cor, concorrência, tarifa; lock de refresh de token). |
| **Vault (Supabase)** | Cofre criptografado onde ficam os tokens OAuth do ML. Tokens nunca em texto puro. |
| **RLS** | Row Level Security do Postgres. Ver [[Segurança]]. |
| **verify_jwt** | Flag por função no `config.toml`. `true` = exige JWT Supabase; `false` = função pública que autentica por conta própria. |

## Integrações externas

| Termo | Definição |
|---|---|
| **ML** | Mercado Livre. Marketplace primário. OAuth 2.0, API de items, webhooks. Ver [[Integrações]]. |
| **MP** | Mercado Pago. Origem dos dados financeiros (líquido, liberação). |
| **OpenRouter** | Gateway de IA compatível com OpenAI SDK. Copy + Vision. Ver [[IA]]. |
| **Telegram** | Canal de alertas operacionais (moderação, vendas, perguntas, liberações). |

## Acesso e usuários

| Termo | Definição |
|---|---|
| **Operação compartilhada** | Tenant único atual: todos os usuários autenticados veem/operam os mesmos dados. Isolamento por `org_id` chega no `E7`. |
| **Admin** | Usuário com `profiles.is_admin = true`. Gerencia usuários e enxerga todos os menus. |
| **Permissão de menu** | Menus que um usuário não-admin pode ver/acessar (`profiles.allowed_menus`). Ver [[Usuários]]. |
