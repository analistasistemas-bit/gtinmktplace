// ADR-0174 emenda 2026-10-04 — leitura FRESCA do status de UM anúncio para pausar/reativar. Não usa
// conn.lerStatus: ele engole 401/403 como "indisponivel" e o operador não saberia que precisa reconectar.
import type { StatusAnuncioCanal } from '../canais/contrato.ts';
import { caminhoMultiget, comoEnvelopeAntigo } from '../ml/multiget.ts';
import { parseStatusML, type ItemMLStatus } from '../ml/status.ts';

export class SemAcessoStatusML extends Error {}

type Entrada = { code?: number; body?: ItemMLStatus } | undefined;

async function lerEntrada(token: string, itemId: string, f: typeof fetch): Promise<Entrada> {
  const r = await f(`https://api.mercadolibre.com${caminhoMultiget([itemId], 'id,status,sub_status')}`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401 || r.status === 403) throw new SemAcessoStatusML(`ML ${r.status} ao ler o anúncio`);
  if (!r.ok) throw new Error(`ML ${r.status} ao ler o anúncio ${itemId}`);
  // Um id só → a única entrada. O código vem do ENVELOPE: o bulk responde HTTP 200 com
  // `[{status_code: 403}]` sem body, e procurar por body.id descartaria o 403 em silêncio.
  const lote = comoEnvelopeAntigo(await r.json(), [itemId]);
  const x = (Array.isArray(lote) ? lote[0] : undefined) as Entrada;
  if (x?.code === 401 || x?.code === 403) throw new SemAcessoStatusML(`ML ${x.code} ao ler o anúncio`);
  return x;
}

export async function lerStatusML(token: string, itemId: string, f: typeof fetch = fetch): Promise<StatusAnuncioCanal | null> {
  const x = await lerEntrada(token, itemId, f);
  return x?.code === 200 && x.body?.id === itemId ? parseStatusML(x.body).status : null;
}

/**
 * ADR-0199: variante só para kit com variação, que trata a leitura como confirmação de resultado. Só 404 é
 * ausência confirmada (null); envelope com outro código, resposta incompleta ou id divergente lança.
 */
export async function lerStatusMLEstrito(token: string, itemId: string, f: typeof fetch = fetch): Promise<StatusAnuncioCanal | null> {
  const x = await lerEntrada(token, itemId, f);
  if (x?.code === 404) return null;
  if (x?.code === 200 && x.body?.id === itemId) return parseStatusML(x.body).status;
  throw new Error(`ML: leitura inconclusiva do anúncio ${itemId} (código ${x?.code ?? 'ausente'})`);
}
