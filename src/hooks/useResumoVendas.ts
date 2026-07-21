import { useMemo } from 'react';
import { useVendas } from './useVendas';
import { useCustos } from './useCustos';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import { calcularResumo, type ResumoVendas } from '@/lib/resumo-vendas';
import { montarCustoResolver, montarPesoResolver, montarAliquotaResolver } from '@/lib/custos';
import type { Janela } from '@/lib/metricas';
import type { CanalAtivo } from '@/lib/canal-ativo';

/**
 * Resumo financeiro do período a partir da tabela ml_vendas (fonte única — ADR-0038). Os menus
 * Faturamento, Financeiro e Publicados consomem isto, então mostram o mesmo número.
 */
export function useResumoVendas(janela: Janela, canal: CanalAtivo = 'todos'): {
  resumo: ResumoVendas;
  isFetching: boolean;
  refetch: () => void;
  error: boolean;
  dataUpdatedAt: number;
} {
  const vendasQ = useVendas(janela, 'todos', canal);
  const custosQ = useCustos();
  const aliquotasQ = useAliquotas();
  // Default 8/16 só cobre o loading inicial (data ainda undefined, sem erro). Em erro real de
  // aliquotasQ, `data` fica undefined (1ª carga) ou mantém o último valor bom (TanStack Query não
  // limpa data em refetch com erro) — nos dois casos NÃO aproximamos com 8/16: sem config
  // resolvida, o resolver de alíquota devolve null (sem imposto) em vez de um número possivelmente
  // errado (ADR-0055: imposto por origem nunca defaulta em silêncio).
  const aliquotas = useMemo(
    () => aliquotasQ.data ?? (aliquotasQ.isError ? null : { nacional: 8, importado: 16 }),
    [aliquotasQ.data, aliquotasQ.isError],
  );
  const resumo = useMemo(
    () => calcularResumo(
      vendasQ.data ?? [],
      montarCustoResolver(custosQ.data),
      montarPesoResolver(custosQ.data),
      undefined,
      montarAliquotaResolver(custosQ.data, aliquotas),
    ),
    [vendasQ.data, custosQ.data, aliquotas],
  );
  return {
    resumo,
    isFetching: vendasQ.isFetching,
    refetch: () => { vendasQ.refetch(); },
    error: vendasQ.isError || custosQ.isError || aliquotasQ.isError,
    dataUpdatedAt: vendasQ.dataUpdatedAt,
  };
}
