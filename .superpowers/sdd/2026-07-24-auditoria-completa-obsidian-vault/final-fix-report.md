# Correção final — Auditoria completa do Obsidian Vault

Data: 2026-07-24

## Escopo

- Corrigido exclusivamente `docs/superpowers/plans/2026-07-24-auditoria-completa-obsidian-vault.md`.
- Nenhum arquivo em `obsidian-vault/` ou `vault/spec` foi alterado.

## Correções

- A Task 1 agora materializa `graphify-out/graph.json` no worktree a partir de
  `PUBLIAI_GRAPHIFY_SNAPSHOT`, que deve ser um snapshot imutável fornecido pela orquestração e
  nunca outro checkout.
- A consulta Graphify usa exclusivamente `--graph "graphify-out/graph.json"` local.
- Todos os comandos shell exibidos no plano usam `rtk`; cada lado dos pipelines também usa o
  prefixo.

## Comandos e evidência

```bash
rtk rg -n '/Users/diego/Desktop/IA/Anuncios MktPlace/graphify-out' docs/superpowers/plans/2026-07-24-auditoria-completa-obsidian-vault.md
rtk awk '/^```bash/{inside=1; next} inside && /^```/{inside=0; next} inside && NF && $1 != "rtk" && $0 !~ /^[[:space:]]/{print NR ":" $0; invalid=1} END{exit invalid}' docs/superpowers/plans/2026-07-24-auditoria-completa-obsidian-vault.md
rtk awk '/^```bash/{inside=1; next} inside && /^```/{inside=0; next} inside && /[[:space:]]\\|[[:space:]]/{count=split($0, segment, /[[:space:]]\\|[[:space:]]+/); for (part_index=2; part_index<=count; part_index++) if (segment[part_index] !~ /^rtk[[:space:]]/) {print NR ":" $0; invalid=1}} END{exit invalid}' docs/superpowers/plans/2026-07-24-auditoria-completa-obsidian-vault.md
rtk git diff --check
```

Resultado: a primeira busca retornou código 1, que neste caso significa zero ocorrências. As duas
verificações estruturais e `git diff --check` retornaram código 0: não há comando ou segmento de
pipeline sem `rtk`, nem erro de whitespace.
