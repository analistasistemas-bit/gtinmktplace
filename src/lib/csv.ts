/** Escapa um campo CSV: aspas duplicadas e envolve em aspas se tiver ; aspas ou quebra. */
function campo(v: string | number | null): string {
  if (v == null) return '';
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Monta CSV com separador ';' (Excel pt-BR). */
export function montarCsv(
  linhas: Array<Record<string, string | number | null>>,
  colunas: Array<{ chave: string; titulo: string }>,
): string {
  const head = colunas.map((c) => campo(c.titulo)).join(';');
  const body = linhas.map((l) => colunas.map((c) => campo(l[c.chave])).join(';'));
  return [head, ...body].join('\n');
}

/** Dispara o download de um CSV no browser (BOM p/ acentos no Excel). */
export function baixarCsv(nome: string, conteudo: string): void {
  const blob = new Blob(['﻿', conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}
