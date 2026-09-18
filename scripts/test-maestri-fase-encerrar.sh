#!/usr/bin/env bash
# Teste isolado da flag --encerrar (scripts/maestri-fase.sh). Não toca no state real do projeto:
# roda contra um diretório temp via MAESTRI_STATE/MAESTRI_LOG/MAESTRI_SKIP_NOTE.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

export MAESTRI_STATE="$TMPDIR/maestri-state.json"
export MAESTRI_LOG="$TMPDIR/LogMaestri.md"
export MAESTRI_SKIP_NOTE=1
ROADMAP="$TMPDIR/RoadmapMaestri.md"

fail() { echo "FALHA: $1" >&2; exit 1; }

# 1. abre e fecha a fase 3b normalmente — cabeçalho deve mostrar o responsável
"$SCRIPT_DIR/maestri-fase.sh" 3b Backend "abrindo" >/dev/null
"$SCRIPT_DIR/maestri-fase.sh" 3b Backend "fim da fase" --fim >/dev/null

grep -q '^\*\*COM QUEM:\*\* Backend' "$ROADMAP" || fail "cabeçalho não mostrou o responsável após --fim"

# 2. --encerrar marca a tarefa como concluída
"$SCRIPT_DIR/maestri-fase.sh" 3b Backend "encerrando" --encerrar >/dev/null

grep -q '^\*\*COM QUEM:\*\* — (tarefa encerrada)$' "$ROADMAP" || fail "cabeçalho não refletiu 'tarefa encerrada'"
grep -q '^\*\*PRÓXIMO:\*\* —$' "$ROADMAP" || fail "PRÓXIMO não voltou a '—' após --encerrar"

jq -e '.fase_atual == null and .responsavel == null and .desde == null and .tarefa_encerrada == true' \
  "$MAESTRI_STATE" >/dev/null || fail "state não zerou fase_atual/responsavel/desde ou não marcou tarefa_encerrada"

# 3. fase 3b continua fechada (histórico preservado — --encerrar não mexe em .fases[])
jq -e '.fases["3b"].fim != null' "$MAESTRI_STATE" >/dev/null || fail "--encerrar apagou o histórico da fase 3b"

# 4. uma nova abertura de fase reseta tarefa_encerrada e volta a mostrar o responsável
"$SCRIPT_DIR/maestri-fase.sh" 4 Reviewer "nova rodada" >/dev/null

grep -q '^\*\*COM QUEM:\*\* Reviewer' "$ROADMAP" || fail "nova fase não voltou a mostrar o responsável"
jq -e '.tarefa_encerrada == false' "$MAESTRI_STATE" >/dev/null || fail "tarefa_encerrada não voltou a false ao abrir nova fase"

echo "OK: --encerrar funciona"
