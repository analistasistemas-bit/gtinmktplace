// EAN da busca por aba (ADR-0189). Só o service worker usa: content scripts e painel pedem por mensagem.
const chave = (tabId: number) => `ean:${tabId}`;

export async function registrarEanDaAba(tabId: number, ean: string): Promise<void> {
  await chrome.storage.session.set({ [chave(tabId)]: ean });
}

export async function eanDaAba(tabId: number): Promise<string | null> {
  const v = (await chrome.storage.session.get(chave(tabId)))[chave(tabId)];
  return typeof v === 'string' ? v : null;
}

export async function esquecerAba(tabId: number): Promise<void> {
  await chrome.storage.session.remove(chave(tabId));
}

// Última análise do anúncio feita pelo content script na aba, para o painel (Task 10).
// storage.session e não memória: o SW do MV3 morre ocioso e o painel pode abrir depois.
const chaveEstado = (tabId: number) => `estado:${tabId}`;

export async function registrarEstado(tabId: number, estado: { entrada: object; resposta: unknown }): Promise<void> {
  await chrome.storage.session.set({ [chaveEstado(tabId)]: estado });
}

export async function estadoDaAba(tabId: number): Promise<unknown> {
  return (await chrome.storage.session.get(chaveEstado(tabId)))[chaveEstado(tabId)] ?? null;
}

export async function esquecerEstado(tabId: number): Promise<void> {
  await chrome.storage.session.remove(chaveEstado(tabId));
}
