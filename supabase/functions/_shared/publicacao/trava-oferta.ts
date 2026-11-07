// Trava da oferta no UPDATE (emenda do ADR-0196 ao item 9 do ADR-0174): baixar o preço base até uma oferta vigente ou
// agendada a tira do anúncio, e restaurar o base não a traz de volta. O UPDATE herda o preço no ar (ADR-0016, adendo
// 2026-10-16), então só preço editado para baixo cria o risco, e isso se decide antes de enfileirar.
// Limite aceito: oferta nova, ou preço editado inline, entre o clique e o worker não é detectado.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { pool } from '../concorrencia/pool.ts';
import { caminhoMultiget, comoEnvelopeAntigo } from '../ml/multiget.ts';
import { centavos } from '../operacoes/reajuste/alvo.ts';
import { ofertasBanco } from '../operacoes/reajuste/deps.ts';
import { MSG_INCONCLUSIVA, motivoTravaOferta } from '../operacoes/reajuste/elegibilidade.ts';
import { criarClienteReajusteML } from '../operacoes/reajuste/ml.ts';
import { unirOfertas } from '../operacoes/reajuste/ofertas.ts';
import type { OfertaVigente } from '../operacoes/reajuste/tipos.ts';

const API = 'https://api.mercadolibre.com';
const TIMEOUT_LEITURA_MS = 10_000;
const ORCAMENTO_MS = 20_000;
const PARALELO = 5;
const BLOCO_MULTIGET = 20;

export interface AlvoFamilia { familia_id: string; itens: { ml_item_id: string; preco: number }[] }
export interface DepsTravaOferta {
  /** null = sem preço conferido (sem resposta, 404 ou anúncio encerrado). */
  precosVivos(ids: string[]): Promise<Map<string, number | null>>;
  lerOfertas(id: string): Promise<OfertaVigente[] | null>;
  ofertasBanco(ids: string[]): Promise<Map<string, OfertaVigente[]>>;
}

/** Nunca lança por item. O que não foi conferido dentro do orçamento recusa como inconclusivo. */
export async function recusasPorOferta(
  alvos: AlvoFamilia[], deps: DepsTravaOferta, orcamentoMs = ORCAMENTO_MS,
): Promise<{ familia_id: string; motivo: string }[]> {
  const itens = alvos.flatMap((a) => a.itens);
  if (!itens.length) return [];
  const limite = Date.now() + orcamentoMs;
  /** null em exceção, em timeout e com o orçamento vencido, sem iniciar a leitura. */
  const comPrazo = async <T>(ler: () => Promise<T>, tetoMs = Infinity): Promise<T | null> => {
    const ms = Math.min(tetoMs, limite - Date.now());
    if (ms <= 0) return null;
    let t: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([ler(), new Promise<null>((ok) => { t = setTimeout(() => ok(null), ms); })]);
    } catch (e) {
      console.error('trava de oferta: leitura falhou:', e);
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  // Os blocos do multiget já têm timeout próprio: aqui só o orçamento limita.
  const vivos = await comPrazo(() => deps.precosVivos([...new Set(itens.map((i) => i.ml_item_id))]));
  const vivo = (id: string) => vivos?.get(id) ?? null;
  const desce = (i: AlvoFamilia['itens'][number]) => {
    const v = vivo(i.ml_item_id);
    return v !== null && centavos(i.preco) < centavos(v);
  };

  const descendo = [...new Set(itens.filter(desce).map((i) => i.ml_item_id))];
  const banco = descendo.length ? await comPrazo(() => deps.ofertasBanco(descendo)) : null;
  const ofertas = new Map<string, OfertaVigente[] | null>();
  await pool(PARALELO, descendo, async (id) => {
    ofertas.set(id, unirOfertas([await comPrazo(() => deps.lerOfertas(id), TIMEOUT_LEITURA_MS), banco?.get(id) ?? null]));
  });

  const motivoDo = (i: AlvoFamilia['itens'][number]): string | null => {
    if (vivo(i.ml_item_id) === null) return MSG_INCONCLUSIVA;
    if (!desce(i)) return null;
    const unidas = ofertas.get(i.ml_item_id) ?? null;
    return unidas === null ? MSG_INCONCLUSIVA : motivoTravaOferta(i.preco, unidas);
  };
  return alvos.flatMap((a) => {
    const motivo = a.itens.map(motivoDo).find((m) => m !== null);
    return motivo ? [{ familia_id: a.familia_id, motivo }] : [];
  });
}

type LinhaBulk = { code?: number; body?: { id?: unknown; price?: unknown; status?: unknown } };

/** Bloco que falha deixa nulos só os seus itens. Anúncio encerrado não tem preço a conferir. */
export async function lerPrecosVivos(token: string, ids: string[], f: typeof fetch = fetch): Promise<Map<string, number | null>> {
  const precos = new Map<string, number | null>(ids.map((id) => [id, null]));
  const blocos = Array.from({ length: Math.ceil(ids.length / BLOCO_MULTIGET) }, (_, i) => ids.slice(i * BLOCO_MULTIGET, (i + 1) * BLOCO_MULTIGET));
  await pool(PARALELO, blocos, async (bloco) => {
    try {
      const r = await f(`${API}${caminhoMultiget(bloco, 'id,price,status')}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_LEITURA_MS),
      });
      if (!r.ok) throw new Error(`ML ${r.status}`);
      const linhas = comoEnvelopeAntigo(await r.json(), bloco);
      for (const l of (Array.isArray(linhas) ? linhas : []) as LinhaBulk[]) {
        const preco = Number(l?.body?.price);
        if (l?.code === 200 && l.body?.price != null && Number.isFinite(preco) && l.body.status !== 'closed') {
          precos.set(String(l.body.id), preco);
        }
      }
    } catch (e) {
      console.error(`trava de oferta: multiget de ${bloco.length} itens falhou:`, e);
    }
  });
  return precos;
}

export function depsTravaOferta(admin: SupabaseClient, orgId: string, getToken: () => Promise<string>): DepsTravaOferta {
  let token: Promise<string> | null = null;
  const lerToken = () => (token ??= getToken());
  return {
    precosVivos: async (ids) => lerPrecosVivos(await lerToken(), ids),
    lerOfertas: async (id) => criarClienteReajusteML(await lerToken()).lerOfertas(id),
    ofertasBanco: (ids) => ofertasBanco(admin, orgId, ids),
  };
}
