---
tags: [ia, graphify]
atualizado: 2026-09-03
---

# Graphify

Ferramenta usada para gerar o grafo de conhecimento do código-fonte e documentação. As fontes de verdade de
arquitetura são `docs/` e `docs/decisions/`; o Graphify confirma relações no código. Ver
[[Arquitetura Geral]], [[Agentes]].

## Como é usado neste projeto

- **Grafo canônico unificado:** `graphify-out/` na raiz cobre o repositório completo (`docs/`, `supabase/`, `src/`, `obsidian-vault/`), com mais de 14 mil nós.
- **Resultado auditado (2026-09-03):** 14.699 nós, 22.126 arestas e 3.056 comunidades no grafo unificado, após aplicação de poda de 353 arestas falsas.
- **Poda de arestas impossíveis (`scripts/graphify-podar-falsos.py`):**
  - Regra A: `src/**` (browser) e `supabase/functions/<função>/**` (Deno) nunca se importam diretamente. Exceção: `supabase/functions/_shared/**` é código isomórfico importado por ambos (nunca podado).
  - Regra B: Nada de produção importa arquivos de teste.
  - Regra C: Referências fantasmas onde o identificador não existe no arquivo de origem (ex.: colisões de homônimos).

## God nodes identificados (mais conectados)

`cn()` (merge de className), `fmtBRL()`, `Button`, `corsHeaders`/`adminClient()`/
`handleOptions()` (backend), `supabase` client, `round2()`/`fmtInt()`, `Periodo`. Ver [[Frontend]],
[[Backend]].

## Onde vive a saída

`graphify-out/` na raiz do projeto (o grafo canônico). Arquivos gerados não são versionados na main
(exceto releases e relatórios congelados quando demandado).

## Procedimento Canônico de Atualização

```bash
# 1. Re-extrair arquivos de código modificados sem gastar tokens LLM
graphify update .

# 2. Podar arestas falsas (obrigatório, conforme GEMINI.md)
python3 scripts/graphify-podar-falsos.py --aplicar

# 3. Reclusterizar e regenerar GRAPH_REPORT.md
graphify cluster-only . --no-label
```

## Cuidados operacionais aprendidos

- `EnterWorktree` parte da `origin/main` — fazer `git push` após cada merge evita worktrees
  desatualizados nas próximas rodadas.
- Ao trocar de escopo (ex.: de `src`+`supabase` para `docs`), o graphify se recusa a sobrescrever
  um `graph.json` maior por um menor (guarda anti-shrink) — use `force=True` quando a troca de
  escopo for intencional.
