import { afterEach, describe, expect, it, vi } from 'vitest';
import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import { queryClient } from '../query-client';

// ADR-0153 (D2): nenhuma escrita offline. Sem rede, a mutation tem que falhar na hora — não
// ficar pausada esperando a conexão voltar para disparar sozinha sobre um dado que já mudou.
//
// Nota sobre o formato do teste: com networkMode 'online' (default) e sem rede, a mutation
// nunca chama mutationFn e o resultado nunca chega a 'error' — fica pendurada em 'pending'
// esperando reconexão. `await observer.mutate()` travaria até o timeout do teste em vez de
// falhar rápido, então a verificação é sobre o estado observável (mutationFn foi chamada? o
// status chegou a 'error'?), com um `vi.waitFor` de janela curta — falha rápido no vermelho.
describe('queryClient — mutations.networkMode', () => {
  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it('sem rede, a mutation roda e rejeita em vez de ficar pausada', async () => {
    let chamadas = 0;
    const observer = new MutationObserver(queryClient, {
      mutationFn: async () => {
        chamadas++;
        throw new Error('falha simulada');
      },
    });

    onlineManager.setOnline(false);
    observer.mutate().catch(() => {});

    await vi.waitFor(() => {
      expect(chamadas).toBe(1);
      expect(observer.getCurrentResult().status).toBe('error');
    }, { timeout: 300, interval: 20 });
  });

  // A garantia de domínio do ADR-0153: publicar, pausar, reprecificar e movimentar estoque agem
  // sobre estado que muda no servidor sem o operador. Reexecutar ao reconectar seria aplicar uma
  // decisão tomada minutos antes, sobre um mercado que já mudou.
  //
  // O contraste com um client de controle em 'online' é o que dá valor a este caso: sem ele, a
  // asserção depois do setOnline(true) seria inerte (uma mutation em 'error' com retry 0 nunca
  // é reexecutada sob nenhum networkMode). Com o controle, o teste mostra os dois comportamentos
  // lado a lado — e falha se alguém reverter a configuração.
  it('ao reconectar: a nossa não reexecuta; a configuração antiga executaria', async () => {
    const controle = new QueryClient({ defaultOptions: { mutations: { networkMode: 'online' } } });
    // mount() é o que assina o onlineManager e faz o client retomar as mutations pausadas ao
    // reconectar. Sem isso o controle ficaria mudo e o teste passaria sem provar nada.
    controle.mount();
    let chamadasNossas = 0;
    let chamadasControle = 0;

    const nossa = new MutationObserver(queryClient, {
      mutationFn: async () => {
        chamadasNossas++;
        throw new Error('falha simulada');
      },
    });
    const antiga = new MutationObserver(controle, {
      mutationFn: async () => {
        chamadasControle++;
        return 'ok';
      },
    });

    onlineManager.setOnline(false);
    nossa.mutate().catch(() => {});
    antiga.mutate().catch(() => {});

    // Sem rede: a nossa já rodou e falhou; a antiga não encostou no servidor — ficou pausada.
    await vi.waitFor(() => expect(chamadasNossas).toBe(1), { timeout: 300, interval: 20 });
    expect(chamadasControle).toBe(0);

    onlineManager.setOnline(true);

    // Com a rede de volta: a antiga dispara sozinha — exatamente o que o ADR proíbe.
    await vi.waitFor(() => expect(chamadasControle).toBe(1), { timeout: 500, interval: 20 });
    expect(chamadasNossas).toBe(1);
    expect(nossa.getCurrentResult().status).toBe('error');

    controle.unmount();
  });
});
