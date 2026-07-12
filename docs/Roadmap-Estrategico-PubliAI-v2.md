# PubliAI — Roadmap de Construção da Empresa (v2)

> Revisão estratégica do documento "Sugestões para Evolução do Produto".
> Perspectiva: CTO/Founder/Head of Product/Arquiteto/PMF/Growth/VC/Estratégia Competitiva.
> Princípio central: **este não é um roadmap de software; é um roadmap de construção de empresa.**
> Ancorado no estado real do produto em 2026-07-12: E1–E4, E6 (orquestração multicanal) e E7 (multi-tenancy) em produção; worker genérico `publicar-anuncio` pronto esperando só o conector Shopee; spikes 032 (liveness de integração) e 033 (export do catálogo canônico) já desenhados.

---

## ETAPA 1 — Revisão crítica do documento original

### O que o documento acertou

1. **A tese de posicionamento.** "Control tower de catálogo e margem com IA verificável" é a leitura correta. Hub genérico é commodity; o grafo operacional por SKU (conteúdo → decisão humana → publicação → venda → margem) é o único ativo defensável. Mantida integralmente.
2. **O diagnóstico do risco principal.** "O risco é comercial, não funcional" está certo. O produto funciona; a empresa não vende.
3. **As 6 decisões de priorização (seção 12).** Todas corretas: não vender multicanal sem 2º canal real; automação só com preview/limites/rollback; sem marketplace de extensões antes de API estável; PWA em vez de app; IA grounded; Enterprise só depois de PMF.
4. **A seleção das 50 funcionalidades.** O inventário é bom. Não há feature absurda nem lacuna gritante — exceto uma: **não existe Dashboard Executivo**. O produto não tem "primeira tela" que responda "como está minha operação agora?". Adicionado como funcionalidade 51.
5. **A macro-sequência conceitual** ("vendável → multicanal → integrável → autônomo") está certa como filosofia.

### O que o documento errou

1. **Score Final como eixo de priorização.** O método de score (30% valor usuário + 25% negócio + …) produz um ranking que ignora dependências e desbloqueio. Repricing tem score 9,3 e aparece "Prioridade Alta", mas depende de simulador, guard-rails, audit trail e bulk-infra que estão ranqueados abaixo dele. Score alto ≠ deve vir antes. **Abandonado como critério principal.**
2. **"MVP SaaS comercial" superdimensionado.** O roadmap original coloca 8 workstreams (onboarding, demo, self-service, billing completo, entitlements, metering, funil, RBAC, LGPD, paginação, export) ANTES de qualquer validação externa da tese. Billing completo com upgrade/downgrade/inadimplência/portal antes do primeiro cliente pago é over-engineering comercial. O correto: **billing mínimo viável** (assinar, cobrar via Asaas, suspender) + venda manual assistida para os 3–5 primeiros design partners.
3. **Shopee empurrado para "Versão 2.0".** Erro mais caro do documento. Shopee é: (a) a validação da tese central; (b) o maior multiplicador de valuation ("segundo canal real" está na própria lista de drivers de valuation do documento); (c) **já desbloqueado** — o E6 deixou o worker genérico pronto, falta só o conector. Deixar a tese principal sem prova atrás de billing/growth é inverter risco: o risco de "ninguém paga" e o risco de "multicanal não funciona" precisam ser atacados em paralelo, não em série.
4. **Fundação técnica diluída.** Outbox, paginação, RBAC, audit trail e control tower aparecem espalhados entre features de growth como itens de mesma natureza. São pré-condições de escala, não features — merecem fase própria, curta e explícita (Fase 0), porque **cada tenant novo multiplica o custo de não tê-las**.
5. **Telemetria de IA (38) subestimada.** Classificada como feature "Alta" genérica. Na verdade é **a semente do moat**: packs verticais (39), benchmark (48), autopilot (49) e digital twin (50) — as 4 features de maior diferencial — dependem de dados que só existem se a coleta começar AGORA. Custo de coleta: baixo. Custo de não coletar: 12–18 meses de atraso no moat. Movida para a Fase 0 (coleta) com análise amadurecendo depois.
6. **Instrumentação de funil (23) depois do onboarding.** Você não otimiza ativação sem medir ativação. Eventos de funil precisam existir ANTES do onboarding self-service, senão os primeiros 50 clientes — os mais informativos — passam sem deixar dados.
7. **Integration Health (25) e Export canônico (10) subaproveitados.** Ambos têm spikes/designs prontos (planos 032 e 033). São os quick wins de maior ROI/hora do backlog inteiro e o documento os trata como itens medianos de fila.
8. **Inbox e Copiloto de respostas cedo demais.** Score alto, mas são features de retenção de uma base que ainda não existe. Para 1–5 tenants, o Faturamento atual (perguntas/mensagens) cobre o caso. Movidos para a Fase 4.
9. **Experimentos controlados (41) superestimados.** PMEs de marketplace não têm tráfego para significância estatística por anúncio. O valor real está em telemetria agregada cross-tenant (38 + 48), não em A/B por seller. Rebaixado e parcialmente fundido com 38.

### O que muda estruturalmente

- Sai: priorização por Score Final. Entra: **DAG de dependências + ROI por esforço + teste dos 30 dias**.
- Sai: "MVP SaaS comercial" monolítico. Entra: Fase 0 técnica curta + Fase 1 comercial mínima, com **Shopee em paralelo** (workstream independente).
- Entra: funcionalidade 51 — **Dashboard Executivo Mission Control** — como primeira tela do sistema.
- Metade do roadmap original foi efetivamente reordenada (Shopee/estoque/onboarding reverso sobem; inbox/copiloto/views descem; telemetria e funil sobem duas fases; billing encolhe de escopo).

---

## ETAPA 2 — DAG de dependências

Convenção: `A → B` = B depende de A. Só as arestas estruturais (o grafo completo por feature está na tabela da Etapa 4).

```
FUNDAÇÃO (sem dependências, desbloqueiam quase tudo)
27 Outbox ──────────────┐
28 Paginação ───────────┼→ qualquer tenant com catálogo grande / SLA
29 RBAC ────────────────┼→ 30 aprovação, 42 colaboração, 34 API keys, Enterprise
31 Audit trail ─────────┼→ 12 correção lote, 13 repricing, 19 bulk, 49 autopilot (rollback/explicabilidade)
26 Control tower jobs ──┼→ 8 Shopee em escala, 9 estoque, SLA Enterprise
25 Integration Health ──┘→ 8 Shopee (2 canais sem health = suporte manual), 51 dashboard

DADOS (coleta precede análise)
23 Funil/eventos → 1 onboarding, 21 recuperação, 22 marcos, 24 customer health, pricing de planos
38 Telemetria IA (coleta) → 39 packs, 48 benchmark, 49 autopilot, 50 twin, 41 experimentos

COMERCIAL (cadeia linear)
4 Self-service org → 5 Billing → 6 Entitlements → 7 Metering
4 → 1 Onboarding guiado → 2 Catálogo-modelo → 22 Marcos → 21 Recuperação
5+6 → Trial, upgrade/downgrade, MRR, expansão de planos

MULTICANAL (cadeia da tese)
E6 (feito) → 8 Shopee → 9 Estoque único → 33 Múltiplas contas
8 → validação real de: planos Pro, pricing multicanal, D-E6.7
10 Export canônico → 3 Onboarding reverso (contrato do catálogo) → 36 ERP → 34 API → 35 Webhooks → 47 Marketplace

RETENÇÃO (cadeia do daily-use)
11 Health Score → 12 Correção em lote (precisa 19 Bulk + 31 Audit)
14 Simulador → 13 Repricing (precisa 31 Audit + guard-rails)
15 Inbox → 16 Copiloto respostas
51 Dashboard ← 25 + 23 + financeiro existente (+ 11 na v2)

MOAT (tudo depende de 38 + volume multi-tenant)
38 → 39 → 47 | 38 → 48 (precisa k-anonimato: ≥N tenants/vertical) | 38+13+11 → 49 Autopilot → 50 Twin

PARALELIZÁVEIS (workstreams independentes entre si)
- Trilha comercial (4→5→6→7) ∥ Trilha Shopee (8) ∥ Trilha fundação (27,28,25)
- 51 Dashboard ∥ 8 Shopee
- 11 Health Score ∥ 15 Inbox
```

Regra de ouro extraída do DAG: **as três trilhas de maior valor (fundação, comercial, Shopee) não competem por dependências — competem só por capacidade.** Num time founder+agentes de IA, isso significa que podem andar simultaneamente.

---

## ETAPA 3 — Classificação por categoria

| Categoria | Funcionalidades |
|---|---|
| **Fundação Técnica** | 25 Integration Health, 26 Control tower jobs, 27 Outbox, 28 Paginação server-side, 29 RBAC, 31 Audit trail |
| **Fundação SaaS** | 1 Onboarding guiado, 2 Catálogo-modelo, 4 Self-service org, 21 Recuperação de lotes, 22 Marcos de sucesso, 23 Funil/cohorts, 32 LGPD |
| **Produto** | 3 Onboarding reverso, 8 Shopee, 10 Export canônico, 17 Busca global, 18 Views salvas, 19 Bulk actions, 20 Central de notificações, 51 Dashboard Mission Control |
| **Monetização** | 5 Billing Asaas, 6 Entitlements, 7 Metering IA, 37 Estúdio de fotos |
| **Retenção** | 11 Health Score, 12 Correção em lote, 13 Repricing, 14 Simulador, 15 Inbox, 16 Copiloto respostas, 24 Customer Health, 45 PWA |
| **Escalabilidade** | 9 Estoque único, 33 Múltiplas contas |
| **Diferencial Competitivo** | 38 Telemetria IA, 39 Packs verticais, 40 Copiloto de vendas, 41 Experimentos, 48 Benchmark, 49 Autopilot, 50 Digital twin |
| **Enterprise** | 30 Aprovação 2 etapas, 42 Colaboração, 43 SSO/SCIM, 44 White Label |
| **Ecossistema** | 34 API pública, 35 Webhooks, 36 ERP/planilha sync, 46 Parceiros, 47 Marketplace de extensões |

Regra aplicada: **nunca comparar categorias diferentes por score.** Fundação Técnica compete com Fundação Técnica; a pergunta entre categorias é "qual fase da empresa estamos construindo agora?".

---

## ETAPA 4 — Tabela mestra (ordem global)

Legenda: Cplx P/M/G/GG · impactos A/M/B/— (alto/médio/baixo/nenhum) · ROI = valor entregue ÷ esforço.

| # | Feature | Categoria | Depende de | Desbloqueia | Cplx | ROI | Rec | Ret | LTV | Ativ | Esc | Val | Adiável? | Consequência de adiar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 27 Outbox publicação | Fund. Técnica | — | SLA, confiança multicanal | M | A | — | A | M | — | A | M | Não | Anúncio travado em cada tenant novo; suporte manual escala linear |
| 2 | 28 Paginação server-side | Fund. Técnica | — | tenants grandes, bulk | M | A | B | A | M | — | A | M | Não | Primeiro cliente com catálogo grande tem UX degradada e cancela |
| 3 | 25 Integration Health | Fund. Técnica | spike 032 pronto | 8, 51, redução de suporte | M | **A** | B | A | M | — | A | M | Não | Com 2 canais, cada token expirado vira ticket; design já pago |
| 4 | 29 RBAC por ação | Fund. Técnica | — | 30, 34, 42, equipes | M | A | M | A | M | — | A | M | Não | Buraco de segurança real (menu ≠ autorização) cresce com cada usuário |
| 5 | 31 Audit trail | Fund. Técnica | — | 12, 13, 19, 49, Enterprise | M | A | M | A | M | — | A | A | Parcial | Toda automação futura nasce sem rollback/explicação |
| 6 | 23 Funil/eventos | Fund. SaaS | — | 1, 21, 22, 24, pricing | M | A | B | A | M | A | M | A | Não | Primeiros clientes (os mais informativos) passam sem deixar dados |
| 7 | 38 Telemetria IA (coleta) | Dif. Competitivo | — | 39, 48, 49, 50, 41 | M | **A** | B | M | A | — | M | **A** | Não | Cada mês sem coleta = mês a mais de cold-start do moat |
| 8 | 26 Control tower jobs | Fund. Técnica | — | replay, DLQ, SLA | G | M | B | A | M | — | A | M | Parcial | v1 mínima agora (timeline+replay); completa pode esperar |
| 9 | 8 Conector Shopee | Produto | E6 (feito) | 9, 33, tese multicanal, Pro | G | **A** | A | A | A | M | A | **A** | **Não** | Tese central sem prova; valuation de "hub de 1 canal" |
| 10 | 4 Self-service org | Fund. SaaS | — | 5, 1, trial, aquisição | M | A | A | M | M | A | A | A | Não | Aquisição gargalada no founder para sempre |
| 11 | 5 Billing Asaas (mínimo) | Monetização | 4 | 6, trial, MRR, receita | M* | A | **A** | A | A | M | M | A | Não | *escopo mínimo: assinar/cobrar/suspender; inadimplência sofisticada depois |
| 12 | 6 Entitlements server-side | Monetização | 5 | tiers, expansão, proteção margem | M | A | A | M | A | — | A | A | Não | Limites visuais são contornáveis; margem de IA desprotegida |
| 13 | 7 Metering IA | Monetização | 6 | add-ons, overage, margem bruta | M | A | A | M | A | — | M | A | Parcial | Painel simples primeiro; pacotes de créditos depois |
| 14 | 1 Onboarding guiado | Fund. SaaS | 4, 23 | ativação, trial→paid | P | **A** | M | A | M | **A** | — | M | Não | Trial sem guia = churn dia 1 |
| 15 | 2 Catálogo-modelo | Fund. SaaS | 1 | demo self-service | P | A | M | B | B | A | — | B | Parcial | Prospect precisa de planilha pronta para testar |
| 16 | 22 Marcos de sucesso | Fund. SaaS | 23 | medição de ativação, lifecycle | P | A | B | M | M | A | — | M | Parcial | Ativação sem definição operacional |
| 17 | 21 Recuperação de lotes | Fund. SaaS | 23 | reengajamento | P | A | B | A | M | A | — | B | Parcial | Lotes abandonados = churn silencioso |
| 18 | 32 LGPD (núcleo) | Fund. SaaS | — | vendas B2B, due diligence | M* | M | M | B | B | — | M | M | Parcial | *núcleo agora (purge org + segredos); self-service completo depois |
| 19 | 51 **Dashboard Mission Control** | Produto | 25, 23, financeiro | primeira tela, demo de vendas, 40 | M | **A** | M | A | M | A | — | A | Não | Produto sem "cara" executiva; demo vende workflow, não resultado |
| 20 | 20 Central de notificações | Produto | 51 | ações no contexto, 49 | M | M | B | A | M | M | — | B | Parcial | Telegram sem histórico/resolução segura sendo o canal |
| 21 | 19 Bulk actions | Produto | 28, 31 | 12, manutenção em massa | M | A | M | A | M | — | A | M | Não | Correção em lote (12) fica bloqueada |
| 22 | 17 Busca global | Produto | 28 | investigação rápida | M | M | B | M | B | M | — | B | Sim | Incômodo, não bloqueio |
| 23 | 10 Export canônico | Produto | spike 033 pronto | 3, 36, 34, anti-lock-in | M | **A** | B | M | M | — | M | M | Não | Contrato do catálogo é pré-requisito da cadeia de integração |
| 24 | 9 Estoque único | Escalabilidade | 8 | infraestrutura crítica, switching cost | G | A | A | **A** | A | — | A | **A** | Não (pós-8) | Overselling na 1ª venda dupla; multicanal sem estoque é demo |
| 25 | 3 Onboarding reverso | Produto | 10 | aquisição de sellers estabelecidos | G | **A** | A | A | A | **A** | M | A | Não | Todo prospect já vende no ML; recomeço do zero mata a venda |
| 26 | 11 Listing Health Score | Retenção | dados existentes | 12, 51 v2, uso diário | M | A | A | A | A | M | — | A | Não | Produto vira "ferramenta de publicar" em vez de "painel diário" |
| 27 | 12 Correção em lote HS | Retenção | 11, 19, 31 | ROI provável da IA, uso recorrente | G | A | A | A | A | — | — | A | Parcial | Diagnóstico sem cura frustra |
| 28 | 14 Simulador de margem | Retenção | financeiro | 13 | M | A | M | A | M | — | — | M | Não (pré-13) | Repricing sem simulação = incidente financeiro |
| 29 | 13 Repricing contínuo | Retenção | 14, 31 | add-on Smart Pricing, moat | G | A | **A** | **A** | **A** | — | — | **A** | Parcial | Maior disposição-a-pagar do backlog; mas sem guard-rails é risco |
| 30 | 15 Inbox multicanal | Retenção | 8 (2 canais) | 16, módulo atendimento | M | M | M | A | M | — | — | M | Sim | Faturamento atual cobre 1 canal |
| 31 | 16 Copiloto respostas | Retenção | 15, 38 | créditos IA, stickiness | M | M | M | A | M | — | — | M | Sim | Depende de inbox e telemetria |
| 32 | 24 Customer Health | Retenção | 23 | CS proativo, anti-churn | M | M | B | A | M | — | — | M | Sim | Relevante a partir de ~20 tenants |
| 33 | 18 Views salvas | Produto | 28 | rotinas por papel | M | B | B | M | B | — | — | B | Sim | Nice-to-have |
| 34 | 37 Estúdio de fotos | Monetização | — | créditos de imagem, aquisição | M | M | M | M | M | M | — | M | Sim | Add-on; não bloqueia nada |
| 35 | 36 ERP/planilha sync | Ecossistema | 10 | operações maduras, recorrência | G | M | A | A | A | M | M | M | Parcial | v1 Google Sheets agendado é barata; ERPs reais depois |
| 36 | 34 API read-only | Ecossistema | 10, 29 | 35, 47, distribuição | G | M | M | A | A | — | M | A | Parcial | Antes de 5 clientes pedindo, é especulação |
| 37 | 35 Webhooks PubliAI | Ecossistema | 34 | automação externa, 47 | M | M | M | M | M | — | M | M | Sim | Segue a API |
| 38 | 42 Colaboração contextual | Enterprise | 29 | assentos, times | M | M | M | A | M | — | — | M | Sim | Light (atribuição) pode vir antes; completa espera times reais |
| 39 | 30 Aprovação 2 etapas | Enterprise | 29, 31 | contas maiores | M | M | M | M | M | — | — | M | Sim | Antecipar apenas se um deal exigir |
| 40 | 33 Múltiplas contas/canal | Escalabilidade | 8, E7 | agências, expansão por loja | G | M | A | A | A | — | A | A | Parcial | Abre ICP agência; puxado por demanda |
| 41 | 40 Copiloto de vendas | Dif. Competitivo | 51, 38 | valor executivo | M | M | M | A | M | — | — | M | Sim | Precisa do dashboard e de dados maduros |
| 42 | 39 Packs verticais | Dif. Competitivo | 38 (dados) | 47, distribuição por nicho | G | M | A | A | A | M | — | **A** | Parcial | Sem telemetria, packs são opinião, não conhecimento codificado |
| 43 | 41 Experimentos controlados | Dif. Competitivo | 38, tráfego | aprendizado causal | G | B | M | M | M | — | — | M | Sim | PME não tem tráfego p/ significância; fundir com 38/48 |
| 44 | 48 Benchmark por vertical | Dif. Competitivo | 38, ≥N tenants/vertical | moat de rede | G | M* | A | A | A | — | — | **A** | Sim (hoje) | *ROI explode quando houver densidade; antes é impossível (k-anonimato) |
| 45 | 49 Autopilot | Dif. Competitivo | 13, 12, 38, 31 | switching cost máximo | GG | M* | A | **A** | **A** | — | — | **A** | Sim (hoje) | Automação sem histórico de decisões = risco reputacional |
| 46 | 50 Digital twin | Dif. Competitivo | 49, 38 | camada de decisão proprietária | GG | B* | M | A | A | — | — | A | Sim | Visão de longo prazo; não construir por narrativa |
| 47 | 47 Marketplace extensões | Ecossistema | 34, 35, 39, demanda | efeito de rede | GG | B | M | A | A | — | M | A | Sim | Sem parceiros pedindo, é teatro de plataforma |
| 48 | 46 Programa de parceiros | Ecossistema | PMF, 33 | CAC menor, capilaridade | M | M | M | M | M | M | — | M | Sim | Precisa de produto que se implanta sozinho primeiro |
| 49 | 43 SSO/SCIM | Enterprise | 29 | procurement enterprise | G | B | M | M | M | — | — | B | Sim | Construir contra contrato assinado, nunca antes |
| 50 | 44 White Label | Enterprise | 33, 43 | canal indireto | G | B | A | A | A | — | M | M | Sim | Idem: só com âncora contratual |
| 51 | 45 PWA operacional | Retenção | 51, 20 | aprovações mobile | M | B | B | M | B | — | — | B | Sim | Responsividade básica cobre o caso inicial |

---

## ETAPA 5 — Teste dos 30 dias

"Se nos próximos 30 dias a equipe só pudesse construir esta funcionalidade, ela aumentaria significativamente o valor da empresa?"

**SIM inequívoco (candidatas ao agora):**
- **8 Shopee** — transforma a narrativa de "ferramenta de ML" para "plataforma multicanal provada". Maior delta de valuation por unidade de esforço restante (o E6 já pagou a infraestrutura).
- **5+6 Billing mínimo + entitlements** — transforma projeto em empresa: MRR > 0 muda a categoria da conversa com qualquer investidor.
- **3 Onboarding reverso** — remove a maior objeção de aquisição do ICP inteiro.
- **51 Dashboard Mission Control** — muda a demo de "veja meu workflow" para "veja seu dinheiro"; vende sozinho.
- **11 Health Score** — cria o motivo de login diário.

**NÃO (e portanto estavam cedo demais no doc original ou no imaginário):**
- 15 Inbox, 16 Copiloto, 18 Views, 24 Customer Health, 30 Aprovação, 33 Múltiplas contas, 34 API, 35 Webhooks, 37 Estúdio de fotos, 40–50 inteiro, 43/44/45/46/47 — nenhuma dessas move o valor da empresa nos próximos 30 dias com ~1 tenant pagante. Todas têm fase correta mais adiante.

**Caso especial:** 27/28/25/29 (fundação) falham no teste isoladamente ("fundação sozinha não aumenta valor em 30 dias") — mas o teste não se aplica a pré-condições: elas são o denominador de todas as outras. Por isso são Fase 0 e são **curtas**, não um épico de plataforma de 6 meses.

---

## ETAPA 6 — Matriz de desbloqueio

| Funcionalidade | Desbloqueia diretamente |
|---|---|
| 4 Self-service org | 5 billing, 1 onboarding, trial, aquisição sem founder, 46 parceiros |
| 5 Billing | trial pago, upgrade, downgrade, cobrança recorrente, **receita, MRR**, expansão de planos, 6, 7 |
| 6 Entitlements | tiers Free/Starter/Pro/Scale, proteção de margem IA, CTA de upgrade, expansion revenue |
| 7 Metering IA | créditos, overage, margem bruta previsível, pricing por valor |
| 8 Shopee | 9 estoque único, 33 múltiplas contas, plano Pro "multicanal", prova da tese, D-E6.7, 15 inbox multicanal de verdade |
| 9 Estoque único | posição de infraestrutura crítica, switching cost, plano Scale, 50 twin (disponibilidade) |
| 10 Export canônico | 3 onboarding reverso (contrato), 36 ERP, 34 API, argumento anti-lock-in |
| 3 Onboarding reverso | aquisição de sellers estabelecidos, implantação self-service, 46 parceiros, GMV administrado |
| 11 Health Score | 12 correção em lote, 51 v2, uso diário, prova de ROI da IA |
| 12 Correção em lote | monetização de créditos IA, 49 autopilot (primeiro degrau de automação) |
| 14 Simulador | 13 repricing (gate de segurança) |
| 13 Repricing | add-on Smart Pricing, 49 autopilot, disposição-a-pagar recorrente |
| 19 Bulk actions | 12, manutenção em massa, upgrades por volume |
| 23 Funil/eventos | 1, 21, 22, 24, decisões de pricing, otimização de onboarding, métrica p/ investidor |
| 38 Telemetria IA | 39 packs, 48 benchmark, 49 autopilot, 50 twin, 41 experimentos, defesa de margem de IA |
| 25 Integration Health | 51 dashboard, operação multicanal suportável, SLA |
| 26 Control tower | replay, DLQ, SLA Enterprise, suporte escalável |
| 27 Outbox | publicação confiável (pré-requisito de qualquer promessa de SLA) |
| 28 Paginação | tenants grandes, 19 bulk, 17 busca, 18 views |
| 29 RBAC | 30 aprovação, 42 colaboração, 34 API keys, times, Enterprise |
| 31 Audit trail | 12, 13, 19, 49 (rollback/explicação), Enterprise, compliance |
| 51 Dashboard | 40 copiloto de vendas, 20 notificações contextuais, demo comercial, primeira tela |
| 34 API | 35 webhooks, 47 marketplace, integrações de terceiros, plano Enterprise |
| 35 Webhooks | automação externa em tempo real, 47 |
| 39 Packs verticais | 47 marketplace, distribuição por nicho, licenciamento |
| 33 Múltiplas contas | ICP agência, 44 white label, expansão por loja |
| 48/49/50 | valuation por moat; nada downstream — são folhas do grafo |

Leitura da matriz: **5, 8, 10, 23, 38 e 29 são os nós de maior fan-out** — cada hora neles compra opções futuras. 43–50 são folhas: importantes, mas nada espera por elas.

---

## ETAPA 7 — Matriz de ROI

Esforço: P (dias), M (1–2 semanas), G (3–6 semanas), GG (>6 semanas) — referência para founder+agentes, sem cronograma prometido.

| Feature | Valor entregue | Esforço | ROI/hora |
|---|---|---|---|
| 25 Integration Health | Alto (spike pronto) | P–M | ★★★★★ |
| 10 Export canônico | Alto (spike pronto) | M | ★★★★★ |
| 1 Onboarding guiado | Alto | P–M | ★★★★★ |
| 21 Recuperação lotes | Médio-alto | P | ★★★★★ |
| 22 Marcos de sucesso | Médio | P | ★★★★☆ |
| 23 Funil/eventos | Alto (composto) | M | ★★★★★ |
| 38 Telemetria IA coleta | Alto (composto) | M | ★★★★★ |
| 27 Outbox | Alto | M | ★★★★☆ |
| 28 Paginação | Alto | M | ★★★★☆ |
| 11 Health Score | Alto | M | ★★★★☆ |
| 51 Dashboard | Alto | M | ★★★★☆ |
| 5+6 Billing+entitlements mínimos | Muito alto | M–G | ★★★★☆ |
| 8 Shopee | Muito alto | G | ★★★★☆ (infra já paga pelo E6) |
| 2 Catálogo-modelo | Médio | P–M | ★★★★☆ |
| 29 RBAC | Alto | M–G | ★★★☆☆ |
| 31 Audit trail | Alto | M–G | ★★★☆☆ |
| 19 Bulk actions | Alto | M | ★★★☆☆ |
| 9 Estoque único | Muito alto | G–GG | ★★★☆☆ |
| 3 Onboarding reverso | Muito alto | G–GG | ★★★☆☆ |
| 14+13 Simulador+Repricing | Muito alto | G–GG | ★★★☆☆ |
| 12 Correção em lote | Alto | G | ★★★☆☆ |
| 15+16 Inbox+Copiloto | Médio-alto | G | ★★☆☆☆ (hoje) |
| 34+35 API+Webhooks | Médio (hoje) | G–GG | ★★☆☆☆ (hoje) |
| 39 Packs | Alto (com dados) | GG | ★★☆☆☆ (hoje) |
| 48 Benchmark | Alto (com densidade) | GG | ★☆☆☆☆ (hoje) |
| 49 Autopilot / 50 Twin | Altíssimo (com histórico) | GG | ★☆☆☆☆ (hoje) |
| 43 SSO / 44 White Label / 47 Marketplace | Alto (com contrato) | GG | ★☆☆☆☆ (hoje) |

Nota: "hoje" importa — 48/49/50 têm o maior valor absoluto do backlog e o pior ROI presente. É exatamente por isso que a coleta (38) precisa começar agora: ela converte tempo em dados sem consumir roadmap.

---

## ETAPA 8 — O novo roadmap (fases de construção da empresa)

> Sem cronograma em semanas/meses — a capacidade real (founder + agentes) define o ritmo; as fases definem a **ordem e os critérios de saída**.

### Fase 0 — Fundação Técnica
**Objetivo: nenhum tenant novo pode multiplicar dívida.**

1. Higiene de baseline: Vite/Vitest atualizados, testes determinísticos, remoção da config de estratégia inerte (quick wins do doc original — mantidos).
2. **27 Outbox de publicação** — claim sem enqueue nunca mais.
3. **28 Paginação e filtros server-side** — Revisão, Publicados, lotes, vendas.
4. **25 Integration Health** (spike 032) — liveness por conexão/canal.
5. **29 RBAC por ação no backend** — papéis canônicos verificados em toda edge/RPC.
6. **31 Audit trail** (v1: eventos de mutação com ator/origem/antes-depois).
7. **26 Control tower de jobs** (v1: timeline + replay idempotente + DLQ; console avançado depois).
8. **23 Instrumentação de funil** — eventos desde já, dashboards simples.
9. **38 Telemetria IA — coleta** — prompt/versão/saída/edição humana/aceite, desde já.

Critério de saída: um tenant desconhecido pode operar sem quebrar nada e sem exigir suporte do founder; toda mutação é explicável; todo job falho é recuperável; todo evento de produto e de IA está sendo gravado.

### Fase 1 — Fundação Comercial
**Objetivo: qualquer cliente cria conta, testa, paga e usa sem intervenção humana.**

10. **4 Criação self-service de organização** (com trial).
11. **5 Billing Asaas mínimo** — assinar, cobrar (Pix/boleto/cartão), suspender, webhook idempotente. Inadimplência sofisticada, portal completo e Pix Automático: iteração posterior.
12. **6 Entitlements server-side** — Free/Starter/Pro/Scale validados antes do claim.
13. **7 Metering IA** — painel de consumo + alertas 70/90% + teto. Pacotes extras depois.
14. **1 Onboarding guiado** até o primeiro anúncio ativo.
15. **2 Catálogo-modelo** de demonstração.
16. **22 Marcos de sucesso** + **21 Recuperação de lotes**.
17. **32 LGPD núcleo** — purge atômico de org + revogação de segredos (o resto é adiável).

Decisão de founder embutida: **os 3–5 primeiros clientes entram por venda manual assistida em paralelo à construção desta fase** — não esperar billing para vender; usar cobrança manual e converter depois. Billing existe para escalar a venda, não para permitir a primeira.

### Fase 2 — Produto Operacional
**Objetivo: o PubliAI vira o painel principal do cliente.**

18. **51 Dashboard Executivo — Mission Control** (novo; primeira tela do sistema): anúncios publicados/com erro, produtos aguardando revisão, sem margem e abaixo do preço ideal, integrações offline (25), jobs com falha (26), vendas, margem, lucro, caixa (financeiro existente), alertas, recomendações de IA e ações prioritárias. v1 agrega o que já existe; v2 incorpora Health Score.
19. **20 Central de notificações** — eventos viram trabalho rastreável (in-app + Telegram + e-mail).
20. **19 Bulk actions com preview e rollback** — também é infra da Fase 4.
21. **17 Busca global**.
22. 18 Views salvas — cauda da fase, corta primeiro se apertar.

### Fase 3 — Product-Market Fit (multicanal)
**Objetivo: validar a tese principal. Ordem interna obrigatória.**

23. **8 Shopee real** — OAuth/HMAC, categoria/atributos, fotos, publicação, estoque, preço, bug bash com loja real. *Nota de CTO: por ser workstream independente, deve começar em paralelo à Fase 1 — o conector não disputa dependências com billing, só capacidade.*
24. **10 Catálogo canônico exportável** (spike 033) — o contrato do catálogo.
25. **9 Estoque único cross-channel com ledger** — sem isso, multicanal é demo.
26. **3 Onboarding reverso** — importa o que o seller já tem no ML (e depois Shopee).
27. **36 ERP/planilha sincronizada** — v1: CSV/Google Sheets agendado com diff.
28. **34 API read-only mínima** — produtos, anúncios, estoque, vendas, health.
29. **35 Webhooks básicos** — publicação, venda, erro.

Critério de saída (= PMF declarável): N tenants pagantes operando 2 canais com estoque único, retenção de logo estável, expansão por upgrade acontecendo sem venda ativa.

### Fase 4 — Retenção
**Objetivo: ferramenta indispensável, aberta todo dia.**

30. **11 Listing Health Score** → 31. **12 Correção guiada em lote** (usa 19 + 31 + 38).
32. **14 Simulador de margem** → 33. **13 Repricing contínuo com guard-rails**.
34. **15 Inbox multicanal** → 35. **16 Copiloto governado de respostas**.
36. **24 Customer Health / prevenção de churn**.
37. **42 Colaboração** (light: atribuição + comentários).
38. Automações de rotina (regras simples sobre 20/19 — degrau pré-autopilot).
39. 37 Estúdio de fotos (add-on de créditos; encaixa aqui por demanda).

**Contrato inegociável de toda automação** (mantido do doc original e promovido a regra de arquitetura): preview → aprovação → limites → auditoria → rollback → kill switch. O audit trail da Fase 0 é o que torna isso barato aqui.

### Fase 5 — Plataforma
**Objetivo: de produto a plataforma — quando ≥5 clientes/parceiros pedirem.**

40. API v2 (write, SDK, sandbox, documentação pública, quotas por plano).
41. Webhooks completos (replay, logs, assinaturas self-service).
42. Integrações ERP prioritárias reais (Bling/Tiny/Omie — pela demanda).
43. **47 Marketplace de packs e conectores** — só com API estável E parceiros na fila.

### Fase 6 — Moat
**Objetivo: o que não se copia. Só existe depois de dados suficientes — e é por isso:**

- **48 Benchmark** exige k-anonimato: sem ≥N tenants por vertical, ou é estatística ruído ou é vazamento de dado de cliente.
- **39 Packs verticais** sem telemetria (38) são opinião do founder codificada; com telemetria, são conhecimento operacional comprovado — e licenciável.
- **49 Autopilot** automatiza decisões; sem histórico de decisões humanas + resultados (38 + 31), automatiza palpite, e um palpite errado em preço destrói a confiança que o produto inteiro construiu.
- **50 Digital twin** precisa de séries de preço/concorrência/conversão por SKU que só o tempo em produção gera.

Ordem interna: 38 (análise madura, evals, regressão) → 39 packs → 40 copiloto de vendas → 48 benchmark → 49 autopilot → 50 twin. 41 experimentos: fundido à telemetria agregada (A/B individual por PME não tem potência estatística).

### Fase 7 — Enterprise
**Objetivo: só depois de PMF provado — e de preferência puxado por contrato.**

44. 30 Aprovação em duas etapas (antecipável se um deal exigir).
45. 33 Múltiplas contas por canal (antecipável — abre ICP agência; watch item).
46. 43 SSO/SCIM — construir contra contrato assinado.
47. 44 White Label + 46 Programa de parceiros/Agency.
48. LGPD/compliance avançado (retenção configurável, exportação de titular self-service).
49. 45 PWA operacional — quando aprovações mobile virarem pedido recorrente.

---

## ETAPA 9 — Três roadmaps, três lentes

### Roadmap Técnico (ordem ideal de engenharia)
`Fase 0 inteira → 8 Shopee → 9 estoque → 10 export → 19 bulk → 11/12 HS → 14/13 repricing → 34/35 API → resto`
Lógica: dependências primeiro, risco técnico concentrado cedo, retrabalho zero. Fundação antes de qualquer feature que a pressupõe.

### Roadmap Comercial (ordem ideal de receita)
`5/6 billing+entitlements → 4 self-service → 3 onboarding reverso → 8 Shopee → 13 repricing → 7 metering/créditos → 33 múltiplas contas → 37 fotos → add-ons`
Lógica: MRR primeiro, depois remover a maior objeção de compra (onboarding reverso), depois os dois maiores geradores de willingness-to-pay (multicanal e repricing), depois expansão.

### Roadmap Estratégico (ordem ideal de valuation)
`8 Shopee → 9 estoque → 5 MRR mínimo → 23+38 instrumentação/telemetria → 3 onboarding reverso (CAC baixo) → 11/13 (retenção provada) → 39/48 (moat) → 34/47 (plataforma)`
Lógica: valuation compra narrativa provada — "segundo canal real + estoque único" muda a categoria da empresa; métricas de cohort e moat de dados mudam o múltiplo.

### Por que divergem — e como resolvi
O técnico começa por fundação (dependência), o comercial por billing (caixa), o estratégico por Shopee (tese). Divergem porque otimizam riscos diferentes: retrabalho, sobrevivência e múltiplo. **O roadmap da Etapa 8 é a fusão: Fase 0 enxuta (paga o técnico), Fase 1 mínima + venda manual (paga o comercial) e Shopee em paralelo desde cedo (paga o estratégico).** Num time founder+agentes, as três trilhas não disputam dependências — disputam atenção, e é para isso que os critérios de saída por fase existem.

---

## ETAPA 10 — "Se eu fosse o fundador…"

**Primeiro (imediatamente):** Fecho a Fase 0 enxuta — outbox, paginação, integration health e RBAC — enquanto disparo **Shopee em trilha paralela**, porque o E6 já pagou 80% do custo e a tese multicanal é o que a empresa É. Ligo coleta de funil e telemetria de IA na mesma semana em que penso nisso, porque dado não coletado é dado perdido para sempre. E começo a **vender manualmente**: 3–5 design partners do nicho de aviamentos/têxtil (onde os packs já são bons por construção), cobrando desde o primeiro mês via cobrança manual, antes de existir billing.

**O que jamais faria cedo:** Autopilot, digital twin, benchmark, white label, SSO, marketplace de extensões. Cada um deles construído sem dados/demanda é a mesma feature construída depois — só que paga duas vezes e com risco reputacional (automação errada em preço é churn instantâneo e irreversível).

**O que adiaria (e adiei):** Inbox/copiloto de respostas (Fase 4 — o Faturamento atual segura 1 canal), API/webhooks completos (Fase 5 — construir contra demanda real), views salvas, PWA, aprovação em duas etapas, customer health (relevante a partir de ~20 tenants).

**O que aceleraria:** (1) Shopee — cada semana sem 2º canal é uma semana vendendo uma tese não provada; (2) Onboarding reverso — é a diferença entre vender para quem está começando (mercado pequeno, churn alto) e vender para quem já fatura no ML (mercado inteiro); (3) Dashboard Mission Control — é a demo que fecha venda: margem, caixa e "o que fazer agora" numa tela; (4) Telemetria de IA — custo marginal baixo, é o juro composto do moat.

**As apostas que multiplicam o valor da empresa:**
1. **Multicanal com estoque único provado** — muda a categoria de "ferramenta de anúncio" para "infraestrutura de operação". Infraestrutura tem múltiplo de infraestrutura.
2. **O grafo operacional por SKU** (catálogo + decisão humana + concorrência + margem + resultado) alimentado por telemetria desde já — em 18 meses ninguém replica, porque não dá para comprar tempo de dado.
3. **Repricing por líquido econômico real** — o único player que decide preço pelo líquido (sale_fee + frete real + imposto) e não pelo "menor preço" tem o argumento de ROI mais mensurável do mercado.
4. **Onboarding reverso + self-service** — CAC estruturalmente menor que o de qualquer concorrente que exija implantação.
5. **Verticalização (packs) com prova estatística** — de "IA genérica que escreve título" para "sistema que sabe vender aviamento/autopeça/moda", licenciável e distribuível.

**Nos 24 meses:** meses 0–6, Fases 0–1 + Shopee + primeiros pagantes manuais; meses 6–12, Fases 2–3 completas (estoque único, onboarding reverso, dashboard) e PMF declarável com N pagantes em 2 canais; meses 12–18, Fase 4 (HS, repricing, inbox) transformando retenção em números de cohort apresentáveis; meses 18–24, início de moat (packs + benchmark se houver densidade) e plataforma se houver demanda — e, com essas curvas, a decisão consciente entre crescer com caixa próprio ou levantar capital com uma história de infraestrutura, não de ferramenta.

---

## ETAPA 11 — Respostas objetivas

**As 10 funcionalidades mais importantes do produto:**
8 Shopee · 9 Estoque único · 5 Billing · 6 Entitlements · 3 Onboarding reverso · 11 Health Score · 13 Repricing · 51 Dashboard Mission Control · 4 Self-service · 38 Telemetria IA.

**As 10 que geram mais receita:**
5 Billing (habilita todas) · 6 Entitlements · 8 Shopee (tiers Pro) · 13 Repricing (add-on de maior WTP) · 7 Metering/créditos · 3 Onboarding reverso (converte o ICP grande) · 33 Múltiplas contas (expansão por loja) · 9 Estoque único (Scale) · 37 Estúdio de fotos (créditos) · 12 Correção em lote (créditos IA).

**As 10 que mais reduzem churn:**
9 Estoque único (switching cost) · 11 Health Score (login diário) · 13 Repricing (valor recorrente) · 51 Dashboard (hábito) · 15 Inbox (operação dentro do produto) · 12 Correção em lote · 25 Integration Health (confiança) · 20 Notificações (retorno ao produto) · 24 Customer Health (resgate proativo) · 1 Onboarding guiado (churn precoce).

**As 10 que mais aumentam valuation:**
8 Shopee (categoria) · 9 Estoque único (infraestrutura) · 5+6 MRR/expansão · 23 Funil/cohorts (métricas que sustentam múltiplo) · 38 Telemetria (moat narrável e real) · 3 Onboarding reverso (CAC estrutural) · 13 Repricing (WTP demonstrada) · 39 Packs (distribuição vertical) · 48 Benchmark (efeito de rede) · 34 API (plataforma).

**As 10 de maior barreira competitiva:**
38 Telemetria IA · 48 Benchmark · 39 Packs verticais · 49 Autopilot · 50 Digital twin · 13 Repricing por líquido real · 9 Estoque único integrado a margem · 11+12 Health Score com correção fechando loop · 47 Marketplace de extensões · 3 Onboarding reverso (dados de catálogo desde o dia 1).

**Devem esperar PMF:**
43 SSO/SCIM · 44 White Label · 46 Parceiros · 47 Marketplace · 48 Benchmark · 49 Autopilot · 50 Twin · 41 Experimentos · 30 Aprovação 2 etapas · 42 Colaboração completa · 45 PWA · 24 Customer Health (na forma completa).

**Desperdício neste momento:**
Qualquer hora gasta em SSO, White Label, marketplace de extensões, PWA, digital twin ou benchmark hoje. Também: billing sofisticado (dunning multi-régua, portal completo) antes do 10º pagante, e A/B por anúncio (41) para sellers sem tráfego.

**O que eu removeria completamente:**
Nada — a regra é mover, não remover, e o inventário é bom. As duas quase-remoções: **41 Experimentos controlados** deixa de ser feature própria e vira capacidade da telemetria agregada (38/48); **45 PWA** vira "responsividade das telas de aprovação", não um projeto.

**Superestimado:**
Billing como projeto grande (o mínimo viável é pequeno; o resto é iteração) · Inbox/copiloto como prioridade imediata · Experimentos controlados · Digital twin (romântico hoje) · Score Final como método · a própria ideia de que o "MVP SaaS" precisa estar completo antes de vender (venda manual resolve).

**Subestimado:**
**Telemetria de IA (38)** — é o item mais subestimado do documento: barato agora, impossível de recuperar depois · **Integration Health (25)** e **Export canônico (10)** — spikes prontos, ROI máximo · **Dashboard executivo** — nem existia no backlog e é a cara do produto · **Funil (23)** — sem ele, toda decisão de growth é opinião · **Onboarding reverso (3)** — tratado como feature, é a estratégia de aquisição · e o custo composto de adiar fundação (27/28): cada tenant novo multiplica o preço.

---

## Conclusão

O documento original acertou a tese e o inventário e errou o sequenciamento em três pontos caros: prendeu a validação da tese (Shopee) atrás de um MVP comercial superdimensionado, tratou fundação técnica como feature em vez de pré-condição, e deixou o moat (telemetria) para depois — quando telemetria é a única coisa do backlog que não pode ser comprada depois, só cultivada antes.

A reorganização proposta é executável por três trilhas paralelas que não disputam dependências: **fundação enxuta** (Fase 0), **comercial mínimo + venda manual** (Fase 1) e **Shopee desde já** (Fase 3 antecipada). O critério que ordena tudo: primeiro provar que a empresa vende o que o produto já faz; depois provar a tese multicanal; depois tornar-se indispensável; e só então tornar-se incopiável.
