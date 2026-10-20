// ADR-0135 — NCM obrigatório na planilha SÓ para org com módulo fiscal (spec §5.2).
// Mesmo contrato do ADR-0107: aborta o lote ANTES de persistir qualquer coisa.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { normalizarCodigo } from '../_shared/parser.ts';
import { CSOSN_VALIDOS } from '../_shared/fiscal/validar.ts';
import { mensagemNcm, ncmsInvalidos } from '../_shared/fiscal/ncm-oficial.ts';

export function normalizarNcm(bruto: unknown): string {
  return String(bruto ?? '').replace(/\D/g, '');
}

interface GrupoFiscal {
  ncm?: string | null;
  cest?: string | null;
  origem_nfe?: number | null;
  tributacao_icms?: string | null;
}

interface FamiliaFiscalAnterior {
  cest?: string | null;
  origem_nfe?: number | null;
  tributacao_icms?: string | null;
  tributacao_icms_regime?: string | null;
  descricao_fiscal?: string | null;
  fci?: string | null;
  ex_tipi?: string | null;
}

/**
 * Monta os campos fiscais do INSERT/UPDATE de `familias`. NCM não herda (obrigatório na
 * planilha da org fiscal — `exigirFiscalExplicito` já garante). Os opcionais (CEST,
 * ORIGEM_NFE, CSOSN/tributacao_icms) HERDAM do registro anterior quando a célula da
 * planilha vem vazia — achado da revisão do task-5: sem isso, um re-ingest com a coluna
 * opcional em branco apagava em silêncio dado curado antes (dialog ou planilha anterior).
 * Célula preenchida e válida sempre vence o anterior. Regime herda JUNTO com o valor de
 * `tributacao_icms`, nunca separado (senão um CSOSN antigo herdaria sob 'simples'
 * hardcoded mesmo que o cadastro anterior fosse 'normal'/CST).
 */
export function resolverCamposFiscais(g: GrupoFiscal, ant: FamiliaFiscalAnterior | undefined) {
  const cestPlanilha = g.cest ? g.cest.replace(/\D/g, '') : '';
  const origemFinal = g.origem_nfe ?? ant?.origem_nfe ?? null;
  return {
    // `|| null` em vez do `''` cru: célula só com espaço passa a validação (trim vazio =
    // "ausente") mas chegaria aqui truthy e violaria o CHECK de formato da coluna.
    ncm: normalizarNcm(g.ncm) || null,
    cest: cestPlanilha || ant?.cest || null,
    origem_nfe: origemFinal,
    tributacao_icms: g.tributacao_icms ?? ant?.tributacao_icms ?? null,
    tributacao_icms_regime: g.tributacao_icms ? 'simples' : ant?.tributacao_icms_regime ?? null,
    // ADR-0181 D-5: a planilha não tem coluna de descrição fiscal — sempre herda no UPDATE.
    descricao_fiscal: ant?.descricao_fiscal ?? null,
    // M1 (auditoria fiscal 19/10): a planilha não tem FCI/EX TIPI — herdam, senão o reingest apagava
    // dado curado. FCI só vale com origem 3/5/8 (A4): origem final outra não herda.
    fci: origemFinal != null && [3, 5, 8].includes(origemFinal) ? ant?.fci ?? null : null,
    ex_tipi: ant?.ex_tipi ?? null,
  };
}


export function exigirFiscalExplicito(rowsRaw: Record<string, unknown>[]): void {
  const problemas: string[] = [];
  const vistos = new Set<string>();
  for (const r of rowsRaw) {
    const paiCampo = String(r.PAI ?? '').trim();
    if (paiCampo !== '0' && paiCampo !== '') continue;
    const cod = normalizarCodigo(String(r.CODIGO ?? ''));
    if (vistos.has(cod)) continue;
    vistos.add(cod);
    const ncm = normalizarNcm(r.NCM);
    if (!/^\d{8}$/.test(ncm)) {
      const cru = String(r.NCM ?? '').trim();
      problemas.push(`${cod} (NCM = ${cru === '' ? 'vazio' : `"${cru}"`})`);
    }
    // Colunas opcionais: presença com valor inválido também aborta —
    // parâmetro fiscal nunca degrada em silêncio.
    const origemNfe = String(r.ORIGEM_NFE ?? '').trim();
    if (origemNfe !== '' && !/^[0-8]$/.test(origemNfe)) {
      problemas.push(`${cod} (ORIGEM_NFE = "${origemNfe}" — use um código de 0 a 8)`);
    }
    const cest = String(r.CEST ?? '').replace(/\D/g, '');
    if (String(r.CEST ?? '').trim() !== '' && !/^\d{7}$/.test(cest)) {
      problemas.push(`${cod} (CEST = "${String(r.CEST).trim()}" — 7 dígitos)`);
    }
    const csosn = String(r.CSOSN ?? '').trim();
    if (csosn !== '' && !(CSOSN_VALIDOS as readonly string[]).includes(csosn)) {
      problemas.push(`${cod} (CSOSN = "${csosn}" — use um dos códigos: ${CSOSN_VALIDOS.join(', ')})`);
    }
  }
  if (problemas.length) {
    throw new Error(
      `NCM ausente ou campo fiscal inválido em ${problemas.length} produto(s) PAI: ` +
      `${problemas.join(', ')}. Esta organização emite nota fiscal — corrija a planilha e ` +
      `reenvie; o dado fiscal não pode ser presumido (ADR-0135).`,
    );
  }
}

/**
 * ADR-0187 — NCM do PAI precisa existir e estar vigente na tabela oficial. Roda DEPOIS de
 * `exigirFiscalExplicito` (formato). Erro de leitura da tabela LANÇA: nunca vira "válido".
 */
export async function exigirNcmVigente(
  admin: SupabaseClient, rowsRaw: Record<string, unknown>[],
): Promise<void> {
  const codPorNcm = new Map<string, string[]>();
  const vistos = new Set<string>();
  for (const r of rowsRaw) {
    const paiCampo = String(r.PAI ?? '').trim();
    if (paiCampo !== '0' && paiCampo !== '') continue;
    const cod = normalizarCodigo(String(r.CODIGO ?? ''));
    if (vistos.has(cod)) continue;
    vistos.add(cod);
    const ncm = normalizarNcm(r.NCM);
    if (!/^\d{8}$/.test(ncm)) continue; // formato já reportado por exigirFiscalExplicito
    codPorNcm.set(ncm, [...(codPorNcm.get(ncm) ?? []), cod]);
  }
  const invalidos = await ncmsInvalidos(admin, [...codPorNcm.keys()]);
  if (invalidos.length === 0) return;
  const problemas = invalidos.flatMap((i) =>
    (codPorNcm.get(i.codigo) ?? []).map((cod) => `${cod} (${mensagemNcm(i)})`));
  throw new Error(
    `NCM fora da tabela oficial em ${problemas.length} produto(s) PAI: ${problemas.join(', ')}. ` +
    'Corrija a planilha e reenvie (ADR-0187).',
  );
}
