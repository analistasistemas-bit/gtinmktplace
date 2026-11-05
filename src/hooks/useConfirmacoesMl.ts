import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { buscarTodasPaginas } from '@/lib/paginacao-supabase';
import { QK } from '@/lib/queries';
import { intervaloConfirmacoes, type ConfirmacaoMl } from '@/lib/confirmacao-ml';
import { useLote } from '@/hooks/useLotes';

const COLUNAS = 'id, familia_id, codigo_pai, item_externo_id, status, divergentes, capados, enviado_em';

export function useConfirmacoesMl(loteId: string | undefined) {
  const { data: lote } = useLote(loteId);
  const statusLote = lote?.status;
  const query = useQuery<ConfirmacaoMl[]>({
    queryKey: QK.confirmacoesMl(loteId ?? ''),
    queryFn: () => buscarTodasPaginas<ConfirmacaoMl>((de, ate) => supabase.from('confirmacoes_ml')
      .select(COLUNAS).eq('lote_id', loteId!).order('id').range(de, ate) as never),
    enabled: !!loteId,
    refetchInterval: (q) => intervaloConfirmacoes(q.state.data ?? [], statusLote === 'publicando', new Date()),
    // Re-renderiza a cada leitura mesmo com dados iguais, para o teto de 20 min aparecer na tela.
    notifyOnChangeProps: ['data', 'dataUpdatedAt'],
  });

  // Lote rápido fecha entre duas leituras: sem isto, sem nenhuma linha lida, o polling pararia no vazio.
  const { refetch } = query;
  useEffect(() => {
    if (statusLote) void refetch();
  }, [statusLote, refetch]);

  return query;
}
