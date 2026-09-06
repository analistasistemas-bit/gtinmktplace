// ADR-0154: conversão de escala do desconto (0-100 na tela ↔ 0-1 no ML, D-3 da migration
// 20260906140450) e a mensagem "margem indisponível" (Decisão 6) — as duas partes puras de
// `lib/kit-virtual.ts` que o diálogo de criação depende para não mandar a fração errada nem
// esconder um campo faltante atrás de um número mudo.
import { describe, expect, it } from 'vitest';
import {
  pctParaFracaoDesconto, fracaoParaPctDesconto, descreverFaltandoMargemKit,
  type ComponenteSelecionadoKitVirtual, type ComponenteCandidatoKitVirtual,
} from '../kit-virtual';

describe('pctParaFracaoDesconto / fracaoParaPctDesconto', () => {
  it('converte 15% (escala humana) para a fração 0.15 (escala do ML)', () => {
    expect(pctParaFracaoDesconto(15)).toBe(0.15);
  });

  it('round-trip: pct -> fração -> pct devolve o valor original para inteiros 0-99', () => {
    for (const pct of [0, 1, 15, 30, 50, 99]) {
      expect(fracaoParaPctDesconto(pctParaFracaoDesconto(pct))).toBe(pct);
    }
  });

  it('0% vira fração 0, nunca é tratado como "sem desconto informado"', () => {
    expect(pctParaFracaoDesconto(0)).toBe(0);
  });

  it('arredonda entrada não inteira antes de dividir (proteção contra float de input)', () => {
    expect(pctParaFracaoDesconto(15.4)).toBe(0.15);
    expect(pctParaFracaoDesconto(15.6)).toBe(0.16);
  });
});

function candidato(over: Partial<ComponenteCandidatoKitVirtual> = {}): ComponenteCandidatoKitVirtual {
  return {
    userProductId: 'UP1', itemId: 'MLB1', title: 'Produto 1', type: 'available',
    thumbnailUrl: null, categoryName: 'Categoria', estoque: 10,
    reasons: [], codigo: '00000001', codigoPai: '00000001', custo: 5, origem: 'nacional',
    kitMultiplicador: null, precoAtualML: 10, categoriaMlId: 'MLB999', ...over,
  };
}

function selecionado(over: Partial<ComponenteCandidatoKitVirtual> = {}, quantidade = 1, precoAtualML = 10): ComponenteSelecionadoKitVirtual {
  return { candidato: candidato(over), quantidade, precoAtualML };
}

describe('descreverFaltandoMargemKit', () => {
  it('nomeia o componente pelo título quando `ordem` aponta pra ele', () => {
    const componentes = [
      selecionado({ title: 'Motosserra' }),
      selecionado({ title: 'Canivete' }),
    ];
    const msg = descreverFaltandoMargemKit([{ ordem: 1, campo: 'custo' }], componentes);
    expect(msg).toBe('margem indisponível: falta custo em Canivete');
  });

  it('usa "organização" para o campo sentinela ordem=-1 (alíquota/comissão)', () => {
    const componentes = [selecionado({ title: 'Motosserra' }), selecionado({ title: 'Canivete' })];
    const msg = descreverFaltandoMargemKit([{ ordem: -1, campo: 'aliquotas' }], componentes);
    expect(msg).toBe('margem indisponível: falta alíquota confirmada da organização em organização');
  });

  it('junta múltiplos campos faltantes numa única mensagem', () => {
    const componentes = [selecionado({ title: 'Motosserra' }), selecionado({ title: 'Canivete' })];
    const msg = descreverFaltandoMargemKit(
      [{ ordem: 0, campo: 'custo' }, { ordem: 1, campo: 'origem' }, { ordem: -1, campo: 'comissao' }],
      componentes,
    );
    expect(msg).toBe(
      'margem indisponível: falta custo em Motosserra, origem fiscal em Canivete, comissão do Mercado Livre em organização',
    );
  });
});
