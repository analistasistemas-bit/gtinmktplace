// ADR-0174 — falha transitória × ausência real. Leitura que falhou nunca vira "sem conexão": na etapa QStash isso
// encerraria a operação de vez (itens em saída pedida saem do índice anti-duplicidade). Sem import Deno: vitest carrega.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { mapearConexao, type ConexaoCanal } from '../canais/conexao.ts';
import { SemAcessoPromocoes } from '../promocoes/ml.ts';
import { SemEscritaPromocoes } from './ml.ts';

/** Org sem conta ML conectada (ausência real, não erro de leitura). */
export class SemConexaoML extends Error {}

export const MSG_SEM_CONEXAO = 'Organização sem conexão com o Mercado Livre. Conecte a conta em Canais.';
export const MSG_RECONECTAR = 'O Mercado Livre recusou o acesso da conta. Reconecte-a em Canais.';

/** Como `resolverConexao`, mas erro do banco LANÇA (transitório → 500) em vez de virar null. */
export async function lerConexaoML(admin: SupabaseClient, orgId: string): Promise<ConexaoCanal | null> {
  const { data, error } = await admin.from('marketplace_connections')
    .select('id, org_id, canal, conta_externa_id, expires_at')
    .eq('org_id', orgId).eq('canal', 'mercado_livre').maybeSingle();
  if (error) throw new Error(`marketplace_connections: ${error.message}`);
  return mapearConexao(data ?? null);
}

/** Criação: conta ausente → 400; ML recusou o token → 403; qualquer outra falha → null (500, transitória). */
export function respostaFalhaCriacao(e: unknown): { status: 400 | 403; erro: string } | null {
  if (e instanceof SemConexaoML) return { status: 400, erro: MSG_SEM_CONEXAO };
  if (e instanceof SemAcessoPromocoes || e instanceof SemEscritaPromocoes) return { status: 403, erro: MSG_RECONECTAR };
  return null;
}
