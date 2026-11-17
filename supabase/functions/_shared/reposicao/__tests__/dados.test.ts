import { describe, it, expect, vi } from 'vitest';
import { montarEntrada, lerDados } from '../dados';
import { calcularReposicao, calcularVelocidades, type EntradaCalculo } from '../calculo';

// Fake mínimo do PostgREST: as linhas já vêm com os embeds aninhados (é o que o PostgREST devolve);
// filtros eq/gte valem no nível de cima. Registra cada consulta executada (página = consulta).
type Linha = Record<string, any>;
function fakeAdmin(tabelas: Record<string, Linha[]>) {
  const consultas: string[] = [];
  const admin: any = {
    consultas,
    from: (tabela: string) => {
      const preds: Array<(r: Linha) => boolean> = [];
      let faixa: [number, number] | null = null;
      const run = () => {
        consultas.push(tabela);
        const linhas = (tabelas[tabela] ?? []).filter((r) => preds.every((p) => p(r)));
        return { data: faixa ? linhas.slice(faixa[0], faixa[1] + 1) : linhas, error: null };
      };
      const c: any = {
        select: () => c,
        eq: (k: string, v: unknown) => { preds.push((r) => r[k] === v); return c; },
        gte: (k: string, v: string) => { preds.push((r) => r[k] != null && Date.parse(r[k]) >= Date.parse(v)); return c; },
        order: () => c,
        range: (a: number, b: number) => { faixa = [a, b]; return c; },
        maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      };
      return c;
    },
  };
  return admin;
}

const ORG = 'org-1';
const HOJE = '2026-11-16'; // janela: 2026-09-17 .. 2026-11-15

const fam = (id: string, codigoPai: string, extra: Linha = {}) => ({
  id, codigo_pai: codigoPai, nome_pai: `Produto ${codigoPai}`, fornecedor: 'Fornecedor X', multiplo_compra: 1,
  kit_base_codigo_pai: null, kit_multiplicador: null, criado_em: '2026-01-01T00:00:00Z', ...extra,
});
const vari = (codigo: string, f: Linha, extra: Linha = {}) => ({
  org_id: ORG, codigo, cor: null, cor_hex: null, tamanho: null, estoque: 0, custo: 10, preco: 20, familia_id: f.id, familias: f, ...extra,
});
let seq = 0;
const mov = (codigo: string, motivo: string, criadoEm: string, extra: Linha = {}) => ({
  org_id: ORG, id: `m${++seq}`, codigo, motivo, quantidade: 0, quantidade_pedida: null, estoque_anterior: null,
  estoque_resultante: null, referencia_externa: null, transferencia_id: null, origem_kit_codigo_pai: null,
  criado_em: criadoEm, ordem: seq, ...extra,
});
const venda = (codigo: string, order: string, criadoEm: string, q: number, ant: number, extra: Linha = {}) =>
  mov(codigo, 'venda', criadoEm, {
    referencia_externa: `mercado_livre:${order}:${codigo}`, quantidade: -Math.min(q, ant), quantidade_pedida: q,
    estoque_anterior: ant, estoque_resultante: Math.max(0, ant - q), ...extra,
  });

function org(extra: Linha = {}) {
  return {
    id: ORG, reposicao_config: { prazo_dias: 15, cobertura_dias: 30 }, reposicao_nao_repor: [], fornecedores: [],
    vinculos_fornecedor: [], pedidos_compra: [], ...extra,
  };
}

const F = fam('f1', 'P1');
function base(extra: Record<string, Linha[]> = {}) {
  return {
    organizations: [org()],
    variacoes: [vari('A', F, { estoque: 3 })],
    estoque_movimentos: [],
    ml_vendas: [],
    anuncios_externos: [{ org_id: ORG, codigo_pai: 'P1', canal: 'mercado_livre', publicado_em: '2026-09-01T12:00:00Z' }],
    kits_variacao: [],
    ...extra,
  };
}

async function entrada(tabelas: Record<string, Linha[]>): Promise<EntradaCalculo> {
  const r = await montarEntrada(fakeAdmin(tabelas), ORG, HOJE);
  if ('semConfig' in r) throw new Error('semConfig inesperado');
  return r;
}
const dia = (e: EntradaCalculo, codigo: string, d: string) => e.movs.find((m) => m.codigo === codigo && m.dia === d)!;

describe('montarEntrada', () => {
  it('sem reposicao_config → { semConfig: true }', async () => {
    const admin = fakeAdmin(base({ organizations: [org({ reposicao_config: null })] }));
    expect(await montarEntrada(admin, ORG, HOJE)).toEqual({ semConfig: true });
    expect(admin.consultas).toEqual(['organizations']);
  });

  it('um MovDia por SKU para cada um dos 60 dias, inclusive sem venda; prazo e cobertura da config', async () => {
    const e = await entrada(base());
    expect(e.prazo).toBe(15);
    expect(e.cobertura).toBe(30);
    const dias = e.movs.filter((m) => m.codigo === 'A').map((m) => m.dia);
    expect(dias.length).toBe(60);
    expect(dias[0]).toBe('2026-09-17');
    expect(dias[59]).toBe('2026-11-15');
    // sem movimento nenhum, o estoque de todo dia é o de hoje
    expect(new Set(e.movs.map((m) => m.estoqueInicio))).toEqual(new Set([3]));
    expect(e.skus[0]).toMatchObject({ codigo: 'A', codigoPai: 'P1', estoqueHoje: 3, publicadoEm: '2026-09-01', ehKit: false, naoRepor: false });
  });

  it('estoqueInicio pelo ledger, em dia BRT (01:00Z é o dia anterior)', async () => {
    const e = await entrada(base({
      estoque_movimentos: [
        mov('A', 'entrada', '2026-10-10T01:00:00Z', { quantidade: 5, estoque_anterior: 0, estoque_resultante: 5 }), // BRT 09/10 22h
        venda('A', '111', '2026-10-20T15:00:00Z', 2, 5),
        mov('A', 'ajuste', '2026-11-16T10:00:00Z', { quantidade: 0, estoque_anterior: 3, estoque_resultante: 3 }), // hoje
      ],
    }));
    expect(dia(e, 'A', '2026-10-09').estoqueInicio).toBe(0);
    expect(dia(e, 'A', '2026-10-10').estoqueInicio).toBe(5);
    expect(dia(e, 'A', '2026-10-20').estoqueInicio).toBe(5);
    expect(dia(e, 'A', '2026-10-21').estoqueInicio).toBe(3);
    expect(dia(e, 'A', '2026-09-17').estoqueInicio).toBe(0);
  });

  it('venda com quantidade_pedida 5 e quantidade −2 conta 5', async () => {
    const e = await entrada(base({ estoque_movimentos: [venda('A', '222', '2026-11-01T15:00:00Z', 5, 2)] }));
    expect(dia(e, 'A', '2026-11-01').vendidas).toBe(5);
  });

  it('par venda/estorno some (os dois), e cancelamento_sem_baixa não mexe em nada', async () => {
    const e = await entrada(base({
      estoque_movimentos: [
        venda('A', '333', '2026-11-01T15:00:00Z', 1, 4),
        mov('A', 'estorno_venda', '2026-11-02T15:00:00Z', {
          referencia_externa: 'estorno:mercado_livre:333:A', quantidade: 1, estoque_anterior: 3, estoque_resultante: 4,
        }),
        venda('A', '444', '2026-11-03T15:00:00Z', 1, 4),
        mov('A', 'cancelamento_sem_baixa', '2026-11-04T15:00:00Z', { referencia_externa: 'estorno:mercado_livre:999:A' }),
      ],
    }));
    expect(dia(e, 'A', '2026-11-01').vendidas).toBe(0);
    expect(dia(e, 'A', '2026-11-03').vendidas).toBe(1);
    expect(dia(e, 'A', '2026-11-04').estoqueInicio).toBe(3);
    expect(dia(e, 'A', '2026-11-05').estoqueInicio).toBe(3); // linha sem saldo não quebra a cadeia
  });

  it('ref parseada: preço do item da order, um por unidade; sem casar, sem preço', async () => {
    const e = await entrada(base({
      estoque_movimentos: [venda('A', '555', '2026-11-01T15:00:00Z', 2, 5), venda('A', '666', '2026-11-02T15:00:00Z', 1, 3)],
      ml_vendas: [{ org_id: ORG, date_closed: '2026-11-01T14:00:00Z', order_id: 555, ml_vendas_itens: [{ codigo: 'A', unit_price: '39.9' }] }],
    }));
    expect(dia(e, 'A', '2026-11-01').precos).toEqual([39.9, 39.9]);
    expect(dia(e, 'A', '2026-11-02').precos).toEqual([]);
  });

  it('kit vinculado: venda baixada na base (origem_kit) conta na base, sem preço; saldo do kit = base ÷ unidades', async () => {
    const K = fam('fk', 'PK', { kit_base_codigo_pai: 'P1', kit_multiplicador: 4 });
    const e = await entrada(base({
      variacoes: [vari('A', F, { estoque: 8 }), vari('K', K)],
      estoque_movimentos: [venda('A', '777', '2026-11-01T15:00:00Z', 4, 12, {
        referencia_externa: 'mercado_livre:777:K', origem_kit_codigo_pai: 'PK',
      })],
      ml_vendas: [{ org_id: ORG, date_closed: '2026-11-01T14:00:00Z', order_id: 777, ml_vendas_itens: [{ codigo: 'K', unit_price: '59.9' }, { codigo: 'A', unit_price: '19.9' }] }],
    }));
    expect(dia(e, 'A', '2026-11-01')).toMatchObject({ vendidas: 4, precos: [], estoqueInicio: 12 });
    expect(dia(e, 'K', '2026-11-01')).toMatchObject({ vendidas: 0, precos: [], estoqueInicio: 3 });
    expect(dia(e, 'K', '2026-11-02').estoqueInicio).toBe(2); // 8 ÷ 4
    expect(e.kits).toEqual([{ kitCodigo: 'K', baseCodigo: 'A', unidadesPorKit: 4 }]);
    expect(e.skus.find((s) => s.codigo === 'K')!.ehKit).toBe(true);
  });

  it('venda no código do SKU do kit: parcela na base dividida pelos dias disponíveis DO KIT (10/10 = 1/dia, não 10/60)', async () => {
    const K = fam('fk', 'PK', { kit_base_codigo_pai: 'P1', kit_multiplicador: 2 });
    const dias = ['2026-11-06', '2026-11-08', '2026-11-10', '2026-11-12', '2026-11-14'];
    const e = await entrada(base({
      variacoes: [vari('A', F, { estoque: 90 }), vari('K', K)],
      anuncios_externos: [
        { org_id: ORG, codigo_pai: 'P1', canal: 'mercado_livre', publicado_em: '2026-09-01T12:00:00Z' },
        { org_id: ORG, codigo_pai: 'PK', canal: 'mercado_livre', publicado_em: '2026-11-06T12:00:00Z' },
      ],
      estoque_movimentos: dias.map((d, i) => venda('K', `9${i}`, `${d}T15:00:00Z`, 1, 1)),
    }));
    const v = calcularVelocidades(e).porSku.get('A')!;
    expect(v.diasDisponiveis).toBe(60);
    expect(v.propria).toBeCloseTo(1, 10); // 5 kits × 2 un ÷ 10 dias do kit
    expect(v.unidades).toBe(10);
  });

  it('venda com origem_kit_codigo_pai conta na base com o divisor da base (10/60), sem parcela de kit', async () => {
    const K = fam('fk', 'PK', { kit_base_codigo_pai: 'P1', kit_multiplicador: 2 });
    const dias = ['2026-11-06', '2026-11-08', '2026-11-10', '2026-11-12', '2026-11-14'];
    const e = await entrada(base({
      variacoes: [vari('A', F, { estoque: 90 }), vari('K', K)],
      anuncios_externos: [
        { org_id: ORG, codigo_pai: 'P1', canal: 'mercado_livre', publicado_em: '2026-09-01T12:00:00Z' },
        { org_id: ORG, codigo_pai: 'PK', canal: 'mercado_livre', publicado_em: '2026-11-06T12:00:00Z' },
      ],
      estoque_movimentos: dias.map((d, i) => venda('A', `9${i}`, `${d}T15:00:00Z`, 2, 100 - 2 * i, {
        referencia_externa: `mercado_livre:9${i}:K`, origem_kit_codigo_pai: 'PK',
      })),
    }));
    const v = calcularVelocidades(e).porSku.get('A')!;
    expect(v.diasDisponiveis).toBe(60);
    expect(v.propria).toBeCloseTo(10 / 60, 10);
    expect(e.movs.filter((m) => m.codigo === 'K').every((m) => m.vendidas === 0)).toBe(true);
  });

  it('par de transferência 1:1 vira KitLink 2:1; transferência ambígua (N:M) não', async () => {
    const FK = fam('fk', 'PK');
    const e = await entrada(base({
      variacoes: [vari('A', F, { estoque: 8 }), vari('B', F), vari('K', FK), vari('K2', FK)],
      estoque_movimentos: [
        mov('A', 'kit_saida', '2026-11-01T15:00:00Z', { transferencia_id: 't1', quantidade: -2, estoque_anterior: 10, estoque_resultante: 8 }),
        mov('K', 'kit_entrada', '2026-11-01T15:00:00Z', { transferencia_id: 't1', quantidade: 1, estoque_anterior: 0, estoque_resultante: 1 }),
        mov('A', 'kit_saida', '2026-11-02T15:00:00Z', { transferencia_id: 't2', quantidade: -1, estoque_anterior: 8, estoque_resultante: 7 }),
        mov('B', 'kit_saida', '2026-11-02T15:00:00Z', { transferencia_id: 't2', quantidade: -1, estoque_anterior: 1, estoque_resultante: 0 }),
        mov('K2', 'kit_entrada', '2026-11-02T15:00:00Z', { transferencia_id: 't2', quantidade: 1, estoque_anterior: 0, estoque_resultante: 1 }),
      ],
    }));
    expect(e.kits).toEqual([{ kitCodigo: 'K', baseCodigo: 'A', unidadesPorKit: 2 }]);
    expect(e.skus.find((s) => s.codigo === 'K')!.ehKit).toBe(true);
    // transferência não é venda
    expect(e.movs.every((m) => m.vendidas === 0)).toBe(true);
  });

  it('kit com variação: KitLink pela composição, sem duplicar com a transferência do mesmo par', async () => {
    const FK = fam('fk', 'PK');
    const e = await entrada(base({
      variacoes: [vari('A', F, { estoque: 8 }), vari('K', FK)],
      estoque_movimentos: [
        mov('A', 'kit_saida', '2026-11-01T15:00:00Z', { transferencia_id: 't1', quantidade: -2, estoque_anterior: 10, estoque_resultante: 8 }),
        mov('K', 'kit_entrada', '2026-11-01T15:00:00Z', { transferencia_id: 't1', quantidade: 1, estoque_anterior: 0, estoque_resultante: 1 }),
      ],
      kits_variacao: [{ org_id: ORG, codigo_pai_kit: 'PK', kit_variacao_skus: [{ codigo: 'K', kit_variacao_componentes: [{ codigo: 'A', quantidade: 2 }] }] }],
    }));
    expect(e.kits).toEqual([{ kitCodigo: 'K', baseCodigo: 'A', unidadesPorKit: 2 }]);
  });

  it('kit sem base resolvida fica fora da conta com aviso', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const K = fam('fk', 'PK', { kit_base_codigo_pai: 'P1', kit_multiplicador: 2 });
    const e = await entrada(base({ variacoes: [vari('A', F), vari('B', F), vari('K', K)] }));
    expect(e.kits).toEqual([]);
    expect(e.skus.find((s) => s.codigo === 'K')!.ehKit).toBe(true);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('K'));
    aviso.mockRestore();
  });

  it('UPDATE duplica as variações: um SKU por código, da família mais recente que o contém (B só na antiga continua)', async () => {
    const velha = fam('f0', 'P1', { criado_em: '2025-01-01T00:00:00Z', multiplo_compra: 6 });
    const e = await entrada(base({
      variacoes: [vari('A', velha, { estoque: 99 }), vari('B', velha, { estoque: 7 }), vari('A', F, { estoque: 3 })],
    }));
    expect(e.skus.map((s) => [s.codigo, s.estoqueHoje])).toEqual([['A', 3], ['B', 7]]);
    expect(e.multiploPorFamilia).toEqual({ P1: 1 }); // dados da família vêm da mais recente
  });

  it('rascunho e item encerrado ficam fora de pedidosAbertos; saldo = quantidade − recebida', async () => {
    const it_ = (codigo: string, quantidade: number, recebida: number, encerrado = false) =>
      ({ codigo, codigo_pai: 'P1', quantidade, sugerida: null, recebida, encerrado });
    const ped = (id: string, status: string, itens: Linha[]) => ({
      id, fornecedor_id: 'fo1', status, previsto_para: '2026-11-30', salvo_por: null, salvo_em: null, aprovado_por: null,
      enviado_em: null, alterado_por: null, alterado_em: null, pedidos_compra_itens: itens,
    });
    const e = await entrada(base({
      organizations: [org({
        fornecedores: [{ id: 'fo1', nome: 'Fornecedor X', nome_normalizado: 'fornecedor x', cnpj: null }],
        pedidos_compra: [
          ped('r', 'rascunho', [it_('A', 9, 0)]),
          ped('p1', 'parcial', [it_('A', 10, 4), it_('B', 5, 0, true), it_('C', 3, 3)]),
          ped('p2', 'recebido', [it_('A', 2, 1)]),
        ],
      })],
    }));
    expect(e.pedidosAbertos).toEqual([{ codigo: 'A', saldo: 6, previstoPara: '2026-11-30' }]);
  });

  it('Não repor de cor marca só os SKUs daquela cor', async () => {
    const e = await entrada(base({
      organizations: [org({ reposicao_nao_repor: [{ id: 'n1', escopo: 'cor', codigo_pai: 'P1', codigo: null, cor: 'Azul' }] })],
      variacoes: [vari('A', F, { cor: 'Azul' }), vari('B', F, { cor: 'Azul', tamanho: 'G' }), vari('C', F, { cor: 'Preto' })],
    }));
    expect(Object.fromEntries(e.skus.map((s) => [s.codigo, s.naoRepor]))).toEqual({ A: true, B: true, C: false });
  });

  it('6 fontes: chamadas extras só por paginação, nunca por dia, pedido ou SKU', async () => {
    const muitas = Array.from({ length: 2500 }, (_, i) => vari(`S${i}`, F));
    const a1 = fakeAdmin(base({ variacoes: muitas }));
    await montarEntrada(a1, ORG, HOJE);
    expect(a1.consultas.filter((t: string) => t === 'variacoes')).toHaveLength(3); // 1000 + 1000 + 500
    expect(a1.consultas).toHaveLength(6 + 2);
    // mais pedidos e mais movimentos em mais dias (abaixo de uma página): mesmo número de chamadas
    const ped = (id: string) => ({ id, fornecedor_id: 'fo1', status: 'enviado', previsto_para: '2026-11-30', salvo_por: null, salvo_em: null,
      aprovado_por: null, enviado_em: null, alterado_por: null, alterado_em: null,
      pedidos_compra_itens: [{ codigo: 'S1', codigo_pai: 'P1', quantidade: 3, sugerida: null, recebida: 0, encerrado: false }] });
    const a2 = fakeAdmin(base({
      variacoes: muitas,
      organizations: [org({ pedidos_compra: Array.from({ length: 40 }, (_, i) => ped(`p${i}`)) })],
      estoque_movimentos: Array.from({ length: 50 }, (_, i) => venda(`S${i}`, `${i}`, `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T15:00:00Z`, 1, 5)),
    }));
    await montarEntrada(a2, ORG, HOJE);
    expect(a2.consultas).toHaveLength(a1.consultas.length);
  });

  it('cenário pequeno: 6 chamadas', async () => {
    const K = fam('fk', 'PK', { kit_base_codigo_pai: 'P1', kit_multiplicador: 2 });
    const admin = fakeAdmin(base({
      variacoes: [vari('A', F), vari('K', K)],
      estoque_movimentos: [venda('A', '1', '2026-11-01T15:00:00Z', 1, 3)],
      ml_vendas: [{ org_id: ORG, date_closed: '2026-11-01T14:00:00Z', order_id: 1, ml_vendas_itens: [{ codigo: 'A', unit_price: '10' }] }],
    }));
    const e = await montarEntrada(admin, ORG, HOJE);
    expect(admin.consultas).toHaveLength(6);
    // a entrada montada é aceita pelo cálculo (sem MovDia duplicado)
    expect(() => calcularReposicao(e as EntradaCalculo)).not.toThrow();
  });
});

describe('lerDados (DTOs da tela)', () => {
  it('fornecedor sem CNPJ nunca recebe o código de produto de outro fornecedor', async () => {
    const r = await lerDados(fakeAdmin(base({
      organizations: [org({
        fornecedores: [{ id: 'fo2', nome: 'Fornecedor Y', nome_normalizado: 'fornecedor y', cnpj: null }],
        vinculos_fornecedor: [{ cnpj_fornecedor: '12345678000199', cprod: 'FX-1', codigo_pai: 'P1' }],
        pedidos_compra: [{
          id: 'p2', fornecedor_id: 'fo2', status: 'aprovado', previsto_para: '2026-11-30', salvo_por: null, salvo_em: null,
          aprovado_por: null, enviado_em: null, alterado_por: null, alterado_em: null,
          pedidos_compra_itens: [{ codigo: 'A', codigo_pai: 'P1', quantidade: 2, sugerida: 2, recebida: 0, encerrado: false }],
        }],
      })],
    })), ORG, HOJE);
    if ('semConfig' in r) throw new Error('semConfig');
    expect(r.pedidos[0].itens[0].codigoFornecedor).toBeNull();
  });

  it('fornecedor da família pelo nome normalizado; pedido com código do fornecedor e atraso', async () => {
    const r = await lerDados(fakeAdmin(base({
      organizations: [org({
        fornecedores: [{ id: 'fo1', nome: 'Fornecedor X', nome_normalizado: 'fornecedor x', cnpj: '12345678000199' }],
        vinculos_fornecedor: [{ cnpj_fornecedor: '12345678000199', cprod: 'FX-1', codigo_pai: 'P1' }],
        reposicao_nao_repor: [{ id: 'n1', escopo: 'sku', codigo_pai: 'P1', codigo: 'A', cor: null }],
        pedidos_compra: [{
          id: 'p1', fornecedor_id: 'fo1', status: 'enviado', previsto_para: '2026-11-10', salvo_por: 'u1', salvo_em: null,
          aprovado_por: 'u2', enviado_em: null, alterado_por: null, alterado_em: null,
          pedidos_compra_itens: [{ codigo: 'A', codigo_pai: 'P1', quantidade: 2, sugerida: 3, recebida: 0, encerrado: false }],
        }],
      })],
      variacoes: [vari('A', fam('f1', 'P1', { fornecedor: '  FORNECEDÔR x ' }), { cor: 'Azul', cor_hex: '#00f' })],
    })), ORG, HOJE);
    if ('semConfig' in r) throw new Error('semConfig');
    expect(r.familias).toEqual([{ codigoPai: 'P1', nome: 'Produto P1', fornecedor: { id: 'fo1', nome: 'Fornecedor X' }, multiplo: 1 }]);
    expect(r.skus).toEqual([{ codigo: 'A', codigoPai: 'P1', cor: 'Azul', corHex: '#00f', tamanho: null, custo: 10, preco: 20, naoReporId: 'n1' }]);
    expect(r.pedidos[0]).toMatchObject({
      id: 'p1', fornecedor: { id: 'fo1', nome: 'Fornecedor X', cnpj: '12345678000199' }, atrasado: true,
      itens: [{ codigo: 'A', codigoPai: 'P1', quantidade: 2, sugerida: 3, recebida: 0, encerrado: false, codigoFornecedor: 'FX-1' }],
    });
  });
});
