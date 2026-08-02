/**
 * Title Case PT-BR para slots de título (ADR-0099).
 *
 * É GERAÇÃO, não transformação: a entrada vem toda em CAPS da planilha
 * ("FITA CETIM BUFALO N.3 16MM"), então não existe capitalização original a preservar.
 */

// Minúsculas quando não são a primeira palavra do título.
const ATONAS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'com', 'sem', 'para', 'por', 'a', 'o', 'as', 'os', 'ao', 'aos',
]);

// Lista FECHADA. Não é catch-all: "Tex 29" é Title Case, não "TEX 29" — o documento do padrão
// ML escreve assim, e sigla aberta transformaria qualquer palavra curta em caixa alta.
const SIGLAS = new Set(['PVC', 'EVA', 'MDF', 'MDP', 'FPS', 'LED', 'ABS', 'PET', 'PP', 'PU']);

// Número colado à unidade: 100m, 6mm, 500g, 10un, 3,5cm, 2l. Unidade sempre minúscula.
const RE_UNIDADE = /^(\d+(?:[.,]\d+)?)(m|mm|cm|g|kg|l|ml|un|pc)$/i;
// Percentual: 100%, 85%.
const RE_PERCENTUAL = /^\d+%$/;
// Numeração da fonte, preservada como está: N.3, N.02, 4/6, 8/4.
const RE_NUMERACAO = /^(?:[A-Za-z]+\.\d+|\d+\/\d+)$/;

function capitalizar(p: string): string {
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

function palavraCase(bruta: string, ehPrimeira: boolean): string {
  const p = bruta.trim();
  if (!p) return p;

  const unidade = p.match(RE_UNIDADE);
  if (unidade) return `${unidade[1]}${unidade[2].toLowerCase()}`;

  if (RE_PERCENTUAL.test(p)) return p;
  if (RE_NUMERACAO.test(p)) return p;
  if (SIGLAS.has(p.toUpperCase())) return p.toUpperCase();

  const minuscula = p.toLowerCase();
  // Átona só perde a maiúscula quando NÃO abre o título — "De Luxo" no início continua "De".
  if (!ehPrimeira && ATONAS.has(minuscula)) return minuscula;
  return capitalizar(p);
}

/**
 * `ehPrimeiroSlot` diz se este slot abre o título. Só a primeira palavra do PRIMEIRO slot
 * escapa da regra de átona — "Fita de Cetim para Forro" mantém "para" minúsculo mesmo sendo
 * a primeira palavra do slot `aplicacao`.
 */
export function tituloCase(texto: string, ehPrimeiroSlot: boolean): string {
  return texto
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => palavraCase(p, ehPrimeiroSlot && i === 0))
    .join(' ');
}
