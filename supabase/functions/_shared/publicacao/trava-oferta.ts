// Trava da oferta no UPDATE (emenda do ADR-0196 ao item 9 do ADR-0174): baixar o preço base até uma oferta vigente ou
// agendada a tira do anúncio, e restaurar o base não a traz de volta. O UPDATE herda o preço no ar (ADR-0016, adendo
// 2026-10-16), então só preço editado para baixo cria o risco, e isso se decide antes de enfileirar.
// Limite aceito: oferta nova, ou preço editado inline, entre o clique e o worker não é detectado.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { resolverConexao } from '../canais/conexao.ts';
import { pool } from '../concorrencia/pool.ts';
import { caminhoMultiget, comoEnvelopeAntigo } from '../ml/multiget.ts';
import { getValidAccessTokenConexao } from '../ml/token.ts';
import { centavos, reais } from '../operacoes/reajuste/alvo.ts';
import { ofertasBanco } from '../operacoes/reajuste/deps.ts';
import { MSG_INCONCLUSIVA, motivoTravaOferta } from '../operacoes/reajuste/elegibilidade.ts';
import { criarClienteReajusteML } from '../operacoes/reajuste/ml.ts';
import { unirOfertas } from '../operacoes/reajuste/ofertas.ts';
import type { OfertaVigente } from '../operacoes/reajuste/tipos.ts';
import { paginarTudo } from '../pagina.ts';
import { montarAncoragem, type LinhaAnuncioParticao } from '../split/ancoragem.ts';
import { ehFluxoAddVariacao } from '../update/fluxo-add-variacao.ts';

const CANAL = 'mercado_livre';
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

export interface VariacaoAlvo { codigo: string; preco_publicacao: number | string | null }
export interface ItemUPAlvo { sku: string; item_externo_id: string | null }
export type LinhaAlvo = LinhaAnuncioParticao & { item_externo_id: string | null };

const precoDe = (v: VariacaoAlvo) => (v.preco_publicacao == null ? null : Number(v.preco_publicacao));
function menorPreco(variacoes: VariacaoAlvo[]): number | null {
  const precos = variacoes.map(precoDe).filter((p) => p !== null).map(centavos);
  return precos.length ? reais(Math.min(...precos)) : null;
}

/** Um alvo por SKU, com o SKU em `familia_id`: quem precisa saber quais SKUs reprovaram (reconciliador) lê direto da recusa.
 *  Só entra filho com item e cor desejada com preço. O status não importa: retirado que volta também recebe o preço. */
export function alvosPorSku(variacoes: VariacaoAlvo[], itens: ItemUPAlvo[]): AlvoFamilia[] {
  const precos = new Map(variacoes.map((v) => [v.codigo, precoDe(v)]));
  return itens.flatMap(({ sku, item_externo_id }) => {
    const preco = precos.get(sku) ?? null;
    return item_externo_id && preco !== null ? [{ familia_id: sku, itens: [{ ml_item_id: item_externo_id, preco }] }] : [];
  });
}

/** Mesmo roteamento dos workers: N partições → split (preço por anúncio), itens UP → saga (preço por cor), senão Legacy.
 *  Legacy cobre a família que o ML migrou e o app ainda não adotou: sem mapa de cores, compara o preço da família com o MLB. */
export function montarAlvo(
  familia: { id: string; ml_item_id: string }, variacoes: VariacaoAlvo[], linhas: LinhaAlvo[], itens: ItemUPAlvo[],
): AlvoFamilia {
  const dividida = linhas.length > 1;
  if (!dividida && itens.length) {
    return { familia_id: familia.id, itens: alvosPorSku(variacoes, itens).flatMap((a) => a.itens) };
  }
  const ancoragem = montarAncoragem(linhas);
  const anuncios = linhas.length ? linhas : [{ particao: 0, item_externo_id: null, variacoes_externas: null }];
  return {
    familia_id: familia.id,
    itens: anuncios.flatMap((l) => {
      const ml_item_id = dividida ? l.item_externo_id ?? (l.particao === 0 ? familia.ml_item_id : null) : familia.ml_item_id;
      // Cor nova não entra no anúncio publicado. Sem mapa, o anúncio único vale pela família inteira.
      const preco = menorPreco(variacoes.filter((v) => ancoragem.get(v.codigo) === l.particao))
        ?? (dividida ? null : menorPreco(variacoes));
      return ml_item_id && preco !== null ? [{ ml_item_id, preco }] : [];
    }),
  };
}

type FamiliaLote = { id: string; lote_id: string; codigo_pai: string; ml_item_id: string | null; operacao: string; status: string };

/** Recusas de um pedido de publicação. Confere só o que a reserva UPDATE pegaria, sem "somente estoque" e fora do
 *  Adicionar variação (lote manual), que preserva os preços publicados. Org sem conexão: o worker já trata.
 *  Erro de banco lança: quem chama não reserva nada. */
export async function recusasDoLote(
  admin: SupabaseClient, orgId: string, familiaIds: string[], somenteEstoque: (familiaId: string) => boolean,
): Promise<{ familia_id: string; motivo: string }[]> {
  const { data, error } = await admin.from('familias')
    .select('id, lote_id, codigo_pai, ml_item_id, operacao, status').in('id', familiaIds).eq('org_id', orgId);
  if (error) throw new Error(`carregar famílias: ${error.message}`);
  const candidatas = ((data ?? []) as FamiliaLote[]).filter((f) =>
    f.operacao === 'UPDATE' && f.ml_item_id && ['pronto', 'erro'].includes(f.status) && !somenteEstoque(f.id));
  if (!candidatas.length) return [];

  const lotes = [...new Set(candidatas.map((f) => f.lote_id))];
  const manuais = await Promise.all(lotes.map((l) => ehFluxoAddVariacao(admin, l)));
  const familias = candidatas.filter((f) => !manuais[lotes.indexOf(f.lote_id)]);
  if (!familias.length) return [];

  const conexao = await resolverConexao(admin, orgId, CANAL);
  if (!conexao) return [];

  // Paginado: lote grande passa do teto do PostgREST, e item cortado em silêncio ficaria sem conferir.
  const variacoes = await paginarTudo<VariacaoAlvo & { familia_id: string }>((de, ate) => admin.from('variacoes')
    .select('familia_id, codigo, preco_publicacao').in('familia_id', familias.map((f) => f.id)).eq('excluida_da_publicacao', false)
    .order('id').range(de, ate) as never);
  const linhas = await paginarTudo<LinhaAlvo & { id: string; codigo_pai: string }>((de, ate) => admin.from('anuncios_externos')
    .select('id, codigo_pai, particao, item_externo_id, variacoes_externas').eq('org_id', orgId).eq('canal', CANAL)
    .in('codigo_pai', [...new Set(familias.map((f) => f.codigo_pai))]).order('id').range(de, ate) as never);
  const raizes = linhas.filter((l) => l.particao === 0).map((l) => l.id);
  const itens = raizes.length
    ? await paginarTudo<ItemUPAlvo & { anuncio_externo_id: string }>((de, ate) => admin.from('anuncios_externos_itens')
      .select('anuncio_externo_id, sku, item_externo_id').in('anuncio_externo_id', raizes).order('id').range(de, ate) as never)
    : [];

  const alvos = familias.map((f) => {
    const doPai = linhas.filter((l) => l.codigo_pai === f.codigo_pai);
    const raiz = doPai.find((l) => l.particao === 0)?.id;
    return montarAlvo(
      { id: f.id, ml_item_id: f.ml_item_id! }, variacoes.filter((v) => v.familia_id === f.id), doPai,
      itens.filter((i) => i.anuncio_externo_id === raiz),
    );
  });
  return recusasPorOferta(alvos, depsTravaOferta(admin, orgId, () => getValidAccessTokenConexao(conexao)));
}
