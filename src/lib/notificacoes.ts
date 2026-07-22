import { supabase } from './supabase';
import type { CategoriaNotificacao } from './notificacoes-categorias';

export interface Notificacao {
  id: string;
  categoria: CategoriaNotificacao;
  texto: string;
  lida: boolean;
  criada_em: string;
}

/** Últimas notificações (mais recentes primeiro), para o dropdown do sino (ADR-0085). */
export async function buscarNotificacoes(limite = 20): Promise<Notificacao[]> {
  const { data, error } = await supabase
    .from('notificacoes')
    .select('id, categoria, texto, lida, criada_em')
    .order('criada_em', { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as Notificacao[];
}

/** Conta não lidas (badge do sino). Resiliente: erro/exceção → 0. */
export async function contarNotificacoesNaoLidas(): Promise<number> {
  const { count, error } = await supabase
    .from('notificacoes')
    .select('id', { count: 'exact', head: true })
    .eq('lida', false);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Marca como lidas (todas, ou só os ids passados). Resiliente: erro/exceção → 0. */
export async function marcarNotificacoesLidas(ids?: string[]): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('marcar_notificacoes_lidas', ids ? { p_ids: ids } : {});
    if (error) return 0;
    return (data as number) ?? 0;
  } catch {
    return 0;
  }
}
