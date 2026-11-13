// Fiação real do tratamento de cancelamento (ADR-0121). Vive fora de `cancelamento.ts` de
// propósito: aquele módulo é testado por vitest (Node) e não pode arrastar `queue.ts`, que só
// existe no runtime Deno. Aqui só há ligação, nenhuma decisão.
import { enfileirarSaga, enfileirarSincronizacaoEstoque } from '../queue.ts';
import { estornarVendaCancelada, despacharPushPendente, houveBaixaDeVenda } from './baixa.ts';
import { claimDoPedido } from '../faturamento/devolucoes-io.ts';
import { reservarNotificacao } from '../faturamento/notificacoes-dedupe.ts';
import { registrarPendenciaKit } from '../faturamento/pendencias.ts';
import { classificarItensKit, gravarIdentidades } from '../kit-variacao/venda.ts';
import { notificarCategoria } from '../notificacoes/config.ts';
import { skusParticipantes } from '../kit-variacao/politica.ts';
import { avisarKitsEncerrados } from '../kit-variacao/encerrar.ts';
import { agendarCancelamentoKit, type DepsCancelamento } from './cancelamento.ts';

export const depsCancelamento: DepsCancelamento = {
  estornarVendaCancelada,
  despacharPushPendente,
  enfileirarSincronizacaoEstoque,
  houveBaixaDeVenda,
  claimDoPedido,
  reservarNotificacao,
  notificarCategoria,
  skusParticipantes,
  agendarCancelamentoKit: (admin, p) => agendarCancelamentoKit(admin, (id, orgId) => enfileirarSaga(id, orgId), p,
    () => avisarKitsEncerrados(admin, notificarCategoria, p.orgId)),
  classificarItensKit,
  gravarIdentidades,
  registrarPendenciaKit,
};
