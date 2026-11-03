// Busca no service worker (ADR-0189 D-11, Task 22; emenda 2026-11-02, Task 3): o content script manda os cards lidos e
// o SW, com a extensão ativa e a sessão válida, identifica todos no banco (`identificar_busca`, sem ML nem cota) e analisa
// a margem só dos vinculados com preço (`analisar_busca`) — painel aberto ou fechado. O painel só consome o estado.
// O estado fica na mesma chave da aba (geração por página e por sessão): resposta atrasada de outra busca não volta.
import { chamarExtensao, consultarSessaoAtual } from './api';
import { epocaAtual, lerAba, registrarEstado } from './abas';
import { eanDaUrlDeBusca } from './conteudo/ean';
import { normalizarCards, type CardBusca } from './leitura/busca';
import { identidadeAtual, limparAbasNaFila, seAindaIdentidade } from './sessao';
import { aplicarHits, aplicarResposta, gravarCache, lerCache, planejarLote, type CacheEnr, type RespostaEnriquecimento } from './cache-enriquecimento';
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

type Falha = { ok: false; erro: string };
const SEM_SESSAO: Falha = { ok: false, erro: 'sem_sessao' };
// Vale tentar de novo no próximo pulso: rede/5xx e limite da edge. Os demais (sessão, módulo, acesso) esperam evento novo.
const transitoria = (f: Falha) => f.erro === 'interno' || f.erro === 'limite';

/** Identifica no banco o que falta e analisa a margem dos vinculados elegíveis, em lotes de até 50, tudo a partir do
 *  estado guardado (reinício do SW, pulso, scroll e painel convergem). `epoca` = a de quando a mensagem chegou: sessão,
 *  pausa ou navegação no meio → nada é chamado, gravado nem transmitido. `forcar` = itens que o painel quer refazer
 *  (ex.: logo depois de vincular ao SKU): identificação e margem de novo, mesmo com resultado. */
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

  const identificados = new Set<string>(), enviados = new Set<string>();
  let falha: Falha | null = null, retomar = false, fase: 'identificar' | 'margem' = 'identificar';
  // Gravação recusada com a época e a página ainda valendo = só a identidade mudou desde o início (ex.: recém-logado,
  // descoberta na 1ª chamada): o pulso refaz com a nova. Época/página nova → `vale()` falso, nada a retomar.
  const recusada = () => { retomar ||= vale(); return SEM_SESSAO; };
  // Logo antes do envio (depois dos awaits de token/identidade): a rodada não foi cancelada, a página (geração, sessão,
  // URL) é a mesma e cada item do lote ainda tem a assinatura de quando foi escolhido. Recusa com tudo valendo = o lote
  // mudou: refaz a seleção. Sem isso, navegação ou preço novo durante a preparação ainda chamariam a edge.
  let recusouEnvio = false;
  const guarda = (p: Pagina, lote: CardBusca[], assinatura: (c: CardBusca) => string) => ({
    aindaVale: vale,
    conferir: async () => {
      const a = await lerAba(tabId);
      const ok = vale() && a.geracao === p.geracao && a.sessao === p.sessao && ehBusca(a.estado) && a.estado.entrada.url === p.url && (() => {
        const agora = new Map(a.estado.observado.cards.map((c) => [c.itemId, c]));
        return lote.every((c) => { const x = agora.get(c.itemId); return !!x && assinatura(x) === assinatura(c); });
      })();
      recusouEnvio = !ok && vale();
      return ok;
    },
  });
  for (;;) {
    if (!vale()) return SEM_SESSAO;
    const aba = await lerAba(tabId);
    if (!ehBusca(aba.estado)) return { ok: false, erro: 'payload_invalido' };
    const e = aba.estado, r = respostaDe(e);
    const p = { geracao: aba.geracao, sessao: aba.sessao, url: e.entrada.url };
    const eanDaBusca = eanDaUrlDeBusca(p.url); // o da própria busca (o guardado na aba pode ser de outra)

    if (fase === 'identificar') {
      const lote = e.observado.cards
        .filter((c) => !identificados.has(c.itemId) && (!r.metadados[c.itemId] || forcar.has(c.itemId))).slice(0, MAX_POR_ANALISE);
      if (lote.length === 0) { fase = 'margem'; continue; }
      for (const c of lote) identificados.add(c.itemId);
      const resp = await chamarExtensao<{ itens?: unknown }>({
        acao: 'identificar_busca', eanDaBusca, itens: lote.map((c) => ({ itemId: c.itemId, catalogProductId: c.catalogProductId })),
        // Telemetria `busca`: uma por geração de página, no 1º lote (falhou → o próximo pede de novo).
        registrarUso: !r.usoRegistrado,
      }, epoca, guarda(p, lote, (c) => `${c.catalogProductId}`));
      if (recusouEnvio) { recusouEnvio = false; for (const c of lote) identificados.delete(c.itemId); continue; }
      const itens = resp.ok && Array.isArray(resp.dados?.itens) ? (resp.dados.itens as MetadadosCardBusca[]) : null;
      if (!itens) {
        // Falha inteira (500, corpo fora do formato): metadados seguem desconhecidos; o pulso tenta de novo.
        falha = resp.ok ? { ok: false, erro: 'interno' } : resp;
        retomar ||= transitoria(falha);
        fase = 'margem';
        continue;
      }
      const enviado = new Map(lote.map((c) => [c.itemId, c]));
      const gravou = await gravarSe(p, (r2, agora) => {
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
      if (!gravou) { falha = recusada(); break; }
      continue;
    }

    const elegiveis = e.observado.cards.filter((c) => {
      const res = r.resultados[c.itemId];
      return c.preco !== null && !!r.metadados[c.itemId]?.vinculo && !enviados.has(c.itemId)
        && (forcar.has(c.itemId) || !res || res.estado === 'limite');
    });
    if (elegiveis.length === 0) break;
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
      }))) falha = recusada();
      break;
    }
    const lote = elegiveis.slice(0, MAX_POR_ANALISE);
    for (const c of lote) enviados.add(c.itemId);
    const resp = await chamarExtensao<{ itens?: unknown; limiteAtingido?: unknown; usoRegistrado?: unknown }>({
      acao: 'analisar_busca', eanDaBusca,
      itens: lote.map((c) => ({ itemId: c.itemId, catalogProductId: c.catalogProductId, preco: c.preco })),
      registrarUso: false, // a telemetria da busca é contada no identificar_busca
    }, epoca, guarda(p, lote, (c) => `${c.preco}|${c.catalogProductId}`));
    if (recusouEnvio) { recusouEnvio = false; for (const c of lote) enviados.delete(c.itemId); continue; }
    if (!resp.ok || !Array.isArray(resp.dados?.itens)) {
      falha = resp.ok ? { ok: false, erro: 'interno' } : resp;
      retomar ||= transitoria(falha);
      break;
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
    }))) { falha = recusada(); break; }
  }

  // 3. Enriquecimento dos catálogos (Task 10; plano, Revisão 03/11): fila deduplicada por catálogo, um lote em voo por
  // aba (esta fila), só componentes vencidos no cache do navegador. Janela/retomarEm → pulso; rede → só o painel retoma.
  if (falha === null || transitoria(falha)) {
    const jaPedidos = new Set<string>();
    for (let primeira = true; ; primeira = false) {
      if (!vale()) return SEM_SESSAO;
      const aba = await lerAba(tabId);
      if (!ehBusca(aba.estado)) break;
      const e = aba.estado, r = respostaDe(e), enr = r.enriquecimento;
      const p = { geracao: aba.geracao, sessao: aba.sessao, url: e.entrada.url };
      if (primeira && retentar && enr.falhou) {
        if (!(await gravarSe(p, (r2) => { r2.enriquecimento.falhou = false; }))) { falha = recusada(); break; }
        continue;
      }
      if (enr.falhou || enr.indisponivel) break;
      const cache = await lerCache(identidade);
      const plano = planejarLote(e.observado.cards, r.metadados, enr, cache, Date.now(), jaPedidos);
      retomar ||= plano.esperar;
      if (plano.hits.usados.length && !(await gravarSe(p, (r2) => aplicarHits(r2.enriquecimento, plano.hits), () => (c) => {
        for (const u of plano.hits.usados) { const x = c[u.m][u.k]; if (x) x.u = Date.now(); } // menos usado sai primeiro
      }))) { falha = recusada(); break; }
      const pedido = plano.pedido;
      if (!pedido) break;
      const marcas = [...pedido.catalogos.map((c) => c.catalogProductId), ...pedido.perfis.map((s) => `perfil:${s}`)];
      for (const m of marcas) jaPedidos.add(m);
      const cats = new Set(pedido.catalogos.map((c) => c.catalogProductId));
      const lote = e.observado.cards.filter((c) => c.catalogProductId && cats.has(c.catalogProductId));
      const resp = await chamarExtensao<{ estado?: unknown; motivo?: unknown; valor?: RespostaEnriquecimento }>(
        { acao: 'enriquecer_catalogos_busca', ...pedido }, epoca, guarda(p, lote, (c) => `${c.preco}|${c.catalogProductId}`));
      if (recusouEnvio) { recusouEnvio = false; for (const m of marcas) jaPedidos.delete(m); continue; }
      const d = resp.ok ? resp.dados : null;
      if (!resp.ok && !transitoria(resp)) { falha = resp; break; }
      if (d?.estado === 'indisponivel') {
        const motivo = typeof d.motivo === 'string' ? d.motivo : 'Enriquecimento indisponível';
        if (!(await gravarSe(p, (r2) => { r2.enriquecimento.indisponivel = motivo; }))) falha = recusada();
        break;
      }
      if (d?.estado !== 'ok' || !d.valor || !Array.isArray(d.valor.catalogos)) {
        // Rede/5xx/corpo fora do formato: sem repetição automática (o pulso não retoma); o painel oferece "Tentar novamente".
        if (!(await gravarSe(p, (r2) => { r2.enriquecimento.falhou = true; }))) falha = recusada();
        break;
      }
      const valor = d.valor, conta = typeof valor.conta === 'string' ? valor.conta : null;
      if (conta !== null && cache.conta !== null && cache.conta !== conta) {
        // Outra conta ML na org: comissão (e margem) lidas com a anterior saem de todas as abas e do cache.
        await limparAbasNaFila();
        return SEM_SESSAO;
      }
      let noCache: ((c: CacheEnr) => void) | null = null;
      if (!(await gravarSe(p, (r2) => { noCache = aplicarResposta(r2.enriquecimento, pedido, valor, Date.now()); },
        () => (c) => { if (conta !== null) c.conta = conta; noCache?.(c); }))) { falha = recusada(); break; }
    }
  }
  if (retomar) await pedirRetomada(tabId, vale);
  return falha ?? { ok: true };
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
