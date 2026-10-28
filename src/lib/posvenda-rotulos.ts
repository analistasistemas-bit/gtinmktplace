/** Rótulos pt-BR dos valores crus do ML na pós-venda. Desconhecido → valor cru. */
const QUER: Record<string, string> = {
  return_product: 'Devolver o produto', product: 'Receber o produto', refund: 'Receber o dinheiro de volta',
  change_product: 'Trocar o produto', partial_refund: 'Reembolso parcial',
};
const ETAPA: Record<string, string> = { claim: 'Reclamação (sem mediação)', dispute: 'Mediação do Mercado Livre', recontact: 'Recontato' };
const REPUTACAO: Record<string, string> = { not_affected: 'Não afeta', affected: 'Afeta sua reputação' };
const STATUS: Record<string, string> = { opened: 'aberta', closed: 'encerrada' };

export const rotuloQuer = (v: string | null | undefined) => (v ? QUER[v] ?? v : '—');
export const rotuloEtapa = (v: string | null | undefined) => (!v || v === 'none' ? '—' : ETAPA[v] ?? v);
export const rotuloReputacao = (v: string | null | undefined) => (v ? REPUTACAO[v] ?? v : '—');
export const rotuloStatus = (v: string) => STATUS[v] ?? v;

/** Linha de sistema do backend ("Status da reclamação: dispute / opened") → "Status: Mediação… · aberta". */
export function textoHistorico(texto: string): string {
  const m = /^Status da reclamação: (\S+)(?: \/ (\S+))?$/.exec(texto);
  if (!m) return texto;
  const [a, b] = [m[1], m[2]];
  // Valor único: status se for opened/closed, senão etapa (o backend omite o que faltou).
  const partes = b ? [rotuloEtapa(a), rotuloStatus(b)] : [a in STATUS ? rotuloStatus(a) : rotuloEtapa(a)];
  return `Status: ${partes.join(' · ')}`;
}

/** Divide `**negrito**` em partes (sem HTML); quebras de linha ficam no texto. */
export function partesNegrito(texto: string): Array<{ t: string; b: boolean }> {
  return texto.split(/\*\*(.+?)\*\*/gs).flatMap((t, i) => (t === '' ? [] : [{ t, b: i % 2 === 1 }]));
}
