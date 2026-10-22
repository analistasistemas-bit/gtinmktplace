import { vi } from 'vitest';

/** `chrome` mínimo para os testes: storage.session em memória e manifest de produção. */
export function instalarChromeFalso(matches = ['https://app.publiai.daludi.com.br/*']) {
  const dados: Record<string, unknown> = {};
  const chromeFalso = {
    runtime: {
      id: 'ext-publiai',
      getManifest: () => ({ externally_connectable: { matches } }),
      getURL: (p: string) => `chrome-extension://ext-publiai/${p}`,
      sendMessage: vi.fn(async (_msg: unknown) => undefined),
    },
    sidePanel: { open: vi.fn(async () => {}) },
    storage: {
      session: {
        get: vi.fn(async (k: string | string[] | null) =>
          Object.fromEntries((k === null ? Object.keys(dados) : Array.isArray(k) ? k : [k]).filter((c) => c in dados).map((c) => [c, dados[c]]))),
        set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(dados, o); }),
        remove: vi.fn(async (k: string | string[]) => { for (const c of Array.isArray(k) ? k : [k]) delete dados[c]; }),
      },
    },
  };
  vi.stubGlobal('chrome', chromeFalso);
  return dados;
}
