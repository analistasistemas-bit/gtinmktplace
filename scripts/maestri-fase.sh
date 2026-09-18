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
    --tarefa|--aguarda|--entrega)
      if [[ $# -lt 2 ]]; then
        echo "erro: flag $1 exige um valor" >&2
        exit 2
      fi
      case "$1" in
        --tarefa)  TAREFA_SET=true;  TAREFA="$2" ;;
        --aguarda) AGUARDA_SET=true; AGUARDA="$2" ;;
        --entrega) ENTREGA_SET=true; ENTREGA="$2" ;;
      esac
      shift 2
      ;;
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
  gcd="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
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

STATE_DIR="$(dirname "$STATE")"
mkdir -p "$STATE_DIR"

# Lock (E11.1/E11.2): mkdir é atômico por POSIX e não é dependência nova (mkdir -p já era usado
# aqui). flock(1) não existe no macOS. Span protegido: desta aquisição até o mv do state — nunca
# através do log ou do maestri-painel.sh (achado 2, ver comentário ponytail em maestri-painel.sh).
LOCK=""
TMP_STATE=""

cleanup() {
  # preserva o exit code que disparou o trap — sem isto, o último comando aqui dentro
  # (um "[[ ]] && ..." falso quando LOCK/TMP_STATE já estão vazios) vira o exit code do script
  local rc=$?
  [[ -n "$TMP_STATE" ]] && rm -f "$TMP_STATE"
  [[ -n "$LOCK" ]] && rm -rf "$LOCK"
  return "$rc"
}
# handler ÚNICO, registrado ANTES da aquisição — nunca "trap - EXIT" depois disso: isso apagaria
# a liberação do lock inteira, não só a do temp (é o bug que o CA-15b existe para pegar).
trap cleanup EXIT INT TERM

LOCK_PATH="$STATE_DIR/.maestri-state.lock"
LOCK_TIMEOUT=10
LOCK_STEP=0.1
LOCK_STALE_AGE=30

acquire_lock() {
  local start held_pid mtime now age
  start="$(date +%s)"
  while true; do
    if mkdir "$LOCK_PATH" 2>/dev/null; then
      echo "$$" > "$LOCK_PATH/pid"
      LOCK="$LOCK_PATH"
      return 0
    fi

    held_pid="$(cat "$LOCK_PATH/pid" 2>/dev/null)" || held_pid=""
    mtime="$(stat -f %m "$LOCK_PATH" 2>/dev/null)" || mtime=0
    now="$(date +%s)"
    age=$(( now - mtime ))

    # órfão: mais velho que o teto E o dono não está vivo — nunca kill, só rm -rf + 1 retentativa
    if [[ "$age" -gt "$LOCK_STALE_AGE" ]] && { [[ -z "$held_pid" ]] || ! kill -0 "$held_pid" 2>/dev/null; }; then
      rm -rf "$LOCK_PATH"
      if mkdir "$LOCK_PATH" 2>/dev/null; then
        echo "$$" > "$LOCK_PATH/pid"
        LOCK="$LOCK_PATH"
        return 0
      fi
    fi

    if (( now - start >= LOCK_TIMEOUT )); then
      echo "erro: lock não adquirido em ${LOCK_TIMEOUT}s: $LOCK_PATH" >&2
      echo "  (detentor pid ${held_pid:-desconhecido}). Nenhuma escrita feita." >&2
      echo "  Se nenhum agente estiver rodando, libere com:  rm -rf \"$LOCK_PATH\"" >&2
      return 1
    fi

    sleep "$LOCK_STEP"
  done
}

acquire_lock || exit 6

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
  if ! jq -e '
    (.schema_version != null)
    and (.fases != null)
    and ((["0","1","2","3a","3b","4","5","6","7"] - (.fases | keys)) | length == 0)
  ' <<<"$CURRENT" >/dev/null 2>&1; then
    echo "erro: state sem .schema_version ou com .fases incompleto (faltam chaves das 9 fases): $STATE" >&2
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

# escrita atômica: mktemp no MESMO diretório do destino (E4) — mv entre volumes não é atômico
TMP_STATE="$(mktemp "$STATE_DIR/.maestri-state.XXXXXX")"
printf '%s' "$NEW" > "$TMP_STATE"

# jq empty valida o TEMP (D3, em letra) — é o arquivo que vai ser instalado, não a variável de shell
if ! jq empty "$TMP_STATE" >/dev/null 2>&1; then
  echo "erro interno: jq produziu JSON inválido no temp (sem escrita)" >&2
  exit 3
fi

mv "$TMP_STATE" "$STATE"
TMP_STATE=""

# libera o lock aqui, não no fim do script (E11.1 seção 3/5): o span protegido termina no mv;
# segurar o lock através do log/painel bloquearia outro agente pela duração do note write (D1).
# O trap `cleanup` continua registrado (nunca "trap - EXIT") — isto é uma liberação explícita,
# não uma desativação do handler.
rm -rf "$LOCK"
LOCK=""

ACAO="$(jq -r '.eventos[-1].acao' <<<"$NEW")"
NOTA_LOG="${NOTA:-—}"

LOG_DIR="$(dirname "$LOG")"
mkdir -p "$LOG_DIR"
printf -- '- [%s] Fase %s — %s — %s — %s\n' "$TS" "$FASE" "$AGENTE" "$ACAO" "$NOTA_LOG" >> "$LOG"

# auto-refresh do painel (D1): nunca propaga o exit code, escrita de state/log já concluída
"$SCRIPT_DIR/maestri-painel.sh" || echo "aviso: falha ao atualizar o painel (RoadmapMaestri.md); state e log já gravados" >&2

exit 0
