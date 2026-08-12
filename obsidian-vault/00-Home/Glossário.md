---
tags: [home, glossario]
atualizado: 2026-08-11
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
| **Aviamento** | Categoria de produto do MVP: linha, botão, fita, cola, cursor, outro (`tipo_aviamento`). |

## Lifecycle e operações

| Termo | Definição |
|---|---|
| **CREATE** | Cria um anúncio novo (`operacao_ml = CREATE`). Ver [[Publicação Mercado Livre]]. |
| **UPDATE** | Atualiza anúncio existente — estoque, preço ou cor nova (`operacao_ml = UPDATE`). |
| **Revisão humana** | Etapa obrigatória entre processamento e publicação. Regra inegociável do projeto. |
| **Reprocessar** | Re-enfileira uma família travada em `erro`, resetando para `pendente`. |
| **Publicável / viabilidade** | Checagens (foto, cor, preço, categoria) que liberam/bloqueiam a publicação (`src/lib/publicavel.ts`). |

## Estoque

| Termo | Definição |
|---|---|
| **Estoque canônico** | O saldo de verdade de um SKU na org: `variacoes.estoque` da família **mais recente** do `(org_id, codigo)` — mesma âncora do dedupe de Publicados (ADR-0025). Não há tabela de saldo separada. Ver [[Estoque]]. |
| **Movimento de estoque** | Registro imutável de toda alteração de saldo (`estoque_movimentos`), idempotente por `(org_id, referencia_externa)`. Trilha de auditoria. |
| **Entrada de mercadoria** | Movimento positivo com quantidade + custo + documento (RPC `registrar_entrada`, edge `entrada-estoque`). Único caminho para **aumentar** saldo. |
| **Baixa de estoque** | Movimento negativo automático em todo pedido **pago**. Nunca deixa saldo negativo, nunca faz a venda falhar. |
| **Estorno de venda** | Movimento positivo em cancelamento **pré-despacho**. Devolução não é tocada. |
| **Ajuste (zeragem)** | Movimento que **só reduz ou zera**, admin-only (ADR-0110). Aumentar exige Entrada. É o caminho correto para "acabou essa cor" — nunca zerar direto no canal. |
| **Push de estoque** | Propagação do saldo por **valor absoluto** (nunca delta), em fila serial `estoque-{orgId}`. Venda não ecoa para o canal de origem. |
| **Reconciliação de estoque** | Job diário (`30 12 * * *`), rede de segurança do **push**: só re-empurra produto com movimento no ledger. |
| **Reativação por reposição** | Push de reposição com saldo > 0 devolve o anúncio de `pausado` para `ativo` (ADR-0111). Nunca toca `moderado`/`encerrado`/`inativo`/`indisponivel`. |
| **Módulo** | Funcionalidade **paga** por org (`organizations.modulos_habilitados`). Gate duplo: esconde o menu **e** a edge recusa com 403. |
| **Cadastro manual** | Criar produto pela UI, sem planilha (`lotes.origem='manual'`), caindo na mesma Revisão. |

## Financeiro e imposto

| Termo | Definição |
|---|---|
| **Custo congelado** | O custo do item é copiado para `venda_item_custo` no primeiro sync da venda e não muda mais (insert-once + trigger que faz `UPDATE` falhar, ADR-0109). Planilha nova só afeta vendas posteriores. Ver [[Faturamento]]. |
| **Custo vigente** | Resolvido pela cadeia `variação → anúncio → GTIN → código`, com desempate pela linha **mais recente** (`atualizado_em`, ADR-0108) — não pela de maior custo. |
| **Alíquota por origem** | 8% nacional / 16% importado, por org, exigindo confirmação explícita (ADR-0055/0086). Nunca defaulta em silêncio. |
| **Alíquota interna** | Alíquota de venda **dentro da UF da empresa** (`uf_empresa` + `aliquota_interna_pct`, ADR-0112). **Sobrepõe a origem** e vale só na apuração pós-venda — preço sugerido e gross-up seguem na origem. Ver [[Configurações]]. |
| **Devolução (concluída)** | `type = 'returns'` **e** `return_status_money = 'refunded'`. Conta no período em que o **estorno saiu** (`fechado_em`), não no da abertura do claim (ADR-0106). |

## Multicanal

| Termo | Definição |
|---|---|
| **Canal** | Um marketplace de destino (hoje só Mercado Livre). Abstraído pelo conector de canal — ver [[Integrações]]. |
| **Conector (ChannelConnector)** | Interface única de operações de anúncio por canal (`_shared/canais/`). |
| **Anúncio externo** | Espelho normalizado de produto-canal, identidade `(org_id, canal, codigo_pai, particao)`. Tabela `anuncios_externos`. |
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
| **MP** | Mercado Pago. Origem de **estorno** e **data de liberação** por pagamento. O **líquido não vem do MP** — é `bruto − comissão − frete real` (ADR-0042). Não existe "conexão do Mercado Pago": a conta MP é lida com o token da conexão `mercado_livre` da própria org (ADR-0093). |
| **OpenRouter** | Gateway de IA compatível com OpenAI SDK. Copy + Vision. Ver [[IA]]. |
| **Telegram** | Canal de alertas operacionais (moderação, vendas, perguntas, liberações). |

## Acesso e usuários

| Termo | Definição |
|---|---|
| **Operação compartilhada** | Dentro de uma organização, todos os membros veem/operam os mesmos dados. Organizações são isoladas por `org_id`. |
| **Admin** | Usuário com `profiles.is_admin = true`. Gerencia usuários e enxerga todos os menus. |
| **Permissão de menu** | Menus que um usuário não-admin pode ver/acessar (`profiles.allowed_menus`). Ver [[Usuários]]. |
