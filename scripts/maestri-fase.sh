#!/usr/bin/env bash
# maestri-fase.sh <fase> <agente> [nota] [--tarefa T] [--aguarda A] [--entrega E] [--fim]
# Única porta de escrita do state/log do painel RoadmapMaestri. Contrato: memory/LogMaestri.md,
# entrada "Orquestrador — contrato consolidado, Fase 3b liberada" (2026-09-18).
set -euo pipefail

usage() {
  echo "uso: maestri-fase.sh <fase> <agente> [nota] [--tarefa T] [--aguarda A] [--entrega E] [--fim]" >&2
}

if [[ $# -lt 2 ]]; then
  usage
  exit 2
fi

FASE="$1"; AGENTE="$2"; shift 2

case "$FASE" in
  0|1|2|3a|3b|4|5|6|7) ;;
  *)
    echo "erro: fase inválida: $FASE" >&2
    echo "válidas: 0 1 2 3a 3b 4 5 6 7" >&2
    exit 2
    ;;
esac

case "$AGENTE" in
  Spec|Arquiteto|Frontend|Backend|Reviewer|"Testes / Verificador"|Docs|"Release / Github"|Orquestrador) ;;
  *)
    echo "erro: agente inválido: $AGENTE" >&2
    echo 'válidos: Spec, Arquiteto, Frontend, Backend, Reviewer, "Testes / Verificador", Docs, "Release / Github", Orquestrador' >&2
    exit 2
    ;;
esac

NOTA=""
TAREFA_SET=false; TAREFA=""
AGUARDA_SET=false; AGUARDA=""
ENTREGA_SET=false; ENTREGA=""
FIM=false

if [[ $# -gt 0 && "$1" != --* ]]; then
  NOTA="$1"; shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tarefa)   TAREFA_SET=true;   TAREFA="${2:-}";   shift 2 ;;
    --aguarda)  AGUARDA_SET=true;  AGUARDA="${2:-}";  shift 2 ;;
    --entrega)  ENTREGA_SET=true;  ENTREGA="${2:-}";  shift 2 ;;
    --fim)      FIM=true; shift ;;
    *)
      echo "erro: argumento desconhecido: $1" >&2
      exit 2
      ;;
  esac
done

# quebra de linha destrói o formato de uma linha do log e do cabeçalho (E6)
NOTA="$(printf '%s' "$NOTA" | tr '\n' ' ')"
TAREFA="$(printf '%s' "$TAREFA" | tr '\n' ' ')"
AGUARDA="$(printf '%s' "$AGUARDA" | tr '\n' ' ')"
ENTREGA="$(printf '%s' "$ENTREGA" | tr '\n' ' ')"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolução de caminhos (D5): env var > $MAIN/memory/... > exit 4. Nenhum fallback além destes.
resolve_main() {
  local gcd
  gcd="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  dirname "$gcd"
}

MAIN=""
if [[ -n "${MAESTRI_STATE:-}" ]]; then
  STATE="$MAESTRI_STATE"
else
  MAIN="$(resolve_main)" || { echo "erro: git rev-parse falhou e MAESTRI_STATE não foi definida" >&2; exit 4; }
  STATE="$MAIN/memory/maestri-state.json"
fi

if [[ -n "${MAESTRI_LOG:-}" ]]; then
  LOG="$MAESTRI_LOG"
else
  if [[ -z "$MAIN" ]]; then
    MAIN="$(resolve_main)" || { echo "erro: git rev-parse falhou e MAESTRI_LOG não foi definida" >&2; exit 4; }
  fi
  LOG="$MAIN/memory/LogMaestri.md"
fi

BOOTSTRAP='{
  "schema_version": 1,
  "tarefa": null,
  "fase_atual": null,
  "responsavel": null,
  "desde": null,
  "aguarda_diego": null,
  "entrega": null,
  "fases": {
    "0":  { "nome": "Setup/time",           "inicio": null, "fim": null, "rodadas": 0 },
    "1":  { "nome": "Spec",                 "inicio": null, "fim": null, "rodadas": 0 },
    "2":  { "nome": "Arquitetura",          "inicio": null, "fim": null, "rodadas": 0 },
    "3a": { "nome": "Frontend",             "inicio": null, "fim": null, "rodadas": 0 },
    "3b": { "nome": "Backend",              "inicio": null, "fim": null, "rodadas": 0 },
    "4":  { "nome": "Review",               "inicio": null, "fim": null, "rodadas": 0 },
    "5":  { "nome": "Testes/Verificação",   "inicio": null, "fim": null, "rodadas": 0 },
    "6":  { "nome": "Docs",                 "inicio": null, "fim": null, "rodadas": 0 },
    "7":  { "nome": "Release",              "inicio": null, "fim": null, "rodadas": 0 }
  },
  "eventos": []
}'

if [[ -f "$STATE" ]]; then
  CURRENT="$(cat "$STATE")"
  if ! jq empty <<<"$CURRENT" >/dev/null 2>&1; then
    echo "erro: state JSON inválido: $STATE" >&2
    exit 3
  fi
  if ! jq -e '(.fases != null) and (.schema_version != null)' <<<"$CURRENT" >/dev/null 2>&1; then
    echo "erro: state sem .fases/.schema_version: $STATE" >&2
    exit 3
  fi
else
  CURRENT="$BOOTSTRAP"
fi

TS="$(date -Iseconds)"

# Único jq monta o state novo (D3/D7): lê o inicio original da fase, decide abrir/reentrar/fechar,
# aplica --tarefa/--aguarda/--entrega quando presentes, e acrescenta o evento (append-only).
NEW="$(jq \
  --arg fase "$FASE" \
  --arg agente "$AGENTE" \
  --arg ts "$TS" \
  --arg nota "$NOTA" \
  --argjson fim "$FIM" \
  --argjson tarefa_set "$TAREFA_SET" --arg tarefa "$TAREFA" \
  --argjson aguarda_set "$AGUARDA_SET" --arg aguarda "$AGUARDA" \
  --argjson entrega_set "$ENTREGA_SET" --arg entrega "$ENTREGA" \
  '
  .fases[$fase].inicio as $orig_inicio
  | (if $fim then "fechou"
     elif $orig_inicio == null then "abriu"
     else "reentrou"
     end) as $acao
  | (if $fim then
      .fases[$fase].inicio = (if $orig_inicio == null then $ts else $orig_inicio end)
      | .fases[$fase].rodadas = (if $orig_inicio == null then 1 else .fases[$fase].rodadas end)
      | .fases[$fase].fim = $ts
    else
      .fases[$fase].inicio = (if $orig_inicio == null then $ts else $orig_inicio end)
      | .fases[$fase].rodadas = ((.fases[$fase].rodadas // 0) + 1)
      | .fases[$fase].fim = null
      | .fase_atual = $fase
      | .responsavel = $agente
      | .desde = $ts
    end)
  | (if $tarefa_set then .tarefa = $tarefa else . end)
  | (if $aguarda_set then .aguarda_diego = (if ($aguarda | length) == 0 then null else $aguarda end) else . end)
  | (if $entrega_set then .entrega = $entrega else . end)
  | .eventos += [{
      ts: $ts,
      fase: $fase,
      agente: $agente,
      acao: $acao,
      nota: $nota
    }]
  ' <<<"$CURRENT")"

if ! jq empty <<<"$NEW" >/dev/null 2>&1; then
  echo "erro interno: jq produziu JSON inválido (sem escrita)" >&2
  exit 3
fi

# escrita atômica: mktemp no MESMO diretório do destino (E4) — mv entre volumes não é atômico
STATE_DIR="$(dirname "$STATE")"
mkdir -p "$STATE_DIR"
TMP_STATE="$(mktemp "$STATE_DIR/.maestri-state.XXXXXX")"
trap 'rm -f "$TMP_STATE"' EXIT
printf '%s' "$NEW" > "$TMP_STATE"
mv "$TMP_STATE" "$STATE"
trap - EXIT

ACAO="$(jq -r '.eventos[-1].acao' "$STATE")"
NOTA_LOG="${NOTA:-—}"

LOG_DIR="$(dirname "$LOG")"
mkdir -p "$LOG_DIR"
printf -- '- [%s] Fase %s — %s — %s — %s\n' "$TS" "$FASE" "$AGENTE" "$ACAO" "$NOTA_LOG" >> "$LOG"

# auto-refresh do painel (D1): nunca propaga o exit code, escrita de state/log já concluída
"$SCRIPT_DIR/maestri-painel.sh" || echo "aviso: falha ao atualizar o painel (RoadmapMaestri.md); state e log já gravados" >&2

exit 0
