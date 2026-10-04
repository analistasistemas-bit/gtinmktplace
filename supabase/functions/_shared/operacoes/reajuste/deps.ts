// I5 / ADR-0178 — fiação real do reajuste (service role). Só ligação: a regra vive em preview.ts / executar.ts /
// etapa.ts (vitest). Service role ignora RLS → toda query filtra por org_id.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { pool } from '../../concorrencia/pool.ts';
import { buscarItensML, criarGetJson, SemAcessoPromocoes } from '../../promocoes/ml.ts';
import { carregarCadastro, criarTarifaEm, lerAliquotas, type Cx } from '../../promocoes/deps.ts';
import { projetarItem } from '../../promocoes/sincronizar.ts';
import type { Cadastro } from '../../promocoes/cadastro.ts';
import type { Aliquotas, ItemML } from '../../promocoes/tipos.ts';
import { depsLaco } from '../deps.ts';
import type { DepsLaco } from '../laco.ts';
import { SemAcessoStatusML } from '../ml-status.ts';
import type { ItemRow } from '../tipos.ts';
import { resumir } from './avaliacao.ts';
import type { DepsReajuste, ItemReajuste, OperacaoReajusteRow, ResultadoPersistir } from './executar.ts';
import { criarClienteReajusteML } from './ml.ts';
import type { AlvoExpandido, DepsPreview, Origem } from './preview.ts';
import type { Avaliacao, CorAvaliada, EstadoVariacao } from './tipos.ts';

const ITENS = 'operacoes_massa_itens';
const COLS_LACO = 'ml_item_id, preco, status, conferencias, semaforo, confirmado_risco, proxima_conferencia, saida_pedida_em';
// Literal único: o parser de tipos do select do supabase-js não lê concatenação.
const COLS_ITEM = 'ml_item_id, status, preco, preco_anterior, etapa, conferencias, avaliacao, estado_anterior, variacoes_ml, confirmado_risco, confirmado_sem_dado, codigo_pai, variacao_ids';
const ENVIANDO_PARADO_MS = 2 * 60_000; // mesmo limite da RPC reajuste_reivindicar
const BACKOFF_MIN = [5, 10, 20, 40, 60];
/** Conta sem acesso: itens com etapa voltam a ser conferidos neste intervalo (retomam sozinhos após reconectar). */
const ESPERA_SEM_ACESSO_MIN = 10;
export const MSG_AGUARDANDO = 'Aguardando confirmação do ML';
const BLOCO = 100; // `.in()` com muitos ids encosta no limite de URL do PostgREST

const falhou = (onde: string, e: { message: string } | null) => { if (e) throw new Error(`${onde}: ${e.message}`); };
const numOuNull = (x: unknown) => (x == null ? null : Number(x));
const agoraIso = () => new Date().toISOString();
const emMin = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const blocos = <T>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / BLOCO) }, (_, i) => xs.slice(i * BLOCO, (i + 1) * BLOCO));
/** null = sem atacado; [] = explicitamente sem; qualquer outra coisa conta como atacado (conservador). */
const temFaixas = (x: unknown) => x != null && !(Array.isArray(x) && x.length === 0);

/** Ids pedidos que não são anúncios desta org (nada é cortado em silêncio, D11). */
export class ForaDaOrg extends Error {
  constructor(readonly ids: string[]) { super(`Fora da organização: ${ids.join(', ')}`); }
}

type DepsBanco = DepsLaco & Pick<DepsReajuste, 'agendarConferenciaItem' | 'encerrarSemEtapa'>;

/** Laço do reajuste sem conexão ML (também usado no encerramento por conta sem acesso, etapa.ts). */
export function depsLacoReajuste(admin: SupabaseClient, op: { id: string; org_id: string }, chave: string): DepsBanco {
  const itens = () => admin.from(ITENS);
  const linhas = (data: unknown): ItemRow[] => ((data ?? []) as Record<string, unknown>[])
    .map((r) => ({ ...(r as unknown as ItemRow), preco: numOuNull(r.preco) }));
  return {
    ...depsLaco(admin, op, chave),

    // Só a RPC: ela grava a recusa sob os locks. 'ocupado' ou motivo → false.
    async reivindicar(operacaoId, mlItemId) {
      const { data, error } = await admin.rpc('reajuste_reivindicar', { p_org: op.org_id, p_operacao: operacaoId, p_ml_item: mlItemId });
      falhou('reajuste_reivindicar', error);
      return data === 'ok';
    },

    async itensPendentes(_operacaoId, limite) {
      const agora = Date.now();
      const parado = new Date(agora - ENVIANDO_PARADO_MS).toISOString();
      const { data, error } = await itens().select(COLS_LACO).eq('org_id', op.org_id).eq('operacao_id', op.id)
        .or(`status.eq.pendente,and(status.eq.conferindo,proxima_conferencia.lte.${new Date(agora).toISOString()}),` +
          `and(status.eq.enviando,atualizado_em.lt.${parado})`)
        .order('ml_item_id').limit(limite);
      falhou('itensPendentes', error);
      return linhas(data);
    },

    // `conferindo` (não `saida_solicitada`): sem isto `finalizar` concluiria com preço possivelmente aplicado no ML.
    async itensAConferir() {
      const { data, error } = await itens().select(COLS_LACO).eq('org_id', op.org_id).eq('operacao_id', op.id)
        .eq('status', 'conferindo').not('proxima_conferencia', 'is', null).order('ml_item_id');
      falhou('itensAConferir', error);
      return linhas(data);
    },

    async agendarConferenciaItem(_operacaoId, mlItemId, conferencias) {
      const { error } = await itens().update({
        status: 'conferindo', conferencias: conferencias + 1, mensagem: MSG_AGUARDANDO,
        proxima_conferencia: emMin(BACKOFF_MIN[Math.min(conferencias, BACKOFF_MIN.length - 1)]), atualizado_em: agoraIso(),
      }).eq('org_id', op.org_id).eq('operacao_id', op.id).eq('ml_item_id', mlItemId);
      falhou('agendarConferenciaItem', error);
    },

    async encerrarSemEtapa(_operacaoId, mensagem) {
      const semEtapa = await itens().update({ status: 'erro', mensagem, proxima_conferencia: null, atualizado_em: agoraIso() })
        .eq('org_id', op.org_id).eq('operacao_id', op.id).in('status', ['pendente', 'enviando']).is('etapa', null);
      falhou('encerrarSemEtapa', semEtapa.error);
      // Com etapa (escrita possível): conferindo com a reserva. Conferindo já vencido também é adiado — senão o
      // agendamento cairia em 1 s e giraria sem parar enquanto a conta estiver sem acesso.
      const comEtapa = await itens().update({ status: 'conferindo', mensagem, proxima_conferencia: emMin(ESPERA_SEM_ACESSO_MIN), atualizado_em: agoraIso() })
        .eq('org_id', op.org_id).eq('operacao_id', op.id).not('etapa', 'is', null)
        .or(`status.in.(pendente,enviando),and(status.eq.conferindo,proxima_conferencia.lte.${agoraIso()})`);
      falhou('encerrarSemEtapa.comEtapa', comEtapa.error);
    },
  };
}

/** Avaliação por cor no preço, com tarifa FRESCA (C1) — preview e execução, senão o cache viraria `mudou` espúrio.
 *  Nunca lança por dado ausente: tarifa estimada → ⚪ (projetarCor), sem alíquota/leitura do ML → ⚪. */
export function criarAvaliador(admin: SupabaseClient, cx: Cx): (mlItemId: string, preco: number) => Promise<Avaliacao> {
  const get = criarGetJson(cx.token);
  const tarifaEm = criarTarifaEm(cx, { fresco: true });
  let base: Promise<[Cadastro, Aliquotas | null]> | null = null;
  const semDado = (motivo: string) => resumir([{
    variation_id: null, sku: null, custo: null, piso: null, origem: null, aliquota_pct: null, comissao_pct: null,
    comissao_fixa: null, frete: null, liquido: null, semaforo: 'indisponivel', motivo,
  }]);
  return async (ml, preco) => {
    base ??= Promise.all([carregarCadastro(admin, cx.orgId), lerAliquotas(admin, cx.orgId)])
      .catch((e) => { base = null; throw e; });
    const [cad, aliq] = await base;
    if (!aliq) return semDado('sem_aliquota');
    let item: ItemML | null;
    try {
      item = (await buscarItensML(get, [ml])).get(ml) ?? null;
    } catch (e) {
      if (e instanceof SemAcessoPromocoes) throw new SemAcessoStatusML(e.message);
      return semDado('erro_leitura_ml');
    }
    const r = await projetarItem({
      ml_item_id: ml, status: 'candidate', preco_original: null, preco_promo: preco, preco_sugerido: preco,
      preco_min: null, preco_max: null, ml_pct: null, vendedor_pct: null, estoque_min: null, estoque_max: null,
    }, item, cad, aliq, tarifaEm);
    return resumir(r.projecao.map((p): CorAvaliada => ({
      variation_id: p.variation_id == null ? null : String(p.variation_id), sku: p.sku, custo: p.custo, piso: p.piso,
      origem: p.origem, aliquota_pct: p.aliquota_pct, comissao_pct: p.comissao_pct, comissao_fixa: p.comissao_fixa,
      frete: p.frete, liquido: p.liquido, semaforo: p.semaforo, motivo: p.motivo,
    })));
  };
}

type Flags = Pick<AlvoExpandido, 'ehKit' | 'temAtacado' | 'promocaoBanco' | 'familiaPublicando' | 'migracaoPxv' | 'titulo'>;

/** Fatos de bloqueio por MLB, em lote. Com `variacaoIds` (execução) o atacado é o das cores do item; sem (preview)
 *  é o da família canônica do produto — a execução reconfere com as cores casadas. */
async function flagsDe(admin: SupabaseClient, orgId: string, alvos: { ml: string; pai: string; variacaoIds?: string[] }[]): Promise<Map<string, Flags>> {
  const mls = [...new Set(alvos.map((a) => a.ml))];
  const pais = [...new Set(alvos.map((a) => a.pai).filter(Boolean))];
  const kits = new Set<string>(), promo = new Set<string>(), pxv = new Set<string>();
  const familias: { id: string; codigo_pai: string; status: string; atacado: unknown; titulo_ml: string | null }[] = [];
  for (const b of blocos(mls)) {
    const [k, p] = await Promise.all([
      admin.from('kits_virtuais').select('ml_item_id').eq('org_id', orgId).eq('status', 'publicado').in('ml_item_id', b),
      admin.from('ml_promocao_itens').select('ml_item_id').eq('org_id', orgId).in('status', ['pending', 'started']).in('ml_item_id', b),
    ]);
    falhou('kits_virtuais', k.error);
    falhou('ml_promocao_itens', p.error);
    for (const r of k.data ?? []) kits.add(String(r.ml_item_id));
    for (const r of p.data ?? []) promo.add(String(r.ml_item_id));
  }
  for (const b of blocos(pais)) {
    const [f, a] = await Promise.all([
      // ponytail: histórico de famílias do produto vem inteiro (dezenas de linhas); filtrar se crescer.
      admin.from('familias').select('id, codigo_pai, status, atacado, titulo_ml')
        .eq('org_id', orgId).in('codigo_pai', b).order('publicado_em', { ascending: false, nullsFirst: false }).order('criado_em', { ascending: false }),
      admin.from('anuncios_externos').select('codigo_pai').eq('org_id', orgId).eq('canal', 'mercado_livre')
        .in('codigo_pai', b).in('migracao_pxv_status', ['solicitada', 'em_andamento']),
    ]);
    falhou('familias', f.error);
    falhou('anuncios_externos', a.error);
    familias.push(...((f.data ?? []) as typeof familias));
    for (const r of a.data ?? []) pxv.add(String(r.codigo_pai));
  }
  const canonica = new Map<string, (typeof familias)[number]>();
  for (const f of familias) if (!canonica.has(f.codigo_pai)) canonica.set(f.codigo_pai, f); // já ordenadas
  const porId = new Map(familias.map((f) => [f.id, f]));

  // Atacado das cores: por id (execução) ou das famílias canônicas (preview).
  const famDeVariacao = new Map<string, string>();
  const variacaoComAtacado = new Set<string>(), familiaComAtacadoNaCor = new Set<string>();
  const ids = [...new Set(alvos.flatMap((a) => a.variacaoIds ?? []))];
  for (const b of blocos(ids)) {
    const { data, error } = await admin.from('variacoes').select('id, familia_id, atacado').eq('org_id', orgId).in('id', b);
    falhou('variacoes', error);
    for (const r of data ?? []) {
      famDeVariacao.set(String(r.id), String(r.familia_id));
      if (temFaixas(r.atacado)) variacaoComAtacado.add(String(r.id));
    }
  }
  const canonicas = alvos.some((a) => !a.variacaoIds) ? [...canonica.values()].map((f) => f.id) : [];
  for (const b of blocos(canonicas)) {
    const { data, error } = await admin.from('variacoes').select('familia_id, atacado').eq('org_id', orgId).in('familia_id', b).not('atacado', 'is', null);
    falhou('variacoes.atacado', error);
    for (const r of data ?? []) if (temFaixas(r.atacado)) familiaComAtacadoNaCor.add(String(r.familia_id));
  }

  const out = new Map<string, Flags>();
  for (const a of alvos) {
    const can = canonica.get(a.pai);
    const atacado = a.variacaoIds
      ? a.variacaoIds.some((v) => variacaoComAtacado.has(v) || temFaixas(porId.get(famDeVariacao.get(v) ?? '')?.atacado))
      : !!can && (temFaixas(can.atacado) || familiaComAtacadoNaCor.has(can.id));
    out.set(a.ml, {
      ehKit: kits.has(a.ml), temAtacado: atacado, promocaoBanco: promo.has(a.ml),
      familiaPublicando: familias.some((f) => f.codigo_pai === a.pai && f.status === 'publicando'),
      migracaoPxv: pxv.has(a.pai), titulo: can?.titulo_ml ?? null,
    });
  }
  return out;
}

/** Família → todos os MLBs do produto (UP: SKUs não retirados; Legacy: a família + partições > 0); MLB solto → produto
 *  pela mesma regra da RPC (reajuste_codigo_pai). Kit Virtual entra sem produto (o preview o tira com motivo). */
async function expandir(
  admin: SupabaseClient, orgId: string, familiaIds: string[], mlItemIds: string[], reverter: boolean,
): Promise<AlvoExpandido[]> {
  const pares = new Map<string, { pai: string; sku: string | null }>();
  if (familiaIds.length) {
    const fams: { id: string; codigo_pai: string; ml_item_id: string | null }[] = [];
    for (const b of blocos(familiaIds)) {
      const { data, error } = await admin.from('familias').select('id, codigo_pai, ml_item_id').eq('org_id', orgId).in('id', b);
      falhou('familias', error);
      fams.push(...((data ?? []) as typeof fams));
    }
    const achadas = new Set(fams.map((f) => f.id));
    const faltam = familiaIds.filter((id) => !achadas.has(id));
    if (faltam.length) throw new ForaDaOrg(faltam);

    const pais = [...new Set(fams.map((f) => f.codigo_pai))];
    const raizes: { id: string; codigo_pai: string; particao: number; item_externo_id: string | null }[] = [];
    for (const b of blocos(pais)) {
      const { data, error } = await admin.from('anuncios_externos').select('id, codigo_pai, particao, item_externo_id')
        .eq('org_id', orgId).eq('canal', 'mercado_livre').in('codigo_pai', b);
      falhou('anuncios_externos', error);
      raizes.push(...((data ?? []) as typeof raizes));
    }
    const paiDaRaiz = new Map(raizes.map((r) => [r.id, r.codigo_pai]));
    const paisUp = new Set<string>();
    for (const b of blocos([...paiDaRaiz.keys()])) {
      const { data, error } = await admin.from('anuncios_externos_itens').select('anuncio_externo_id, item_externo_id, sku')
        .eq('org_id', orgId).in('anuncio_externo_id', b).eq('retirado', false).not('item_externo_id', 'is', null);
      falhou('anuncios_externos_itens', error);
      for (const r of data ?? []) {
        const pai = paiDaRaiz.get(String(r.anuncio_externo_id))!;
        paisUp.add(pai);
        pares.set(String(r.item_externo_id), { pai, sku: (r.sku as string | null) ?? null });
      }
    }
    for (const f of fams) if (f.ml_item_id && !paisUp.has(f.codigo_pai)) pares.set(f.ml_item_id, { pai: f.codigo_pai, sku: null });
    for (const r of raizes) {
      if (r.particao > 0 && r.item_externo_id && !paisUp.has(r.codigo_pai)) pares.set(r.item_externo_id, { pai: r.codigo_pai, sku: null });
    }
  }

  const soltos = mlItemIds.filter((ml) => !pares.has(ml));
  const paisSoltos = await pool(10, soltos, async (ml) => {
    const { data, error } = await admin.rpc('reajuste_codigo_pai', { p_org: orgId, p_ml_item: ml });
    falhou('reajuste_codigo_pai', error);
    return (data as string | null) ?? null;
  });
  const semProduto = soltos.filter((_, i) => !paisSoltos[i]);
  const kits = new Set<string>();
  for (const b of blocos(semProduto)) {
    const { data, error } = await admin.from('kits_virtuais').select('ml_item_id').eq('org_id', orgId).eq('status', 'publicado').in('ml_item_id', b);
    falhou('kits_virtuais', error);
    for (const r of data ?? []) kits.add(String(r.ml_item_id));
  }
  const fora = new Set(semProduto.filter((ml) => !kits.has(ml)));
  // Pedido do usuário: id fora da org → 400. Reverter: o MLB da origem que perdeu o produto só é omitido — o
  // preview o lista como `fora` ("não encontrado no cadastro") e os demais seguem revertíveis.
  if (fora.size && !reverter) throw new ForaDaOrg([...fora]);
  const skus = new Map<string, string>();
  for (const b of blocos(soltos.filter((_, i) => paisSoltos[i]))) {
    const { data, error } = await admin.from('anuncios_externos_itens').select('item_externo_id, sku').eq('org_id', orgId).in('item_externo_id', b);
    falhou('anuncios_externos_itens.sku', error);
    for (const r of data ?? []) skus.set(String(r.item_externo_id), String(r.sku));
  }
  soltos.forEach((ml, i) => { if (!fora.has(ml)) pares.set(ml, { pai: paisSoltos[i] ?? '', sku: skus.get(ml) ?? null }); });

  const flags = await flagsDe(admin, orgId, [...pares].map(([ml, p]) => ({ ml, pai: p.pai })));
  return [...pares].map(([ml, p]) => ({
    ml_item_id: ml, codigo_pai: p.pai, variacao_ids: [], variacoes_ml_esperadas: null, sku: p.sku, ...flags.get(ml)!,
  }));
}

/** `reverter` = preview com origem_id (os MLBs vêm da origem, não do usuário). */
export function depsPreview(admin: SupabaseClient, cx: Cx, opts: { reverter: boolean }): DepsPreview {
  const orgId = cx.orgId;
  return {
    expandir: (familias, mlItemIds) => expandir(admin, orgId, familias, mlItemIds, opts.reverter),

    // Uma linha POR id pedido (a RPC garante); plano/UP vem com ml_variation_id null → '' (nunca filtrar).
    async variacoesDoMlb(codigoPai, mlItem, mlVariationIds) {
      const { data, error } = await admin.rpc('reajuste_variacoes_do_mlb', {
        p_org: orgId, p_codigo_pai: codigoPai, p_ml_item: mlItem, p_ml_variation_ids: mlVariationIds,
      });
      falhou('reajuste_variacoes_do_mlb', error);
      return ((data ?? []) as { ml_variation_id: string | null; variacao_id: string | null }[])
        .map((r) => ({ ml_variation_id: r.ml_variation_id ?? '', variacao_id: r.variacao_id ?? null }));
    },

    async estadoVariacoes(variacaoIds) {
      const out = new Map<string, EstadoVariacao>();
      for (const b of blocos(variacaoIds)) {
        const { data, error } = await admin.from('variacoes').select('id, preco_publicacao, preco_editado_pelo_operador')
          .eq('org_id', orgId).in('id', b);
        falhou('estadoVariacoes', error);
        for (const r of data ?? []) {
          out.set(String(r.id), { preco_publicacao: numOuNull(r.preco_publicacao), preco_editado_pelo_operador: r.preco_editado_pelo_operador === true });
        }
      }
      return out;
    },

    ml: criarClienteReajusteML(cx.token),
    avaliar: criarAvaliador(admin, cx),

    async origem(origemId) {
      const { data: op, error } = await admin.from('operacoes_massa').select('id')
        .eq('org_id', orgId).eq('id', origemId).eq('acao', 'reajustar').maybeSingle();
      falhou('origem', error);
      if (!op) return null;
      const r = await admin.from(ITENS).select('ml_item_id, codigo_pai, preco, preco_anterior, estado_anterior')
        .eq('org_id', orgId).eq('operacao_id', origemId).eq('status', 'aplicado');
      falhou('itens da origem', r.error);
      return new Map((r.data ?? []).map((i): [string, Origem] => [String(i.ml_item_id), {
        codigo_pai: (i.codigo_pai as string | null) ?? '', preco_anterior: Number(i.preco_anterior), preco: Number(i.preco),
        restaurar: (i.estado_anterior ?? []) as Origem['restaurar'],
      }]));
    },
  };
}

export function depsReajuste(admin: SupabaseClient, cx: Cx, op: OperacaoReajusteRow, chave: string): DepsReajuste {
  const orgId = op.org_id;
  return {
    ...depsLacoReajuste(admin, op, chave),
    ml: criarClienteReajusteML(cx.token),
    avaliarFresco: criarAvaliador(admin, cx),

    async lerItem(operacaoId, mlItemId): Promise<ItemReajuste> {
      const { data: r, error } = await admin.from(ITENS).select(COLS_ITEM)
        .eq('org_id', orgId).eq('operacao_id', operacaoId).eq('ml_item_id', mlItemId).maybeSingle();
      falhou('lerItem', error);
      if (!r) throw new Error(`item de reajuste não encontrado: ${mlItemId}`);
      return {
        ...(r as unknown as ItemReajuste), preco: Number(r.preco), preco_anterior: Number(r.preco_anterior),
        conferencias: Number(r.conferencias ?? 0), restaurar: (r.estado_anterior ?? []) as ItemReajuste['restaurar'],
        variacoes_ml: (r.variacoes_ml as string[] | null) ?? null, variacao_ids: (r.variacao_ids as string[] | null) ?? [],
        codigo_pai: (r.codigo_pai as string | null) ?? '', confirmado_risco: r.confirmado_risco === true,
        confirmado_sem_dado: r.confirmado_sem_dado === true,
      };
    },

    async fatos(item) {
      const f = (await flagsDe(admin, orgId, [{ ml: item.ml_item_id, pai: item.codigo_pai, variacaoIds: item.variacao_ids }])).get(item.ml_item_id)!;
      return { ehKit: f.ehKit, temAtacado: f.temAtacado, promocaoBanco: f.promocaoBanco, familiaPublicando: f.familiaPublicando, migracaoPxv: f.migracaoPxv };
    },

    async persistir(operacaoId, mlItemId, precoConfirmado, restaurar) {
      const { data, error } = await admin.rpc('reajuste_persistir', {
        p_org: orgId, p_operacao: operacaoId, p_ml_item: mlItemId, p_preco_confirmado: precoConfirmado, p_restaurar: restaurar,
      });
      falhou('reajuste_persistir', error);
      return data as ResultadoPersistir;
    },
  };
}
