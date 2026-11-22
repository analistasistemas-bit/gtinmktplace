// Acesso de agentes (ADR-0210, fatia 1): regra e banco da edge `agente-conexoes` (criar, listar, revogar, auditoria).
// Service role: toda consulta leva `.eq('org_id', orgId)`. O `hash` nunca é lido de volta. Erro de banco LANÇA
// com mensagem fixa (sem `error.message`, que pode citar o hash numa colisão de unique).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const LIMITE_CONEXOES_ATIVAS = 10;
const VALIDADES = [30, 90, 365] as const;
type Validade = typeof VALIDADES[number];

export function validarNova(e: unknown): { nome: string; dias: Validade } | { erro: 'nome_invalido' | 'validade_invalida' } {
  const c = (e && typeof e === 'object' ? e : {}) as { nome?: unknown; dias?: unknown };
  const nome = typeof c.nome === 'string' ? c.nome.trim() : '';
  if (nome.length < 1 || nome.length > 60) return { erro: 'nome_invalido' };
  if (!VALIDADES.includes(c.dias as Validade)) return { erro: 'validade_invalida' };
  return { nome, dias: c.dias as Validade };
}

export const expiraEm = (agora: Date, dias: number) => new Date(agora.getTime() + dias * 86_400_000).toISOString();

const COLUNAS = 'id, nome, prefixo, criada_em, expira_em, revogada_em, ultimo_uso_em';
export type ConexaoLista = {
  id: string; nome: string; prefixo: string; criada_em: string; expira_em: string;
  revogada_em: string | null; ultimo_uso_em: string | null;
};
export type Chamada = { criado_em: string; ferramenta: string; alvo: string | null; resultado: string };

function falhou(onde: string, error: unknown): void {
  if (error) throw new Error(`agentes.${onde}`);
}

export async function listarConexoes(admin: SupabaseClient, orgId: string): Promise<ConexaoLista[]> {
  const { data, error } = await admin.from('agente_conexoes').select(COLUNAS)
    .eq('org_id', orgId).order('criada_em', { ascending: false });
  falhou('listarConexoes', error);
  // Projeção explícita: mesmo que o select mude, nada além destas chaves sai da edge.
  return ((data ?? []) as ConexaoLista[]).map((l) => ({
    id: l.id, nome: l.nome, prefixo: l.prefixo, criada_em: l.criada_em, expira_em: l.expira_em,
    revogada_em: l.revogada_em, ultimo_uso_em: l.ultimo_uso_em,
  }));
}

/** Ativa = não revogada e não expirada. ponytail: contar e inserir não são atômicos; duas criações simultâneas
 *  podem passar de 10 por uma. Trigger/constraint se o limite virar cobrança. */
export async function contarAtivas(admin: SupabaseClient, orgId: string, agora: Date): Promise<number> {
  const { count, error } = await admin.from('agente_conexoes').select('id', { count: 'exact', head: true })
    .eq('org_id', orgId).is('revogada_em', null).gt('expira_em', agora.toISOString());
  falhou('contarAtivas', error);
  if (typeof count !== 'number') throw new Error('agentes.contarAtivas');
  return count;
}

export async function inserirConexao(
  admin: SupabaseClient, orgId: string,
  l: { nome: string; prefixo: string; hash: string; criada_por: string; expira_em: string },
): Promise<{ id: string }> {
  const { data, error } = await admin.from('agente_conexoes').insert({ org_id: orgId, ...l }).select('id').single();
  falhou('inserirConexao', error);
  if (!data) throw new Error('agentes.inserirConexao');
  return { id: (data as { id: string }).id };
}

/** `false` = não existe nesta org (inexistente e de outra org são indistinguíveis). Já revogada = `true` sem
 *  regravar a data (idempotente). */
export async function revogarConexao(admin: SupabaseClient, orgId: string, id: string, agora: Date): Promise<boolean> {
  const { data, error } = await admin.from('agente_conexoes').update({ revogada_em: agora.toISOString() })
    .eq('org_id', orgId).eq('id', id).is('revogada_em', null).select('id');
  falhou('revogarConexao', error);
  if ((data ?? []).length > 0) return true;
  const existe = await admin.from('agente_conexoes').select('id').eq('org_id', orgId).eq('id', id).maybeSingle();
  falhou('revogarConexao.existe', existe.error);
  return !!existe.data;
}

export async function listarChamadas(admin: SupabaseClient, orgId: string, conexaoId: string): Promise<Chamada[]> {
  const { data, error } = await admin.from('agente_chamadas').select('criado_em, ferramenta, alvo, resultado')
    .eq('org_id', orgId).eq('conexao_id', conexaoId).order('criado_em', { ascending: false }).limit(50);
  falhou('listarChamadas', error);
  return (data ?? []) as Chamada[];
}
