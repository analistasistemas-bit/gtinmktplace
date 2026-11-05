// ADR-0195: saldo vivo de itens para a conferência pós-escrita. Diferente de `lerStatus`, não engole
// falha: item não lido vira 'erro', porque aqui saldo desconhecido nunca pode parecer saldo zero.
import { caminhoMultiget, comoEnvelopeAntigo } from './multiget.ts';

const API = 'https://api.mercadolibre.com';

export interface EstoqueItem { total: number; porVariacao: Record<string, number> }

interface EntradaBulk {
  code?: number;
  body?: { id?: string; available_quantity?: number; variations?: Array<{ id: string | number; available_quantity: number }> };
}

export async function lerEstoqueItens(token: string, ids: string[]): Promise<Record<string, EstoqueItem | 'erro'>> {
  const out: Record<string, EstoqueItem | 'erro'> = Object.fromEntries(ids.map((id) => [id, 'erro']));
  const blocos: string[][] = [];
  for (let i = 0; i < ids.length; i += 20) blocos.push(ids.slice(i, i + 20));
  await Promise.all(blocos.map(async (bloco) => {
    try {
      const resp = await fetch(`${API}${caminhoMultiget(bloco, 'id,available_quantity,variations')}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) { console.warn(`lerEstoqueItens ML ${resp.status} (bloco)`); return; }
      const entradas = comoEnvelopeAntigo(await resp.json(), bloco);
      if (!Array.isArray(entradas)) return;
      for (const { code, body } of entradas as EntradaBulk[]) {
        if (code !== 200 || !body?.id || typeof body.available_quantity !== 'number') continue;
        // O bulk não garante seller_custom_field: a variação casa pelo id gravado no envio.
        out[body.id] = {
          total: body.available_quantity,
          porVariacao: Object.fromEntries((body.variations ?? []).map((v) => [String(v.id), v.available_quantity])),
        };
      }
    } catch (e) {
      console.warn('lerEstoqueItens ML falhou (bloco):', (e as Error).message);
    }
  }));
  return out;
}
