# PubliAI — Sugestões de features para o SaaS multi-marketplace

**Data:** 2026-07-05 · **Commit:** `76e5805` · **Gerado por:** skill `improve` (variante direction/roadmap)
**Tipo:** documento de direção de produto — opções para o mantenedor pesar, não backlog aprovado.

> Premissa: PubliAI vira SaaS multi-tenant conectado aos marketplaces do Brasil. O encanamento
> disso **já está planejado** (E5 Shopee, E6 orquestração, E6b estoque único, E7 multi-tenancy,
> E8 billing, E9 operação — ver `docs/superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md`).
> Este documento propõe o que **não está** no roadmap: features que agregam valor comercial em cima
> dessa fundação, ancoradas no que o código já tem hoje. Nada aqui duplica os épicos planejados nem
> o backlog pós-Tarefa 2 (busca global, ações em massa na Revisão, a11y, etc.).

**Lente de priorização:** o north-star declarado é *"o jeito mais rápido de criar bons anúncios,
em qualquer marketplace, com IA"* — sincronização é tabela-de-aposta, IA é o herói. As sugestões
abaixo seguem essa lente: primeiro o que destrava aquisição de clientes, depois o que capitaliza
os diferenciais já construídos (Smart Pricing, IA, Financeiro), depois retenção.

---

## Resumo executivo

| # | Feature | Valor SaaS | Esforço | Quando |
|---|---------|-----------|---------|--------|
| 1 | Onboarding reverso — importar anúncios existentes | **Aquisição** (time-to-value de dias → minutos) | L (épico) | Antes do lançamento comercial; depende de E2 (pronto) |
| 2 | Repricing contínuo com guard-rails | **Diferencial pago** (capitaliza Smart Pricing) | M–L | Pós-E7; feature de plano Pro/Scale |
| 3 | Saúde do anúncio (Listing Health Score) | **Retenção** + upsell | M | Pós-E7; base já existe (moderação, catálogo, concorrência) |
| 4 | Central de perguntas multicanal com auto-resposta governada | **Retenção** (reputação do seller) | M | Junto do E6 (generalizar por canal) |
| 5 | Copiloto de vendas (insights IA sobre Financeiro/Faturamento) | **Retenção** + narrativa de marketing | M | Pós-E8 (metering de IA pronto) |
| 6 | Estúdio de fotos IA (fundo branco, padronização) | **Aquisição** (dor universal de PME) | M | Independente; validar custo de IA antes |
| 7 | Central de notificações de eventos (Telegram/e-mail) | Quick win de percepção de valor | S–M | Qualquer momento |

---

## 1. Onboarding reverso — importar anúncios já publicados (a feature mais importante para virar SaaS)

**Problema:** todo o fluxo do PubliAI nasce da planilha (`ingest-lote`). Mas o cliente-alvo do SaaS
(lojista PME brasileiro) **já tem** centenas de anúncios ativos no Mercado Livre/Shopee. No primeiro
login, o produto hoje estaria vazio — o cliente precisaria montar uma planilha inteira no formato
exigido (`CODIGO, PAI, NOME, GTIN...`) antes de ver qualquer valor. Isso mata conversão self-serve.

**Proposta:** ao conectar a conta do marketplace (OAuth já existe, `marketplace_connections` vem no E7),
oferecer "Importar meus anúncios": ler os itens ativos via API (`/users/{id}/items/search` + item detail
no ML), reconstruir o catálogo canônico (`familias` + `variacoes`) a partir deles e popular
`anuncios_externos` com o vínculo — o inverso do publish. A partir daí o cliente já usa Publicados,
Financeiro, Faturamento, UPDATE de estoque/preço e, com E6, republica nos outros canais.

**Por que é viável com o que existe:** o modelo `anuncios_externos` (E2, em produção) já representa
"anúncio externo vinculado a família"; `status-publicados` já lê itens do ML; a detecção CREATE/UPDATE
(ADR-0005) já sabe conviver com anúncio pré-existente; e o match por GTIN (ADR-0021/0045) dá a chave
de deduplicação. O que falta é o worker de importação e o mapeamento inverso (payload ML → canônico).

**Trade-offs:** anúncios de terceiros são mais sujos que a planilha da Daludi (sem PAI/família explícita,
variações inconsistentes, fotos fora do padrão) — a reconstrução de famílias precisa de heurística +
tela de conferência, não dá para prometer 100% automático. É um épico com spike primeiro.
**Esforço:** L. **Pré-requisitos:** E2 (feito), idealmente E7 (org_id) para já nascer multi-tenant.

## 2. Repricing contínuo com guard-rails (Smart Pricing como serviço, não como momento)

**Problema/oportunidade:** o Smart Pricing é o diferencial declarado no documento mestre (ADR-0014
concorrência, ADR-0020 líquido mínimo, ADR-0023 abismo de tarifa, ADR-0059 desconto configurável) —
mas ele roda **uma vez**, no processamento do lote (cache de concorrência TTL 6h). Depois de publicado,
o anúncio fica cego: o concorrente baixa o preço e o cliente só descobre quando a venda some. IDERIS e
ANYMARKET vendem repricing como feature premium; o PubliAI tem 80% da matemática pronta.

**Proposta:** job periódico (QStash schedule, padrão já usado em `reconciliar-faturamento` e
`notificar-liberacao`) que re-consulta a concorrência dos anúncios ativos e recalcula o preço ideal
dentro dos guard-rails existentes (nunca abaixo do líquido mínimo, nunca no abismo de tarifa). Dois
modos: **sugerir** (fila "Precisa da sua atenção" + notificação, operador aprova em 1 clique) e
**automático com teto** (opt-in por família, limites explícitos). Começar só com o modo sugestão.

**Trade-offs:** a regra do projeto "nunca alterar anúncios reais fora do fluxo controlado" e "sempre
revisão humana" está correta — o modo automático precisa de ADR próprio e deve ser opt-in agressivamente
sinalizado. Custo de API de concorrência por anúncio × frequência precisa de teto por plano (casa com o
metering do E8). Buybox de catálogo (ADR-0021) tem dinâmica própria — tratar em fase 2.
**Esforço:** M (modo sugestão) → L (automático). **Monetização:** feature de plano Pro/Scale — é o tipo
de recurso que justifica upgrade.

## 3. Saúde do anúncio — Listing Health Score

**Problema/oportunidade:** já existem três vigias isolados: monitoramento de anúncios moderados
(ADR-0035), alerta de catálogo sem match (ADR-0036) e a análise de concorrência. O que não existe é a
visão consolidada que os hubs chamam de "qualidade do anúncio": título fraco, fotos abaixo do mínimo,
atributos opcionais vazios (que penalizam ranking no ML), preço fora da faixa competitiva, GTIN ausente,
moderação pendente.

**Proposta:** score por anúncio (0–100 ou faixas verde/amarelo/vermelho) na tela Publicados, calculado
de dados que o sistema já coleta, com **correção em 1 clique** reutilizando o pipeline existente: "gerar
atributos faltantes por IA" (ADR-0049/0052 já fazem isso no processamento), "regenerar título/descrição"
(`regenerar-copy-familia` já existe), "revisar preço" (link para o repricing da sugestão 2). O diferencial
vs. hubs: eles apontam o problema, o PubliAI **conserta com IA**.

**Trade-offs:** score mal calibrado vira ruído — começar com poucas regras objetivas (moderação, atributos
required/opcionais, nº de fotos, GTIN) antes de qualquer "nota por IA". As correções passam pelo UPDATE
normal (revisão humana preservada). **Esforço:** M. **Valor SaaS:** retenção — dá motivo para abrir o app
toda semana mesmo sem lote novo.

## 4. Central de perguntas multicanal com auto-resposta governada

**O que já existe:** o módulo Faturamento recebe perguntas via webhook (`questions` no ml-webhook,
ADR-0037) e tem IA na resposta. Isso hoje é um recurso da operação Daludi, acoplado ao ML.

**Proposta de evolução para SaaS:** promover a "caixa de entrada" a conceito de primeira classe,
multicanal (Shopee tem webhook de chat — encaixa no contrato do conector via capability `lerPerguntas`):
SLA visível ("pergunta sem resposta há 2h" no painel de atenção), templates por organização, resposta
automática **com regras de confiança** (IA responde sozinha só quando a pergunta casa com FAQ aprovada
pela org; caso contrário, sugere e espera aprovação). Responder rápido melhora reputação e conversão no
ML — é valor que o lojista sente na primeira semana.

**Trade-offs:** resposta automática errada em nome do cliente é risco reputacional do produto — o gate
de confiança e o log de auditoria (casa com `audit_log` do E8.6) são obrigatórios, não opcionais.
**Esforço:** M (a fundação de webhook + IA existe; o trabalho é governança + UI + generalização por canal).

## 5. Copiloto de vendas — insights de IA sobre o Financeiro/Faturamento

**O que já existe:** `ml_vendas` como fonte única (ADR-0038), Financeiro com lucro/margem/breakdown de
taxas (ADR-0040), custo real por variação, geografia de vendas (ADR-0039). "Dashboard analítico" está
explicitamente fora do MVP — correto para uso interno, mas para SaaS a análise é o que transforma dado
em decisão.

**Proposta:** camada de insights gerados por IA sobre os dados que já estão no banco: curva ABC de
famílias, "margem da família X caiu 8pp após o último reprice", "estoque da cor Y esgota em ~2 semanas
no ritmo atual, fornecedor: Z" (o campo `FORNECEDOR` já vem da planilha), resumo semanal por e-mail/Telegram.
Formato barato e de alto impacto percebido: um "resumo do consultor" semanal + 3 ações sugeridas, cada
ação linkando para a tela que resolve (Publicados filtrado, repricing, UPDATE de estoque).

**Trade-offs:** custo de LLM por org × frequência — precisa do metering do E8 para não corroer margem;
e insight genérico ("venda mais!") é pior que nenhum — validar o prompt com os dados reais da Daludi
antes de expor. **Esforço:** M. **Valor SaaS:** retenção + é a feature que demonstra "IA de verdade"
em marketing.

## 6. Estúdio de fotos por IA (fundo branco, padronização de capa)

**Problema:** o ML exige fundo branco na foto de capa e modera anúncio por foto ruim (incidente real
já registrado na operação: moderação por foto de capa). PME não tem fotógrafo; a foto é a maior causa
de anúncio feio/moderado depois do título. O pipeline de imagem do PubliAI (upload, capa `CAPA_`,
retry de foto no publish) já existe — só não trata o conteúdo da imagem.

**Proposta:** no fluxo de Revisão, botão "melhorar foto": remoção/troca de fundo para branco,
enquadramento quadrado, upscale leve — via API de imagem (OpenRouter/modelos de imagem), com preview
lado a lado e aprovação humana antes de substituir. Fecha o ciclo do posicionamento "criação de anúncio
assistida por IA": copy ✅, cor ✅, categoria/atributos ✅, preço ✅ — foto é a peça que falta.

**Trade-offs:** custo por imagem é o maior risco (multiplicado por variação × família) — restringir à
capa por padrão; qualidade de edição IA em produto pequeno/brilhante (aviamentos!) precisa de validação
com fotos reais antes de prometer. **Esforço:** M (spike de qualidade primeiro). **Valor SaaS:**
aquisição — demo visual irresistível ("suba a foto do celular, saia com capa profissional").

## 7. Central de notificações de eventos (quick win)

**O que já existe:** Telegram configurado e em produção para **um** evento (liberação de dinheiro,
`notificar-liberacao`), e webhooks do ML já chegam para orders/questions/claims/shipments (ADR-0037).

**Proposta:** generalizar em "central de notificações" com toggles por evento e por canal de entrega
(Telegram hoje; e-mail via Resend já configurado): venda realizada, pergunta recebida, anúncio moderado,
devolução aberta, estoque zerado. Os eventos já transitam pelo sistema — o trabalho é roteamento +
preferências + templates.

**Trade-offs:** praticamente nenhum técnico; o risco é spam — defaults conservadores (só moderação e
devolução ligados) e digest diário como opção. **Esforço:** S–M. **Valor SaaS:** percepção de "produto
vivo" desde o dia 1; por ser barato, bom candidato a primeira entrega pós-E7.

---

## Menores / registradas, não detalhadas

- **Devoluções "no escuro"** — já registrado no índice do advisor (`plans/README.md`): distinguir 403
  de "zero devoluções" na UI. Fix barato, vale antes do SaaS.
- **API pública / integração com ERP (Bling, Tiny)** — inevitável a médio prazo para PME que já tem ERP,
  mas é épico de plataforma; só depois de E8 e com demanda real de cliente.
- **Templates de marca por organização** — tom de voz e vocabulário do copywriter configuráveis por org
  (hoje o prompt é o da Daludi/aviamentos). Vira necessário naturalmente quando houver o 2º tenant;
  registrar como sub-tarefa do E7/pós-E7.
- **Agendamento de publicação** — publicar lote em data/hora (lançamentos, Black Friday). Barato com
  QStash `delay`, mas sem evidência de demanda ainda — YAGNI até o primeiro pedido.

## O que este documento NÃO cobre (já decidido/planejado — não re-propor)

Shopee e demais conectores (E5, ordem já decidida: Shopee → Magalu → Amazon), orquestração multicanal
(E6), estoque único cross-canal (E6b), multi-tenancy (E7), billing Asaas + planos + LGPD (E8), operação
SaaS/observabilidade (E9), e o backlog de UX pós-Tarefa 2. As sugestões acima assumem essa fundação e
apontam o que construir **em cima** dela.

## Sequência recomendada (recommended)

E7 → E6 → E5 seguem como decidido. Em paralelo/na sequência: **#7 notificações** (quick win),
**#1 onboarding reverso** (condição de lançamento comercial — sem ele o SaaS abre vazio),
**#2 repricing** e **#3 health score** como as features pagas do plano Pro, **#4/#5/#6** conforme
tração. Qualquer uma selecionada vira `spec → ADR → plano` pelo fluxo normal do projeto.
