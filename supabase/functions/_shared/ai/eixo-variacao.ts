/**
 * Eixo de variação da família (ADR-0115).
 *
 * O sistema presumia que uma família só varia por COR. A família de tecido Oxford estampado
 * (12/08/2026) varia por ESTAMPA, e a presunção produziu um anúncio que declarava duas cores
 * ("Verde Musgo", "Vermelho", lidas pelo Vision nas fotos) enquanto oferecia sete estampas.
 *
 * O eixo sai do SUFIXO DISCRIMINANTE do nome de cada variação em relação ao nome do pai — dado
 * estrutural da planilha, não inferência sobre foto. `nome_pai + " Est.6"` discrimina por
 * "Est.6"; é literal da fonte, então cai sob a mesma regra de ancoragem do ADR-0098.
 */

/** Sem acento, minúsculo, tokenizado — só para COMPARAR; a grafia devolvida é sempre a original. */
function tokensNorm(s: string): string[] {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Sufixo do nome da variação além do nome do pai, na grafia ORIGINAL.
 *
 * Compara token a token, nunca por `startsWith` na string crua: a normalização NFD muda o
 * comprimento (um caractere acentuado vira dois), então um índice calculado sobre o texto
 * normalizado cortaria o original no lugar errado.
 *
 * Devolve null quando a variação não é o nome do pai mais alguma coisa — nesse caso não há
 * sufixo discriminante e o chamador segue pelo caminho de cor.
 */
export function extrairSufixoVariacao(
  nomeVariacao: string | null | undefined,
  nomePai: string | null | undefined,
): string | null {
  const originais = (nomeVariacao ?? '').trim().split(/\s+/).filter(Boolean);
  const doPai = tokensNorm(nomePai ?? '');
  const daVariacao = tokensNorm(nomeVariacao ?? '');
  if (doPai.length === 0 || originais.length <= doPai.length) return null;
  for (let i = 0; i < doPai.length; i++) {
    if (daVariacao[i] !== doPai[i]) return null;
  }
  const sufixo = originais.slice(doPai.length).join(' ');
  return sufixo || null;
}

// "Est.6", "Est-6", "EST 6", "Est6" — a planilha escreve das quatro formas para a mesma coisa.
// Só o formato numerado é reescrito; qualquer outro sufixo vai literal, porque reescrever o que
// não se reconhece seria inventar (ADR-0098).
const RE_ESTAMPA_NUMERADA = /^est[.\-\s]?\s*(\d+)$/i;

const ROTULO_COR = 'CORES DISPONÍVEIS';
const ROTULO_ESTAMPA = 'ESTAMPAS DISPONÍVEIS';
const ROTULO_GENERICO = 'VARIAÇÕES DISPONÍVEIS';

// A fonte é quem nomeia o eixo. Sem palavra reconhecida, o rótulo é genérico — chamar de
// "estampa" o que a planilha não chamou de estampa seria a mesma presunção que este ADR corrige.
function rotuloDaFonte(nomePai: string, descricaoPai: string): string {
  const alvo = tokensNorm(`${nomePai} ${descricaoPai}`).join(' ');
  return /\bestampa(s|do|dos|da|das)?\b/.test(alvo) ? ROTULO_ESTAMPA : ROTULO_GENERICO;
}

/** Ordem natural: "Estampa 6" antes de "Estampa 18". Alfabética puro colocaria 18 antes de 6. */
function ordenarNatural(valores: string[]): string[] {
  return [...valores].sort((a, b) =>
    a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })
  );
}

export interface EixoVariacao {
  /** Cabeçalho da seção, sem emoji. */
  rotulo: string;
  valores: string[];
}

export { ROTULO_COR, ROTULO_ESTAMPA, ROTULO_GENERICO };

/**
 * Eixo da família a partir dos nomes das variações, ou null quando não há eixo derivável —
 * caso em que o chamador mantém o caminho de cor (comportamento anterior ao ADR-0115).
 *
 * Exige DOIS valores distintos: com um só, o sufixo não discrimina nada e a família é mono-
 * variação, território do ADR-0044 (cor única vai para o título, não para uma lista).
 */
export function resolverEixoVariacao(
  variacoes: Array<{ nome?: string | null }>,
  nomePai: string,
  descricaoPai: string,
): EixoVariacao | null {
  if (variacoes.length < 2) return null;

  const sufixos: string[] = [];
  for (const v of variacoes) {
    const sufixo = extrairSufixoVariacao(v.nome, nomePai);
    // Uma única variação sem sufixo já invalida o eixo: listar só parte das opções é pior que
    // não listar nenhuma — o comprador escolheria entre um conjunto que não é o do anúncio.
    if (!sufixo) return null;
    sufixos.push(sufixo);
  }

  const rotulo = rotuloDaFonte(nomePai, descricaoPai);
  const valores = Array.from(new Set(sufixos.map((s) => {
    const numerada = s.match(RE_ESTAMPA_NUMERADA);
    return numerada && rotulo === ROTULO_ESTAMPA ? `Estampa ${numerada[1]}` : s;
  })));
  if (valores.length < 2) return null;

  return { rotulo, valores: ordenarNatural(valores) };
}
