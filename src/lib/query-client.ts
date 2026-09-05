import { QueryClient } from '@tanstack/react-query';

// Singleton exportado (não instanciado em main.tsx) para que auth-store.ts também tenha acesso,
// sem import circular — precisa chamar queryClient.clear() na troca de conta/logout.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
    // ADR-0153 (D2): nenhuma escrita offline. Sem 'always' o react-query pausa a mutation sem
    // rede e dispara sozinha ao reconectar — executando depois uma decisão comercial tomada
    // sobre um dado que já mudou. Sem rede a mutation tem que falhar na hora, com aviso.
    mutations: { networkMode: 'always' },
  },
});
