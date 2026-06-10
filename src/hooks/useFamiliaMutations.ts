import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  updateVariacaoPreco,
  updateVariacaoCor,
  updateFamiliaTitulo,
  updateFamiliaDescricao,
  updateVariacaoPrincipal,
  updateFamiliaExibirDesconto,
  updateFamiliaDescontoPct,
  toggleDescontoLote,
  QK,
} from '@/lib/queries';
import { regenerarCopyFamilia } from '@/lib/ai-copy';

export function useUpdateVariacaoPreco(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, preco }: { id: string; preco: number }) =>
      updateVariacaoPreco(id, preco),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}

export function useUpdateVariacaoCor(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, codigo, cor }: { id: string; codigo: string; cor: string }) =>
      updateVariacaoCor(id, codigo, cor),
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

export function useRegenerarCopy(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (familiaId: string) => regenerarCopyFamilia(familiaId),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}

export function useUpdateVariacaoPrincipal(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ familiaId, codigo }: { familiaId: string; codigo: string }) =>
      updateVariacaoPrincipal(familiaId, codigo),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}

export function useUpdateExibirDesconto(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ familiaId, exibir }: { familiaId: string; exibir: boolean }) =>
      updateFamiliaExibirDesconto(familiaId, exibir),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}

export function useUpdateDescontoPctFamilia(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ familiaId, pct }: { familiaId: string; pct: number | null }) =>
      updateFamiliaDescontoPct(familiaId, pct),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}

export function useToggleDescontoLote(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (exibir: boolean) => toggleDescontoLote(loteId, exibir),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}
