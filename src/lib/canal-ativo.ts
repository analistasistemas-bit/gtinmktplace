import type { CanalId } from '@/lib/canais';

export type CanalAtivo = 'todos' | CanalId;

/** Valida o valor de ?canal= contra os canais operáveis da org. Lixo/não-operável → 'todos'. */
export function parseCanalAtivo(v: string | null, operaveis: string[]): CanalAtivo {
  if (v && operaveis.includes(v)) return v as CanalId;
  return 'todos';
}
