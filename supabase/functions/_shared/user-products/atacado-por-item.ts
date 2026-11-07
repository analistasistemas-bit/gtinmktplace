// ADR-0196 — atacado por item: o PxQ é por ITEM e o valor é absoluto (ADR-0041), logo a base é o preço do próprio item.
import type { ChannelConnector, ContextoCanal, FaixaAtacado } from '../canais/contrato.ts';
import { montarFaixasPxQ } from '../ml/atacado.ts';
import { faixasValidas } from '../operacoes/reajuste/faixas.ts';

export interface ItemAtacado { id: string; preco: number | null }

/** Confere o valor que vai no payload, já arredondado por quem o monta. */
function enviadasValidas(preco: number, faixas: FaixaAtacado[]): boolean {
  try {
    return faixasValidas(preco, montarFaixasPxQ(preco, faixas).map((p) => ({ min_unidades: p.conditions.min_purchase_unit!, preco: p.amount })));
  } catch {
    return false; // desconto ilegível: `centavos` lança
  }
}

function motivoRecusa(itens: ItemAtacado[], faixas: FaixaAtacado[]): string | null {
  if (!faixas.length) return null;
  for (const { id, preco } of itens) {
    if (preco === null) return 'Atacado sem preço-base: sem preço novo nem preço vivo conhecido';
    if (!enviadasValidas(preco, faixas)) {
      return `Atacado não aplicado: no anúncio ${id} (R$ ${preco}) uma faixa ficaria inválida, igual ou acima do preço. Ajuste os descontos do atacado.`;
    }
  }
  return null;
}

/** Devolve a mensagem de erro, ou null. Recusa antes de enviar a qualquer item; faixas vazias limpam e dispensam preço. */
export async function aplicarAtacadoPorItem(
  conn: Pick<ChannelConnector, 'aplicarAtacado'>, ctx: ContextoCanal, itens: ItemAtacado[], faixas: FaixaAtacado[],
): Promise<string | null> {
  const recusa = motivoRecusa(itens, faixas);
  if (recusa) return recusa;
  let ok = true;
  for (const { id, preco } of itens) {
    try { await conn.aplicarAtacado(ctx, id, preco ?? 0, faixas); }
    catch (e) { ok = false; console.error(`atacado falhou (${id}):`, e); }
  }
  return ok ? null : 'Falha ao aplicar atacado em uma ou mais cores';
}
