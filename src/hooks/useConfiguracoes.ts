import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchDescontoConcorrenciaPct, upsertDescontoConcorrenciaPct,
  fetchAliquotas, upsertAliquotas,
  fetchReancoraLiderAtiva, upsertReancoraLiderAtiva,
  fetchMonitorFreteAtivo, upsertMonitorFreteAtivo,
  fetchAlertasPromocoesAtivo, upsertAlertasPromocoesAtivo,
  fetchMostrarLucroDashboard, upsertMostrarLucroDashboard,
  fetchTelegramConfig, salvarTelegramConfig, enviarTesteTelegram, verificarModeradosAgora,
  fetchModeloTexto, upsertModeloTexto,
  fetchModeloImagem, upsertModeloImagem,
  fetchEmpresaFiscal, upsertEmpresaFiscal, type EmpresaFiscalRow,
} from '@/lib/queries';

export function useDescontoConcorrenciaPct() {
  return useQuery({ queryKey: ['configuracoes', 'desconto_concorrencia_pct'], queryFn: fetchDescontoConcorrenciaPct });
}
export function useSalvarDescontoConcorrenciaPct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pct: number) => upsertDescontoConcorrenciaPct(pct),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'desconto_concorrencia_pct'] }),
  });
}

export function useAliquotas() {
  return useQuery({ queryKey: ['configuracoes', 'aliquotas'], queryFn: fetchAliquotas });
}
export function useSalvarAliquotas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { nacional: number; importado: number; ufEmpresa?: string | null; internaPct?: number | null }) => upsertAliquotas(a),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'aliquotas'] }),
  });
}

export function useReancoraLiderAtiva() {
  return useQuery({ queryKey: ['configuracoes', 'reancora_lider_ativa'], queryFn: fetchReancoraLiderAtiva });
}
export function useSalvarReancoraLiderAtiva() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ativa: boolean) => upsertReancoraLiderAtiva(ativa),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'reancora_lider_ativa'] }),
  });
}

export function useMonitorFreteAtivo() {
  return useQuery({ queryKey: ['configuracoes', 'monitor_frete_ativo'], queryFn: fetchMonitorFreteAtivo });
}
export function useSalvarMonitorFreteAtivo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ativo: boolean) => upsertMonitorFreteAtivo(ativo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'monitor_frete_ativo'] }),
  });
}

export function useAlertasPromocoesAtivo() {
  return useQuery({ queryKey: ['configuracoes', 'alertas_promocoes_ativo'], queryFn: fetchAlertasPromocoesAtivo });
}
export function useSalvarAlertasPromocoesAtivo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ativo: boolean) => upsertAlertasPromocoesAtivo(ativo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'alertas_promocoes_ativo'] }),
  });
}

export function useMostrarLucroDashboard() {
  return useQuery({ queryKey: ['configuracoes', 'mostrar_lucro_dashboard'], queryFn: fetchMostrarLucroDashboard });
}
export function useSalvarMostrarLucroDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ativo: boolean) => upsertMostrarLucroDashboard(ativo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'mostrar_lucro_dashboard'] }),
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

export function useModeloTexto() {
  return useQuery({ queryKey: ['configuracoes', 'ai_model_texto'], queryFn: fetchModeloTexto });
}
export function useSalvarModeloTexto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => upsertModeloTexto(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'ai_model_texto'] }),
  });
}

export function useEmpresaFiscal() {
  return useQuery({ queryKey: ['configuracoes', 'empresa-fiscal'], queryFn: fetchEmpresaFiscal });
}
export function useSalvarEmpresaFiscal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<EmpresaFiscalRow>) => upsertEmpresaFiscal(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'empresa-fiscal'] }),
  });
}

export function useModeloImagem() {
  return useQuery({ queryKey: ['configuracoes', 'ai_model_imagem'], queryFn: fetchModeloImagem });
}
export function useSalvarModeloImagem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => upsertModeloImagem(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'ai_model_imagem'] }),
  });
}
