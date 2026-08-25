---
tags: [ia, graphify]
atualizado: 2026-08-24
---

# Graphify

Ferramenta usada para gerar o grafo de conhecimento do código-fonte. As fontes de verdade de
arquitetura são `docs/` e `docs/decisions/`; o Graphify confirma relações no código. Ver
[[Arquitetura Geral]], [[Agentes]].

## Como foi usado neste projeto

- **Escopo de arquitetura:** `src/` + `supabase/` mesclados num único grafo
  (`graphify extract src`, `graphify extract supabase`, `graphify merge-graphs`,
  `graphify cluster-only`) — juntos ficam sob o limite de 500 arquivos do graphify, então não
  precisa escolher um só.
- **Escopo de docs/ADRs:** rodado separadamente (`docs/` sozinho já passa de 500 arquivos e
  precisa de subagents de extração semântica para markdown/imagens).
- **Resultado auditado (2026-08-19):** 3.932 nós e 11.541 links no grafo combinado
  `src`+`supabase`, depois da poda de 11 relações falsas de produção para testes; 166 comunidades.

## God nodes identificados (mais conectados)

`cn()` (163, merge de className), `fmtBRL()` (40), `Button` (39), `corsHeaders`/`adminClient()`/
`handleOptions()` (backend), `supabase` client, `round2()`/`fmtInt()`, `Periodo`. Ver [[Frontend]],
[[Backend]].

## Onde vive a saída

`graphify-out/` (na raiz, e também `src/graphify-out/`, `supabase/graphify-out/` para os grafos
parciais) — **gitignorado**, é artefato gerado e regenerável a qualquer momento, não versionado.

## Regenerar

```bash
graphify extract src
graphify extract supabase
graphify merge-graphs src/graphify-out/graph.json supabase/graphify-out/graph.json --out graphify-out/graph.json
graphify cluster-only . --no-label
```

## Cuidados operacionais aprendidos

- `EnterWorktree` parte da `origin/main` — fazer `git push` após cada merge evita worktrees
  desatualizados nas próximas rodadas.
- Ao trocar de escopo (ex.: de `src`+`supabase` para `docs`), o graphify se recusa a sobrescrever
  um `graph.json` maior por um menor (guarda anti-shrink) — use `force=True` quando a troca de
  escopo for intencional.
