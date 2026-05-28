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
