# ADR-0001: Stack Tecnológico

**Status:** Aceito
**Data:** 2026-05-26
**Decisores:** Diego

## Contexto

Precisamos escolher o stack tecnológico para o EAN2Marketplace. Constraints:

- **Solo developer** com perfil "vibe coder" (AI-assisted development), confortável com Python, JS/TS, React, FastAPI/NestJS
- **Prazo apertado:** 2-3 meses para entregar MVP completo (10 funcionalidades must-have)
- **MCPs já configurados localmente:** context7, Firebase, n8n-mcp, render, shadcn, Stitch, supabase-mcp-server, upstash
- **Preferência declarada:** "tenho diversos servidores MCP configurados, sempre priorize eles, quero tudo integrado aqui"
- **Orçamento operacional:** sensível a custo recorrente; proposta original do Leonardo foi rejeitada por preço

A proposta original sugeria React + TypeScript + NestJS/Python + PostgreSQL + Cloud (Azure/AWS), sem amarrar à MCPs.

## Decisão

Adotamos um stack **inteiramente baseado nos MCPs já configurados**:

| Camada | Tecnologia | MCP |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite + shadcn/ui + Tailwind + TanStack Query | `shadcn`, `render` |
| Auth + DB + Storage + Compute | Supabase (Postgres + Edge Functions + Storage + Realtime + Vault) | `supabase-mcp-server` |
| Hospedagem do frontend | Render Static Site | `render` |
| Fila assíncrona | Upstash QStash | `upstash` |
| Cache | Upstash Redis | `upstash` |
| IA copywriting + vision | OpenAI GPT-4o-mini + GPT-4o Vision | (via API direta das Edge Functions; `context7` para docs) |
| Integração marketplace | Mercado Livre API (OAuth 2.0) | (via API direta) |

## Alternativas consideradas

- **Opção A: NestJS/FastAPI + Postgres dedicado + S3 + Redis dedicado**
  - Pros: máxima flexibilidade, controle total
  - Cons: muito mais infra para um solo dev manter; tempo perdido em DevOps; não aproveita MCPs já existentes
  - Rejeitada porque viola a preferência declarada de "tudo integrado via MCP"

- **Opção B: Firebase em vez de Supabase**
  - Pros: também via MCP
  - Cons: Firestore (NoSQL) ruim para o domínio relacional (lotes → famílias → variações); auth e storage equivalentes; sem Edge Functions tão maduras
  - Rejeitada porque o domínio é fortemente relacional

- **Opção C: n8n para automação do pipeline**
  - Pros: visual, baixa codificação
  - Cons: pipeline com IA + vision + ML API exige código de orquestração customizado; n8n vira gargalo para tela de revisão em lote, que é o core do produto
  - Considerada mas reservada para automações futuras tangenciais (notificações, alertas), não para o pipeline principal

## Consequências

**Boas:**
- Tempo de setup quase zero (todos os MCPs já configurados)
- Custo operacional estimado: **$3–28/mês** para o volume esperado (~500 produtos/mês)
- Stack moderno, com documentação ampla e modelos de IA atualizados sobre ele
- Frontend e backend em TypeScript: tipos compartilhados via geração de tipos do Supabase
- Realtime do Supabase resolve elegantemente o problema de atualizar a UI conforme o processamento assíncrono progride

**Tradeoffs aceitos:**
- Dependência de 3 serviços externos (Supabase, Render, Upstash) — risco de outage cumulativo
- Edge Functions têm timeout de 150s — exige uso de QStash (resolvido pela ADR-0006)
- Limites de free tier: Supabase Free tem 500MB de Storage, 50k MAUs, 500MB de DB — provavelmente vamos precisar Pro ($25/mês) em breve
- OpenAI tem mudança de modelos frequente — código deve isolar chamadas de IA atrás de uma camada fina para facilitar troca de provedor

**Como reverter:**
- O modelo de dados é Postgres puro (sem features proprietárias do Supabase além de Auth/Storage/RLS) → migrável para Postgres self-hosted se necessário
- Frontend é React puro → pode migrar para Vercel, Cloudflare Pages, ou hospedagem própria
- QStash pode ser substituído por Inngest, Trigger.dev, ou fila no Postgres se a dependência incomodar
