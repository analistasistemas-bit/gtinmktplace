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
      for (const m of ['select', 'eq', 'not', 'in', 'gt', 'order', 'limit', 'ilike', 'maybeSingle', 'update', 'insert']) {
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
  it('escapa %, _ e \\, tira * e lê até 200 famílias da mais recente para a mais antiga', async () => {
    const { admin, chamadas } = fake({ familias: [ok([])] });
    expect(await buscarPorTitulo(admin, ORG, '50%_*off\\')).toEqual([]);
    const [fam] = chamadas;
    expect(tem(fam, 'ilike', 'nome_pai', '%50\\%\\_off\\\\%')).toBe(true);
    expect(tem(fam, 'order', 'criado_em', { ascending: false })).toBe(true);
    expect(tem(fam, 'limit', 200)).toBe(true);
    expect(tem(fam, 'eq', 'org_id', ORG)).toBe(true);
    expect(chamadas).toHaveLength(1);
  });

  it('trecho só de * não busca', async () => {
    const { admin, chamadas } = fake({});
    expect(await buscarPorTitulo(admin, ORG, '***')).toEqual([]);
    expect(chamadas).toHaveLength(0);
  });

  it('15 lotes do mesmo código + 1 outro publicado → 2 candidatos; sem anúncio publicado não vira candidato', async () => {
    const fams = [
      ...Array.from({ length: 15 }, (_, i) => ({ codigo_pai: 'P1', nome_pai: i === 0 ? 'Camisa nova' : `Camisa velha ${i}` })),
      { codigo_pai: 'P2', nome_pai: 'Camisa UP' },
      { codigo_pai: 'P3', nome_pai: 'Camisa rascunho' },
    ];
    // P1 legado (MLB no pai); P2 user products (pai sem MLB, filhos com MLB).
    const pais = [
      { id: 'a1', codigo_pai: 'P1', item_externo_id: 'MLB1' },
      { id: 'a2', codigo_pai: 'P2', item_externo_id: null },
    ];
    const { admin, chamadas } = fake({
      familias: [ok(fams)],
      anuncios_externos: [ok(pais)],
      anuncios_externos_itens: [ok([{ anuncio_externo_id: 'a2', item_externo_id: 'MLB5' }, { anuncio_externo_id: 'a2', item_externo_id: 'MLB6' }])],
    });
    expect(await buscarPorTitulo(admin, ORG, 'Camisa')).toEqual([
      { codigo_pai: 'P1', titulo: 'Camisa nova', mlbs: ['MLB1'] },
      { codigo_pai: 'P2', titulo: 'Camisa UP', mlbs: ['MLB5', 'MLB6'] },
    ]);
    const [, paisC, filhosC] = chamadas;
    for (const c of chamadas) expect(tem(c, 'eq', 'org_id', ORG)).toBe(true);
    expect(tem(paisC, 'in', 'codigo_pai', ['P1', 'P2', 'P3'])).toBe(true);
    expect(tem(paisC, 'eq', 'status', 'publicado')).toBe(true);
    // pai de user products tem MLB nulo: não pode ser excluído
    expect(paisC.ops.some(([m]) => m === 'not')).toBe(false);
    expect(tem(filhosC, 'in', 'anuncio_externo_id', ['a1', 'a2'])).toBe(true);
    expect(tem(filhosC, 'eq', 'retirado', false)).toBe(true);
  });

  it('decide os 11 candidatos antes de ler os filhos: 150 códigos UP com 20 filhos cada', async () => {
    const fams = Array.from({ length: 150 }, (_, i) => ({ org_id: ORG, codigo_pai: `P${i}`, nome_pai: `Vestido ${i}` }));
    const pais = fams.map((f, i) => ({
      org_id: ORG, canal: 'mercado_livre', status: 'publicado', id: `a${i}`, codigo_pai: f.codigo_pai, item_externo_id: null,
    }));
    const mlb = (i: number, j: number) => `MLB${1000 + i * 100 + j}`;
    const filhos = pais.flatMap((p, i) => Array.from({ length: 20 }, (_, j) => ({
      org_id: ORG, retirado: false, anuncio_externo_id: p.id, item_externo_id: mlb(i, j),
    })));
    const { admin, chamadas } = fake({
      familias: [filtrar(fams)],
      anuncios_externos: [filtrar(pais), filtrar(pais)],
      anuncios_externos_itens: [filtrar(filhos)],
    });
    const r = await buscarPorTitulo(admin, ORG, 'Vestido');
    expect(r).toHaveLength(11);
    r.forEach((c, i) => {
      expect(c.codigo_pai).toBe(`P${i}`);
      expect(c.mlbs).toEqual(Array.from({ length: 20 }, (_, j) => mlb(i, j)));
    });
    for (const c of chamadas) {
      expect(tem(c, 'eq', 'org_id', ORG)).toBe(true);
      for (const [m, , lista] of c.ops) {
        if (m === 'in') {
          expect((lista as unknown[]).length).toBeGreaterThan(0);
          expect((lista as unknown[]).length).toBeLessThanOrEqual(100);
        }
      }
    }
    const consultasFilhos = chamadas.filter((c) => c.tabela === 'anuncios_externos_itens');
    expect(consultasFilhos).toHaveLength(1);
    const ids = consultasFilhos[0].ops.find(([m]) => m === 'in')![2] as string[];
    expect(ids.length).toBeLessThanOrEqual(11);
    expect(tem(consultasFilhos[0], 'eq', 'retirado', false)).toBe(true);
    expect(tem(consultasFilhos[0], 'order', 'item_externo_id')).toBe(true);
    // o primeiro bloco de 100 códigos já tem 11 publicados: o segundo bloco não é lido
    expect(chamadas.filter((c) => c.tabela === 'anuncios_externos')).toHaveLength(1);
  });

  it('MLBs por candidato cortados em 60', async () => {
    const { admin } = fake({
      familias: [ok([{ codigo_pai: 'P1', nome_pai: 'Saia' }])],
      anuncios_externos: [ok([{ id: 'a1', codigo_pai: 'P1', item_externo_id: null }])],
      anuncios_externos_itens: [ok(Array.from({ length: 70 }, (_, j) => ({ anuncio_externo_id: 'a1', item_externo_id: `MLB${100 + j}` })))],
    });
    const [c] = await buscarPorTitulo(admin, ORG, 'Saia');
    expect(c.mlbs).toHaveLength(60);
  });

  it('corta em 11 candidatos depois de filtrar', async () => {
    const fams = Array.from({ length: 20 }, (_, i) => ({ codigo_pai: `P${i}`, nome_pai: `Item ${i}` }));
    const { admin } = fake({
      familias: [ok(fams)],
      anuncios_externos: [ok(fams.map((f, i) => ({ id: `a${i}`, codigo_pai: f.codigo_pai, item_externo_id: `MLB${i}` })))],
      anuncios_externos_itens: [ok([])],
    });
    expect(await buscarPorTitulo(admin, ORG, 'Item')).toHaveLength(11);
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
