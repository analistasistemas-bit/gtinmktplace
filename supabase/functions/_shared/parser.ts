import type { PlanilhaRow, FamiliaAgrupada } from './types.ts';
import { COLUNAS_OBRIGATORIAS } from './types.ts';

export function validarColunas(cols: string[]): void {
  const set = new Set(cols.map((c) => c.toUpperCase().trim()));
  const faltando = COLUNAS_OBRIGATORIAS.filter((c) => !set.has(c));
  if (faltando.length) {
    throw new Error(`Colunas obrigatórias ausentes: ${faltando.join(', ')}`);
  }
}

export function normalizarCodigo(codigo: string | number): string {
  const s = String(codigo).trim();
  return s.padStart(8, '0');
}

export function agruparPorPai(rows: PlanilhaRow[]): FamiliaAgrupada[] {
  const pais = new Map<string, PlanilhaRow>();
  const filhos = new Map<string, PlanilhaRow[]>();

  for (const r of rows) {
    const codigo = normalizarCodigo(r.CODIGO);
    const paiCampo = String(r.PAI).trim();
    if (paiCampo === '0' || paiCampo === '') {
      pais.set(codigo, r);
    } else {
      const pai = normalizarCodigo(paiCampo);
      const lista = filhos.get(pai) ?? [];
      lista.push(r);
      filhos.set(pai, lista);
    }
  }

  for (const [codigoFilho, lista] of filhos.entries()) {
    for (const f of lista) {
      const paiNorm = normalizarCodigo(String(f.PAI).trim());
      if (!pais.has(paiNorm)) {
        throw new Error(`Linha órfã: filho ${normalizarCodigo(f.CODIGO)} aponta pra PAI ${paiNorm} que não existe na planilha`);
      }
    }
    void codigoFilho;
  }

  const grupos: FamiliaAgrupada[] = [];
  for (const [codigo, pai] of pais.entries()) {
    const variacoes = filhos.get(codigo) ?? [];
    if (variacoes.length === 0) {
      throw new Error(`PAI ${codigo} (${pai.NOME}) sem variações — anúncio só-pai não é vendável`);
    }
    grupos.push({
      codigo_pai: codigo,
      nome_pai: pai.NOME,
      descricao_pai: pai.DESCRICAO_DETALHADO,
      unidade: pai.UNIDADE,
      variacoes,
    });
  }
  return grupos;
}

const EXT_VALIDAS = /\.(jpe?g|png)$/i;

export function matchImagem(codigo: string | number, paths: string[]): string | undefined {
  const alvo = normalizarCodigo(codigo);
  return paths.find((p) => {
    if (!EXT_VALIDAS.test(p)) return false;
    const filename = p.split('/').pop() ?? '';
    const base = filename.replace(EXT_VALIDAS, '');
    return base === alvo;
  });
}

/** Acha a foto-capa (CAPA_00CODIGO.ext) do PAI entre os paths já no storage. */
export function matchCapa(codigoPai: string | number, paths: string[]): string | undefined {
  const alvo = `CAPA_${normalizarCodigo(codigoPai)}`;
  return paths.find((p) => {
    if (!EXT_VALIDAS.test(p)) return false;
    const filename = p.split('/').pop() ?? '';
    const base = filename.replace(EXT_VALIDAS, '');
    return base.toUpperCase() === alvo;
  });
}
