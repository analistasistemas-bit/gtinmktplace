import { describe, it, expect } from 'vitest';
import { labelStatusEnvio } from '@/lib/ml-status';

describe('labelStatusEnvio', () => {
  it('null/undefined → traço', () => {
    expect(labelStatusEnvio(null).label).toBe('—');
    expect(labelStatusEnvio(undefined).label).toBe('—');
  });

  it('status simples mapeiam direto', () => {
    expect(labelStatusEnvio('delivered').label).toBe('Entregue');
    expect(labelStatusEnvio('shipped').label).toBe('Enviado');
    expect(labelStatusEnvio('not_delivered').label).toBe('Não entregue');
  });

  describe('ready_to_ship usa o substatus (espelha a tela de Vendas do ML)', () => {
    it('sem substatus (ou substatus de preparo) = Pronto p/ envio', () => {
      expect(labelStatusEnvio('ready_to_ship').label).toBe('Pronto p/ envio');
      expect(labelStatusEnvio('ready_to_ship', null).label).toBe('Pronto p/ envio');
      expect(labelStatusEnvio('ready_to_ship', 'printed').label).toBe('Pronto p/ envio');
      expect(labelStatusEnvio('ready_to_ship', 'ready_to_print').label).toBe('Pronto p/ envio');
    });

    it('invoice_pending = Aguardando NF', () => {
      expect(labelStatusEnvio('ready_to_ship', 'invoice_pending').label).toBe('Aguardando NF');
    });

    it('pacote já despachado = A caminho', () => {
      expect(labelStatusEnvio('ready_to_ship', 'dropped_off').label).toBe('A caminho');
      expect(labelStatusEnvio('ready_to_ship', 'picked_up').label).toBe('A caminho');
      expect(labelStatusEnvio('ready_to_ship', 'in_hub').label).toBe('A caminho');
    });
  });
});
