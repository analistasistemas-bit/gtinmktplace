import type { ClasseConcorrencia } from './tipos.ts';

export function classificarConcorrencia(vendedores: number): ClasseConcorrencia {
  if (vendedores <= 0) return 'sem';
  if (vendedores <= 5) return 'moderada';
  return 'alta';
}
