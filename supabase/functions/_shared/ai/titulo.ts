// Captura metragem real do nome (ex.: "100MT", "10MT", "50 METROS", "30 M", "13,71MT").
// Jardas (J) e códigos sem unidade de metro NÃO contam. Decimal com vírgula (formato BR) é
// opcional no grupo — sem ele, "13,71MT" batia só a partir da vírgula ("71MT"), fabricando
// uma metragem que não existe no produto (bug lote #65: "13,7MT 71MT" no título, sem "71MT"
// em lugar nenhum da descrição).
const RE_METRAGEM = /(\d+(?:,\d+)?)\s*(MTS|MT|METROS|METRO|M)\b/i;
// Mesmo padrão, mas global — usada por aplicarGuardsTitulo pra limpar TODAS as menções de
// metragem que sobrarem em slots que não são `medida` (a fonte já cravou a metragem certa lá;
// qualquer outra é duplicata, quase sempre arredondada pela IA — lote #65).
export const RE_METRAGEM_TOKEN = /\b\d+(?:,\d+)?\s*(?:MTS|MT|METROS|METRO|M)\b/gi;
// A unidade canônica do padrão ML é "m" minúsculo (ADR-0099): "570m", nunca "570mt".
// Esta função ANTES emitia 'MT'/'M' — era a origem dos 38% de títulos com "MT" medidos em
// produção. A DETECÇÃO continua aceitando MT/MTS/METROS/M na entrada; só a EMISSÃO mudou.
function normalizarUnidade(_raw: string): string {
  return 'm';
}

export function extrairMetragem(nome: string): string | null {
  const m = nome.match(RE_METRAGEM);
  if (!m) return null;
  return `${m[1]}${normalizarUnidade(m[2])}`;
}

// Menciona metragem em QUALQUER forma (token exato como "50MT" ou por extenso como "50 metros")
// — usada pra decidir se a descrição já cobriu o dado antes de cravar um bullet redundante.
export function contemMetragem(texto: string): boolean {
  return RE_METRAGEM.test(texto);
}

// Captura largura em mm OU cm do texto-fonte (ex.: "6MM DE LARGURA", "LARGURA DE 6MM",
// "LARGURA: 6MM", "COM 5 CM DE LARGURA"). Exige a palavra LARGURA perto do número — nunca colide
// com RE_METRAGEM porque a unidade exigida aqui é MM/CM, não M/MT/METROS. Duas unidades porque a
// planilha mistura as duas por produto (achado real: franjas 5/8/10MM no nome_pai, mas a
// descrição do mesmo produto descreve a largura em CM — inconsistência da própria planilha,
// não corrigida aqui, só capturada nas duas formas).
const RE_LARGURA = /(\d+(?:,\d+)?)\s*(MM|CM)\s+DE\s+LARGURA\b|LARGURA\s*:?\s*(?:DE\s*)?(\d+(?:,\d+)?)\s*(MM|CM)\b/i;

export function extrairLargura(texto: string): string | null {
  const m = texto.match(RE_LARGURA);
  if (!m) return null;
  const numero = m[1] ?? m[3];
  const unidade = (m[2] ?? m[4]).toLowerCase();
  return `${numero}${unidade}`;
}

const RE_CONTAGEM = /\b(\d+)\s*(UNIDADES?|UNDS?|UND|UN|PEÇAS?|PECAS?|PÇS?|PCS?|PC)\b/i;
// Mesmo padrão, mas global — usada por aplicarGuardsTitulo pra limpar contagem duplicada de
// slots que não são `quantidade` (mesmo princípio de RE_METRAGEM_TOKEN, lote #40).
export const RE_CONTAGEM_TOKEN = /\b\d+\s*(?:UNIDADES?|UNDS?|UND|UN|PEÇAS?|PECAS?|PÇS?|PCS?|PC)\b/gi;

// Canônico: "10un" / "12pc" (ADR-0099). Antes emitia "10 UNIDADES", que gastava caractere e
// destoava do padrão ML. A detecção segue aceitando UNIDADES/UND/UN/PEÇAS/PÇS/PCS/PC.
export function extrairContagem(texto: string): string | null {
  const m = texto.match(RE_CONTAGEM);
  if (!m) return null;
  const unidade = /^(?:P|PC)/i.test(m[2]) ? 'pc' : 'un';
  return `${m[1]}${unidade}`;
}
