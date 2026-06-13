# Evolução PubliAI → SaaS multicanal — Documento mestre

**Data:** 2026-06-13
**Status:** Aprovado (forma e ordem do roadmap aprovadas por Diego em 2026-06-13)
**Tipo:** North-star + arquitetura-alvo + decomposição em épicos/subtarefas (documento vivo)
**Decisores:** Diego
**Embasamento:** pesquisa de fundações multi-agente (6 frentes, 2026-06-13) + mapeamento do código atual

> Este é o documento **guarda-chuva** da evolução. Cada épico abaixo vira seu próprio
> `spec → plano → subagent-driven` quando for iniciado, e cada decisão não-trivial vira um ADR
> (stubs 0024–0028 já criados). A ordem é incremental ("evoluir aos poucos"), estilo *strangler fig*,
> sem nenhum *big-bang* e sem quebrar o que já fatura no Mercado Livre.

---

## 1. North-star

> **"Publique qualquer produto em todos os marketplaces a partir de uma fonte única — com IA que escreve, categoriza e precifica por canal."**

O mercado de "hub de integração" (Bling, Olist/Tiny, ANYMARKET, Plugg.to, IDERIS, Hub2b) já é
saturado e comoditizado em **sincronização**. O diferencial defensável do PubliAI é o que ele **já faz
melhor que esses hubs**: **criação de anúncio assistida por IA** — copywriter (GPT-4o-mini), Vision
para cor, e **precificação inteligente por comissão** (o "Smart Pricing"/"calculadora de preço" que
IDERIS e ANYMARKET vendem como feature premium, e que o PubliAI já implementa nos ADR-0020/0023:
líquido mínimo após comissão, gross-up acima do abismo de tarifa fixa).

**Posicionamento:** não "mais um integrador", mas **"o jeito mais rápido de criar bons anúncios, em
qualquer marketplace, com IA"**. Sincronização de estoque/preço/pedido é tabela-de-aposta (precisa
existir), não o herói.

**Público-alvo de comercialização:** lojistas PME brasileiros (qualquer segmento, qualquer produto),
self-serve. Começamos validando no nosso próprio uso interno (Daludi/AVILBV, aviamentos no ML) e
expandimos.

---

## 2. De onde partimos (estado atual, 2026-06-13)

| Dimensão | Estado hoje | Implicação para o SaaS |
|---|---|---|
| **Canais** | 1 (Mercado Livre), `_shared/ml/` com 18 arquivos ML-específicos | Precisa de camada de abstração antes do 2º canal |
| **Tenancy** | Single-operador. RLS por `user_id`→`auth.users`; sem org/plano/billing | Precisa de `organizations` + `org_id` (aditivo) |
| **Produto** | Domínio fechado em aviamentos: categoria/cor/atributos **determinísticos por nicho** (regex `linha|fita|botão|cola` → categoria MLB fixa) | Precisa de IA híbrida p/ "qualquer produto" |
| **Modelo de dados** | 4 tabelas (`lotes`, `familias`, `variacoes`, `ml_credentials`); estado de publicação **dentro** de `familias`/`variacoes` (`ml_item_id`, `ml_variation_id`, `categoria_ml_id`, `atributos_ml`, `catalog_*`) | 1 família = 1 anúncio ML → precisa de `anuncios_externos` (1 família → N anúncios) |
| **Orquestração** | QStash com alvo fixo por worker (`enfileirarPublicacao → publish-familia-ml`); claim atômico; idempotência por `ml_item_id`; reconciliação por polling (`status-publicados`) | Base sólida — generaliza para fan-out por `(família, canal)` |
| **Pontos fortes a capitalizar** | Copy IA, Vision, **Smart Pricing** (ADR-0020/0023), revisão humana, taxonomia de erro (`humanizarErroML`/`ehErroRetentavel`), opt-in catálogo por GTIN (ADR-0021) | São o diferencial de produto; generalizar por canal |

**Veredito da pesquisa (camada de abstração):** o acoplamento ao ML é **estrutural mas fino e bem
isolado** — a lógica de canal já vive em `_shared/ml/*` e os workers só orquestram. É praticamente um
*adapter implícito*; falta extrair a "porta" (interface) na frente dele. O domínio
(`familias`/`variacoes`) já é canônico e neutro de canal. **Isso torna o strangler fig barato.**

---

## 3. Arquitetura-alvo

### 3.1 As 3 camadas (padrão validado em todos os integradores pesquisados)

```
┌─────────────────────────────────────────────────────────────┐
│  CAMADA 1 — PRODUTO CANÔNICO (PIM)                            │
│  Fonte única da verdade, AGNÓSTICA de canal.                 │
│  Hoje: familias + variacoes (já são isto). Limpar os ml_*.   │
│  Carrega: título/descrição/marca, SKUs, EAN, custo, preço-   │
│  base, estoque, fotos, dimensões, taxonomia canônica.        │
└───────────────────────────┬─────────────────────────────────┘
                            │  mapeadores (Anti-Corruption Layer por canal)
┌───────────────────────────▼─────────────────────────────────┐
│  CAMADA 2 — LISTING POR CANAL                                │
│  Nova tabela `anuncios_externos` (1 família → N anúncios):   │
│  (familia_id, canal, item_externo_id, variacao_externa_id,   │
│   status, atributos_canal JSONB, preco_override, erro)       │
│  Overrides por canal sem duplicar o produto canônico.        │
└───────────────────────────┬─────────────────────────────────┘
                            │  ChannelConnector (Ports & Adapters + registry)
┌───────────────────────────▼─────────────────────────────────┐
│  CAMADA 3 — CONECTORES                                       │
│  Mercado Livre (1º, DELEGA ao _shared/ml atual — zero        │
│  reescrita) │ Shopee │ Amazon │ Magalu │ …                   │
│  Cada um declara `capabilities` (variações? GTIN? catálogo?  │
│  descrição separada? pedidos?).                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 O contrato do conector (esboço, da pesquisa)

```ts
// _shared/canais/contrato.ts
export type CanalId = 'mercado_livre' | 'shopee' | 'amazon' | 'magalu';

export interface Capabilities {
  variacoes: boolean;          // ML=true; canais "flat"=false
  gtinObrigatorio: boolean;
  descricaoSeparada: boolean;  // ML=true (recurso /description à parte)
  catalogo: boolean;           // ML=true (buybox); outros=false
  atualizarEstoque: boolean;
  atualizarPreco: boolean;
  lerStatus: boolean;
  lerPedidos: boolean;         // opcional no MVP
  desconto: boolean;
}

export interface ChannelConnector {
  readonly id: CanalId;
  readonly capabilities: Capabilities;
  criarAnuncio(p: AnuncioCanonico, ctx: ContextoCanal): Promise<ResultadoCanal<RefAnuncio>>;
  atualizarAnuncio(ref: RefAnuncio, p: AnuncioCanonico, ctx: ContextoCanal): Promise<ResultadoCanal<RefAnuncio>>;
  atualizarEstoque(ref: RefAnuncio, est: EstoquePorSku[], ctx: ContextoCanal): Promise<ResultadoCanal<void>>;
  atualizarPreco(ref: RefAnuncio, pr: PrecoPorSku[], ctx: ContextoCanal): Promise<ResultadoCanal<void>>;
  lerStatus(ref: RefAnuncio, ctx: ContextoCanal): Promise<ResultadoCanal<StatusCanonico>>;
  mapearCategoria(p: AnuncioCanonico, ctx: ContextoCanal): Promise<ResultadoCanal<CategoriaCanal>>;
  mapearAtributos(p: AnuncioCanonico, cat: CategoriaCanal): ResultadoCanal<AtributoCanal[]>;
  lerPedidos?(desde: string, ctx: ContextoCanal): Promise<ResultadoCanal<PedidoCanonico[]>>;
}
```

O núcleo do app passa a falar **só** o `AnuncioCanonico` + a interface. Idiossincrasias do ML
(`listing_type_id` gold_special/gold_pro, `EMPTY_GTIN_REASON`, catálogo/buybox, descrição como
recurso separado) ficam **dentro** do `MercadoLivreConnector`, nunca sobem ao modelo canônico
(o canônico carrega *intenção* — ex.: `desconto:{pct}` — não o *mecanismo* do canal).

### 3.3 Taxonomia de erros unificada

Generaliza o que já existe (`humanizarErroML`/`ehErroRetentavel`):

```ts
export type ErroCanalCodigo =
  | 'TITULO' | 'FOTO' | 'PRECO' | 'GTIN' | 'ATRIBUTO' | 'VARIACAO'
  | 'CATEGORIA' | 'DESCRICAO' | 'ESTOQUE' | 'AUTENTICACAO'
  | 'RATE_LIMIT' | 'INDISPONIVEL' | 'NAO_SUPORTADO' | 'DESCONHECIDO';

export interface ResultadoCanal<T> {
  ok: boolean; valor?: T;
  erro?: { codigo: ErroCanalCodigo; mensagemOperador: string; retentavel: boolean; raw?: unknown };
}
```

Cada adapter mapeia seu erro nativo → enum. O worker decide HTTP 500 (QStash retenta) vs persistir
`status='erro'` a partir de `erro.retentavel` — **exatamente a lógica que `publish-familia-ml` já tem**.

### 3.4 Transversais

- **Multi-tenancy:** `organizations` + `organization_members` + `org_id` (aditivo) em todas as tabelas
  de domínio; `marketplace_connections` (org_id, canal, conta) substituindo `ml_credentials`; **blindar
  as edge functions** (que rodam com `service_role` e *bypassam* RLS) para resolver e validar o `org_id`
  do JWT antes de tocar segredos. (ADR-0027)
- **Sincronização:** webhook-first + reconciliação por polling + idempotência (já temos polling e
  idempotência; falta assinar webhooks/notifications do ML para pedidos/status).
- **Billing:** Asaas (Pix/boleto/cartão recorrente + Pix Automático) + planos por faixa + metering de
  IA/anúncios; entitlements no Supabase. (ADR-0028)
- **IA híbrida:** taxonomia canônica como pivô + preditor nativo do canal + LLM closed-set + validação
  contra schema; overrides determinísticos por vertical preservados. (ADR-0026)

---

## 4. Princípios de evolução (inegociáveis)

1. **Strangler fig** — o ML vira o 1º conector atrás da interface **delegando** às funções já testadas
   (`montarPayloadItem`, `criarItemML`, `garantirDescricaoML`, `montarVariacoesUpdate`, `parseStatusML`,
   `humanizarErroML`). Zero reescrita; os ~561 testes atuais viram os testes do adapter ML.
2. **Aditivo sempre** — migrações de schema nunca quebram dado existente (add column nullable → backfill
   → set not null → swap de policies; cada passo reversível).
3. **ADR antes do código** — toda decisão não-trivial vira ADR (regra do projeto).
4. **YAGNI** — não construir o encanamento SaaS (multi-tenancy/billing) antes de ele ser necessário. Hoje
   o uso é interno; Fase 3 só quando houver primeiro interessado externo.
5. **Validação com token real** — todo épico de canal fecha com bug bash com token real (praxe do M4).
6. **Cada canal isolado** — falha de 1 canal nunca afeta os outros (cada `(família, canal)` é seu próprio
   job QStash com seu próprio retry).

---

## 5. Roadmap faseado (4 fases, 9 épicos)

Ordem aprovada: **Fase 0 → 1 → 2 → 3.** Cada épico tem subtarefas acionáveis (decompostas para "evoluir
aos poucos"). Os pesos são estimativas grossas relativas.

### FASE 0 — Fundação (sem mudança visível ao operador; risco baixo)

#### Épico E1 — Camada de abstração de canais (`ADR-0024`)
**Objetivo:** pôr o ML atrás de uma interface, sem mudar comportamento.
- E1.1 Criar `_shared/canais/contrato.ts` (interface `ChannelConnector`, `Capabilities`, tipos canônicos `AnuncioCanonico`/`VariacaoCanonica`/`RefAnuncio`/`ResultadoCanal`).
- E1.2 Criar `MercadoLivreConnector` que **delega** às funções `_shared/ml/*` existentes (fachada, zero lógica nova).
- E1.3 Criar `getConnector(canal): ChannelConnector` (registry) com só o ML registrado.
- E1.4 Trocar `publish-familia-ml`/`update-familia-ml` para resolver o conector via registry (em vez de importar `_shared/ml` direto).
- E1.5 Migrar os testes de `publicar/atualizar/status/erro-ml` para testarem o adapter ML (sem perder cobertura).
- **Critério de saída:** todos os testes verdes, comportamento idêntico em produção; nenhum campo de schema mudou.

#### Épico E2 — Modelo de dados multicanal (`ADR-0025`)
**Objetivo:** desacoplar o estado de publicação do produto canônico.
- E2.1 Migration aditiva: `canais_conectados` (org/user, canal, status) e `anuncios_externos` (familia_id, canal, item_externo_id, variacao_externa_id JSONB sku→id, permalink, status, atributos_canal JSONB, preco_override, erro, atualizado_em).
- E2.2 Backfill: copiar os `ml_item_id`/`ml_variation_id`/`ml_permalink` atuais para `anuncios_externos` (canal=`mercado_livre`).
- E2.3 View de compatibilidade que reexpõe os campos `ml_*` lendo de `anuncios_externos` (evita big-bang no frontend).
- E2.4 Adaptar workers para ler/gravar estado de publicação em `anuncios_externos`.
- E2.5 (Diferido) Remover as colunas `ml_*` de `familias`/`variacoes` quando o frontend não as usar mais (corte do tronco estrangulado).
- **Critério de saída:** publicação ML funciona lendo/gravando em `anuncios_externos`; dados antigos preservados.

### FASE 1 — "Qualquer produto" (generalização do domínio; risco médio)

#### Épico E3 — Taxonomia canônica + resolução de categoria (`ADR-0026`)
**Objetivo:** sair do regex por nicho; aceitar qualquer produto.
- E3.1 Adotar/derivar uma taxonomia canônica interna (base: Shopify Standard Product Taxonomy, aberta, ~12k categorias) — tabela `taxonomia_canonica`.
- E3.2 Tabela `mapping_categoria_canal` (canal, canonical_id, category_id_do_canal, atualizado_em), populada via API e cacheada (Redis).
- E3.3 Resolução de categoria: (1) override determinístico por vertical (regex atual vira "registro de overrides plugável"); (2) preditor nativo do canal (ML `GET /marketplace/domain_discovery/search?q=`, 400 req/min); (3) LLM (texto+Vision) como desempate em baixa confiança.
- E3.4 Schema dinâmico de atributos: ler `GET /categories/{id}/attributes` (ML) por categoria, cacheado, em vez de hard-coded por tipo.
- **Critério de saída:** um produto fora de aviamentos (ex.: papelaria) recebe categoria + lista de atributos obrigatórios corretos, sem código novo por nicho.

#### Épico E4 — Preenchimento de atributos por IA (closed-set) + validação (`ADR-0026`)
**Objetivo:** preencher atributos de qualquer categoria sem alucinar.
- E4.1 LLM extrai `value_id`/`value_name` de título+descrição+foto, **escolhendo dentro da lista `values[]` permitida** (closed-set) da categoria.
- E4.2 Generalizar `atributos.ts` de "por tipo fixo" para "schema dinâmico + registro de overrides por vertical" (aviamentos seguem 100% determinísticos → zero regressão).
- E4.3 Validação: `atributosFaltantes()` vira validador genérico contra os `required` lidos da API; correção fuzzy para o valor permitido mais próximo (padrão Shopify, <2% dos casos); defaults seguros (como o `IS_DOUBLE_FACE='Não'` atual).
- E4.4 UI: selo "categoria/atributo sugerido por IA — confirme" na Revisão; manter o seletor manual (`definir-categoria-familia`) como escape hatch universal; registrar `tipo_origem` ('regex'|'ia'|'manual') + confiança; logar correções do operador (fila humana, não auto-treino).
- **Critério de saída:** bug bash com produto de vertical nova publicado no ML com atributos válidos, validado com token real.

### FASE 2 — 2º canal: Shopee (prova a abstração; risco médio/alto)

#### Épico E5 — Conector Shopee (`ADR-0027` a criar no início do épico)
**Objetivo:** publicar na Shopee Brasil só preenchendo a interface.
- E5.1 Registrar app no Shopee Open Platform (partner_id/partner_key); validar requisitos de parceiro BR.
- E5.2 `ShopeeConnector`: auth (HMAC-SHA256 + shop authorization/OAuth, refresh), `capabilities` (variações via `tier_variation`, GTIN, sem catálogo/buybox, descrição embutida).
- E5.3 Mapeador `AnuncioCanonico → add_item` (item + models), upload de imagem (`media_space`), categoria (`get_category`/category recommend) + atributos (`get_attributes`).
- E5.4 `atualizarEstoque`/`atualizarPreco` (`update_stock`/`update_price`); `lerStatus`.
- E5.5 Classificador de erro Shopee → enum canônico (retentável vs definitivo).
- E5.6 Bug bash com token real Shopee BR.
- **Critério de saída:** 1 anúncio real publicado na Shopee a partir do mesmo produto canônico do ML.
- **Base de pesquisa:** §8.1 (deep-dive Shopee). A confirmar no portal Shopee **logado** antes do épico: rate limits exatos, host/módulos do sandbox, custo/SLA/escopos do Open Platform, e se loja única dispensa aprovação de "partner" (mesma praxe do app interno ML).

#### Épico E6 — Orquestração multicanal (`ADR` no início do épico)
**Objetivo:** publicar 1 família em N canais de uma vez.
- E6.1 `publicar-familias` aceita `{ familia_ids, canais: CanalId[], opcoes }`; claim atômico (já existe).
- E6.2 Worker genérico `publicar-anuncio` (`{ familia_id, canal, operacao }`): verifica assinatura QStash, resolve conector, idempotência por `(familia,canal)` em `anuncios_externos`, monta canônico, chama `criarAnuncio`, persiste.
- E6.3 Fan-out com delay escalonado por canal (precedente: re-enfileiramento 0/45/90s do lote #28) para não estourar rate limit.
- E6.4 Reconciliação: generalizar `status-publicados`/`parseStatusML` para `lerStatus` por `(familia,canal)`.
- E6.5 Frontend: seleção de canais na Revisão; status por canal na tela Publicados.
- **Critério de saída:** uma família publica em ML + Shopee simultaneamente; falha de um canal não afeta o outro.

### FASE 3 — Virar SaaS comercial (encanamento; risco alto — só quando houver interessado externo)

#### Épico E7 — Multi-tenancy (`ADR-0027`)
**Objetivo:** isolar dados por organização.
- E7.1 Migration: enum `org_role`, tabelas `organizations`, `organization_members`, `organization_invitations`; funções `is_member_of(uuid)`/`has_role_on_org(uuid, org_role)` (SECURITY DEFINER STABLE, `search_path=''`, REVOKE de anon).
- E7.2 Adicionar `org_id` nullable em `lotes`/`familias`/`variacoes`/`anuncios_externos`; backfill (1 org pessoal por user_id existente); set not null; índices em `org_id` e em `organization_members(user_id)`,(org_id).
- E7.3 Trocar policies de `user_id=auth.uid()` para `is_member_of(org_id)` (manter `user_id` como "criado_por"/auditoria).
- E7.4 Substituir `ml_credentials` por `marketplace_connections` (PK própria, org_id+canal+conta, unique); generalizar helpers Vault (receber `connection_id`, label namespaced).
- E7.5 **Blindar edge functions:** extrair `sub`/JWT, resolver `org_id` ativo e validar membership/ownership da connection **antes** de qualquer `get_tokens`/escrita (`assert_member(org_id, user_id)`).
- E7.6 Onboarding self-serve: trigger `handle_new_user` (org pessoal + membership owner); edge `accept-invite` idempotente; troca de org ativa no frontend.
- E7.7 `lotes.numero` global → sequência por org.
- **Critério de saída:** 2 organizações de teste com dados 100% isolados (validado via `get_advisors` security + teste cross-tenant).

#### Épico E8 — Billing + LGPD (`ADR-0028`)
**Objetivo:** comercializar.
- E8.1 Asaas como gateway (Pix/boleto/cartão recorrente + Pix Automático); reavaliar Stripe só p/ venda internacional.
- E8.2 Tabelas `assinaturas` (org, plano, status, ciclo, limites) e `uso_ciclo` (anúncios ativos, canais, custo IA); RLS por org.
- E8.3 Edge `webhook-asaas` (verify_jwt false, HMAC, idempotência por event id); reconciliação por cron.
- E8.4 Entitlements/gating server-side: checar limite **antes** do claim atômico de publicação; medir anúncios **ativos** (status ao vivo, não publicações brutas — não penalizar UPDATE); repasse de IA com franquia + markup (agregando `custo_centavos`, com teto p/ evitar bill shock).
- E8.5 Planos iniciais: Free (1 canal ML, ~10 anúncios, IA limitada) · Starter R$49–79 · Pro R$149–199 (1–2 canais) · Scale R$399+ (multicanal). Eixos: anúncios ativos + nº de canais.
- E8.6 LGPD: tabela `audit_log` por org; DPA descrevendo isolamento lógico via RLS; fluxo de export + exclusão de titular.
- **Critério de saída:** assinatura real cobrada via Asaas + gating bloqueando excedente; checklist LGPD mínimo.

#### Épico E9 — Operação SaaS
**Objetivo:** escalar com saúde.
- E9.1 Observabilidade por canal (taxa de erro, latência, rate-limit) + alertas.
- E9.2 Gestão de rate-limit por canal (token bucket) no fan-out.
- E9.3 Painel de saúde de integração (espelha o "Integration Health" dos hubs).
- E9.4 Suporte: logs por tenant, replay de job, fila de exceções.
- E9.5 Supabase: pooler Supavisor (transaction mode) nas edges; revisar plano/custo (egress de imagens fora do spend cap).
- **Critério de saída:** lote multicanal grande (50+ famílias × 2 canais) sem incidente bloqueante.

---

## 6. Diferenciais de produto a capitalizar (vindos da pesquisa)

Recursos que os integradores vendem e que o PubliAI **já tem ou tem meio-caminho andado** — usar como
narrativa comercial:

- **Smart Pricing por comissão** (✅ já temos, ADR-0020/0023) — generalizar comissão/tarifa **por canal** (tabela de regras por marketplace, não constantes do ML).
- **IA copywriter + Vision** (✅ já temos) — diferencial central; nenhum hub BR escreve anúncio tão bem.
- **Match por GTIN / vínculo a anúncio existente** (✅ parcial, opt-in catálogo ML — ADR-0021) — generalizar como "Smart Product Match" reutilizável.
- **Operações em massa** (✅ parcial: publicar selecionadas, exclusão de lote) — estender bulk repricing/bulk stock sobre anúncios já publicados.
- **Estoque distribuído por canal** (🔲 futuro) — modelar `estoque por listing/canal` cedo no schema (E2) mesmo que o MVP use estoque único, p/ evitar migração dolorosa.

---

## 7. Decisões estratégicas

| # | Decisão | Escolha | Justificativa |
|---|---|---|---|
| **D1** | Abordagem de evolução | **Evoluir in-place (strangler fig)** | Acoplamento ML é fino/isolado; preserva o que fatura; menor risco |
| **D2** | 1º marketplace novo | **Shopee** | Maior volume BR de baixo ticket (casa com o domínio atual); API acessível; esforço médio |
| **D3** | Monetização | **Assinatura por planos (tiers)** + metering de IA | Receita previsível; canais inclusos (padrão do mercado); IA como add-on |
| **D4** | Generalização do produto | **Híbrido: IA + regras por vertical** | Escala p/ qualquer produto sem perder a precisão dos nichos já dominados |
| **D5** | Modelo de dados multicanal | **`anuncios_externos` 1:N** (listing por canal) | Evita N colunas por canal; padrão de todos os hubs |
| **D6** | Tenancy | **Shared DB + `org_id`** (não schema/DB por tenant) | Único que escala no Supabase dentro do alvo de custo |
| **D7** | Gateway de billing | **Asaas** (Pix/boleto/cartão + Pix Automático) | Stripe falha em Pix/boleto recorrente no BR (preferidos do PME) |
| **D8** | Taxonomia | **Pivô canônico** (base Shopify) + mapping por canal | Resolve o problema N×M de categorias |
| **D9** | Sync | **Webhook-first + reconciliação por polling + idempotência** | Padrão de indústria; já temos polling + idempotência |
| **D10** | Ordem do roadmap | **Fase 0→1→2→3** (SaaS plumbing por último) | Entrega valor ao uso interno e torna vendável antes do encanamento; YAGNI |

**ADRs a criar (stubs já neste commit):**

| ADR | Tema | Épico |
|---|---|---|
| 0024 | Camada de abstração de canais (Ports & Adapters + strangler) | E1 |
| 0025 | Modelo de dados multicanal (`anuncios_externos`) | E2 |
| 0026 | Generalização da categorização/atributos por IA (taxonomia canônica + híbrido) | E3/E4 |
| 0027 | Multi-tenancy (organizations + org_id + marketplace_connections) | E7 |
| 0028 | Monetização e billing (Asaas + planos + metering) | E8 |
| (futuros) | Conector Shopee · Orquestração multicanal · Operação SaaS | E5 · E6 · E9 |

---

## 8. Panorama dos marketplaces (comparativo)

> Fonte: deep-dive focado das APIs (workflow `marketplace-apis-deepdive`, 2026-06-13). Itens "não
> confirmados via doc oficial" exigem validação no portal logado (mesma praxe do app interno ML).

| Marketplace | Auth | Variações? | GTIN obrigatório? | Sandbox? | Requisitos p/ app de terceiros | BR | Esforço |
|---|---|---|---|---|---|---|---|
| **Mercado Livre** (atual) | OAuth 2.0 (Bearer) | Sim (`attribute_combinations`) | Conditional (`EMPTY_GTIN_REASON`) | Sim | App interna (uso próprio) — já feito | ✅ | **Baixo** (já integrado) |
| **Shopee BR** (Open API v2) | OAuth 2.0 + **HMAC-SHA256 por request**; token **4h** / refresh 30d | Sim — `models` sob `tier_variation` (≠ ML → adapter novo) | **Virando obrigatório em 2025** (atributo de categoria; `3000*` tende a ser rejeitado) | Limitado (vários recursos só em produção) | App no Open Platform (`partner_id`+`partner_key`); loja própria é mais simples que parceiro/ERP | ✅ | **Médio** |
| **Magalu** (Open API) | OAuth 2.0 Auth Code; refresh ~6m | Sim (produto + SKUs) | Não bloqueante (catálogo aberto do seller) | Sim | Seller aprovado + **homologação técnica**; integra **direto** (sem hub) | ✅ | **Médio** |
| **Amazon BR** (SP-API, `A2Q3Y263D00KWC`) | **Só LWA** (SigV4 descontinuado out/2023); token 1h; PII via Restricted Data Token | Sim (`variation_theme` no JSON Schema do product type) | Catalog match exige GTIN real (`3000*` → cria ASIN novo) | Sim, mas Listings/Orders só **mock** | Conta **Profissional R$19/mês** + Developer; app **privado** p/ uso interno evita aprovação | ✅ | **Alto** |
| **Americanas/Via** (SkyHub) | Credenciais liberadas manualmente + Bearer (**não self-service**) | Sim (por SKU) | Não destacado | HLG obrigatória | Credenciamento **fechado**; na prática via **hub homologado** | ✅ | **Alto** |
| **Shopify** (canal, não praça) | Custom App token (1 loja) | Sim (`variants`) | Não (catálogo próprio) | Dev store grátis | Nenhuma homologação p/ Custom App | 🌐 global | **Baixo** |

**Ordem de canais recomendada após o ML:** **Shopee (2º)** → **Magalu (3º)** → **Amazon (4º)** →
Americanas/Via (5º, ou via hub). Shopify fica fora da fila de "praça" (só se virar canal de loja própria).
Racional: Shopee é tecnicamente a mais próxima do ML pronto; Magalu é esforço médio com integração
**direta**; Amazon é sólida mas o listing é mais pesado (JSON Schema dinâmico por categoria).

### 8.1 Deep-dive Shopee (base do épico E5)

- **Auth:** `partner_id`+`partner_key`; autorização da loja via `shop/auth_partner` (link expira em 5 min)
  → `auth/token/get` (code→tokens) → `auth/access_token/get` (refresh). Token **4h** → refresh proativo
  com **lock Redis (reusar ADR-0012)**. Assinatura `HMAC-SHA256(base_string, partner_key)` hex minúsculo
  em **toda** request; `base_string` posicional difere entre chamadas públicas e shop-level; timestamp em
  **segundos** e sincronizado.
- **Modelo:** `item` → `models` sob `tier_variation` (até 2 níveis). Mapeia o agrupamento por PAI
  (ADR-0003), mas é diferente de `attribute_combinations` do ML → **adaptador novo**.
- **Pipeline de publicação (multi-etapa, ≠ POST único do ML):** `media_space/upload_image` (→`image_id`,
  persistir como `capa_ml_picture_id`) → `get_category` → `get_attribute_tree` (lookup determinístico,
  espelha `montarAtributosML`) → `get_brand_list` → `add_item` → `init_tier_variation`/`add_model`.
- **Estoque/Preço (dedicados, idempotentes — encaixam no UPDATE/ADR-0016):** `update_stock` /
  `update_price`, batch até ~50 models.
- **Pedidos:** `get_order_list` (janela máx 15 dias) + `get_order_detail` (até 50/chamada); há webhook.
- **GTIN/EAN:** obrigatório no BR a partir de 2025 como atributo de categoria — o `3000*` interno tende a
  **não passar** (precisa EAN real ou tratamento equivalente ao `EMPTY_GTIN_REASON`). Reforça a
  importância do E3/E4.

### 8.2 Pegadinhas por canal (resumo)

- **Shopee:** token 4h; HMAC posicional + timestamp em segundos; sandbox limitado (validar em produção com
  loja de teste); rate limit por loja (~10 rps relatado, **não confirmado**) → enfileirar/escalonar via
  QStash (lição do lote #28). Custo/SLA/escopos do Open Platform **não confirmados** → checar logado.
- **Magalu:** mantém 2 APIs (Open API nova vs legada `integracommerce`) — usar a **nova**; exige
  homologação para produção; refresh ~6 meses.
- **Amazon:** ignorar docs antigos de SigV4 (basta LWA); listing é JSON Schema por categoria (não payload
  fixo); `getOrders` lento (1 req/min) → preferir Notifications API; usar app **privado**.
- **Americanas/Via:** credenciamento fechado + homologação formal; caminho prático é **hub homologado**.

---

## 9. Riscos consolidados (priorizados)

| Severidade | Risco | Mitigação |
|---|---|---|
| 🔴 Crítico | Edge functions usam `service_role` e *bypassam* RLS — multi-tenancy mal feito vaza dados/segredos entre tenants | Blindar functions (resolver+validar `org_id` do JWT) **antes** de trocar a RLS (E7.5); `get_advisors` após cada migration |
| 🔴 Crítico | Acoplar o domínio ao schema de UM marketplace (N colunas por canal) | `anuncios_externos` 1:N + atributos como JSONB por canal (E2) antes do 2º canal |
| 🟠 Alto | Custo de IA por item sobe (2 chamadas LLM + Vision) vs zero no regex | Overrides determinísticos resolvem verticais conhecidas sem IA; cache agressivo de schema/predição; Vision só em ambiguidade |
| 🟠 Alto | Tarifa/comissão tratada como constante não generaliza entre canais | Tabela de regras de comissão **por canal** (não constantes do ML) |
| 🟠 Alto | Oversell em venda simultânea cross-canal | Modelar estoque por listing/canal cedo (E2); baixa atômica no E6/E9 |
| 🟡 Médio | APIs de marketplace mudam direto (histórico ML: `/sites/MLB/search` 403, `original_price` descontinuado) | Lógica de canal isolada por adapter + validação periódica de overrides/IDs contra a API |
| 🟡 Médio | ML recategoriza itens automaticamente (desde 29/10/2025) | Usar o preditor nativo (alinha com o ML) + monitorar status pós-publicação |
| 🟡 Médio | Over-engineering (anti-YAGNI): app tem 1 canal real hoje | Parar E1+E2 no útil (fachada+registry+dados); só executar Shopee/SaaS quando decidido (já é a ordem aprovada) |
| 🟡 Médio | LGPD ausente no modelo atual | `audit_log` por tenant + DPA + export/exclusão (E8.6) antes de comercializar |
| 🟢 Baixo | Custo Supabase estoura alvo $3–28 com muitos tenants (egress de imagem fora do spend cap) | Reprecificar plano antes de comercializar; pooler Supavisor |

---

## 10. Apêndice — referências da pesquisa

Fontes-chave (lista completa nos relatórios dos agentes):

- **Modelo canônico / hubs:** Linnworks, ANYMARKET SDK (Sku DTO), api2cart, Channable, Shopify product-taxonomy (github.com/Shopify/product-taxonomy).
- **Multi-tenancy Supabase:** makerkit RLS best practices, Supabase docs (RBAC, custom-access-token-hook, RLS, Vault, Supavisor 1M), Supabase B2B SaaS, complydog LGPD.
- **Billing BR:** Asaas (preços/taxas, Pix Automático), Stripe Sync Engine, makerkit metered usage.
- **Abstração:** Hexagonal/Ports & Adapters, Strangler Fig (Fowler/Microsoft/AWS/Shopify), Unified API/ChannelEngine.
- **IA generalização:** ML domain_discovery/category-predictor + `/categories/{id}/attributes`, Amazon Product Type Definitions, Shopify Vision LLM classification (zenml LLMOps), GS1 GPC.
- **Pricing SaaS BR:** IDERIS, Plugg.to, ANYMARKET, Bling, Sellbrite.

---

## Próximos passos

1. Diego revisa este documento.
2. Ao aprovar, iniciar **E1** (camada de abstração) via `superpowers:writing-plans` → spec próprio do épico → plano → execução.
3. Cada épico seguinte repete o ciclo `spec → plano → subagent-driven`, com ADR antes do código.
