---
tags: [roadmap, backlog]
atualizado: 2026-07-02
---

# Backlog

Fonte: `docs/ROADMAP.md` ("Evolução v2 — SaaS multicanal" + "Escopo fora do MVP"). Ver
[[Próximas Features]], [[Sprint Atual]].

## Evolução v2 — 10 épicos (abordagem strangler fig)

| Fase | Épicos | Entrega | Status |
|---|---|---|---|
| **0 — Fundação** | E1 Camada de abstração de canais · E2 Modelo de dados multicanal | ML atrás de interface; catálogo agnóstico | ✅ Em produção |
| **1 — Qualquer produto** | E3 Taxonomia/categoria por IA · E4 Atributos por IA (closed-set) | Sai do regex por nicho | ✅ Em produção |
| **2 — 2º canal** | E5 Conector **Shopee** · E6 Orquestração multicanal · **E6b Estoque único cross-canal** | Publica em ML + Shopee de uma fonte única, com baixa de estoque sincronizada | 📋 E6/E6b planejados (planos prontos); E5 adiado — ver [[Publicação Shopee]] |
| **3 — Virar SaaS** | E7 Multi-tenancy · E8 Billing (Asaas) + LGPD · E9 Operação SaaS | Multi-cliente, cobrável, escalável | 📋 **E7 é o próximo épico** (plano pronto, decisão 2026-07-02) — ver [[Billing]], [[Segurança]] |

**Ordem de execução decidida (Diego, 2026-07-02): E7 → E6 → E6b** (E5 depois). Racional: o
objetivo é SaaS multi-empresa com isolamento por org; E6/E6b nascem tenant-aware; a validação
plena de E6/E6b exige o 2º canal do E5. Planos completos em `docs/superpowers/plans/2026-07-02-*`.

**Nota de atualização:** parte do `E7` já foi antecipada — multiusuário com permissão de menu
(ADR-0047) está em produção, mas ainda em **operação compartilhada** (sem `org_id`/isolamento
real por empresa). O plano do E7 fecha exatamente esse gap.

## Escopo fora do MVP original (`docs/ROADMAP.md`)

- 📋 Outros marketplaces (Shopee, Magalu, Amazon) — Fase 2 (E5/E6); ver [[Amazon]]
- ❌ Tecidos — adiado pra v2; coberto pela generalização por IA da Fase 1
- ❌ Sincronização contínua sem re-importar planilha — v3
- ~~📋 Multi-usuário com permissões diferentes~~ — **parcialmente entregue** (ADR-0047), full
  isolamento continua no `E7`
- ❌ Análise de performance pós-publicação (vendas, visualizações)
- ❌ Bot/IA respondendo perguntas no ML (hoje IA só **sugere**, operador envia — ver [[IA]])
- ~~❌ Sincronização de estoque em tempo real~~ — **virou o épico `E6b`** (2026-07-02): baixa
  na venda paga + push absoluto cross-canal + reconciliação diária
- ❌ Tabela "de-para" fornecedor → cor
- ❌ Estratégias de preço configuráveis por lote
- ❌ Dashboard analítico
