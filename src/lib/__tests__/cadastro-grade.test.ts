import { describe, expect, it } from 'vitest';
import { chaveGrade, reconciliarGrade, totalDaGrade } from '@/lib/cadastro-grade';

const semLinhas: { cor: string; tamanho: string }[] = [];

describe('reconciliarGrade', () => {
  it('cor sem tamanho (ou tamanho sem cor) não gera nada — na grade toda linha tem os 2 eixos', () => {
    expect(reconciliarGrade(['Azul'], [], new Set(), semLinhas).novas).toEqual([]);
    expect(reconciliarGrade([], ['P'], new Set(), semLinhas).novas).toEqual([]);
  });

  it('cartesiano na ordem cor-externa, tamanho-interno', () => {
    expect(reconciliarGrade(['Azul', 'Preto'], ['P', 'M'], new Set(), semLinhas).novas).toEqual([
      { cor: 'Azul', tamanho: 'P' }, { cor: 'Azul', tamanho: 'M' },
      { cor: 'Preto', tamanho: 'P' }, { cor: 'Preto', tamanho: 'M' },
    ]);
  });

  it('marcar um tamanho a mais devolve SÓ as combinações novas', () => {
    const atuais = [{ cor: 'Azul', tamanho: 'P' }, { cor: 'Preto', tamanho: 'P' }];
    const r = reconciliarGrade(['Azul', 'Preto'], ['P', 'M'], new Set(), atuais);
    expect(r.novas).toEqual([{ cor: 'Azul', tamanho: 'M' }, { cor: 'Preto', tamanho: 'M' }]);
    expect(r.remover).toEqual([]);
  });

  it('desmarcar um eixo devolve só as chaves daquele eixo em remover', () => {
    const atuais = [
      { cor: 'Azul', tamanho: 'P' }, { cor: 'Azul', tamanho: 'M' },
      { cor: 'Preto', tamanho: 'P' }, { cor: 'Preto', tamanho: 'M' },
    ];
    const r = reconciliarGrade(['Azul'], ['P', 'M'], new Set(), atuais);
    expect(r.novas).toEqual([]);
    expect(r.remover).toEqual([chaveGrade('Preto', 'P'), chaveGrade('Preto', 'M')]);
  });

  it('combinação já existente marcada de novo não duplica', () => {
    const atuais = [{ cor: 'Azul', tamanho: 'P' }];
    const r = reconciliarGrade(['Azul'], ['P'], new Set(), atuais);
    expect(r.novas).toEqual([]);
    expect(r.remover).toEqual([]);
  });

  // Grade parcial: o operador removeu Azul/P na mão e os DOIS eixos continuam marcados.
  it('combinação removida na mão NÃO reaparece enquanto os dois eixos seguem marcados', () => {
    const removidas = new Set([chaveGrade('Azul', 'P')]);
    const atuais = [{ cor: 'Azul', tamanho: 'M' }];
    const r = reconciliarGrade(['Azul'], ['P', 'M'], removidas, atuais);
    expect(r.novas).toEqual([]);
    expect(r.removidas).toEqual(removidas);
  });

  // Desmarcar "Azul" já É a ação de "não quero Azul"; remarcar é "quero Azul por completo".
  it('desmarcar um eixo inteiro LIMPA a exclusão manual daquele eixo', () => {
    const removidas = new Set([chaveGrade('Azul', 'P')]);
    // Azul desmarcado: a exclusão some do conjunto devolvido.
    const semAzul = reconciliarGrade(['Preto'], ['P', 'M'], removidas, semLinhas);
    expect(semAzul.removidas.size).toBe(0);
    // Remarcado a partir do conjunto já podado: Azul/P volta.
    const comAzul = reconciliarGrade(['Azul', 'Preto'], ['P', 'M'], semAzul.removidas, semLinhas);
    expect(comAzul.novas).toContainEqual({ cor: 'Azul', tamanho: 'P' });
  });

  it('ordem canônica devolve o cartesiano menos as exclusões, agrupado por cor', () => {
    const removidas = new Set([chaveGrade('Azul', 'P')]);
    const r = reconciliarGrade(['Azul', 'Preto'], ['P', 'M'], removidas, semLinhas);
    expect(r.ordem).toEqual([
      chaveGrade('Azul', 'M'), chaveGrade('Preto', 'P'), chaveGrade('Preto', 'M'),
    ]);
  });
});

describe('totalDaGrade', () => {
  it('é o cartesiano menos as exclusões manuais ainda válidas', () => {
    expect(totalDaGrade(['Azul', 'Preto'], ['P', 'M'], new Set())).toBe(4);
    expect(totalDaGrade(['Azul', 'Preto'], ['P', 'M'], new Set([chaveGrade('Azul', 'P')]))).toBe(3);
  });

  it('exclusão de um eixo já desmarcado não conta (seria um desconto fantasma)', () => {
    expect(totalDaGrade(['Preto'], ['P', 'M'], new Set([chaveGrade('Azul', 'P')]))).toBe(2);
  });

  it('um eixo vazio zera o total — grade exige os dois', () => {
    expect(totalDaGrade(['Azul'], [], new Set())).toBe(0);
  });
});
