import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/** Leitura pontual (fora de React). */
export function prefersReducedMotion(): boolean {
  return window.matchMedia(QUERY).matches;
}

/**
 * Hook reativo de `prefers-reduced-motion`. O bloco global em `src/index.css`
 * (rede de segurança) zera durações; use este hook quando a animação carregar
 * informação funcional e precisar de fallback explícito (crossfade/estático).
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion);
}
