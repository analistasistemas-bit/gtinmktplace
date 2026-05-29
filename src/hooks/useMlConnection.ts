import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface EstadoConexaoML {
  conectado: boolean;
  nickname: string | null;
  mlUserId: string | null;
}

export function useMlConnection() {
  return useQuery<EstadoConexaoML>({
    queryKey: ['ml-connection'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ml_credentials')
        .select('ml_nickname, ml_user_id, expires_at')
        .maybeSingle();
      if (error) throw error;
      if (!data) return { conectado: false, nickname: null, mlUserId: null };
      return { conectado: true, nickname: data.ml_nickname, mlUserId: data.ml_user_id };
    },
  });
}
