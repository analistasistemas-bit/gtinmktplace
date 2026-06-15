import { describe, it, expect } from 'vitest';
import { shopeeConnector } from '../shopee';
import type { ContextoCanal } from '../contrato';

const ctx: ContextoCanal = { getToken: async () => 'tok', shopId: '209920' };

describe('shopeeConnector', () => {
  it('id e capabilities da Fatia 1', () => {
    expect(shopeeConnector.id).toBe('shopee');
    expect(shopeeConnector.capabilities).toEqual({
      variacoes: true,
      descricaoSeparada: false,
      catalogo: false,
      desconto: true,
      dimensoesPacote: true,
    });
  });

  it('garantirDescricao é no-op (resolve void)', async () => {
    await expect(shopeeConnector.garantirDescricao(ctx, 'item1', 'desc')).resolves.toBeUndefined();
  });

  it('sincronizarDescricao é no-op (resolve null)', async () => {
    await expect(shopeeConnector.sincronizarDescricao(ctx, 'item1', 'desc', ['Azul'])).resolves.toBeNull();
  });

  it('atualizarAnuncio retorna erro NAO_SUPORTADO na Fatia 1', async () => {
    const r = await shopeeConnector.atualizarAnuncio(ctx, {
      itemExternoId: 'item1', existentes: [], novas: [], capaFotoId: null, capa2FotoId: null,
      capa3FotoId: null, categoriaId: null, marca: null, dimensoes: null, desconto: null, precoFamilia: null,
    });
    expect(r.ok).toBe(false);
    expect(r.erro?.codigo).toBe('NAO_SUPORTADO');
    expect(r.erro?.retentavel).toBe(false);
  });
});
