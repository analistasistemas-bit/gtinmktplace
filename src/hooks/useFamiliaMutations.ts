import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  updateVariacaoPreco,
  updateFamiliaTitulo,
  updateFamiliaDescricao,
  QK,
} from '@/lib/queries';

export function useUpdateVariacaoPreco(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, preco }: { id: string; preco: number }) =>
      updateVariacaoPreco(id, preco),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}

export function useUpdateFamiliaTitulo(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, titulo }: { id: string; titulo: string }) =>
      updateFamiliaTitulo(id, titulo),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}

export function useUpdateFamiliaDescricao(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, descricao }: { id: string; descricao: string }) =>
      updateFamiliaDescricao(id, descricao),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}
