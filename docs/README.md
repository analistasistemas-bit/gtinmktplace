# PubliAI — Documentação do Projeto

Sistema interno que transforma planilhas de produtos da empresa em anúncios publicados no Mercado Livre, usando IA como copywriter especializado em aviamentos.

## Visão rápida

- **Problema:** publicar manualmente dezenas de milhares de produtos no marketplace é lento, repetitivo e produz anúncios de baixa qualidade.
- **Solução:** pipeline web interno que recebe planilha + imagens, gera copy persuasiva via IA (com vision para detectar cor quando ausente), verifica concorrência no ML, oferece revisão em lote e publica via API.
- **Primeiro escopo:** aviamentos (linha, botão, fita) → tecidos em versão futura.
- **Usuário-operador:** 1 funcionário interno; lotes típicos de ~50 produtos por família.

## Estrutura desta documentação

```
docs/
├── README.md                      ← você está aqui (índice geral)
├── ROADMAP.md                     ← visão estratégica das fases (vivo)
├── TASKS.md                       ← checklist operacional do dia a dia (vivo)
├── decisions/                     ← ADRs: Architecture Decision Records (imutáveis)
│   ├── README.md                  ← como ler e escrever ADRs
│   ├── 0001-stack-tecnologico.md
│   ├── 0002-mvp-aviamentos-primeiro.md
│   ├── 0003-variacoes-agrupadas-por-pai.md
│   ├── 0004-atribuicao-de-cor.md
│   ├── 0005-lifecycle-publish-and-update.md
│   ├── 0006-qstash-em-vez-de-postgres-queue.md
│   ├── 0007-modelo-de-dados-4-tabelas.md
│   ├── 0008-estrategia-de-preco-condicional.md
│   ├── 0009-campos-payload-ml-e-categoria-deterministica.md
│   ├── 0010-openrouter-em-vez-de-openai-direto.md
│   └── 0011-redirect-uri-via-edge-function.md
└── superpowers/
    ├── specs/                     ← spec formal do design (1 por marco de planejamento)
    │   ├── 2026-05-26-publiai-design.md
    │   └── 2026-05-28-foto-capa-familia-design.md
    └── plans/
        └── 2026-05-28-plan-05-foto-capa.md
```

## Documentos vivos vs imutáveis

- **Vivos** (`ROADMAP.md`, `TASKS.md`) — atualize livremente conforme o projeto avança. São o "agora" do projeto.
- **Imutáveis** (`decisions/*`) — uma vez aceito, um ADR não é editado. Se uma decisão muda, criamos um novo ADR que substitui (com referência ao antigo via "Substituído por").
- **Spec formal** (`superpowers/specs/*`) — congela o estado de uma fase de planejamento. Nova fase = novo spec.

## Onde encontrar o quê

| Quero saber... | Vá para |
|---|---|
| Por que escolhemos Supabase + Render + Upstash | [decisions/0001](decisions/0001-stack-tecnologico.md) |
| Por que começamos por aviamentos, não tecidos | [decisions/0002](decisions/0002-mvp-aviamentos-primeiro.md) |
| Como variações funcionam no anúncio do ML | [decisions/0003](decisions/0003-variacoes-agrupadas-por-pai.md) |
| Como o sistema descobre a cor de cada variação | [decisions/0004](decisions/0004-atribuicao-de-cor.md) |
| O que acontece quando re-importa uma família já publicada | [decisions/0005](decisions/0005-lifecycle-publish-and-update.md) |
| Por que usamos QStash em vez de fila no Postgres | [decisions/0006](decisions/0006-qstash-em-vez-de-postgres-queue.md) |
| Schema do banco e por que essas tabelas | [decisions/0007](decisions/0007-modelo-de-dados-4-tabelas.md) |
| Como o sistema decide entre preço próprio e competitivo | [decisions/0008](decisions/0008-estrategia-de-preco-condicional.md) |
| Quais campos do payload ML existem e como a categoria é definida | [decisions/0009](decisions/0009-campos-payload-ml-e-categoria-deterministica.md) |
| Por que usamos OpenRouter em vez de OpenAI direto | [decisions/0010](decisions/0010-openrouter-em-vez-de-openai-direto.md) |
| Por que o redirect URI do OAuth ML aponta para Edge Function e não pro frontend | [decisions/0011](decisions/0011-redirect-uri-via-edge-function.md) |

## Status do projeto

- 🟢 **Brainstorming + spec formal:** concluídos (2026-05-26)
- 🟢 **M0 (setup) + M1 (UI mockup) + M2 (backend core) + M3 (IA copywriting + Vision):** ✅ entregues, em produção em https://ean2marketplace-frontend.onrender.com
- 🟢 **M3.1 (foto-capa + polimento UX):** ✅ entregue (2026-05-28) — foto-capa por família, template emoji, regenerar copy, badge compacto, GTIN editável. 101/101 testes.
- 🟢 **App Mercado Livre Developers:** ✅ criada (PubliAI, Client ID 5907788004648058)
- 🔴 **M4 (integração ML), M5 (polimento), M6 (lançamento):** futuros

## Stack confirmado

- **Frontend:** React 18 + TypeScript + Vite + shadcn/ui + Tailwind + TanStack Query
- **Backend / DB / Storage / Auth:** Supabase (Postgres + Edge Functions + Storage + Realtime)
- **Hospedagem do frontend:** Render Static Site
- **Fila + cache:** Upstash QStash (fila assíncrona com retry) + Upstash Redis (cache de concorrência)
- **IA:** OpenAI GPT-4o-mini (copy) + OpenAI Vision (detecção de cor por foto)
- **Integração externa:** Mercado Livre API (OAuth 2.0)

## Autoria

- **Brainstorming:** Diego (cliente + desenvolvedor, funcionário interno da empresa) + Claude Code
- **Proposta original:** Leonardo Freitas (proposta comercial v1.1, 21/05/2026 — inviável financeiramente)
- **Data de início:** 25/05/2026
