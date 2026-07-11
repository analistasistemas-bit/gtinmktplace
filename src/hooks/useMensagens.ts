import { useQuery } from '@tanstack/react-query';
import { buscarConversas, type Conversa } from '@/lib/mensagens';

/** Conversas de pós-venda (aguardando resposta no topo). */
export function useListaMensagens() {
  return useQuery<Conversa[]>({
    queryKey: ['mensagens'],
    queryFn: buscarConversas,
    staleTime: 60_000,
  });
}

/** Nº de conversas aguardando resposta (badge do menu/avatar). Deriva da lista (reusa cache). */
export function useMensagensAguardando(): number {
  const { data } = useListaMensagens();
  return (data ?? []).reduce((n, c) => n + (c.aguardando ? 1 : 0), 0);
}
