// O caminho da categoria é a única leitura do app que fala direto com a API pública do ML — todo
// consumidor mocka este módulo, então é aqui (e só aqui) que o parser e o cache são exercitados.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { caminhoCategoriaML } from '../caminho-categoria-ml';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function resposta(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
}

describe('caminhoCategoriaML', () => {
  it('devolve os nomes do path_from_root na ordem, com a folha no fim', async () => {
    fetchMock.mockReturnValue(resposta({
      path_from_root: [
        { id: 'MLB1384', name: 'Bebês' },
        { id: 'MLB5360', name: 'Alimentação e Amamentação' },
        { id: 'MLB264035', name: 'Aquecedores De Mamadeiras' },
      ],
    }));

    await expect(caminhoCategoriaML('MLB264035')).resolves.toEqual([
      'Bebês', 'Alimentação e Amamentação', 'Aquecedores De Mamadeiras',
    ]);
  });

  it('id fora do formato MLB não vira URL (guard de SSRF) e nem chega a buscar', async () => {
    await expect(caminhoCategoriaML('../../users/me')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404 do ML resolve vazio — quem chama cai no nome simples da categoria', async () => {
    fetchMock.mockReturnValue(resposta({ message: 'Category not found' }, false));
    await expect(caminhoCategoriaML('MLB999999999')).resolves.toEqual([]);
  });

  it('falha de rede resolve vazio e NÃO fica grudada no cache (a próxima tentativa busca de novo)', async () => {
    fetchMock.mockReturnValueOnce(Promise.reject(new Error('offline')));
    await expect(caminhoCategoriaML('MLB1000')).resolves.toEqual([]);

    fetchMock.mockReturnValueOnce(resposta({ path_from_root: [{ name: 'Fitas Adesivas' }] }));
    await expect(caminhoCategoriaML('MLB1000')).resolves.toEqual(['Fitas Adesivas']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resultado bom fica em cache: N chamadas para o mesmo id = 1 requisição', async () => {
    fetchMock.mockReturnValue(resposta({ path_from_root: [{ name: 'Agro' }] }));

    const [a, b] = await Promise.all([caminhoCategoriaML('MLB1500'), caminhoCategoriaML('MLB1500')]);
    await caminhoCategoriaML('MLB1500');

    expect(a).toEqual(['Agro']);
    expect(b).toEqual(['Agro']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
