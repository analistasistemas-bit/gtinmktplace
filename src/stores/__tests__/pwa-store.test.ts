import { beforeEach, describe, expect, it } from 'vitest';
import { usePwaStore } from '../pwa-store';

describe('pwa store', () => {
  beforeEach(() => {
    usePwaStore.setState({ needRefresh: false, offlineReady: false, updateSW: null });
  });

  it('começa sem versão nova e sem função de atualização', () => {
    expect(usePwaStore.getState()).toMatchObject({ needRefresh: false, offlineReady: false, updateSW: null });
  });

  it('registra o sinal de versão nova (onNeedRefresh do service worker)', () => {
    usePwaStore.getState().setNeedRefresh(true);

    expect(usePwaStore.getState().needRefresh).toBe(true);
  });

  it('registra o precache concluído (onOfflineReady do service worker)', () => {
    usePwaStore.getState().setOfflineReady(true);

    expect(usePwaStore.getState().offlineReady).toBe(true);
  });

  it('guarda a função updateSW para o componente de aviso poder aplicar a troca', async () => {
    const updateSW = async () => {};
    usePwaStore.getState().setUpdateSW(updateSW);

    expect(usePwaStore.getState().updateSW).toBe(updateSW);
  });
});
