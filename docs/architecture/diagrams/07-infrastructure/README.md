# 07 · Infraestrutura Simplificada

**Tipo Archify:** `architecture` · **Status:** AS-IS

## Especificação (antes da geração)

- **Mensagem principal:** tudo roda em 3 provedores gerenciados (Render, Supabase, Upstash) + 4 serviços externos — sem servidores próprios, sem Kubernetes, sem múltiplos ambientes.
- **Público:** pessoa de infraestrutura, novo desenvolvedor.
- **Elementos:** os mesmos contêineres do diagrama 02, mas com foco em onde rodam e como fazem deploy (não em responsabilidade lógica).
- **Relações:** iguais ao diagrama 02 — mantidas para orientação espacial, sem labels de protocolo (repetiriam o diagrama 02 sem necessidade).
- **Direção de leitura:** igual ao diagrama 02 (mesmo layout, para facilitar comparação).
- **Omitido:** detalhes de rede (VPC, IP, DNS) — não há; regras de protocolo (ver [02](../02-general-architecture/)).
- **Fontes principais:** `CLAUDE.md` (comandos de migration/deploy); `docs/how-to/deploy-e-migrations.md`; `docs/how-to/desenvolvimento-local.md`.

## O que mostra

Onde cada peça do PubliAI executa fisicamente e como vai parar lá: Frontend no Render (Static Site), backend inteiramente no Supabase (Postgres, Auth, Storage, Vault, Edge Functions), fila/cache no Upstash (QStash, Redis) — todos gerenciados (zero servidor próprio) — e os 4 serviços externos.

## Como ler

Mesmo layout do diagrama 02 (Arquitetura Geral), mas cada caixa mostra onde roda e como se faz deploy, não o protocolo de comunicação. Os cards concentram o que realmente diferencia esta visão: comandos de deploy, lacunas de observabilidade e a ausência de ambientes de staging.

## Fontes

- `CLAUDE.md` (seção "Comandos" — migrations só via CLI, ADR-0043; edge functions via CLI completa)
- `docs/how-to/deploy-e-migrations.md`
- `docs/how-to/desenvolvimento-local.md` (Supabase local, `.env.local`)

## Limitações

- Não representa rede/DNS/CDN (Render e Supabase abstraem isso — não há configuração própria relevante).
- Não mostra os workers isolados por worktree usados em desenvolvimento (são um detalhe de fluxo de trabalho do time, não da infraestrutura de produção).
- "Observabilidade" e "Ambientes" nos cards documentam uma lacuna conhecida, não uma solução implementada.

## Atualização

- **Última revisão:** 2026-07-19.
- **Regenerar quando:** trocar de provedor (Render/Supabase/Upstash); adicionar staging; adotar stack de observabilidade dedicada.
- **Como regenerar:**
  ```bash
  node bin/archify.mjs validate architecture <caminho>/diagram.architecture.json --json
  node bin/archify.mjs render architecture <caminho>/diagram.architecture.json <caminho>/diagram.html
  ```
  Exportar SVG/PNG: ver `docs/architecture/archify-usage.md`.
