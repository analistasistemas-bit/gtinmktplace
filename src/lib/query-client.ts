import { MutationCache, QueryClient, onlineManager } from '@tanstack/react-query';
import { toast } from 'sonner';

// Singleton exportado (não instanciado em main.tsx) para que auth-store.ts também tenha acesso,
// sem import circular — precisa chamar queryClient.clear() na troca de conta/logout.
export const queryClient = new QueryClient({
  // ADR-0153 (D2) promete que a escrita offline falha "com aviso". A maior parte das mutations
  // já avisa por conta própria, mas algumas são mudas — inclusive de preço (exibir desconto,
  // % de desconto, atacado, variação principal): offline o clique não fazia nada e não dizia
  // nada. Este handler só dispara quando a rede está fora, então não duplica o aviso das
  // mutations que já tratam erro no caminho normal; o `id` fixo impede vários toasts iguais
  // quando o operador clica em série sem perceber que está sem conexão.
  mutationCache: new MutationCache({
    onError: () => {
      if (!onlineManager.isOnline()) {
        toast.error('Sem conexão — a ação não foi executada.', { id: 'mutacao-offline' });
      }
    },
  }),
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
    // ADR-0153 (D2): nenhuma escrita offline. Sem 'always' o react-query pausa a mutation sem
    // rede e dispara sozinha ao reconectar — executando depois uma decisão comercial tomada
    // sobre um dado que já mudou. Sem rede a mutation tem que falhar na hora, com aviso.
    mutations: { networkMode: 'always' },
  },
});
