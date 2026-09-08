import { describe, it, expect } from 'vitest';
import { fundirAnunciosMigrados, type BaseMigrados } from '../anuncios-migrados';

const base = (): BaseMigrados => ({ idsPubliai: new Set(), codPorVar: new Map(), eanPorVar: new Map() });
const SEM_EAN = () => null;

// Sem isto, um pedido feito ANTES da migração e reprocessado depois (reconciliação, backfill,
// webhook atrasado) chegaria com um ml_item_id que não está mais no conjunto do app: seria tratado
// como venda de fora, sem código, sem custo, fora dos números — e disparando o alerta de "venda de
// SKU fora do catálogo". Mesma classe de falha do incidente de 2026-08-11 (12 unidades vendidas sem
// baixar estoque).
describe('fundirAnunciosMigrados', () => {
  it('o anúncio encerrado continua contando como anúncio do PubliAI', () => {
    const b = base();
    fundirAnunciosMigrados(b, [{ mlItemIdAnterior: 'MLB-VELHO', snapshot: [] }], SEM_EAN);
    expect(b.idsPubliai.has('MLB-VELHO')).toBe(true);
  });

  // O ML pode não mandar `seller_custom_field` no pedido; o snapshot dá variation_id → sku, então a
  // venda antiga continua resolvendo o produto por variação.
  it('resolve o código da venda antiga pelo variation_id do snapshot', () => {
    const b = base();
    fundirAnunciosMigrados(b, [{
      mlItemIdAnterior: 'MLB-VELHO',
      snapshot: [{ id: '10', sku: '00000001' }, { id: '20', sku: '00000002' }],
    }], SEM_EAN);
    expect(b.codPorVar.get('MLB-VELHO:10')).toBe('00000001');
    expect(b.codPorVar.get('MLB-VELHO:20')).toBe('00000002');
  });

  it('preenche o EAN quando o código tem GTIN cadastrado', () => {
    const b = base();
    fundirAnunciosMigrados(
      b,
      [{ mlItemIdAnterior: 'MLB-VELHO', snapshot: [{ id: '10', sku: 'V1' }] }],
      (sku) => (sku === 'V1' ? '07891234567890' : null),
    );
    expect(b.eanPorVar.get('MLB-VELHO:10')).toBe('07891234567890');
  });

  // O anúncio encerrado é histórico: não pode sobrescrever o mapeamento de um anúncio vivo se um id
  // de variação coincidir.
  it('não sobrescreve mapeamento existente', () => {
    const b = base();
    b.codPorVar.set('MLB-VELHO:10', 'ATUAL');
    fundirAnunciosMigrados(b, [{
      mlItemIdAnterior: 'MLB-VELHO', snapshot: [{ id: '10', sku: 'ANTIGO' }],
    }], SEM_EAN);
    expect(b.codPorVar.get('MLB-VELHO:10')).toBe('ATUAL');
  });

  it('ignora linha sem ml_item_id_anterior', () => {
    const b = base();
    fundirAnunciosMigrados(b, [{ mlItemIdAnterior: null, snapshot: [{ id: '1', sku: 'X' }] }], SEM_EAN);
    expect(b.idsPubliai.size).toBe(0);
    expect(b.codPorVar.size).toBe(0);
  });

  // O snapshot vem de jsonb: pode estar ausente, malformado, ou com entradas incompletas (o ML não
  // exige SKU na variação). Nenhum desses casos pode derrubar o carregamento do catálogo inteiro,
  // que é o que alimenta toda a resolução de vendas da org.
  it('tolera snapshot ausente, não-array ou com entradas incompletas', () => {
    const b = base();
    fundirAnunciosMigrados(b, [
      { mlItemIdAnterior: 'MLB-A', snapshot: null },
      { mlItemIdAnterior: 'MLB-B', snapshot: 'lixo' },
      { mlItemIdAnterior: 'MLB-C', snapshot: [{ id: '1' }, { sku: 'X' }, { id: '2', sku: '' }] },
    ], SEM_EAN);
    expect([...b.idsPubliai].sort()).toEqual(['MLB-A', 'MLB-B', 'MLB-C']);
    expect(b.codPorVar.size).toBe(0);
  });

  it('id numérico no snapshot vira string na chave', () => {
    const b = base();
    fundirAnunciosMigrados(b, [{
      mlItemIdAnterior: 'MLB-VELHO', snapshot: [{ id: 45674567, sku: 'V1' }],
    }], SEM_EAN);
    expect(b.codPorVar.get('MLB-VELHO:45674567')).toBe('V1');
  });
});
