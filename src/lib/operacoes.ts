// ADR-0174 — operações em massa (aderir/sair de promoções DEAL/SMART do ML, pausar/reativar e reajustar preço — I5): regras puras do front.
import { calcularSemaforo, type Semaforo } from '@/lib/semaforo';
import { ateQuantoDaLinha, ehTipoOperavel, mlbExibido, PRECO_MIN_PROMOCAO, rotuloMlb, type TipoPromocaoOperavel, type CorProjetada, type ItemPromocao } from '@/lib/promocoes';
import type { PublicadoItem } from '@/lib/publicados';

/** `alterar_preco` (emenda 2026-11-03): PUT do deal_price de item DEAL já participando. */
export type AcaoPromocao = 'aderir' | 'sair' | 'alterar_preco';
export { ehTipoOperavel, type TipoPromocaoOperavel };
export type AcaoStatus = 'pausar' | 'reativar';
export type AcaoOperacao = AcaoPromocao | AcaoStatus | 'reajustar';
export const ehAcaoStatus = (a: string): a is AcaoStatus => a === 'pausar' || a === 'reativar';
export type StatusItemOperacao =
  | 'rascunho' | 'pendente' | 'enviando' | 'conferindo'
  | 'aplicado' | 'ja_estava' | 'mudou' | 'bloqueado' | 'erro' | 'saida_solicitada';

export interface LinhaPreview {
  ml_item_id: string; titulo: string | null; preco: number | null; min: number | null; max: number | null;
  sugerido: number | null; ateQuanto: number | null; semaforo: Semaforo; marcado: boolean;
  /** MLB exibido (o normal no par normal/catálogo); o pedido segue por `ml_item_id`. */
  rotulo?: string;
  mlb?: string;
  /** Reserva de estoque da Relâmpago (stock.min da leitura do ML). */
  estoqueMin: number | null;
}

const PESO: Record<Semaforo, number> = { indisponivel: 0, verde: 1, amarelo: 2, vermelho: 3 };
const piorSemaforo = (cores: Semaforo[]) => cores.reduce<Semaforo>((pior, s) => (PESO[s] > PESO[pior] ? s : pior), 'indisponivel');

/** "18,50" ou "18.5" → 18.5; vazio/inválido → null. */
export function parsePreco(txt: string): number | null {
  const t = txt.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Mesma fórmula de `_shared/preco/liquido.ts#liquidoClassico`, amarrada por teste de paridade com
 *  `_shared/operacoes/validar.ts#semaforoNoPreco`. */
function liquidoNoPreco(preco: number, pct: number, fixa: number, frete: number, aliquotaPct: number): number {
  return preco - (preco * pct / 100 + fixa) - frete - preco * aliquotaPct / 100;
}

/** Semáforo no preço com a tarifa gravada na projeção (paridade com o backend). */
export function semaforoNoPreco(projecao: CorProjetada[], preco: number | null): Semaforo {
  if (preco == null) return 'indisponivel';
  if (projecao.some((c) => c.motivo?.startsWith('kit_'))) return 'indisponivel'; // espelha semaforoDaLinha do backend
  return piorSemaforo(projecao.map((c) => {
    if (c.comissao_pct == null || c.frete == null || c.aliquota_pct == null || c.custo == null) return 'indisponivel';
    const liquido = liquidoNoPreco(preco, c.comissao_pct, c.comissao_fixa ?? 0, c.frete, c.aliquota_pct);
    return calcularSemaforo(liquido, c.piso ?? c.custo, c.custo);
  }));
}

/** Avaliado no piso: `preco_avaliado`, salvo no convite de outro horário da Relâmpago, em que ele é o preço
 *  participando — aí o piso sai da faixa do convite (R$ 19 ou o mínimo, se couber). */
function pisoAvaliado(it: ItemPromocao): number | null {
  if (!it.convite_aberto) return it.preco_avaliado;
  const p = Math.max(PRECO_MIN_PROMOCAO, it.preco_min ?? 0);
  return it.preco_max != null && p <= it.preco_max ? p : it.preco_sugerido;
}

/** Preview do pedido: aderir usa o preço sugerido (DEAL) ou o preço da oferta (SMART) e só marca o verde;
 *  sair usa o preço no ar e marca tudo — o cálculo do front é só orientação, o backend revalida.
 *  `simulados` (emenda 2026-11-03): preço escolhido na simulação — os itens chegam com a projeção do servidor
 *  naquele preço; com simulação ativa, item não simulado vem desmarcado (nunca adesão com outro preço às cegas). */
export function montarPreview(acao: AcaoPromocao, tipo: TipoPromocaoOperavel, itens: ItemPromocao[], simulados?: Map<string, number>): LinhaPreview[] {
  // Achado Codex (diff): mapa vazio (todos ignorados) ainda é simulação ativa — nada sai marcado no sugerido.
  const comSimulacao = (acao === 'aderir' || acao === 'alterar_preco') && simulados != null;
  return itens.map((it) => {
    // Alterar: parte do preço vigente da oferta; aderir: sugerido (DEAL/Relâmpago) ou o da oferta (SMART, SMART_LIGHTNING, PRICE_MATCHING).
    const padrao = acao === 'sair' ? it.preco_promo
      : acao === 'alterar_preco' ? it.preco_promo ?? it.preco_avaliado
      : tipo === 'DEAL' || tipo === 'LIGHTNING'
        // Sugerido abaixo do piso: o servidor já avaliou no menor preço permitido (R$ 19 ou o mínimo da faixa).
        ? ((it.preco_sugerido ?? it.preco_promo ?? PRECO_MIN_PROMOCAO) < PRECO_MIN_PROMOCAO ? pisoAvaliado(it) : it.preco_sugerido)
        : it.preco_promo;
    const preco = comSimulacao ? simulados.get(it.ml_item_id) ?? padrao : padrao;
    const semaforo = semaforoNoPreco(it.projecao, preco);
    return {
      ml_item_id: it.ml_item_id, rotulo: rotuloMlb(it), mlb: mlbExibido(it), titulo: it.titulo, preco, estoqueMin: it.estoque_min, min: it.preco_min, max: it.preco_max,
      sugerido: it.preco_sugerido, ateQuanto: ateQuantoDaLinha(it).valor, semaforo,
      // Sair e alterar: o operador escolheu os itens (o risco é confirmado à parte); aderir: só o verde.
      marcado: acao === 'sair' ? true
        : acao === 'alterar_preco' ? !comSimulacao || simulados.has(it.ml_item_id)
        : semaforo === 'verde' && (!comSimulacao || simulados.has(it.ml_item_id)),
    };
  });
}

/** Quantas linhas marcadas exigem o checkbox de risco confirmado (trava financeira do backend).
 *  Fix round 1 (achado 1): `sair` nunca exige — `validar.ts` não olha semáforo na saída (não cria
 *  prejuízo), então o checkbox de risco é só do `aderir`. */
export function precisaConfirmarRisco(acao: AcaoPromocao, linhas: LinhaPreview[]): { vermelho: number; indisponivel: number } {
  if (acao === 'sair') return { vermelho: 0, indisponivel: 0 };
  const marcadas = linhas.filter((l) => l.marcado);
  return {
    vermelho: marcadas.filter((l) => l.semaforo === 'vermelho').length,
    indisponivel: marcadas.filter((l) => l.semaforo === 'indisponivel').length,
  };
}

export const ROTULO_STATUS: Record<StatusItemOperacao, string> = {
  rascunho: 'Rascunho', pendente: 'Na fila', enviando: 'Enviando', conferindo: 'Conferindo no ML', aplicado: 'Feito', ja_estava: 'Já estava',
  mudou: 'Mudou desde o preview', bloqueado: 'Bloqueado', erro: 'Erro', saida_solicitada: 'Saída pedida',
};

// Overloads por família: o tipo de retorno é a família, não a mesma ação (inversa('pausar') é 'reativar').
export function inversa(a: AcaoPromocao): AcaoPromocao;
export function inversa(a: AcaoStatus): AcaoStatus;
/** Reverter de reajuste é outro reajuste (com `origem_id`), não uma ação oposta. */
export function inversa(a: 'reajustar'): 'reajustar';
export function inversa(a: AcaoOperacao): AcaoOperacao;
export function inversa(a: AcaoOperacao): AcaoOperacao {
  switch (a) {
    case 'aderir': return 'sair';
    case 'sair': return 'aderir';
    case 'alterar_preco': return 'alterar_preco'; // reverte com outra alteração, de volta ao preço anterior
    case 'pausar': return 'reativar';
    case 'reativar': return 'pausar';
    case 'reajustar': return 'reajustar';
  }
}

/** Ajuste 4: só `aderir` reverte também o que já estava participando; o resto só o que NÓS mudamos (`aplicado`). */
export function itensRevertiveis(acao: AcaoOperacao, itens: { ml_item_id: string; status: StatusItemOperacao }[]): string[] {
  const aceitos: StatusItemOperacao[] = acao === 'aderir' ? ['aplicado', 'ja_estava'] : ['aplicado'];
  return itens.filter((i) => aceitos.includes(i.status)).map((i) => i.ml_item_id);
}

export function tituloOperacao(
  op: { acao: string; promocao_nome: string | null; promocao_id: string | null; origem_id?: string | null }, total: number,
): string {
  const anuncios = `${total} anúncio${total === 1 ? '' : 's'}`;
  if (op.acao === 'reajustar') return op.origem_id ? `Reverter reajuste de ${anuncios}` : `Alterar preço de ${anuncios}`;
  if (ehAcaoStatus(op.acao)) return `${op.acao === 'pausar' ? 'Pausar' : 'Reativar'} ${anuncios}`;
  const nome = op.promocao_nome ?? op.promocao_id ?? '';
  if (op.acao === 'alterar_preco') return `${op.origem_id ? 'Reverter preço' : 'Alterar preço'} em ${nome}`;
  return `${op.acao === 'aderir' ? 'Aderir à' : 'Sair de'} ${nome}`;
}

const PARADO_MS = 2 * 60_000; // mesmo limite de `enviando` parado na RPC reajuste_reivindicar
const EM_ANDAMENTO = ['pendente', 'enviando', 'conferindo'];
/** Retomar (C3): reajuste executando com item `conferindo` vencido ou `enviando` parado há mais de 2 min — sinal de
 *  que a mensagem QStash esgotou os retries. ponytail: a folga de 2 min no `conferindo` evita o botão piscar no
 *  intervalo normal entre `proxima_conferencia` e a entrega da mensagem agendada.
 *  Também com edição de atacado sem desfecho e nenhum item em andamento: a família fica reservada até alguém concluir.
 *  A entrada segue `pendente` durante toda a execução normal, daí exigir os itens encerrados há mais de 2 min. */
export function precisaRetomar(
  op: { acao: string; status: string; atacado_familias?: unknown },
  itens: { status: string; proxima_conferencia: string | null; atualizado_em: string }[], agora: number,
): boolean {
  if (op.acao !== 'reajustar' || (op.status !== 'executando' && op.status !== 'concluida')) return false;
  const antes = (iso: string | null) => iso != null && Date.parse(iso) < agora - PARADO_MS;
  const familiaPresa = Array.isArray(op.atacado_familias) && op.atacado_familias.some((e: { status?: string }) => e?.status === 'pendente')
    && itens.every((i) => !EM_ANDAMENTO.includes(i.status) && antes(i.atualizado_em));
  if (op.status === 'concluida') return familiaPresa;
  return familiaPresa || itens.some((i) => (i.status === 'conferindo' && antes(i.proxima_conferencia)) || (i.status === 'enviando' && antes(i.atualizado_em)));
}

/** N do título: reajuste conta só o que entrou (`incluido`) — fora, sem alteração e desmarcado no preview não. */
export function totalDoTitulo(op: { acao: string; itens: { incluido?: boolean }[] }): number {
  return op.acao === 'reajustar' ? op.itens.filter((i) => i.incluido !== false).length : op.itens.length;
}

export function motivoNaoSelecionavel(
  i: Pick<PublicadoItem, 'ehKitVirtual' | 'publicacaoIncompleta' | 'migracaoEmAndamento' | 'status'>,
): string | null {
  if (i.ehKitVirtual) return 'Kit Virtual não entra em pausar/reativar em massa';
  if (i.publicacaoIncompleta) return 'Publicação incompleta';
  if (i.migracaoEmAndamento) return 'Migração para preço por variação em andamento';
  if (i.status !== 'ativo' && i.status !== 'pausado') return 'Só anúncio ativo ou pausado';
  return null;
}

export function separarSelecao(itens: Pick<PublicadoItem, 'mlItemId' | 'status'>[]) {
  return {
    ativos: itens.filter((i) => i.status === 'ativo').map((i) => i.mlItemId),
    pausados: itens.filter((i) => i.status === 'pausado').map((i) => i.mlItemId),
  };
}
