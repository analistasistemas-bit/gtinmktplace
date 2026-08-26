// ADR-0135 D-2/D-3 — checklist de ativação do módulo fiscal. Puro (vitest).
import { validarCnpj } from './validar.ts';

export interface EmpresaFiscalRow {
  cnpj: string | null; razao_social: string | null; nome_fantasia: string | null;
  inscricao_estadual: string | null; regime_tributario: string | null;
  cep: string | null; logradouro: string | null; numero: string | null;
  complemento: string | null; bairro: string | null; municipio: string | null;
  municipio_ibge: string | null; uf: string | null;
  natureza_operacao: string | null; cfop_dentro_uf: string | null;
  cfop_fora_uf_nao_contribuinte: string | null; cfop_fora_uf_contribuinte: string | null;
  cst_pis: string | null; cst_cofins: string | null; origin_type: string | null;
  emissao_a_partir_de: string | null;
}

// cfop_fora_uf_contribuinte, nome_fantasia e complemento são OPCIONAIS (spec §2.2).
const OBRIGATORIOS: Array<[keyof EmpresaFiscalRow, string]> = [
  ['cnpj', 'CNPJ'], ['razao_social', 'razão social'],
  ['inscricao_estadual', 'inscrição estadual'], ['regime_tributario', 'regime tributário'],
  ['cep', 'CEP'], ['logradouro', 'logradouro'], ['numero', 'número'], ['bairro', 'bairro'],
  ['municipio', 'município'], ['municipio_ibge', 'código IBGE do município'], ['uf', 'UF'],
  ['natureza_operacao', 'natureza da operação'], ['cfop_dentro_uf', 'CFOP dentro da UF'],
  ['cfop_fora_uf_nao_contribuinte', 'CFOP fora da UF (não contribuinte)'],
  ['cst_pis', 'CST de PIS'], ['cst_cofins', 'CST de COFINS'],
  ['origin_type', 'papel da empresa (origin_type)'],
  ['emissao_a_partir_de', 'data de início da emissão (emissao_a_partir_de)'],
];

export function pendenciasAtivacaoFiscal(
  org: { tipoPessoa: 'pf' | 'pj' },
  empresa: EmpresaFiscalRow | null,
  ufConfiguracoes: string | null,
): string[] {
  const p: string[] = [];
  if (org.tipoPessoa !== 'pj') {
    p.push('a organização precisa ser pessoa jurídica (pessoa física jamais emite — ADR-0135 D-2)');
  }
  if (!empresa) {
    p.push('cadastro da empresa não preenchido (card "Empresa" em Configurações)');
    return p;
  }
  for (const [campo, rotulo] of OBRIGATORIOS) {
    if (!String(empresa[campo] ?? '').trim()) p.push(`${rotulo} não preenchido`);
  }
  if (empresa.cnpj?.trim() && !validarCnpj(empresa.cnpj)) {
    p.push('CNPJ inválido (dígito verificador não confere)');
  }
  if (empresa.regime_tributario && empresa.regime_tributario !== 'simples') {
    p.push('a v1 cobre só Simples Nacional — Regime Normal fica para a v2 (ADR-0135 D-6)');
  }
  if (empresa.uf?.trim()) {
    if (!ufConfiguracoes?.trim()) {
      p.push('UF da empresa em Configurações (alíquota interna, ADR-0112) não preenchida');
    } else if (empresa.uf.trim() !== ufConfiguracoes.trim()) {
      p.push(
        `UF do endereço fiscal (${empresa.uf.trim()}) diverge da UF da empresa em ` +
        `Configurações (${ufConfiguracoes.trim()}) — corrija uma das duas (trava ADR-0112)`,
      );
    }
  }
  return p;
}
