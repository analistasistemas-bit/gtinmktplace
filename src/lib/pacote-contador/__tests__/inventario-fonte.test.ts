import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } }));
import { buscarInventarioHoje, buscarFoto, salvarContagem, confirmarInventario } from '../inventario-fonte';
import { ErroOrgMudou, ErroPacote, ErroRede } from '../baixar';

const J = (org = 'org-1') => ({ 'Content-Type': 'application/json', 'X-Org-Id': org });
const resp = (body: unknown, status = 200, headers: Record<string, string> = J()) => new Response(JSON.stringify(body), { status, headers });
const LEIT = { cabecalho: { data_base: '2026-10-16', gerado_em: '2026-10-16T15:00:00Z', status: 'hoje' }, itens: [] };
beforeEach(() => { vi.unstubAllGlobals(); });

describe('inventario-fonte', () => {
  it('hoje: manda a ação com a sessão e devolve o JSON', async () => {
    const f = vi.fn<typeof fetch>(async () => resp(LEIT));
    vi.stubGlobal('fetch', f);
    expect(await buscarInventarioHoje('org-1')).toEqual(LEIT);
    expect(String(f.mock.calls[0][0])).toMatch(/\/functions\/v1\/inventario$/);
    expect(f.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer tok' });
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ acao: 'hoje' });
  });
  it('X-Org-Id divergente → ErroOrgMudou', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp(LEIT, 200, J('org-2'))));
    await expect(buscarInventarioHoje('org-1')).rejects.toBeInstanceOf(ErroOrgMudou);
    await expect(buscarFoto('2026-12-31', 'org-1')).rejects.toBeInstanceOf(ErroOrgMudou);
  });
  it('{vazio:true} → null; foto existente volta inteira', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp({ vazio: true })));
    expect(await buscarFoto('2026-12-31', 'org-1')).toBeNull();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp(LEIT)));
    expect(await buscarFoto('2026-12-31', 'org-1')).toEqual(LEIT);
  });
  it('500 lança ErroPacote com a mensagem; falha do fetch vira ErroRede', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp({ error: 'Falha interna no inventário.' }, 500, { 'Content-Type': 'application/json' })));
    const e = await buscarFoto('2026-12-31', 'org-1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroPacote);
    expect(e).toMatchObject({ message: 'Falha interna no inventário.', status: 500 });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(buscarInventarioHoje('org-1')).rejects.toBeInstanceOf(ErroRede);
  });
  it('salvar devolve a nova versão; 409 vira ErroPacote com a mensagem da edge', async () => {
    const f = vi.fn<typeof fetch>(async () => resp({ versao: 4 }));
    vi.stubGlobal('fetch', f);
    const itens = [{ codigo: 'A1', quantidade_contada: 0, justificativa: 'quebra' }];
    expect(await salvarContagem('inv-1', 3, itens)).toBe(4);
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ acao: 'salvar', inventario_id: 'inv-1', versao: 3, itens });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp({ error: 'A contagem mudou em outra aba; recarregue.' }, 409, { 'Content-Type': 'application/json' })));
    await expect(salvarContagem('inv-1', 3, itens)).rejects.toMatchObject({ message: 'A contagem mudou em outra aba; recarregue.', status: 409 });
  });
  it('confirmar devolve o estado do push', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp({ push: 'pendente' })));
    expect(await confirmarInventario('inv-1', 4)).toBe('pendente');
  });
});
