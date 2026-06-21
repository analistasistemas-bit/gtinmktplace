import * as XLSX from 'xlsx';

/** Espelha COLUNAS_OBRIGATORIAS de supabase/functions/_shared/types.ts (validação no cliente). */
export const COLUNAS_OBRIGATORIAS_PLANILHA = [
  'CODIGO', 'PAI', 'NOME', 'UNIDADE', 'GTIN', 'CUSTO', 'PRECO', 'ESTOQUE',
  'DESCRICAO_DETALHADO', 'PESO_GRAMAS', 'ALTURA_CM', 'LARGURA_CM', 'COMPRIMENTO_CM',
  'FORNECEDOR',
] as const;

/** Colunas obrigatórias ausentes no cabeçalho (case-insensitive, ignora espaços). */
export function colunasFaltando(headers: string[]): string[] {
  const presentes = new Set(headers.map((h) => h.toUpperCase().trim()));
  return COLUNAS_OBRIGATORIAS_PLANILHA.filter((c) => !presentes.has(c));
}

/** Lê só a 1ª linha (cabeçalho) de um .xlsx. Lança se não conseguir ler a planilha. */
export async function lerCabecalhoXlsx(file: File): Promise<string[]> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('Planilha sem abas');
  const linhas = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const cabecalho = (linhas[0] ?? []) as unknown[];
  return cabecalho.map((c) => String(c ?? ''));
}
