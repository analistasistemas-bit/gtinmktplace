import { supabase } from './supabase';

export interface IngestResult {
  loteId: string;
  totalFamilias: number;
}

export async function chamarIngest(loteId: string): Promise<IngestResult> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada');

  const resp = await fetch(`${url}/functions/v1/ingest-lote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ lote_id: loteId }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`ingest-lote falhou (${resp.status}): ${txt}`);
  }
  return resp.json();
}
