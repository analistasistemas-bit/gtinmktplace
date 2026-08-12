import { describe, it, expect } from 'vitest';
import { ETAPAS_JORNADA, jornadaDoLote, destinoDoLote } from '../jornada';

describe('jornadaDoLote', () => {
  it('mapeia cada status técnico para a etapa visível', () => {
    expect(jornadaDoLote('importando')).toEqual({ indiceAtual: 0, erro: false });
    expect(jornadaDoLote('processando')).toEqual({ indiceAtual: 1, erro: false });
    expect(jornadaDoLote('revisao')).toEqual({ indiceAtual: 2, erro: false });
    expect(jornadaDoLote('publicando')).toEqual({ indiceAtual: 3, erro: false });
    expect(jornadaDoLote('concluido')).toEqual({ indiceAtual: ETAPAS_JORNADA.length, erro: false });
    expect(jornadaDoLote('erro')).toEqual({ indiceAtual: 1, erro: true });
  });

  // Lote #46: publicação recusada pelo ML, lote fechado como 'concluido' e o stepper
  // acendia "Publicado" em verde — a tela dizia publicado e "1 com erro" ao mesmo tempo.
  it('concluído sem nenhuma família publicada para na etapa Publicado, com erro', () => {
    expect(jornadaDoLote('concluido', { publicadas: 0, erros: 1 })).toEqual({
      indiceAtual: ETAPAS_JORNADA.length - 1,
      erro: true,
    });
  });

  it('concluído com publicação parcial segue concluído (publicou de fato)', () => {
    expect(jornadaDoLote('concluido', { publicadas: 2, erros: 1 })).toEqual({
      indiceAtual: ETAPAS_JORNADA.length,
      erro: false,
    });
  });

  it('concluído sem erros e sem publicadas (nada selecionado) segue concluído', () => {
    expect(jornadaDoLote('concluido', { publicadas: 0, erros: 0 })).toEqual({
      indiceAtual: ETAPAS_JORNADA.length,
      erro: false,
    });
  });

  it('o resultado não muda etapas anteriores à publicação', () => {
    expect(jornadaDoLote('revisao', { publicadas: 0, erros: 3 })).toEqual({
      indiceAtual: 2,
      erro: false,
    });
  });
});

describe('destinoDoLote', () => {
  it('lote em revisão vai para a Revisão; concluído e erro vão para o Relatório', () => {
    expect(destinoDoLote('revisao', 'l1')).toBe('/revisao/l1');
    expect(destinoDoLote('concluido', 'l1')).toBe('/relatorio/l1');
    expect(destinoDoLote('erro', 'l1')).toBe('/relatorio/l1');
    expect(destinoDoLote('processando', 'l1')).toBe('/progresso/l1');
  });
});
