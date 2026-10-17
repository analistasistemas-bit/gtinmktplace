// ADR-0181 Plano 2a/2b — pacote final: XMLs de venda (xmls/<caminho do ML>), de compra (compras/…) + relatórios.
import { zipSync } from 'fflate';
import type { LeituraPacote } from './tipos';
import type { LeituraCompras } from './tipos-compras';

export function montarPacote(p: {
  vendas: LeituraPacote; xlsxVendas: Uint8Array; pdfVendas: Uint8Array;
  compras: LeituraCompras; xlsxCompras: Uint8Array; pdfCompras: Uint8Array;
  inventario?: { xlsx: Uint8Array; pdf: Uint8Array };   // pacote de dezembro com foto de 31/12
}): Uint8Array {
  const arquivos: Record<string, Uint8Array> = {
    'relatorio-vendas.xlsx': p.xlsxVendas, 'relatorio-vendas.pdf': p.pdfVendas,
    'relatorio-compras.xlsx': p.xlsxCompras, 'relatorio-compras.pdf': p.pdfCompras,
  };
  if (p.inventario) {
    arquivos['inventario/relatorio-inventario.xlsx'] = p.inventario.xlsx;
    arquivos['inventario/relatorio-inventario.pdf'] = p.inventario.pdf;
  }
  for (const [nome, dados] of Object.entries(p.vendas.arquivos)) arquivos[`xmls/${nome}`] = dados;
  Object.assign(arquivos, p.compras.arquivos);   // já vêm com compras/xmls…/<chave>.xml
  return zipSync(arquivos, { level: 6 });
}

/** Cópia com o selo PARCIAL do pacote inteiro (vendas + compras) — os 4 relatórios mostram os mesmos motivos. */
export function comSeloGlobal<T extends { conferencia: { parcial: boolean; motivosParcial: string[] } }>(l: T, motivos: string[]): T {
  if (!motivos.length) return l;
  return { ...l, conferencia: { ...l.conferencia, parcial: true, motivosParcial: motivos } };
}

export const nomePacote = (mes: string) => `pacote-${mes}.zip`;

/** `inventario-AAAA-MM-DD`, data em America/Sao_Paulo (en-CA formata como ISO). */
export const nomeInventarioHoje = (agora: Date) =>
  `inventario-${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)}`;

export function salvarArquivo(nome: string, bytes: Uint8Array, tipo: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' });
function anoMesSP(d: Date): [number, number] {
  const p = FMT.formatToParts(d);
  return [Number(p.find((x) => x.type === 'year')!.value), Number(p.find((x) => x.type === 'month')!.value)];
}
const fmt = (a: number, m: number) => `${a}-${String(m).padStart(2, '0')}`;

export function mesesDisponiveis(agora: Date, n = 12): string[] {
  let [a, m] = anoMesSP(agora);
  const out: string[] = [];
  for (let i = 0; i < n; i++) { out.push(fmt(a, m)); m -= 1; if (m === 0) { m = 12; a -= 1; } }
  return out;
}
export const mesAnteriorSP = (agora: Date) => mesesDisponiveis(agora, 2)[1];
