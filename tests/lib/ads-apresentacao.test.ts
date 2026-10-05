import { describe, expect, it } from 'vitest';
import type { FamiliaPainel } from '@/lib/ads-painel';
import { contarFamiliasAds, filtrarFamiliasAds } from '@/lib/ads-apresentacao';

const base: FamiliaPainel = {
  codigoPai: 'A',
  nome: 'Fam A',
  grupos: 1,
  custoCompartilhado: 0,
  custo: 50,
  vendasDiretas: 400,
  vendasTotais: 500,
  cliques: 0,
  impressoes: 0,
  roas: 10,
  roasDireto: 8,
  acos: 0.1,
  acosDireto: 0.125,
  lucroAntes: 250,
  resultado: 200,
  margemConsumida: 0.2,
  acosEquilibrio: 0.25,
  semaforo: 'dentro',
  motivo: null,
  fonteCusto: 'real',
};

describe('apresentação de famílias Ads', () => {
  const familias: FamiliaPainel[] = [
    base,
    { ...base, codigoPai: 'B', semaforo: 'acima' },
    { ...base, codigoPai: 'C', semaforo: null },
    { ...base, codigoPai: 'D', semaforo: 'sem_espaco' },
  ];

  it('conta estados e preserva a ordem recebida', () => {
    expect(contarFamiliasAds(familias, true)).toEqual({
      total: 4,
      acima: 1,
      semEspaco: 1,
      dentro: 1,
      semReferencia: 1,
    });

    expect(filtrarFamiliasAds(familias, 'atencao', true).map(f => f.codigoPai))
      .toEqual(['B', 'D']);
    expect(filtrarFamiliasAds(familias, 'dentro', true).map(f => f.codigoPai))
      .toEqual(['A']);
    expect(filtrarFamiliasAds(familias, 'sem_referencia', true).map(f => f.codigoPai))
      .toEqual(['C']);
  });

  it('semáforo desligado torna todas sem referência', () => {
    expect(contarFamiliasAds(familias, false)).toEqual({
      total: 4,
      acima: 0,
      semEspaco: 0,
      dentro: 0,
      semReferencia: 4,
    });
    expect(filtrarFamiliasAds(familias, 'atencao', false)).toEqual([]);
    expect(filtrarFamiliasAds(familias, 'sem_referencia', false)).toEqual(familias);
  });
});
