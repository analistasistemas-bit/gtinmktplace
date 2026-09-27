import type { StatusTone } from '@/components/ui/status-pill';
import type { Alerta, Tendencia } from '@/lib/vendas-sku';

// Rótulos compartilhados pelo ranking da aba Vendas SKU e pelo dossiê.
export const TENDENCIA: Record<Tendencia, { label: string; tom: StatusTone; dica: string }> = {
  novo: { label: 'Novo', tom: 'info', dica: '1ª venda há menos de 30 dias' },
  em_alta: { label: 'Em alta', tom: 'success', dica: '+20% ou mais em unidades: últimos 30 dias contra os 30 anteriores' },
  em_queda: { label: 'Em queda', tom: 'danger', dica: '−20% ou menos em unidades: últimos 30 dias contra os 30 anteriores' },
  estavel: { label: 'Estável', tom: 'neutral', dica: 'Entre −20% e +20%' },
  parado: { label: 'Parado', tom: 'warning', dica: 'Já vendeu; nenhuma venda nos últimos 30 dias' },
  baixo_giro: { label: 'Baixo giro', tom: 'neutral', dica: 'Menos de 5 unidades nas duas janelas de 30 dias' },
};
export const ALERTA: Record<Alerta, { label: string; tom: StatusTone }> = {
  lucro_negativo: { label: 'Lucro negativo', tom: 'danger' },
  cobertura_baixa: { label: 'Estoque < 15 dias', tom: 'warning' },
  devolucao_alta: { label: 'Devolução > 5%', tom: 'warning' },
  sem_custo: { label: 'Sem custo', tom: 'warning' },
};
