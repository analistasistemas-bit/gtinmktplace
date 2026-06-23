import { useMemo } from 'react';
import { useVendas } from './useVendas';
import { useCustos } from './useCustos';
import { calcularResumo, type ResumoVendas } from '@/lib/resumo-vendas';
import { montarCustoResolver } from '@/lib/custos';
import type { Janela } from '@/lib/metricas';

/**
 * Resumo financeiro do período a partir da tabela ml_vendas (fonte única — ADR-0038). Os menus
 * Faturamento, Financeiro e Publicados consomem isto, então mostram o mesmo número.
 */
export function useResumoVendas(janela: Janela): {
  resumo: ResumoVendas;
  isFetching: boolean;
  refetch: () => void;
  error: boolean;
  dataUpdatedAt: number;
} {
  const vendasQ = useVendas(janela, 'todos');
  const custosQ = useCustos();
  const resumo = useMemo(
    () => calcularResumo(vendasQ.data ?? [], montarCustoResolver(custosQ.data)),
    [vendasQ.data, custosQ.data],
  );
  return {
    resumo,
    isFetching: vendasQ.isFetching,
    refetch: () => { vendasQ.refetch(); },
    error: vendasQ.isError,
    dataUpdatedAt: vendasQ.dataUpdatedAt,
  };
}
