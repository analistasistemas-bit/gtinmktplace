import { describe, expect, it } from 'vitest';
import {
  buscarConexaoPorHash, buscarPorTitulo, gravarChamada, lerLoja, listarMlbs, marcarUso, orgAtivaComModulo, vinculos,
} from '../deps-banco.ts';

const ORG = 'org-A';
type Op = [string, ...unknown[]];
type Chamada = { tabela: string; ops: Op[] };
type Res = { data: unknown; error: { message: string } | null };

/** Cliente Supabase falso: registra cada operação encadeada e responde, por tabela, na ordem da fila. */
function fake(filas: Record<string, (Res | ((c: Chamada) => Res))[]>) {
  const chamadas: Chamada[] = [];
  const admin = {
    from(tabela: string) {
      const c: Chamada = { tabela, ops: [] };
      chamadas.push(c);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'not', 'in', 'gt', 'order', 'limit', 'range', 'or', 'ilike', 'maybeSingle', 'update', 'insert']) {
        b[m] = (...a: unknown[]) => { c.ops.push([m, ...a]); return b; };
      }
      b.then = (ok: (r: Res) => unknown, falha: (e: unknown) => unknown) => {
        const prox = filas[tabela]?.shift();
        if (!prox) return Promise.reject(new Error(`sem resposta para ${tabela}`)).then(ok, falha);
        return Promise.resolve(typeof prox === 'function' ? prox(c) : prox).then(ok, falha);
      };
      return b;
    },
  };
  return { admin: admin as never, chamadas };
}
/** Resposta que aplica eq / not-is-null / in / gt da chamada sobre linhas em memória (embed por `tabela.coluna`). */
const valor = (r: unknown, k: string): unknown => k.split('.').reduce<unknown>((o, p) => {
  const x = Array.isArray(o) ? o[0] : o;
  return x == null ? undefined : (x as Record<string, unknown>)[p];
}, r);
const filtrar = (linhas: unknown[]) => (c: Chamada): Res => ({
  error: null,
  data: linhas.filter((r) => c.ops.every(([m, k, a]) => {
    if (!['eq', 'not', 'in', 'gt'].includes(m)) return true;
    const v = valor(r, k as string);
    if (m === 'eq') return v === a;
    if (m === 'not') return v != null;
    if (m === 'in') return (a as unknown[]).includes(v);
    if (m === 'gt') return typeof v === 'string' && v > (a as string);
    return true;
  })),
});
const tem = (c: Chamada, ...op: Op) => c.ops.some((o) => JSON.stringify(o) === JSON.stringify(op));
const ok = (data: unknown): Res => ({ data, error: null });
const ERRO: Res = { data: null, error: { message: 'fora' } };

describe('vinculos', () => {
  it('MLB: filhos publicados da org + anúncio pai legado, ambos filtrados por org, deduplicados por MLB', async () => {
    const { admin, chamadas } = fake({
      anuncios_externos_itens: [ok([{ item_externo_id: 'MLB1', user_product_id: 'MLBU9', family_id: '123', sku: 'S1', anuncios_externos: { codigo_pai: 'P1' } }])],
      anuncios_externos: [ok([{ item_externo_id: 'MLB1', codigo_pai: 'P1' }, { item_externo_id: 'MLB1', codigo_pai: 'P1' }])],
    });
    expect(await vinculos(admin, ORG, { mlb: 'MLB1' })).toEqual([
      { mlb: 'MLB1', mlbu: 'MLBU9', familia_ml: '123', sku: 'S1', codigo_pai: 'P1' },
    ]);
    const [itens, pais] = chamadas;
    for (const c of [itens, pais]) {
      expect(tem(c, 'eq', 'org_id', ORG)).toBe(true);
      expect(tem(c, 'eq', 'item_externo_id', 'MLB1')).toBe(true);
      expect(tem(c, 'limit', 200)).toBe(true);
    }
    expect(tem(itens, 'eq', 'retirado', false)).toBe(true);
    expect(tem(itens, 'not', 'item_externo_id', 'is', null)).toBe(true);
    expect(tem(itens, 'eq', 'anuncios_externos.status', 'publicado')).toBe(true);
    expect(tem(itens, 'eq', 'anuncios_externos.canal', 'mercado_livre')).toBe(true);
    expect(tem(pais, 'eq', 'status', 'publicado')).toBe(true);
    expect(tem(pais, 'eq', 'canal', 'mercado_livre')).toBe(true);
  });

  it('MLB de user product: pai com MLB nulo, só o filho ativo da org casa', async () => {
    const pai = { id: 'a1', codigo_pai: 'P1', canal: 'mercado_livre', status: 'publicado', item_externo_id: null };
    const filho = (mlb: string, retirado: boolean, org = ORG) => ({
      org_id: org, retirado, item_externo_id: mlb, user_product_id: `U${mlb}`, family_id: 'F', sku: `S${mlb}`, anuncios_externos: pai,
    });
    // org-B com MLB, MLBU, SKU e família próprios: a deduplicação por MLB não pode esconder um vazamento.
    const linhas = [filho('MLB1', false), filho('MLB2', true), { ...filho('MLB8', false, 'org-B'), family_id: 'FB' }];
    const paiA = { ...pai, org_id: ORG };
    const { admin } = fake({
      anuncios_externos_itens: Array.from({ length: 7 }, () => filtrar(linhas)),
      anuncios_externos: Array.from({ length: 5 }, () => filtrar([paiA])),
      variacoes: [ok([])],
    });
    expect(await vinculos(admin, ORG, { mlb: 'MLB1' })).toEqual([
      { mlb: 'MLB1', mlbu: 'UMLB1', familia_ml: 'F', sku: 'SMLB1', codigo_pai: 'P1' },
    ]);
    expect(await vinculos(admin, ORG, { mlb: 'MLB2' })).toEqual([]);
    expect(await vinculos(admin, ORG, { mlb: 'MLB8' })).toEqual([]);
    expect(await vinculos(admin, ORG, { mlbu: 'UMLB8' })).toEqual([]);
    expect(await vinculos(admin, ORG, { familia_ml: 'FB' })).toEqual([]);
    expect(await vinculos(admin, ORG, { sku: 'SMLB8' })).toEqual([]);
  });

  it('SKU: filho (UP), código pai (legado) e variação legada, deduplicado por MLB e só publicados da org', async () => {
    const { admin, chamadas } = fake({
      anuncios_externos_itens: [ok([{ item_externo_id: 'MLB1', user_product_id: 'U1', family_id: 'F1', sku: 'X', anuncios_externos: { codigo_pai: 'P1' } }])],
      anuncios_externos: [
        ok([{ item_externo_id: 'MLB2', codigo_pai: 'X' }]),
        // publicados da org entre os MLBs das variações: MLB9 (fora da org / não publicado) fica de fora
        ok([{ item_externo_id: 'MLB3' }, { item_externo_id: 'MLB2' }]),
      ],
      variacoes: [ok([
        { codigo: 'X', familias: { ml_item_id: 'MLB3', codigo_pai: 'P3' } },
        { codigo: 'X', familias: { ml_item_id: 'MLB9', codigo_pai: 'P9' } },
        { codigo: 'X', familias: { ml_item_id: 'MLB2', codigo_pai: 'X' } },
      ])],
    });
    expect(await vinculos(admin, ORG, { sku: 'X' })).toEqual([
      { mlb: 'MLB1', mlbu: 'U1', familia_ml: 'F1', sku: 'X', codigo_pai: 'P1' },
      { mlb: 'MLB2', mlbu: null, familia_ml: null, sku: 'X', codigo_pai: 'X' },
      { mlb: 'MLB3', mlbu: null, familia_ml: null, sku: 'X', codigo_pai: 'P3' },
    ]);
    const [itens, pais, vars, publicados] = chamadas;
    expect(chamadas.map((c) => c.tabela)).toEqual(['anuncios_externos_itens', 'anuncios_externos', 'variacoes', 'anuncios_externos']);
    for (const c of chamadas) {
      expect(tem(c, 'eq', 'org_id', ORG)).toBe(true);
      expect(c.ops.some(([m]) => m === 'ilike')).toBe(false);
    }
    expect(tem(itens, 'eq', 'sku', 'X')).toBe(true);
    expect(tem(pais, 'eq', 'codigo_pai', 'X')).toBe(true);
    expect(tem(pais, 'eq', 'status', 'publicado')).toBe(true);
    expect(tem(pais, 'not', 'item_externo_id', 'is', null)).toBe(true);
    expect(tem(vars, 'eq', 'codigo', 'X')).toBe(true);
    expect(tem(vars, 'not', 'familias.ml_item_id', 'is', null)).toBe(true);
    expect(tem(publicados, 'in', 'item_externo_id', ['MLB3', 'MLB9', 'MLB2'])).toBe(true);
    expect(tem(publicados, 'eq', 'status', 'publicado')).toBe(true);
  });

  it('SKU sem variação legada não consulta publicados', async () => {
    const { admin, chamadas } = fake({ anuncios_externos_itens: [ok([])], anuncios_externos: [ok([])], variacoes: [ok([])] });
    expect(await vinculos(admin, ORG, { sku: 'Y' })).toEqual([]);
    expect(chamadas).toHaveLength(3);
  });

  it.each([
    [{ mlbu: 'MLBU5' }, 'user_product_id', 'MLBU5'],
    [{ familia_ml: '999999999999' }, 'family_id', '999999999999'],
  ])('%j: só os filhos, comparação exata e filtro de org', async (filtro, coluna, valor) => {
    const { admin, chamadas } = fake({ anuncios_externos_itens: [ok([])] });
    expect(await vinculos(admin, ORG, filtro)).toEqual([]);
    expect(chamadas).toHaveLength(1);
    expect(tem(chamadas[0], 'eq', 'org_id', ORG)).toBe(true);
    expect(tem(chamadas[0], 'eq', coluna, valor)).toBe(true);
    expect(chamadas[0].ops.some(([m]) => m === 'ilike')).toBe(false);
  });

  it('erro de leitura lança', async () => {
    const { admin } = fake({ anuncios_externos_itens: [ERRO], anuncios_externos: [ok([])], variacoes: [ok([])] });
    await expect(vinculos(admin, ORG, { sku: 'X' })).rejects.toThrow();
  });
});

describe('buscarPorTitulo', () => {
  const pub = (id: string, codigo_pai: string, item_externo_id: string | null, o: object = {}) =>
    ({ id, org_id: ORG, canal: 'mercado_livre', status: 'publicado', codigo_pai, item_externo_id, ...o });
  const fam = (codigo_pai: string, nome_pai: string, o: object = {}) =>
    ({ org_id: ORG, codigo_pai, nome_pai, titulo_ml: null, criado_em: '2026-10-01', ...o });
  const filho = (anuncio_externo_id: string, sku: string, item_externo_id: string, o: object = {}) =>
    ({ org_id: ORG, retirado: false, anuncio_externo_id, sku, item_externo_id, ...o });
  const vari = (codigo: string, codigo_pai: string, cor: string | null, tamanho: string | null, o: object = {}) =>
    ({ org_id: ORG, codigo, nome: cor, cor, tamanho, familias: { org_id: ORG, codigo_pai, ml_item_id: null }, ...o });
  const VAZIA = { candidatos: [], lista_cortada: false };
  const duas = (l: unknown[]) => [filtrar(l), filtrar(l)];

  it('texto sem palavra de 3 caracteres não consulta o banco', async () => {
    const { admin, chamadas } = fake({});
    for (const t of ['***', 'G M', '4']) expect(await buscarPorTitulo(admin, ORG, t)).toEqual(VAZIA);
    expect(chamadas).toHaveLength(0);
  });

  it('sem anúncio publicado não lê cadastro', async () => {
    const { admin, chamadas } = fake({ anuncios_externos: [ok([])] });
    expect(await buscarPorTitulo(admin, ORG, 'Camisa')).toEqual(VAZIA);
    expect(chamadas).toHaveLength(1);
  });

  it('título: os dois modelos, do mais recente ao mais antigo, com o nome mais recente; título bastando não lê variações', async () => {
    const { admin, chamadas } = fake({
      anuncios_externos: [filtrar([pub('a1', 'P1', 'MLB1'), pub('a2', 'P2', null), pub('a3', 'P3', 'MLB3')])],
      familias: [ok([fam('P2', 'Camisa UP', { criado_em: '2026-10-03' }), fam('P1', 'Camisa nova', { criado_em: '2026-10-02' }), fam('P1', 'Camisa velha'),
        fam('P3', 'Calça', { titulo_ml: 'Calça e Camisa' })])],
      anuncios_externos_itens: [filtrar([filho('a2', 's5', 'MLB5'), filho('a2', 's6', 'MLB6'), filho('a2', 's7', 'MLB7', { retirado: true })])],
    });
    expect(await buscarPorTitulo(admin, ORG, 'camisa')).toEqual({
      candidatos: [
        { codigo_pai: 'P2', titulo: 'Camisa UP', mlbs: ['MLB5', 'MLB6'] },
        { codigo_pai: 'P1', titulo: 'Camisa nova', mlbs: ['MLB1'] },
        { codigo_pai: 'P3', titulo: 'Calça', mlbs: ['MLB3'] },
      ], lista_cortada: false,
    });
    expect(chamadas.some((c) => c.tabela === 'variacoes')).toBe(false);
    for (const c of chamadas) {
      expect(tem(c, 'eq', 'org_id', ORG)).toBe(true);
      expect(c.ops.some(([m]) => m === 'range')).toBe(true);
    }
    const [pais] = chamadas;
    expect(tem(pais, 'eq', 'status', 'publicado')).toBe(true);
    expect(tem(pais, 'eq', 'canal', 'mercado_livre')).toBe(true);
    // pai de user products tem MLB nulo: não pode ser excluído
    expect(pais.ops.some(([m]) => m === 'not')).toBe(false);
    const itens = chamadas.find((c) => c.tabela === 'anuncios_externos_itens')!;
    expect(tem(itens, 'eq', 'retirado', false)).toBe(true);
    expect(tem(itens, 'in', 'anuncio_externo_id', ['a1', 'a2', 'a3'])).toBe(true);
  });

  it('cor e tamanho: user products pelo SKU do filho ativo; legado pelo MLB publicado da família', async () => {
    const { admin, chamadas } = fake({
      anuncios_externos: [filtrar([pub('a1', 'UP', null), pub('a2', 'LEG', 'MLB9')])],
      familias: [ok([fam('UP', 'Conjunto'), fam('LEG', 'Fita')])],
      anuncios_externos_itens: [filtrar([filho('a1', 's1', 'MLB1'), filho('a1', 's2', 'MLB2', { retirado: true })])],
      variacoes: duas([
        vari('s1', 'UP', 'Estampa Neon', '4'),
        vari('s1', 'UP', 'Neon lote velho', '6'), // mesmo SKU em lote antigo: vale a primeira (mais recente)
        vari('s2', 'UP', 'Estampa Neon', '6'), // filho retirado
        vari('s3', 'UP', 'Estampa Neon', '8'), // nunca publicada
        vari('c1', 'LEG', 'Neon', null, { familias: { org_id: ORG, codigo_pai: 'LEG', ml_item_id: 'MLB9' } }),
        vari('c2', 'LEG', 'Neon', null, { familias: { org_id: ORG, codigo_pai: 'LEG', ml_item_id: 'MLB8' } }), // outro anúncio
        vari('c3', 'LEG', 'Neon', null), // lote nunca publicado
      ]),
    });
    expect(await buscarPorTitulo(admin, ORG, 'neon')).toEqual({
      candidatos: [
        { codigo_pai: 'UP', titulo: 'Conjunto', mlbs: ['MLB1'], variacoes: [{ sku: 's1', cor: 'Estampa Neon', tamanho: '4', mlb: 'MLB1' }] },
        { codigo_pai: 'LEG', titulo: 'Fita', mlbs: ['MLB9'], variacoes: [{ sku: 'c1', cor: 'Neon', tamanho: null, mlb: 'MLB9' }] },
      ], lista_cortada: false,
    });
    const [v, vigentes] = chamadas.filter((c) => c.tabela === 'variacoes');
    for (const c of [v, vigentes]) {
      expect(tem(c, 'eq', 'org_id', ORG)).toBe(true);
      expect(tem(c, 'eq', 'familias.org_id', ORG)).toBe(true);
      expect(tem(c, 'order', 'criado_em', { ascending: false })).toBe(true);
    }
    expect(tem(vigentes, 'in', 'codigo', ['s1', 'c1'])).toBe(true);
    expect(vigentes.ops.some(([m]) => m === 'or')).toBe(false);
    expect(tem(v, 'in', 'familias.codigo_pai', ['UP', 'LEG'])).toBe(true);
    expect(tem(v, 'or', 'cor.ilike.%n__n%,nome.ilike.%n__n%,tamanho.ilike.%n__n%')).toBe(true);
    expect(tem(v, 'order', 'criado_em', { ascending: false })).toBe(true);
  });

  it('vale a variação vigente: cor que só existe num lote antigo do mesmo SKU não é achada', async () => {
    const velha = vari('s1', 'P1', 'Neon', '4');
    const nova = vari('s1', 'P1', 'Azul', '6');
    const { admin } = fake({
      anuncios_externos: [ok([pub('a1', 'P1', null)])], familias: [ok([fam('P1', 'Conjunto')])],
      anuncios_externos_itens: [ok([filho('a1', 's1', 'MLB1')])],
      // O filtro de texto do banco só devolve o lote velho; a segunda leitura traz os dois, o mais recente antes.
      variacoes: [ok([velha]), ok([nova, velha])],
    });
    expect(await buscarPorTitulo(admin, ORG, 'conjunto neon 4')).toEqual(VAZIA);
  });

  it('pai com MLB próprio e filho ativo do mesmo SKU: os dois anúncios aparecem', async () => {
    const { admin } = fake({
      anuncios_externos: [ok([pub('a1', 'P1', 'MLB100')])], familias: [ok([fam('P1', 'Fita')])],
      anuncios_externos_itens: [ok([filho('a1', 's1', 'MLB200')])],
      variacoes: duas([vari('s1', 'P1', 'Azul', null, { familias: { org_id: ORG, codigo_pai: 'P1', ml_item_id: 'MLB100' } })]),
    });
    expect((await buscarPorTitulo(admin, ORG, 'azul')).candidatos).toMatchObject([{ mlbs: ['MLB200', 'MLB100'] }]);
  });

  it('teto global de leituras por busca: para e avisa', async () => {
    const pais = Array.from({ length: 5000 }, (_, i) => pub(`a${i}`, `P${i}`, `MLB${i}`));
    const { admin, chamadas } = fake({
      anuncios_externos: Array.from({ length: 5 }, (_, i) => ok(pais.slice(i * 1000, (i + 1) * 1000))),
      familias: Array.from({ length: 60 }, () => ok([])), anuncios_externos_itens: Array.from({ length: 60 }, () => ok([])),
    });
    expect((await buscarPorTitulo(admin, ORG, 'neon')).lista_cortada).toBe(true);
    expect(chamadas.length).toBeLessThanOrEqual(40);
  });

  it('isolamento: outra organização não aparece em nenhuma fonte, nem com o mesmo código e SKU', async () => {
    const X = { org_id: 'org-B' };
    const { admin } = fake({
      anuncios_externos: [filtrar([pub('a1', 'P1', null), pub('b1', 'P1', 'MLBX', X), pub('b2', 'P2', 'MLBY', X), pub('a3', 'P3', 'MLB3', { status: 'erro' })])],
      familias: [filtrar([fam('P1', 'Conjunto'), fam('P1', 'Conjunto Neon alheio', X), fam('P2', 'Neon alheio', X)])],
      anuncios_externos_itens: [filtrar([filho('a1', 's1', 'MLB1'), filho('a1', 's9', 'MLBZ', X)])],
      variacoes: duas([
        vari('s9', 'P1', 'Neon', '4', { ...X, familias: { org_id: 'org-B', codigo_pai: 'P1', ml_item_id: 'MLBX' } }),
        vari('s1', 'P1', 'Neon', '4', { familias: { org_id: 'org-B', codigo_pai: 'P1', ml_item_id: null } }),
      ]),
    });
    expect(await buscarPorTitulo(admin, ORG, 'neon')).toEqual(VAZIA);
  });

  it('lê em páginas de 1000 e blocos de 100 códigos', async () => {
    const pais = Array.from({ length: 1001 }, (_, i) => pub(`a${i}`, `P${i}`, `MLB${i}`));
    const { admin, chamadas } = fake({
      anuncios_externos: [ok(pais.slice(0, 1000)), ok(pais.slice(1000))],
      familias: Array.from({ length: 11 }, () => filtrar(pais.map((p) => fam(p.codigo_pai, `Item ${p.id}`)))),
      anuncios_externos_itens: Array.from({ length: 11 }, () => ok([])),
    });
    const r = await buscarPorTitulo(admin, ORG, 'item');
    expect(r.candidatos).toHaveLength(10);
    expect(r.lista_cortada).toBe(true);
    const ps = chamadas.filter((c) => c.tabela === 'anuncios_externos');
    expect(ps.map((c) => c.ops.find(([m]) => m === 'range'))).toEqual([['range', 0, 999], ['range', 1000, 1999]]);
    for (const c of chamadas) for (const [m, , l] of c.ops) if (m === 'in') expect((l as unknown[]).length).toBeLessThanOrEqual(100);
  });

  it('teto de leitura de variações: avisa que a lista foi cortada, mesmo sem candidato', async () => {
    const cheia = ok(Array.from({ length: 1000 }, (_, i) => vari(`v${i}`, 'P1', 'Nada', null)));
    const { admin, chamadas } = fake({
      anuncios_externos: [ok([pub('a1', 'P1', 'MLB1')])], familias: [ok([fam('P1', 'Fita')])], anuncios_externos_itens: [ok([])],
      variacoes: Array.from({ length: 5 }, () => cheia),
    });
    expect(await buscarPorTitulo(admin, ORG, 'neon')).toEqual({ candidatos: [], lista_cortada: true });
    expect(chamadas.filter((c) => c.tabela === 'variacoes')).toHaveLength(5);
  });

  it('erro de leitura lança', async () => {
    await expect(buscarPorTitulo(fake({ anuncios_externos: [ERRO] }).admin, ORG, 'neon')).rejects.toThrow('agentes.titulo.pais');
  });
});

describe('listarMlbs', () => {
  it('distintos, crescentes como string, acima do cursor, das duas fontes da org', async () => {
    const { admin, chamadas } = fake({
      anuncios_externos: [ok([{ item_externo_id: 'MLB10' }, { item_externo_id: 'MLB9' }])],
      // Legado: várias cores com o mesmo MLB enchem a página; a próxima continua depois dele.
      anuncios_externos_itens: [
        ok([{ item_externo_id: 'MLB1' }, { item_externo_id: 'MLB1' }]),
        ok([{ item_externo_id: 'MLB2' }]),
      ],
    });
    expect(await listarMlbs(admin, ORG, 'MLB0', 2)).toEqual(['MLB1', 'MLB10']);
    for (const c of chamadas) {
      expect(tem(c, 'eq', 'org_id', ORG)).toBe(true);
      expect(tem(c, 'order', 'item_externo_id')).toBe(true);
      expect(tem(c, 'limit', 2)).toBe(true);
    }
    const [pais, filhos1, filhos2] = chamadas;
    expect(tem(pais, 'gt', 'item_externo_id', 'MLB0')).toBe(true);
    expect(tem(pais, 'eq', 'status', 'publicado')).toBe(true);
    expect(tem(filhos1, 'gt', 'item_externo_id', 'MLB0')).toBe(true);
    expect(tem(filhos1, 'eq', 'anuncios_externos.status', 'publicado')).toBe(true);
    expect(tem(filhos2, 'gt', 'item_externo_id', 'MLB1')).toBe(true);
  });

  it('cobre os dois modelos: pai legado com MLB e filhos de user products (pai sem MLB), retirado fora', async () => {
    const legado = { org_id: ORG, canal: 'mercado_livre', status: 'publicado', item_externo_id: 'MLB7' };
    const up = { org_id: ORG, canal: 'mercado_livre', status: 'publicado', item_externo_id: null, codigo_pai: 'P2' };
    const filhos = [
      { org_id: ORG, retirado: false, item_externo_id: 'MLB3', anuncios_externos: up },
      { org_id: ORG, retirado: true, item_externo_id: 'MLB4', anuncios_externos: up },
      { org_id: 'org-B', retirado: false, item_externo_id: 'MLB5', anuncios_externos: up },
    ];
    const { admin } = fake({ anuncios_externos: [filtrar([legado, up])], anuncios_externos_itens: [filtrar(filhos)] });
    expect(await listarMlbs(admin, ORG, null, 51)).toEqual(['MLB3', 'MLB7']);
  });

  it('sem cursor não filtra por gt', async () => {
    const { admin, chamadas } = fake({ anuncios_externos: [ok([])], anuncios_externos_itens: [ok([])] });
    expect(await listarMlbs(admin, ORG, null, 51)).toEqual([]);
    for (const c of chamadas) expect(c.ops.some(([m]) => m === 'gt')).toBe(false);
  });
});

describe('autenticação e auditoria', () => {
  it('buscarConexaoPorHash: busca só pelo hash; erro lança', async () => {
    const linha = { id: 'c1', org_id: ORG, expira_em: '2027-01-01T00:00:00Z', revogada_em: null };
    const { admin, chamadas } = fake({ agente_conexoes: [ok(linha), ok(null), ERRO] });
    expect(await buscarConexaoPorHash(admin, 'h')).toEqual(linha);
    expect(tem(chamadas[0], 'eq', 'hash', 'h')).toBe(true);
    expect(await buscarConexaoPorHash(admin, 'h')).toBeNull();
    await expect(buscarConexaoPorHash(admin, 'h')).rejects.toThrow();
  });

  it.each([
    [{ modulos_habilitados: ['ads', 'agentes'], arquivada_em: null }, true],
    [{ modulos_habilitados: ['ads'], arquivada_em: null }, false],
    [{ modulos_habilitados: ['agentes'], arquivada_em: '2026-10-01T00:00:00Z' }, false],
    [null, false],
  ])('orgAtivaComModulo(%j) → %s, filtrando pelo id da org', async (linha, esperado) => {
    const { admin, chamadas } = fake({ organizations: [ok(linha)] });
    expect(await orgAtivaComModulo(admin, ORG)).toBe(esperado);
    expect(tem(chamadas[0], 'eq', 'id', ORG)).toBe(true);
  });

  it('orgAtivaComModulo: erro de leitura lança', async () => {
    const { admin } = fake({ organizations: [ERRO] });
    await expect(orgAtivaComModulo(admin, ORG)).rejects.toThrow();
  });

  it('marcarUso: atualiza só a conexão da org', async () => {
    const { admin, chamadas } = fake({ agente_conexoes: [ok(null)] });
    await marcarUso(admin, ORG, 'c1', new Date('2026-11-22T12:00:00Z'));
    expect(tem(chamadas[0], 'update', { ultimo_uso_em: '2026-11-22T12:00:00.000Z' })).toBe(true);
    expect(tem(chamadas[0], 'eq', 'org_id', ORG)).toBe(true);
    expect(tem(chamadas[0], 'eq', 'id', 'c1')).toBe(true);
  });

  it('gravarChamada: grava org e conexão; erro lança', async () => {
    const { admin, chamadas } = fake({ agente_chamadas: [ok(null), ERRO] });
    const linha = { orgId: ORG, conexaoId: 'c1', ferramenta: 'publiai_loja', alvo: null, resultado: 'ok' };
    await gravarChamada(admin, linha);
    expect(tem(chamadas[0], 'insert', {
      org_id: ORG, conexao_id: 'c1', ferramenta: 'publiai_loja', alvo: null, resultado: 'ok',
    })).toBe(true);
    await expect(gravarChamada(admin, linha)).rejects.toThrow();
  });
});

describe('lerLoja', () => {
  it('nome da org e apelido da conta ML da org', async () => {
    const { admin, chamadas } = fake({
      organizations: [ok({ nome: 'Loja A' })],
      marketplace_connections: [ok({ conta_label: 'LOJA_A', conta_externa_id: '123' })],
    });
    expect(await lerLoja(admin, ORG)).toEqual({ organizacao: 'Loja A', conta_ml: 'LOJA_A', conta_ml_id: '123' });
    expect(tem(chamadas[0], 'eq', 'id', ORG)).toBe(true);
    expect(tem(chamadas[1], 'eq', 'org_id', ORG)).toBe(true);
    expect(tem(chamadas[1], 'eq', 'canal', 'mercado_livre')).toBe(true);
  });

  it('sem apelido → conta_ml null (nunca o id); sem conexão → ambos null', async () => {
    const { admin } = fake({
      organizations: [ok({ nome: 'Loja A' }), ok({ nome: 'Loja A' })],
      marketplace_connections: [ok({ conta_label: null, conta_externa_id: '123' }), ok(null)],
    });
    expect(await lerLoja(admin, ORG)).toEqual({ organizacao: 'Loja A', conta_ml: null, conta_ml_id: '123' });
    expect(await lerLoja(admin, ORG)).toEqual({ organizacao: 'Loja A', conta_ml: null, conta_ml_id: null });
  });

  it('erro de leitura lança', async () => {
    const { admin } = fake({ organizations: [ERRO], marketplace_connections: [ok(null)] });
    await expect(lerLoja(admin, ORG)).rejects.toThrow();
  });
});
