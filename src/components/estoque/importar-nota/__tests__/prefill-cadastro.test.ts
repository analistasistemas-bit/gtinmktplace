import { describe, it, expect } from 'vitest';
import { prefillCadastro } from '../prefill-cadastro';

const item = { nItem: 1, cProd: 'REF 06', xProd: 'Short masculino - DIV - DIV', ncm: '62034900', cfop: '5102',
  gtin: null, uCom: 'PC', qCom: 35, vProd: 350, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vFCPST: 0, orig: 0, rateio: {} };
const nota = { emitenteNome: 'FORNECEDOR TESTE LTDA' } as never;

describe('prefillCadastro', () => {
  it('limpa descrição, sugere origem sem pré-escolher, CSOSN vazio, sem estoque inicial', () => {
    const p = prefillCadastro(item, nota, 1);
    expect(p).toMatchObject({
      nomePai: 'Short masculino', descricaoFiscal: 'Short masculino', fornecedor: 'FORNECEDOR TESTE LTDA',
      custo: 10, origemSugerida: 'nacional', sugestaoDaNota: true, fiscal: { ncm: '62034900', origemNfe: 0, tributacaoIcms: '' },
    });
    expect(p).not.toHaveProperty('origem');
    expect(JSON.stringify(p)).not.toContain('estoqueInicial');
  });
  it('origem 1 (importação direta) vira 2 e sugere importado; ausente fica pendente', () => {
    expect(prefillCadastro({ ...item, orig: 1 }, nota, 1)).toMatchObject({ origemSugerida: 'importado', fiscal: { origemNfe: 2 } });
    const p = prefillCadastro({ ...item, orig: null }, nota, 1);
    expect(p.origemSugerida).toBeUndefined();
    expect(p.fiscal?.origemNfe).toBeUndefined();
  });
  it('custo com 2 casas e fator de conversão; custo não positivo é omitido', () => {
    expect(prefillCadastro({ ...item, vProd: 100, qCom: 3 }, nota, 1).custo).toBe(33.33);
    expect(prefillCadastro(item, nota, 12).custo).toBe(0.83);
    expect(prefillCadastro({ ...item, vProd: 0 }, nota, 1)).not.toHaveProperty('custo');
  });
  it('unidade vem do uCom só quando é unidade fiscal e o fator é 1', () => {
    expect(prefillCadastro(item, nota, 1).unidade).toBe('PC');
    expect(prefillCadastro({ ...item, uCom: ' pc ' }, nota, 1).unidade).toBe('PC');
    expect(prefillCadastro({ ...item, uCom: 'CX' }, nota, 12)).not.toHaveProperty('unidade');
    expect(prefillCadastro({ ...item, uCom: 'XPTO' }, nota, 1)).not.toHaveProperty('unidade');
    expect(prefillCadastro({ ...item, uCom: 'CX' }, nota, 1)).not.toHaveProperty('unidade');
    expect(prefillCadastro({ ...item, uCom: 'KG' }, nota, 1).unidade).toBe('KG');
  });
});
