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
| **ORIGEM** | Coluna **opcional** da planilha (lida só da linha PAI): `NACIONAL`/`IMPORTADO`, procedência do produto e base do imposto sobre a venda. Ausente/vazio/inválido → `nacional`. Grava `familias.origem` (enum `origem_produto`). ⚠️ Distinto de `tipo_origem` (origem da **categorização ML**: regex/ia/manual/preditor) — conceitos não relacionados (ADR-0055). |
| **Alíquota de imposto** | Percentual de imposto sobre o preço de venda, parametrizável por origem em Configurações (`configuracoes.aliquota_nacional_pct` default 8%, `aliquota_importado_pct` default 16%). Descontado do líquido junto com comissão e frete, e somado ao gross-up do preço sugerido (ADR-0055). |

## Lifecycle e operações

| Termo | Definição |
|---|---|
| **CREATE** | Operação que cria um anúncio novo no marketplace (`operacao_ml = CREATE`). |
| **UPDATE** | Operação que atualiza um anúncio existente — reposição de estoque, preço ou cor nova (`operacao_ml = UPDATE`). Ver ADR-0005, ADR-0016. |
| **Revisão humana** | Etapa obrigatória entre processamento e publicação. Nenhum anúncio vai ao ar sem aprovação do operador (regra inegociável). |
| **Reprocessar** | Re-enfileirar uma família travada em `erro` resetando o status para `pendente` (ADR-0030, função `reprocessar-familia`). |
| **Pausar / Reativar** | Alterna a visibilidade de um anúncio já publicado no marketplace (`ativo` ⇄ `pausado`) sem afetar o vínculo local de UPDATE nem os dados do produto. Ação restrita a admin, feita via `ChannelConnector.atualizarStatus` (ADR-0060). Distinto de "Remover" (que só apaga o vínculo local; o anúncio no ML continua ativo). |
| **Publicável / viabilidade** | Conjunto de checagens (foto, cor, preço, categoria) que liberam ou bloqueiam a publicação. Fonte única em `src/lib/publicavel.ts`. |

## Estados (enums)

| Enum | Valores | Onde |
|---|---|---|
| `lote_status` | `importando`, `processando`, `revisao`, `publicando`, `concluido`, `erro` | `lotes.status` |
| `familia_status` | `pendente`, `processando`, `pronto`, `publicando`, `publicado`, `erro` | `familias.status` |
| `operacao_ml` | `CREATE`, `UPDATE` | `familias.operacao` |
| `tipo_aviamento` | `linha`, `botao`, `fita`, `cola`, `outro` | `familias.tipo_aviamento` |
| `tipo_origem` | `regex`, `ia`, `manual`, `preditor`, `generico` | origem da categorização |
| `origem_produto` | `nacional`, `importado` | `familias.origem` (procedência p/ imposto) |
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
| **RLS** | Row Level Security do Postgres. As tabelas de domínio liberam leitura/escrita ao membro cuja `org_id` bate com a do chamador (`org_id = current_org_id()`, isolamento por organização, ADR-0027, E7); `user_id` permanece como `criado_por` (auditoria). Substitui a fase de operação compartilhada (ADR-0047), cujo `is_membro_operacao()` foi dropado. |
| **verify_jwt** | Flag por função no `config.toml`. `true` = o gateway exige JWT Supabase válido; `false` = função pública que autentica por conta própria (assinatura QStash, webhook, ou JWT manual). |

## Integrações externas

| Termo | Definição |
|---|---|
| **ML** | Mercado Livre. Marketplace primário. OAuth 2.0, API de items, webhooks. |
| **MP** | Mercado Pago. Origem dos dados financeiros (líquido, liberação). Token único em `MP_ACCESS_TOKEN` (ADR-0031). |
| **OpenRouter** | Gateway de IA compatível com OpenAI SDK. Copy + Vision (ADR-0010). |
| **Telegram** | Canal de alertas operacionais (moderação, vendas, perguntas, liberações) (ADR-0035). |

## Acesso e usuários

| Termo | Definição |
|---|---|
| **Organização / Org** | O tenant no SaaS: uma empresa cliente do PubliAI. Isola 100% dos dados (`organizations`, `org_id` em toda tabela de domínio + storage). Hoje 1 org (**Avil**, dona de todos os dados anteriores ao E7). Cada usuário pertence a exatamente 1 org (`profiles.org_id`, sem trocar). Decisão registrada em ADR-0027 (E7). |
| **Operação compartilhada** | Dentro de uma organização, todos os membros enxergam e operam os **mesmos** dados (lotes, anúncios, faturamento) — não há papéis finos por usuário, só `is_admin`. Decisão registrada em ADR-0047; o isolamento **entre** organizações é o `org_id` do ADR-0027. |
| **Super-admin** | `profiles.is_super_admin = true` — hoje só Diego. Único papel que cria organizações novas (edge `usuarios`, actions `create_org`/`list_orgs`, página `/organizacoes`). Sem self-service até o E8 (billing). ADR-0027 (D-E7.8). |
| **current_org_id()** | Função SQL `SECURITY DEFINER STABLE` — pivô do isolamento por organização. Devolve a `org_id` do chamador autenticado ativo (`profiles.is_active`); toda policy de RLS das tabelas de domínio + storage usa `org_id = (select current_org_id())`. Cacheada 1× por statement (initplan). ADR-0027. |
| **Marketplace connection** | Credencial de um canal (ex.: OAuth do Mercado Livre) pertencente a uma **organização**, não a um usuário. Tabela `marketplace_connections`, única por `(org_id, canal)`; substitui `ml_credentials` (deprecada) — qualquer membro da org publica com a mesma conexão. ADR-0027 (D-E7.4). |
| **Usuário / Membro** | Conta de login no Supabase Auth pertencente a uma organização. Espelhada em `public.profiles` (`org_id`, `is_admin`, `is_super_admin`, `is_active`, `allowed_menus`, `email`, `nome`). |
| **Admin** | Usuário com `profiles.is_admin = true`. Gerencia usuários **da própria organização** (criar, editar menus, ativar/desativar, promover outros admins) e enxerga **todos** os menus, independentemente de `allowed_menus`. |
| **Permissão de menu** | Conjunto de menus que um usuário **não-admin** pode ver e acessar (`profiles.allowed_menus`, array de chaves de menu). Trava em dois níveis: esconde no sidebar e bloqueia a rota. Não é trava de backend (ver ADR-0047). |
| **Chave de menu** | Identificador estável de um item de navegação (`dashboard`, `lotes`, `revisao`, `publicados`, `faturamento`, `financeiro`, `viabilidade`, `configuracoes`). `usuarios` é um menu extra exclusivo de admin, não atribuível. `organizacoes` é exclusivo de super-admin. |
