import '@testing-library/jest-dom/vitest';

// jsdom não implementa window.matchMedia, e `Login.tsx` o consulta para respeitar
// prefers-reduced-motion. Sem este polyfill, `tests/App.test.tsx` só passava quando o worker do
// vitest calhava de rodar antes um teste que faz `vi.spyOn(window, 'matchMedia')` — flake de ordem
// que reprovava o CI sem ninguém ter mexido no roteamento.
// Os testes que espionam matchMedia continuam funcionando: spyOn exige que a propriedade exista.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList),
  });
}

// jsdom não implementa ResizeObserver — Radix (Popover/Select/…) usa `useSize` internamente para
// medir o trigger, e explode com `ResizeObserver is not defined` assim que um teste abre um deles.
if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver;
}
