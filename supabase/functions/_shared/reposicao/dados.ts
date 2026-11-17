// IO da Reposição (ADR-0207): lê o banco da org e monta a `EntradaCalculo` do `calculo.ts` e os DTOs
// da tela. Seis FONTES, sem N+1: o número de chamadas não cresce com dias, pedidos nem SKUs — só com as
// páginas de 1000 linhas de uma mesma fonte (`paginarTudo`, teto do PostgREST):
//   1. organizations + embeds pequenos da org (config, Não repor, fornecedores, vínculos, pedidos+itens)
//   2. variacoes + familias  3. estoque_movimentos (todo o ledger: a janela + quem já teve movimento)  4. ml_vendas + itens (preços)
//   5. anuncios_externos (1ª publicação)  6. kits_variacao + SKUs + composição
// Datas: `dia` sempre YYYY-MM-DD em BRT; a janela de 60 dias termina ontem.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { montarPedidosAbertos, normalizarNome, type EntradaCalculo, type KitLink, type MovDia, type SkuEntrada } from './calculo.ts';
import type { FamiliaTela, NaoReporDTO, PedidoDTO, SkuTela, StatusPedido } from './tipos.ts';
import { paginarTudo } from '../pagina.ts';
import { diaBrt } from '../notificacoes/gerencial/janelas.ts';

const JANELA = 60;

export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

export { normalizarNome };

/** Família canônica por codigo_pai = a criada por último (desempate pelo id). Também em `definir_multiplo`. */
export function familiaMaisRecente(a: { criado_em: string; id: string }, b: { criado_em: string; id: string }): boolean {
  return a.criado_em > b.criado_em || (a.criado_em === b.criado_em && a.id > b.id);
}

interface FamiliaRow {
  id: string; codigo_pai: string; nome_pai: string | null; fornecedor: string | null; multiplo_compra: number | null;
  kit_base_codigo_pai: string | null; kit_multiplicador: number | null; criado_em: string;
}
interface VariacaoRow {
  codigo: string; cor: string | null; cor_hex: string | null; tamanho: string | null; estoque: number | null;
  custo: number | string | null; preco: number | string | null; familia_id: string; familias: FamiliaRow;
}
interface MovRow {
  codigo: string; motivo: string; quantidade: number; quantidade_pedida: number | null;
  estoque_anterior: number | null; estoque_resultante: number | null; referencia_externa: string | null;
  transferencia_id: string | null; origem_kit_codigo_pai: string | null; criado_em: string; ordem: number | null;
}
interface ItemRow {
  codigo: string; codigo_pai: string; quantidade: number; sugerida: number | null; recebida: number; encerrado: boolean;
}
interface PedidoRow {
  id: string; fornecedor_id: string; status: StatusPedido; previsto_para: string | null;
  salvo_por: string | null; salvo_em: string | null; aprovado_por: string | null; enviado_em: string | null;
  alterado_por: string | null; alterado_em: string | null; pedidos_compra_itens: ItemRow[];
}
interface OrgRow {
  reposicao_config: { prazo_dias: number; cobertura_dias: number } | { prazo_dias: number; cobertura_dias: number }[] | null;
  reposicao_nao_repor: { id: string; escopo: NaoReporDTO['escopo']; codigo_pai: string; codigo: string | null; cor: string | null }[];
  fornecedores: { id: string; nome: string; nome_normalizado: string; cnpj: string | null }[];
  vinculos_fornecedor: { cnpj_fornecedor: string; cprod: string; codigo_pai: string | null }[];
  pedidos_compra: PedidoRow[];
}

export interface DadosReposicao {
  config: { prazo: number; cobertura: number };
  entrada: EntradaCalculo;
  /** Só SKUs e famílias que não são kit (kit não é item a comprar). */
  skus: SkuTela[];
  familias: FamiliaTela[];
  naoRepor: NaoReporDTO[];
  /** Todos os pedidos da org, rascunhos inclusive; `salvoPor`/`aprovadoPor`/`alteradoPor` são ids. */
  pedidos: PedidoDTO[];
}

function falhou(onde: string, error: { message: string } | null): void {
  if (error) throw new Error(`reposicao: ${onde}: ${error.message}`);
}

const num = (v: number | string | null): number | null => (v == null ? null : Number(v));

/** Entrada do cálculo da org em `hoje` (YYYY-MM-DD, BRT). Lê 6 fontes (ver o topo do arquivo); uma fonte grande
 * vira mais de uma chamada só por paginação — nunca uma consulta por SKU, dia ou pedido. */
export async function montarEntrada(
  admin: SupabaseClient, orgId: string, hoje: string,
): Promise<EntradaCalculo | { semConfig: true }> {
  const d = await lerDados(admin, orgId, hoje);
  return 'semConfig' in d ? d : d.entrada;
}

export async function lerDados(
  admin: SupabaseClient, orgId: string, hoje: string,
): Promise<DadosReposicao | { semConfig: true }> {
  // 1. Tudo o que é pequeno e da org numa consulta. `fornecedores` com dica de FK: pedidos_compra liga
  // organizations a fornecedores e deixaria o embed ambíguo.
  const { data: orgData, error: orgErr } = await admin.from('organizations').select(
    'reposicao_config(prazo_dias, cobertura_dias), reposicao_nao_repor(id, escopo, codigo_pai, codigo, cor), '
      + 'fornecedores!fornecedores_org_id_fkey(id, nome, nome_normalizado, cnpj), '
      + 'vinculos_fornecedor(cnpj_fornecedor, cprod, codigo_pai), '
      + 'pedidos_compra(id, fornecedor_id, status, previsto_para, salvo_por, salvo_em, aprovado_por, enviado_em, '
      + 'alterado_por, alterado_em, pedidos_compra_itens(codigo, codigo_pai, quantidade, sugerida, recebida, encerrado))',
  ).eq('id', orgId).maybeSingle();
  falhou('organizations', orgErr);
  const org = orgData as OrgRow | null;
  const cfgBruta = Array.isArray(org?.reposicao_config) ? org!.reposicao_config[0] : org?.reposicao_config;
  if (!org || !cfgBruta) return { semConfig: true };
  const config = { prazo: cfgBruta.prazo_dias, cobertura: cfgBruta.cobertura_dias };

  const ini = somarDias(hoje, -JANELA);
  const desde = `${ini}T00:00:00-03:00`;
  const [variacoes, movsBrutos, vendas, anuncios, kitsVariacao] = await Promise.all([
    // 2.
    // `familias!inner` é muitos-para-um (objeto); o tipo inferido sem schema diz array.
    paginarTudo((de, ate) => admin.from('variacoes')
      .select('codigo, cor, cor_hex, tamanho, estoque, custo, preco, familia_id, familias!inner(id, codigo_pai, nome_pai, fornecedor, multiplo_compra, kit_base_codigo_pai, kit_multiplicador, criado_em)')
      .eq('org_id', orgId).order('id').range(de, ate)).then((r) => r as unknown as VariacaoRow[]),
    // 3. Até agora (não só até ontem): sem isso, um movimento de hoje faria o SKU parecer parado a janela toda.
    // Sem piso de data: o que vem antes da janela só diz quem já teve algum movimento (`nuncaMovimentado`).
    // ponytail: lê o ledger inteiro da org (existe desde 07/2026); se pesar, trocar por RPC com distinct codigo antes da janela.
    paginarTudo<MovRow>((de, ate) => admin.from('estoque_movimentos')
      .select('codigo, motivo, quantidade, quantidade_pedida, estoque_anterior, estoque_resultante, referencia_externa, transferencia_id, origem_kit_codigo_pai, criado_em, ordem')
      .eq('org_id', orgId).order('criado_em').order('id').range(de, ate)),
    // 4. Um dia de folga antes da janela: a order fecha antes de o movimento nascer.
    paginarTudo<{ order_id: number | string; ml_vendas_itens: { codigo: string | null; unit_price: number | string | null }[] }>(
      (de, ate) => admin.from('ml_vendas').select('order_id, ml_vendas_itens(codigo, unit_price)')
        .eq('org_id', orgId).gte('date_closed', `${somarDias(ini, -1)}T00:00:00-03:00`).order('id').range(de, ate),
    ),
    // 5.
    paginarTudo<{ codigo_pai: string; publicado_em: string | null }>((de, ate) => admin.from('anuncios_externos')
      .select('codigo_pai, publicado_em').eq('org_id', orgId).eq('canal', 'mercado_livre').order('id').range(de, ate)),
    // 6.
    paginarTudo<{ codigo_pai_kit: string; kit_variacao_skus: { codigo: string; kit_variacao_componentes: { codigo: string; quantidade: number }[] }[] }>(
      (de, ate) => admin.from('kits_variacao')
        .select('codigo_pai_kit, kit_variacao_skus(codigo, kit_variacao_componentes(codigo, quantidade))')
        .eq('org_id', orgId).order('id').range(de, ate),
    ),
  ]);

  // Família canônica por codigo_pai = a criada por último (nome, fornecedor e múltiplo de compra; regra de
  // `variacoes_estoque_produto`). UPDATE de planilha duplica família e variações.
  const recente = familiaMaisRecente;
  const canonica = new Map<string, FamiliaRow>();
  for (const v of variacoes) {
    const f = v.familias;
    const atual = canonica.get(f.codigo_pai);
    if (!atual || recente(f, atual)) canonica.set(f.codigo_pai, f);
  }
  // SKU: uma linha por CÓDIGO, a da família mais recente que o contém (mesma regra de `registrar_entrada`):
  // um SKU que saiu da planilha nova continua existindo pela família antiga.
  const porCodigo = new Map<string, VariacaoRow>();
  for (const v of variacoes) {
    const atual = porCodigo.get(v.codigo);
    if (!atual || recente(v.familias, atual.familias)) porCodigo.set(v.codigo, v);
  }
  const skusRow = [...porCodigo.values()];
  const doPai = new Map<string, VariacaoRow[]>();
  for (const v of skusRow) {
    if (!doPai.has(v.familias.codigo_pai)) doPai.set(v.familias.codigo_pai, []);
    doPai.get(v.familias.codigo_pai)!.push(v);
  }

  // Quem já teve algum movimento de estoque, em qualquer data (emenda 17/11: "Completar grade").
  const comMovimento = new Set(movsBrutos.map((m) => m.codigo));
  // Movimentos da janela, em ordem do ledger.
  const inicioJanela = Date.parse(desde);
  const movs = movsBrutos.filter((m) => Date.parse(m.criado_em) >= inicioJanela).sort((a, b) =>
    Date.parse(a.criado_em) - Date.parse(b.criado_em) || (a.ordem ?? Infinity) - (b.ordem ?? Infinity));
  // Cancelamento = estorno_venda com a mesma referência da venda (sem o prefixo). Pela referência
  // inteira: no kit vinculado o movimento é da base, mas a ref termina no código do kit.
  const cancelados = new Set(movs.filter((m) => m.motivo === 'estorno_venda' && m.referencia_externa)
    .map((m) => m.referencia_externa!.replace(/^estorno:/, '')));
  const preco = new Map<string, number>();
  for (const v of vendas) {
    for (const i of v.ml_vendas_itens ?? []) {
      if (i.codigo && i.unit_price != null) preco.set(`${v.order_id}:${i.codigo}`, Number(i.unit_price));
    }
  }

  // KitLinks, por prioridade: composição do kit com variação → transferência inequívoca (1 saída e
  // 1 entrada) → kit vinculado com base de 1 SKU. Um kit resolvido por uma fonte não entra pelas
  // seguintes, e o par (kit, base) nunca repete — o cálculo soma por link.
  const kits: KitLink[] = [];
  const kitsResolvidos = new Set<string>();
  const addFonte = (links: KitLink[]) => {
    const daFonte = new Set<string>();
    for (const l of links) {
      if (kitsResolvidos.has(l.kitCodigo) || !(l.unidadesPorKit > 0)) continue;
      if (!kits.some((k) => k.kitCodigo === l.kitCodigo && k.baseCodigo === l.baseCodigo)) kits.push(l);
      daFonte.add(l.kitCodigo);
    }
    for (const c of daFonte) kitsResolvidos.add(c);
  };
  addFonte(kitsVariacao.flatMap((k) => (k.kit_variacao_skus ?? []).flatMap((s) =>
    (s.kit_variacao_componentes ?? []).map((c) => ({ kitCodigo: s.codigo, baseCodigo: c.codigo, unidadesPorKit: c.quantidade })))));
  const transf = new Map<string, MovRow[]>();
  for (const m of movs) {
    if (m.transferencia_id && (m.motivo === 'kit_saida' || m.motivo === 'kit_entrada')) {
      transf.set(m.transferencia_id, [...(transf.get(m.transferencia_id) ?? []), m]);
    }
  }
  addFonte([...transf.values()].flatMap((ms) => {
    const s = ms.filter((m) => m.motivo === 'kit_saida');
    const e = ms.filter((m) => m.motivo === 'kit_entrada');
    return s.length === 1 && e.length === 1 && e[0].quantidade > 0
      ? [{ kitCodigo: e[0].codigo, baseCodigo: s[0].codigo, unidadesPorKit: Math.abs(s[0].quantidade) / e[0].quantidade }]
      : [];
  }));
  const familiaKit = new Set([
    ...kitsVariacao.map((k) => k.codigo_pai_kit),
    ...[...canonica.values()].filter((f) => f.kit_base_codigo_pai).map((f) => f.codigo_pai),
  ]);
  // Kit vinculado não tem saldo próprio (`variacoes.estoque` 0): o saldo do kit no dia é o da base ÷ unidades por
  // kit, para o cálculo dividir a parcela das vendas do SKU do kit pelos dias disponíveis DO KIT (ADR-0207 §4).
  const vinculado = new Map<string, KitLink>(); // kitCodigo → link
  const linksVinculado = [...canonica.values()].filter((f) => f.kit_base_codigo_pai).flatMap((f) => {
    const base = doPai.get(f.kit_base_codigo_pai!) ?? [];
    return base.length === 1
      ? (doPai.get(f.codigo_pai) ?? []).map((v) => ({ kitCodigo: v.codigo, baseCodigo: base[0].codigo, unidadesPorKit: f.kit_multiplicador ?? 1 }))
      : [];
  });
  addFonte(linksVinculado);
  for (const l of linksVinculado) {
    if (kits.includes(l)) vinculado.set(l.kitCodigo, l);
  }
  const codigosKit = new Set(kits.map((k) => k.kitCodigo));
  const ehKit = (v: VariacaoRow) => familiaKit.has(v.familias.codigo_pai) || codigosKit.has(v.codigo);
  for (const v of skusRow) if (ehKit(v) && !kitsResolvidos.has(v.codigo)) console.warn(`reposicao: kit sem base resolvida ${v.codigo}`);

  // Não repor: o mais específico vence (SKU > cor > família).
  const naoReporDe = (v: VariacaoRow): string | null => {
    const pai = v.familias.codigo_pai;
    const r = org.reposicao_nao_repor ?? [];
    return (r.find((n) => n.escopo === 'sku' && n.codigo === v.codigo)
      ?? r.find((n) => n.escopo === 'cor' && n.codigo_pai === pai && n.cor != null && n.cor === v.cor)
      ?? r.find((n) => n.escopo === 'familia' && n.codigo_pai === pai))?.id ?? null;
  };

  const publicado = new Map<string, string>();
  for (const a of anuncios) {
    if (!a.publicado_em) continue;
    const atual = publicado.get(a.codigo_pai);
    if (!atual || Date.parse(a.publicado_em) < Date.parse(atual)) publicado.set(a.codigo_pai, a.publicado_em);
  }

  // MovDia: um por SKU e dia da janela, inclusive sem venda (dia sem linha = indisponível).
  const dias = Array.from({ length: JANELA }, (_, i) => somarDias(ini, i));
  const movsPorCodigo = new Map<string, MovRow[]>();
  for (const m of movs) {
    if (!movsPorCodigo.has(m.codigo)) movsPorCodigo.set(m.codigo, []);
    movsPorCodigo.get(m.codigo)!.push(m);
  }
  // Vendas por código e dia: demanda é o pedido, não o que baixou (D-8: `quantidade` é só o que havia em estoque).
  const vendidas = new Map<string, Map<string, number>>();
  const precos = new Map<string, Map<string, number[]>>();
  const somar = (codigo: string, d: string, un: number) => {
    if (!vendidas.has(codigo)) vendidas.set(codigo, new Map());
    vendidas.get(codigo)!.set(d, (vendidas.get(codigo)!.get(d) ?? 0) + un);
  };
  for (const m of movs) {
    if (m.motivo !== 'venda' || (m.referencia_externa && cancelados.has(m.referencia_externa))) continue;
    const d = diaBrt(new Date(m.criado_em));
    const un = Math.abs(m.quantidade_pedida ?? m.quantidade);
    // Venda de kit vinculado baixada na base (`origem_kit_codigo_pai`) já está em unidades da base: conta na base,
    // com os dias da base. Só não leva preço (o da order é o do kit). Venda no código do próprio SKU do kit vai
    // para o MovDia do kit e chega à base pelo KitLink.
    somar(m.codigo, d, un);
    if (m.origem_kit_codigo_pai) continue;
    // Preço por unidade da venda direta, casado pela order da referência.
    const order = m.referencia_externa?.startsWith('mercado_livre:') ? m.referencia_externa.split(':')[1] : null;
    const p = order ? preco.get(`${order}:${m.codigo}`) : undefined;
    if (p === undefined) continue;
    if (!precos.has(m.codigo)) precos.set(m.codigo, new Map());
    precos.get(m.codigo)!.set(d, [...(precos.get(m.codigo)!.get(d) ?? []), ...Array(un).fill(p)]);
  }

  // estoqueInicio(d) = saldo após o último movimento antes de d; sem nenhum antes, o saldo anterior ao primeiro;
  // sem movimento algum, o estoque de hoje.
  const inicio = new Map<string, number[]>();
  for (const v of skusRow) {
    const saldo = (movsPorCodigo.get(v.codigo) ?? []).filter((m) => m.estoque_resultante != null && m.estoque_anterior != null)
      .map((m) => ({ dia: diaBrt(new Date(m.criado_em)), anterior: m.estoque_anterior!, resultante: m.estoque_resultante! }));
    let atual = saldo.length ? saldo[0].anterior : (v.estoque ?? 0);
    let i = 0;
    inicio.set(v.codigo, dias.map((d) => {
      while (i < saldo.length && saldo[i].dia < d) atual = saldo[i++].resultante;
      return atual;
    }));
  }
  for (const l of vinculado.values()) {
    const base = inicio.get(l.baseCodigo)!;
    inicio.set(l.kitCodigo, base.map((e) => Math.max(0, Math.floor(e / l.unidadesPorKit))));
  }

  const movDias: MovDia[] = skusRow.flatMap((v) => dias.map((d, i) => ({
    dia: d, codigo: v.codigo, vendidas: vendidas.get(v.codigo)?.get(d) ?? 0, precos: precos.get(v.codigo)?.get(d) ?? [],
    estoqueInicio: inicio.get(v.codigo)![i],
  })));

  const skus: SkuEntrada[] = skusRow.map((v) => {
    const pub = publicado.get(v.familias.codigo_pai);
    return {
      codigo: v.codigo, codigoPai: v.familias.codigo_pai, cor: v.cor, tamanho: v.tamanho, estoqueHoje: v.estoque ?? 0,
      publicadoEm: pub ? diaBrt(new Date(pub)) : null, naoRepor: naoReporDe(v) !== null, ehKit: ehKit(v),
      nuncaMovimentado: !comMovimento.has(v.codigo),
    };
  });

  // Pedido aprovado sempre tem data (aprovar preenche); sem ela, conta como atrasado.
  const pedidosAbertos = montarPedidosAbertos((org.pedidos_compra ?? [])
    .map((p) => ({ status: p.status, previstoPara: p.previsto_para, itens: p.pedidos_compra_itens ?? [] })), hoje);

  const naoKits = skusRow.filter((v) => !ehKit(v));
  const paisCompra = [...new Set(naoKits.map((v) => v.familias.codigo_pai))];
  const multiploPorFamilia = Object.fromEntries(paisCompra.map((p) => [p, canonica.get(p)!.multiplo_compra ?? 1]));

  const fornecedorPorNome = new Map((org.fornecedores ?? []).map((f) => [f.nome_normalizado, f]));
  const fornecedorPorId = new Map((org.fornecedores ?? []).map((f) => [f.id, f]));
  const familias: FamiliaTela[] = paisCompra.map((pai) => {
    const f = canonica.get(pai)!;
    const nome = f.fornecedor?.trim() ?? '';
    const cad = nome ? fornecedorPorNome.get(normalizarNome(nome)) : undefined;
    return {
      codigoPai: pai, nome: f.nome_pai ?? pai,
      fornecedor: cad ? { id: cad.id, nome: cad.nome } : { id: null, nome },
      multiplo: f.multiplo_compra ?? 1,
    };
  });

  const pedidos: PedidoDTO[] = (org.pedidos_compra ?? []).map((p) => {
    const forn = fornecedorPorId.get(p.fornecedor_id);
    // Código do produto no fornecedor (vínculo da nota de compra).
    // Só com CNPJ do fornecedor casando: sem CNPJ, nunca o código de outro fornecedor.
    const cprod = (pai: string) => (forn?.cnpj ? (org.vinculos_fornecedor ?? []).find((vf) =>
      vf.codigo_pai === pai && vf.cnpj_fornecedor === forn.cnpj)?.cprod : null) ?? null;
    return {
      id: p.id,
      fornecedor: { id: p.fornecedor_id, nome: forn?.nome ?? '', cnpj: forn?.cnpj ?? null },
      status: p.status, previstoPara: p.previsto_para,
      atrasado: (p.status === 'enviado' || p.status === 'parcial') && !!p.previsto_para && p.previsto_para < hoje,
      salvoPor: p.salvo_por, salvoEm: p.salvo_em, aprovadoPor: p.aprovado_por, enviadoEm: p.enviado_em,
      alteradoPor: p.alterado_por, alteradoEm: p.alterado_em,
      itens: (p.pedidos_compra_itens ?? []).map((i) => ({
        codigo: i.codigo, codigoPai: i.codigo_pai, quantidade: i.quantidade, sugerida: i.sugerida, recebida: i.recebida,
        encerrado: i.encerrado, codigoFornecedor: cprod(i.codigo_pai),
      })),
    };
  });

  return {
    config,
    entrada: { hoje, prazo: config.prazo, cobertura: config.cobertura, skus, movs: movDias, kits, pedidosAbertos, multiploPorFamilia },
    skus: naoKits.map((v) => ({
      codigo: v.codigo, codigoPai: v.familias.codigo_pai, cor: v.cor, corHex: v.cor_hex, tamanho: v.tamanho,
      custo: num(v.custo), preco: num(v.preco), naoReporId: naoReporDe(v),
    })),
    familias,
    naoRepor: (org.reposicao_nao_repor ?? []).map((n) => ({ id: n.id, escopo: n.escopo, codigoPai: n.codigo_pai, codigo: n.codigo, cor: n.cor })),
    pedidos,
  };
}
