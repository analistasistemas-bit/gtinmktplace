import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const BUCKET = 'imagens';
const EXPIRES_IN = 60 * 60; // 1h
const STALE_MS = 50 * 60 * 1000; // 50min

export function useImageUrl(path: string | undefined | null) {
  return useQuery({
    queryKey: ['signed-url', BUCKET, path],
    enabled: !!path,
    staleTime: STALE_MS,
    gcTime: STALE_MS,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path!, EXPIRES_IN);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}
