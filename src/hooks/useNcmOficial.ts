import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// ADR-0187: consulta a tabela oficial de NCM (Siscomex). A vigência é decidida só pelo SQL
// (`ncm_consultar`) — o front nunca compara datas.
export type NcmStatus = 'incompleto' | 'carregando' | 'ok' | 'inexistente' | 'vencido' | 'erro';

export function useNcmOficial(ncm: string): { status: NcmStatus; descricao: string | null } {
  const completo = /^\d{8}$/.test(ncm);
  const q = useQuery({
    queryKey: ['ncm-oficial', ncm],
    enabled: completo,
    // A vigência muda no banco sem o código mudar: sempre reconsulta.
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ncm_consultar', { p_codigos: [ncm] });
      if (error) throw error;
      return (data ?? []).find((r) => r.codigo === ncm) ?? null;
    },
  });
  if (!completo) return { status: 'incompleto', descricao: null };
  // Erro de um refetch prevalece sobre dado antigo (fail-closed).
  if (q.isError) return { status: 'erro', descricao: null };
  if (q.isPending) return { status: 'carregando', descricao: null };
  if (!q.data) return { status: 'inexistente', descricao: null };
  return { status: q.data.vigente ? 'ok' : 'vencido', descricao: q.data.descricao };
}
