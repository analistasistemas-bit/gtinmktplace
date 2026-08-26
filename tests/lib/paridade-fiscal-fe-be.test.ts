import { describe, it, expect } from 'vitest';
import { camposFiscaisFaltantes } from '../../supabase/functions/_shared/fiscal/validar';
import { fiscalIncompleto, type CamposFiscaisResumo } from '@/lib/fiscal';

// A checagem de completude fiscal está duplicada entre BE (gate real de publicação/emissão,
// `camposFiscaisFaltantes` — lista de mensagens) e FE (filtro "Fiscal pendente" da tela Estoque,
// `fiscalIncompleto` — boolean) — ADR-0135. Divergir significa o filtro esconder um produto que
// o gate real ainda reprova (ou o contrário: marcar "pendente" um produto que já publica).
// Ruling do controller, fix round 1 (I1): o filtro anterior via só 4 campos null e deixava passar
// unidade inválida, origem×origem_nfe incoerente, fci faltante e regime divergente. Este teste
// falha assim que as duas cópias voltarem a divergir.

const BASE = {
  ncm: '39269090', cest: null as string | null, origemNfe: 0 as number | null,
  fci: null as string | null, tributacaoIcms: '102' as string | null,
  tributacaoIcmsRegime: 'simples' as string | null,
  unidade: 'UN' as string | null, origem: 'nacional' as 'nacional' | 'importado',
};

function paraBE(f: typeof BASE) {
  return {
    ncm: f.ncm, cest: f.cest, origem_nfe: f.origemNfe, fci: f.fci, ex_tipi: null,
    tributacao_icms: f.tributacaoIcms, tributacao_icms_regime: f.tributacaoIcmsRegime,
    unidade: f.unidade, origem: f.origem,
  };
}

const CASOS: Array<{ nome: string; over: Partial<typeof BASE> }> = [
  { nome: 'cadastro fiscal completo', over: {} },
  { nome: 'ncm ausente', over: { ncm: null } },
  { nome: 'ncm mal formatado (não 8 dígitos)', over: { ncm: '123' } },
  { nome: 'origem_nfe ausente', over: { origemNfe: null } },
  { nome: 'origem_nfe incoerente com origem (nacional × código estrangeiro)', over: { origemNfe: 1 } },
  { nome: 'fci faltando com origem_nfe 3 (exige FCI)', over: { origemNfe: 3 } },
  { nome: 'fci presente com origem_nfe 3 (completo)', over: { origemNfe: 3, fci: 'FCI123' } },
  { nome: 'tributacao_icms (csosn/cst) ausente', over: { tributacaoIcms: null } },
  { nome: 'regime tributário divergente do gravado', over: { tributacaoIcmsRegime: 'normal' } },
  { nome: 'unidade fora do vocabulário fiscal', over: { unidade: 'PACOTE' } },
  { nome: 'unidade ausente', over: { unidade: null } },
  { nome: 'cest mal formatado (não 7 dígitos)', over: { cest: '123' } },
];

describe('paridade fiscal FE×BE — fiscalIncompleto (front) × camposFiscaisFaltantes (edge)', () => {
  for (const { nome, over } of CASOS) {
    it(nome, () => {
      const caso = { ...BASE, ...over };
      const incompletoBE = camposFiscaisFaltantes(paraBE(caso), 'simples').length > 0;
      const incompletoFE = fiscalIncompleto(caso as CamposFiscaisResumo, 'simples');
      expect(incompletoFE).toBe(incompletoBE);
    });
  }
});
