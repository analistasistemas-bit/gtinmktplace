import { describe, it, expect } from 'vitest';
import { linhasDoChat, rotuloDia, nomeComprador } from '../mensagens-chat';

// `agora` sempre explícito: data fixa comparada com o relógio real reprova o CI num horário exato.
const AGORA = new Date(2026, 9, 28, 15, 0); // 28/10/2026 15:00 local
const em = (d: number, h: number, min = 0) => new Date(2026, 9, d, h, min).toISOString();
const msg = (id: string, direcao: 'recebida' | 'enviada', data_ml: string | null) => ({ id, direcao, data_ml });

describe('rotuloDia', () => {
  it('Hoje, Ontem e dd/mm/aaaa', () => {
    expect(rotuloDia(em(28, 9), AGORA)).toBe('Hoje');
    expect(rotuloDia(em(27, 23, 59), AGORA)).toBe('Ontem');
    expect(rotuloDia(em(18, 10), AGORA)).toBe('18/10/2026');
  });
});

describe('linhasDoChat', () => {
  it('separador a cada dia novo e cauda só na 1ª mensagem de cada sequência do mesmo lado', () => {
    const linhas = linhasDoChat([
      msg('a', 'recebida', em(18, 10)),
      msg('b', 'enviada', em(18, 15)),
      msg('c', 'enviada', em(18, 16)),
      msg('d', 'recebida', em(27, 9)),
      msg('e', 'recebida', em(27, 9, 5)),
    ], AGORA);
    expect(linhas.map((l) => (l.tipo === 'dia' ? `[${l.rotulo}]` : `${l.m.id}${l.cauda ? '*' : ''}`)))
      .toEqual(['[18/10/2026]', 'a*', 'b*', 'c', '[Ontem]', 'd*', 'e']);
  });

  it('separador reinicia a sequência: mesma direção depois de um dia novo ganha cauda', () => {
    const linhas = linhasDoChat([msg('a', 'enviada', em(26, 10)), msg('b', 'enviada', em(27, 10))], AGORA);
    expect(linhas.filter((l) => l.tipo === 'msg').map((l) => l.tipo === 'msg' && l.cauda)).toEqual([true, true]);
  });

  it('mensagem sem data entra sem separador', () => {
    const linhas = linhasDoChat([msg('a', 'recebida', null)], AGORA);
    expect(linhas).toEqual([{ tipo: 'msg', m: msg('a', 'recebida', null), cauda: true }]);
  });
});

describe('nomeComprador', () => {
  it('desfaz o nome repetido que o ML devolve (nome = sobrenome = razão social)', () => {
    expect(nomeComprador('43 037 949 SILVANA NUNES DOS S 43 037 949 SILVANA NUNES DOS S', null))
      .toBe('43 037 949 SILVANA NUNES DOS S');
  });
  it('nome normal, fallback para o apelido e para "Comprador"', () => {
    expect(nomeComprador('Maria Rosenilda', 'MARIA01')).toBe('Maria Rosenilda');
    expect(nomeComprador('  ', 'MARIA01')).toBe('MARIA01');
    expect(nomeComprador(null, null)).toBe('Comprador');
  });
});
