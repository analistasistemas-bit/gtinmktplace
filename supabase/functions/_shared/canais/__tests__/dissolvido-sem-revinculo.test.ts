import { describe, it, expect } from 'vitest';
import { mensagemDissolvidoSemRevinculo } from '../dissolvido-sem-revinculo';
import type { ErroCanal } from '../contrato';

const MOTIVO_ORIGINAL = 'Anúncio closed no Mercado Livre. Estoque e preço não podem ser atualizados '
  + '— republique o produto para voltar a vender.';

const dissolvido: ErroCanal = {
  codigo: 'MIGRADO_PARA_UP',
  mensagemOperador: 'Anúncio encerrado no Mercado Livre — verificando se foi migrado para o modelo User Products (ADR-0105).',
  retentavel: false,
  up: {
    familyId: null, familyName: null, sellerId: 'seller-1',
    dissolvido: {
      titulo: 'X', categoriaId: 'MLB1', corPorSku: { A1: 'Azul' },
      motivoFallback: MOTIVO_ORIGINAL,
    },
  },
};

describe('mensagemDissolvidoSemRevinculo (ADR-0105 §7)', () => {
  it('anúncio dissolvido → devolve o motivo ORIGINAL do guard, nunca a promessa de verificação', () => {
    const m = mensagemDissolvidoSemRevinculo(dissolvido);
    expect(m).toContain(MOTIVO_ORIGINAL);
    // O texto tipado do conector prometeria uma verificação que este caminho não faz.
    expect(m).not.toContain('verificando');
    // E diz o motivo real de não ter re-vinculado sozinho.
    expect(m).toContain('dividido em vários anúncios');
  });

  it('MIGRADO_PARA_UP do caminho do ADR-0104 (sem `dissolvido`) → null, comportamento intocado', () => {
    const legado: ErroCanal = {
      codigo: 'MIGRADO_PARA_UP', mensagemOperador: 'x', retentavel: false,
      up: { familyId: 'F1', familyName: 'N', sellerId: 's' },
    };
    expect(mensagemDissolvidoSemRevinculo(legado)).toBeNull();
  });

  it('erro de canal comum → null (o chamador segue com mensagemOperador)', () => {
    expect(mensagemDissolvidoSemRevinculo({
      codigo: 'ESTOQUE', mensagemOperador: 'estoque inválido', retentavel: false,
    })).toBeNull();
  });
});
