---
tags: [modulo, pulse, inteligencia, mercado]
atualizado: 2026-09-03
---

# Pulse

Rota `/pulse`. Módulo de inteligência de mercado, monitoramento de concorrência dirigida e garimpo de oportunidades (Radar + Sonar). Em produção desde 2026-08-16 (ADR-0119) na organização DSA.
Ver [[Visão Geral]], [[Estoque]], [[Faturamento]], [[Financeiro]], [[Índice de ADRs]].

**Módulo pago, ligado por org.** `organizations.modulos_habilitados` controla a visibilidade — nenhuma organização enxerga o menu até o super-admin habilitar em `/admin`. As Edge Functions do módulo executam verificação server-side e respondem **403** quando o módulo não está habilitado.

---

## Estrutura do Módulo

O Pulse é dividido em duas abas principais na interface:

1. **Radar de Concorrência (`PulseRadar.tsx`):**
   - Monitoramento contínuo de produtos publicados ou de interesse estratégico da organização.
   - Coletor server-side dual-mode (`pulse-coletar`):
     - Schedule diário completo via QStash (`0 9 * * *`, tier completo).
     - Schedule tier quente a cada 6 horas (`0 */6 * * *`).
     - Botão "Atualizar agora" escopado à organização ativa.
   - Cadastro manual de produto para radar por link de catálogo ou GTIN (`pulse-adicionar`).
   - Disputa de mercado qualificada e simulador de reprecificação direto para a Revisão.

2. **Sonar — Garimpo de Oportunidades (`PulseSonar.tsx`):**
   - Pesquisa de mercado sob demanda por termo/nicho ou por código de barras (EAN/GTIN).
   - Análise unificada de mercado (ADR-0140): busca por termo e busca por EAN utilizam o mesmo pipeline robusto com enriquecimento Apify, eliminando a antiga bifurcação "grátis vs. paga".
   - Veredito de oportunidade instantâneo (🟢 alta, 🟡 média, 🔴 baixa) baseado em Demanda, Disputa e Tração (ADR-0124/ADR-0127).
   - Métricas de nicho: vendas acumuladas estimadas, faturamento endereçável aproximado, pódio de anúncios mais vendidos e palavras-chave.
   - DRE sob demanda e simulador de sensibilidade de margem (ADR-0148/ADR-0149).

---

## Concorrência Qualificada (ADR-0130)

Um dos avanços mais críticos no Pulse (e compartilhado com a Viabilidade) é a distinção estrita entre:

- **Mercado Observado:** Toda e qualquer oferta encontrada na API do marketplace para auditoria.
- **Mercado Relevante:** Somente ofertas de vendedores com força comercial real (≥10 transações concluídas, reputação fora de `1_red`/`2_orange`, e visitas nos últimos 30 dias > 0).

A qualificação é executada pelo classificador canônico unificado em `_shared/concorrencia/qualificacao.ts`. Apenas concorrentes relevantes entram no cálculo do menor preço concorrente, posição competitiva, disparo de alertas e cálculo de margem.

---

## Integração com Apify e Fallback Multi-Contas (ADR-0122)

Para contornar limitações da API oficial do Mercado Livre (que restringe a visualização de métricas detalhadas de vendas de concorrentes):
- O Sonar consome o ator de scraping da Apify (`karamelo/mercadolivre-scraper-brasil-portugues`) via Edge Function `pulse-sonar-vendas`.
- O cliente `_shared/apify/client.ts` possui fallback reativo entre até 4 tokens configurados (`APIFY_TOKEN`, `APIFY_TOKEN_2`, `_3`, `_4`), monitorando o saldo mensal e alternando automaticamente em respostas 401/402/403.

---

## Modelo de Dados (Tabelas do Pulse)

| Tabela | Função |
|---|---|
| `pulse_produtos` | Catálogo de produtos rastreados pelo Radar por organização (`codigo_pai`, `catalog_product_id`, status, timestamp do último snapshot). |
| `pulse_ofertas` | Histórico e snapshot das ofertas concorrentes observadas (preço, frete, logística FULL, vendedor, status de qualificação). |
| `pulse_vendedores` | Cadastro de sellers identificados com métricas de reputação, transações e visitas. |
| `pulse_alertas` | Registro de alertas disparados (ex: perda de Buy-Box, preço de concorrente abaixo da margem de segurança). |
| `sonar_snapshots` | Histórico global de buscas no Sonar para comparação temporal de volume de vendas. |

---

## Edge Functions do Domínio Pulse

- `pulse-coletar` (`verify_jwt=false`): Worker assíncrono acionado pelo QStash ou botão manual para atualizar ofertas do Radar.
- `pulse-adicionar` (`verify_jwt=true`): Adiciona produtos ao radar da organização.
- `pulse-sonar-vendas` (`verify_jwt=true`): Consulta dados de vendas e nicho via Apify.
- `pulse-sonar-visitas` (`verify_jwt=true`): Coleta visitas de anúncios via API oficial.
- `pulse-sonar-ean` (`verify_jwt=true`): Lookup complementar de catálogo por EAN.
- `pulse-analise-secoes237` (`verify_jwt=true`): Geração de seções analíticas e DRE para o Sonar.
