// Busca no service worker (ADR-0189 D-11, Task 22; emenda 2026-11-02, Task 3): o content script manda os cards lidos e
// o SW, com a extensão ativa e a sessão válida, identifica todos no banco (`identificar_busca`, sem ML nem cota), enriquece
// os catálogos da página inteira num pedido (Task 11.3) e analisa a margem só dos vinculados com preço (`analisar_busca`)
// — painel aberto ou fechado. O painel só consome o estado.
// O estado fica na mesma chave da aba (geração por página e por sessão): resposta atrasada de outra busca não volta.
import { chamarExtensao, consultarSessaoAtual } from './api';
import { epocaAtual, lerAba, registrarEstado } from './abas';
import { eanDaUrlDeBusca } from './conteudo/ean';
import { normalizarCards, type CardBusca } from './leitura/busca';
import { identidadeAtual, limparAbasNaFila, seAindaIdentidade } from './sessao';
import {
  aplicarHits, aplicarResposta, gravarCache, lerCache, marcarFalha, marcasDoPedido, MOTIVO_FALHA_REDE, planejarLote, prepararNovaTentativa,
  type CacheEnr, type RespostaEnriquecimento,
} from './cache-enriquecimento';
import { enriquecimentoDe, type EstadoEnriquecimento } from './compartilhado/enriquecimento';
import type { MetadadosCardBusca, ResultadoCard } from '../../supabase/functions/_shared/extensao/busca.ts';

export const MAX_POR_ANALISE = 50; // = MAX_ITENS_BUSCA da edge

export interface RespostaBusca {
  /** Margem (financeiro). `limite` = "Minha margem aguardando cota"; `sem_vinculo` vem da identificação (sem cota). */
  resultados: Record<string, ResultadoCard>;
  /** Anúncio próprio e vínculo de produto, do banco. Ausente = ainda não identificado (nunca "não próprio"). */
  metadados: Record<string, MetadadosCardBusca>;
  /** Preço do card em que a margem de `resultados[id]` foi calculada: não vale para ocorrência com outro preço. */
  precoDaMargem: Record<string, number>;
  /** Minuto (Date.now()/60 000) em que a cota de 30/min esgotou: os `limite` só voltam à edge na janela seguinte. */
  limiteEm: number | null;
  /** Telemetria `busca` já contada nesta geração de página (nova URL de busca começa sem). */
  usoRegistrado: boolean;
  /** Catálogos enriquecidos (vendedor, medalha, UF, tipo, comissão, vendedores, idade) e a fila deles (Task 10).
   *  Opcional só no tipo (estado de antes da 0.5.0); `respostaDe` sempre preenche. */
  enriquecimento?: EstadoEnriquecimento;
  /** Impressão da conta ML da org vista pela identificação desta página (null = sem conexão; ausente = desconhecida,
   *  edge antiga). O cache do enriquecimento só é reutilizado se for da mesma conta. */
  contaMl?: string | null;
  /** ms da última confirmação da conta ML para esta página (identificação ou revalidação ao voltar a ficar visível). */
  contaVerificadaEm?: number;
}

export interface EstadoBusca {
  entrada: { tipoPagina: 'busca'; url: string };
  resposta: RespostaBusca;
  observado: { cards: CardBusca[]; ocorrencias: number };
}

export const ehBusca = (e: unknown): e is EstadoBusca => (e as { entrada?: { tipoPagina?: unknown } } | null)?.entrada?.tipoPagina === 'busca';

const minuto = () => Math.floor(Date.now() / 60_000);

/** Cópia mutável da resposta guardada (estado gravado antes da Task 3 não tem os campos novos). */
type RespostaViva = RespostaBusca & { enriquecimento: EstadoEnriquecimento };
function respostaDe(e: EstadoBusca | null): RespostaViva {
  const r: Partial<RespostaBusca> = e?.resposta ?? {};
  return {
    resultados: { ...r.resultados }, metadados: { ...r.metadados }, precoDaMargem: { ...r.precoDaMargem },
    limiteEm: typeof r.limiteEm === 'number' ? r.limiteEm : null, usoRegistrado: r.usoRegistrado === true,
    enriquecimento: enriquecimentoDe(r.enriquecimento),
    ...(typeof r.contaMl === 'string' || r.contaMl === null ? { contaMl: r.contaMl } : {}),
    ...(typeof r.contaVerificadaEm === 'number' ? { contaVerificadaEm: r.contaVerificadaEm } : {}),
  };
}

function descartarMargem(r: RespostaBusca, itemId: string): void {
  delete r.resultados[itemId];
  delete r.precoDaMargem[itemId];
}

type Pagina = { geracao: string | null; sessao: number; url: string };

/** Geração da página como a página do ML a vê: página (navegação) + sessão. Toda mensagem cards ↔ resultados a leva;
 *  diferente da atual = mensagem atrasada de outra navegação ou sessão (mesmo na mesma URL) → descartada. */
export const geracaoDaPagina = (geracao: string | null, sessao: number): string => `${geracao ?? '-'}:${sessao}`;

async function gravar(tabId: number, p: Pagina, e: EstadoBusca): Promise<void> {
  await registrarEstado(tabId, { geracao: p.geracao, sessao: p.sessao, entrada: e.entrada, resposta: e.resposta, observado: e.observado });
  chrome.runtime.sendMessage({ tipo: 'publiai:estado-atualizado', tabId }).catch(() => {}); // painel fechado
}

/** Página do ML: resultado com a geração e a URL dela (o content script descarta o de outra página). */
function avisarPagina(tabId: number, p: Pagina, r: RespostaBusca): void {
  chrome.tabs.sendMessage(tabId, { tipo: 'publiai:busca-resultados', geracao: geracaoDaPagina(p.geracao, p.sessao), url: p.url, resultados: r.resultados, metadados: r.metadados, enriquecimento: r.enriquecimento }).catch(() => {});
}

// Filas por aba (memória do SW): `escritas` serializa todo ler-modificar-gravar do estado da busca (cards do scroll ×
// respostas da edge); `analises` faz o processamento seguinte esperar o anterior e mandar só o que ainda falta.
const escritas = new Map<number, Promise<unknown>>();
const analises = new Map<number, Promise<unknown>>();
function naFila<T>(filas: Map<number, Promise<unknown>>, tabId: number, fn: () => Promise<T>): Promise<T> {
  const r = (filas.get(tabId) ?? Promise.resolve()).catch(() => {}).then(fn);
  const fim = r.catch(() => {});
  filas.set(tabId, fim);
  void fim.then(() => { if (filas.get(tabId) === fim) filas.delete(tabId); });
  return r;
}

/** Content script → cards lidos (os novos do scroll somam aos de antes, na mesma busca). Catálogo (ou conflito) diferente
 *  descarta vínculo e margem; preço diferente, só a margem; só a miniatura, nada. Outra URL de busca começa do zero.
 *  `geracaoMsg` = geracaoDaPagina que a página conhece, conferida DENTRO da fila de escrita: outra (ou nenhuma) → nada é
 *  gravado e a resposta traz a atual (a página adota e reenvia). */
export type RespostaCards = { ok: true } | { ok: false; erro: 'geracao_antiga'; geracao: string };
export function registrarCardsDaBusca(tabId: number, cardsBrutos: unknown, ocorrencias: unknown, url: unknown, geracaoMsg: unknown): Promise<RespostaCards> {
  const cards = normalizarCards(cardsBrutos);
  if (typeof url !== 'string' || !/^https:\/\/lista\.mercadolivre\.com\.br\//.test(url)) return Promise.resolve({ ok: true });
  const semHash = url.split('#')[0];
  return naFila(escritas, tabId, async (): Promise<RespostaCards> => {
    const { geracao, sessao, estado } = await lerAba(tabId);
    const atual = geracaoDaPagina(geracao, sessao);
    if (geracaoMsg !== atual) return { ok: false, erro: 'geracao_antiga', geracao: atual };
    const antes = ehBusca(estado) && estado.entrada.url === semHash ? estado : null;
    const porItem = new Map((antes?.observado.cards ?? []).map((c) => [c.itemId, c]));
    const r = respostaDe(antes);
    let descartou = false;
    for (const c of cards) {
      const velho = porItem.get(c.itemId);
      if (velho && (velho.catalogProductId !== c.catalogProductId || velho.identidadeConflitante !== c.identidadeConflitante)) {
        descartou ||= !!(r.resultados[c.itemId] || r.metadados[c.itemId]);
        delete r.metadados[c.itemId];
        descartarMargem(r, c.itemId);
      } else if (velho && velho.preco !== c.preco && r.resultados[c.itemId] && r.resultados[c.itemId].estado !== 'sem_vinculo') {
        descartou = true;
        descartarMargem(r, c.itemId);
      }
      porItem.set(c.itemId, c);
    }
    const p = { geracao, sessao, url: semHash };
    await gravar(tabId, p, {
      entrada: { tipoPagina: 'busca', url: semHash },
      resposta: r,
      observado: { cards: [...porItem.values()], ocorrencias: typeof ocorrencias === 'number' && ocorrencias >= 0 ? Math.min(ocorrencias, 1000) : porItem.size },
    });
    if (descartou) avisarPagina(tabId, p, r);
    return { ok: true as const };
  });
}

// Cancelamento por aba (aba fechada, navegação): processamento enfileirado/em curso de antes para no próximo passo.
// Pausa, saída e troca de sessão já abrem época nova (abas.ts), que para tudo igual.
const cancelamentos = new Map<number, number>();
export function cancelarBuscaDaAba(tabId: number): void {
  cancelamentos.set(tabId, (cancelamentos.get(tabId) ?? 0) + 1);
}

/** `aguardar` (só no "Tentar novamente"): Retry-After do ML ainda valendo até `tentarAposEm` (ms). */
type Falha = { ok: false; erro: string; tentarAposEm?: number };
const SEM_SESSAO: Falha = { ok: false, erro: 'sem_sessao' };
// Vale tentar de novo no próximo pulso: rede/5xx e limite da edge. Os demais (sessão, módulo, acesso) esperam evento novo.
const transitoria = (f: Falha) => f.erro === 'interno' || f.erro === 'limite';

/** Identifica no banco o que falta, enriquece os catálogos da página e analisa a margem dos vinculados elegíveis, tudo a
 *  partir do estado guardado (reinício do SW, pulso, scroll e painel convergem; uma rodada por aba de cada vez).
 *  `epoca` = a de quando a mensagem chegou: sessão, pausa ou navegação no meio → nada é chamado, gravado nem transmitido.
 *  `forcar` = itens que o painel quer refazer (ex.: logo depois de vincular ao SKU): identificação e margem de novo.
 *  `retentar` = "Tentar novamente" do enriquecimento: refaz todo indisponível (recusado antes do Retry-After do ML). */
export function processarBuscaDaAba(tabId: number, epoca: number, forcar: string[] = [], retentar = false): Promise<{ ok: true } | Falha> {
  const vez = cancelamentos.get(tabId) ?? 0; // síncrono: cancelamento depois daqui vale para esta rodada
  const vale = () => epoca === epocaAtual() && vez === (cancelamentos.get(tabId) ?? 0);
  return naFila(analises, tabId, () => processar(tabId, epoca, vale, new Set(forcar), retentar));
}

async function processar(tabId: number, epoca: number, vale: () => boolean, forcar: Set<string>, retentar: boolean): Promise<{ ok: true } | Falha> {
  if (!vale()) return SEM_SESSAO;
  // Identidade desconhecida (recém-logado): resolvida ANTES de capturar a da rodada — senão a 1ª chamada a descobre, a
  // gravação é recusada e a retomada pede (e conta) a telemetria de novo.
  // Falha transitória (rede/5xx) na consulta: pede retomada; recusa definitiva (401, sem acesso, saída) só para.
  if ((await identidadeAtual()) === null) {
    const s = await consultarSessaoAtual();
    if (!s.ok && transitoria(s)) { await pedirRetomada(tabId, vale); return s; }
  }
  if (!vale()) return SEM_SESSAO;
  const identidade = await identidadeAtual();
  if (identidade === null) return SEM_SESSAO;
  /** Aplica `mudar` só se sessão (época, identidade) e página (geração, sessão, URL) ainda são as do pedido. `cache`
   *  (enriquecimento) grava no cache do navegador na MESMA checagem: resposta antiga nunca o repovoa. */
  const gravarSe = (p: Pagina, mudar: (r: RespostaViva, agora: Map<string, CardBusca>) => void, cache?: () => ((c: CacheEnr) => void) | null) =>
    seAindaIdentidade(identidade, async () => {
      const ok = await naFila(escritas, tabId, async () => {
        const atual = await lerAba(tabId);
        if (!vale() || atual.geracao !== p.geracao || atual.sessao !== p.sessao || !ehBusca(atual.estado) || atual.estado.entrada.url !== p.url) return false;
        const r = respostaDe(atual.estado);
        mudar(r, new Map(atual.estado.observado.cards.map((c) => [c.itemId, c])));
        await gravar(tabId, p, { ...atual.estado, resposta: r });
        if (vale()) avisarPagina(tabId, p, r);
        return true;
      });
      const f = ok && vale() ? cache?.() : null;
      if (f) await gravarCache(identidade, f);
      return ok;
    }).then((ok) => ok === true);

  let retomar = false;
  // Gravação recusada com a época e a página ainda valendo = só a identidade mudou desde o início (ex.: recém-logado,
  // descoberta na 1ª chamada): o pulso refaz com a nova. Época/página nova → `vale()` falso, nada a retomar.
  const recusada = () => { retomar ||= vale(); return SEM_SESSAO; };
  /** Antes de um efeito global (limpar todas as abas): a rodada não foi cancelada, a identidade e a página são as do
   *  pedido. Resposta atrasada de outra navegação/sessão não apaga o estado novo. */
  const aindaDaPagina = async (p: Pagina) => {
    if (!vale() || (await identidadeAtual()) !== identidade) return false;
    const a = await lerAba(tabId);
    return vale() && a.geracao === p.geracao && a.sessao === p.sessao && ehBusca(a.estado) && a.estado.entrada.url === p.url;
  };
  // Logo antes do envio (depois dos awaits de token/identidade): a rodada não foi cancelada, a página (geração, sessão,
  // URL) é a mesma e cada item do lote ainda tem a assinatura de quando foi escolhido. Recusa com tudo valendo = o lote
  // mudou: refaz a seleção. Sem isso, navegação ou preço novo durante a preparação ainda chamariam a edge.
  const guarda = (p: Pagina, lote: CardBusca[], assinatura: (c: CardBusca) => string) => {
    let recusou = false;
    return {
      recusou: () => recusou,
      aindaVale: vale,
      conferir: async () => {
        const a = await lerAba(tabId);
        const ok = vale() && a.geracao === p.geracao && a.sessao === p.sessao && ehBusca(a.estado) && a.estado.entrada.url === p.url && (() => {
          const agora = new Map(a.estado.observado.cards.map((c) => [c.itemId, c]));
          return lote.every((c) => { const x = agora.get(c.itemId); return !!x && assinatura(x) === assinatura(c); });
        })();
        recusou = !ok && vale();
        return ok;
      },
    };
  };
  // Cada fase devolve null (seguiu), uma Falha, ou 'sair' (sessão/página/conta mudou: nada mais nesta rodada).
  type Fase = Promise<Falha | null | 'sair'>;

  // 1. Identificação no banco (sem ML nem cota), em lotes de até 50.
  const identificar = async (): Fase => {
    const identificados = new Set<string>();
    for (;;) {
      if (!vale()) return 'sair';
      const aba = await lerAba(tabId);
      if (!ehBusca(aba.estado)) return { ok: false, erro: 'payload_invalido' };
      const e = aba.estado, r = respostaDe(e);
      const p = { geracao: aba.geracao, sessao: aba.sessao, url: e.entrada.url };
      const lote = e.observado.cards
        .filter((c) => !identificados.has(c.itemId) && (!r.metadados[c.itemId] || forcar.has(c.itemId))).slice(0, MAX_POR_ANALISE);
      if (lote.length === 0) return null;
      for (const c of lote) identificados.add(c.itemId);
      const g = guarda(p, lote, (c) => `${c.catalogProductId}`);
      const resp = await chamarExtensao<{ itens?: unknown; contaMl?: unknown }>({
        acao: 'identificar_busca', eanDaBusca: eanDaUrlDeBusca(p.url), itens: lote.map((c) => ({ itemId: c.itemId, catalogProductId: c.catalogProductId })),
        // Telemetria `busca`: uma por geração de página, no 1º lote (falhou → o próximo pede de novo).
        registrarUso: !r.usoRegistrado,
      }, epoca, g);
      if (g.recusou()) { for (const c of lote) identificados.delete(c.itemId); continue; }
      const itens = resp.ok && Array.isArray(resp.dados?.itens) ? (resp.dados.itens as MetadadosCardBusca[]) : null;
      if (!itens) {
        // Falha inteira (500, corpo fora do formato): metadados seguem desconhecidos; o pulso tenta de novo.
        const falha: Falha = resp.ok ? { ok: false, erro: 'interno' } : resp;
        retomar ||= transitoria(falha);
        return falha;
      }
      const contaMl = resp.ok && (typeof resp.dados.contaMl === 'string' || resp.dados.contaMl === null) ? resp.dados.contaMl : undefined;
      if (contaMl !== undefined && contaMudou(contaMl, r.contaMl, (await lerCache(identidade)).conta)) {
        // Outra conta ML (ou conexão removida): comissão e margem lidas com a anterior saem de todas as abas e do cache
        // ANTES de qualquer reuso.
        if (!(await aindaDaPagina(p))) return recusada();
        await limparAbasNaFila();
        return 'sair';
      }
      const enviado = new Map(lote.map((c) => [c.itemId, c]));
      const gravou = await gravarSe(p, (r2, agora) => {
        if (contaMl !== undefined) { r2.contaMl = contaMl; r2.contaVerificadaEm = Date.now(); }
        r2.usoRegistrado = true; // pedido nesta chamada (ou já antes) e a edge respondeu: contou
        for (const m of itens) {
          const ev = enviado.get(m?.itemId), a = agora.get(m?.itemId);
          if (!ev || !a || a.catalogProductId !== ev.catalogProductId) continue; // mudou de catálogo: refaz depois
          r2.metadados[m.itemId] = m;
          // Sem vínculo, a margem nem é pedida (= resposta da edge, sem cota); vínculo novo derruba o sem_vinculo.
          if (m.vinculo === null) { descartarMargem(r2, m.itemId); r2.resultados[m.itemId] = { itemId: m.itemId, estado: 'sem_vinculo' }; }
          else if (r2.resultados[m.itemId]?.estado === 'sem_vinculo') descartarMargem(r2, m.itemId);
        }
      });
      if (!gravou) return recusada();
    }
  };

  // 2. Enriquecimento dos catálogos (Revisão 03/11-b): a página inteira num pedido (o excedente de 50 no seguinte), só o
  // vencido no cache do navegador. Logo depois da identificação (precisa da conta ML dela) e antes da margem. Tudo
  // terminal: sem pulso nem retomada; repete só com cards novos (delta) ou o "Tentar novamente" (`retentar`).
  const enriquecer = async (): Fase => {
    const jaPedidos = new Set<string>();
    for (let primeira = true; ; primeira = false) {
      if (!vale()) return 'sair';
      const aba = await lerAba(tabId);
      if (!ehBusca(aba.estado)) return null;
      const e = aba.estado, r = respostaDe(e), enr = r.enriquecimento;
      const p = { geracao: aba.geracao, sessao: aba.sessao, url: e.entrada.url };
      if (primeira && retentar) {
        const agora = Date.now();
        // Retry-After do ML ainda valendo: recusa sem chamar (o painel mostra até quando).
        if (enr.tentarAposEm != null && agora < enr.tentarAposEm) return { ok: false, erro: 'aguardar', tentarAposEm: enr.tentarAposEm };
        if (!(await gravarSe(p, (r2) => { prepararNovaTentativa(r2.enriquecimento, agora); }))) return recusada();
        continue;
      }
      if (enr.indisponivel) return null;
      // Cache só da conta ML confirmada para esta página (identificação); conta desconhecida = sem cache.
      const bruto = await lerCache(identidade);
      const cache: CacheEnr = r.contaMl !== undefined && bruto.conta === r.contaMl ? bruto : { ...bruto, produtos: {}, ofertas: {}, vendedores: {} };
      const plano = planejarLote(e.observado.cards, r.metadados, enr, cache, Date.now(), jaPedidos);
      if (plano.hits.usados.length && !(await gravarSe(p, (r2) => aplicarHits(r2.enriquecimento, plano.hits), () => (c) => {
        for (const u of plano.hits.usados) { const x = c[u.m][u.k]; if (x) x.u = Date.now(); } // menos usado sai primeiro
      }))) return recusada();
      const pedido = plano.pedido;
      if (!pedido) return null;
      const marcas = marcasDoPedido(pedido);
      for (const m of marcas) jaPedidos.add(m);
      const cats = new Set(pedido.catalogos.map((c) => c.catalogProductId));
      const g = guarda(p, e.observado.cards.filter((c) => c.catalogProductId && cats.has(c.catalogProductId)), (c) => `${c.preco}|${c.catalogProductId}`);
      const resp = await chamarExtensao<{ estado?: unknown; motivo?: unknown; valor?: RespostaEnriquecimento }>({ acao: 'enriquecer_catalogos_busca', ...pedido }, epoca, g);
      if (g.recusou()) { for (const m of marcas) jaPedidos.delete(m); continue; }
      const d = resp.ok ? resp.dados : null;
      if (!resp.ok && !transitoria(resp)) return resp;
      if (d?.estado === 'indisponivel') {
        const motivo = typeof d.motivo === 'string' ? d.motivo : 'Enriquecimento indisponível';
        return (await gravarSe(p, (r2) => { r2.enriquecimento.indisponivel = motivo; })) ? null : recusada();
      }
      if (d?.estado !== 'ok' || !d.valor || !Array.isArray(d.valor.catalogos)) {
        // Rede/5xx/corpo fora do formato: o pedido fica indisponível (terminal, sem repetição automática); o painel
        // oferece "Tentar novamente". O que não foi pedido ainda vai no próximo dado novo.
        return (await gravarSe(p, (r2) => marcarFalha(r2.enriquecimento, pedido, MOTIVO_FALHA_REDE))) ? null : recusada();
      }
      const valor = d.valor, conta = typeof valor.conta === 'string' ? valor.conta : null;
      if (conta !== null && contaMudou(conta, r.contaMl, bruto.conta)) {
        // Outra conta ML na org: comissão (e margem) lidas com a anterior saem de todas as abas e do cache.
        if (!(await aindaDaPagina(p))) return recusada();
        await limparAbasNaFila();
        return 'sair';
      }
      let noCache: ((c: CacheEnr) => void) | null = null;
      if (!(await gravarSe(p, (r2) => { noCache = aplicarResposta(r2.enriquecimento, pedido, valor, Date.now()); },
        () => (c) => {
          if (conta !== null && c.conta !== conta) { c.produtos = {}; c.ofertas = {}; c.vendedores = {}; c.conta = conta; }
          noCache?.(c);
        }))) return recusada();
    }
  };

  // 3. Margem dos vinculados com preço (cota própria de 30/min; o pulso da página retoma na janela seguinte).
  const margem = async (): Fase => {
    const enviados = new Set<string>();
    for (;;) {
      if (!vale()) return 'sair';
      const aba = await lerAba(tabId);
      if (!ehBusca(aba.estado)) return { ok: false, erro: 'payload_invalido' };
      const e = aba.estado, r = respostaDe(e);
      const p = { geracao: aba.geracao, sessao: aba.sessao, url: e.entrada.url };
      const elegiveis = e.observado.cards.filter((c) => {
        const res = r.resultados[c.itemId];
        return c.preco !== null && !!r.metadados[c.itemId]?.vinculo && !enviados.has(c.itemId)
          && (forcar.has(c.itemId) || !res || res.estado === 'limite');
      });
      if (elegiveis.length === 0) return null;
      if (r.limiteEm === minuto()) {
        // Cota da janela já esgotou: os que faltam ficam "aguardando cota" sem ir à edge; o pulso retoma na próxima.
        retomar = true;
        const faltam = elegiveis.filter((c) => r.resultados[c.itemId]?.estado !== 'limite');
        if (faltam.length && !(await gravarSe(p, (r2) => {
          for (const c of faltam) {
            const v = r2.metadados[c.itemId]?.vinculo;
            if (!v) continue;
            descartarMargem(r2, c.itemId);
            r2.resultados[c.itemId] = { itemId: c.itemId, estado: 'limite', fonte: v.fonte, codigo: v.codigo };
          }
        }))) return recusada();
        return null;
      }
      const lote = elegiveis.slice(0, MAX_POR_ANALISE);
      for (const c of lote) enviados.add(c.itemId);
      const g = guarda(p, lote, (c) => `${c.preco}|${c.catalogProductId}`);
      const resp = await chamarExtensao<{ itens?: unknown; limiteAtingido?: unknown; usoRegistrado?: unknown }>({
        acao: 'analisar_busca', eanDaBusca: eanDaUrlDeBusca(p.url),
        itens: lote.map((c) => ({ itemId: c.itemId, catalogProductId: c.catalogProductId, preco: c.preco })),
        registrarUso: false, // a telemetria da busca é contada no identificar_busca
      }, epoca, g);
      if (g.recusou()) { for (const c of lote) enviados.delete(c.itemId); continue; }
      if (!resp.ok || !Array.isArray(resp.dados?.itens)) {
        const falha: Falha = resp.ok ? { ok: false, erro: 'interno' } : resp;
        retomar ||= transitoria(falha);
        return falha;
      }
      const dados = resp.dados, itens = resp.dados.itens as ResultadoCard[];
      retomar ||= dados.limiteAtingido === true;
      const enviado = new Map(lote.map((c) => [c.itemId, c]));
      if (!(await gravarSe(p, (r2, agora) => {
        for (const res of itens) {
          // Card que mudou preço/catálogo durante a análise fica pendente (o resultado é do card antigo).
          const ev = enviado.get(res?.itemId), a = agora.get(res?.itemId);
          if (!ev || !a || a.preco !== ev.preco || a.catalogProductId !== ev.catalogProductId) continue;
          r2.resultados[res.itemId] = res;
          r2.precoDaMargem[res.itemId] = ev.preco!;
        }
        if (dados.limiteAtingido === true) r2.limiteEm = minuto();
      }))) return recusada();
    }
  };

  // Identificação falhou de forma transitória: enriquecimento e margem seguem com o que já foi identificado.
  let falha = await identificar();
  if (falha === 'sair') return SEM_SESSAO;
  if (falha === null || transitoria(falha)) {
    for (const fase of [enriquecer, margem]) {
      const f = await fase();
      if (f === 'sair') return SEM_SESSAO;
      falha = f ?? falha;
      if (f === SEM_SESSAO) break; // gravação recusada: o pulso refaz a rodada
    }
  }
  if (retomar) await pedirRetomada(tabId, vale);
  return falha ?? { ok: true };
}

const REVALIDAR_CONTA_MS = 5 * 60_000;

/** Aba da busca voltou a ficar visível (content script): confirma a conta ML da org sem itens (só banco, sem uso), no
 *  máximo 1 vez a cada 5 min por aba. Outra conta (ou conexão removida) → limpa cache e vistas de todas as abas; a
 *  página recebe `sessao-mudou`, reenvia os cards e o processamento refaz tudo com a conta nova. */
export function revalidarContaDaAba(tabId: number, epoca: number): Promise<void> {
  const vez = cancelamentos.get(tabId) ?? 0;
  const vale = () => epoca === epocaAtual() && vez === (cancelamentos.get(tabId) ?? 0);
  return naFila(analises, tabId, async () => {
    const identidade = await identidadeAtual();
    if (!vale() || identidade === null) return;
    const a = await lerAba(tabId);
    if (!ehBusca(a.estado)) return;
    const r = respostaDe(a.estado);
    if (r.contaVerificadaEm !== undefined && Date.now() - r.contaVerificadaEm < REVALIDAR_CONTA_MS) return;
    const p = { geracao: a.geracao, sessao: a.sessao, url: a.estado.entrada.url };
    const mesmaPagina = async () => {
      const b = await lerAba(tabId);
      return vale() && b.geracao === p.geracao && b.sessao === p.sessao && ehBusca(b.estado) && b.estado.entrada.url === p.url;
    };
    /** Grava na aba só se identidade, rodada e página ainda são as do início. */
    const gravarNaPagina = (mudar: (r2: RespostaViva) => void) => seAindaIdentidade(identidade, () => naFila(escritas, tabId, async () => {
      const b = await lerAba(tabId);
      if (!vale() || b.geracao !== p.geracao || b.sessao !== p.sessao || !ehBusca(b.estado) || b.estado.entrada.url !== p.url) return false;
      const r2 = respostaDe(b.estado);
      mudar(r2);
      await registrarEstado(tabId, { geracao: p.geracao, sessao: p.sessao, entrada: b.estado.entrada, resposta: r2, observado: b.estado.observado });
      return true;
    })).then((ok) => ok === true);
    // A tentativa conta antes do envio: falha de rede ou resposta sem contaMl também respeita os 5 min.
    if (!(await gravarNaPagina((r2) => { r2.contaVerificadaEm = Date.now(); }))) return;
    const resp = await chamarExtensao<{ contaMl?: unknown }>({ acao: 'identificar_busca', eanDaBusca: null, itens: [], registrarUso: false }, epoca,
      { aindaVale: vale, conferir: mesmaPagina });
    const contaMl = resp.ok && (typeof resp.dados.contaMl === 'string' || resp.dados.contaMl === null) ? resp.dados.contaMl : undefined;
    if (contaMl === undefined) return; // edge antiga ou falha: nada a concluir
    if (contaMudou(contaMl, r.contaMl, (await lerCache(identidade)).conta)) {
      if (!(await mesmaPagina()) || (await identidadeAtual()) !== identidade) return;
      await limparAbasNaFila();
      return;
    }
    await gravarNaPagina((r2) => { r2.contaMl = contaMl; });
  });
}

/** Conta ML `nova` difere da já vista nesta página ou da gravada no cache (null = sem conexão também conta). */
function contaMudou(nova: string | null, daPagina: string | null | undefined, doCache: string | null): boolean {
  return (daPagina !== undefined && daPagina !== nova) || (doCache !== null && doCache !== nova);
}

/** Pulso pedido à página (MV3 não garante timer longo no SW): o content script manda `publiai:busca-pulso` depois. */
async function pedirRetomada(tabId: number, vale: () => boolean): Promise<void> {
  if (!vale()) return;
  const a = await lerAba(tabId);
  if (vale() && ehBusca(a.estado)) {
    chrome.tabs.sendMessage(tabId, { tipo: 'publiai:busca-retomar', geracao: geracaoDaPagina(a.geracao, a.sessao), url: a.estado.entrada.url }).catch(() => {});
  }
}

/** Painel → localiza e destaca o card na página (o DOM do ML não é reordenado). */
export function destacarCard(tabId: number, itemId: string): Promise<{ ok: true }> {
  chrome.tabs.sendMessage(tabId, { tipo: 'publiai:destacar-card', itemId }).catch(() => {});
  return Promise.resolve({ ok: true });
}
