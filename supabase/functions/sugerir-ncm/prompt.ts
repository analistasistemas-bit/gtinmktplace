// ADR-0135 D-9 — a IA SUGERE o NCM; gravar é ato do operador, sempre.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { ncmsInvalidos } from '../_shared/fiscal/ncm-oficial.ts';

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
    // A IA às vezes devolve o NCM na grafia da tabela ("6109.10.00"): tira só pontuação e
    // espaço — letra ou dígito a menos continua reprovando.
    const limpo = typeof j.ncm === 'string' ? j.ncm.replace(/[.\s-]/g, '') : '';
    const ncm = /^\d{8}$/.test(limpo) ? limpo : null;
    return { ncm, justificativa: typeof j.justificativa === 'string' ? j.justificativa : '' };
  } catch {
    return { ncm: null, justificativa: 'resposta da IA fora do formato esperado' };
  }
}

export const SEM_SUGESTAO = { ncm: null, justificativa: 'sugestão indisponível agora — preencha manualmente' };

/** ADR-0187: a IA nunca propõe NCM fora da tabela oficial (inexistente ou vencido). Erro de
 *  leitura → SEM_SUGESTAO (fail-closed: não repassa código que não conseguimos conferir). */
export async function filtrarSugestaoNcm(
  admin: SupabaseClient, s: { ncm: string | null; justificativa: string },
): Promise<{ ncm: string | null; justificativa: string }> {
  if (!s.ncm) return s;
  try {
    if ((await ncmsInvalidos(admin, [s.ncm])).length === 0) return s;
    return { ncm: null, justificativa: 'A IA sugeriu um NCM fora da tabela oficial — preencha manualmente.' };
  } catch (e) {
    console.error('sugerir-ncm: leitura da tabela de NCM falhou:', e);
    return SEM_SUGESTAO;
  }
}
