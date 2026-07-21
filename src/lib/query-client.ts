import { QueryClient } from '@tanstack/react-query';

// Singleton exportado (não instanciado em main.tsx) para que auth-store.ts também tenha acesso,
// sem import circular — precisa chamar queryClient.clear() na troca de conta/logout.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});
