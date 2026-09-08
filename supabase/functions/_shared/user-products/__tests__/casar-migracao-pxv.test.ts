import { describe, it, expect } from 'vitest';
import { casarNovosItens, type NovoItemML } from '../casar-migracao-pxv';
import type { VariacaoSnapshot } from '../../ml/migracao-pxv';

const SNAP: VariacaoSnapshot[] = [
  { id: '10', sku: '00000001', cor: 'Azul' },
  { id: '20', sku: '00000002', cor: 'Rosa' },
];
const LOCAIS = [
  { codigo: '00000001', mlVariationId: '10' },
  { codigo: '00000002', mlVariationId: '20' },
];

describe('casarNovosItens — degrau (a): variation_id', () => {
  it('casa cada anúncio novo ao SKU da variação correspondente', () => {
    const novos: NovoItemML[] = [
      { itemId: 'MLB-A', variationId: '10' },
      { itemId: 'MLB-B', variationId: '20' },
    ];
    const r = casarNovosItens(SNAP, novos, LOCAIS);
    expect(r.tipo).toBe('ok');
    expect((r as { degrau: string }).degrau).toBe('variation_id');
    expect([...(r as { itemPorSku: Map<string, string> }).itemPorSku]).toEqual([
      ['00000001', 'MLB-A'], ['00000002', 'MLB-B'],
    ]);
  });

  // O SKU do snapshot vem do ML com zeros à esquerda; o do banco pode estar sem. Sem normalizar,
  // `02186560` e `2186560` seriam SKUs diferentes e o casamento falharia por formatação.
  it('normaliza o código ao casar (zeros à esquerda)', () => {
    const snap: VariacaoSnapshot[] = [{ id: '10', sku: '2186560', cor: 'Azul' }];
    const r = casarNovosItens(snap, [{ itemId: 'MLB-A', variationId: '10' }], [
      { codigo: '02186560', mlVariationId: '10' },
    ]);
    expect(r.tipo).toBe('ok');
    // Ambos normalizam para a mesma chave — qualquer que seja a forma canônica do projeto.
    expect([...(r as { itemPorSku: Map<string, string> }).itemPorSku.values()]).toEqual(['MLB-A']);
  });

  // O ML não exige `seller_custom_field` na variação. Sem SKU no snapshot, o vínculo local pelo
  // MESMO id de variação nomeia a cor — são ids do mesmo item, sem ambiguidade.
  it('snapshot sem SKU usa o ml_variation_id local', () => {
    const snap: VariacaoSnapshot[] = [{ id: '10', sku: null, cor: 'Azul' }];
    const r = casarNovosItens(snap, [{ itemId: 'MLB-A', variationId: '10' }], LOCAIS);
    expect(r.tipo).toBe('ok');
    expect([...(r as { itemPorSku: Map<string, string> }).itemPorSku]).toEqual([['00000001', 'MLB-A']]);
  });
});

describe('casarNovosItens — degrau (b): cor', () => {
  // Cenário real: o ML não preservou `variations[].id` nos novos itens (foi o que aconteceu com o
  // `seller_custom_field` no ADR-0105). Aí o degrau (a) não casa nada e a cor decide — ainda usando
  // só ids que vieram de `new_items`, nunca uma busca por título.
  it('cai para a cor quando o variation_id não bate', () => {
    const novos: NovoItemML[] = [
      { itemId: 'MLB-A', variationId: '999', cor: 'Azul' },
      { itemId: 'MLB-B', variationId: '888', cor: 'Rosa' },
    ];
    const r = casarNovosItens(SNAP, novos, LOCAIS);
    expect(r.tipo).toBe('ok');
    expect((r as { degrau: string }).degrau).toBe('cor');
    expect((r as { itemPorSku: Map<string, string> }).itemPorSku.get('00000002')).toBe('MLB-B');
  });

  it('compara cor sem diferenciar caixa nem espaços', () => {
    const novos: NovoItemML[] = [
      { itemId: 'MLB-A', variationId: '999', cor: '  azul ' },
      { itemId: 'MLB-B', variationId: '888', cor: 'ROSA' },
    ];
    expect(casarNovosItens(SNAP, novos, LOCAIS).tipo).toBe('ok');
  });

  // Adoção é tudo-ou-nada (ADR-0104): casar metade deixaria cores órfãs e a família viraria
  // "publicada" com anúncios fora do controle do app.
  it('cor lida só de alguns → não usa o degrau, falha', () => {
    const novos: NovoItemML[] = [
      { itemId: 'MLB-A', variationId: '999', cor: 'Azul' },
      { itemId: 'MLB-B', variationId: '888' },
    ];
    expect(casarNovosItens(SNAP, novos, LOCAIS).tipo).toBe('falha');
  });

  it('cor duplicada no snapshot → falha em vez de escolher', () => {
    const snap: VariacaoSnapshot[] = [
      { id: '10', sku: 'A', cor: 'Azul' },
      { id: '20', sku: 'B', cor: 'Azul' },
    ];
    const novos: NovoItemML[] = [
      { itemId: 'MLB-A', variationId: '999', cor: 'Azul' },
      { itemId: 'MLB-B', variationId: '888', cor: 'Azul' },
    ];
    const r = casarNovosItens(snap, novos, []);
    expect(r.tipo).toBe('falha');
    expect((r as { motivo: string }).motivo).toMatch(/mesma cor/i);
  });
});

describe('casarNovosItens — recusa em vez de adivinhar', () => {
  it('sem anúncios novos informados → falha', () => {
    expect(casarNovosItens(SNAP, [], LOCAIS).tipo).toBe('falha');
  });

  it('casamento parcial → falha nomeando quantos casaram', () => {
    const novos: NovoItemML[] = [
      { itemId: 'MLB-A', variationId: '10' },
      { itemId: 'MLB-B', variationId: '777' },
    ];
    const r = casarNovosItens(SNAP, novos, LOCAIS);
    expect(r.tipo).toBe('falha');
    expect((r as { motivo: string }).motivo).toMatch(/1 de 2/);
  });

  // O CASO QUE MOTIVA ESTE MÓDULO. A descoberta por título do ADR-0105 encontraria uma família irmã
  // do mesmo vendedor — mesmo título, mesmas cores — validaria `family_id` único e casaria 1:1 com o
  // PRODUTO ERRADO. Aqui não há degrau por título: sem `new_items` utilizáveis, falha.
  it('não tenta adivinhar por título: sem ids do ML utilizáveis, falha', () => {
    const novosDeOutroProduto: NovoItemML[] = [
      { itemId: 'MLB-IRMAO-A', variationId: 'x1', cor: 'Turquesa' },
      { itemId: 'MLB-IRMAO-B', variationId: 'x2', cor: 'Coral' },
    ];
    const r = casarNovosItens(SNAP, novosDeOutroProduto, LOCAIS);
    expect(r.tipo).toBe('falha');
    // E o motivo aponta o caminho seguro, em que a decisão volta a ser do operador.
    expect((r as { motivo: string }).motivo).toMatch(/Publique uma atualização/i);
  });
});
