import { DICIONARIO_CORES } from './dicionario.ts';

interface Termo {
  canonica: string;
  sinonimo: string;
  regex: RegExp;
}

const TERMOS: Termo[] = DICIONARIO_CORES
  .flatMap(({ canonica, sinonimos }) =>
    sinonimos.map((sin) => ({
      canonica,
      sinonimo: sin,
      regex: new RegExp(`(?<![\\p{L}])${escapeRegex(sin)}(?![\\p{L}])`, 'iu'),
    }))
  )
  .sort((a, b) => b.sinonimo.length - a.sinonimo.length);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extrairCorDoTexto(textos: Array<string | null | undefined>): string | null {
  const conjunto = textos.filter((t): t is string => typeof t === 'string' && t.length > 0);
  if (conjunto.length === 0) return null;
  const corpus = conjunto.join(' | ');
  for (const termo of TERMOS) {
    if (termo.regex.test(corpus)) return termo.canonica;
  }
  return null;
}

/**
 * Cor de uma variação pelo dicionário, usando SÓ campos curtos e estruturados:
 * o nome da variação e o nome do pai. A `descricao_detalhado` é prosa de marketing
 * por família — cheia de cores incidentais ("desenho colorido", "linha brilhante") que
 * geram falso positivo e, por ser igual para todas as variações, não distingue cor por
 * variação. Excluída de propósito; sem cor no nome, a resolução cai no Vision (foto).
 */
export function extrairCorDeVariacao(
  nomeVariacao: string | null | undefined,
  nomePai: string | null | undefined,
): string | null {
  return extrairCorDoTexto([nomeVariacao, nomePai]);
}

// Mapa de abreviações comuns de cor (chave em MAIÚSCULAS) → forma por extenso.
const ABREVIACOES_COR: Record<string, string> = {
  AZ: 'Azul', VD: 'Verde', AMA: 'Amarelo', CL: 'Claro',
  ESC: 'Escuro', BCA: 'Branco', PTO: 'Preto',
};

// Léxico de acentos (chave em MAIÚSCULAS sem acento) → forma acentuada. A planilha
// vem do export interno em CAIXA-ALTA sem acento; restauramos o acento por palavra.
// Palavra ausente aqui mantém o title-case literal (operador ajusta na revisão).
const ACENTOS_COR: Record<string, string> = {
  PETALA: 'Pétala', ORQUIDEA: 'Orquídea', MAGNOLIA: 'Magnólia',
  BOTANICO: 'Botânico', CITRICO: 'Cítrico', SALMAO: 'Salmão',
  BORDO: 'Bordô', MEDIO: 'Médio', ABOBORA: 'Abóbora',
  LILAS: 'Lilás', CAQUI: 'Cáqui', PETROLEO: 'Petróleo',
  BEBE: 'Bebê', CAFE: 'Café', LIMAO: 'Limão', INDIGO: 'Índigo',
};

const SO_LETRAS = /^\p{L}+$/u;
const SO_DIGITOS = /^\d+$/;

// Unidades de metragem/medida: "10 mt", "1 m", "50 cm" são MEDIDA, não "{código} {cor}".
// Quando a metragem vem separada (não colada como "10MT"), o dígito parece código e as
// palavras seguintes parecem cor — bug do lote #48 ("Mt Para Uniforme E Decoração 10").
// Também usada para descartar sufixo de unidade ao FINAL do nome da cor (ex.: "AZ PISCINA
// UND"), que senão conta como palavra extra e estoura MAX_PALAVRAS_COR — bug do lote #33.
const UNIDADES_METRAGEM = new Set(['m', 'mt', 'mts', 'metro', 'metros', 'cm', 'mm', 'un', 'und', 'kg', 'g']);
// Uma cor real tem 1-2 palavras; corrida maior é frase/descrição, não cor.
const MAX_PALAVRAS_COR = 2;

function titleCase(palavra: string): string {
  return palavra.charAt(0).toUpperCase() + palavra.slice(1).toLowerCase();
}

/**
 * Produtos cujo NOME traz "{código} {cor}" (ex.: "... 1354 VERMELHO TOMATE 10MT"):
 * devolve o código e o nome literal da cor (abreviações expandidas + title-case).
 * Sem esse padrão (nenhum dígito-puro seguido de palavra só-letras) → null (usa o dicionário).
 */
export function extrairCorECodigo(nome: string): { cor: string; codigo: string } | null {
  const tokens = (nome ?? '').trim().split(/\s+/).filter(Boolean);
  // Último dígito-puro seguido de token só-letras (a cor fica perto do fim, antes do tamanho).
  let idx = -1;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (SO_DIGITOS.test(tokens[i]) && SO_LETRAS.test(tokens[i + 1])) idx = i;
  }
  if (idx < 0) return null;

  // "10 mt ..." → o dígito é metragem, não código. Não é o padrão "{código} {cor}".
  if (UNIDADES_METRAGEM.has(tokens[idx + 1].toLowerCase())) return null;

  const codigo = tokens[idx];
  const palavras: string[] = [];
  for (let i = idx + 1; i < tokens.length; i++) {
    if (!SO_LETRAS.test(tokens[i])) break; // tamanho (10MT) / token misto encerra a cor
    palavras.push(tokens[i]);
  }
  // Sufixo de unidade do fornecedor ao final ("... COR UND") não é parte do nome da cor.
  if (palavras.length > 0 && UNIDADES_METRAGEM.has(palavras[palavras.length - 1].toLowerCase())) {
    palavras.pop();
  }
  // Corrida longa (ex.: "para uniforme e decoração") não é cor → cai no dicionário.
  if (palavras.length > MAX_PALAVRAS_COR) return null;
  const cor = palavras
    .map((p) => {
      const up = p.toUpperCase();
      return ABREVIACOES_COR[up] ?? ACENTOS_COR[up] ?? titleCase(p);
    })
    .join(' ');
  return { cor, codigo };
}
