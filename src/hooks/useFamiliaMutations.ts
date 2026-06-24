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
  updateFamiliaAtacado,
  setAtacadoLote,
  QK,
} from '@/lib/queries';
import type { FaixaAtacado } from '@/lib/atacado';
import { regenerarCopyFamilia } from '@/lib/ai-copy';
import { reprocessarFamilia } from '@/lib/reprocessar';
import { definirCategoriaFamilia, type TipoCategoriaManual } from '@/lib/categoria';

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

/** Reenvia famílias em erro (ADR-0030): uma (familiaId) ou todas as do lote (loteId). */
export function useReprocessar(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (alvo: { familiaId: string } | { loteId: string }) =>
      reprocessarFamilia(alvo),
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

export function useDefinirCategoria(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ familiaId, tipo }: { familiaId: string; tipo: TipoCategoriaManual }) =>
      definirCategoriaFamilia(familiaId, tipo),
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

export function useUpdateFamiliaAtacado(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ familiaId, faixas }: { familiaId: string; faixas: FaixaAtacado[] }) =>
      updateFamiliaAtacado(familiaId, faixas),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}

export function useSetAtacadoLote(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (faixas: FaixaAtacado[]) => setAtacadoLote(loteId, faixas),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}
