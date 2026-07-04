import { supabase } from './supabase';

async function chamarEdge<T>(fn: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.erro ?? `Falha (${resp.status})`);
  return json as T;
}

export interface ResultadoExcluirLote {
  familias_removidas: number; imagens_removidas: number;
  familias_preservadas: number; lote_removido: boolean;
}
export const excluirLote = (loteId: string) =>
  chamarEdge<ResultadoExcluirLote>('excluir-lote', { lote_id: loteId });

export const removerPublicado = (familiaId: string) =>
  chamarEdge<{ ok: true; familias_removidas: number; lotes_removidos: number }>(
    'remover-publicado',
    { familia_id: familiaId },
  );

export const pausarReativarPublicado = (mlItemId: string, status: 'ativo' | 'pausado') =>
  chamarEdge<{ ok: true }>('atualizar-status-publicado', { ml_item_id: mlItemId, status });
