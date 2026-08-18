// Fiação real do tratamento de cancelamento (ADR-0121). Vive fora de `cancelamento.ts` de
// propósito: aquele módulo é testado por vitest (Node) e não pode arrastar `queue.ts`, que só
// existe no runtime Deno. Aqui só há ligação, nenhuma decisão.
import { enfileirarSincronizacaoEstoque } from '../queue.ts';
import { estornarVendaCancelada, despacharPushPendente } from './baixa.ts';
import { reservarNotificacao } from '../faturamento/notificacoes-dedupe.ts';
import { notificarCategoria } from '../notificacoes/config.ts';
import type { DepsCancelamento } from './cancelamento.ts';

export const depsCancelamento: DepsCancelamento = {
  estornarVendaCancelada,
  despacharPushPendente,
  enfileirarSincronizacaoEstoque,
  reservarNotificacao,
  notificarCategoria,
};
