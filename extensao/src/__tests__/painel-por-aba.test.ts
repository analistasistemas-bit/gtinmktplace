import { beforeEach, describe, expect, it } from 'vitest';
import { ajustarPainelDaAba, painelSoNoMl } from '../abas';
import { instalarChromeFalso } from './chrome-falso';

const PAINEL = 'src/painel/index.html';
const setOptions = () => chrome.sidePanel.setOptions as unknown as { mock: { calls: unknown[][] } };

beforeEach(() => { instalarChromeFalso(); });

describe('painel lateral só nas abas do ML', () => {
  it('aba do ML habilita o painel nela', async () => {
    await ajustarPainelDaAba(3, 'https://produto.mercadolivre.com.br/MLB-1');
    expect(setOptions().mock.calls).toEqual([[{ tabId: 3, path: PAINEL, enabled: true }]]);
  });

  it('aba fora do ML (sem url: fora da host permission) desabilita o painel nela', async () => {
    await ajustarPainelDaAba(3, undefined);
    await ajustarPainelDaAba(4, 'https://mercadolivre.com.br.golpe.com/x');
    expect(setOptions().mock.calls).toEqual([[{ tabId: 3, enabled: false }], [{ tabId: 4, enabled: false }]]);
  });

  it('no boot: painel desligado por padrão e ligado nas abas do ML já abertas', async () => {
    const ml = 'https://www.mercadolivre.com.br/p/MLB2';
    (chrome.tabs.query as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([{ id: 9, url: ml }, { id: 5, url: ml }]);
    // Aba 5 saiu do ML depois do query: vale a URL relida (sem url = fora da host permission).
    (chrome.tabs.get as unknown as { mockImplementation: (f: (id: number) => unknown) => void })
      .mockImplementation(async (id: number) => (id === 9 ? { id, url: ml } : { id }));
    await painelSoNoMl();
    expect(setOptions().mock.calls).toEqual([[{ enabled: false }], [{ tabId: 9, path: PAINEL, enabled: true }], [{ tabId: 5, enabled: false }]]);
  });
});
