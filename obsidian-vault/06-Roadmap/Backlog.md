---
tags: [roadmap, backlog]
atualizado: 2026-07-12
---

# Backlog

Fonte: `docs/ROADMAP.md` ("Evolução v2 — SaaS multicanal" + "Escopo fora do MVP") e
`docs/Roadmap-Estrategico-PubliAI-v2.md` (revisão de CTO, PR #15, 2026-07-12 — reordena as 50
funcionalidades em 8 fases de construção da empresa; supersede o score de priorização antigo).
Ver [[Próximas Features]], [[Sprint Atual]].

## Roadmap estratégico v2 — 8 fases (docs/Roadmap-Estrategico-PubliAI-v2.md)

Sem cronograma fixo — a capacidade real define o ritmo; as fases definem ordem e critério de
saída. Mudanças de fundo vs. o plano anterior: **Shopee deixa de ser "Versão 2.0" e roda em
paralelo à Fase 1** (já desbloqueado pelo E6); billing vira **mínimo viável** (venda manual
assistida para os 3–5 primeiros clientes, em vez de billing completo antes da 1ª venda);
telemetria de IA é promovida a Fase 0; nova funcionalidade 51 — **Dashboard Mission Control**.

| Fase | Objetivo | Status |
|---|---|---|
| 0 — Fundação técnica | nenhum tenant novo multiplica dívida (outbox, paginação, RBAC, audit trail, control tower, telemetria IA) | 🟡 liveness (ADR-0069) feito; resto pendente |
| 1 — Fundação comercial | qualquer cliente cria conta, testa, paga sem intervenção humana (billing mínimo Asaas) | 📋 pendente, roda em paralelo ao E5 |
| 2 — Produto operacional | PubliAI vira painel principal (Dashboard Mission Control — feature 51) | 📋 pendente |
| 3 — PMF multicanal | validar a tese: Shopee real + estoque único cross-canal (E5/E6b) | 📋 próximo passo técnico |
| 4 — Retenção | Health Score, simulador de margem, repricing, inbox multicanal | 📋 futuro |
| 5 — Plataforma | API v2, webhooks completos, integrações ERP | 📋 futuro |
| 6 — Moat | benchmark, packs verticais, autopilot, digital twin (exige dados de produção) | 📋 futuro |
| 7 — Enterprise | SSO/SCIM, white label — só após PMF provado | 📋 futuro |

## Evolução v2 — 10 épicos técnicos (abordagem strangler fig)

## Evolução v2 — 10 épicos (abordagem strangler fig)

| Fase | Épicos | Entrega | Status |
|---|---|---|---|
| **0 — Fundação** | E1 Camada de abstração de canais · E2 Modelo de dados multicanal | ML atrás de interface; catálogo agnóstico | ✅ Em produção |
| **1 — Qualquer produto** | E3 Taxonomia/categoria por IA · E4 Atributos por IA (closed-set) | Sai do regex por nicho | ✅ Em produção |
| **2 — 2º canal** | E5 Conector **Shopee** · E6 Orquestração multicanal · **E6b Estoque único cross-canal** | Publica em ML + Shopee de uma fonte única, com baixa de estoque sincronizada | ✅ **E6 em produção** (ADR-0061, 2026-07-06); 📋 E5/E6b pendentes — ver [[Publicação Shopee]] |
| **3 — Virar SaaS** | E7 Multi-tenancy · E8 Billing (Asaas) + LGPD · E9 Operação SaaS | Multi-cliente, cobrável, escalável | ✅ **E7 em produção** (ADR-0027, 2026-07-06); 📋 E8/E9 pendentes — ver [[Billing]], [[Segurança]] |

**Ordem executada (Diego, 2026-07-02): E7 → E6** — ambos concluídos e em produção (2026-07-06).
Restam **E5** (conector Shopee, próximo) e **E6b** (estoque único cross-canal); a validação plena
de E6/E6b com 2 canais depende do E5. Planos em `docs/superpowers/plans/2026-07-02-*`.

**Nota:** o `E7` fechou o gap de isolamento — antes era **operação compartilhada** (ADR-0047,
`is_membro_operacao()`); agora há isolamento real por `org_id` (`current_org_id()`, ADR-0027).

## Escopo fora do MVP original (`docs/ROADMAP.md`)

- 📋 Outros marketplaces (Shopee, Magalu, Amazon) — Fase 2 (E5/E6); ver [[Amazon]]
- ❌ Tecidos — adiado pra v2; coberto pela generalização por IA da Fase 1
- ❌ Sincronização contínua sem re-importar planilha — v3
- ~~📋 Multi-usuário com permissões diferentes~~ — **entregue**: permissão de menu (ADR-0047) +
  isolamento real por `org_id` no `E7` (ADR-0027, em produção)
- ❌ Análise de performance pós-publicação (vendas, visualizações)
- ❌ Bot/IA respondendo perguntas no ML (hoje IA só **sugere**, operador envia — ver [[IA]])
- ~~❌ Sincronização de estoque em tempo real~~ — **virou o épico `E6b`** (2026-07-02): baixa
  na venda paga + push absoluto cross-canal + reconciliação diária
- ❌ Tabela "de-para" fornecedor → cor
- ❌ Estratégias de preço configuráveis por lote
- ❌ Dashboard analítico
