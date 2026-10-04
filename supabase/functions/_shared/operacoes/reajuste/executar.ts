// I5 / ADR-0178 — handler `reajustar` do motor de operações em massa (spec 2026-10-04: C1, C3, C5, D5, D9).
// Recuperação antes de travas: `ml_confirmado` → só persiste; `escrita_pedida` → conferência (só GET, sem
// elegibilidade); sem etapa → envio novo. Depois do claim, falha num item com etapa (escrita possível) relança
// (FalhaPosEscrita → 500 → QStash reentrega; o item fica `enviando` e volta como "enviando parado").
import { gravarPos, FalhaPosEscrita, laco, mensagemDe, type DepsLaco } from '../laco.ts';
import { MSG_RECONECTAR } from '../falhas.ts';
import { SemAcessoStatusML } from '../ml-status.ts';
import type { CamposItem, StatusItem } from '../tipos.ts';
import { centavos, reais } from './alvo.ts';
import { mudouAvaliacao } from './avaliacao.ts';
import { decidirReajuste, type Vivo } from './decidir.ts';
import { motivoInelegivel } from './elegibilidade.ts';
import type { ClienteReajusteML } from './ml.ts';
import type { Avaliacao, EntradaRestauracao, Etapa, VivoItem } from './tipos.ts';

export interface OperacaoReajusteRow { id: string; org_id: string; origem_id: string | null }
export interface ItemReajuste {
  ml_item_id: string; status: StatusItem; preco: number; preco_anterior: number; etapa: Etapa;
  conferencias: number; avaliacao: Avaliacao; restaurar: EntradaRestauracao[]; variacoes_ml: string[] | null;
  confirmado_risco: boolean; confirmado_sem_dado: boolean; codigo_pai: string; variacao_ids: string[];
}
/** `estado_invalido`: o item não detém a reserva (não está enviando/conferindo) — inconsistência, ver `persistir`. */
export type ResultadoPersistir = 'ok' | 'conflito' | 'ja_aplicado' | 'estado_invalido';
export interface DepsReajuste extends DepsLaco {
  ml: ClienteReajusteML;
  /** Re-leitura APÓS o claim (etapa atual). `restaurar` = coluna `estado_anterior` (EntradaRestauracao[]). */
  lerItem(operacaoId: string, mlItemId: string): Promise<ItemReajuste>;
  /** Avaliação com tarifa fresca (C1, sem cache). */
  avaliarFresco(mlItemId: string, preco: number): Promise<Avaliacao>;
  fatos(item: ItemReajuste): Promise<{ ehKit: boolean; temAtacado: boolean; promocaoBanco: boolean; familiaPublicando: boolean; migracaoPxv: boolean }>;
  /** RPC `reajuste_persistir`: grava variações + item `aplicado` (ou `erro` no conflito) atomicamente. */
  persistir(operacaoId: string, mlItemId: string, precoConfirmado: number, restaurar: EntradaRestauracao[]): Promise<ResultadoPersistir>;
  /** Item → `conferindo` (etapa preservada), `conferencias` = n + 1, `proxima_conferencia` = agora + backoff(n)
   *  (5/10/20/40/60 min, teto 60, sem limite de tentativas), mensagem 'Aguardando confirmação do ML'. */
  agendarConferenciaItem(operacaoId: string, mlItemId: string, conferencias: number): Promise<void>;
  /** Fatal: pendente/enviando SEM etapa → `erro` (mensagem); COM etapa → `conferindo` agendado (reserva mantida). */
  encerrarSemEtapa(operacaoId: string, mensagem: string): Promise<void>;
}

export const TENTATIVAS_REAJUSTE = 3;
export const MSG_FINANCEIRO = 'Dados financeiros mudaram desde o preview — refaça o preview';
export const MSG_SEM_CONFIRMACAO = 'Item com risco sem a confirmação exigida — refaça o preview';
export const MSG_NAO_APLICADO = 'Preço não aplicado pelo ML';

const FALHOU: Vivo = { kind: 'falhou' };
/** Preço inválido/não representável → null (nunca lança: numa etapa isso viraria 500 eterno). */
function cent(x: number | null): number | null {
  if (x === null || !Number.isFinite(x) || !(x >= 0.01)) return null;
  try { return centavos(x); } catch { return null; }
}
/** Legacy: todas as variações; plano/UP: `price`. */
function vivoDe(v: VivoItem): Vivo {
  const cs = (v.variacoes ? v.variacoes.map((x) => x.preco) : [v.preco]).map(cent);
  if (!cs.length || cs.some((c) => c === null)) return FALHOU;
  return { kind: 'ok', preco: reais(cs[0]!), todasIguais: cs.every((c) => c === cs[0]), composicao: v.variacoes?.map((x) => x.id) ?? null };
}

async function processar(operacaoId: string, ml: string, deps: DepsReajuste): Promise<void> {
  // Sem a etapa não dá para saber se houve escrita → toda falha aqui relança.
  const item = await deps.lerItem(operacaoId, ml).catch((e) => { throw new FalhaPosEscrita(e); });
  let etapa: Etapa = item.etapa; // pessimista: marcada ANTES de gravar (gravação incerta conta como feita)
  const gravar = (c: Partial<CamposItem>) => deps.gravarItem(operacaoId, ml, c);
  const agendar = () => deps.agendarConferenciaItem(operacaoId, ml, item.conferencias);
  const lerVivo = () => deps.ml.lerVivo(ml);

  const persistir = async () => {
    // ok / ja_aplicado / conflito: a RPC já gravou o item. estado_invalido: o item saiu da reserva por outro
    // caminho enquanto a escrita estava no ML — inconsistência não recuperável aqui: relança para o retry/inspeção.
    const r = await deps.persistir(operacaoId, ml, item.preco, item.restaurar);
    if (r === 'estado_invalido') throw new FalhaPosEscrita(new Error(`reajuste_persistir: estado inválido (${ml})`));
  };
  const confirmar = async () => {
    etapa = 'ml_confirmado';
    await gravar({ etapa });
    await persistir();
  };
  // Retentável: fica `enviando` (como executar-status) — `pendente` seria reivindicado de novo no mesmo laço,
  // 3 PUTs seguidos num 429. `finalizar` vê o enviando e continua em 150 s ("enviando parado").
  const retentar = (mensagem: string) => item.conferencias + 1 < TENTATIVAS_REAJUSTE
    ? gravar({ etapa: null, conferencias: item.conferencias + 1, mensagem })
    : gravar({ status: 'erro', etapa: null, mensagem });

  const conferir = async () => {
    let vivo = FALHOU;
    try {
      vivo = vivoDe(await lerVivo());
    } catch (e) {
      if (e instanceof SemAcessoStatusML) throw e;
    }
    const d = decidirReajuste('escrita_pedida', item.preco, item.preco_anterior, vivo, item.variacoes_ml);
    if (d.tipo === 'persistir') return confirmar();
    if (d.tipo === 'voltar_pendente') return gravar({ status: 'pendente', etapa: null, mensagem: null });
    if (d.tipo === 'fim' && d.status === 'conferindo') return agendar();
    if (d.tipo === 'fim') return gravar({ status: d.status, etapa: null, mensagem: d.mensagem });
    throw new Error(`decisão inesperada na conferência: ${d.tipo}`);
  };

  const enviar = async () => {
    let atual: VivoItem;
    try {
      atual = await lerVivo();
    } catch (e) {
      if (e instanceof SemAcessoStatusML) throw e;
      return retentar(mensagemDe(e));
    }
    const [promocaoML, fatos] = await Promise.all([deps.ml.participaPromocaoML(ml), deps.fatos(item)]);
    const motivo = motivoInelegivel({ vivo: atual, promocaoML, ...fatos });
    if (motivo) return gravar({ status: 'bloqueado', mensagem: motivo });
    const d = decidirReajuste(null, item.preco, item.preco_anterior, vivoDe(atual), item.variacoes_ml);
    if (d.tipo === 'fim') return gravar({ status: d.status, mensagem: d.mensagem });
    if (d.tipo !== 'escrever') throw new Error(`decisão inesperada no envio: ${d.tipo}`);

    const fresca = await deps.avaliarFresco(ml, item.preco);
    if (mudouAvaliacao(item.avaliacao, fresca)) return gravar({ status: 'mudou', mensagem: MSG_FINANCEIRO });
    // Defesa C5 (o confirmar já exige): 🔴/⚪ sem a confirmação própria não escreve.
    if ((fresca.tem_vermelho && !item.confirmado_risco) || (fresca.tem_sem_dado && !item.confirmado_sem_dado)) {
      return gravar({ status: 'mudou', mensagem: MSG_SEM_CONFIRMACAO });
    }

    etapa = 'escrita_pedida';
    await gravar({ etapa });
    const r = await deps.ml.putPreco(ml, item.preco, item.variacoes_ml);
    if (r.kind === 'desconhecido') return agendar();
    if (r.kind === 'sem_escrita') {
      return r.status === 429 ? retentar(r.mensagem) : gravar({ status: 'erro', etapa: null, mensagem: r.mensagem });
    }
    let conf = FALHOU;
    try {
      conf = vivoDe(await lerVivo());
    } catch (e) {
      if (e instanceof SemAcessoStatusML) throw e;
      return agendar();
    }
    if (conf.kind === 'falhou') return agendar();
    if (conf.todasIguais && centavos(conf.preco) === centavos(item.preco)) return confirmar();
    return gravar({ status: 'erro', etapa: null, mensagem: MSG_NAO_APLICADO });
  };

  try {
    if (etapa === 'ml_confirmado') return await persistir();
    if (etapa === 'escrita_pedida') return await conferir();
    return await enviar();
  } catch (e) {
    if (etapa === null || e instanceof FalhaPosEscrita) throw e;
    if (e instanceof SemAcessoStatusML) {
      // Fatal com escrita possível: o item fica `conferindo` (reserva mantida) e o laço não o marca `erro`.
      await gravarPos(agendar());
      throw Object.assign(e, { jaGravado: true });
    }
    throw new FalhaPosEscrita(e);
  }
}

export function executarReajuste(
  op: OperacaoReajusteRow, deps: DepsReajuste, opts: { limiteMs: number; lote: number; maxItens?: number },
): Promise<{ processados: number; continuou: boolean }> {
  // Reverter (origem_id) usa o mesmo fluxo: alvo e `restaurar` já vêm da origem, gravados no preview.
  return laco(op.id, deps, opts, (it) => processar(op.id, it.ml_item_id, deps),
    { eh: (e) => e instanceof SemAcessoStatusML, mensagem: MSG_RECONECTAR, encerrar: (m) => deps.encerrarSemEtapa(op.id, m) });
}
