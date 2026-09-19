import { describe, expect, it } from 'vitest';
import { temTipoProduto, tiposProdutoDaOrg } from '../tipo-produto.ts';
import { tamanhosValidosParaTipos } from '../tipos-produto-valores.ts';

/** Stub mínimo do supabase-js: só o caminho from().select().eq().maybeSingle(). */
function fakeAdmin(resposta: { data: unknown; error: unknown }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve(resposta) }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('temTipoProduto', () => {
  it('org sem nenhum tipo nao tem roupa nem calcado', () => {
    expect(temTipoProduto([], 'roupa')).toBe(false);
    expect(temTipoProduto([], 'calcado')).toBe(false);
  });

  it('tipos sao combinaveis, nao exclusivos', () => {
    expect(temTipoProduto(['roupa', 'calcado'], 'roupa')).toBe(true);
    expect(temTipoProduto(['roupa', 'calcado'], 'calcado')).toBe(true);
  });

  it('ignora valor desconhecido gravado no array', () => {
    expect(temTipoProduto(['brinquedo'], 'roupa')).toBe(false);
  });
});

// A fonte unica (`tipos-produto-valores.ts`) so existe para a edge poder validar o tamanho
// recebido; se ela nao tiver teste, a lista volta a divergir em silencio.
describe('tamanhosValidosParaTipos', () => {
  it('org sem tipo nao aceita tamanho nenhum (INV-1)', () => {
    expect(tamanhosValidosParaTipos([])).toEqual([]);
  });

  it('roupa e calcado nao se misturam', () => {
    expect(tamanhosValidosParaTipos(['roupa'])).toContain('Tamanho Único');
    expect(tamanhosValidosParaTipos(['roupa'])).not.toContain('37/38');
    expect(tamanhosValidosParaTipos(['calcado'])).toContain('37/38');
    expect(tamanhosValidosParaTipos(['calcado'])).not.toContain('P');
  });

  it('ordem canonica, nao a do payload', () => {
    expect(tamanhosValidosParaTipos(['calcado', 'roupa'])[0]).toBe('P');
  });
});

describe('tiposProdutoDaOrg', () => {
  it('devolve os tipos gravados', async () => {
    const admin = fakeAdmin({ data: { tipos_produto_habilitados: ['roupa'] }, error: null });
    await expect(tiposProdutoDaOrg(admin, 'org-1')).resolves.toEqual(['roupa']);
  });

  it('coluna nula vira lista vazia', async () => {
    const admin = fakeAdmin({ data: { tipos_produto_habilitados: null }, error: null });
    await expect(tiposProdutoDaOrg(admin, 'org-1')).resolves.toEqual([]);
  });

  it('filtra valor invalido gravado no banco', async () => {
    const admin = fakeAdmin({ data: { tipos_produto_habilitados: ['roupa', 'xpto'] }, error: null });
    await expect(tiposProdutoDaOrg(admin, 'org-1')).resolves.toEqual(['roupa']);
  });

  // Falha de leitura NAO pode virar [] em silencio: [] significa "org padrao" e mandaria o
  // cadastro seguir sem tamanho, gravando produto errado. Lanca para o QStash retentar.
  it('erro de leitura LANCA em vez de devolver lista vazia', async () => {
    const admin = fakeAdmin({ data: null, error: { message: 'timeout' } });
    await expect(tiposProdutoDaOrg(admin, 'org-1')).rejects.toThrow(/tipos_produto_da_org|timeout/i);
  });
});
