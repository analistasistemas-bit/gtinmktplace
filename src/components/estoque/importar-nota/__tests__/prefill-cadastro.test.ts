import { describe, it, expect } from 'vitest';
import { prefillCadastro } from '../prefill-cadastro';

const itemBase = { nItem: 1, cProd: 'REF 06', xProd: 'Short masculino - DIV - DIV', ncm: '62034900', cfop: '5102',
  gtin: null, uCom: 'PC', qCom: 35, vProd: 350, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vFCPST: 0, orig: 0, icmsGrupo: null, csosn: null, cstIcms: null, cest: null, nFci: null, rateio: {} };
const item = (patch: Record<string, unknown> = {}) => ({ ...itemBase, ...patch }) as never;
const nota = (patch: Record<string, unknown> = {}) => ({ emitenteNome: 'FORNECEDOR TESTE LTDA', chave: '2'.repeat(44), emitenteUf: null, ...patch }) as never;
const ctx = { csosnPadrao: '102', ufEmpresa: 'PE' };

describe('prefillCadastro', () => {
  it('limpa descrição, sugere origem sem pré-escolher, CSOSN vazio, sem estoque inicial', () => {
    const p = prefillCadastro(item(), nota(), 1, ctx);
    expect(p).toMatchObject({
      nomePai: 'Short masculino', descricaoFiscal: 'Short masculino', fornecedor: 'FORNECEDOR TESTE LTDA',
      custo: 10, origemSugerida: 'nacional', sugestaoDaNota: true, fiscal: { ncm: '62034900', origemNfe: 0, tributacaoIcms: '' },
    });
    expect(p).not.toHaveProperty('origem');
    expect(JSON.stringify(p)).not.toContain('estoqueInicial');
  });
  it('origem 1 (importação direta) vira 2 e sugere importado; ausente fica pendente', () => {
    expect(prefillCadastro(item({ orig: 1 }), nota(), 1, ctx)).toMatchObject({ origemSugerida: 'importado', fiscal: { origemNfe: 2 } });
    const p = prefillCadastro(item({ orig: null }), nota(), 1, ctx);
    expect(p.origemSugerida).toBeUndefined();
    expect(p.fiscal?.origemNfe).toBeUndefined();
  });
  it('custo com 2 casas e fator de conversão; custo não positivo é omitido', () => {
    expect(prefillCadastro(item({ vProd: 100, qCom: 3 }), nota(), 1, ctx).custo).toBe(33.33);
    expect(prefillCadastro(item(), nota(), 12, ctx).custo).toBe(0.83);
    expect(prefillCadastro(item({ vProd: 0 }), nota(), 1, ctx)).not.toHaveProperty('custo');
  });
  it('unidade vem do uCom só quando é unidade fiscal e o fator é 1', () => {
    expect(prefillCadastro(item(), nota(), 1, ctx).unidade).toBe('PC');
    expect(prefillCadastro(item({ uCom: ' pc ' }), nota(), 1, ctx).unidade).toBe('PC');
    expect(prefillCadastro(item({ uCom: 'CX' }), nota(), 12, ctx)).not.toHaveProperty('unidade');
    expect(prefillCadastro(item({ uCom: 'XPTO' }), nota(), 1, ctx)).not.toHaveProperty('unidade');
    expect(prefillCadastro(item({ uCom: 'CX' }), nota(), 1, ctx)).not.toHaveProperty('unidade');
    expect(prefillCadastro(item({ uCom: 'KG' }), nota(), 1, ctx).unidade).toBe('KG');
  });
  it('preenche refNota com chave e nItem', () => {
    expect(prefillCadastro(item({ nItem: 7 }), nota(), 1, ctx).refNota).toBe(`nfe:${'2'.repeat(44)}:7`);
  });
  it('leva Q (quantidade convertida) e o fator; fator inválido não leva nenhum dos dois', () => {
    expect(prefillCadastro(item(), nota(), 1, ctx)).toMatchObject({ quantidadeNota: 35, fatorNota: 1 });
    expect(prefillCadastro(item({ uCom: 'CX', qCom: 2 }), nota(), 12, ctx)).toMatchObject({ quantidadeNota: 24, fatorNota: 12 });
    const frac = prefillCadastro(item({ qCom: 2.5 }), nota(), 1, ctx);
    expect(frac.fatorNota).toBe(1);
    expect(frac).not.toHaveProperty('quantidadeNota');
    const ruim = prefillCadastro(item(), nota(), 1.5, ctx);
    expect(ruim).not.toHaveProperty('fatorNota');
    expect(ruim).not.toHaveProperty('quantidadeNota');
  });
  it('ST → 500 e CEST da nota', () => {
    const r = prefillCadastro(item({ icmsGrupo: 'ICMS60', cstIcms: '60', cest: '2805900' }), nota({ emitenteUf: 'PE' }), 1, ctx);
    expect(r.fiscal).toMatchObject({ tributacaoIcms: '500', cest: '2805900' });
    expect(r.avisosNota).toEqual({ classe: 'st', codigoFornecedor: '60', interestadual: false, semPadrao: false });
  });
  it('sem ST → padrão', () => expect(prefillCadastro(item({ icmsGrupo: 'ICMSSN102', csosn: '102' }), nota(), 1, ctx).fiscal?.tributacaoIcms).toBe('102'));
  it('exceção → vazio', () => expect(prefillCadastro(item({ icmsGrupo: 'ICMSSN400', csosn: '400' }), nota(), 1, ctx).fiscal?.tributacaoIcms).toBe(''));
  it('sem padrão → vazio + semPadrao', () => {
    const r = prefillCadastro(item({ icmsGrupo: 'ICMSSN102', csosn: '102' }), nota(), 1, { ...ctx, csosnPadrao: null });
    expect(r.fiscal?.tributacaoIcms).toBe('');
    expect(r.avisosNota?.semPadrao).toBe(true);
  });
  it('interestadual', () => expect(prefillCadastro(item({}), nota({ emitenteUf: 'SP' }), 1, ctx).avisosNota?.interestadual).toBe(true));
  it('UF desconhecida não é interestadual', () => {
    expect(prefillCadastro(item({}), nota({ emitenteUf: null }), 1, ctx).avisosNota?.interestadual).toBe(false);
    expect(prefillCadastro(item({}), nota({ emitenteUf: 'SP' }), 1, { ...ctx, ufEmpresa: null }).avisosNota?.interestadual).toBe(false);
  });
  it('orig 0 pré-seleciona nacional', () => {
    const r = prefillCadastro(item({ orig: 0 }), nota(), 1, ctx);
    expect(r.fiscal?.origemNfe).toBe(0);
    expect(r.origemSugerida).toBe('nacional');
  });
  it('FCI só com origem 3/5/8', () => {
    const fci = 'B01F70AF-10BF-4B1F-848C-65FF57F616FE';
    expect(prefillCadastro(item({ orig: 5, nFci: fci }), nota(), 1, ctx).fiscal?.fci).toBe(fci);
    expect(prefillCadastro(item({ orig: 0, nFci: fci }), nota(), 1, ctx).fiscal?.fci).toBeUndefined();
  });
});
