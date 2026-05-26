import { MOCK_FAMILIAS } from '@/lib/mocks/familias';
import type { Familia } from '@/lib/mocks/types';

export function useFamilias(loteId: string | undefined): Familia[] {
  if (!loteId) return [];
  return MOCK_FAMILIAS.filter((f) => f.loteId === loteId);
}
