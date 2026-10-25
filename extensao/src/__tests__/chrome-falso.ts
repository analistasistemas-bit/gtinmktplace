import { vi } from 'vitest';

/** storage.local do último `instalarChromeFalso` (credenciais da sessão própria ficam aqui). */
export let local: Record<string, unknown> = {};

const area = (dados: Record<string, unknown>) => ({
  get: vi.fn(async (k: string | string[] | null) =>
    Object.fromEntries((k === null ? Object.keys(dados) : Array.isArray(k) ? k : [k]).filter((c) => c in dados).map((c) => [c, dados[c]]))),
  set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(dados, o); }),
  remove: vi.fn(async (k: string | string[]) => { for (const c of Array.isArray(k) ? k : [k]) delete dados[c]; }),
});

/** `chrome` mínimo para os testes: storage.session/local em memória e manifest de produção. Devolve o storage.session. */
export function instalarChromeFalso(matches = ['https://app.publiai.daludi.com.br/*']) {
  const dados: Record<string, unknown> = {};
  local = {};
  const ouvinte = () => ({ addListener: vi.fn() });
  const chromeFalso = {
    runtime: {
      id: 'ext-publiai',
      getManifest: () => ({ externally_connectable: { matches } }),
      getURL: (p: string) => `chrome-extension://ext-publiai/${p}`,
      sendMessage: vi.fn(async (_msg: unknown) => undefined),
      onMessage: ouvinte(),
      onMessageExternal: ouvinte(),
    },
    sidePanel: {
      open: vi.fn(async () => {}),
      setOptions: vi.fn(async (_o: chrome.sidePanel.PanelOptions) => {}),
      setPanelBehavior: vi.fn(async () => {}),
    },
    alarms: {
      create: vi.fn(async (_nome: string, _info: { when: number }) => {}),
      clear: vi.fn(async (_nome: string) => true),
      onAlarm: ouvinte(),
    },
    tabs: {
      sendMessage: vi.fn(async (_tabId: number, _msg: unknown) => undefined),
      query: vi.fn(async (_q: unknown): Promise<chrome.tabs.Tab[]> => []),
      get: vi.fn(async (id: number): Promise<chrome.tabs.Tab> => ({ id }) as chrome.tabs.Tab),
      onUpdated: ouvinte(),
      onRemoved: ouvinte(),
    },
    storage: {
      session: area(dados),
      local: { ...area(local), setAccessLevel: vi.fn(async (_o: { accessLevel: string }) => {}) },
    },
  };
  vi.stubGlobal('chrome', chromeFalso);
  return dados;
}

/** Sessão própria já logada (como depois de `entrar` + `definirIdentidade`), escrita direto no storage.local. */
export function logar(o: Record<string, unknown> = {}) {
  local.credenciais = {
    accessToken: 'tok', refreshToken: 'ref', expiresAt: Math.floor(Date.now() / 1000) + 3600, userId: 'u1',
    identidade: 'u1:org1:', perfil: { nome: 'Diego', email: 'd@x.com', orgNome: 'Avil' }, ...o,
  };
}
