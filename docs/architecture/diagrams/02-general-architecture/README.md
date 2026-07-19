# 02 · Arquitetura Geral

**Tipo Archify:** `architecture` · **Status:** AS-IS · **Inspirado em C4 nível 2 (contêineres)**

## Especificação (antes da geração)

- **Mensagem principal:** Edge Functions é o hub de tudo — fala com Postgres, Storage, Vault, QStash, Redis e os sistemas externos; o frontend nunca acessa banco/filas diretamente.
- **Público:** novo desenvolvedor, arquiteto.
- **Elementos:** Frontend SPA, Auth, Edge Functions, Postgres, Storage, Vault (grupo Supabase); QStash, Redis (grupo Upstash); Mercado Livre, Mercado Pago, OpenRouter, Telegram (externos).
- **Relações:** ver conexões no JSON — todas partem ou chegam em Edge Functions, exceto Frontend→Auth (login direto).
- **Direção de leitura:** Frontend (esquerda) → Edge Functions (centro) → Supabase (acima) / Upstash (abaixo) / externos (direita).
- **Omitido:** as ~35 funções individuais (ver [reference/edge-functions.md](../../../reference/edge-functions.md)); detalhes de RLS por tabela (ver [05](../05-simplified-data-model/)).
- **Fontes principais:** `docs/explanation/arquitetura.md`; `obsidian-vault/01-Arquitetura/Arquitetura Geral.md`; `docs/diagrams/c4-n2-conteineres.drawio` (versão anterior, pré-E6/E7).

## O que mostra

Os contêineres internos do PubliAI e como eles se comunicam: Frontend (SPA), a camada de Edge Functions (o hub — Deno, ~35 funções), a persistência do Supabase (Postgres com RLS, Storage, Auth, Vault) e a infraestrutura assíncrona do Upstash (QStash, Redis), além dos 4 sistemas externos.

## Como ler

O Frontend só fala com Auth (login) e Edge Functions (todo o resto). Edge Functions é o único componente que toca banco, storage, fila, cache e sistemas externos — nada mais acessa Postgres ou o Mercado Livre diretamente. As setas tracejadas marcam comunicação assíncrona (fila, webhook, alertas); as cheias marcam síncrono.

## Fontes

- `docs/explanation/arquitetura.md` (seções "Pipeline ponta a ponta", "Autenticação e fronteiras de confiança")
- `obsidian-vault/01-Arquitetura/Arquitetura Geral.md` (diagrama de contêineres C4 N2, mermaid)
- `docs/diagrams/c4-n2-conteineres.drawio` — versão anterior (2026-06-28, **pré-E6/E7**); mantido como referência histórica, não substituído (formatos diferentes: drawio vs. Archify)
- Graphify (snapshot 2026-07-18): confirmou que `_shared/canais/mercado-livre.ts`, `publish-familia-ml`, `update-familia-ml` e `publicar-anuncio/processar.ts` pertencem a comunidades de código distintas dentro de Edge Functions — não alterou o conteúdo deste diagrama (nível de abstração acima do código)

## Limitações

- Não distingue as ~35 funções individualmente nem a orquestração multicanal (fan-out por família×canal) — ver [03](../03-publication-flow/) e [04](../04-marketplace-sync/).
- Não mostra o isolamento por organização dentro do Postgres — ver [06](../06-multi-tenant/).
- `verify_jwt` diverge por função (algumas funções acionadas por QStash/webhook têm configuração inconsistente no `config.toml`) — risco conhecido, não representado aqui; ver nota em `docs/reference/edge-functions.md`.

## Atualização

- **Última revisão:** 2026-07-19.
- **Regenerar quando:** novo serviço externo for adicionado; camada de persistência mudar (novo banco/cache); Edge Functions deixar de ser o único ponto de acesso a dados.
- **Como regenerar:**
  ```bash
  node bin/archify.mjs validate architecture <caminho>/diagram.architecture.json --json
  node bin/archify.mjs render architecture <caminho>/diagram.architecture.json <caminho>/diagram.html
  ```
  Exportar SVG/PNG: ver `docs/architecture/archify-usage.md`.
