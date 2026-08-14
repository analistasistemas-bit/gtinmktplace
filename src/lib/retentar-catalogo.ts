import { supabase } from './supabase';

export interface ResultadoRetentarCatalogo {
  enfileirado: boolean;
}

/** Re-enfileira vincular-catalogo para família publicada com catálogo retentável (ADR-0021). */
export async function retentarCatalogo(familiaId: string): Promise<ResultadoRetentarCatalogo> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão ativa');

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/retentar-catalogo`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ familia_id: familiaId }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new Error(json?.erro ?? `Retentar catálogo falhou (${resp.status})`);
  }
  return json as ResultadoRetentarCatalogo;
}
