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

// Remove o sufixo "(P)" (código interno da planilha) do fim do nome do produto —
// não deve aparecer no anúncio (MODEL/título/descrição). Só no final; "P/" no meio
// (ex.: "LINHA P/COSTURA") não é afetado.
export function limparNomeProduto(nome: string): string {
  return nome.replace(/\s*\(P\)\s*$/i, '');
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
      nome_pai: limparNomeProduto(pai.NOME),
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

type Codigos = string | number | Array<string | number>;

/**
 * Acha uma foto comum (prefixo CAPA_/CAPA2_/CAPA3_) entre os paths.
 * Aceita um único código OU vários candidatos (PAI + códigos das variações): o
 * operador costuma nomear a foto pelo código vendável (filho), não pelo PAI — sem
 * isso a foto comum some na Revisão (bug do lote #26 com produtos sem cor).
 */
function matchPrefixo(prefixo: string, codigos: Codigos, paths: string[]): string | undefined {
  const arr = Array.isArray(codigos) ? codigos : [codigos];
  const alvos = new Set(arr.map((c) => `${prefixo}${normalizarCodigo(c)}`));
  return paths.find((p) => {
    if (!EXT_VALIDAS.test(p)) return false;
    const filename = p.split('/').pop() ?? '';
    const base = filename.replace(EXT_VALIDAS, '');
    return alvos.has(base.toUpperCase());
  });
}

/** Acha a foto-capa (CAPA_00CODIGO.ext) entre os paths já no storage. */
export function matchCapa(codigos: Codigos, paths: string[]): string | undefined {
  return matchPrefixo('CAPA_', codigos, paths);
}

/** Acha a 2a foto comum (CAPA2_00CODIGO.ext) entre os paths já no storage. */
export function matchCapa2(codigos: Codigos, paths: string[]): string | undefined {
  return matchPrefixo('CAPA2_', codigos, paths);
}

/** Acha a 3a foto comum (CAPA3_00CODIGO.ext) entre os paths já no storage. */
export function matchCapa3(codigos: Codigos, paths: string[]): string | undefined {
  return matchPrefixo('CAPA3_', codigos, paths);
}
