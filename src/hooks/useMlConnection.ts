import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface EstadoConexaoML {
  conectado: boolean;
  nickname: string | null;
  mlUserId: string | null;
  scope: string | null;
  /** null = não checado (conexão antiga, ainda não reconectada); false = sem Mercado Envios (me2). */
  me2Habilitado: boolean | null;
}

export function useMlConnection() {
  return useQuery<EstadoConexaoML>({
    queryKey: ['ml-connection'],
    staleTime: 5 * 60 * 1000, // estado só muda por ação explícita; invalidamos no disconnect
    queryFn: async () => {
      // Fonte da conexão é marketplace_connections (ADR-0027); ml_credentials é tabela
      // congelada — conexões novas só existem aqui. RLS escopa por org (current_org_id()).
      const { data, error } = await supabase
        .from('marketplace_connections')
        .select('conta_label, conta_externa_id, scope, me2_habilitado')
        .eq('canal', 'mercado_livre')
        .maybeSingle();
      if (error) throw error;
      if (!data) return { conectado: false, nickname: null, mlUserId: null, scope: null, me2Habilitado: null };
      return {
        conectado: true,
        nickname: data.conta_label,
        mlUserId: data.conta_externa_id,
        scope: data.scope,
        me2Habilitado: data.me2_habilitado,
      };
    },
  });
}
