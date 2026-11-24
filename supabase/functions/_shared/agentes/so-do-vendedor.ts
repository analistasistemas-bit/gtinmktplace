// Acesso de agentes (ADR-0210, emenda 2): o agente só recebe anúncio da conta ML da conexão. O ML recusa item de
// terceiro hoje (medido, sem contrato); vínculo velho de uma conta trocada não pode depender disso.
import type { GetJson } from '../promocoes/ml.ts';

const BULK = /^(\/items\/bulk\?ids=[^&]*&attributes=status_code,)/;
const obj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * `get` que pede `seller_id` no `/items/bulk` e troca por `{status_code: 403}`, na mesma posição, todo envelope com
 * corpo que não seja da `conta` (vendedor ausente também). Outro caminho é recusado: nada é lido sem conferir.
 */
export function soDoVendedor(get: GetJson, conta: string): GetJson {
  const daConta = (b: unknown) =>
    obj(b) && (Number.isSafeInteger(b.seller_id) || typeof b.seller_id === 'string') && String(b.seller_id) === conta;
  return async (path) => {
    if (!BULK.test(path)) throw new Error('agentes.leitura_sem_vendedor');
    const json = await get(path.replace(BULK, '$1body.seller_id,'));
    if (!Array.isArray(json)) return []; // formato inesperado: nada é entregue sem conferir
    let quantidade = 0;
    const out = json.map((e) => {
      if (!obj(e) || e.body == null || daConta(e.body)) return e;
      quantidade++;
      return { status_code: 403 };
    });
    if (quantidade) console.warn('[agentes] anúncio fora da conta descartado', { quantidade });
    return out;
  };
}
