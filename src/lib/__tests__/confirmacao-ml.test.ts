import { describe, expect, it } from 'vitest';
import { intervaloConfirmacoes, resumirConfirmacoes, type ConfirmacaoMl } from '@/lib/confirmacao-ml';

const AGORA = new Date('2026-11-05T12:30:00.000Z');
const RECENTE = '2026-11-05T12:25:00.000Z';
const VELHO = '2026-11-05T12:05:00.000Z';

const linha = (familia: string, status: string, over: Partial<ConfirmacaoMl> = {}): ConfirmacaoMl => ({
  id: `${familia}-${status}`, familia_id: familia, codigo_pai: '000', item_externo_id: 'MLB1', status,
  divergentes: [], capados: 0, enviado_em: RECENTE, ...over,
});

describe('resumirConfirmacoes (ADR-0195)', () => {
  it('conta por família, pelo pior status entre os itens', () => {
    const r = resumirConfirmacoes([
      linha('a', 'confirmado'), linha('a', 'falhou'),
      linha('b', 'confirmado'), linha('b', 'confirmado', { id: 'b2' }),
      linha('c', 'confirmado'), linha('c', 'aguardando'),
      linha('d', 'aguardando'), linha('d', 'inconclusivo'),
    ], [], AGORA);
    expect(r).toMatchObject({ confirmadas: 1, aguardando: 1, inconclusivas: 1, semConferencia: 0 });
    expect(r.falhas.map((f) => f.familia_id)).toEqual(['a']);
  });

  it('aguardando há mais de 20 minutos conta como inconclusiva', () => {
    const r = resumirConfirmacoes([linha('a', 'aguardando', { enviado_em: VELHO })], [], AGORA);
    expect(r).toMatchObject({ aguardando: 0, inconclusivas: 1 });
  });

  it('família publicada sem linha só conta se o lote tem alguma linha', () => {
    expect(resumirConfirmacoes([linha('a', 'confirmado')], ['a', 'b'], AGORA).semConferencia).toBe(1);
    expect(resumirConfirmacoes([], ['a', 'b'], AGORA).semConferencia).toBe(0);
  });

  it('soma as cores limitadas pelo teto', () => {
    const r = resumirConfirmacoes([linha('a', 'confirmado', { capados: 2 }), linha('b', 'aguardando', { capados: 3 })], [], AGORA);
    expect(r.capados).toBe(5);
  });
});

describe('intervaloConfirmacoes (ADR-0195)', () => {
  it('relê a cada 5 s com aguardando dentro do teto', () => {
    expect(intervaloConfirmacoes([linha('a', 'aguardando')], false, AGORA)).toBe(5000);
  });

  it('para quando nada aguarda ou o teto passou', () => {
    expect(intervaloConfirmacoes([linha('a', 'confirmado')], false, AGORA)).toBe(false);
    expect(intervaloConfirmacoes([linha('a', 'aguardando', { enviado_em: VELHO })], false, AGORA)).toBe(false);
  });

  it('lote publicando relê mesmo sem linhas, senão a primeira nunca apareceria', () => {
    expect(intervaloConfirmacoes([], true, AGORA)).toBe(5000);
  });
});
