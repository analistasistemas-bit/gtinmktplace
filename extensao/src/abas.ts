// EAN da busca por aba (ADR-0189). Só o service worker usa: content scripts e painel pedem por mensagem.
// Guardado como { ean, mlItemId }: o 1º anúncio analisado depois da busca fica com o EAN; outro anúncio
// na mesma aba (recomendado, navegação) segue sem ele. Nova busca troca (ou, sem EAN, limpa).
const chave = (tabId: number) => `ean:${tabId}`;
type EanAba = { ean: string; mlItemId: string | null };

export async function registrarEanDaAba(tabId: number, ean: string): Promise<void> {
  await chrome.storage.session.set({ [chave(tabId)]: { ean, mlItemId: null } satisfies EanAba });
}

async function lerEan(tabId: number): Promise<EanAba | null> {
  const v = (await chrome.storage.session.get(chave(tabId)))[chave(tabId)] as Partial<EanAba> | undefined;
  return typeof v?.ean === 'string' ? { ean: v.ean, mlItemId: typeof v.mlItemId === 'string' ? v.mlItemId : null } : null;
}

export async function eanDaAba(tabId: number): Promise<string | null> {
  return (await lerEan(tabId))?.ean ?? null;
}

/** EAN da busca para o anúncio `mlItemId`: liga ao 1º anúncio; só o mesmo anúncio (refresh/volta) o reaproveita. */
export async function eanParaAnuncio(tabId: number, mlItemId: string): Promise<string | null> {
  const v = await lerEan(tabId);
  if (!v) return null;
  if (v.mlItemId === null) {
    await chrome.storage.session.set({ [chave(tabId)]: { ean: v.ean, mlItemId } satisfies EanAba });
    return v.ean;
  }
  return v.mlItemId === mlItemId ? v.ean : null;
}

export async function esquecerAba(tabId: number): Promise<void> {
  await chrome.storage.session.remove(chave(tabId));
}

// Última análise do anúncio feita pelo content script na aba, para o painel (Task 10).
// storage.session e não memória: o SW do MV3 morre ocioso e o painel pode abrir depois.
// Geração da página na aba: muda a cada navegação. O estado é gravado com a geração de quando a análise
// começou, num único `set`; na leitura, estado de outra geração é descartado (resposta atrasada não volta).
const chaveEstado = (tabId: number) => `estado:${tabId}`;
const chaveGeracao = (tabId: number) => `geracao:${tabId}`;

interface EstadoGuardado { geracao: string | null; entrada: object; resposta: unknown }

export async function registrarEstado(tabId: number, estado: EstadoGuardado): Promise<void> {
  await chrome.storage.session.set({ [chaveEstado(tabId)]: estado });
}

/** Geração atual e o estado dela, numa leitura só. Geração ausente = nenhuma navegação vista ainda. */
export async function lerAba(tabId: number): Promise<{ geracao: string | null; estado: { entrada: object; resposta: unknown } | null }> {
  const r = await chrome.storage.session.get([chaveEstado(tabId), chaveGeracao(tabId)]);
  const g = r[chaveGeracao(tabId)];
  const geracao = typeof g === 'string' ? g : null;
  const e = r[chaveEstado(tabId)] as EstadoGuardado | undefined;
  return { geracao, estado: e && (e.geracao ?? null) === geracao ? { entrada: e.entrada, resposta: e.resposta } : null };
}

export const estadoDaAba = async (tabId: number) => (await lerAba(tabId)).estado;
export const geracaoDaAba = async (tabId: number) => (await lerAba(tabId)).geracao;

/** A aba foi para outra página: nova geração primeiro, depois some o estado. */
export async function novaPaginaNaAba(tabId: number): Promise<void> {
  await chrome.storage.session.set({ [chaveGeracao(tabId)]: crypto.randomUUID() });
  await chrome.storage.session.remove(chaveEstado(tabId));
}

/** Aba fechada. */
export async function esquecerEstado(tabId: number): Promise<void> {
  await chrome.storage.session.remove(chaveEstado(tabId));
  await chrome.storage.session.remove(chaveGeracao(tabId));
}
