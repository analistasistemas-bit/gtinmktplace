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

// Geração da página na aba: muda a cada navegação. Resposta que chega depois de uma navegação não grava
// o anúncio anterior. Em storage.session (sobrevive ao SW reiniciar); ausente = nenhuma navegação vista ainda.
const chaveGeracao = (tabId: number) => `geracao:${tabId}`;

export async function geracaoDaAba(tabId: number): Promise<string | null> {
  const v = (await chrome.storage.session.get(chaveGeracao(tabId)))[chaveGeracao(tabId)];
  return typeof v === 'string' ? v : null;
}

/** A aba começou a carregar outra página: nova geração primeiro, depois some o estado. */
export async function novaPaginaNaAba(tabId: number): Promise<void> {
  await chrome.storage.session.set({ [chaveGeracao(tabId)]: crypto.randomUUID() });
  await chrome.storage.session.remove(chaveEstado(tabId));
}

/** Aba fechada. */
export async function esquecerEstado(tabId: number): Promise<void> {
  await chrome.storage.session.remove(chaveEstado(tabId));
  await chrome.storage.session.remove(chaveGeracao(tabId));
}
