import { supabase } from './supabase';

// O Supabase Storage rejeita keys com acentos/espaços/caracteres especiais
// ("Invalid key"). Sanitiza o nome do arquivo preservando os caracteres que o
// match de imagens usa (dígitos, _, ., -) — ex.: "00CODIGO.jpeg"/"CAPA_00CODIGO.jpg"
// passam inalterados; "Teste MKTPLACE - cópia.xlsx" vira "Teste_MKTPLACE_-_copia.xlsx".
export function sanitizarNomeArquivo(filename: string): string {
  return filename
    .replace(/^[/\\]+/, '')
    .split(/[/\\]/)
    .pop()!
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]/g, '_');
}

export function buildStoragePath(userId: string, loteId: string, filename: string): string {
  return `${userId}/${loteId}/${sanitizarNomeArquivo(filename)}`;
}

export async function uploadFile(bucket: string, path: string, file: File): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw error;
  return data.path;
}

export async function signedUrl(bucket: string, path: string, expiresIn = 60): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}
