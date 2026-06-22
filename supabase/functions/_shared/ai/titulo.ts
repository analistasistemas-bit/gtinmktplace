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

// Enforça o teto de 60 chars SEM cortar palavra no meio. O schema do copywriter
// não tem mais maxLength (ele cortava mecanicamente, gerando "IDEAL PARA P" — bug
// do lote #26); a IA devolve o título inteiro e o limite vira responsabilidade aqui.
// Derruba primeiro segmentos inteiros (após " | "), depois palavras inteiras.
export function clampTitulo(titulo: string): string {
  let t = removerCaudaConectiva(titulo);
  if (t.length <= TITULO_MAX) return t;

  const partes = t.split(' | ');
  while (partes.length > 1 && partes.join(' | ').length > TITULO_MAX) {
    partes.pop();
  }
  t = partes.join(' | ');

  if (t.length > TITULO_MAX) {
    const palavras = t.split(/\s+/);
    while (palavras.length > 1 && palavras.join(' ').length > TITULO_MAX) {
      palavras.pop();
    }
    t = palavras.join(' ');
  }

  // Degenerado: um único "token" maior que 60 (sem espaço para derrubar) → corte duro.
  if (t.length > TITULO_MAX) t = t.slice(0, TITULO_MAX).trimEnd();

  return removerCaudaConectiva(t);
}

// Garante que a metragem do nome apareça no título (dado crucial que diferencia
// produtos — ex.: fita 10MT vs 100MT). Rede de segurança determinística porque a
// IA, sob o teto de 60 chars, descarta a metragem mesmo presente no nome.
export function garantirMetragemTitulo(titulo: string, nomePai: string): string {
  // Primeiro limpa a cauda incompleta deixada pelo corte de 60 chars da IA, para
  // o resultado (inclusive no atalho "metragem já presente") nunca ter conectivo solto.
  titulo = removerCaudaConectiva(titulo);
  const metragem = extrairMetragem(nomePai);
  // Sem metragem: ainda assim clampa para 60 sem cortar palavra (cola, lote #26).
  if (!metragem) return clampTitulo(titulo);

  const numero = metragem.match(/\d+/)?.[0] ?? '';
  // Já contém a metragem (qualquer unidade de metro adjacente)? Não duplica — mas
  // ainda clampa para 60 (a metragem está no 1º segmento, que clampTitulo preserva).
  // Sem o clamp aqui, um título já com metragem e >60 escapava (bug lote #27 → ML 400).
  if (new RegExp(`\\b${numero}\\s*(MTS?|METROS?|M)\\b`, 'i').test(titulo)) return clampTitulo(titulo);

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

// Placeholder que o copywriter usa quando a variação não tem cor identificada — não é cor real.
const COR_NAO_IDENTIFICADA = '(sem cor identificada)';

// Normaliza para a comparação "cor já está no título": sem acento, em CAPS.
function normalizarBusca(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

// Garante que a cor apareça no título quando o anúncio é de cor ÚNICA (mono-cor). Sem isso,
// duas famílias-irmãs que diferem só na cor (PAI separado na planilha) geram títulos idênticos
// e o ML baixa a segunda como duplicado ("Era igual a outro anúncio"). Rede de segurança
// determinística porque a IA, sob o teto de 60 chars e o prompt multi-cor, descarta a cor.
// Multi-cor (variação de cor real) NÃO leva cor no título — retorna o título intacto.
export function garantirCorTitulo(titulo: string, cor: string | null, nCores: number): string {
  if (nCores !== 1) return titulo;
  const corLimpa = cor?.trim();
  if (!corLimpa || corLimpa === COR_NAO_IDENTIFICADA) return titulo;

  // Já contém a cor (palavra inteira, ignorando acento e caixa)? Não duplica.
  const corNorm = normalizarBusca(corLimpa).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\b${corNorm}\\b`).test(normalizarBusca(titulo))) return titulo;

  const sufixo = ` ${corLimpa.toUpperCase()}`;
  const partes = titulo.split(' | ');
  partes[0] = `${partes[0]}${sufixo}`;
  let candidato = partes.join(' | ');
  // Para caber em 60, derruba o "diferencial" genérico antes de aparar (igual à metragem).
  while (candidato.length > TITULO_MAX && partes.length > 1) {
    partes.pop();
    candidato = partes.join(' | ');
  }
  // Sobrou só um segmento ainda longo: apara o texto-base preservando a cor (dado diferenciador).
  if (candidato.length > TITULO_MAX) {
    const overflow = candidato.length - TITULO_MAX;
    const base = partes[0].slice(0, partes[0].length - sufixo.length);
    partes[0] = base.slice(0, Math.max(0, base.length - overflow)).trimEnd() + sufixo;
    candidato = partes.join(' | ');
  }
  return candidato;
}
