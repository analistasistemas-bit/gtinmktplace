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
const tem = (c: Chamada, ...op: Op) => c.ops.some((o) => JSON.stringify(o) === JSON.stringify(op));
const ok = (data: unknown): Res => ({ data, error: null });
const ERRO: Res = { data: null, error: { message: 'fora' } };

describe('vinculos', () => {
  it('MLB: filhos publicados da org + anúncio pai sem filhos, ambos filtrados por org', async () => {
    const { admin, chamadas } = fake({
      anuncios_externos_itens: [ok([{ item_externo_id: 'MLB1', user_product_id: 'MLBU9', family_id: '123', sku: 'S1', anuncios_externos: { codigo_pai: 'P1' } }])],
      anuncios_externos: [ok([{ item_externo_id: 'MLB1', codigo_pai: 'P1' }])],
    });
    expect(await vinculos(admin, ORG, { mlb: 'MLB1' })).toEqual([
      { mlb: 'MLB1', mlbu: 'MLBU9', familia_ml: '123', sku: 'S1', codigo_pai: 'P1' },
      { mlb: 'MLB1', mlbu: null, familia_ml: null, sku: 'P1', codigo_pai: 'P1' },
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

  it.each([
    [{ sku: '00123' }, 'sku', '00123'],
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
    const { admin } = fake({ anuncios_externos_itens: [ERRO] });
    await expect(vinculos(admin, ORG, { sku: 'X' })).rejects.toThrow();
  });
});

describe('buscarPorTitulo', () => {
  it('escapa %, _ e \\ e limita a 11; MLBs vêm dos publicados do código pai na mesma org', async () => {
    const { admin, chamadas } = fake({
      familias: [ok([
        { codigo_pai: 'P1', nome_pai: 'Camisa 50% off' }, { codigo_pai: 'P1', nome_pai: 'Camisa 50% off (lote 2)' },
        { codigo_pai: 'P2', nome_pai: 'Sem anúncio' },
      ])],
      anuncios_externos: [ok([{ id: 'a1', codigo_pai: 'P1', item_externo_id: 'MLB1' }])],
      anuncios_externos_itens: [ok([{ anuncio_externo_id: 'a1', item_externo_id: 'MLB2' }])],
    });
    expect(await buscarPorTitulo(admin, ORG, '50%_off\\')).toEqual([
      { codigo_pai: 'P1', titulo: 'Camisa 50% off', mlbs: ['MLB1', 'MLB2'] },
    ]);
    const [fam, pais, filhos] = chamadas;
    expect(tem(fam, 'ilike', 'nome_pai', '%50\\%\\_off\\\\%')).toBe(true);
    expect(tem(fam, 'limit', 11)).toBe(true);
    for (const c of chamadas) expect(tem(c, 'eq', 'org_id', ORG)).toBe(true);
    expect(tem(pais, 'in', 'codigo_pai', ['P1', 'P2'])).toBe(true);
    expect(tem(pais, 'eq', 'status', 'publicado')).toBe(true);
    expect(tem(filhos, 'in', 'anuncio_externo_id', ['a1'])).toBe(true);
    expect(tem(filhos, 'eq', 'retirado', false)).toBe(true);
  });

  it('nenhuma família → [] sem mais consultas', async () => {
    const { admin, chamadas } = fake({ familias: [ok([])] });
    expect(await buscarPorTitulo(admin, ORG, 'nada')).toEqual([]);
    expect(chamadas).toHaveLength(1);
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
    expect(await lerLoja(admin, ORG)).toEqual({ organizacao: 'Loja A', conta_ml: 'LOJA_A' });
    expect(tem(chamadas[0], 'eq', 'id', ORG)).toBe(true);
    expect(tem(chamadas[1], 'eq', 'org_id', ORG)).toBe(true);
    expect(tem(chamadas[1], 'eq', 'canal', 'mercado_livre')).toBe(true);
  });

  it('sem apelido → identificador da conta; sem conexão → null', async () => {
    const { admin } = fake({
      organizations: [ok({ nome: 'Loja A' }), ok({ nome: 'Loja A' })],
      marketplace_connections: [ok({ conta_label: null, conta_externa_id: '123' }), ok(null)],
    });
    expect(await lerLoja(admin, ORG)).toEqual({ organizacao: 'Loja A', conta_ml: '123' });
    expect(await lerLoja(admin, ORG)).toEqual({ organizacao: 'Loja A', conta_ml: null });
  });

  it('erro de leitura lança', async () => {
    const { admin } = fake({ organizations: [ERRO], marketplace_connections: [ok(null)] });
    await expect(lerLoja(admin, ORG)).rejects.toThrow();
  });
});
