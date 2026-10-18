import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QK } from '@/lib/queries';
import { pausarReativarPublicado } from '@/lib/excluir';

export function usePausarReativarPublicado() {
  const qc = useQueryClient();
  return useMutation({
    // UP: um MLB por SKU (alvosStatus). Sequencial de propósito: cada chamada pode renovar o token
    // da conexão, e refresh concorrente no ML derruba a conexão (refresh token de uso único).
    mutationFn: async ({ mlItemIds, status }: { mlItemIds: string[]; status: 'ativo' | 'pausado' }) => {
      const falhas: { mlItemId: string; erro: string }[] = [];
      for (const id of mlItemIds) {
        try {
          await pausarReativarPublicado(id, status);
        } catch (err) {
          falhas.push({ mlItemId: id, erro: err instanceof Error ? err.message : String(err) });
        }
      }
      return { total: mlItemIds.length, falhas };
    },
    onSettled: () => {
      // Sem persistência local do status — força reconsulta real no ML (ADR-0060).
      qc.invalidateQueries({ queryKey: QK.statusPublicados });
    },
  });
}
