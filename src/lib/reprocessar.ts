import { supabase } from './supabase';

export interface ResultadoReprocessar {
  reenviadas: number;
}

/**
 * Reprocessa famílias travadas em 'erro' (ADR-0030). Passe `familia_id` para uma família
 * ou `lote_id` para todas as do lote em erro. A edge reseta para 'pendente' e re-enfileira
 * o process-familia.
 */
export async function reprocessarFamilia(
  alvo: { familiaId: string } | { loteId: string },
): Promise<ResultadoReprocessar> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão ativa');

  const corpo = 'familiaId' in alvo
    ? { familia_id: alvo.familiaId }
    : { lote_id: alvo.loteId };

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reprocessar-familia`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(corpo),
  });
  if (!resp.ok) {
    const texto = await resp.text();
    throw new Error(`Reenvio falhou (${resp.status}): ${texto}`);
  }
  return resp.json();
}
