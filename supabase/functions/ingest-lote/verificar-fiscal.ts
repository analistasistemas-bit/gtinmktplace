// ADR-0135 — NCM obrigatório na planilha SÓ para org com módulo fiscal (spec §5.2).
// Mesmo contrato do ADR-0107: aborta o lote ANTES de persistir qualquer coisa.
import { normalizarCodigo } from '../_shared/parser.ts';

export function normalizarNcm(bruto: unknown): string {
  return String(bruto ?? '').replace(/\D/g, '');
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
  }
  if (problemas.length) {
    throw new Error(
      `NCM ausente ou campo fiscal inválido em ${problemas.length} produto(s) PAI: ` +
      `${problemas.join(', ')}. Esta organização emite nota fiscal — corrija a planilha e ` +
      `reenvie; o dado fiscal não pode ser presumido (ADR-0135).`,
    );
  }
}
