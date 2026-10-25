import { describe, expect, it } from 'vitest';
import { decidirEnvioCarrinho, type EstadoCarrinho } from '../carrinho.ts';

const P0 = '2026-10-24T17:00:00Z';
const mais = (s: number) => new Date(Date.parse(P0) + s * 1000);
const estado = (esperadas: number[] | null): EstadoCarrinho => ({
  chave: '9000', packId: 9000, orderId: 1, esperadas, primeiroEm: P0, tentativas: 0,
});

describe('decidirEnvioCarrinho', () => {
  it('todas as esperadas pagas → enviar completo', () => {
    expect(decidirEnvioCarrinho(estado([1, 2]), [1, 2], mais(20)))
      .toEqual({ acao: 'enviar', parcial: null, composicaoIncerta: false });
  });

  it('faltando order antes do prazo → aguardar 60', () => {
    expect(decidirEnvioCarrinho(estado([1, 2]), [1], mais(70))).toEqual({ acao: 'aguardar', delaySeg: 60 });
  });

  it('prazo é absoluto (600 s): em +580 s aguarda só 20', () => {
    expect(decidirEnvioCarrinho(estado([1, 2]), [1], mais(580))).toEqual({ acao: 'aguardar', delaySeg: 20 });
  });

  it('no prazo, envia parcial com o que houver', () => {
    expect(decidirEnvioCarrinho(estado([1, 2, 3]), [1, 2], mais(600)))
      .toEqual({ acao: 'enviar', parcial: { recebidos: 2, total: 3 }, composicaoIncerta: false });
  });

  it('no prazo sem nenhuma paga → descartar', () => {
    expect(decidirEnvioCarrinho(estado([1, 2]), [], mais(600))).toEqual({ acao: 'descartar' });
  });

  it('composição desconhecida: aguarda até o prazo e envia marcando incerta', () => {
    expect(decidirEnvioCarrinho(estado(null), [1], mais(70))).toEqual({ acao: 'aguardar', delaySeg: 60 });
    expect(decidirEnvioCarrinho(estado(null), [1], mais(600)))
      .toEqual({ acao: 'enviar', parcial: null, composicaoIncerta: true });
  });

  it('pedido sem pack (esperadas = [order]) → enviar na hora', () => {
    expect(decidirEnvioCarrinho({ ...estado([1]), packId: null, chave: '1' }, [1], mais(20)))
      .toEqual({ acao: 'enviar', parcial: null, composicaoIncerta: false });
  });
});
