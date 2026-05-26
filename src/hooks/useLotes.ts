import { MOCK_LOTES } from '@/lib/mocks/lotes';
import type { Lote } from '@/lib/mocks/types';

export function useLotes(): Lote[] {
  return MOCK_LOTES;
}

export function useLote(id: string | undefined): Lote | undefined {
  if (!id) return undefined;
  return MOCK_LOTES.find((l) => l.id === id);
}
