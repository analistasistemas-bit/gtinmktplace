import { describe, expect, it } from 'vitest';
import {
  LIMITE_CONEXOES_ATIVAS, contarAtivas, expiraEm, idValido, inserirConexao, listarChamadas, listarConexoes, revogarConexao,
  validarNova,
} from '../conexoes.ts';

const ORG = 'org-A';
type Op = [string, ...unknown[]];
type Chamada = { tabela: string; ops: Op[] };
type Res = { data?: unknown; count?: number | null; error: { message: string } | null };

/** Cliente Supabase falso: registra cada operação encadeada e responde, por tabela, na ordem da fila. */
function fake(filas: Record<string, Res[]>) {
  const chamadas: Chamada[] = [];
  const admin = {
    from(tabela: string) {
      const c: Chamada = { tabela, ops: [] };
      chamadas.push(c);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'gt', 'order', 'limit', 'maybeSingle', 'single', 'update', 'insert']) {
        b[m] = (...a: unknown[]) => { c.ops.push([m, ...a]); return b; };
      }
      b.then = (ok: (r: Res) => unknown, falha: (e: unknown) => unknown) => {
        const prox = filas[tabela]?.shift();
        if (!prox) return Promise.reject(new Error(`sem resposta para ${tabela}`)).then(ok, falha);
        return Promise.resolve(prox).then(ok, falha);
      };
      return b;
    },
  };
  return { admin: admin as never, chamadas };
}
const tem = (c: Chamada, ...op: Op) => c.ops.some((o) => JSON.stringify(o) === JSON.stringify(op));
const ok = (data: unknown): Res => ({ data, error: null });
const ERRO: Res = { data: null, error: { message: 'fora' } };
const AGORA = new Date('2026-11-22T12:00:00.000Z');

describe('validarNova', () => {
  it('aceita nome com espaços nas pontas e validade permitida', () => {
    expect(validarNova({ nome: '  Claude  ', dias: 90 })).toEqual({ nome: 'Claude', dias: 90 });
    expect(validarNova({ nome: 'x'.repeat(60), dias: 365 })).toEqual({ nome: 'x'.repeat(60), dias: 365 });
    expect(validarNova({ nome: 'a', dias: 30 })).toEqual({ nome: 'a', dias: 30 });
  });
  it('nome vazio, só espaços, 61 caracteres ou não-texto → nome_invalido', () => {
    for (const nome of ['', '   ', 'x'.repeat(61), 42, null, undefined]) {
      expect(validarNova({ nome, dias: 90 })).toEqual({ erro: 'nome_invalido' });
    }
  });
  it('dias fora de 30/90/365 → validade_invalida', () => {
    for (const dias of [45, 0, '90', null, undefined, 366]) {
      expect(validarNova({ nome: 'ok', dias })).toEqual({ erro: 'validade_invalida' });
    }
  });
  it('corpo que não é objeto → nome_invalido', () => {
    expect(validarNova(null)).toEqual({ erro: 'nome_invalido' });
    expect(validarNova('x')).toEqual({ erro: 'nome_invalido' });
  });
});

describe('idValido', () => {
  it('só uuid passa; o resto vira 404 sem tocar o banco', () => {
    expect(idValido('0b9d5a3e-1c2f-4a6b-9e8d-7f6a5b4c3d2e')).toBe(true);
    expect(idValido('0B9D5A3E-1C2F-4A6B-9E8D-7F6A5B4C3D2E')).toBe(true);
    for (const id of ['abc', '', 42, null, undefined, '0b9d5a3e-1c2f-4a6b-9e8d-7f6a5b4c3d2e; drop']) {
      expect(idValido(id)).toBe(false);
    }
  });
});

describe('expiraEm', () => {
  it('soma os dias a agora', () => {
    expect(expiraEm(AGORA, 30)).toBe('2026-12-22T12:00:00.000Z');
    expect(expiraEm(AGORA, 365)).toBe('2027-11-22T12:00:00.000Z');
  });
  it('limite de ativas é 10', () => expect(LIMITE_CONEXOES_ATIVAS).toBe(10));
});

describe('listarConexoes', () => {
  it('filtra por org, ordena por criação e nunca devolve hash', async () => {
    const linha = {
      id: 'c1', nome: 'Claude', prefixo: 'ab12cd34', criada_em: '2026-11-01T00:00:00Z', expira_em: '2027-01-30T00:00:00Z',
      revogada_em: null, ultimo_uso_em: null, hash: 'nao-pode-sair', org_id: ORG, criada_por: 'u1',
    };
    const { admin, chamadas } = fake({ agente_conexoes: [ok([linha])] });
    const r = await listarConexoes(admin, ORG);
    expect(r).toEqual([{
      id: 'c1', nome: 'Claude', prefixo: 'ab12cd34', criada_em: '2026-11-01T00:00:00Z', expira_em: '2027-01-30T00:00:00Z',
      revogada_em: null, ultimo_uso_em: null,
    }]);
    expect(JSON.stringify(r)).not.toContain('hash');
    const [c] = chamadas;
    expect(tem(c, 'eq', 'org_id', ORG)).toBe(true);
    expect(c.ops.find(([m]) => m === 'select')?.[1]).not.toContain('hash');
    expect(tem(c, 'order', 'criada_em', { ascending: false })).toBe(true);
  });
  it('erro de leitura lança', async () => {
    const { admin } = fake({ agente_conexoes: [ERRO] });
    await expect(listarConexoes(admin, ORG)).rejects.toThrow();
  });
});

describe('contarAtivas', () => {
  it('conta só não revogadas e não expiradas da org', async () => {
    const { admin, chamadas } = fake({ agente_conexoes: [{ count: 7, error: null }] });
    expect(await contarAtivas(admin, ORG, AGORA)).toBe(7);
    const [c] = chamadas;
    expect(tem(c, 'eq', 'org_id', ORG)).toBe(true);
    expect(tem(c, 'is', 'revogada_em', null)).toBe(true);
    expect(tem(c, 'gt', 'expira_em', AGORA.toISOString())).toBe(true);
    expect(tem(c, 'select', 'id', { count: 'exact', head: true })).toBe(true);
  });
  it('erro lança (não libera o limite)', async () => {
    const { admin } = fake({ agente_conexoes: [{ count: null, error: { message: 'x' } }] });
    await expect(contarAtivas(admin, ORG, AGORA)).rejects.toThrow();
  });
});

describe('inserirConexao', () => {
  it('grava org, criador, hash e expiração; devolve só id', async () => {
    const { admin, chamadas } = fake({ agente_conexoes: [ok({ id: 'c9' })] });
    const r = await inserirConexao(admin, ORG, {
      nome: 'Claude', prefixo: 'ab12cd34', hash: 'h', criada_por: 'u1', expira_em: '2027-01-01T00:00:00.000Z',
    });
    expect(r).toEqual({ id: 'c9' });
    const [c] = chamadas;
    expect(tem(c, 'insert', {
      org_id: ORG, nome: 'Claude', prefixo: 'ab12cd34', hash: 'h', criada_por: 'u1', expira_em: '2027-01-01T00:00:00.000Z',
    })).toBe(true);
    expect(tem(c, 'select', 'id')).toBe(true);
  });
  it('colisão de hash lança erro sem detalhe', async () => {
    const { admin } = fake({ agente_conexoes: [{ data: null, error: { message: 'duplicate key value hash=abc' } }] });
    await expect(inserirConexao(admin, ORG, {
      nome: 'x', prefixo: 'p', hash: 'h', criada_por: 'u1', expira_em: 'e',
    })).rejects.toThrow(/^agentes\.inserirConexao$/);
  });
});

describe('revogarConexao', () => {
  it('grava revogada_em só na linha da org e ainda não revogada', async () => {
    const { admin, chamadas } = fake({ agente_conexoes: [ok([{ id: 'c1' }])] });
    expect(await revogarConexao(admin, ORG, 'c1', AGORA)).toBe(true);
    const [c] = chamadas;
    expect(tem(c, 'update', { revogada_em: AGORA.toISOString() })).toBe(true);
    expect(tem(c, 'eq', 'org_id', ORG)).toBe(true);
    expect(tem(c, 'eq', 'id', 'c1')).toBe(true);
    expect(tem(c, 'is', 'revogada_em', null)).toBe(true);
    expect(chamadas).toHaveLength(1);
  });
  it('já revogada da mesma org → true sem regravar a data', async () => {
    const { admin, chamadas } = fake({ agente_conexoes: [ok([]), ok({ id: 'c1' })] });
    expect(await revogarConexao(admin, ORG, 'c1', AGORA)).toBe(true);
    const [, existe] = chamadas;
    expect(tem(existe, 'eq', 'org_id', ORG)).toBe(true);
    expect(tem(existe, 'eq', 'id', 'c1')).toBe(true);
  });
  it('inexistente ou de outra org → false', async () => {
    const { admin } = fake({ agente_conexoes: [ok([]), ok(null)] });
    expect(await revogarConexao(admin, ORG, 'c-outra', AGORA)).toBe(false);
  });
  it('erro de escrita lança', async () => {
    const { admin } = fake({ agente_conexoes: [ERRO] });
    await expect(revogarConexao(admin, ORG, 'c1', AGORA)).rejects.toThrow();
  });
});

describe('listarChamadas', () => {
  it('últimas 50 da conexão, filtradas por org', async () => {
    const linhas = [{ criado_em: '2026-11-22T10:00:00Z', ferramenta: 'margem_do_anuncio', alvo: 'MLB1', resultado: 'ok' }];
    const { admin, chamadas } = fake({ agente_chamadas: [ok(linhas)] });
    expect(await listarChamadas(admin, ORG, 'c1')).toEqual(linhas);
    const [c] = chamadas;
    expect(tem(c, 'eq', 'org_id', ORG)).toBe(true);
    expect(tem(c, 'eq', 'conexao_id', 'c1')).toBe(true);
    expect(tem(c, 'order', 'criado_em', { ascending: false })).toBe(true);
    expect(tem(c, 'limit', 50)).toBe(true);
  });
});
