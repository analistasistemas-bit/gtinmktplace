import { describe, expect, it } from 'vitest';
import { inserirBusca, tempoRelativo, type BuscaRecente } from '../sonar-buscas-recentes';

const b = (termo: string, em = '2026-08-18T10:00:00.000Z'): BuscaRecente => ({ termo, em });

describe('inserirBusca', () => {
  it('insere no topo e preserva a ordem das demais', () => {
    const lista = inserirBusca([b('tecido oxford')], 'renda 70mm', '2026-08-18T11:00:00.000Z');
    expect(lista.map((x) => x.termo)).toEqual(['renda 70mm', 'tecido oxford']);
  });

  it('re-buscar um termo só o move para o topo (dedup por termo normalizado)', () => {
    const lista = inserirBusca(
      [b('renda 70mm'), b('Tecido  OXFORD')],
      'tecido oxford',
      '2026-08-18T11:00:00.000Z',
    );
    expect(lista.map((x) => x.termo)).toEqual(['tecido oxford', 'renda 70mm']);
  });

  it('corta em 10 e ignora termo com menos de 3 caracteres', () => {
    const dez = Array.from({ length: 10 }, (_, i) => b(`termo ${i}`));
    expect(inserirBusca(dez, 'termo novo', '2026-08-18T11:00:00.000Z')).toHaveLength(10);
    expect(inserirBusca(dez, 'ab', '2026-08-18T11:00:00.000Z')).toBe(dez);
  });
});

describe('tempoRelativo', () => {
  const agora = new Date('2026-08-18T12:00:00.000Z');
  it.each([
    ['2026-08-18T11:59:40.000Z', 'agora há pouco'],
    ['2026-08-18T11:37:00.000Z', 'há 23 minutos'],
    ['2026-08-18T11:59:00.000Z', 'há 1 minuto'],
    ['2026-08-17T19:00:00.000Z', 'há cerca de 17 horas'],
    ['2026-08-17T11:30:00.000Z', 'há 1 dia'], // 24,5h já sai de "horas" e vira 1 dia
    ['2026-08-16T11:00:00.000Z', 'há 2 dias'],
  ])('%s → %s', (iso, esperado) => {
    expect(tempoRelativo(iso, agora)).toBe(esperado);
  });
  it('data inválida ou futura → vazio', () => {
    expect(tempoRelativo('lixo', agora)).toBe('');
    expect(tempoRelativo('2026-08-19T00:00:00.000Z', agora)).toBe('');
  });
});
