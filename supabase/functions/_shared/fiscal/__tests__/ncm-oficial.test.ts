import { describe, expect, it, vi } from 'vitest';
import { mensagemNcm, ncmsInvalidos } from '../ncm-oficial.ts';

// Fake admin: só rpc('ncm_consultar'). Devolve as linhas pedidas ou o erro.
function fakeAdmin(resp: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: resp.data ?? null, error: resp.error ?? null });
  return { admin: { rpc } as never, rpc };
}

describe('ncmsInvalidos', () => {
  it('código ausente do retorno = inexistente', async () => {
    const { admin, rpc } = fakeAdmin({ data: [{ codigo: '62034900', descricao: 'x', vigente: true }] });
    expect(await ncmsInvalidos(admin, ['62034900', '75937727']))
      .toEqual([{ codigo: '75937727', motivo: 'inexistente' }]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('vigente=false = vencido', async () => {
    const { admin } = fakeAdmin({ data: [{ codigo: '62034900', descricao: 'x', vigente: false }] });
    expect(await ncmsInvalidos(admin, ['62034900'])).toEqual([{ codigo: '62034900', motivo: 'vencido' }]);
  });

  it('vazios/null não chamam o rpc', async () => {
    const { admin, rpc } = fakeAdmin({ data: [] });
    expect(await ncmsInvalidos(admin, [null, '', undefined])).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('duplicados viram uma chamada com código único', async () => {
    const { admin, rpc } = fakeAdmin({ data: [{ codigo: '62034900', descricao: 'x', vigente: true }] });
    expect(await ncmsInvalidos(admin, ['62034900', '62034900', null])).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('ncm_consultar', { p_codigos: ['62034900'] });
  });

  it('erro do rpc rejeita (fail-closed)', async () => {
    const { admin } = fakeAdmin({ error: { message: 'boom' } });
    await expect(ncmsInvalidos(admin, ['62034900'])).rejects.toThrow(/boom/);
  });
});

describe('mensagemNcm', () => {
  it('copy exata', () => {
    expect(mensagemNcm({ codigo: '75937727', motivo: 'inexistente' }))
      .toBe('NCM 75937727 não existe na tabela oficial');
    expect(mensagemNcm({ codigo: '62034900', motivo: 'vencido' }))
      .toBe('NCM 62034900 não está mais vigente');
  });
});
