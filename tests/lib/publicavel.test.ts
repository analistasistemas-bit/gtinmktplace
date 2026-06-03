import { describe, it, expect } from 'vitest';
import { familiaPublicavel } from '../../src/lib/publicavel';
import type { Familia, Variacao } from '../../src/lib/tipos-dominio';

function cor(over: Partial<Variacao>): Variacao {
  return {
    codigo: '00000101', cor: 'Azul', corHex: '#00f', corOrigem: 'descricao',
    corEditadaPeloOperador: false, preco: 10, precoPublicacao: 9, estoque: 5,
    gtin: null, fotoPath: 'u/l/101.jpeg', excluidaDaPublicacao: false,
    ...over,
  };
}
function fam(over: Partial<Familia>): Familia {
  return {
    id: 'f1', loteId: 'l1', codigoPai: '00000100', titulo: 'LINHA', descricao: 'd',
    operacao: 'CREATE', estrategiaPreco: 'PROPRIO', estrategiaMotivo: '',
    concorrencia: 'sem', concorrenciaVendedores: 0, concorrenciaPrecoMin: null,
    analiseMercado: null, tipoAviamento: 'linha', categoriaMlId: 'MLB270273',
    precoMin: 9, precoMax: 9, precoAbaixo20pc: false, capaStoragePath: null,
    variacoes: [cor({})], status: 'pronto', tokensInput: null, tokensOutput: null,
    custoCentavos: null, tituloEditadoPeloOperador: false,
    descricaoEditadaPeloOperador: false, variacoesSemCor: 0,
    ...over,
  };
}

describe('familiaPublicavel', () => {
  it('família completa é publicável', () => {
    expect(familiaPublicavel(fam({})).ok).toBe(true);
  });
  it('status diferente de pronto bloqueia', () => {
    const r = familiaPublicavel(fam({ status: 'processando' }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/pronta|processament/i);
  });
  it('operação UPDATE não é CREATE-publicável', () => {
    expect(familiaPublicavel(fam({ operacao: 'UPDATE' })).ok).toBe(false);
  });
  it('sem categoria bloqueia', () => {
    const r = familiaPublicavel(fam({ categoriaMlId: null, tipoAviamento: 'outro' }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/categoria/i);
  });
  it('cor incluída sem foto bloqueia, mencionando a cor', () => {
    const r = familiaPublicavel(fam({ variacoes: [cor({ cor: 'Verde', fotoPath: undefined })] }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/Verde.*foto|foto.*Verde/i);
  });
  it('cor incluída sem nome de cor bloqueia', () => {
    const r = familiaPublicavel(fam({ variacoes: [cor({ cor: '' })] }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/cor/i);
  });
  it('cor sem preço de publicação bloqueia', () => {
    const r = familiaPublicavel(fam({ variacoes: [cor({ precoPublicacao: null })] }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/pre[çc]o/i);
  });
  it('cor problemática EXCLUÍDA não bloqueia se sobra ≥1 cor boa', () => {
    const r = familiaPublicavel(fam({
      variacoes: [cor({}), cor({ codigo: '00000102', cor: 'Verde', fotoPath: undefined, excluidaDaPublicacao: true })],
    }));
    expect(r.ok).toBe(true);
  });
  it('todas as cores excluídas bloqueia (≥1 obrigatória)', () => {
    const r = familiaPublicavel(fam({ variacoes: [cor({ excluidaDaPublicacao: true })] }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/nenhuma cor|ao menos|pelo menos/i);
  });
});
