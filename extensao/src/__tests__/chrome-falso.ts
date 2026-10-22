import { vi } from 'vitest';

/** `chrome` mínimo para os testes: storage.session em memória e manifest de produção. */
export function instalarChromeFalso(matches = ['https://app.publiai.daludi.com.br/*']) {
  const dados: Record<string, unknown> = {};
  const chromeFalso = {
    runtime: {
      id: 'ext-publiai',
      getManifest: () => ({ externally_connectable: { matches } }),
      getURL: (p: string) => `chrome-extension://ext-publiai/${p}`,
    },
    sidePanel: { open: vi.fn(async () => {}) },
    storage: {
      session: {
        get: vi.fn(async (k: string) => (k in dados ? { [k]: dados[k] } : {})),
        set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(dados, o); }),
        remove: vi.fn(async (k: string) => { delete dados[k]; }),
      },
    },
  };
  vi.stubGlobal('chrome', chromeFalso);
  return dados;
}
