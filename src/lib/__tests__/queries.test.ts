import { describe, expect, it } from 'vitest';
import { familiaFromRow, formatoPublicacaoMlFromRow } from '@/lib/queries';
import { familiaPublicavel } from '@/lib/publicavel';

describe('formatoPublicacaoMlFromRow', () => {
  it('mapeia a propriedade sintética User Products', () => {
    expect(formatoPublicacaoMlFromRow({ formato_publicacao_ml: 'user_products' })).toBe('user_products');
  });

  it('mantém desconhecido quando a propriedade sintética não existe', () => {
    expect(formatoPublicacaoMlFromRow({})).toBeNull();
  });
});

// A regra "produto simples com capa não exige foto por variação" (publicavel.ts) só vale na tela
// se `capa_storage_path` chegar mapeado da row. Este teste atravessa o mapeador real em vez de
// montar o objeto Familia na mão — é o que separa fixture verde de Revisão destravada.
describe('familiaFromRow → capaStoragePath destrava produto simples sem foto na variação', () => {
  const row = (capa: string | null) => ({
    id: 'f1', lote_id: 'l1', codigo_pai: '00123', nome_pai: 'Gel de Limpeza', titulo_ml: null,
    descricao_ml: null, descricao_pai: '', operacao: 'CREATE', status: 'pronto',
    tipo_aviamento: 'outro', categoria_ml_id: 'MLB1234', atributos_faltantes: null,
    capa_storage_path: capa, capa2_storage_path: null, capa3_storage_path: null,
    variacao_principal_codigo: '00123001', ml_item_id: null,
    variacoes: [{
      codigo: '00123001', cor: null, preco: 37.6, preco_publicacao: 37.6, estoque: 5,
      imagem_path: null, excluida_da_publicacao: false, ml_variation_id: null,
    }],
  }) as unknown as Parameters<typeof familiaFromRow>[0];

  it('com capa: publicável mesmo sem foto na variação', () => {
    expect(familiaFromRow(row('user/capas/00123.jpg')).capaStoragePath).toBe('user/capas/00123.jpg');
    expect(familiaPublicavel(familiaFromRow(row('user/capas/00123.jpg'))).ok).toBe(true);
  });

  it('sem capa: segue bloqueando por falta de foto', () => {
    expect(familiaPublicavel(familiaFromRow(row(null))).motivos)
      .toContainEqual(expect.stringContaining('sem foto'));
  });
});
