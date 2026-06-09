const TITULO_MAX = 60;

// Captura metragem real do nome (ex.: "100MT", "10MT", "50 METROS", "30 M").
// Jardas (J) e códigos sem unidade de metro NÃO contam.
const RE_METRAGEM = /(\d+)\s*(MTS|MT|METROS|METRO|M)\b/i;

function normalizarUnidade(raw: string): string {
  return /^MT/i.test(raw) ? 'MT' : 'M';
}

export function extrairMetragem(nome: string): string | null {
  const m = nome.match(RE_METRAGEM);
  if (!m) return null;
  return `${m[1]}${normalizarUnidade(m[2])}`;
}

// Conectivos/preposições que, sozinhos no fim do título, denunciam frase cortada
// (a IA estoura o teto de 60 chars do schema no meio do "diferencial" → "VERSÁTIL E").
const CAUDA_CONECTIVA = new Set([
  'E', 'OU', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'COM', 'SEM', 'PARA', 'POR',
  'EM', 'NO', 'NA', 'A', 'O', 'AO', '&',
]);

// Remove a cauda incompleta do título: pipe pendurado (segmento vazio) e
// conectivos soltos no fim. Não toca em título já completo.
export function removerCaudaConectiva(titulo: string): string {
  let t = titulo.trim();
  for (;;) {
    const antes = t;
    t = t.replace(/\s*\|\s*$/, '').trimEnd(); // pipe pendurado / segmento vazio
    const palavras = t.split(/\s+/);
    const ultima = palavras[palavras.length - 1]?.toUpperCase();
    if (ultima && CAUDA_CONECTIVA.has(ultima)) {
      palavras.pop();
      t = palavras.join(' ').trimEnd();
    }
    if (t === antes) break; // estabilizou
  }
  return t;
}

// Garante que a metragem do nome apareça no título (dado crucial que diferencia
// produtos — ex.: fita 10MT vs 100MT). Rede de segurança determinística porque a
// IA, sob o teto de 60 chars, descarta a metragem mesmo presente no nome.
export function garantirMetragemTitulo(titulo: string, nomePai: string): string {
  // Primeiro limpa a cauda incompleta deixada pelo corte de 60 chars da IA, para
  // o resultado (inclusive no atalho "metragem já presente") nunca ter conectivo solto.
  titulo = removerCaudaConectiva(titulo);
  const metragem = extrairMetragem(nomePai);
  if (!metragem) return titulo;

  const numero = metragem.match(/\d+/)?.[0] ?? '';
  // Já contém a metragem (qualquer unidade de metro adjacente)? Não duplica.
  if (new RegExp(`\\b${numero}\\s*(MTS?|METROS?|M)\\b`, 'i').test(titulo)) return titulo;

  const sufixo = ` ${metragem}`;
  const partes = titulo.split(' | ');
  partes[0] = `${partes[0]}${sufixo}`;
  let candidato = partes.join(' | ');
  // Para caber em 60, derruba o "diferencial" genérico antes de aparar.
  while (candidato.length > TITULO_MAX && partes.length > 1) {
    partes.pop();
    candidato = partes.join(' | ');
  }
  // Sobrou só um segmento ainda longo: apara o texto-base preservando a metragem.
  if (candidato.length > TITULO_MAX) {
    const overflow = candidato.length - TITULO_MAX;
    const base = partes[0].slice(0, partes[0].length - sufixo.length);
    partes[0] = base.slice(0, Math.max(0, base.length - overflow)).trimEnd() + sufixo;
    candidato = partes.join(' | ');
  }
  return candidato;
}
