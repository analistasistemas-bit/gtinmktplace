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
  const [tamanho, setTamanhoState] = useState(opts?.tamanhoInicial ?? 10);

  // `paginar` clampa a página ao range válido do `itens` atual; a página efetiva
  // (r.paginaAtual) é a verdade exibida. A navegação opera sobre o estado bruto
  // via updater funcional (referências estáveis) — o clamp do `paginar` corrige
  // qualquer overshoot no render seguinte.
  const r = paginar(itens, pagina, tamanho);

  const irPara = useCallback((p: number) => setPagina(p), []);
  const proxima = useCallback(() => setPagina((p) => p + 1), []);
  const anterior = useCallback(() => setPagina((p) => Math.max(1, p - 1)), []);
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
