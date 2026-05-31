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
