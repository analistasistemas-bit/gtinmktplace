import { supabase } from './supabase';

export interface ResultadoUpload {
  ok: number;
  ja_tinha: number;
  sem_match: number;
  erros: Array<{ arquivo: string; motivo: string }>;
}

export async function uploadImagensLote(
  loteId: string,
  arquivos: File[],
): Promise<ResultadoUpload> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão ativa');
  const form = new FormData();
  form.append('lote_id', loteId);
  arquivos.forEach((f) => form.append('files', f));
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-imagens-lote`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: form,
  });
  if (!resp.ok) {
    const texto = await resp.text();
    throw new Error(`Upload falhou (${resp.status}): ${texto}`);
  }
  return resp.json();
}
