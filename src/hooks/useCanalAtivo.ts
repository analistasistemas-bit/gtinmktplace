import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { canaisOperaveis } from '@/lib/canais';
import { parseCanalAtivo, type CanalAtivo } from '@/lib/canal-ativo';
import { useCanaisHabilitados } from '@/hooks/useCanaisHabilitados';

const CHAVE_SESSAO = 'publiai:canal-ativo';

/**
 * Canal ativo GLOBAL (D3): vive em ?canal= (deep-link, padrão da Publicados/Onda 2) e
 * persiste em sessionStorage para seguir o operador entre telas. Default 'todos'.
 */
export function useCanalAtivo() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: habilitados = ['mercado_livre'] } = useCanaisHabilitados();
  const operaveis = useMemo(() => canaisOperaveis(habilitados).map((c) => c.id as string), [habilitados]);
  const canal = parseCanalAtivo(searchParams.get('canal'), operaveis);

  // Sem ?canal na URL, restaura a escolha da sessão (replace: não empilha histórico).
  useEffect(() => {
    if (searchParams.get('canal')) return;
    const salvo = sessionStorage.getItem(CHAVE_SESSAO);
    if (salvo && parseCanalAtivo(salvo, operaveis) !== 'todos') {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set('canal', salvo);
        return p;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams, operaveis]);

  const setCanal = useCallback((novo: CanalAtivo) => {
    if (novo === 'todos') sessionStorage.removeItem(CHAVE_SESSAO);
    else sessionStorage.setItem(CHAVE_SESSAO, novo);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (novo === 'todos') p.delete('canal');
      else p.set('canal', novo);
      return p;
    }, { replace: true });
  }, [setSearchParams]);

  return { canal, setCanal, habilitados };
}
