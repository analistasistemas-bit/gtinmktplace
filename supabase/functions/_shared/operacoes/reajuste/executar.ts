// I5 / ADR-0178 + ADR-0196 — handler `reajustar` do motor de operações em massa, por passos (spec 2026-10-04: C1, C3, C5, D5, D9).
// Ordem: (1) reconcilia por GET todo passo com escrita pedida, antes de qualquer trava; (2) com passo em estado de volta,
// só compensa; (3) revalida antes de cada nova escrita; (4) escreve e confirma por GET. `ml_confirmado` → só persiste.
// Depois do claim, falha num item com etapa (escrita possível) relança (FalhaPosEscrita → 500 → QStash reentrega; o item
// fica `enviando` e volta como "enviando parado"). Toda transição leva o token do claim: sem posse, o worker para.
import { FalhaPosEscrita, laco, mensagemDe, type DepsLaco } from '../laco.ts';
import { MSG_RECONECTAR } from '../falhas.ts';
import { SemAcessoStatusML } from '../ml-status.ts';
import type { CamposItem, StatusItem } from '../tipos.ts';
import { centavos, reais } from './alvo.ts';
import { avaliarPassos, mudouPrecos, resumirPrecos } from './avaliacao.ts';
import { decidirReajuste, reconciliarPasso, type Vivo } from './decidir.ts';
import { motivoInelegivel, motivoTravaOferta } from './elegibilidade.ts';
import { mesmaConfig, mesmasFaixas, MSG_ATACADO_MUDOU, type ConfigMlb } from './faixas.ts';
import type { ClienteReajusteML } from './ml.ts';
import { unirOfertas } from './ofertas.ts';
import { ehFaixas, estadosIntermediarios, violacao } from './passos.ts';
import type { Avaliacao, EntradaRestauracao, EstadoPasso, Etapa, FaixaPreco, OfertaVigente, Passo, PrecoAvaliado, VivoItem } from './tipos.ts';

export interface OperacaoReajusteRow { id: string; org_id: string; origem_id: string | null }
export interface ItemReajuste {
  ml_item_id: string; status: StatusItem; preco: number; preco_anterior: number; etapa: Etapa;
  conferencias: number; avaliacoes: PrecoAvaliado[]; passos: Passo[]; restaurar: EntradaRestauracao[]; variacoes_ml: string[] | null;
  confirmado_risco: boolean; confirmado_sem_dado: boolean; codigo_pai: string; variacao_ids: string[];
}
/** `estado_invalido`: o item não detém a reserva (não está enviando/conferindo) — inconsistência, ver `persistir`.
 *  `sem_posse`: o token é de outro worker; nada foi gravado. */
export type ResultadoPersistir = 'ok' | 'conflito' | 'ja_aplicado' | 'estado_invalido' | 'sem_posse';
/** Tudo que grava no item leva o token: `false` = sem posse, nada foi gravado. */
export interface DepsReajuste extends Omit<DepsLaco, 'reivindicar' | 'gravarItem'> {
  ml: ClienteReajusteML;
  /** Token do claim; null = não reivindicado. */
  reivindicar(operacaoId: string, mlItemId: string): Promise<string | null>;
  /** RPC `reajuste_item_gravar`. */
  gravarItem(operacaoId: string, mlItemId: string, token: string, campos: Partial<CamposItem>): Promise<boolean>;
  /** RPC `reajuste_passo_marcar`. */
  marcarPasso(operacaoId: string, mlItemId: string, token: string, indice: number, estado: EstadoPasso): Promise<boolean>;
  /** Re-leitura APÓS o claim (etapa atual). `restaurar` = coluna `estado_anterior` (EntradaRestauracao[]). */
  lerItem(operacaoId: string, mlItemId: string): Promise<ItemReajuste>;
  /** Avaliação com tarifa fresca (C1, sem cache). */
  avaliarFresco(mlItemId: string, preco: number): Promise<Avaliacao>;
  fatos(item: ItemReajuste): Promise<{ ehKit: boolean; familiaPublicando: boolean; migracaoPxv: boolean }>;
  /** Configuração de atacado atual das variações do MLB. */
  configAtacado(variacaoIds: string[]): Promise<ConfigMlb>;
  /** Ofertas por MLB pedido segundo a Central e as escritas recentes do app; todo id pedido vem na resposta. */
  ofertasBanco(mlItemIds: string[]): Promise<Map<string, OfertaVigente[]>>;
  /** RPC `reajuste_persistir`: grava variações + item `aplicado` com `mensagem` (ou `erro` no conflito) atomicamente. */
  persistir(operacaoId: string, mlItemId: string, token: string, precoConfirmado: number, restaurar: EntradaRestauracao[], mensagem: string | null): Promise<ResultadoPersistir>;
  /** Item → `conferindo` (etapa preservada), `conferencias` = n + 1, `proxima_conferencia` = agora + backoff(n)
   *  (5/10/20/40/60 min, teto 60, sem limite de tentativas), mensagem 'Aguardando confirmação do ML'. */
  agendarConferenciaItem(operacaoId: string, mlItemId: string, token: string, conferencias: number): Promise<boolean>;
  /** Fatal: pendente/enviando SEM etapa → `erro` (mensagem); COM etapa → `conferindo` agendado (reserva mantida). */
  encerrarSemEtapa(operacaoId: string, mensagem: string): Promise<void>;
}

export const TENTATIVAS_REAJUSTE = 3;
export const MSG_FINANCEIRO = 'Dados financeiros mudaram desde o preview — refaça o preview';
export const MSG_SEM_CONFIRMACAO = 'Item com risco sem a confirmação exigida — refaça o preview';
export const MSG_NAO_APLICADO = 'Preço não aplicado pelo ML';
export const MSG_FAIXAS_PENDENTES = 'Preço aplicado, mas as faixas de atacado não foram atualizadas';
export const MSG_FAIXAS_MUDARAM = 'As faixas de atacado mudaram desde o preview — refaça o preview';
export const MSG_COMPENSADO = 'Alteração desfeita — refaça o preview';
const MSG_ATACADO_ILEGIVEL = 'Não foi possível ler o atacado — tente de novo';
const MSG_FAIXAS_NAO_APLICADAS = 'Faixas de atacado não aplicadas pelo ML';
const MSG_SEM_PASSOS = 'Preview anterior à execução por passos — refaça o preview';

/** Outro worker reivindicou o item: para tudo, sem gravar nem escrever. */
class SemPosse extends Error {}
/** `retentar`: leitura falhou, sem nada escrito volta a tentar. `inconclusiva`: não se sabe o estado do ML; nunca vira escrita. */
type Reprovacao = { status: StatusItem | 'retentar'; mensagem: string; inconclusiva?: boolean };

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

async function processar(op: OperacaoReajusteRow, ml: string, token: string, deps: DepsReajuste): Promise<void> {
  // Sem a etapa não dá para saber se houve escrita → toda falha aqui relança.
  const item = await deps.lerItem(op.id, ml).catch((e) => { throw new FalhaPosEscrita(e); });
  const { passos, variacoes_ml: composicao } = item;
  let etapa: Etapa = item.etapa; // pessimista: marcada ANTES de gravar (gravação incerta conta como feita)

  const posse = (ok: boolean) => { if (!ok) throw new SemPosse(); };
  const gravar = async (c: Partial<CamposItem>) => posse(await deps.gravarItem(op.id, ml, token, c));
  const agendar = async () => posse(await deps.agendarConferenciaItem(op.id, ml, token, item.conferencias));
  const marcar = async (i: number, estado: EstadoPasso) => {
    posse(await deps.marcarPasso(op.id, ml, token, i, estado));
    passos[i].estado = estado;
    if (estado === 'escrita_pedida') passos[i].tentativas = (passos[i].tentativas ?? 0) + 1;
    if (estado === 'escrita_pedida' || estado === 'volta_pedida') etapa = 'escrita_pedida';
  };
  const algumConfirmado = () => passos.some((p) => p.estado === 'confirmado');
  const baseConfirmado = () => passos.some((p) => p.tipo === 'base' && p.estado === 'confirmado');

  const lerBase = async (): Promise<Vivo> => {
    try {
      return vivoDe(await deps.ml.lerVivo(ml));
    } catch (e) {
      if (e instanceof SemAcessoStatusML) throw e;
      return FALHOU;
    }
  };
  /** Oferta e saída entram nas Tasks 10 e 11; até lá lançam antes de qualquer marca. */
  const operar = (p: Passo): { ler(): Promise<Vivo | FaixaPreco[] | null>; escrever(ida: boolean): ReturnType<ClienteReajusteML['putPreco']> } => {
    if (p.tipo === 'base') return { ler: lerBase, escrever: (ida) => deps.ml.putPreco(ml, ida ? p.alvo : p.anterior, composicao) };
    if (p.tipo === 'faixas') return { ler: () => deps.ml.lerFaixas(ml), escrever: (ida) => deps.ml.gravarFaixas(ml, ida ? p.alvo : p.anterior) };
    throw new Error(`passo ${p.tipo} ainda não é executado (ADR-0196)`);
  };

  const persistir = async () => {
    // Só faixas: `restaurar` vazio, preço e marca do operador intactos, nada a gravar nas variações.
    if (passos.length && !passos.some((p) => p.tipo === 'base')) return gravar({ status: 'aplicado', etapa: null, mensagem: null });
    const faltaram = passos.some((p) => p.tipo === 'faixas' && p.estado !== 'confirmado');
    // ok / ja_aplicado / conflito: a RPC já gravou o item. estado_invalido: o item saiu da reserva por outro
    // caminho enquanto a escrita estava no ML — inconsistência não recuperável aqui: relança para o retry/inspeção.
    const r = await deps.persistir(op.id, ml, token, item.preco, item.restaurar, faltaram ? MSG_FAIXAS_PENDENTES : null);
    if (r === 'sem_posse') throw new SemPosse();
    if (r === 'estado_invalido') throw new FalhaPosEscrita(new Error(`reajuste_persistir: estado inválido (${ml})`));
  };
  /** Só com todos os passos confirmados: faixa pendente vai por `persistir`, e a etapa segue `escrita_pedida` até lá. */
  const concluir = async () => {
    etapa = 'ml_confirmado';
    await gravar({ etapa });
    await persistir();
  };

  /** Desfaz em ordem inversa. Só com tudo reconciliado e o base provado no anterior: as faixas de volta não podem cruzar
   *  um base que desceu. Na dúvida, `conferindo`: nunca compensa sobre incerteza. */
  const compensar = async (status: 'mudou' | 'erro', mensagem: string) => {
    if (passos.some((p) => p.estado === 'confirmado' || p.estado === 'volta_pendente')) {
      if (decidirReajuste(null, item.preco, item.preco_anterior, await lerBase(), composicao).tipo !== 'escrever') return agendar();
      for (let i = passos.length - 1; i >= 0; i--) if (passos[i].estado === 'confirmado') await marcar(i, 'volta_pendente');
      for (let i = passos.length - 1; i >= 0; i--) {
        const p = passos[i];
        if (p.estado !== 'volta_pendente') continue;
        const acao = operar(p);
        let onde = reconciliarPasso(p, await acao.ler(), composicao);
        if (onde === 'alvo') {
          await marcar(i, 'volta_pedida');
          if ((await acao.escrever(false)).kind !== 'ok') return agendar();
          onde = reconciliarPasso(p, await acao.ler(), composicao);
        }
        if (onde !== 'anterior') return agendar();
        await marcar(i, 'compensado');
      }
    }
    return gravar({ status, etapa: null, mensagem });
  };

  // Retentável: fica `enviando` (como executar-status) — `pendente` seria reivindicado de novo no mesmo laço,
  // 3 PUTs seguidos num 429. `finalizar` vê o enviando e continua em 150 s ("enviando parado").
  const temTentativa = item.conferencias + 1 < TENTATIVAS_REAJUSTE;
  const retentar = (mensagem: string) =>
    gravar({ conferencias: item.conferencias + 1, mensagem, ...(algumConfirmado() ? {} : { etapa: null }) });
  /** Passo que não foi escrito. Base já confirmado não compensa: esgotadas as tentativas, conclui com o aviso. */
  const falhar = (mensagem: string, retentavel: boolean) => {
    if (baseConfirmado()) return temTentativa ? retentar(mensagem) : persistir();
    return retentavel && temTentativa ? retentar(mensagem) : compensar('erro', mensagem);
  };
  /** N escritas e o valor segue no `anterior`, provado por GET: o passo falha como não escrito. */
  const esgotou = (p: Passo) => (p.tentativas ?? 0) >= TENTATIVAS_REAJUSTE;
  const naoAplicado = () => (baseConfirmado() ? persistir() : compensar('erro', MSG_NAO_APLICADO));
  const reprovar = ({ status, mensagem, inconclusiva }: Reprovacao) => {
    // Dúvida com passo escrito espera, sem limite: esgotar tentativas não pode transformar incerteza em escrita.
    if (inconclusiva && algumConfirmado()) return agendar();
    if (status === 'retentar' || baseConfirmado()) return falhar(mensagem, true);
    return algumConfirmado() ? compensar('mudou', mensagem) : gravar({ status, etapa: null, mensagem });
  };

  /** Antes de cada escrita: o estado vivo, com os passos próprios aplicados, ainda comporta o que falta do plano? */
  const revalidarPasso = async (indice: number): Promise<Reprovacao | null> => {
    let atual: VivoItem;
    try {
      atual = await deps.ml.lerVivo(ml);
    } catch (e) {
      if (e instanceof SemAcessoStatusML) throw e;
      return { status: 'retentar', mensagem: mensagemDe(e), inconclusiva: true };
    }
    const [doML, banco, fatos, vivas] = await Promise.all([deps.ml.lerOfertas(ml), deps.ofertasBanco([ml]), deps.fatos(item), deps.ml.lerFaixas(ml)]);
    const ofertas = unirOfertas([doML, banco.get(ml) ?? null]);
    const motivo = motivoInelegivel({ vivo: atual, ofertas, ...fatos });
    if (motivo) return { status: 'bloqueado', mensagem: motivo, inconclusiva: ofertas === null };
    const baseAgora = baseConfirmado() ? item.preco : item.preco_anterior;
    const d = decidirReajuste(null, item.preco, baseAgora, vivoDe(atual), composicao);
    if (d.tipo === 'fim') return { status: d.status, mensagem: d.mensagem, inconclusiva: d.status === 'erro' };
    if (d.tipo !== 'escrever') throw new Error(`decisão inesperada no envio: ${d.tipo}`);

    if (vivas === null) return { status: 'bloqueado', mensagem: MSG_ATACADO_ILEGIVEL, inconclusiva: true };
    const passoFaixas = passos.find(ehFaixas);
    const esperadas = passoFaixas && (passoFaixas.estado === 'confirmado' ? passoFaixas.alvo : passoFaixas.anterior);
    if (esperadas && !mesmasFaixas(vivas, esperadas)) return { status: 'mudou', mensagem: op.origem_id ? MSG_ATACADO_MUDOU : MSG_FAIXAS_MUDARAM };
    if (op.origem_id && passoFaixas) {
      const config = await deps.configAtacado(item.variacao_ids);
      if (config.divergente || !mesmaConfig(config.faixas, passoFaixas.config)) return { status: 'mudou', mensagem: MSG_ATACADO_MUDOU };
    }
    const trava = motivoTravaOferta(item.preco, ofertas!);
    if (trava) return { status: 'mudou', mensagem: trava, inconclusiva: ofertas!.some((o) => o.preco === null) };
    const violada = estadosIntermediarios(baseAgora, ofertas!, vivas, passos).map(violacao).find(Boolean);
    if (violada) return { status: 'mudou', mensagem: violada };

    const frescas = await avaliarPassos(passos.slice(indice), (preco) => deps.avaliarFresco(ml, preco));
    const doPreview = item.avaliacoes.filter((a) => frescas.some((f) => f.tipo === a.tipo && f.chave === a.chave));
    if (mudouPrecos(doPreview, frescas)) return { status: 'mudou', mensagem: MSG_FINANCEIRO };
    const fresca = resumirPrecos(frescas);
    // Defesa C5 (o confirmar já exige): 🔴/⚪ sem a confirmação própria não escreve.
    if ((fresca.tem_vermelho && !item.confirmado_risco) || (fresca.tem_sem_dado && !item.confirmado_sem_dado)) {
      return { status: 'mudou', mensagem: MSG_SEM_CONFIRMACAO };
    }
    return null;
  };

  const avancar = async (): Promise<void> => {
    if (etapa === 'ml_confirmado') return persistir();
    // Sem plano não há o que conferir: nunca conclui. Só item em voo de antes do ADR-0196 chega aqui.
    if (!passos.length) return etapa ? agendar() : gravar({ status: 'mudou', mensagem: MSG_SEM_PASSOS });

    for (const [i, p] of passos.entries()) {
      if (p.estado !== 'escrita_pedida' && p.estado !== 'volta_pedida') continue;
      const lido = await operar(p).ler();
      const onde = reconciliarPasso(p, lido, composicao);
      if (onde === 'indefinido') {
        // Base em valor de terceiro e nada mais escrito: esperar não resolve, segue o `erro` de decidirReajuste.
        const d = p.tipo === 'base' ? decidirReajuste('escrita_pedida', p.alvo, p.anterior, lido as Vivo, composicao) : null;
        if (d?.tipo === 'fim' && d.status === 'erro' && !algumConfirmado()) return gravar({ status: 'erro', etapa: null, mensagem: d.mensagem });
        return agendar();
      }
      const estado = p.estado === 'escrita_pedida'
        ? (onde === 'alvo' ? 'confirmado' : 'pendente')
        : (onde === 'alvo' ? 'volta_pendente' : 'compensado');
      await marcar(i, estado);
      if (estado === 'pendente' && esgotou(p)) return naoAplicado();
    }
    if (passos.some((p) => p.estado === 'volta_pendente' || p.estado === 'compensado')) return compensar('mudou', MSG_COMPENSADO);
    // Provado que nada foi escrito: volta à fila com tentativas zeradas (conferencias acumulou agendamentos) e passa de
    // novo pelas barreiras do claim.
    if (etapa && passos.every((p) => p.estado === 'pendente')) return gravar({ status: 'pendente', etapa: null, mensagem: null, conferencias: 0 });

    for (const [i, p] of passos.entries()) {
      if (p.estado !== 'pendente') continue;
      const acao = operar(p);
      // Trava antes de toda escrita: um crash depois de marcar `pendente` chega aqui sem passar pela reconciliação.
      if (esgotou(p)) {
        const onde = reconciliarPasso(p, await acao.ler(), composicao);
        if (onde === 'anterior') return naoAplicado();
        if (onde === 'indefinido') return agendar();
        await marcar(i, 'confirmado');
        continue;
      }
      const reprovada = await revalidarPasso(i);
      if (reprovada) return reprovar(reprovada);

      await marcar(i, 'escrita_pedida');
      const r = await acao.escrever(true);
      if (r.kind === 'desconhecido') return agendar();
      if (r.kind === 'sem_escrita') {
        await marcar(i, 'pendente');
        return falhar(r.mensagem, r.status === 429);
      }
      const lido = await acao.ler();
      const onde = reconciliarPasso(p, lido, composicao);
      if (onde === 'alvo') {
        await marcar(i, 'confirmado');
        continue;
      }
      if (p.tipo === 'faixas' && onde === 'anterior') {
        await marcar(i, 'pendente');
        return esgotou(p) ? naoAplicado() : falhar(MSG_FAIXAS_NAO_APLICADAS, true);
      }
      // Base depois de um PUT 200, nada mais escrito: mesma regra da conferência, sem voltar_pendente aqui.
      const leuBase = p.tipo === 'base' && (lido as Vivo).kind === 'ok';
      return leuBase && !algumConfirmado() ? gravar({ status: 'erro', etapa: null, mensagem: MSG_NAO_APLICADO }) : agendar();
    }
    return concluir();
  };

  try {
    await avancar();
  } catch (e) {
    if (e instanceof SemPosse) return;
    if (e instanceof FalhaPosEscrita) throw e;
    if (e instanceof SemAcessoStatusML) {
      // Com escrita possível o item fica `conferindo` (reserva mantida). Gravar aqui, e não no laço, prova a posse antes do
      // fatal: sem ela o worker para, porque `encerrarSemEtapa` não olha token e mexeria no item do sucessor.
      try {
        await (etapa === null ? gravar({ status: 'erro', mensagem: MSG_RECONECTAR }) : agendar());
      } catch (erro) {
        if (erro instanceof SemPosse) return;
        throw new FalhaPosEscrita(erro);
      }
      throw Object.assign(e, { jaGravado: true });
    }
    if (etapa === null) throw e;
    throw new FalhaPosEscrita(e);
  }
}

export function executarReajuste(
  op: OperacaoReajusteRow, deps: DepsReajuste, opts: { limiteMs: number; lote: number; maxItens?: number },
): Promise<{ processados: number; continuou: boolean }> {
  // Reverter (origem_id) usa o mesmo fluxo: alvo e `restaurar` já vêm da origem, gravados no preview.
  // O laço é comum às ações e não conhece token: ele fica aqui, e até os caminhos de erro do laço gravam com posse.
  const tokens = new Map<string, string>();
  const doLaco: DepsLaco = {
    ...deps,
    async reivindicar(operacaoId, ml) {
      const token = await deps.reivindicar(operacaoId, ml);
      if (token) tokens.set(ml, token);
      return token !== null;
    },
    async gravarItem(operacaoId, ml, campos) { await deps.gravarItem(operacaoId, ml, tokens.get(ml)!, campos); },
  };
  return laco(op.id, doLaco, opts, (it) => processar(op, it.ml_item_id, tokens.get(it.ml_item_id)!, deps),
    { eh: (e) => e instanceof SemAcessoStatusML, mensagem: MSG_RECONECTAR, encerrar: (m) => deps.encerrarSemEtapa(op.id, m) });
}
