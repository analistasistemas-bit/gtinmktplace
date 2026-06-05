import type { PlanilhaRow, FamiliaAgrupada, ResultadoAgrupamento } from './types.ts';
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

// ADR-0013: as três anomalias de dados são não-bloqueantes — a linha problemática
// é descartada e contabilizada no resumo do lote; a importação prossegue.
export function agruparPorPai(rows: PlanilhaRow[]): ResultadoAgrupamento {
  const codigos_duplicados: string[] = [];
  const filhos_orfaos: string[] = [];
  const familias_sem_filho: string[] = [];

  // 1. Dedup por CODIGO: a 1ª ocorrência prevalece.
  const vistos = new Set<string>();
  const unicas: PlanilhaRow[] = [];
  for (const r of rows) {
    const codigo = normalizarCodigo(r.CODIGO);
    if (vistos.has(codigo)) {
      codigos_duplicados.push(codigo);
      continue;
    }
    vistos.add(codigo);
    unicas.push(r);
  }

  const pais = new Map<string, PlanilhaRow>();
  const filhos = new Map<string, PlanilhaRow[]>();
  for (const r of unicas) {
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

  // 2. Filho órfão: PAI referenciado não existe no lote → descarta o filho.
  for (const lista of filhos.values()) {
    for (const f of lista) {
      const paiNorm = normalizarCodigo(String(f.PAI).trim());
      if (!pais.has(paiNorm)) {
        filhos_orfaos.push(normalizarCodigo(f.CODIGO));
      }
    }
  }

  const grupos: FamiliaAgrupada[] = [];
  for (const [codigo, pai] of pais.entries()) {
    const variacoes = filhos.get(codigo) ?? [];
    // 3. PAI sem nenhum filho → descarta a família.
    if (variacoes.length === 0) {
      familias_sem_filho.push(codigo);
      continue;
    }
    grupos.push({
      codigo_pai: codigo,
      nome_pai: pai.NOME,
      descricao_pai: pai.DESCRICAO_DETALHADO,
      unidade: pai.UNIDADE,
      fornecedor: pai.FORNECEDOR,
      variacoes,
    });
  }

  return { grupos, anomalias: { codigos_duplicados, filhos_orfaos, familias_sem_filho } };
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

/** Acha a 2a foto comum (CAPA2_00CODIGO.ext) do PAI entre os paths já no storage. */
export function matchCapa2(codigoPai: string | number, paths: string[]): string | undefined {
  const alvo = `CAPA2_${normalizarCodigo(codigoPai)}`;
  return paths.find((p) => {
    if (!EXT_VALIDAS.test(p)) return false;
    const filename = p.split('/').pop() ?? '';
    const base = filename.replace(EXT_VALIDAS, '');
    return base.toUpperCase() === alvo;
  });
}
