/** Escolhe qual lote abrir na sidebar Revisão. `lotes` já vem ordenado por criadoEm desc. */
export function escolherLoteRevisao<T extends {
  id: string;
  status: string;
  totalErros: number;
  criadoEm: string;
}>(lotes: T[]): T | undefined {
  if (lotes.length === 0) return undefined;

  const porData = (a: T, b: T) => b.criadoEm.localeCompare(a.criadoEm);

  const emRevisao = lotes.filter((l) => l.status === 'revisao').sort(porData);
  if (emRevisao.length > 0) return emRevisao[0];

  const comErros = lotes.filter((l) => l.totalErros > 0).sort(porData);
  if (comErros.length > 0) return comErros[0];

  return lotes[0];
}
