import { describe, it, expect } from 'vitest';
import { rotuloMotivo, MOTIVOS_MOVIMENTO, type MotivoMovimento } from '../movimentos-estoque';

describe('rotuloMotivo', () => {
  it('traduz cada motivo para texto do operador', () => {
    expect(rotuloMotivo('venda')).toBe('Venda');
    expect(rotuloMotivo('entrada')).toBe('Entrada');
    expect(rotuloMotivo('estorno_venda')).toBe('Estorno de venda');
    expect(rotuloMotivo('venda_sku_nao_encontrado')).toBe('Venda de SKU não cadastrado');
    expect(rotuloMotivo('estorno_sku_nao_encontrado')).toBe('Estorno de SKU não cadastrado');
    expect(rotuloMotivo('cancelamento_sem_baixa')).toBe('Cancelamento sem baixa');
    expect(rotuloMotivo('venda_cancelada_antes')).toBe('Venda cancelada antes da baixa');
  });

  // Se a migration ganhar um motivo novo, este teste falha e obriga a traduzir —
  // em vez de a tela mostrar o identificador cru do banco pro operador.
  it('todo motivo do check-constraint tem rótulo', () => {
    for (const m of MOTIVOS_MOVIMENTO) {
      expect(rotuloMotivo(m), `motivo=${m}`).toBeTruthy();
      expect(rotuloMotivo(m)).not.toBe(m);
    }
  });

  it('motivo desconhecido cai no próprio identificador em vez de quebrar a tela', () => {
    expect(rotuloMotivo('motivo_que_nao_existe' as MotivoMovimento)).toBe('motivo_que_nao_existe');
  });
});
