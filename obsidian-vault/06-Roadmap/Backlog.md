---
tags: [roadmap, backlog]
atualizado: 2026-09-05
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
| 3 — PMF multicanal | validar a tese: Shopee real + estoque único cross-canal (E5/E6b) | 🟡 E6b em produção (2026-07-29); falta o E5 (Shopee) — próximo passo técnico |
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
| **2 — 2º canal** | E5 Conector **Shopee** · E6 Orquestração multicanal · **E6b Estoque único cross-canal + cadastro manual** | Publica em ML + Shopee de uma fonte única, com baixa de estoque sincronizada — e aceita produto cadastrado direto na UI | ✅ **E6 em produção** (ADR-0061, 2026-07-06); ✅ **E6b em produção** (ADR-0094, Blocos A e B, 2026-07-29); 📋 E5 pendente — ver [[Publicação Shopee]] |
| **3 — Virar SaaS** | E7 Multi-tenancy · E8 Billing (Asaas) + LGPD · E9 Operação SaaS | Multi-cliente, cobrável, escalável | ✅ **E7 em produção** (ADR-0027, 2026-07-06); 📋 E8/E9 pendentes — ver [[Billing]], [[Segurança]] |

**Ordem executada (Diego, 2026-07-02): E7 → E6** — ambos concluídos e em produção (2026-07-06).
O **E6b** foi ampliado e antecipado na frente do E5 (decisão de 2026-07-28) e entrou em produção
em 2026-07-29 (ADR-0094). Resta o **E5** (conector Shopee, próximo); a validação plena de E6/E6b
com 2 canais depende dele. Planos em `docs/superpowers/plans/2026-07-02-*`.

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

## Notificação push no celular (Web Push) — levantado em 2026-09-05

📋 **Desejável, não urgente.** Levantado depois que o app virou PWA instalável (ADR-0153) — a
instalação é o pré-requisito que faltava: a Apple só permite Web Push em PWA adicionado à tela de
início (iOS 16.4+). Hoje o sino do app (ADR-0085) só atualiza com o app aberto; com o app fechado,
nada chega ao celular pelo PubliAI.

**Por que é menor do que parece:** `notificarCategoria()` em `_shared/notificacoes/` já roteia
todo alerta para dois canais (Telegram e sino in-app), com assinatura por pessoa e 9 categorias.
Push entra como **terceiro canal no mesmo ponto** — nenhuma das edge functions que hoje notificam
precisa mudar.

**O que falta:** tabela de inscrições por aparelho com RLS · UI de ativação nas Configurações (a
permissão do iOS só pode ser pedida a partir de um toque) · handler `push` no service worker ·
envio com VAPID a partir do Deno · limpeza das inscrições mortas (aparelho que desinstalou
responde 410) · ligar no roteador.

**A pedra no caminho:** o service worker de hoje é gerado automaticamente (`generateSW`), sem
código nosso — foi decisão explícita do ADR-0153. Receber push obriga a migrar para `injectManifest`
e escrever o arquivo à mão, mexendo na parte mais nova do sistema e exigindo revalidar o que já
está em produção. É o maior risco do item, maior que o envio em si.

**Custo estimado:** 2 a 3 sessões, com o risco concentrado no service worker e na criptografia do
envio em Deno (funciona no teste e falha num aparelho específico é o modo de falha típico).

**A pergunta que decide:** o Telegram já toca o celular hoje. Push nativo acrescenta o ícone do
PubliAI, o badge e não depender de bot configurado — conveniência, não capacidade nova. Vale
quando o Telegram incomodar, ou quando um operador precisar receber alertas sem configurar nada.

**Decisões pendentes quando/se entrar:** (1) a notificação mostra o conteúdo ("Nova venda:
R$ 230") ou só avisa? — o texto passa pelos servidores da Apple e do Google; (2) quais das 9
categorias furam a tela — sugestão de partida: só `vendas`, `moderacao` e `integracao`, o resto
fica no sino; (3) push convive com o Telegram (recomendado) ou substitui.

Diego optou em 2026-09-05 por registrar aqui em vez de abrir ADR e planejar. Ver [[Sprint Atual]]
e `docs/decisions/0153-pwa-instalavel-sem-escrita-offline.md`.
