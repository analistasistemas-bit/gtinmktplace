---
tags: [modulo, promocoes]
atualizado: 2026-09-24
---

# Promoções

Central de Promoções do Mercado Livre, só leitura. Módulo pago `promocoes`, ligado por org
(ADR-0170) — MVP da iniciativa I1 do roadmap de melhorias. Ver [[Índice de ADRs]] (ADR-0170),
[[Marketplace]], [[Configurações]], [[Banco de Dados]].

## O que o MVP faz — e o que não faz

Lista as promoções da conta ML (Relâmpago, Tradicional, Smart, DEAL, cupom, co-participação) com
os anúncios candidatos/participantes de cada uma, mostrando a **margem líquida projetada** por
anúncio — mesma régua de custo+imposto+tarifa+frete usada em `calcular-tarifa-ml` (Revisão). O
MVP **não adere nem remove** anúncio de campanha — é leitura + diagnóstico de margem. Adesão pela
app fica para uma V2 (Promoções V2, roadmap de melhorias).

## Banco

- **`ml_promocoes`** — 1 linha por promoção da conta (`org_id` + `promocao_id`). `tipo`, `nome`,
  `status`, `inicio`, `fim`, `prazo_adesao`, `contagem jsonb`, `erro`, `sincronizado_em`,
  `itens_sincronizados_em`, `rodada_em_curso` (reserva de leitura de 30 min).
- **`ml_promocao_itens`** — 1 linha por anúncio dentro de uma promoção. Preços (`preco_original`,
  `preco_promo`, `preco_min/max`, `preco_sugerido`, `preco_avaliado`), percentuais bancados
  (`ml_pct`, `vendedor_pct`), `projecao jsonb` (margem por cor) e `pior_semaforo`
  (`verde|amarelo|vermelho|indisponivel`).
- **`ml_promocoes_sync`** — 1 linha por org com o estado da sincronização
  (`sincronizando|ok|sem_acesso|sem_promocoes|erro`).

RLS: leitura por `org_id = current_org_id()`; escrita só `service_role` (worker). Coluna
`configuracoes.alertas_promocoes_ativo` (default `false`) liga o alerta por org.

## Sincronização — `sincronizar-promocoes`

Edge nova, `verify_jwt=false` (valida assinatura QStash **ou** JWT do usuário). Dois modos:

- **QStash `{}`** (schedule `scd_5FKHhPTKCNtqp31W8nruJdVCLCRm`, `0 */6 * * *`) → fan-out por org
  com o módulo ativo. Etapa **`lista`**: trava de 5 min, lista as promoções, encerra as que
  sumiram, roda os alertas lendo o banco, reserva + enfileira 1 leitura por promoção
  `pending`/`started` não-cupom. Etapa **`promocao`**: lotes de 20 itens, orçamento de 90s,
  continuação pelo último `ml_item_id`, posse da rodada conferida antes de cada lote e na
  conclusão, `deduplicationId`.
- **Usuário logado** → dispara a etapa de lista só da própria org, throttle de 2 min, `403` sem o
  módulo.

Só faz `GET` no Mercado Livre (única exceção: refresh de token OAuth).

## Rollout

Módulo `promocoes` por org, nasce **desligado**. Ligado em produção só na org **DSA** (decisão do
Fable com validação real) — Avil e Daludi Shop seguem desligados (ligar na Avil é decisão do
Diego em `/admin`). Alertas desligados em todas as orgs.

## Validação (2026-09-24)

Preflight 568 arquivos/5913 testes verdes; suíte de isolamento
(`scripts/verificar-isolamento-tenant.ts`, agora com as 3 tabelas) 77 PASS/0 FAIL contra produção;
E2E real na DSA — lista em ~5s, 5 promoções, 52 anúncios lidos; prova dos números: 7/7 anúncios
com líquido da Central = `calcular-tarifa-ml` (Revisão), diferença ≤ R$0,005 (convidado DEAL/SMART,
participando, Legacy multi-cor, frete 0 e pago); validação visual em 1440/1920/360px e estados sem
acesso/sem promoções/erro (dados injetados); 4 defeitos visuais achados e corrigidos.

## Pendências conhecidas

- Ligar módulo/alertas na Avil — decisão do Diego.
- Heartbeat da reserva de 30 min se a cadeia real de sincronização passar de ~20 min.
- `CanalTabs` mostra dados do ML em qualquer aba de canal — revisar no E5.
- Toast de sucesso aparece mesmo quando a lista volta com estado erro.
- "Nenhum preço da faixa atinge o mínimo" ocupa 3 linhas na tabela.
