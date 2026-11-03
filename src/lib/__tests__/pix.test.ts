// @vitest-environment node
// jsdom não tem canvas: no ambiente node a lib `qrcode` gera o PNG por pngjs (no browser, por canvas).
import { describe, expect, it } from 'vitest';
import { crc16, pixPayload, pixQrDataUrl } from '../pix';
import { vencimentoDaCompetencia } from '../platform-admin';

/** Lê o TLV de primeiro nível em { id: valor }. */
function campos(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < payload.length;) {
    const id = payload.slice(i, i + 2); const n = Number(payload.slice(i + 2, i + 4));
    out[id] = payload.slice(i + 4, i + 4 + n); i += 4 + n;
  }
  return out;
}

const base = { chave: '123e4567-e89b-12d3-a456-426614174000', valorCents: 105_000, nome: 'Fulano de Tal', cidade: 'Fortaleza' };

describe('crc16 (BR Code)', () => {
  it('bate com o vetor de verificação do catálogo', () => {
    // Fonte: Greg Cook, "Catalogue of parametrised CRC algorithms" (reveng), CRC-16/IBM-3740
    // (alias CRC-16/CCITT-FALSE: width 16, poly 0x1021, init 0xFFFF, refin/refout false, xorout 0),
    // check = 0x29B1 para "123456789". É o CRC exigido pelo campo 63 do BR Code (Manual BR Code, BACEN).
    expect(crc16('123456789')).toBe('29B1');
    expect(crc16('')).toBe('FFFF');
  });
});

describe('pixPayload', () => {
  it('monta o EMV estático com valor de 2 casas e CRC sobre o payload inteiro até "6304"', () => {
    const payload = pixPayload(base);
    const c = campos(payload);
    expect(c['00']).toBe('01');
    expect(c['26']).toBe('0014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-426614174000');
    expect(c['52']).toBe('0000');
    expect(c['53']).toBe('986');
    expect(c['54']).toBe('1050.00');
    expect(c['58']).toBe('BR');
    expect(c['59']).toBe('Fulano de Tal');
    expect(c['60']).toBe('Fortaleza');
    expect(c['62']).toBe('0503***');
    expect(payload.slice(-8, -4)).toBe('6304');
    expect(c['63']).toBe(crc16(payload.slice(0, -4)));
  });

  it('remove acentos, trunca nome (25) e cidade (15) e deriva o txid alfanumérico curto', () => {
    const c = campos(pixPayload({ ...base, valorCents: 1, nome: 'Ação Comércio Eletrônico Ltda ME', cidade: 'São José dos Campos', txid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }));
    expect(c['54']).toBe('0.01');
    expect(c['59']).toBe('Acao Comercio Eletronico');
    expect(c['59'].length).toBeLessThanOrEqual(25);
    expect(c['60']).toBe('Sao Jose dos Ca');
    expect(c['62']).toBe('0525a1b2c3d4e5f67890abcdef123');
  });

  it.each([0, -100, 10.5])('recusa valor %s (total ≤ 0 = sem instrução de pagamento)', (valorCents) => {
    expect(() => pixPayload({ ...base, valorCents })).toThrow();
  });

  it('recusa chave, nome ou cidade vazios', () => {
    expect(() => pixPayload({ ...base, chave: ' ' })).toThrow();
    expect(() => pixPayload({ ...base, nome: '' })).toThrow();
    expect(() => pixPayload({ ...base, cidade: '' })).toThrow();
  });
});

describe('pixQrDataUrl', () => {
  it('gera PNG em data URL', async () => {
    const url = await pixQrDataUrl(pixPayload(base));
    expect(url.startsWith('data:image/png;base64,iVBORw0KGgo')).toBe(true);
  });
});

describe('vencimentoDaCompetencia', () => {
  it('é o dia do vencimento no mês seguinte, virando o ano em dezembro', () => {
    expect(vencimentoDaCompetencia('2026-10', 5)).toBe('2026-11-05');
    expect(vencimentoDaCompetencia('2026-12', 28)).toBe('2027-01-28');
    expect(vencimentoDaCompetencia('2027-01', 1)).toBe('2027-02-01');
  });
  it('recusa competência ou dia inválidos', () => {
    expect(() => vencimentoDaCompetencia('2026-13', 5)).toThrow();
    expect(() => vencimentoDaCompetencia('2026-10', 29)).toThrow();
  });
});
