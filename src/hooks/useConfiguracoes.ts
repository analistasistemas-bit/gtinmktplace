import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchDescontoPct, upsertDescontoPct,
  fetchAliquotas, upsertAliquotas,
  fetchTelegramConfig, salvarTelegramConfig, enviarTesteTelegram, verificarModeradosAgora,
} from '@/lib/queries';

export function useDescontoPct() {
  return useQuery({ queryKey: ['configuracoes', 'desconto_pct'], queryFn: fetchDescontoPct });
}
export function useSalvarDescontoPct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pct: number) => upsertDescontoPct(pct),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'desconto_pct'] }),
  });
}

export function useAliquotas() {
  return useQuery({ queryKey: ['configuracoes', 'aliquotas'], queryFn: fetchAliquotas });
}
export function useSalvarAliquotas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { nacional: number; importado: number }) => upsertAliquotas(a),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'aliquotas'] }),
  });
}

export function useTelegramConfig() {
  return useQuery({ queryKey: ['configuracoes', 'telegram'], queryFn: fetchTelegramConfig });
}
export function useSalvarTelegramConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { chatId: string; ativo: boolean; botToken?: string }) => salvarTelegramConfig(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'telegram'] }),
  });
}
export function useEnviarTesteTelegram() {
  return useMutation({ mutationFn: enviarTesteTelegram });
}
export function useVerificarModeradosAgora() {
  return useMutation({ mutationFn: verificarModeradosAgora });
}
