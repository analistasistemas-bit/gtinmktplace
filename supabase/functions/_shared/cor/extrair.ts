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

// Mapa de abreviações comuns de cor (chave em MAIÚSCULAS) → forma por extenso.
const ABREVIACOES_COR: Record<string, string> = {
  AZ: 'Azul', VD: 'Verde', AMA: 'Amarelo', CL: 'Claro',
  ESC: 'Escuro', BCA: 'Branco', PTO: 'Preto',
};

const SO_LETRAS = /^\p{L}+$/u;
const SO_DIGITOS = /^\d+$/;

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

  const codigo = tokens[idx];
  const palavras: string[] = [];
  for (let i = idx + 1; i < tokens.length; i++) {
    if (!SO_LETRAS.test(tokens[i])) break; // tamanho (10MT) / token misto encerra a cor
    palavras.push(tokens[i]);
  }
  const cor = palavras
    .map((p) => ABREVIACOES_COR[p.toUpperCase()] ?? titleCase(p))
    .join(' ');
  return { cor, codigo };
}
