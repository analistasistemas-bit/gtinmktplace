#!/usr/bin/env bash
# maestri-painel.sh — gera memory/RoadmapMaestri.md a partir do state e sincroniza o canvas.
# Fonte única: memory/maestri-state.json. Nunca lê o log de decisões do time.
# Contrato: entrada "Orquestrador — contrato consolidado, Fase 3b liberada" (2026-09-18).
set -euo pipefail

resolve_main() {
  local gcd
  gcd="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  dirname "$gcd"
}

if [[ -n "${MAESTRI_STATE:-}" ]]; then
  STATE="$MAESTRI_STATE"
else
  MAIN="$(resolve_main)" || { echo "erro: git rev-parse falhou e MAESTRI_STATE não foi definida" >&2; exit 4; }
  STATE="$MAIN/memory/maestri-state.json"
fi

# derivado do diretório do state (D5) — não é uma 4ª env var, senão contradiria o contrato
ROADMAP="$(dirname "$STATE")/RoadmapMaestri.md"

if [[ ! -f "$STATE" ]]; then
  echo "erro: state ausente: $STATE" >&2
  exit 3
fi

# ponytail: sem lock aqui — painel concorrente pode publicar snapshot vencido
# (achado 2 do gate de 2026-09-18, aceito). Teto: RoadmapMaestri.md/nota podem
# ficar um ciclo atrás; auto-corrige na próxima chamada de maestri-fase.sh.
# Upgrade: adquirir o mesmo lock sobre :28→:121 (read→mv do roadmap) se o
# atraso passar a ser observado na prática.
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

# Duração de "COM QUEM" (D2): jq não faz aritmética de data com offset; único ponto do
# script que sai para o shell. date -Iseconds grava offset com dois-pontos (-03:00);
# o -j do BSD date exige sem (-0300) — daí o sed antes do parse.
DESDE="$(jq -r '.desde // empty' <<<"$CURRENT")"
DURATION=""
if [[ -n "$DESDE" ]]; then
  NOW_EPOCH="$(date +%s)"
  DESDE_NORM="$(printf '%s' "$DESDE" | sed 's/\(.*\):/\1/')"
  DESDE_EPOCH="$(date -j -f '%Y-%m-%dT%H:%M:%S%z' "$DESDE_NORM" +%s 2>/dev/null)" || DESDE_EPOCH=""
  if [[ -n "$DESDE_EPOCH" ]]; then
    DELTA=$(( NOW_EPOCH - DESDE_EPOCH ))
    (( DELTA < 0 )) && DELTA=0
    DURATION="$(( DELTA / 3600 ))h$(( (DELTA % 3600) / 60 ))m"
  fi
fi

BODY="$(jq -r --arg duration "$DURATION" '
def fmtts:
  if . == null then "—"
  else .[8:10] + "/" + .[5:7] + " " + .[11:16]
  end;

. as $root
| ($root.fase_atual // null) as $fa
| ($root.responsavel // null) as $resp
| ($root.desde // null) as $desde
| ($root.tarefa // null) as $tarefa
| ($root.entrega // null) as $entrega
| ($root.aguarda_diego // "") as $ag
| ["0","1","2","3a","3b","4","5","6","7"] as $ordem
| ($ordem | index($fa)) as $idx
| (if $fa == "7" then null
   elif $idx == null then null
   else $ordem[$idx + 1]
   end) as $prox_key
| (if $prox_key != null then ($prox_key + " — " + ($root.fases[$prox_key].nome))
   elif $fa == "7" then "— (fim do fluxo)"
   else "—"
   end) as $proximo
| [
    "**TAREFA:** " + ($tarefa // "—"),
    "**FASE:** " + ($fa // "—") + " de 7" + (if $fa != null then " — " + $root.fases[$fa].nome else "" end),
    "**COM QUEM:** " + ($resp // "—")
      + (if $desde != null then " — desde " + ($desde | fmtts) + (if $duration != "" then " (" + $duration + ")" else "" end) else "" end),
    (if ($ag | length) > 0 then "🔴 **AGUARDA VOCÊ:** " + $ag else empty end),
    "**PRÓXIMO:** " + $proximo,
    "**ENTREGA:** " + ($entrega // "—"),
    "",
    "### Últimos 5 eventos",
    "",
    (if ($root.eventos | length) == 0 then "_(sem eventos)_"
     else ($root.eventos[-5:] | reverse | .[]
       | "- " + (.ts | fmtts) + " — Fase " + .fase + " — " + .agente + " — " + .acao + " — "
         + (if ((.nota // "") | length) > 0 then .nota else "—" end))
     end),
    "",
    "### Fases",
    "",
    "| Fase | Responsável | Início | Fim | Rodadas | Status |",
    "|---|---|---|---|---|---|",
    ($ordem[] as $k
      | $root.fases[$k] as $f
      | ([$root.eventos[] | select(.fase == $k)] | if length > 0 then last.agente else "—" end) as $rk
      | (if $f.inicio == null then "⏳"
         elif $f.fim == null then (if ($k == $fa) and (($ag | length) > 0) then "🔴" else "🔄" end)
         else "✅"
         end) as $status
      | "| " + $k + " — " + $f.nome + " | " + $rk + " | " + ($f.inicio | fmtts) + " | " + ($f.fim | fmtts) + " | " + ($f.rodadas | tostring) + " | " + $status + " |")
  ]
  | join("\n")
' <<<"$CURRENT")"

TITLE="# RoadmapMaestri — Time de Agentes Maestri"

ROADMAP_DIR="$(dirname "$ROADMAP")"
mkdir -p "$ROADMAP_DIR"
TMP_ROADMAP="$(mktemp "$ROADMAP_DIR/.roadmap.XXXXXX")"
trap 'rm -f "$TMP_ROADMAP"' EXIT
printf '%s\n\n%s\n' "$TITLE" "$BODY" > "$TMP_ROADMAP"
mv "$TMP_ROADMAP" "$ROADMAP"
trap - EXIT

if [[ "${MAESTRI_SKIP_NOTE:-}" == "1" ]] || ! command -v maestri >/dev/null 2>&1; then
  echo "aviso: sincronização do canvas pulada (MAESTRI_SKIP_NOTE=1 ou binário 'maestri' ausente do PATH)" >&2
  echo "--- conteúdo que seria enviado a 'maestri note write roadmapmaestri-time-de-age' ---"
  cat "$ROADMAP"
  exit 0
fi

# escape só no que vai para o canvas — o arquivo em disco fica intacto (note write decodifica \n e \t)
CONTENT_ESCAPED="$(sed 's/\\/\\\\/g' "$ROADMAP")"
set +e
NOTE_OUTPUT="$(maestri note write "roadmapmaestri-time-de-age" "$CONTENT_ESCAPED" 2>&1)"
NOTE_EXIT=$?
set -e

# "No connection" é o único caminho tratado como SKIP (E3/CA-15); qualquer OUTRA falha do
# note write precisa aparecer no stderr — engolir tudo esconde do Diego que o canvas não sincronizou
if grep -qi "no connection" <<<"$NOTE_OUTPUT"; then
  echo "aviso: canvas sincroniza pelo Orquestrador (nota roadmapmaestri-time-de-age não conectada neste terminal)" >&2
elif [[ $NOTE_EXIT -ne 0 ]]; then
  echo "erro: falha ao sincronizar o canvas (roadmapmaestri-time-de-age): $NOTE_OUTPUT" >&2
fi

exit 0
