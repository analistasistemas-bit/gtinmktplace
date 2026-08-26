// ADR-0135. Padrão ADR-0129: valida contra o snapshot de schema versionado, não lista à mão.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function colunasDe(tabela: string): string[] {
  const arquivo = readFileSync(resolve(process.cwd(), 'src/lib/database.types.ts'), 'utf8');
  const re = new RegExp(`\\n      ${tabela}: \\{\\n        Row: \\{\\n([\\s\\S]*?)\\n        \\}\\n`);
  const bloco = re.exec(arquivo);
  if (!bloco) throw new Error(`bloco Row de \`${tabela}\` não encontrado em database.types.ts`);
  const colunas = bloco[1].split('\n')
    .map((l) => /^\s{10}([a-z0-9_]+)\??:/.exec(l)?.[1])
    .filter((c): c is string => !!c);
  if (colunas.length === 0) throw new Error(`parse de ${tabela} devolveu 0 colunas`);
  return colunas;
}

describe('schema fiscal (ADR-0135)', () => {
  it('empresa_fiscal tem os campos do superconjunto mínimo', () => {
    const cols = colunasDe('empresa_fiscal');
    for (const c of ['cnpj', 'razao_social', 'inscricao_estadual', 'regime_tributario',
      'cep', 'logradouro', 'numero', 'bairro', 'municipio', 'municipio_ibge', 'uf',
      'natureza_operacao', 'cfop_dentro_uf', 'cfop_fora_uf_nao_contribuinte',
      'cfop_fora_uf_contribuinte', 'cst_pis', 'cst_cofins', 'origin_type',
      'emissao_a_partir_de']) {
      expect(cols, `coluna ${c}`).toContain(c);
    }
  });
  it('familias ganhou as colunas fiscais', () => {
    const cols = colunasDe('familias');
    for (const c of ['ncm', 'cest', 'origem_nfe', 'fci', 'ex_tipi', 'tributacao_icms',
      'tributacao_icms_regime', 'can_invoice', 'can_invoice_causa', 'fiscal_sincronizado_em']) {
      expect(cols, `coluna ${c}`).toContain(c);
    }
  });
  it('organizations ganhou tipo_pessoa', () => {
    expect(colunasDe('organizations')).toContain('tipo_pessoa');
  });
});
