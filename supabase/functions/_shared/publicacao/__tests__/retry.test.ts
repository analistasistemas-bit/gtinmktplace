import { describe, expect, it } from 'vitest';
import { decidirErroCriarAnuncio, mensagemErroFotoRecuperavel } from '../retry.ts';
import type { ErroCanal } from '../../canais/contrato.ts';

function erro(over: Partial<ErroCanal>): ErroCanal {
  return {
    codigo: 'DESCONHECIDO',
    mensagemOperador: 'erro',
    retentavel: false,
    ...over,
  };
}

describe('decidirErroCriarAnuncio', () => {
  it('erro definitivo não retenta', () => {
    expect(decidirErroCriarAnuncio(erro({ retentavel: false, status: 400 }), 0)).toBe('definitivo');
  });

  it('5xx retentável usa retries do QStash enquanto houver tentativa', () => {
    expect(decidirErroCriarAnuncio(erro({ retentavel: true, status: 503 }), 0)).toBe('retentar');
    expect(decidirErroCriarAnuncio(erro({ retentavel: true, status: 503 }), 3)).toBe('definitivo');
  });

  it('erro retentável de foto usa retries limitados do QStash', () => {
    expect(decidirErroCriarAnuncio(erro({ codigo: 'FOTO', retentavel: true, status: 400 }), 0)).toBe('retentar');
    expect(decidirErroCriarAnuncio(erro({ codigo: 'FOTO', retentavel: true, status: 400 }), 3)).toBe('definitivo');
  });
});

describe('mensagemErroFotoRecuperavel', () => {
  it('orienta nova tentativa com reenvio de fotos', () => {
    expect(mensagemErroFotoRecuperavel('Problema nas fotos')).toMatch(/tente publicar novamente/i);
    expect(mensagemErroFotoRecuperavel('Problema nas fotos')).toMatch(/reenviadas/i);
  });
});
