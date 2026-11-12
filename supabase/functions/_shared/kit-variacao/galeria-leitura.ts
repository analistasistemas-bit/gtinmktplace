// ADR-0200 (adendo 12/11): leitura, no ML, das fotos dos anúncios das peças do kit. Só GET, com o token da org.
// Nunca presume limpo: item não lido, fechado ou moderado tira a foto; leitura que falha recusa a galeria.
import { caminhoMultiget, comoEnvelopeAntigo } from '../ml/multiget.ts';
import { parseStatusML } from '../ml/status.ts';
import { montarGaleriaKit, type FotoPeca } from './galeria-pecas.ts';

const CAMPOS = 'id,status,sub_status,pictures';
const LOTE = 20;

export interface PecaOrigem { cor: string; itemId: string }
interface ItemLido { fotos: string[]; limpo: boolean; motivo: string | null }
type Leitura = { ok: true; itens: Map<string, ItemLido> } | { ok: false; erro: string };

/** Só `ativo`/`pausado` sem marcador de moderação serve de fonte de foto. */
function avaliar(body: { id: string; status?: string; sub_status?: string[] }): { limpo: boolean; motivo: string | null } {
  const s = parseStatusML({ id: body.id, status: body.status, sub_status: body.sub_status ?? [] }).status;
  return s === 'ativo' || s === 'pausado' ? { limpo: true, motivo: null } : { limpo: false, motivo: `${body.id} está ${s}` };
}

async function lerItens(token: string, ids: string[], f: typeof fetch): Promise<Leitura> {
  const unicos = [...new Set(ids)];
  const itens = new Map<string, ItemLido>();
  try {
    for (let i = 0; i < unicos.length; i += LOTE) {
      const bloco = unicos.slice(i, i + LOTE);
      const resp = await f(`https://api.mercadolibre.com${caminhoMultiget(bloco, CAMPOS)}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) return { ok: false, erro: `ML /items/bulk ${resp.status}` };
      const lista = comoEnvelopeAntigo(await resp.json(), bloco);
      if (!Array.isArray(lista)) return { ok: false, erro: 'ML /items/bulk: resposta inesperada' };
      for (const e of lista as Array<{ code?: number; body?: { id?: string; status?: string; sub_status?: string[]; pictures?: Array<{ id?: unknown }> } }>) {
        const b = e?.body;
        if (e?.code !== 200 || !b?.id) continue;   // item não lido: fica fora do mapa
        const { limpo, motivo } = avaliar({ id: b.id, status: b.status, sub_status: b.sub_status });
        itens.set(b.id, {
          limpo, motivo,
          fotos: (b.pictures ?? []).map((p) => p?.id).filter((p): p is string => typeof p === 'string' && p !== ''),
        });
      }
    }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, itens };
}

/** `settings.max_pictures_per_item` da categoria (público). Ilegível → null: quem chama não cria galeria. */
export async function lerLimiteFotos(categoriaId: string, f: typeof fetch = fetch): Promise<number | null> {
  try {
    const r = await f(`https://api.mercadolibre.com/categories/${encodeURIComponent(categoriaId)}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const n = (await r.json() as { settings?: { max_pictures_per_item?: unknown } }).settings?.max_pictures_per_item;
    return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Proposta de galeria de uma combinação: uma peça por cor, na ordem das cores do rótulo. Cor cuja peça não pôde ser
 * lida limpa sai da galeria com aviso (mantém a vez das outras); leitura que falha por inteiro vira `indisponivel`.
 */
export async function galeriaDasPecas(
  token: string, pecas: PecaOrigem[], limite: number, f: typeof fetch = fetch,
): Promise<{ fotos: FotoPeca[]; avisos: string[]; indisponivel: boolean }> {
  const lida = await lerItens(token, pecas.map((p) => p.itemId), f);
  if (!lida.ok) return { fotos: [], avisos: [`Fotos das peças indisponíveis (${lida.erro}).`], indisponivel: true };
  const avisos: string[] = [];
  const cores = pecas.map((p) => {
    const it = lida.itens.get(p.itemId);
    if (!it) { avisos.push(`${p.cor}: anúncio da peça não lido no Mercado Livre.`); return { cor: p.cor, fotos: [] }; }
    if (!it.limpo) { avisos.push(`${p.cor}: ${it.motivo}.`); return { cor: p.cor, fotos: [] }; }
    return { cor: p.cor, fotos: it.fotos.map((id) => ({ id, item: p.itemId })) };
  });
  return { fotos: montarGaleriaKit({ cores, limite }), avisos, indisponivel: false };
}

/**
 * Worker, antes do CREATE: só fica o id ainda presente em `pictures` de item limpo. Qualquer falha de leitura devolve
 * lista vazia e o motivo (o CREATE sai só com a foto do kit).
 */
export async function revalidarGaleria(
  token: string, fotos: FotoPeca[], f: typeof fetch = fetch,
): Promise<{ fotos: FotoPeca[]; motivo: string | null }> {
  if (fotos.length === 0) return { fotos: [], motivo: null };
  const lida = await lerItens(token, fotos.map((x) => x.item), f);
  if (!lida.ok) return { fotos: [], motivo: `Galeria das peças não conferida (${lida.erro}).` };
  const motivos = new Set<string>();
  const ficam = fotos.filter((x) => {
    const it = lida.itens.get(x.item);
    if (!it) { motivos.add(`${x.item} não lido`); return false; }
    if (!it.limpo) { motivos.add(it.motivo ?? x.item); return false; }
    if (!it.fotos.includes(x.id)) { motivos.add(`${x.item} sem a foto ${x.id}`); return false; }
    return true;
  });
  return { fotos: ficam, motivo: motivos.size > 0 ? [...motivos].join('; ') : null };
}
