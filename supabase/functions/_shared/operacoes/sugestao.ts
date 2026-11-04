// ADR-0194 — sugestões de promoção: marcação de origem da operação e dispensa por produto. Sem import Deno: vitest carrega.
const DIAS_DISPENSA = 30;
const DIA_MS = 86_400_000;

export interface MarcaSugestao { faixa: 'quase_vendendo' | 'invisivel'; oportunidade: number; chave: string }
export interface LinhaDispensa { org_id: string; chave: string; dispensado_por: string; dispensado_em: string; expira_em: string }
export interface DepsDispensa {
  gravar(linha: LinhaDispensa): Promise<void>;
  remover(orgId: string, chave: string): Promise<void>;
  agora(): number;
}

export const chaveValida = (c: unknown): c is string => typeof c === 'string' && /^(p|a):.{1,80}$/.test(c);

/** Ausente é válido (operação comum); presente com forma errada recusa o pedido. Só os 3 campos vão ao banco. */
export function lerSugestao(x: unknown): { ok: true; valor: MarcaSugestao | null } | { ok: false } {
  if (x == null) return { ok: true, valor: null };
  if (typeof x !== 'object') return { ok: false };
  const { faixa, oportunidade, chave } = x as Record<string, unknown>;
  if (faixa !== 'quase_vendendo' && faixa !== 'invisivel') return { ok: false };
  if (typeof oportunidade !== 'number' || !Number.isFinite(oportunidade) || oportunidade < 0) return { ok: false };
  if (!chaveValida(chave)) return { ok: false };
  return { ok: true, valor: { faixa, oportunidade, chave } };
}

export async function dispensarSugestao(deps: DepsDispensa, orgId: string, userId: string, chave: string): Promise<void> {
  const agora = deps.agora();
  await deps.gravar({
    org_id: orgId, chave, dispensado_por: userId, dispensado_em: new Date(agora).toISOString(),
    expira_em: new Date(agora + DIAS_DISPENSA * DIA_MS).toISOString(),
  });
}

export const reativarSugestao = (deps: DepsDispensa, orgId: string, chave: string): Promise<void> => deps.remover(orgId, chave);
