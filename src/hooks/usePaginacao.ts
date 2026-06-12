import { useCallback, useState } from 'react';
import { paginar, type ResultadoPaginacao } from '@/lib/paginacao';

export interface UsePaginacao<T> extends ResultadoPaginacao<T> {
  tamanho: number;
  irPara: (pagina: number) => void;
  proxima: () => void;
  anterior: () => void;
  setTamanho: (n: number) => void;
  reset: () => void;
}

export function usePaginacao<T>(itens: T[], opts?: { tamanhoInicial?: number }): UsePaginacao<T> {
  const [pagina, setPagina] = useState(1);
  const [tamanho, setTamanhoState] = useState(opts?.tamanhoInicial ?? 5);

  // `paginar` clampa a página ao range válido do `itens` atual; a página efetiva
  // (r.paginaAtual) é a verdade exibida e a base da navegação.
  const r = paginar(itens, pagina, tamanho);

  const irPara = useCallback((p: number) => setPagina(p), []);
  const proxima = useCallback(() => setPagina(r.paginaAtual + 1), [r.paginaAtual]);
  const anterior = useCallback(
    () => setPagina(Math.max(1, r.paginaAtual - 1)),
    [r.paginaAtual],
  );
  const setTamanho = useCallback((n: number) => {
    setTamanhoState(n);
    setPagina(1);
  }, []);
  const reset = useCallback(() => setPagina(1), []);

  return {
    ...r,
    tamanho,
    irPara,
    proxima,
    anterior,
    setTamanho,
    reset,
  };
}
