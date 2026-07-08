import { gtinValido } from './gtin.ts';

export interface FamiliaParaBusca {
  nome_pai: string;
  variacoes: { gtin: string | null }[];
}

export function escolherIdentificador(
  familia: FamiliaParaBusca,
): { tipo: 'gtin' | 'titulo'; valor: string } {
  const comGtin = familia.variacoes.find((v) => gtinValido(v.gtin));
  if (comGtin?.gtin) return { tipo: 'gtin', valor: comGtin.gtin.trim() };
  return { tipo: 'titulo', valor: familia.nome_pai };
}

/** Todos os GTINs válidos e distintos da família (ordem das variações). Usado pela busca de
 * concorrência para resolver TODAS as cores: cada cor da família pode ser um produto de
 * catálogo DISTINTO no ML — parar no 1º GTIN que casasse reportava o preço de UMA cor como
 * se fosse o da família inteira (bug lote #28, ADR-0064). Por isso buscamos todos os GTINs
 * válidos e agregamos com `agregarConcorrencia`. */
export function gtinsValidos(familia: FamiliaParaBusca): string[] {
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const v of familia.variacoes) {
    if (!gtinValido(v.gtin)) continue;
    const g = v.gtin!.trim();
    if (vistos.has(g)) continue;
    vistos.add(g);
    out.push(g);
  }
  return out;
}
