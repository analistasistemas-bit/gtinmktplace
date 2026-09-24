// ADR-0170 — sync das promoções: etapa de lista (por org) e etapa de leitura (por promoção, em lotes,
// com continuação). Decisão aqui; IO nas deps (fiação real em deps.ts).
import type { DimensoesPacote } from '../ml/pacote.ts';
import { resolverCor, type Cadastro } from './cadastro.ts';
import { SemAcessoPromocoes, TIPOS_CUPOM } from './ml.ts';
import { ateQuantoDescer, liquidoNoPreco, piorSemaforo, precoAvaliado, semaforo } from './projecao.ts';
import type {
  Aliquotas, ItemML, ItemPromocaoML, LinhaItem, MotivoSemLiquido, ProjecaoCor, PromocaoML, Tarifa,
} from './tipos.ts';

export type EstadoSync = 'ok' | 'sem_acesso' | 'sem_promocoes' | 'erro';
export const MSG_ALIQUOTA = 'Confirme as alíquotas de imposto em Configurações antes de usar a Central de Promoções.';

export interface QueryTarifa { preco: number; categoria: string; listingType: string; dim: DimensoesPacote | null }
export interface MsgLeitura { etapa: 'promocao'; org_id: string; promocao_id: string; tipo: string; rodada: string; cursor: string | null }

export interface DepsLista {
  lerAliquotas(): Promise<Aliquotas | null>;
  listarPromocoes(): Promise<PromocaoML[]>;
  /** Upsert dos metadados; não toca contagem, erro, itens_sincronizados_em nem rodada_em_curso. */
  gravarPromocoes(ps: PromocaoML[]): Promise<void>;
  /** status='finished' nas pending/started da org cujo id não está em `vistos`. */
  encerrarAusentes(vistos: string[]): Promise<void>;
  /** Reserva atômica: grava rodada_em_curso se estiver nula ou com mais de 30 min. true = reservou. */
  reservarLeitura(promocaoId: string, rodada: string): Promise<boolean>;
  enfileirar(m: MsgLeitura): Promise<void>;
  /** Alertas lendo o banco (dados da rodada anterior). Devolve nº de envios. */
  avisar(): Promise<number>;
  gravarEstado(e: { estado: EstadoSync; erro?: string }): Promise<void>;
}

export interface DepsLeitura {
  agora(): number;
  rodadaEmCurso(): Promise<string | null>;
  lerAliquotas(): Promise<Aliquotas | null>;
  listarItens(): Promise<ItemPromocaoML[]>;
  buscarItensML(ids: string[]): Promise<Map<string, ItemML>>;
  carregarCadastro(): Promise<Cadastro>;
  tarifaEm(q: QueryTarifa): Promise<Tarifa>;
  /** Upsert das linhas com sincronizado_em = rodada. */
  gravarLote(linhas: LinhaItem[]): Promise<void>;
  /** Publica a mesma mensagem com o cursor = último ml_item_id processado. */
  continuar(cursor: string): Promise<void>;
  /** Só com a posse da rodada: apaga itens com sincronizado_em < rodada, recalcula a contagem no banco,
   *  itens_sincronizados_em = rodada, erro = null, rodada_em_curso = null. false = posse perdida, nada feito. */
  concluir(): Promise<boolean>;
  /** Só com a posse da rodada: erro = msg, rodada_em_curso = null. */
  falhar(erro: string): Promise<void>;
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function emParalelo<T, R>(itens: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      out[i] = await fn(itens[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, trabalhador));
  return out;
}

async function projetarCor(
  it: ItemPromocaoML, ml: ItemML | null,
  c: { variation_id: number | null; cor: string | null; sku: string | null; gtin: string | null },
  cad: Cadastro, aliq: Aliquotas, preco: number | null, tarifaEm: (q: QueryTarifa) => Promise<Tarifa>,
): Promise<ProjecaoCor> {
  const r = resolverCor(cad, { item_id: it.ml_item_id, variation_id: c.variation_id, sku: c.sku, gtin: c.gtin });
  const base: ProjecaoCor = {
    variation_id: c.variation_id, cor: c.cor ?? r?.cor ?? null, sku: c.sku,
    custo: r?.custo ?? null, piso: r?.piso ?? null, origem: r?.origem ?? null,
    comissao_pct: null, comissao_fixa: null, frete: null, aliquota_pct: null,
    liquido: null, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'indisponivel', motivo: null,
  };
  const motivo: MotivoSemLiquido | null =
    !r ? 'sem_cadastro'
    : r.custo == null || r.piso == null ? 'sem_custo'
    : r.origem == null ? 'sem_origem'
    : preco == null ? 'sem_preco'
    : !ml?.categoria || !ml.listing_type_id ? 'sem_categoria'
    : null;
  if (motivo) return { ...base, motivo };

  const piso = r!.piso!, custo = r!.custo!;
  const aliquotaPct = r!.origem === 'importado' ? aliq.importado : aliq.nacional;
  const tarifaNo = (p: number) => tarifaEm({ preco: p, categoria: ml!.categoria!, listingType: ml!.listing_type_id!, dim: r!.dim });
  let t: Tarifa;
  try {
    t = await tarifaNo(preco!);
  } catch (e) {
    // Inclui TarifaEstimada: comissão/frete que o ML não informou NUNCA vira zero (ADR-0170 §7).
    console.warn('[promocoes] tarifa indisponível', { ml_item_id: it.ml_item_id, variation_id: c.variation_id, erro: mensagem(e) });
    return { ...base, motivo: 'erro_tarifa' };
  }
  const liquido = liquidoNoPreco(preco!, t, aliquotaPct);
  let ate: { valor: number | null; motivo: 'qualquer' | 'nenhum' | null } = { valor: null, motivo: null };
  if (it.status === 'candidate' && it.preco_min != null && it.preco_max != null) {
    try {
      ate = await ateQuantoDescer({ piso, aliquotaPct, min: it.preco_min, max: it.preco_max }, tarifaNo);
    } catch (e) {
      // sem "até quanto"; o líquido no preço avaliado continua válido
      console.warn('[promocoes] até quanto indisponível', { ml_item_id: it.ml_item_id, variation_id: c.variation_id, erro: mensagem(e) });
    }
  }
  return {
    ...base, comissao_pct: t.comissao.percentual, comissao_fixa: t.comissao.fixa, frete: t.frete,
    aliquota_pct: aliquotaPct, liquido, ate_quanto: ate.valor, ate_quanto_motivo: ate.motivo,
    semaforo: semaforo(liquido, piso, custo),
  };
}

export async function projetarItem(
  it: ItemPromocaoML, ml: ItemML | null, cad: Cadastro, aliq: Aliquotas, tarifaEm: (q: QueryTarifa) => Promise<Tarifa>,
): Promise<LinhaItem> {
  const preco = precoAvaliado(it);
  const cores = ml && ml.variacoes.length
    ? ml.variacoes.map((v) => ({ variation_id: v.variation_id, cor: v.cor, sku: v.sku ?? ml.sku, gtin: v.gtin ?? ml.gtin }))
    : [{ variation_id: null, cor: null, sku: ml?.sku ?? null, gtin: ml?.gtin ?? null }];
  const projecao: ProjecaoCor[] = [];
  for (const c of cores) projecao.push(await projetarCor(it, ml, c, cad, aliq, preco, tarifaEm));
  return {
    ...it,
    titulo: ml?.titulo ?? null, thumbnail: ml?.thumbnail ?? null, permalink: ml?.permalink ?? null,
    listing_type_id: ml?.listing_type_id ?? null, preco_avaliado: preco, projecao,
    pior_semaforo: piorSemaforo(projecao.map((p) => p.semaforo)),
  };
}

export async function sincronizarLista(
  deps: DepsLista, ctx: { orgId: string; rodada: string },
): Promise<{ estado: EstadoSync; enfileiradas: string[] }> {
  try {
    if (!(await deps.lerAliquotas())) {
      await deps.gravarEstado({ estado: 'erro', erro: MSG_ALIQUOTA });
      return { estado: 'erro', enfileiradas: [] };
    }
    let promos: PromocaoML[];
    try {
      promos = await deps.listarPromocoes();
    } catch (e) {
      if (!(e instanceof SemAcessoPromocoes)) throw e;
      await deps.gravarEstado({ estado: 'sem_acesso', erro: e.message });
      return { estado: 'sem_acesso', enfileiradas: [] };
    }
    if (promos.length) await deps.gravarPromocoes(promos);
    await deps.encerrarAusentes(promos.map((p) => p.id));
    try {
      await deps.avisar();
    } catch (e) {
      console.error('[promocoes] alertas falharam (sync mantido):', e);
    }
    if (!promos.length) {
      await deps.gravarEstado({ estado: 'sem_promocoes' });
      return { estado: 'sem_promocoes', enfileiradas: [] };
    }
    const enfileiradas: string[] = [];
    for (const p of promos) {
      if (TIPOS_CUPOM.has(p.tipo) || (p.status !== 'pending' && p.status !== 'started')) continue;
      if (!(await deps.reservarLeitura(p.id, ctx.rodada))) continue; // já em leitura por outra rodada
      await deps.enfileirar({ etapa: 'promocao', org_id: ctx.orgId, promocao_id: p.id, tipo: p.tipo, rodada: ctx.rodada, cursor: null });
      enfileiradas.push(p.id);
    }
    await deps.gravarEstado({ estado: 'ok' });
    return { estado: 'ok', enfileiradas };
  } catch (e) {
    await deps.gravarEstado({ estado: 'erro', erro: mensagem(e) });
    throw e;
  }
}

/** O PostgREST devolve timestamptz como `…+00:00`; a mensagem leva `…Z`. Compara o instante, nunca o texto. */
export function mesmaRodada(a: string | null, b: string): boolean {
  return a != null && Date.parse(a) === Date.parse(b);
}

const porId = (a: ItemPromocaoML, b: ItemPromocaoML) => (a.ml_item_id < b.ml_item_id ? -1 : a.ml_item_id > b.ml_item_id ? 1 : 0);

export async function sincronizarPromocao(
  deps: DepsLeitura, msg: MsgLeitura, opts: { limiteMs: number; lote: number; concorrencia: number },
): Promise<{ resultado: 'concluida' | 'continua' | 'obsoleta' | 'erro'; processados: number }> {
  const inicio = deps.agora();
  if (!mesmaRodada(await deps.rodadaEmCurso(), msg.rodada)) return { resultado: 'obsoleta', processados: 0 };
  let feitos = 0;
  try {
    const aliq = await deps.lerAliquotas();
    if (!aliq) {
      await deps.falhar(MSG_ALIQUOTA);
      return { resultado: 'erro', processados: 0 };
    }
    // Cursor = último ml_item_id processado; a comparação é a mesma da ordenação (code units).
    const pendentes = (await deps.listarItens()).sort(porId)
      .filter((x) => msg.cursor == null || x.ml_item_id > msg.cursor);
    const cadastro = await deps.carregarCadastro();
    while (feitos < pendentes.length) {
      // Posse antes de cada lote: uma cadeia velha nunca escreve por cima de uma rodada nova.
      if (!mesmaRodada(await deps.rodadaEmCurso(), msg.rodada)) return { resultado: 'obsoleta', processados: feitos };
      if (feitos > 0 && deps.agora() - inicio > opts.limiteMs) {
        await deps.continuar(pendentes[feitos - 1].ml_item_id);
        return { resultado: 'continua', processados: feitos };
      }
      const lote = pendentes.slice(feitos, feitos + opts.lote);
      const ml = await deps.buscarItensML(lote.map((x) => x.ml_item_id));
      const linhas = await emParalelo(lote, opts.concorrencia, (it) =>
        projetarItem(it, ml.get(it.ml_item_id) ?? null, cadastro, aliq, (q) => deps.tarifaEm(q)));
      // O lote leva segundos: reconfere a posse logo antes de escrever.
      if (!mesmaRodada(await deps.rodadaEmCurso(), msg.rodada)) return { resultado: 'obsoleta', processados: feitos };
      await deps.gravarLote(linhas);
      feitos += lote.length;
    }
    if (!(await deps.concluir())) return { resultado: 'obsoleta', processados: feitos };
    return { resultado: 'concluida', processados: feitos };
  } catch (e) {
    await deps.falhar(mensagem(e));
    return { resultado: 'erro', processados: feitos };
  }
}
