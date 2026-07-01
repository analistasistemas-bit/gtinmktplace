---
tags: [ia, serena]
atualizado: 2026-07-01
---

# Serena

MCP de navegação de código via LSP (Language Server Protocol) — usado por agentes de IA para
localizar símbolos, referências e definições sem precisar ler arquivos inteiros. Ver [[Agentes]].

## Configuração neste projeto

`.serena/project.yml` (local, **não versionado** — toda a pasta `.serena/` está no
`.gitignore`): `project_name: "Anuncios MktPlace"`, `languages: [typescript]` — cobre `src/` e
`supabase/functions/` (Deno/TS). Sem customização adicional além do padrão.

`.serena/project.local.yml` — override local, vazio/template hoje.

`.serena/memories/` — memórias persistentes do Serena sobre o projeto; **vazio** no momento
desta nota.

## O que fica fora do git

`.serena/` (config local da ferramenta) está no `.gitignore` — é estado de ferramenta, não
código do projeto. `.serena_backup/` aparece como não-rastreado mas **não** está no
`.gitignore` — parece resíduo solto, não uma exclusão deliberada.
