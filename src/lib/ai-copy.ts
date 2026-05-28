import { supabase } from './supabase';

export async function regenerarCopyFamilia(
  familiaId: string,
): Promise<{ titulo: string; descricao: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');

  const r = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/regenerar-copy-familia`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ familia_id: familiaId }),
    },
  );

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Falha ao regenerar: ${txt || r.status}`);
  }
  return r.json();
}
