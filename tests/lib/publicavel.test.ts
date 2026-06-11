import { describe, it, expect } from 'vitest';
import { familiaPublicavel, criticasVariacao, familiaIncompleta, idsPublicaveis } from '../../src/lib/publicavel';
import type { Familia, Variacao } from '../../src/lib/tipos-dominio';

function cor(over: Partial<Variacao>): Variacao {
  return {
    codigo: '00000101', cor: 'Azul', corHex: '#00f', corOrigem: 'descricao',
    corEditadaPeloOperador: false, preco: 10, precoPublicacao: 9, estoque: 5,
    gtin: null, fotoPath: 'u/l/101.jpeg', excluidaDaPublicacao: false,
    mlVariationId: null, estoqueAnterior: null,
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
    mlPermalink: null, mlItemId: null, erroMensagem: null, mudancaEstrutural: null,
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
  it('status erro é publicável (permite re-tentar após falha)', () => {
    expect(familiaPublicavel(fam({ status: 'erro' })).ok).toBe(true);
  });
  it('UPDATE com ml_item_id e ≥1 cor casada é publicável', () => {
    const r = familiaPublicavel(fam({
      operacao: 'UPDATE', mlItemId: 'MLB123',
      variacoes: [cor({ mlVariationId: 'V1' })],
    }));
    expect(r.ok).toBe(true);
  });
  it('UPDATE sem ml_item_id bloqueia', () => {
    const r = familiaPublicavel(fam({
      operacao: 'UPDATE', mlItemId: null,
      variacoes: [cor({ mlVariationId: 'V1' })],
    }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/anúncio|item|publicad/i);
  });
  it('UPDATE publica cor nova válida (com cor e foto)', () => {
    const r = familiaPublicavel(fam({
      operacao: 'UPDATE', mlItemId: 'MLB123',
      variacoes: [cor({ codigo: '00000777', cor: 'Vermelho', mlVariationId: null, fotoPath: 'u/l/777.jpeg' })],
    }));
    expect(r.ok).toBe(true);
  });
  it('UPDATE bloqueia cor nova incluída sem foto', () => {
    const r = familiaPublicavel(fam({
      operacao: 'UPDATE', mlItemId: 'MLB123',
      variacoes: [cor({ codigo: '00000777', cor: 'Vermelho', mlVariationId: null, fotoPath: undefined })],
    }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/foto/i);
  });
  it('UPDATE bloqueia cor nova incluída sem cor definida', () => {
    const r = familiaPublicavel(fam({
      operacao: 'UPDATE', mlItemId: 'MLB123',
      variacoes: [cor({ codigo: '00000777', cor: '', mlVariationId: null, fotoPath: 'u/l/777.jpeg' })],
    }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/cor/i);
  });
  it('UPDATE publicável misto: 1 cor casada (reposição) + 1 cor nova válida', () => {
    const r = familiaPublicavel(fam({
      operacao: 'UPDATE', mlItemId: 'MLB123',
      variacoes: [
        cor({ codigo: '00000101', mlVariationId: 'V1' }),
        cor({ codigo: '00000777', cor: 'Vermelho', mlVariationId: null, fotoPath: 'u/l/777.jpeg' }),
      ],
    }));
    expect(r.ok).toBe(true);
  });
  it('UPDATE não exige categoria/foto/preço (já vêm do anúncio)', () => {
    const r = familiaPublicavel(fam({
      operacao: 'UPDATE', mlItemId: 'MLB123', categoriaMlId: null,
      variacoes: [cor({ mlVariationId: 'V1', fotoPath: undefined, precoPublicacao: null })],
    }));
    expect(r.ok).toBe(true);
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

describe('familiaIncompleta', () => {
  it('família publicada NÃO é incompleta (mesmo não sendo mais publicável)', () => {
    expect(familiaIncompleta(fam({ status: 'publicado', mlItemId: 'MLB123' }))).toBe(false);
  });
  it('família em publicação NÃO é incompleta', () => {
    expect(familiaIncompleta(fam({ status: 'publicando' }))).toBe(false);
  });
  it('família ainda em processamento conta como incompleta (não finalizada; espelha o selo da linha)', () => {
    expect(familiaIncompleta(fam({ status: 'processando' }))).toBe(true);
  });
  it('pronta com dado faltando (sem foto) É incompleta', () => {
    expect(familiaIncompleta(fam({ variacoes: [cor({ fotoPath: undefined })] }))).toBe(true);
  });
  it('pronta e completa NÃO é incompleta', () => {
    expect(familiaIncompleta(fam({}))).toBe(false);
  });
});

describe('criticasVariacao', () => {
  it('CREATE: variação completa não tem crítica', () => {
    expect(criticasVariacao(cor({}), 'CREATE')).toEqual([]);
  });
  it('CREATE: sem foto', () => {
    expect(criticasVariacao(cor({ fotoPath: undefined }), 'CREATE')).toEqual(['sem foto']);
  });
  it('CREATE: sem cor', () => {
    expect(criticasVariacao(cor({ cor: '' }), 'CREATE')).toEqual(['sem cor']);
  });
  it('CREATE: sem preço', () => {
    expect(criticasVariacao(cor({ precoPublicacao: null }), 'CREATE')).toEqual(['sem preço']);
  });
  it('CREATE: combina motivos na ordem cor → foto → preço', () => {
    expect(criticasVariacao(cor({ cor: '', fotoPath: undefined, precoPublicacao: 0 }), 'CREATE'))
      .toEqual(['sem cor', 'sem foto', 'sem preço']);
  });
  it('variação excluída não acusa crítica (não vai ao ML)', () => {
    expect(criticasVariacao(cor({ fotoPath: undefined, excluidaDaPublicacao: true }), 'CREATE')).toEqual([]);
  });
  it('UPDATE: cor casada (reposição) não exige foto → sem crítica', () => {
    expect(criticasVariacao(cor({ mlVariationId: 'V1', fotoPath: undefined }), 'UPDATE')).toEqual([]);
  });
  it('UPDATE: cor nova sem foto acusa crítica', () => {
    expect(criticasVariacao(cor({ mlVariationId: null, fotoPath: undefined }), 'UPDATE')).toEqual(['sem foto']);
  });
});

describe('idsPublicaveis (suporte ao "selecionar todos")', () => {
  it('retorna só os ids das famílias publicáveis (exclui incompleta e sem categoria)', () => {
    const ok1 = fam({ id: 'a' });
    const incompleta = fam({ id: 'b', variacoes: [cor({ cor: '' })] }); // sem cor
    const ok2 = fam({ id: 'c' });
    const semCategoria = fam({ id: 'd', categoriaMlId: null });
    expect(idsPublicaveis([ok1, incompleta, ok2, semCategoria])).toEqual(['a', 'c']);
  });
  it('lista vazia → []', () => {
    expect(idsPublicaveis([])).toEqual([]);
  });
  it('preserva a ordem de entrada', () => {
    expect(idsPublicaveis([fam({ id: 'x' }), fam({ id: 'y' })])).toEqual(['x', 'y']);
  });
});
