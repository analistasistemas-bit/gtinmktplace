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
