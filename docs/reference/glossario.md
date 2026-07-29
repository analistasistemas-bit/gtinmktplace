# Glossário — Linguagem ubíqua do PubliAI

> **Tipo:** Reference (Diátaxis). Fonte única dos termos do domínio. Sempre que um termo
> aparecer em código, ADR, doc ou conversa, deve significar o que está aqui. Mudou o
> significado? Atualize este arquivo no mesmo PR.

## Domínio de produto

| Termo | Definição |
|---|---|
| **Lote** | Um conjunto de produtos que entra no sistema junto e inicia o pipeline que cria famílias e variações. Exibido como "Lote #N" (`lotes.numero`). Duas origens (`lotes.origem`): **planilha** (upload de planilha + imagens, o caminho histórico) e **manual** (uma sessão de cadastro pela UI) — ADR-0094, em design. |
| **Cadastro manual de produto** | Criar família + variações direto na UI, sem planilha, para organização que não tem ERP. Uma sessão de cadastro grava um **lote manual** e segue pelo mesmo pipeline (IA de atributos → Revisão → publicação) — o cadastro é uma segunda **origem** de produto, nunca um modelo de dados paralelo. Disponível só com o módulo habilitado. ADR-0094 (em design). |
| **Família** | Um PAI = um produto único que vira **1 anúncio** no marketplace com N variações. Agrega metadados, resultado da IA e estado de publicação. Tabela `familias`. |
| **Variação** | Um SKU/cor dentro da família = **1 variação** do anúncio. Tem preço, estoque, dimensões, cor e foto próprios. Tabela `variacoes`. |
| **PAI** | Coluna da planilha que agrupa variações. `PAI = 0` marca o **agrupador** (a própria família), **nunca um item vendável**. Os filhos referenciam o código do pai. |
| **CODIGO** | Identificador do item na planilha. Da família = `codigo_pai`; da variação = `codigo`. Único dentro do seu escopo. |
| **GTIN / EAN** | Código de barras do produto. Usado para vínculo de catálogo no ML e para atribuir vendas ao produto (`variacoes.gtin`). |
| **Aviamento** | Categoria de produto do MVP: linha, botão, fita, cola, cursor, outro (`tipo_aviamento`). Primeiro escopo do produto (ADR-0002). |
| **Cursor** | Tipo de aviamento: deslizador/puxador de zíper sem trava automática. Override determinístico → categoria ML "Zíperes" (`MLB271227`), sem depender do preditor/IA de categoria (ADR-0083). |
| **ORIGEM** | Coluna **opcional** da planilha (lida só da linha PAI): `NACIONAL`/`IMPORTADO`, procedência do produto e base do imposto sobre a venda. Ausente/vazio/inválido → `nacional`. Grava `familias.origem` (enum `origem_produto`). ⚠️ Distinto de `tipo_origem` (origem da **categorização ML**: regex/ia/manual/preditor) — conceitos não relacionados (ADR-0055). |
| **Alíquota de imposto** | Percentual de imposto sobre o preço de venda, parametrizável por origem em Configurações (`configuracoes.aliquota_nacional_pct` default 8%, `aliquota_importado_pct` default 16%). Descontado do líquido junto com comissão e frete, e somado ao gross-up do preço sugerido (ADR-0055). |
| **Preço-líder (de referência)** | Preço do concorrente MercadoLíder com **MAIS VENDAS** de uma família (não o menor preço). Base da re-âncora quando o preço competitivo dá prejuízo (ADR-0065). |
| **Re-âncora (de preço)** | Trocar a base do preço competitivo de `menor_preço` para o **preço-líder (de referência)** quando o preço competitivo deixa o líquido Clássico < custo (prejuízo real, 🔴). Gated pelo toggle `configuracoes.reancora_lider_ativa`; sinalizada por `familias.preco_reancorado_lider` + selo. Nunca sobe acima do preço-líder nem faz gross-up no ramo competitivo (ADR-0065). |

## Lifecycle e operações

| Termo | Definição |
|---|---|
| **CREATE** | Operação que cria um anúncio novo no marketplace (`operacao_ml = CREATE`). |
| **UPDATE** | Operação que atualiza um anúncio existente — reposição de estoque, preço ou cor nova (`operacao_ml = UPDATE`). Ver ADR-0005, ADR-0016. |
| **Revisão humana** | Etapa obrigatória entre processamento e publicação. Nenhum anúncio vai ao ar sem aprovação do operador (regra inegociável). O atalho **Atualização rápida de estoque** agrupa essa aprovação num único clique para o subconjunto sem pendência — nunca a elimina (ADR-0089). |
| **Atualização rápida de estoque** | Atalho de 1-clique em `Progresso.tsx`, ao fim do processamento do lote: publica automaticamente, com preço sempre ignorado (`somente_estoque=true`), só as famílias `UPDATE` sem nenhuma pendência (`familiaPublicavel`) **e** sem nenhuma cor nova ainda não casada no ML (mesmo completa — não basta estar tecnicamente pronta). Nunca inclui `CREATE`. `/relatorio/{loteId}` destaca variações e famílias que zeraram estoque nesta rodada (ADR-0089). |
| **Reprocessar** | Re-enfileirar uma família travada em `erro` resetando o status para `pendente` (ADR-0030, função `reprocessar-familia`). |
| **Pausar / Reativar** | Alterna a visibilidade de um anúncio já publicado no marketplace (`ativo` ⇄ `pausado`) sem afetar o vínculo local de UPDATE nem os dados do produto. Ação restrita a admin, feita via `ChannelConnector.atualizarStatus` (ADR-0060). Distinto de "Remover" (que só apaga o vínculo local; o anúncio no ML continua ativo). |
| **Publicável / viabilidade** | Conjunto de checagens (foto, cor, preço, categoria) que liberam ou bloqueiam a publicação. Fonte única em `src/lib/publicavel.ts`. |

## Estoque

> ADR-0094 (em design) — ver `docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md`.

| Termo | Definição |
|---|---|
| **Estoque canônico** | O saldo de verdade de um SKU na organização: `variacoes.estoque` da **família mais recente** do `(org_id, codigo)` — mesma âncora do dedupe de Publicados (ADR-0025). Não existe tabela de saldo separada. |
| **Movimento de estoque** | Registro imutável de toda alteração de saldo (`estoque_movimentos`): quem, quando, quanto, por quê e qual saldo resultou. Idempotente por `(org_id, referencia_externa)` — a mesma venda nunca baixa duas vezes. É a trilha de auditoria do estoque. |
| **Entrada de mercadoria** | Movimento positivo lançado pelo operador ao receber mercadoria: quantidade + custo unitário + documento. Soma no estoque canônico e **sobrescreve** `variacoes.custo` com o último custo. Não confundir com **UPDATE de estoque**, que é a publicação do saldo no marketplace. |
| **Baixa de estoque** | Movimento negativo automático na transição para pedido **pago** (gancho `novaPaga` do `sync-venda`). Nunca deixa o saldo negativo (`greatest(0, …)`) e **nunca** faz a venda falhar. Vale para toda organização, com ou sem o módulo. |
| **Ajuste manual** | Movimento gerado quando um humano edita `variacoes.estoque` direto na UI. Registrado no ledger com a diferença aplicada, sem referência de idempotência. |
| **Estorno de venda** | Movimento positivo que repõe o saldo quando um pedido é **cancelado antes do despacho** (mercadoria nunca saiu). **Devolução não repõe** automaticamente: só notifica, porque repor exige conferir o que voltou e em que estado. |
| **Push de estoque** | Propagação do saldo para os marketplaces onde o produto está publicado, sempre por **valor absoluto** (nunca delta), em fila serial por organização. Entrada e ajuste propagam para todos os canais; baixa por venda propaga para todos **menos** o canal de origem, que já se decrementou sozinho. |
| **Módulo** | Funcionalidade opcional habilitada por organização pelo super-admin (`organizations.modulos_habilitados`), espelhando `canais_habilitados`. Gate em dois níveis: esconde o menu **e** bloqueia a edge — diferente de **permissão de menu**, que é só navegação. |

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
| **Canal** | Um marketplace de destino. Abstraído pela camada de conectores no backend (ADR-0024); hoje só Mercado Livre tem conector implementado (`canal_externo` segue com 1 valor). |
| **Registry de canais (UI)** | `src/lib/canais.ts` (frontend, spec 2026-07-14 "menus multicanal"): os 5 marketplaces do roadmap (Mercado Livre `ativo`; Shopee/Magalu/Amazon/Casas Bahia `em_breve`, vitrine sem conector real). Cruza com `organizations.canais_habilitados` (por org) para decidir o que a org pode operar. **Não confundir** com o registry de conectores do backend (`_shared/canais/registry.ts`) — são independentes; canal novo exige entrada nos dois. |
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
| **MP** | Mercado Pago. Origem de **estorno** e **data de liberação** por pagamento. O **líquido não vem do MP** — é calculado como `bruto − comissão − frete real` (ADR-0042). Não existe "conexão do Mercado Pago": a conta MP do vendedor é lida com o token da conexão `mercado_livre` da própria org (ADR-0093, substitui o `MP_ACCESS_TOKEN` do ADR-0031). |
| **OpenRouter** | Gateway de IA compatível com OpenAI SDK. Copy + Vision (ADR-0010). |
| **Telegram** | Canal de alertas operacionais (moderação, vendas, perguntas, liberações). Um **bot por organização** (`configuracoes.telegram_bot_token` + `telegram_ativo` como interruptor-mestre); os destinos são por pessoa (ADR-0035, ADR-0068). |
| **Destinatário de notificação** | Um `profile` da org com `telegram_chat_id` preenchido que recebe as **categorias** assinadas em `profiles.telegram_categorias`. Gerenciado só por admin, na tela Usuários (edge `usuarios`, action `update_notificacoes`). Sem `chat_id` ou fora do interruptor-mestre da org → não recebe. ADR-0068. |
| **Categoria de notificação** | Eixo de assinatura das notificações Telegram. Cinco fixas: `vendas`, `perguntas`, `pos_venda`, `financeiro`, `moderacao` (esta agrupa anúncio moderado + catálogo sem match). Fonte canônica em `_shared/notificacoes/categorias.ts`, espelhada no front. ADR-0068. |

## Acesso e usuários

| Termo | Definição |
|---|---|
| **Operadora da plataforma** | Empresa proprietária e administradora do SaaS. É a **Daludi**. Não é tenant, não possui operação de marketplace e não deve existir como organização cliente fictícia. ADR-0092 (em discussão). |
| **Organização / Org** | O tenant no SaaS: uma empresa **cliente** do PubliAI. Isola 100% dos dados (`organizations`, `org_id` em toda tabela de domínio + storage). Avil é o primeiro cliente, não a proprietária da plataforma. No modelo atual, cada usuário pertence a exatamente 1 org (`profiles.org_id`, sem trocar). ADR-0027; distinção institucional refinada no ADR-0092 (em discussão). |
| **Organização de teste operacional** | Tenant permanente usado para exercitar a operação real com uma conta de marketplace de teste ou particular. Continua sujeito ao mesmo isolamento dos clientes, aparece identificada como **Teste** no painel e não representa a operadora da plataforma. A DSA (`diego-souza`), administrada por `analistasistemas@icloud.com`, cumpre esse papel. ADR-0092 (em discussão). |
| **Operação compartilhada** | Dentro de uma organização, todos os membros enxergam e operam os **mesmos** dados (lotes, anúncios, faturamento) — não há papéis finos por usuário, só `is_admin`. Decisão registrada em ADR-0047; o isolamento **entre** organizações é o `org_id` do ADR-0027. |
| **Super-admin / Administrador da plataforma** | Identidade exclusiva da Daludi para administrar o SaaS. Não pertence permanentemente a uma organização cliente nem acessa sua operação por padrão. A identidade definida é Diego Souza (`diego@daludi.com.br`); acesso a tenant ocorre somente em contexto excepcional de suporte. ADR-0092 (em discussão). |
| **Solicitação de suporte** | Pedido do administrador da plataforma para entrar na operação de uma organização cliente. Declara motivo e escopo — somente leitura ou acesso total — e exige aprovação de um admin ativo do cliente antes de liberar qualquer dado operacional. ADR-0092 (em discussão). |
| **Sessão de suporte** | Entrada temporária, explícita, autorizada e auditável de um administrador da plataforma no contexto operacional de uma organização cliente. Pode ter escopo somente leitura ou acesso total; ambos valem por até 2 horas e exigem nova aprovação para renovar. Não equivale a associação permanente nem transforma o administrador em membro do cliente. Expiração, saída ou revogação encerram todo o acesso. ADR-0092 (em discussão). |
| **Acesso total de suporte** | Escopo de sessão que permite mutações. Exige solicitação e aprovação explícitas, vale por até 2 horas e pode ser renovado em blocos de 2 horas, sempre com nova aprovação. Sem autorização vigente, o backend bloqueia leitura e escrita da operação. ADR-0092 (em discussão). |
| **Histórico de suporte** | Trilha de auditoria que registra sessões, motivos, autorizações e ações mutáveis realizadas pelo suporte, sem copiar segredos ou payloads integrais. Admins do cliente enxergam apenas o histórico da própria organização. Retenção normal de 1 ano, salvo bloqueio por investigação em andamento. ADR-0092 (em discussão). |
| **current_org_id()** | Função SQL `SECURITY DEFINER STABLE` — pivô do isolamento por organização. Devolve a `org_id` do chamador autenticado ativo (`profiles.is_active`); toda policy de RLS das tabelas de domínio + storage usa `org_id = (select current_org_id())`. Cacheada 1× por statement (initplan). ADR-0027. |
| **Marketplace connection** | Credencial de um canal (ex.: OAuth do Mercado Livre) pertencente a uma **organização**, não a um usuário. Tabela `marketplace_connections`, única por `(org_id, canal)`; substitui `ml_credentials` (deprecada) — qualquer membro da org publica com a mesma conexão. ADR-0027 (D-E7.4). |
| **Usuário / Membro** | Conta de login no Supabase Auth pertencente a uma organização. Espelhada em `public.profiles` (`org_id`, `is_admin`, `is_super_admin`, `is_active`, `allowed_menus`, `email`, `nome`). |
| **Admin** | Usuário com `profiles.is_admin = true`. Gerencia usuários **da própria organização** (criar, editar menus, ativar/desativar, promover outros admins) e enxerga **todos** os menus, independentemente de `allowed_menus`. |
| **Permissão de menu** | Conjunto de menus que um usuário **não-admin** pode ver e acessar (`profiles.allowed_menus`, array de chaves de menu). Trava em dois níveis: esconde no sidebar e bloqueia a rota. Não é trava de backend (ver ADR-0047). |
| **Chave de menu** | Identificador estável de um item de navegação (`dashboard`, `lotes`, `revisao`, `publicados`, `faturamento`, `financeiro`, `viabilidade`, `configuracoes`). `usuarios` é um menu extra exclusivo de admin, não atribuível. `organizacoes` é exclusivo de super-admin. |
