---
tags: [logs, releases]
atualizado: 2026-07-01
---

# Releases

PubliAI é uma ferramenta interna sem versionamento semântico nem tags de release (não há
`git tag` no repositório). O equivalente real são os **marcos de milestone** documentados em
`docs/ROADMAP.md` e os **épicos** da evolução SaaS. Ver [[Changelog]], [[Sprint Atual]].

> ⚠️ O cabeçalho "Estado geral" no topo de `docs/ROADMAP.md` está desatualizado (diz M4 "em
> andamento" e M5/M6 "não iniciado") — isso é um artefato do documento não ter sido atualizado
> após esses marcos avançarem. A fonte confiável do estado atual é `docs/project-status.md` e
> `docs/TASKS.md` (ver nota explícita no próprio `project-status.md`).

## Milestones concluídos (datas confirmadas em `docs/ROADMAP.md`)

| Milestone | Data | Entrega |
|---|---|---|
| M0 — Setup inicial | 2026-05-26 | Repo, Supabase, Render, Upstash, app base no ar |
| M1 — UI mockup | 2026-05-26 | UI navegável com dados fake |
| M2 — Backend core | 2026-05-27 | Ingestão real de planilha, auth, storage |
| M3 — IA copywriting + Vision | 2026-05-28 | Copy com IA, vision para cor, pipeline assíncrono |
| M3.1 — Foto-capa + polimento | 2026-05-28 | Foto-capa por família |
| Trilho ML Developers | 2026-05-27 | App criada, credenciais prontas pro M4 |

M4 (Integração Mercado Livre), M5 e M6 não têm status atualizado no `ROADMAP.md`, mas
claramente foram concluídos — o projeto está em produção com Mercado Livre há tempo e já avançou
para a fase seguinte (ver abaixo).

## Fase seguinte: Evolução SaaS multicanal (`docs/project-status.md`)

| Épico | Status |
|---|---|
| `E1`, `E1b` — camada de canais | ✅ Em produção (2026-06-14) |
| `E2` — modelo multicanal | ✅ Em produção |
| `E3` — categoria genérica | ✅ Em produção |
| `E4` — atributos por IA | ✅ Em produção |
| `E5` — conector Shopee | 📋 Próximo — ver [[Publicação Shopee]] |

Ver [[Backlog]] para os épicos `E6`–`E9`.
