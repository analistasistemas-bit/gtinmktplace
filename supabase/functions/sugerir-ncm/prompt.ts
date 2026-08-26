// ADR-0135 D-9 — a IA SUGERE o NCM; gravar é ato do operador, sempre.
export function montarPromptNcm(p: { nome: string; descricao: string | null; categoria: string | null }): string {
  return [
    `Produto: ${p.nome}`,
    p.descricao ? `Descrição: ${p.descricao.slice(0, 500)}` : null,
    p.categoria ? `Categoria no Mercado Livre: ${p.categoria}` : null,
    'Sugira o NCM (Nomenclatura Comum do Mercosul, 8 dígitos) mais provável para este produto',
    'vendido no varejo brasileiro. Responda APENAS JSON: {"ncm":"XXXXXXXX","justificativa":"..."}.',
    'Se não tiver confiança razoável, responda {"ncm":null,"justificativa":"motivo"}.',
  ].filter(Boolean).join('\n');
}

export function extrairSugestaoNcm(raw: string): { ncm: string | null; justificativa: string } {
  try {
    const j = JSON.parse(raw) as { ncm?: unknown; justificativa?: unknown };
    const ncm = typeof j.ncm === 'string' && /^\d{8}$/.test(j.ncm) ? j.ncm : null;
    return { ncm, justificativa: typeof j.justificativa === 'string' ? j.justificativa : '' };
  } catch {
    return { ncm: null, justificativa: 'resposta da IA fora do formato esperado' };
  }
}
