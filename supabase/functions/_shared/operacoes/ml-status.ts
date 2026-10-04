// ADR-0174 emenda 2026-10-04 — leitura FRESCA do status de UM anúncio para pausar/reativar. Não usa
// conn.lerStatus: ele engole 401/403 como "indisponivel" e o operador não saberia que precisa reconectar.
import type { StatusAnuncioCanal } from '../canais/contrato.ts';
import { caminhoMultiget, comoEnvelopeAntigo } from '../ml/multiget.ts';
import { parseStatusML, type ItemMLStatus } from '../ml/status.ts';

export class SemAcessoStatusML extends Error {}

export async function lerStatusML(token: string, itemId: string, f: typeof fetch = fetch): Promise<StatusAnuncioCanal | null> {
  const r = await f(`https://api.mercadolibre.com${caminhoMultiget([itemId], 'id,status,sub_status')}`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401 || r.status === 403) throw new SemAcessoStatusML(`ML ${r.status} ao ler o anúncio`);
  if (!r.ok) throw new Error(`ML ${r.status} ao ler o anúncio ${itemId}`);
  // Um id só → a única entrada. O código vem do ENVELOPE: o bulk responde HTTP 200 com
  // `[{status_code: 403}]` sem body, e procurar por body.id descartaria o 403 em silêncio.
  const lote = comoEnvelopeAntigo(await r.json(), [itemId]);
  const x = (Array.isArray(lote) ? lote[0] : undefined) as { code?: number; body?: ItemMLStatus } | undefined;
  if (x?.code === 401 || x?.code === 403) throw new SemAcessoStatusML(`ML ${x.code} ao ler o anúncio`);
  return x?.code === 200 && x.body?.id === itemId ? parseStatusML(x.body).status : null;
}
