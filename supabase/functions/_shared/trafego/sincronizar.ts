// Vendas SKU Fatia 2b — orquestração pura do worker de tráfego (uma org por mensagem, em cadeia).
// Decisão aqui; IO nas deps (fiação real na Task 5). Contrato do banco: cabeçalho de
// 20260927084615_vendas_sku_trafego.sql (posse, CAS do cursor, concluir_trafego_rodada).
import { emParalelo } from '../promocoes/sincronizar.ts';
import { montarInventario, type FontesInventario } from './inventario.ts';
import { diaDeHoje, diasAColetar, parametrosJanela } from './janelas.ts';
import { diasDaJanela, parseSalePrice, parseVisitas } from './parsers.ts';

/** Token/conexão ML inválidos: a org fecha a rodada como `sem_acesso`. */
export class SemAcessoTrafego extends Error {}

const CALENDARIO = 'brt' as const; // spike 052
const FALLBACK_RETRY_MS = 1_500;
const MAX_TENTATIVAS = 3;

export interface RespostaML { status: number; retryAfterMs: number | null; corpo: unknown }
export interface MsgTrafego { org_id: string; rodada?: string; cursor?: string | null; primeira: boolean }
export interface PontoVisitasGravar { ml_item_id: string; dia: string; visitas: number | null; estado: 'ok' | 'pendente' | 'falha' }
export interface PontoPrecoGravar {
  ml_item_id: string; dia: string; preco: number; preco_regular: number | null; moeda: string;
  observado_em: string; origem: string;
}
export interface StatusItemGravar { ml_item_id: string; status: string; ultimo_ok_em: string | null }
export type ResultadoTrafego = 'ok' | 'continua' | 'obsoleta' | 'erro' | 'sem_acesso';

/** Deps ligadas a uma org. Erro de token/conexão → lançar `SemAcessoTrafego`. */
export interface DepsTrafego {
  agora(): number;
  esperar(ms: number): Promise<void>;
  /** reservar_trafego_posse: null = posse viva de outra cadeia. `rodada` em ms (ida e volta por Date). */
  reservarPosse(): Promise<{ rodada: string; cursor: string | null } | null>;
  /** avancar_trafego_cursor (CAS; renova a posse). novo = atual só confere/renova. false = obsoleta. */
  avancarCursor(rodada: string, atual: string | null, novo: string | null): Promise<boolean>;
  /** ml_trafego_sync.carga_inicial_concluida_em != null e o último dia `ok` gravado da org. */
  lerEstadoSync(): Promise<{ cargaInicialConcluida: boolean; ultimoDiaOk: string | null }>;
  /** As 8 fontes do inventário + MLBs encerrados há mais de 30 dias (ml_trafego_item). */
  lerInventario(): Promise<{ fontes: FontesInventario; encerradosHaMaisDe30d: Set<string> }>;
  /** Multiget ML `/items?ids=…&attributes=id,status` dos MLBs do lote (≤ 20). */
  lerStatusItens(ids: string[]): Promise<{ ml_item_id: string; status: string }[]>;
  /** GET /items/{id}/visits/time_window?unit=day&last&ending — nunca lança por status HTTP. */
  buscarVisitas(id: string, p: { last: number; ending: string }): Promise<RespostaML>;
  /** GET /items/{id}/sale_price?context=channel_marketplace — nunca lança por status HTTP. */
  buscarPreco(id: string): Promise<RespostaML>;
  /** MLBs (entre `ids`) que já têm linha em ml_item_preco_dia no `dia`. */
  precoJaGravadoHoje(ids: string[], dia: string): Promise<Set<string>>;
  gravarVisitas(rodada: string, pontos: PontoVisitasGravar[]): Promise<void>;
  gravarPreco(pontos: PontoPrecoGravar[]): Promise<void>;
  gravarStatusItens(itens: StatusItemGravar[]): Promise<void>;
  /** Publica a continuação da cadeia. */
  continuar(msg: MsgTrafego): Promise<void>;
  /** concluir_trafego_rodada: solta a posse. false = rodada obsoleta. */
  concluir(rodada: string, estado: 'ok' | 'erro' | 'sem_acesso', erro: string | null, cargaConcluida: boolean): Promise<boolean>;
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * 401 → SemAcessoTrafego. 429/5xx → espera Retry-After (fallback 1,5 s) só se couber até `fimMs`,
 * no máx. 3 tentativas; não coube → 'adiar'; esgotou → devolve a última resposta (quem chama decide).
 */
async function comRetry(deps: DepsTrafego, fimMs: number, busca: () => Promise<RespostaML>): Promise<RespostaML | 'adiar'> {
  for (let tentativa = 1; ; tentativa++) {
    const r = await busca();
    if (r.status === 401) throw new SemAcessoTrafego('ML 401: token inválido');
    if (r.status !== 429 && r.status < 500) return r;
    if (tentativa >= MAX_TENTATIVAS) return r;
    const espera = r.retryAfterMs ?? FALLBACK_RETRY_MS;
    if (deps.agora() + espera > fimMs) return 'adiar';
    await deps.esperar(espera);
  }
}

export async function sincronizarTrafegoOrg(
  deps: DepsTrafego,
  msg: MsgTrafego,
  cfg = { limiteMs: 90_000, lote: 20, concorrencia: 6 },
): Promise<{ resultado: ResultadoTrafego }> {
  const inicio = deps.agora();
  const fim = inicio + cfg.limiteMs;
  let rodada: string | null = null;
  try {
    let cursor: string | null;
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
    const continuar = async (c: string | null) => {
      await deps.continuar({ org_id: msg.org_id, rodada: dona, cursor: c, primeira: false });
      return { resultado: 'continua' as const };
    };

    const [estado, inv] = await Promise.all([deps.lerEstadoSync(), deps.lerInventario()]);
    const janela = diasAColetar({ hoje: diaDeHoje(new Date(inicio), CALENDARIO), ...estado });
    const params = parametrosJanela(janela);
    const inicial = cursor;
    // Cursor = último MLB gravado; mesma comparação da ordenação de montarInventario (code units).
    const pendentes = montarInventario(inv.fontes, inv.encerradosHaMaisDe30d)
      .filter((id) => inicial == null || id > inicial);

    for (let i = 0; i < pendentes.length; i += cfg.lote) {
      if (i > 0 && deps.agora() - inicio > cfg.limiteMs) return await continuar(cursor);
      const lote = pendentes.slice(i, i + cfg.lote);
      // Preço só no dia de `agora` e só se ainda não há linha desse dia (1 GET por MLB por execução).
      const diaPreco = diaDeHoje(new Date(deps.agora()), CALENDARIO);
      const jaTemPreco = await deps.precoJaGravadoHoje(lote, diaPreco);
      let adiado = false;
      const resultados = await emParalelo(lote, cfg.concorrencia, async (id) => {
        if (adiado) return null;
        const v = await comRetry(deps, fim, () => deps.buscarVisitas(id, params));
        if (v === 'adiar') { adiado = true; return null; }
        const agora = new Date(deps.agora());
        // 403/404/corpo inválido/5xx esgotado → falha dos dias pedidos (o banco nunca troca ok por falha).
        const lidos = v.status === 200 ? parseVisitas(v.corpo, CALENDARIO, agora, janela) : null;
        const pontos: PontoVisitasGravar[] = lidos
          ? lidos.map((p) => ({ ml_item_id: id, ...p }))
          : diasDaJanela(janela.desde, janela.ate).map((dia) => ({ ml_item_id: id, dia, visitas: null, estado: 'falha' }));

        let preco: PontoPrecoGravar | null = null;
        if (!jaTemPreco.has(id)) {
          // Preço é secundário: sem resposta 200 válida (inclusive 'adiar') só fica sem linha hoje.
          const p = await comRetry(deps, fim, () => deps.buscarPreco(id));
          const obs = p !== 'adiar' && p.status === 200 ? parseSalePrice(p.corpo) : null;
          const quando = new Date(deps.agora());
          if (obs && diaDeHoje(quando, CALENDARIO) === diaPreco) {
            preco = {
              ml_item_id: id, dia: diaPreco, preco: obs.preco, preco_regular: obs.precoRegular,
              moeda: obs.moeda, observado_em: quando.toISOString(), origem: 'sale_price',
            };
          }
        }
        return { id, pontos, ultimoOkEm: lidos ? agora.toISOString() : null, preco };
      });
      // 429/5xx sem espera que caiba: o lote inteiro volta para a próxima mensagem, sem `falha`.
      if (adiado) return await continuar(cursor);

      const feitos = resultados.filter((r) => r != null);
      await deps.gravarVisitas(dona, feitos.flatMap((r) => r.pontos));
      const precos = feitos.flatMap((r) => (r.preco ? [r.preco] : []));
      if (precos.length) await deps.gravarPreco(precos);

      const okEm = new Map(feitos.map((r) => [r.id, r.ultimoOkEm]));
      const status = new Map<string, StatusItemGravar>();
      for (const s of await deps.lerStatusItens(lote)) {
        if (okEm.has(s.ml_item_id) && !status.has(s.ml_item_id)) {
          status.set(s.ml_item_id, { ml_item_id: s.ml_item_id, status: s.status, ultimo_ok_em: okEm.get(s.ml_item_id)! });
        }
      }
      if (status.size) await deps.gravarStatusItens([...status.values()]);

      const novo = lote[lote.length - 1];
      if (!(await deps.avancarCursor(dona, cursor, novo))) return { resultado: 'obsoleta' };
      cursor = novo;
    }

    if (!(await deps.concluir(dona, 'ok', null, true))) return { resultado: 'obsoleta' };
    return { resultado: 'ok' };
  } catch (e) {
    const resultado = e instanceof SemAcessoTrafego ? 'sem_acesso' : 'erro';
    if (rodada == null) {
      console.error('[trafego] falha antes da posse', { org_id: msg.org_id, erro: mensagem(e) });
      return { resultado: 'erro' };
    }
    try {
      if (!(await deps.concluir(rodada, resultado, mensagem(e), false))) return { resultado: 'obsoleta' };
    } catch (e2) {
      console.error('[trafego] concluir falhou', { org_id: msg.org_id, erro: mensagem(e), concluir: mensagem(e2) });
    }
    return { resultado };
  }
}
