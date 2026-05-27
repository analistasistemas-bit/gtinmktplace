import { supabase } from './supabase';

export function buildStoragePath(userId: string, loteId: string, filename: string): string {
  const cleanName = filename.replace(/^[/\\]+/, '').split(/[/\\]/).pop()!;
  return `${userId}/${loteId}/${cleanName}`;
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
