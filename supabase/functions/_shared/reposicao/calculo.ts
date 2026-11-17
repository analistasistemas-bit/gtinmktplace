// Cálculo puro da Reposição (ADR-0207). Sem imports: carregado por Deno (edge) e Vite (front).
// Datas são strings YYYY-MM-DD já em BRT; aritmética sempre em UTC.

/** `publicadoEm` é YYYY-MM-DD já em BRT. `nuncaMovimentado`: nenhum movimento de estoque, em data nenhuma
 * (emenda 17/11 do ADR-0207): fica fora da curva e da reescala e só ganha o `completarGrade`. */
export interface SkuEntrada {
  codigo: string; codigoPai: string; cor: string | null; tamanho: string | null;
  estoqueHoje: number; publicadoEm: string | null; naoRepor: boolean; ehKit: boolean; nuncaMovimentado: boolean;
}
/** `dia` é YYYY-MM-DD já em BRT. No máximo UMA linha por (codigo, dia); duplicata lança erro. */
export interface MovDia {
  dia: string; codigo: string; vendidas: number; precos: number[]; estoqueInicio: number;
}
export interface KitLink { kitCodigo: string; baseCodigo: string; unidadesPorKit: number }
export interface PedidoAberto { codigo: string; saldo: number; previstoPara: string }
/** Saldo a caminho por SKU: pedidos aprovados/enviados/parciais, item não encerrado com saldo > 0.
 * Fonte única para a edge (`dados.ts`) e o popover da tela. Sem data, conta como hoje (atrasado). */
export function montarPedidosAbertos(
  pedidos: { status: string; previstoPara: string | null; itens: { codigo: string; quantidade: number; recebida: number; encerrado: boolean }[] }[],
  hoje: string,
): PedidoAberto[] {
  return pedidos
    .filter((p) => p.status === 'aprovado' || p.status === 'enviado' || p.status === 'parcial')
    .flatMap((p) => p.itens
      .filter((i) => !i.encerrado && i.quantidade - i.recebida > 0)
      .map((i) => ({ codigo: i.codigo, saldo: i.quantidade - i.recebida, previstoPara: p.previstoPara ?? hoje })));
}
export interface EntradaCalculo {
  hoje: string; prazo: number; cobertura: number; skus: SkuEntrada[];
  movs: MovDia[]; kits: KitLink[]; pedidosAbertos: PedidoAberto[]; multiploPorFamilia: Record<string, number>;
}
export interface VelocidadeSku {
  codigo: string; propria: number; diasDisponiveis: number; unidades: number;
  w: number; usada: number; picoLimitadoEm: string[]; vendasEmOferta: number;
}
export interface TendenciaFamilia { fator: number; variacaoVendas: number }

/** Nome de fornecedor comparável: caixa, acento e espaços (ADR-0207 §19). Aqui (sem imports) para o front usar. */
export function normalizarNome(nome: string): string {
  return nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const JANELA = 60;
const DIA_MS = 86400000;

function diaNum(s: string): number {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DIA_MS;
}

function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function percentil(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = p * (s.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

function somaPor<T>(xs: T[], chave: (x: T) => string | null, valor: (x: T) => number): Map<string | null, number> {
  const m = new Map<string | null, number>();
  for (const x of xs) m.set(chave(x), (m.get(chave(x)) ?? 0) + valor(x));
  return m;
}

export function calcularVelocidades(e: EntradaCalculo): {
  porSku: Map<string, VelocidadeSku>;
  tendenciaPorFamilia: Map<string, TendenciaFamilia | null>;
  /** Velocidade pela curva sozinha (shareCor × shareTam × vFamília) do SKU nunca movimentado elegível. */
  curvaCompletar: Map<string, number>;
} {
  const fim = diaNum(e.hoje) - 1;
  const ini = fim - JANELA + 1;
  const vistos = new Set<string>();
  for (const m of e.movs) {
    const k = `${m.codigo}|${m.dia}`;
    if (vistos.has(k)) throw new Error(`MovDia duplicado para (${m.codigo}, ${m.dia})`);
    vistos.add(k);
  }
  const movs = e.movs.filter((m) => {
    const n = diaNum(m.dia);
    return n >= ini && n <= fim;
  });
  const skuPorCodigo = new Map(e.skus.map((s) => [s.codigo, s]));

  // Dias disponíveis por SKU (kits inclusos: o divisor da parcela do kit é o dele).
  const disp = new Map<string, Set<string>>();
  for (const m of movs) {
    const s = skuPorCodigo.get(m.codigo);
    if (!s?.publicadoEm || m.dia < s.publicadoEm.slice(0, 10)) continue;
    if (!(m.estoqueInicio > 0 || m.vendidas > 0)) continue;
    if (!disp.has(m.codigo)) disp.set(m.codigo, new Set());
    disp.get(m.codigo)!.add(m.dia);
  }
  const movDisp = movs.filter((m) => disp.get(m.codigo)?.has(m.dia));

  // 1. unidades diretas por SKU/dia (SKUs que não são kit)
  const diretas = new Map<string, Map<string, number>>(); // codigo -> dia -> un
  for (const m of movDisp) {
    if (skuPorCodigo.get(m.codigo)!.ehKit || m.vendidas <= 0) continue;
    if (!diretas.has(m.codigo)) diretas.set(m.codigo, new Map());
    diretas.get(m.codigo)!.set(m.dia, m.vendidas);
  }

  // 2. dia atípico no grão da família
  const picos = new Map<string, string[]>(); // codigo -> dias limitados
  const porFamilia = new Map<string, SkuEntrada[]>();
  for (const s of e.skus) {
    if (s.ehKit) continue;
    if (!porFamilia.has(s.codigoPai)) porFamilia.set(s.codigoPai, []);
    porFamilia.get(s.codigoPai)!.push(s);
  }
  for (const skus of porFamilia.values()) {
    const totais = new Map<string, number>();
    for (const s of skus) for (const [d, v] of diretas.get(s.codigo) ?? []) totais.set(d, (totais.get(d) ?? 0) + v);
    if (!totais.size) continue;
    const teto = 3 * mediana([...totais.values()]);
    for (const [d, total] of totais) {
      if (!(total > teto && total >= 4)) continue;
      const f = teto / total;
      for (const s of skus) {
        const mapa = diretas.get(s.codigo);
        if (!mapa?.has(d)) continue;
        mapa.set(d, mapa.get(d)! * f);
        if (!picos.has(s.codigo)) picos.set(s.codigo, []);
        picos.get(s.codigo)!.push(d);
      }
    }
  }

  // 3. oferta: preço ≤ 0,85 × p75 (do SKU; com < 5 vendas, da família)
  const precosSku = new Map<string, number[]>();
  for (const m of movs) {
    if (skuPorCodigo.get(m.codigo)?.ehKit) continue;
    if (!precosSku.has(m.codigo)) precosSku.set(m.codigo, []);
    precosSku.get(m.codigo)!.push(...m.precos);
  }
  const p75Familia = new Map<string, number>();
  for (const [pai, skus] of porFamilia) {
    const todos = skus.flatMap((s) => precosSku.get(s.codigo) ?? []);
    if (todos.length) p75Familia.set(pai, percentil(todos, 0.75));
  }
  const vendidasSku = new Map<string, number>();
  for (const m of movs) vendidasSku.set(m.codigo, (vendidasSku.get(m.codigo) ?? 0) + m.vendidas);
  const p75Sku = new Map<string, number>(); // percentil ordena: uma vez por SKU, não por dia
  const emOferta = new Map<string, number>(); // codigo -> unidades em oferta
  const diasOferta = new Map<string, Set<string>>(); // pai -> dias com oferta
  for (const m of movs) {
    const s = skuPorCodigo.get(m.codigo);
    if (!s || s.ehKit || !m.precos.length) continue;
    if (!p75Sku.has(m.codigo)) {
      p75Sku.set(m.codigo, (vendidasSku.get(m.codigo) ?? 0) >= 5 ? percentil(precosSku.get(m.codigo)!, 0.75) : p75Familia.get(s.codigoPai)!);
    }
    const p75 = p75Sku.get(m.codigo)!;
    const n = m.precos.filter((p) => p <= 0.85 * p75).length;
    if (!n) continue;
    emOferta.set(m.codigo, (emOferta.get(m.codigo) ?? 0) + n);
    if (!diasOferta.has(s.codigoPai)) diasOferta.set(s.codigoPai, new Set());
    diasOferta.get(s.codigoPai)!.add(m.dia);
  }

  // Parcela dos kits, por dia (também alimenta a tendência da base)
  const movDispPorCodigo = new Map<string, MovDia[]>();
  for (const m of movDisp) {
    if (!movDispPorCodigo.has(m.codigo)) movDispPorCodigo.set(m.codigo, []);
    movDispPorCodigo.get(m.codigo)!.push(m);
  }
  const kitPorBase = new Map<string, { un: number; porDia: Map<string, number>; parcela: number }>();
  for (const k of e.kits) {
    const diasKit = disp.get(k.kitCodigo);
    if (!diasKit?.size) continue;
    const acc = kitPorBase.get(k.baseCodigo) ?? { un: 0, porDia: new Map(), parcela: 0 };
    let vendasKit = 0;
    for (const m of movDispPorCodigo.get(k.kitCodigo) ?? []) {
      if (m.vendidas <= 0) continue;
      vendasKit += m.vendidas;
      acc.porDia.set(m.dia, (acc.porDia.get(m.dia) ?? 0) + m.vendidas * k.unidadesPorKit);
    }
    acc.un += vendasKit * k.unidadesPorKit;
    acc.parcela += (vendasKit * k.unidadesPorKit) / diasKit.size;
    kitPorBase.set(k.baseCodigo, acc);
  }

  // 4. velocidade própria
  const porSku = new Map<string, VelocidadeSku>();
  for (const s of e.skus) {
    if (s.ehKit) continue;
    const dias = disp.get(s.codigo)?.size ?? 0;
    const direta = [...(diretas.get(s.codigo)?.values() ?? [])].reduce((a, b) => a + b, 0);
    const kit = kitPorBase.get(s.codigo);
    const unidades = direta + (kit?.un ?? 0);
    porSku.set(s.codigo, {
      codigo: s.codigo,
      propria: (dias ? direta / dias : 0) + (kit?.parcela ?? 0),
      diasDisponiveis: dias,
      unidades,
      w: Math.min(1, unidades / 6),
      usada: 0,
      picoLimitadoEm: (picos.get(s.codigo) ?? []).sort(),
      vendasEmOferta: emOferta.get(s.codigo) ?? 0,
    });
  }

  // 5-6. curva, mistura e reescala (por família, só elegíveis)
  const tendenciaPorFamilia = new Map<string, TendenciaFamilia | null>();
  const curvaCompletar = new Map<string, number>();
  for (const [pai, todos] of porFamilia) {
    // Nunca movimentado: fora de tudo (curva, reescala, tendência), como se não existisse na família.
    const skus = todos.filter((s) => !s.nuncaMovimentado);
    const el = skus.filter((s) => !s.naoRepor);
    const vFam = el.reduce((a, s) => a + porSku.get(s.codigo)!.propria, 0);
    if (el.length && vFam > 0) {
      // valor (cor/tamanho) com < 14 dias disponíveis somados é "novo": share = 1 / nº de valores
      const shares = (chave: (s: SkuEntrada) => string | null) => {
        const prop = somaPor(el, chave, (s) => porSku.get(s.codigo)!.propria);
        const dias = somaPor(el, chave, (s) => porSku.get(s.codigo)!.diasDisponiveis);
        const n = [...prop.keys()].filter((k) => k !== null).length;
        return (s: SkuEntrada) => {
          const k = chave(s);
          if (k === null) return 1;
          // Valor que só o SKU nunca movimentado tem: share médio (sem nenhum valor entre os elegíveis, 1).
          if (!dias.has(k)) return n ? 1 / n : 1;
          return dias.get(k)! < 14 ? 1 / n : prop.get(k)! / vFam;
        };
      };
      const shareCor = shares((s) => s.cor);
      const shareTam = shares((s) => s.tamanho);
      const curvaBruta = el.map((s) => shareCor(s) * shareTam(s));
      const somaCurva = curvaBruta.reduce((a, b) => a + b, 0);
      const bruta = el.map((s, i) => {
        const v = porSku.get(s.codigo)!;
        return v.w * v.propria + (1 - v.w) * (curvaBruta[i] / somaCurva) * vFam;
      });
      const somaBruta = bruta.reduce((a, b) => a + b, 0);
      el.forEach((s, i) => { porSku.get(s.codigo)!.usada = somaBruta > 0 ? (bruta[i] * vFam) / somaBruta : 0; });
      for (const s of todos) if (s.nuncaMovimentado && !s.naoRepor) curvaCompletar.set(s.codigo, shareCor(s) * shareTam(s) * vFam);
    }
    tendenciaPorFamilia.set(pai, tendencia(skus, disp, diretas, kitPorBase, diasOferta.get(pai) ?? new Set()));
  }

  return { porSku, tendenciaPorFamilia, curvaCompletar };
}

// 7. tendência da família (só com ≥ 28 dias disponíveis; dias com oferta fora das duas janelas)
function tendencia(
  skus: SkuEntrada[],
  disp: Map<string, Set<string>>,
  diretas: Map<string, Map<string, number>>,
  kitPorBase: Map<string, { porDia: Map<string, number> }>,
  oferta: Set<string>,
): TendenciaFamilia | null {
  const diasFam = new Set<string>();
  for (const s of skus) for (const d of disp.get(s.codigo) ?? []) diasFam.add(d);
  if (diasFam.size < 28) return null;
  const dias = [...diasFam].sort();
  const un = (d: string) =>
    skus.reduce((a, s) => a + (diretas.get(s.codigo)?.get(d) ?? 0) + (kitPorBase.get(s.codigo)?.porDia.get(d) ?? 0), 0);
  const soma = (ds: string[]) => ds.reduce((a, d) => a + un(d), 0);
  const baseDias = dias.filter((d) => !oferta.has(d));
  const recDias = dias.slice(-14).filter((d) => !oferta.has(d));
  if (!baseDias.length || !recDias.length) return null;
  const base = soma(baseDias) / baseDias.length;
  const recUn = soma(recDias);
  const recente = recUn / recDias.length;
  if (base <= 0) return null;
  const acelerando = recente >= 1.3 * base && recUn >= 5;
  const esfriando = recente <= 0.7 * base && base * 14 >= 5;
  if (!acelerando && !esfriando) return null;
  return { fator: (recente + base) / (2 * base), variacaoVendas: recente / base - 1 };
}

// ---------- Tarefa 3: projeção, quantidade e urgência (ADR-0207 §9–§14) ----------

export type Urgencia = 'ruptura' | 'vai_faltar' | 'pedir_agora' | 'em_dia';
export interface SugestaoSku extends VelocidadeSku {
  codigoPai: string; estoqueHoje: number; v: number; aCaminho: number; chegaEm: string | null;
  diasDeEstoque: number | null; pedirAntesMultiplo: number; pedir: number; urgencia: Urgencia; poucoHistorico: boolean;
  /** "Completar grade" do SKU nunca movimentado (fora do `pedir` e do total da família); 0 nos demais. */
  completarGrade: number;
}
export interface ResultadoReposicao {
  skus: SugestaoSku[];
  familias: { codigoPai: string; pedir: number; pedirAntesMultiplo: number; tendencia: TendenciaFamilia | null; urgencia: Urgencia }[];
  pctEstimadoPelaFamilia: number;
}

const EPS = 1e-9;
const ORDEM_URGENCIA: Urgencia[] = ['ruptura', 'vai_faltar', 'pedir_agora', 'em_dia'];

/** Menor k com P(X ≤ k) ≥ p (soma acumulada); média > 500 usa aproximação normal. */
export function quantilPoisson(media: number, p: number): number {
  if (media <= 0) return 0;
  if (media > 500) return Math.ceil(media + 1.0364 * Math.sqrt(media));
  let pmf = Math.exp(-media);
  let acc = pmf;
  let k = 0;
  while (acc < p - EPS) { k++; pmf *= media / k; acc += pmf; }
  return k;
}

export function projetarSku(p: {
  v: number; estoqueHoje: number; pedidos: PedidoAberto[]; hoje: string; prazo: number; cobertura: number;
}): { E: number[]; disp: number; falta: number; diasDeEstoque: number | null } {
  const H = p.prazo + p.cobertura;
  const chegadas = new Array<number>(H + 1).fill(0);
  for (const o of p.pedidos) {
    const d = Math.max(1, diaNum(o.previstoPara) - diaNum(p.hoje));
    if (d <= H) chegadas[d] += o.saldo;
  }
  const E = [p.estoqueHoje];
  for (let d = 1; d <= H; d++) E.push(Math.max(0, E[d - 1] - p.v) + chegadas[d]);
  let disp = E[p.prazo];
  for (let d = p.prazo + 1; d <= H; d++) disp += chegadas[d];
  const falta = Math.max(0, p.v * p.cobertura - disp);
  const z = E.findIndex((x) => x <= EPS);
  return { E, disp, falta, diasDeEstoque: z < 0 ? null : z };
}

export function fecharFamilia(
  itens: { codigo: string; v: number; falta: number; vendeu30: boolean; ePrazo: number; naoRepor: boolean }[],
  cobertura: number,
  multiplo: number,
): Map<string, { antes: number; pedir: number; antesSku: number }> {
  if (!Number.isFinite(multiplo) || multiplo < 1) multiplo = 1;
  const lambda = itens.reduce((a, i) => a + i.v * cobertura, 0);
  const folga = Math.max(0, quantilPoisson(lambda, 0.85) - lambda);
  const somaV = itens.filter((i) => i.falta > EPS && !i.naoRepor).reduce((a, i) => a + i.v, 0);
  const alvos = itens.map((i) => {
    if (i.naoRepor) return 0;
    const parcela = i.falta > EPS && somaV > 0 ? (folga * i.v) / somaV : 0;
    const alvo = i.falta + parcela;
    return i.vendeu30 && i.ePrazo <= EPS ? Math.max(1, alvo) : alvo;
  });
  // Piso: nunca menos que a falta do próprio SKU (senão o recálculo pós-aprovação a reencontra).
  const pedir = alvos.map((a, k) => (itens[k].naoRepor ? 0 : Math.max(Math.floor(a + EPS), Math.ceil(itens[k].falta - EPS), 0)));
  const somaPisos = pedir.reduce((a, x) => a + x, 0);
  const antes = Math.max(Math.ceil(alvos.reduce((a, x) => a + x, 0) - EPS), somaPisos);
  const total = Math.ceil(antes / multiplo - EPS) * multiplo;
  let sobra = total - somaPisos;
  // 1) unidades até o arredondamento do alvo: maior resto, só SKUs com alvo > 0
  const porResto = itens
    .map((i, idx) => ({ idx, resto: alvos[idx] - pedir[idx], v: i.v }))
    .filter((c) => alvos[c.idx] > EPS && c.resto > EPS)
    .sort((a, b) => b.resto - a.resto || b.v - a.v);
  for (const c of porResto) {
    if (sobra <= 0) break;
    pedir[c.idx]++;
    sobra--;
  }
  // 2) excedente do múltiplo: só quem vende (v > 0), na proporção de v; sem ninguém, quem tem alvo
  if (sobra > 0) {
    let rec = itens.map((i, idx) => ({ idx, v: i.v })).filter((c) => c.v > EPS && !itens[c.idx].naoRepor);
    if (!rec.length) rec = itens.map((_i, idx) => ({ idx, v: 1 })).filter((c) => alvos[c.idx] > EPS);
    const soma = rec.reduce((a, c) => a + c.v, 0);
    const q = rec.map((c) => ({ ...c, cota: (sobra * c.v) / soma }));
    let resto = sobra;
    for (const c of q) { const f = Math.floor(c.cota + EPS); pedir[c.idx] += f; resto -= f; }
    q.sort((a, b) => (b.cota - Math.floor(b.cota + EPS)) - (a.cota - Math.floor(a.cota + EPS)) || b.v - a.v);
    for (let k = 0; resto > 0; k++, resto--) pedir[q[k % q.length].idx]++;
  }
  return new Map(itens.map((i, idx) => [i.codigo, { antes, pedir: pedir[idx], antesSku: Math.max(0, Math.ceil(alvos[idx] - EPS)) }]));
}

export function calcularReposicao(e: EntradaCalculo): ResultadoReposicao {
  const { porSku, tendenciaPorFamilia, curvaCompletar } = calcularVelocidades(e);
  const hojeN = diaNum(e.hoje);
  // Vendeu nos últimos 30 dias (direto ou por um kit que o contém): um passe só sobre os movimentos.
  const venderam30 = new Set<string>();
  for (const m of e.movs) {
    if (m.vendidas > 0 && diaNum(m.dia) >= hojeN - 30 && diaNum(m.dia) < hojeN) venderam30.add(m.codigo);
  }
  const vendeu30 = new Set(venderam30);
  for (const k of e.kits) if (venderam30.has(k.kitCodigo)) vendeu30.add(k.baseCodigo);
  const pedidosPor = new Map<string, PedidoAberto[]>();
  for (const o of e.pedidosAbertos) {
    if (!pedidosPor.has(o.codigo)) pedidosPor.set(o.codigo, []);
    pedidosPor.get(o.codigo)!.push(o);
  }
  const porPai = new Map<string, SkuEntrada[]>();
  for (const s of e.skus) {
    if (s.ehKit) continue;
    if (!porPai.has(s.codigoPai)) porPai.set(s.codigoPai, []);
    porPai.get(s.codigoPai)!.push(s);
  }
  const skus: SugestaoSku[] = [];
  const familias: ResultadoReposicao['familias'] = [];
  for (const [pai, lista] of porPai) {
    const fator = tendenciaPorFamilia.get(pai)?.fator ?? 1;
    const proj = lista.map((s) => {
      const vel = porSku.get(s.codigo)!;
      const v = s.nuncaMovimentado ? 0 : vel.usada * fator;
      const pedidos = pedidosPor.get(s.codigo) ?? [];
      return { s, vel, v, pedidos, p: projetarSku({ v, estoqueHoje: s.estoqueHoje, pedidos, hoje: e.hoje, prazo: e.prazo, cobertura: e.cobertura }) };
    });
    const fechado = fecharFamilia(
      proj.map((x) => ({ codigo: x.s.codigo, v: x.v, falta: x.p.falta, vendeu30: vendeu30.has(x.s.codigo), ePrazo: x.p.E[e.prazo], naoRepor: x.s.naoRepor || x.s.nuncaMovimentado })),
      e.cobertura, e.multiploPorFamilia[pai] ?? 1,
    );
    const doPai: SugestaoSku[] = proj.map(({ s, vel, v, pedidos, p }) => {
      const { antesSku, pedir } = fechado.get(s.codigo)!;
      const vaiFaltar = v > EPS && p.E.slice(1, e.prazo).some((x) => x <= EPS);
      const urgencia: Urgencia = s.estoqueHoje <= EPS && v > EPS ? 'ruptura' : vaiFaltar ? 'vai_faltar' : pedir > 0 ? 'pedir_agora' : 'em_dia';
      const datas = pedidos.map((o) => o.previstoPara).sort();
      const curva = curvaCompletar.get(s.codigo) ?? 0;
      return {
        ...vel, codigoPai: pai, estoqueHoje: s.estoqueHoje, v,
        aCaminho: pedidos.reduce((a, o) => a + o.saldo, 0), chegaEm: datas[0] ?? null,
        diasDeEstoque: p.diasDeEstoque, pedirAntesMultiplo: antesSku, pedir, urgencia, poucoHistorico: !s.nuncaMovimentado && vel.w < 1,
        completarGrade: curva > EPS ? Math.max(1, Math.ceil(curva * e.cobertura - EPS)) : 0,
      };
    });
    skus.push(...doPai);
    familias.push({
      codigoPai: pai,
      pedir: doPai.reduce((a, x) => a + x.pedir, 0),
      pedirAntesMultiplo: fechado.values().next().value?.antes ?? 0,
      tendencia: tendenciaPorFamilia.get(pai) ?? null,
      urgencia: ORDEM_URGENCIA.find((u) => doPai.some((x) => x.urgencia === u)) ?? 'em_dia',
    });
  }
  const comVenda = skus.filter((s) => s.unidades > 0);
  return {
    skus, familias,
    pctEstimadoPelaFamilia: comVenda.length ? comVenda.filter((s) => s.w < 1).length / comVenda.length : 0,
  };
}
