// Badge "atualizando no ML…" nas cores que acabaram de receber entrada, até o canal confirmar.
//
// Pedido do Diego (2026-09-03): ele deu entrada em três cores, olhou o anúncio e não viu nada —
// o push levou 11 s e a vitrine do ML mais alguns minutos para reindexar. Sem sinal na tela, o
// único jeito de saber era abrir o ML e ficar recarregando.
//
// A confirmação NÃO é "o push foi enfileirado" (isso não prova nada, ver
// `reference_estoque_push_ml`): é o estoque VIVO do anúncio, lido por `status-publicados`,
// batendo com o saldo do app.

/** `aguardando` = push em voo; `ok` = o canal já devolve o mesmo saldo (some logo depois). */
export type EstadoSyncMl = 'aguardando' | 'ok';

export interface MarcadorSyncMl {
  /** SKU → estado. Só entram os SKUs da última submissão de entrada deste produto. */
  porSku: Record<string, EstadoSyncMl>;
  /** ISO de quando a submissão aconteceu — base do teto de espera. */
  desde: string;
}

/**
 * Teto de espera. Passado disso a badge some mesmo sem confirmação: em anúncio Legacy (um item,
 * N variações) o ML devolve a SOMA do item, então uma divergência antiga em OUTRA cor faria a
 * conta nunca fechar e a badge ficaria acesa para sempre — mentindo que ainda está atualizando.
 */
export const TETO_ESPERA_MS = 10 * 60_000;

export interface VariacaoSync {
  codigo: string;
  estoque: number;
  /** Anúncio que vende este SKU. Em User Products é 1:1; em Legacy N cores dividem o mesmo id. */
  mlItemId: string | null;
}

/**
 * Quais SKUs aguardando já batem com o canal.
 *
 * Agrupa por anúncio porque é essa a granularidade do dado: `status-publicados` devolve o
 * `available_quantity` do ITEM. Em User Products cada cor tem seu item e a comparação é exata;
 * em Legacy compara a soma das cores daquele item — que é o número que o ML realmente expõe.
 * Item sem estoque conhecido (`null`, canal sem credencial ou leitura falha) nunca confirma:
 * dizer "✓ no ML" sem ter lido o ML seria pior que não dizer nada.
 */
export function skusConfirmadosNoMl(
  aguardando: string[],
  variacoes: VariacaoSync[],
  estoquePorItem: Map<string, number | null>,
): string[] {
  const aguardandoSet = new Set(aguardando);
  const porItem = new Map<string, { esperado: number; skus: string[] }>();
  for (const v of variacoes) {
    if (!v.mlItemId) continue;
    const entrada = porItem.get(v.mlItemId) ?? { esperado: 0, skus: [] };
    entrada.esperado += v.estoque;
    if (aguardandoSet.has(v.codigo)) entrada.skus.push(v.codigo);
    porItem.set(v.mlItemId, entrada);
  }
  const confirmados: string[] = [];
  for (const [itemId, { esperado, skus }] of porItem) {
    if (skus.length === 0) continue;
    const vivo = estoquePorItem.get(itemId);
    if (vivo != null && vivo === esperado) confirmados.push(...skus);
  }
  return confirmados;
}

/** Marcador com os SKUs confirmados promovidos a `ok`. Devolve o MESMO objeto quando nada mudou —
 *  o card compara por referência para não re-renderizar (nem reagendar timers) à toa. */
export function promoverConfirmados(marcador: MarcadorSyncMl, confirmados: string[]): MarcadorSyncMl {
  const novos = confirmados.filter((sku) => marcador.porSku[sku] === 'aguardando');
  if (novos.length === 0) return marcador;
  const porSku = { ...marcador.porSku };
  for (const sku of novos) porSku[sku] = 'ok';
  return { ...marcador, porSku };
}

/** Passou do teto de espera? Nesse caso o card descarta o marcador inteiro. */
export function esperaEsgotada(marcador: MarcadorSyncMl, agora: Date = new Date()): boolean {
  return agora.getTime() - Date.parse(marcador.desde) > TETO_ESPERA_MS;
}

/** Ainda há push em voo? É o que liga o poll do status vivo — sem isso a tela não descobre
 *  sozinha que o ML já convergiu. */
export function temSkuAguardando(marcador: MarcadorSyncMl | undefined): boolean {
  return !!marcador && Object.values(marcador.porSku).some((e) => e === 'aguardando');
}
