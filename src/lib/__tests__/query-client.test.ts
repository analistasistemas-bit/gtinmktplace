import { afterEach, describe, expect, it, vi } from 'vitest';
import { MutationObserver, onlineManager } from '@tanstack/react-query';
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
  // decisão tomada minutos antes, sobre um mercado que já mudou. Este caso é a trava contra
  // alguém remover o networkMode: 'always' no futuro sem perceber o que está reabrindo.
  it('ao reconectar, a mutation que falhou offline não é reexecutada', async () => {
    let chamadas = 0;
    const observer = new MutationObserver(queryClient, {
      mutationFn: async () => {
        chamadas++;
        throw new Error('falha simulada');
      },
    });

    onlineManager.setOnline(false);
    observer.mutate().catch(() => {});
    await vi.waitFor(() => expect(chamadas).toBe(1), { timeout: 300, interval: 20 });

    onlineManager.setOnline(true);
    await new Promise((r) => setTimeout(r, 150));

    expect(chamadas).toBe(1);
    expect(observer.getCurrentResult().status).toBe('error');
  });
});
