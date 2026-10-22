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
// Geração global da sessão: sobe a cada limparEstadosDasAbas. Estado de outra geração (inclusive sem ela)
// é descartado — cobre aba que nunca teve chave (1ª análise com a extensão recém-carregada).
const GERACAO_SESSAO = 'geracao-sessao';
const ABAS_ML = 'https://*.mercadolivre.com.br/*'; // = host_permissions do manifest

interface EstadoGuardado { geracao: string | null; sessao: number; entrada: object; resposta: unknown }

export async function registrarEstado(tabId: number, estado: EstadoGuardado): Promise<void> {
  await chrome.storage.session.set({ [chaveEstado(tabId)]: estado });
}

/** Geração atual e o estado dela, numa leitura só. Geração ausente = nenhuma navegação vista ainda. */
export async function lerAba(tabId: number): Promise<{ geracao: string | null; sessao: number; estado: { entrada: object; resposta: unknown } | null }> {
  const r = await chrome.storage.session.get([chaveEstado(tabId), chaveGeracao(tabId), GERACAO_SESSAO]);
  const g = r[chaveGeracao(tabId)];
  const geracao = typeof g === 'string' ? g : null;
  const sessao = typeof r[GERACAO_SESSAO] === 'number' ? (r[GERACAO_SESSAO] as number) : 0;
  const e = r[chaveEstado(tabId)] as EstadoGuardado | undefined;
  const valido = e && (e.geracao ?? null) === geracao && e.sessao === sessao;
  return { geracao, sessao, estado: valido ? { entrada: e.entrada, resposta: e.resposta } : null };
}

export const estadoDaAba = async (tabId: number) => (await lerAba(tabId)).estado;

/** A aba foi para outra página: nova geração primeiro, depois some o estado. */
export async function novaPaginaNaAba(tabId: number): Promise<void> {
  await chrome.storage.session.set({ [chaveGeracao(tabId)]: crypto.randomUUID() });
  await chrome.storage.session.remove(chaveEstado(tabId));
}

/** Anúncio que a URL mostra: item do `pdp_filters` (redirecionamento /up/ e /p/ com item escolhido), MLB-123 do
 *  caminho, catálogo /p/ ou user product /up/. null = página sem anúncio (lista, home). Query e hash fora. */
export function anuncioDaUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const filtro = u.searchParams.get('pdp_filters')?.match(/item_id:(MLB\d+)/)?.[1];
  if (filtro) return filtro;
  const p = u.pathname;
  return p.match(/\/p\/(MLB\d+)/)?.[1] ?? p.match(/\/up\/(MLBU\d+)/)?.[1] ?? p.match(/MLB-?(\d+)/)?.[0].replace('-', '') ?? null;
}

const chaveAnuncio = (tabId: number) => `anuncio:${tabId}`;

/** A aba mudou de URL: true se ainda é o mesmo anúncio já visto nela (painel continua). Guarda o novo. */
export async function mesmoAnuncioNaAba(tabId: number, url: string): Promise<boolean> {
  const novo = anuncioDaUrl(url);
  const antes = (await chrome.storage.session.get(chaveAnuncio(tabId)))[chaveAnuncio(tabId)] ?? null;
  await chrome.storage.session.set({ [chaveAnuncio(tabId)]: novo });
  return novo !== null && novo === antes;
}

export async function esquecerAnuncioDaAba(tabId: number): Promise<void> {
  await chrome.storage.session.remove(chaveAnuncio(tabId));
}

/** Aba fechada. */
export async function esquecerEstado(tabId: number): Promise<void> {
  await chrome.storage.session.remove(chaveEstado(tabId));
  await chrome.storage.session.remove(chaveGeracao(tabId));
  await chrome.storage.session.remove(chaveAnuncio(tabId));
}

/** Troca de identidade / desconexão / sessão expirada: nenhuma aba guarda análise nem EAN da sessão anterior.
 *  Sobe a geração global (escrita em voo com a anterior é descartada na leitura) e, em toda aba do ML
 *  (com chave ou não), nova geração de página; o painel é avisado para reler e o content script tira o selo.
 *  Só roda na fila da sessão (sessao.ts). */
export async function limparEstadosDasAbas(): Promise<void> {
  const tudo = await chrome.storage.session.get(null);
  const atual = typeof tudo[GERACAO_SESSAO] === 'number' ? (tudo[GERACAO_SESSAO] as number) : 0;
  await chrome.storage.session.set({ [GERACAO_SESSAO]: atual + 1 });
  const abas = new Set<number>();
  for (const t of await chrome.tabs.query({ url: ABAS_ML }).catch(() => [])) if (t.id !== undefined) abas.add(t.id);
  const remover: string[] = [];
  for (const k of Object.keys(tudo)) {
    const [prefixo, id] = k.split(':');
    if (prefixo === 'ean') remover.push(k);
    if (prefixo === 'estado' || prefixo === 'geracao') abas.add(Number(id));
  }
  if (remover.length) await chrome.storage.session.remove(remover);
  for (const tabId of abas) {
    await novaPaginaNaAba(tabId);
    chrome.runtime.sendMessage({ tipo: 'publiai:estado-atualizado', tabId }).catch(() => {}); // painel fechado
    // O selo na página do ML também sai (content script da aba; aba fechada/sem script → ignora).
    chrome.tabs.sendMessage(tabId, { tipo: 'publiai:sessao-mudou' }).catch(() => {});
  }
}
