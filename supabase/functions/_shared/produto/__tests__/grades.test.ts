import { describe, expect, it } from 'vitest';
import {
  gradeDaFamilia,
  generosDaGrade,
  tamanhosDaGrade,
  tipoDaGradeTamanho,
  GRADES_DO_TIPO,
  numeracaoPublicavel,
} from '../tipos-produto-valores.ts';
import { tabelaQuadril } from '../../ml/medidas-valores.ts';

describe('tamanhosDaGrade', () => {
  it('calca, infantil e letras', () => {
    expect(tamanhosDaGrade('calca')).toEqual(['34', '36', '38', '40', '42', '44', '46', '48']);
    expect(tamanhosDaGrade('infantil')).toEqual(['2', '4', '6', '8', '10', '12', '14', '16']);
    expect(tamanhosDaGrade('letras')).toEqual(['P', 'M', 'G', 'GG', 'GGG']);
  });
  it('tipo da grade', () => {
    expect(tipoDaGradeTamanho('calca')).toBe('roupa');
    expect(tipoDaGradeTamanho('calcado')).toBe('calcado');
    expect(GRADES_DO_TIPO.roupa).toEqual(['letras', 'infantil', 'calca']);
  });
});

describe('gradeDaFamilia', () => {
  it('gravada valida vence; legado infere; invalida cai na inferencia', () => {
    expect(gradeDaFamilia('calca', ['34', '36'])).toBe('calca');
    expect(gradeDaFamilia(null, ['34', '36'])).toBe('calcado');
    expect(gradeDaFamilia(null, ['P', 'M'])).toBe('letras');
    expect(gradeDaFamilia('xpto', ['P'])).toBe('letras');
    expect(gradeDaFamilia(null, ['P', '34'])).toBeNull();
  });
});

describe('generosDaGrade', () => {
  it('infantil x adulto', () => {
    expect(generosDaGrade('infantil')).toEqual(['meninos', 'meninas', 'sem_genero_infantil']);
    expect(generosDaGrade('calca')).toEqual(['masculino', 'feminino', 'unissex']);
  });
});

describe('tabelaQuadril', () => {
  it('valores', () => {
    expect(tabelaQuadril('unissex')['48']).toBe(116);
    expect(tabelaQuadril('feminino')['P']).toBe(94);
    expect(tabelaQuadril('meninas')['16']).toBe(92);
    expect(tabelaQuadril('meninos')['P']).toBeUndefined();
  });
});

describe('numeracaoPublicavel com genero infantil', () => {
  it('tamanho de roupa infantil nao e assunto de calcado', () => {
    expect(numeracaoPublicavel('8', 'meninas')).toBe(true);
  });
});
