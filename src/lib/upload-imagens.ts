import { supabase } from './supabase';

export interface ResultadoUpload {
  ok: number;
  ja_tinha: number;
  sem_match: number;
  capas_ok: number;
  capas_sem_match: number;
  capas2_ok: number;
  capas2_sem_match: number;
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

export async function subirCapaFamilia(
  loteId: string,
  codigoPai: string,
  arquivo: File,
): Promise<void> {
  const codigoPadronizado = codigoPai.padStart(8, '0');
  const ext = arquivo.name.split('.').pop()?.toLowerCase() ?? 'jpeg';
  const nomeRenomeado = `CAPA_${codigoPadronizado}.${ext}`;
  const renomeado = new File([arquivo], nomeRenomeado, { type: arquivo.type });
  const r = await uploadImagensLote(loteId, [renomeado]);
  if (r.capas_ok !== 1) {
    throw new Error(
      r.capas_sem_match > 0
        ? `Família ${codigoPai} não encontrada no lote.`
        : (r.erros[0]?.motivo ?? r.erros[0] as unknown as string) || 'Falha ao subir capa.',
    );
  }
}

export async function removerCapaFamilia(familiaId: string, capaStoragePath: string): Promise<void> {
  const { error: upErr } = await supabase
    .from('familias')
    .update({ capa_storage_path: null })
    .eq('id', familiaId);
  if (upErr) throw new Error(upErr.message);
  const { error: rmErr } = await supabase.storage.from('imagens').remove([capaStoragePath]);
  if (rmErr) console.warn('Falha ao remover capa do storage:', rmErr.message);
}

export async function subirCapa2Familia(
  loteId: string,
  codigoPai: string,
  arquivo: File,
): Promise<void> {
  const codigoPadronizado = codigoPai.padStart(8, '0');
  const ext = arquivo.name.split('.').pop()?.toLowerCase() ?? 'jpeg';
  const nomeRenomeado = `CAPA2_${codigoPadronizado}.${ext}`;
  const renomeado = new File([arquivo], nomeRenomeado, { type: arquivo.type });
  const r = await uploadImagensLote(loteId, [renomeado]);
  if (r.capas2_ok !== 1) {
    throw new Error(
      r.capas2_sem_match > 0
        ? `Família ${codigoPai} não encontrada no lote.`
        : (r.erros[0]?.motivo ?? r.erros[0] as unknown as string) || 'Falha ao subir 2ª foto.',
    );
  }
}

export async function removerCapa2Familia(familiaId: string, capa2StoragePath: string): Promise<void> {
  const { error: upErr } = await supabase
    .from('familias')
    .update({ capa2_storage_path: null })
    .eq('id', familiaId);
  if (upErr) throw new Error(upErr.message);
  const { error: rmErr } = await supabase.storage.from('imagens').remove([capa2StoragePath]);
  if (rmErr) console.warn('Falha ao remover 2ª foto do storage:', rmErr.message);
}
