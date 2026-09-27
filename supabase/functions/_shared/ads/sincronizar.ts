// Vendas SKU Fatia 2c — orquestração pura do worker de Ads (uma org por mensagem, em cadeia).
// Mesmo contrato de posse/cursor da 2b (_shared/trafego/sincronizar.ts), com estado próprio (ml_ads_sync,
// migration <TS>_vendas_sku_ads.sql). Unidade = ad_group_id (R3). Só GET no ML.
import { emParalelo } from '../promocoes/sincronizar.ts';
import { diaDeHoje } from '../trafego/janelas.ts';
import { TIMEOUT_ML_MS } from '../trafego/fiacao.ts';
import type { MsgTrafego, RespostaML } from '../trafego/sincronizar.ts';
import { janelaAds, type JanelaAds } from './janelas.ts';
import {
  classificarResposta, parseAdvertiser, parseBuscaGrupos, parseMembros, parseSerieGrupo,
  type DiaAds, type GrupoBusca, type TipoGrupo,
} from './parsers.ts';

export type EstadoParada = 'sem_acesso' | 'sem_permissao' | 'sem_advertiser';
/** A org para sem ser erro do worker: conexão recusada, sem permissão de Publicidade ou sem anunciante. */
export class ParadaAds extends Error {
  estado: EstadoParada;
  constructor(estado: EstadoParada, mensagem: string) { super(mensagem); this.estado = estado; }
}

/** `descontar`: Σ cost (no search) dos grupos listados com gasto que deram 404 nesta rodada. Sai do
 *  custoListado para o dossiê ver `fora_dos_grupos` em vez de uma despesa menor sem aviso; viaja na cadeia
 *  como `falhou`.
 *  `falhou` (Ruling 2c-5): carregado em toda continuação depois que um grupo não foi lido nesta rodada,
 *  para a mensagem final nunca fechar em `ok` mesmo quando o cursor andou numa mensagem sem falha. */
export type MsgAds = MsgTrafego & { falhou?: boolean; descontar?: number };
export type ResultadoAds = 'ok' | 'continua' | 'obsoleta' | 'erro' | 'sem_acesso';
export interface GrupoConhecido { ad_group_id: number; tipo: TipoGrupo; external_id: string | null; campaign_id: number | null; status: string }
/** `itens` null = vínculo não lido nesta rodada (o banco mantém o atual). */
export interface GrupoGravar extends GrupoConhecido { itens: string[] | null; dias: DiaAds[] }

export interface DepsAds {
  agora(): number;
  esperar(ms: number): Promise<void>;
  /** reservar_ads_posse: null = posse viva de outra cadeia. */
  reservarPosse(): Promise<{ rodada: string; cursor: string | null } | null>;
  /** avancar_ads_cursor (CAS; renova a posse). novo = atual só confere. false = obsoleta. */
  avancarCursor(rodada: string, atual: string | null, novo: string | null): Promise<boolean>;
  lerEstadoSync(): Promise<{ cargaInicialOk: boolean; ultimoOkEm: string | null }>;
  /** Grupos com linha de custo > 0 gravada em [desde, ate] (relidos mesmo fora do search). */
  lerGruposComGasto(desde: string, ate: string): Promise<GrupoConhecido[]>;
  /** Nº de MLBs no vínculo gravado de cada grupo (ml_ads_grupo_item). */
  contarVinculos(adGroupIds: number[]): Promise<Map<number, number>>;
  /** Os GETs nunca lançam por status HTTP (401 já vem depois de 1 releitura do token, ver
   *  getComReautenticacao). Sem conexão → lançar ParadaAds('sem_acesso'). */
  buscarAdvertiser(): Promise<RespostaML>;
  buscarGrupos(advertiserId: number, janela: JanelaAds, offset: number): Promise<RespostaML>;
  buscarSerieGrupo(adGroupId: number, janela: JanelaAds): Promise<RespostaML>;
  buscarMembros(adGroupId: number, janela: JanelaAds, offset: number): Promise<RespostaML>;
  /** gravar_ads_lote: false = a rodada não é mais a dona. */
  gravarLote(rodada: string, coletadoEm: string, grupos: GrupoGravar[]): Promise<boolean>;
  continuar(msg: MsgAds, opts: { atrasoMs?: number }): Promise<void>;
  concluir(rodada: string, estado: 'ok' | 'erro' | EstadoParada, erro: string | null, extra: ExtraConcluir): Promise<boolean>;
}

/** custoResumo = metrics_summary.cost do search; custoListado = Σ cost dos grupos listados (mesma janela). */
export interface ExtraConcluir {
  cargaConcluida: boolean; advertiserId: number | null; coberturaDesde: string | null;
  custoResumo: number | null; custoListado: number | null;
}

const FALLBACK_RETRY_MS = 1_500;
const MAX_TENTATIVAS = 3;
const LIMITE_ADIAMENTOS = 5;
const MSG_403 = 'sem permissão de Publicidade ou conexão recusada';
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 429/5xx: espera Retry-After (fallback 1,5 s) só se couber com uma requisição inteira; senão adia. */
async function comRetry(deps: DepsAds, fimMs: number, busca: () => Promise<RespostaML>): Promise<RespostaML | { adiar: number }> {
  for (let tentativa = 1; ; tentativa++) {
    const r = await busca();
    if (classificarResposta(r) !== 'transitorio' || tentativa >= MAX_TENTATIVAS) return r;
    const espera = r.retryAfterMs ?? FALLBACK_RETRY_MS;
    if (deps.agora() + espera + TIMEOUT_ML_MS > fimMs) return { adiar: espera };
    await deps.esperar(espera);
  }
}

/** 2xx segue. 401/403 param a org (403 nunca é tratado como token expirado). O resto é erro da rodada. */
function exigir(r: RespostaML, onde: string): void {
  const c = classificarResposta(r);
  if (c === 'ok') return;
  if (c === 'sem_acesso') throw new ParadaAds('sem_acesso', `ML 401 em ${onde}: conexão recusada`);
  if (c === 'sem_permissao') throw new ParadaAds('sem_permissao', `ML 403 em ${onde}: ${MSG_403}`);
  throw new Error(`ML HTTP ${r.status} em ${onde}`);
}

const meta = (g: GrupoConhecido): GrupoConhecido =>
  ({ ad_group_id: g.ad_group_id, tipo: g.tipo, external_id: g.external_id, campaign_id: g.campaign_id, status: g.status });

export async function sincronizarAdsOrg(
  deps: DepsAds,
  msg: MsgAds,
  cfg = { limiteMs: 90_000, lote: 20, concorrencia: 6 },
): Promise<{ resultado: ResultadoAds }> {
  const inicio = deps.agora();
  const fim = inicio + cfg.limiteMs;
  let rodada: string | null = null;
  let advertiserId: number | null = null;
  // Fora do try (Ruling 2c-6): o catch também precisa zerar o cursor, então cursor/cargaInicial/falhou
  // têm que sobreviver a uma exceção lançada no meio da cadeia.
  let cursor: string | null = null;
  let cargaInicial = false;
  // Uma vez marcada, a flag viaja em toda `continuar` desta cadeia (inclusive as anteriores a qualquer
  // falha nesta mensagem, se já veio marcada de uma mensagem anterior): a mensagem final da rodada
  // sempre sabe que houve grupo não lido, mesmo que o cursor já tenha andado antes disso ser visto.
  let falhou = msg.falhou === true;
  let descontar = msg.descontar ?? 0;
  const parada = (extra: Partial<ExtraConcluir> = {}): ExtraConcluir =>
    ({ cargaConcluida: false, advertiserId, coberturaDesde: null, custoResumo: null, custoListado: null, ...extra });
  try {
    if (msg.primeira) {
      const posse = await deps.reservarPosse();
      if (!posse) return { resultado: 'obsoleta' };
      ({ rodada, cursor } = posse);
    } else {
      if (!msg.rodada) return { resultado: 'obsoleta' };
      cursor = msg.cursor ?? null;
      if (!(await deps.avancarCursor(msg.rodada, cursor, cursor))) return { resultado: 'obsoleta' };
      rodada = msg.rodada;
    }
    const dona = rodada;
    const inicial = cursor;
    const continuar = async (c: string | null, atrasoMs?: number) => {
      const tentativa = c === inicial ? (msg.tentativa ?? 0) + 1 : 0;
      await deps.continuar(
        { org_id: msg.org_id, rodada: dona, cursor: c, primeira: false, tentativa, ...(falhou ? { falhou: true } : {}),
          ...(descontar > 0 ? { descontar: Math.round(descontar * 100) / 100 } : {}) },
        atrasoMs != null ? { atrasoMs } : {});
      return { resultado: 'continua' as const };
    };

    const estado = await deps.lerEstadoSync();
    cargaInicial = !estado.cargaInicialOk;
    const hoje = diaDeHoje(new Date(inicio), 'brt');
    const janela = janelaAds({
      hoje, cargaInicialOk: estado.cargaInicialOk,
      ultimoOkDia: estado.ultimoOkEm ? diaDeHoje(new Date(estado.ultimoOkEm), 'brt') : null,
    });
    // Membros sempre na janela de 90 dias: numa janela curta o ML pode omitir a cor sem atividade, e o
    // vínculo encolhido faria um grupo compartilhado parecer exclusivo.
    const janelaMembros = janelaAds({ hoje, cargaInicialOk: false, ultimoOkDia: null });

    const a = await comRetry(deps, fim, () => deps.buscarAdvertiser());
    if ('adiar' in a) return await continuar(cursor, a.adiar);
    if (classificarResposta(a) === 'nao_encontrado') throw new ParadaAds('sem_advertiser', 'ML 404: conta sem anunciante de Product Ads');
    exigir(a, 'advertisers');
    advertiserId = parseAdvertiser(a.corpo);
    if (advertiserId == null) throw new ParadaAds('sem_advertiser', 'Nenhum anunciante MLB de Product Ads na conta');
    const adv = advertiserId;

    const listados: GrupoBusca[] = [];
    let custoResumo: number | null = null;
    for (let offset = 0; ;) {
      const r = await comRetry(deps, fim, () => deps.buscarGrupos(adv, janela, offset));
      if ('adiar' in r) return await continuar(cursor, r.adiar);
      exigir(r, 'ad_groups/search');
      const p = parseBuscaGrupos(r.corpo);
      if (!p) throw new Error('ad_groups/search: resposta inválida');
      if (offset === 0) custoResumo = p.custoResumo;
      listados.push(...p.grupos);
      offset += p.grupos.length;
      if (p.grupos.length === 0 || offset >= p.total) break;
    }
    const noSearch = new Set(listados.map((g) => g.ad_group_id));
    const custoNoSearch = new Map(listados.map((g) => [g.ad_group_id, g.cost]));
    // Relidos: com gasto na janela pelo search + os que já têm gasto gravado nela (grupo apagado some do
    // search, mas o ML o mantém 90 dias; 404 → os dias gravados ficam).
    const alvo = new Map<number, GrupoConhecido>();
    for (const g of await deps.lerGruposComGasto(janela.desde, janela.ate)) alvo.set(g.ad_group_id, meta(g));
    for (const g of listados) if (g.cost > 0) alvo.set(g.ad_group_id, meta(g));
    const pendentes = [...alvo.values()].sort((x, y) => x.ad_group_id - y.ad_group_id)
      .filter((g) => inicial == null || g.ad_group_id > Number(inicial));

    let naoLidos = 0;
    const erroNaoLidos = () => naoLidos > 0
      ? `${naoLidos} ${naoLidos === 1 ? 'grupo não lido' : 'grupos não lidos'} depois de ${LIMITE_ADIAMENTOS} adiamentos (429/5xx/tempo)`
      : 'grupo(s) não lido(s) em mensagem anterior desta rodada (429/5xx/tempo)';
    for (let i = 0; i < pendentes.length; i += cfg.lote) {
      if (i > 0 && deps.agora() - inicio > cfg.limiteMs) return await continuar(cursor);
      const lote = pendentes.slice(i, i + cfg.lote);
      const vinculos = await deps.contarVinculos(lote.map((g) => g.ad_group_id));
      let adiarMs: number | null = null;
      // null = não lido (adiado); 'sumiu' = 404 (grupo apagado: os dias gravados ficam).
      const lidos = await emParalelo(lote, cfg.concorrencia, async (g): Promise<GrupoGravar | 'sumiu' | null> => {
        if (adiarMs != null) return null;
        if (deps.agora() > fim) { adiarMs ??= 0; return null; }
        const s = await comRetry(deps, fim, () => deps.buscarSerieGrupo(g.ad_group_id, janela));
        if ('adiar' in s) { adiarMs ??= s.adiar; return null; }
        if (classificarResposta(s) === 'nao_encontrado') return 'sumiu';
        exigir(s, `ad_groups/${g.ad_group_id}`);
        const dias = parseSerieGrupo(s.corpo, janela);
        if (!dias) throw new Error(`ad_groups/${g.ad_group_id}: resposta inválida`);
        let itens: string[] | null = null;
        if (g.tipo === 'ITEM') {
          itens = g.external_id ? [g.external_id] : null;
        } else if (noSearch.has(g.ad_group_id)) {
          const achados: string[] = [];
          for (let offset = 0; ;) {
            if (deps.agora() > fim) { adiarMs ??= 0; return null; }
            const m = await comRetry(deps, fim, () => deps.buscarMembros(g.ad_group_id, janelaMembros, offset));
            if ('adiar' in m) { adiarMs ??= m.adiar; return null; }
            if (classificarResposta(m) === 'nao_encontrado') return 'sumiu';
            exigir(m, `ad_groups/${g.ad_group_id}/ads`);
            const p = parseMembros(m.corpo);
            if (!p) throw new Error(`ad_groups/${g.ad_group_id}/ads: resposta inválida`);
            achados.push(...p.itens);
            offset += p.itens.length;
            if (p.itens.length === 0 || offset >= p.total) break;
          }
          itens = [...new Set(achados)].sort();
          // Lista vazia ou menor que o vínculo gravado: mantém o gravado (itens null). O vínculo nunca encolhe
          // por esta leitura; o custo é uma cor removida de verdade seguir no grupo (fica "compartilhado",
          // o lado conservador: nunca um falso `sku`).
          if (itens.length === 0 || itens.length < (vinculos.get(g.ad_group_id) ?? 0)) itens = null;
        }
        return { ...g, itens, dias };
      });
      if (adiarMs != null) {
        // Mesmo limite da 2b: depois de 5 adiamentos no mesmo cursor, os não lidos viram falha e o cursor
        // anda. A rodada termina em `erro` (nunca `ok`): ultimo_ok_em não avança e o dossiê não prova zero.
        const preso = cursor === inicial && (msg.tentativa ?? 0) >= LIMITE_ADIAMENTOS;
        if (!preso) return await continuar(cursor, adiarMs);
        naoLidos += lidos.filter((x) => x === null).length;
        falhou = true;
      }
      // Só com o lote aceito (um lote adiado é relido e contaria duas vezes).
      lidos.forEach((x, k) => { if (x === 'sumiu') descontar += custoNoSearch.get(lote[k].ad_group_id) ?? 0; });
      const grupos = lidos.filter((x): x is GrupoGravar => x != null && x !== 'sumiu');
      if (grupos.length && !(await deps.gravarLote(dona, new Date(deps.agora()).toISOString(), grupos))) {
        return { resultado: 'obsoleta' };
      }
      if (falhou && cargaInicial) {
        // Ruling 2c-6: na carga inicial a regra não espera o fim da cadeia — se o cursor avançasse para
        // depois do grupo não lido, reservar_ads_posse o retomaria dali (ele só some quando a carga já
        // está ok), deixando os dias 16–90 desse grupo sem leitura pra sempre. Grava o que já leu (acima),
        // zera na hora e fecha, sem publicar continuação.
        if (!(await deps.avancarCursor(dona, cursor, null))) return { resultado: 'obsoleta' };
        if (!(await deps.concluir(dona, 'erro', erroNaoLidos(), parada({ advertiserId: adv })))) return { resultado: 'obsoleta' };
        return { resultado: 'erro' };
      }
      const novo = String(lote[lote.length - 1].ad_group_id);
      if (!(await deps.avancarCursor(dona, cursor, novo))) return { resultado: 'obsoleta' };
      cursor = novo;
    }

    // Gasto fora de grupo listado (provável `deleted`, spike ~2,6 %) fica gravado no sync: com diferença > 0
    // o dossiê não mostra "Lucro após Ads". Só a razão vai para o log (valor em R$ não sai do banco).
    // Grupo listado com gasto que deu 404 na leitura: o gasto dele não foi gravado, então sai do listado.
    // Piso 0: o grupo do 404 pode também ter saído do search numa mensagem seguinte (desconto > listado).
    const custoListado = Math.max(0, Math.round((listados.reduce((s, g) => s + g.cost, 0) - descontar) * 100) / 100);
    console.info('[ads] custo da janela', {
      org_id: msg.org_id, janela, listadoSobreResumo: custoResumo ? custoListado / custoResumo : null,
    });
    if (falhou) {
      // Ruling 2c-5: zera o cursor (a próxima "primeira" recomeça do zero — na carga inicial isso
      // significa reler os 90 dias inteiros, nunca deixar os dias do grupo preso órfãos) e nunca fecha em
      // `ok`/com cobertura ou custos (o dossiê não pode achar que a rodada leu tudo).
      if (!(await deps.avancarCursor(dona, cursor, null))) return { resultado: 'obsoleta' };
      if (!(await deps.concluir(dona, 'erro', erroNaoLidos(), parada({ advertiserId: adv })))) return { resultado: 'obsoleta' };
      return { resultado: 'erro' };
    }
    let dono: boolean;
    try {
      dono = await deps.concluir(dona, 'ok', null,
        { cargaConcluida: true, advertiserId: adv, coberturaDesde: janela.desde, custoResumo, custoListado });
    } catch (e) {
      console.error('[ads] concluir ok falhou', { org_id: msg.org_id, erro: mensagem(e) });
      return { resultado: 'erro' };
    }
    return { resultado: dono ? 'ok' : 'obsoleta' };
  } catch (e) {
    const estadoParada = e instanceof ParadaAds ? e.estado : null;
    if (rodada == null) {
      console.error('[ads] falha antes da posse', { org_id: msg.org_id, erro: mensagem(e) });
      return { resultado: 'erro' };
    }
    try {
      // Ruling 2c-6: falha pendente (`falhou`) ou carga inicial nunca deixa o cursor adiante do que já foi
      // lido — senão a próxima "primeira" retoma dali e nunca relê o que faltou. A carga inicial normalmente
      // já teria zerado antes de chegar aqui (bloco acima), mas uma exceção (série furada, 401/403 no meio
      // da leitura de um grupo etc.) pula direto pra este catch sem passar por lá.
      if ((falhou || cargaInicial) && !(await deps.avancarCursor(rodada, cursor, null))) {
        return { resultado: 'obsoleta' };
      }
      const dono = await deps.concluir(rodada, estadoParada ?? 'erro', mensagem(e), parada());
      if (!dono) return { resultado: 'obsoleta' };
    } catch (e2) {
      console.error('[ads] concluir falhou', { org_id: msg.org_id, erro: mensagem(e), concluir: mensagem(e2) });
    }
    return { resultado: estadoParada ? 'sem_acesso' : 'erro' };
  }
}
