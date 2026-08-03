/**
 * Mapa curado razão social → marca comercial (ADR-0099).
 *
 * `familias.fornecedor` é razão social TRUNCADA em 30 chars, não marca. Derivar por heurística
 * foi medido e não funciona: o primeiro token útil devolve "BARBANTE" para
 * FABRICA DE BARBANTE BANDEIRANT, "V" para V.R.MACHADO e "LINHAS" para LINHAS SETTA. Daí o
 * mapa ser manual e chaveado na string COMO ESTÁ GRAVADA — essa forma é estável.
 *
 * O MAPA FORNECE A GRAFIA; A FONTE FORNECE A PERMISSÃO. Este módulo só diz como a marca se
 * escreve. Quem decide se ela pode entrar no título é validarSlotsAncorados (titulo-guards.ts),
 * exigindo que apareça em nome_pai ou descricao_pai. Sem isso o sistema estaria afirmando uma
 * marca a partir de um campo de fornecedor — o que o padrão do ML proíbe.
 *
 * Entrada com `null` é deliberada, não lacuna: significa "esta razão social não carrega marca
 * comercial identificável, nunca invente uma a partir dela".
 */
const MARCAS: Record<string, string | null> = {
  'BUFALO': 'Búfalo',
  'CIRCULO S.A.': 'Círculo',
  'DETALLIA FITAS TEXTEIS LTDA': 'Detallia',
  'ECOFIBRA INDUSTRIA TEXTIL': 'Ecofibra',
  'TRINITY': 'Trinity',
  'FABRICA DE BARBANTE BANDEIRANT': 'Bandeirante',
  'LINHANYL S/A': 'Linhanyl',
  'BR17-COATS CORRENTE LTDA': 'Corrente',
  'LINHAS SETTA LTDA': 'Setta',
  'FISCHER COMERCIO DE PRODUTOS P': 'Fischer',
  'Eucerin': 'Eucerin',
  // Sem marca comercial identificável na razão social:
  'V.R.MACHADO SILK SREEN EM GERA': null,
  'S.PROCHOWNIK COMERCIAL LTDA': null,
};

/**
 * Nomes de loja. `AVIL` aparece gravado como fornecedor em produção, e `DS` é a marca_padrao da
 * org DSA. O padrão do ML proíbe nome de loja no título — bloqueio explícito, nunca só omissão.
 */
export const LOJA_NUNCA_MARCA: readonly string[] = ['AVIL', 'DS', 'AVIL LTDA', 'DSA'];

export function marcaDoFornecedor(fornecedor: string | null): string | null {
  const chave = fornecedor?.trim();
  if (!chave) return null;
  if (LOJA_NUNCA_MARCA.includes(chave.toUpperCase())) return null;
  return MARCAS[chave] ?? null;
}
