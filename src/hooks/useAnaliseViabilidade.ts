import { useMutation } from '@tanstack/react-query';
import { analisarPlanilha, analisarGtins, type RespostaAnalise } from '@/lib/viabilidade';

type Entrada = { tipo: 'planilha'; file: File } | { tipo: 'gtins'; gtins: string[] };

/** Dispara a análise (planilha ou GTINs colados). Mutation: sem cache, on-demand. */
export function useAnaliseViabilidade() {
  return useMutation<RespostaAnalise, Error, Entrada>({
    mutationFn: (e) => (e.tipo === 'planilha' ? analisarPlanilha(e.file) : analisarGtins(e.gtins)),
  });
}
