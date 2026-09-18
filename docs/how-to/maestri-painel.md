# Painel gerado do RoadmapMaestri

Como registrar fase e ler o status do time de agentes Maestri. Ver `memory/LogMaestri.md` (entradas
de 2026-09-18, "PAINEL GERADO") para o design completo e os critérios de aceite.

## Assinatura

```
scripts/maestri-fase.sh <fase> "<Agente>" ["nota"] [--tarefa T] [--aguarda A] [--entrega E] [--fim]
```

- `<fase>` — uma das 9: `0 1 2 3a 3b 4 5 6 7`.
- `<Agente>` — um dos 9 nomes válidos: `Spec`, `Arquiteto`, `Frontend`, `Backend`, `Reviewer`,
  `"Testes / Verificador"`, `Docs`, `"Release / Github"`, `Orquestrador`.
- `[nota]` — texto livre de uma linha, opcional (3º posicional).

## Semântica

- **Sem `--fim`**: abre a fase (se nunca foi aberta) ou reentra nela (incrementa `rodadas`, zera
  `fim`). Também atualiza `fase_atual`, `responsavel` e `desde` do state.
- **Com `--fim`**: fecha a fase (grava `fim`) e **não** muda `fase_atual` — avançar de fase é a
  próxima chamada sem `--fim`, já na fase seguinte.
- **`--aguarda ""`** (string vazia): limpa a pendência com Diego (`aguarda_diego = null`).
  `--aguarda "texto"` grava a pendência.

## O que é gerado — nunca editar à mão

- `memory/RoadmapMaestri.md` — regenerado por `scripts/maestri-painel.sh` a partir só de
  `memory/maestri-state.json` (nunca lê `LogMaestri.md`). Sincroniza também a nota do canvas
  `roadmapmaestri-time-de-age`.
- `memory/maestri-state.json` — fonte de verdade do estado. Ambos os arquivos estão no
  `.gitignore` (junto com os temporários `memory/.maestri-state.*` e `memory/.roadmap.*`).

`maestri-fase.sh` chama `maestri-painel.sh` automaticamente ao final de cada chamada
(auto-refresh) — não é preciso rodar os dois.

## Variáveis de teste — nunca em produção

- `MAESTRI_STATE=<caminho>` — substitui `memory/maestri-state.json`.
- `MAESTRI_LOG=<caminho>` — substitui `memory/LogMaestri.md`.
- `MAESTRI_SKIP_NOTE=1` — pula a sincronização da nota do canvas (imprime o que enviaria).

Usar as três ao testar em scratch para não sujar o log/state reais.

## Exit codes

- `2` — argumento inválido (fase/agente fora da allowlist, flag sem valor).
- `3` — state corrompido ou com schema incompleto (faltam chaves das 9 fases).
- `4` — âncora de repositório não resolvida (`git rev-parse` falhou e nenhuma env var de teste foi
  definida).
