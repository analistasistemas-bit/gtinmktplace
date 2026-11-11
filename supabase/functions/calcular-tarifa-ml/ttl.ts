import type { Proveniencia } from '../_shared/ml/proveniencia.ts';

const TTL_PADRAO_S = 6 * 60 * 60; // 6h — comissões mudam raramente
const TTL_ESTIMADA_S = 300; // falha do ML não pode congelar a cotação por 6h

export function ttlTarifa(proveniencia: Proveniencia): number {
  return proveniencia === 'estimated' ? TTL_ESTIMADA_S : TTL_PADRAO_S;
}
