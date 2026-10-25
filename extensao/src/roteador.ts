// Roteamento das mensagens internas do SW (ADR-0189). Separado do sw.ts para ser testável.
// Páginas da extensão (painel) têm o conjunto completo; content scripts rodam dentro da página
// do ML e só podem pedir leitura do anúncio e registrar erro de leitura.
import { atualizarSessao, chamarExtensao, consultarSessaoAtual } from './api';
import { observadoDoAnuncio } from './criacao';
import { entrar, estaLogado, lerCredenciais, sair } from './credenciais';
import { definirAtiva, estaAtiva } from './preferencias';
import { identidadeAtual, obterSessaoValida, seAindaIdentidade } from './sessao';
import { eanDaAba, eanParaAnuncio, epocaAtual, esquecerAba, esquecerAnuncioDaAba, estadoDaAba, lerAba, mesmoAnuncioNaAba, novaPaginaNaAba, registrarEanDaAba, registrarEstado, transmitirConta } from './abas';
import { URL_APP } from './painel/formato';
import { normalizarQualidade } from './compartilhado/qualidade';
import { analisarBuscaDaAba, destacarCard, ehBusca, registrarCardsDaBusca } from './busca-sw';

// ponytail: Tasks 21/23 ampliam esta lista (busca/catálogo).
const ACOES_CONTENT_SCRIPT = new Set(['analisar_anuncio', 'erro_leitura']);

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Loja oficial lida pelo content script: só `{ nome: string curta | null }`; qualquer outra forma vira null. */
const lojaOficialValida = (v: unknown): { nome: string | null } | null => {
  if (!ehObjeto(v)) return null;
  const nome = typeof v.nome === 'string' && v.nome.trim() && v.nome.length <= 80 ? v.nome.trim() : null;
  return v.nome == null || nome !== null ? { nome } : null;
};

/** Estado do painel é melhor esforço: falha de storage não derruba a análise (nem o selo).
 *  Grava com as gerações (página e sessão) capturadas antes da chamada à edge; se mudaram, a leitura descarta. */
async function guardarEstado(tabId: number, geracao: string | null, sessao: number, entrada: object, resposta: unknown, observado?: object): Promise<void> {
  try {
    await registrarEstado(tabId, { geracao, sessao, entrada, resposta, observado });
  } catch {
    return;
  }
  chrome.runtime.sendMessage({ tipo: 'publiai:estado-atualizado', tabId }).catch(() => {}); // painel fechado
}

/** `tabs.onUpdated`: a aba foi para outro anúncio → o painel não pode seguir mostrando o anterior.
 *  `url` vem para abas do ML (host permission) e cobre o pushState; mesmo anúncio com outra URL (variação,
 *  hash, redirecionamento para /up/) mantém o painel. `loading` sem `url` (recarga ou saída do ML) limpa e
 *  esquece o anúncio da aba. */
export async function aoAtualizarAba(tabId: number, info: { status?: string; url?: string }): Promise<void> {
  if (info.url) {
    if (await mesmoAnuncioNaAba(tabId, info.url).catch(() => false)) return;
    // Busca: só o hash mudou (mesma URL) → mesma página, mantém cards e margens.
    const e = await estadoDaAba(tabId).catch(() => null);
    if (ehBusca(e) && e.entrada.url === info.url.split('#')[0]) return;
  } else if (info.status === 'loading') {
    await esquecerAnuncioDaAba(tabId).catch(() => {});
  } else return;
  await novaPaginaNaAba(tabId).catch(() => {});
  chrome.runtime.sendMessage({ tipo: 'publiai:estado-atualizado', tabId }).catch(() => {});
}

// Complementos em segundo plano (data/faixa do anúncio). Exposto para os testes esperarem antes de desmontar o `chrome`.
const pendentes = new Set<Promise<void>>();
export const complementosPendentes = () => Promise.allSettled([...pendentes]);

/** Faixa e data do anúncio (ADR-0189 emenda 2026-10-22) gravadas no `observado` da aba depois da análise. */
async function completarCriacao(tabId: number, geracao: string | null, sessao: number, identidade: string | null, epoca: number, mlItemId: string): Promise<void> {
  const { criadoEm, vendidosAnuncio, motivo } = await observadoDoAnuncio(mlItemId);
  await naMesmaSessao(identidade, epoca, async () => {
    const atual = await lerAba(tabId);
    const e = atual.estado as { entrada: { mlItemId?: unknown }; resposta: unknown; observado?: object } | null;
    if (!e || atual.geracao !== geracao || atual.sessao !== sessao || e.entrada.mlItemId !== mlItemId) return;
    await guardarEstado(tabId, geracao, sessao, e.entrada, e.resposta, { ...e.observado, criadoEm, vendidosAnuncio, motivo });
  }).catch(() => {});
}

const SEM_SESSAO = { ok: false, erro: 'sem_sessao' } as const;

/** Roda `fn` (gravar/responder) só se a identidade e a época de quando o pedido chegou ainda valem — conferido na fila
 *  da sessão, logo antes. Pausa, saída, troca de identidade ou fim de suporte no meio → null, nada gravado. */
function naMesmaSessao<T>(identidade: string | null, epoca: number, fn: () => Promise<T>): Promise<T | null> {
  return seAindaIdentidade(identidade, async () => (epoca === epocaAtual() ? fn() : null));
}

async function naMesmaIdentidade(identidade: string | null, epoca: number, fn: () => Promise<unknown>): Promise<unknown> {
  return (await naMesmaSessao(identidade, epoca, fn)) ?? SEM_SESSAO;
}

function ehPaginaDaExtensao(sender: chrome.runtime.MessageSender): boolean {
  return !sender.tab && !!sender.url?.startsWith(chrome.runtime.getURL(''));
}

// Geração (R9) = época do SW em memória (abas.ts). Comando do painel/menu leva a geração da última resposta/aviso que
// recebeu; diferente da atual (ou ausente) → recusado antes de qualquer coisa. Toda resposta a eles leva a geração.
const geracaoEmDia = (msg: Record<string, unknown>) => typeof msg.geracao === 'number' && msg.geracao === epocaAtual();
const ANTIGA = () => Promise.resolve({ ok: false, erro: 'geracao_antiga', geracao: epocaAtual() });

/** Antes de qualquer efeito (EAN, estado, edge, ML): época da chegada ainda vale, ligada e logada. null = pode seguir. */
async function impedimento(e: number): Promise<'geracao_antiga' | 'inativa' | 'sem_sessao' | null> {
  const [ativa, logado] = await Promise.all([estaAtiva(), estaLogado()]);
  if (e !== epocaAtual()) return 'geracao_antiga';
  return !ativa ? 'inativa' : !logado ? 'sem_sessao' : null;
}

/** Comando da época `e`: impedido → erro com a geração; época mudou durante `fn` → geracao_antiga (resultado
 *  descartado); senão o resultado com a geração. */
async function comando(e: number, fn: () => Promise<unknown>): Promise<unknown> {
  const erro = await impedimento(e);
  if (erro) return { ok: false, erro, geracao: epocaAtual() };
  const r = await fn();
  if (e !== epocaAtual()) return { ok: false, erro: 'geracao_antiga', geracao: epocaAtual() };
  return ehObjeto(r) ? { ...r, geracao: e } : r;
}

/** Ativa, logado, perfil (só nome e org: content scripts também leem), versão e a geração lidos juntos: evento de
 *  sessão no meio da leitura (a época sobe antes de o estado mudar) → relê. */
async function estadoExtensao() {
  for (;;) {
    const e = epocaAtual();
    const [ativa, c] = await Promise.all([estaAtiva(), lerCredenciais()]);
    if (e !== epocaAtual()) continue;
    const perfil = c?.perfil ? { nome: c.perfil.nome, orgNome: c.perfil.orgNome } : null;
    return { ativa, logado: c !== undefined, perfil, versao: chrome.runtime.getManifest().version, geracao: e };
  }
}

const DEZ_MIN = 10 * 60_000;

/** Refaz a análise do anúncio da aba com a entrada guardada (painel após vínculo / "Tentar de novo" / estado velho). */
async function reanalisar(id: number, e: number): Promise<unknown> {
  const [{ estado, geracao, sessao }, identidade] = await Promise.all([lerAba(id), identidadeAtual()]);
  const entrada = (estado as { entrada?: Record<string, unknown> } | null)?.entrada;
  if (!entrada) return null;
  const resposta = await chamarExtensao({ acao: 'analisar_anuncio', tipoPagina: 'anuncio', ...entrada }, e);
  return naMesmaIdentidade(identidade, e, async () => {
    await guardarEstado(id, geracao, sessao, entrada, resposta, estado?.observado); // não regrava se a aba navegou durante a chamada
    return resposta;
  });
}

/** Estado da aba para o painel. Desligada → null. Anúncio gravado há mais de 10 min é reanalisado antes (dado exibido
 *  vence); se não der (época mudou, gravação falhou), o velho não chega ao painel. */
async function estadoParaPainel(id: number, e: number): Promise<unknown> {
  await obterSessaoValida(); // refresh recusado: sessão e análises somem antes da leitura
  if (!(await estaAtiva())) return null;
  const fresco = async () => {
    const { estado, gravadoEm } = await lerAba(id);
    return !estado || ehBusca(estado) || Date.now() - gravadoEm <= DEZ_MIN ? estado : undefined;
  };
  const antes = await fresco();
  if (antes !== undefined) return antes;
  if (await impedimento(e)) return null;
  await reanalisar(id, e);
  if (e !== epocaAtual()) return null;
  return (await fresco()) ?? null;
}

/** undefined = sem resposta assíncrona. Síncrono até o `sidePanel.open` (exige o gesto do usuário). */
export function rotearMensagem(msg: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> | undefined {
  if (sender.id !== chrome.runtime.id || !ehObjeto(msg)) return undefined;
  const tabId = sender.tab?.id;
  const pagina = ehPaginaDaExtensao(sender);

  switch (msg.tipo) {
    case 'publiai:ean-da-busca':
      if (tabId === undefined) return undefined;
      // null = a busca atual não é um EAN: esquece o da aba (evita casar anúncio com o SKU de outra busca).
      if (msg.ean === null) return esquecerAba(tabId).then(() => ({ ok: true }));
      if (typeof msg.ean !== 'string' || !/^\d{8,14}$/.test(msg.ean)) return undefined;
      return registrarEanDaAba(tabId, msg.ean).then(() => ({ ok: true }));
    case 'publiai:busca-cards':
      // Content script da busca: cards lidos na própria aba (nunca de outra).
      if (tabId === undefined || pagina) return undefined;
      // Desligada ou deslogada: nada é gravado (sem cota nem edge).
      return impedimento(epocaAtual()).then((erro) =>
        erro ? undefined : registrarCardsDaBusca(tabId, msg.cards, msg.ocorrencias, sender.tab?.url ?? sender.url));
    case 'publiai:analisar-busca': {
      if (!pagina || typeof msg.tabId !== 'number') return undefined;
      if (!geracaoEmDia(msg)) return ANTIGA();
      const id = msg.tabId, e = epocaAtual();
      const forcar = Array.isArray(msg.forcar)
        ? msg.forcar.filter((i): i is string => typeof i === 'string' && /^MLB\d{6,20}$/.test(i)).slice(0, 50)
        : [];
      return comando(e, () => analisarBuscaDaAba(id, forcar, e));
    }
    case 'publiai:destacar-card':
      if (!pagina || typeof msg.tabId !== 'number' || typeof msg.itemId !== 'string' || !/^MLB\d{6,20}$/.test(msg.itemId)) return undefined;
      return destacarCard(msg.tabId, msg.itemId);
    case 'publiai:ean-da-aba':
      if (!pagina || typeof msg.tabId !== 'number') return undefined;
      return eanDaAba(msg.tabId);
    case 'publiai:estado-da-aba':
      if (!pagina || typeof msg.tabId !== 'number') return undefined;
      return estadoParaPainel(msg.tabId, epocaAtual());
    case 'publiai:reanalisar-aba': {
      // Painel refaz a análise da aba ao preço da página (após vínculo / "Tentar de novo") e atualiza o estado guardado.
      if (!pagina || typeof msg.tabId !== 'number') return undefined;
      if (!geracaoEmDia(msg)) return ANTIGA();
      const id = msg.tabId, e = epocaAtual();
      return comando(e, () => reanalisar(id, e));
    }
    case 'publiai:chamar': {
      const corpo = msg.corpo;
      if (pagina && !geracaoEmDia(msg)) return ANTIGA();
      const e = epocaAtual(); // capturada na chegada: a edge só é chamada se ainda for a desta época
      if (!ehObjeto(corpo) || typeof corpo.acao !== 'string') return Promise.resolve({ ok: false, erro: 'payload_invalido' });
      if (!pagina && !(tabId !== undefined && ACOES_CONTENT_SCRIPT.has(corpo.acao))) {
        return Promise.resolve({ ok: false, erro: 'payload_invalido' });
      }
      // O EAN da busca é sempre o da aba do remetente: content script não escolhe (nem lê) a aba alheia.
      if (pagina) return comando(e, () => identidadeAtual().then(async (identidade) => {
        const resposta = await chamarExtensao(corpo, e);
        return naMesmaIdentidade(identidade, e, async () => resposta);
      }));
      // Content script (análise automática): sem geração na mensagem, mas a época da chegada vale igual. Pausada,
      // deslogada ou época nova → nada acontece (EAN não é consumido, estado não é gravado, ML não é consultado).
      const tab = tabId!;
      return impedimento(e).then(async (erro) => {
        if (erro) return { ok: false, erro: erro === 'geracao_antiga' ? 'sem_sessao' : erro };
        if (corpo.acao !== 'analisar_anuncio') {
          const identidade = await identidadeAtual();
          const resposta = await chamarExtensao(corpo, e);
          return naMesmaIdentidade(identidade, e, async () => resposta);
        }
        const ean = typeof corpo.mlItemId === 'string' ? eanParaAnuncio(tab, corpo.mlItemId) : Promise.resolve(null);
        return Promise.all([ean, lerAba(tab), identidadeAtual()]).then(async ([eanDaBusca, { geracao, sessao }, identidade]) => {
          // Faixas e data de criação ficam só no navegador (painel): a edge não recebe (ADR-0189 D-1/D-9).
          const { vendidosTexto, lojaOficial, qualidade, ...paraEdge } = corpo;
          const resposta = await chamarExtensao({ ...paraEdge, eanDaBusca }, e);
          // Guarda também o erro: é por ele que o painel sabe de sem_sessao/modulo_desligado/limite.
          // tipoPagina vai junto: reanálise e confirmação de preço do painel espalham a entrada guardada.
          const { tipoPagina, mlItemId, sellerId, catalogProductId, categoriaId, preco } = corpo;
          // vendidosTexto = faixa da página aberta (agregada em /p/ e /up/); a do anúncio chega com a data.
          const observado = {
            vendidosTexto: typeof vendidosTexto === 'string' ? vendidosTexto : null, vendidosAnuncio: null, criadoEm: null,
            lojaOficial: lojaOficialValida(lojaOficial),
            qualidade: normalizarQualidade(qualidade),
          };
          const r = await naMesmaIdentidade(identidade, e, async () => {
            await guardarEstado(tab, geracao, sessao, { tipoPagina, mlItemId, sellerId, catalogProductId, categoriaId, preco, eanDaBusca }, resposta, observado);
            return resposta;
          });
          // A data não segura o selo: chega depois e só entra se a aba ainda é a mesma página e sessão (e a época).
          if (typeof mlItemId === 'string' && e === epocaAtual()) {
            const p: Promise<void> = completarCriacao(tab, geracao, sessao, identidade, e, mlItemId).finally(() => pendentes.delete(p));
            pendentes.add(p);
          }
          return r;
        });
      });
    }
    case 'publiai:abrir-painel':
      if (tabId !== undefined) chrome.sidePanel.open({ tabId }).catch(() => {});
      return undefined;
    case 'publiai:abrir-app':
      // Menu do cabeçalho: "Abrir o PubliAI" em nova aba.
      if (tabId !== undefined) chrome.tabs.create({ url: URL_APP }).catch(() => {});
      return undefined;
    case 'publiai:estado-extensao':
      // Qualquer contexto da extensão. `abrindo` (painel/menu a cada abertura): confere a sessão na edge antes —
      // identidade nova limpa as abas e transmite conta-mudou; sem_acesso/sessão expirada desloga.
      // Painel: confere por padrão (abrindo:false pula); content script (menu do cabeçalho): só com abrindo:true.
      return ((pagina ? msg.abrindo !== false : msg.abrindo === true) ? atualizarSessao().catch(() => false) : Promise.resolve()).then(estadoExtensao);
    case 'publiai:entrar': {
      // Só o painel (página da extensão): a senha nunca é digitada na página do ML. Não é gravada nem registrada.
      if (!pagina || typeof msg.email !== 'string' || typeof msg.senha !== 'string') return undefined;
      return entrar(msg.email, msg.senha).then(async (r) => {
        if (!r.ok) return { ...r, ...(await estadoExtensao()) };
        const s = await consultarSessaoAtual().catch(() => ({ ok: false, erro: 'interno' }) as const);
        // Módulo desligado ou perfil inativo/sem org: não entra (a sessao já desloga no sem_acesso). Rede/limite na
        // sessao: segue logado sem perfil.
        if (!s.ok && s.erro === 'modulo_desligado') await sair();
        if (!s.ok && (s.erro === 'modulo_desligado' || s.erro === 'sem_acesso')) return { ok: false, erro: s.erro, ...(await estadoExtensao()) };
        if (!(await estaLogado())) return { ok: false, erro: 'sem_acesso', ...(await estadoExtensao()) };
        await transmitirConta(); // o aviso do login saiu antes do perfil
        return { ok: true, ...(await estadoExtensao()) };
      });
    }
    case 'publiai:sair':
      if (!pagina && tabId === undefined) return undefined;
      if (!geracaoEmDia(msg)) return ANTIGA();
      return sair().then(async () => ({ ok: true, ...(await estadoExtensao()) }));
    case 'publiai:definir-ativa': {
      if ((!pagina && tabId === undefined) || typeof msg.ativa !== 'boolean') return undefined;
      if (!geracaoEmDia(msg)) return ANTIGA();
      const ativa = msg.ativa, e = epocaAtual();
      return estaLogado().then(async (logado) => {
        if (e !== epocaAtual()) return ANTIGA(); // sair/troca de conta durante a conferência
        if (!logado) return { ok: false, erro: 'sem_sessao', geracao: epocaAtual() }; // a chave só existe logado
        await definirAtiva(ativa);
        return { ok: true, ...(await estadoExtensao()) };
      });
    }
  }
  return undefined;
}
