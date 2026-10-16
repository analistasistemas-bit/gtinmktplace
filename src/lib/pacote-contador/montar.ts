// ADR-0181 Plano 2a — pacote final: XMLs originais (xmls/<caminho do ML>) + relatórios.
import { zipSync } from 'fflate';
import type { LeituraPacote } from './tipos';

export function montarPacote(l: LeituraPacote, xlsx: Uint8Array, pdf: Uint8Array): Uint8Array {
  const arquivos: Record<string, Uint8Array> = { 'relatorio-vendas.xlsx': xlsx, 'relatorio-vendas.pdf': pdf };
  for (const [nome, dados] of Object.entries(l.arquivos)) arquivos[`xmls/${nome}`] = dados;
  return zipSync(arquivos, { level: 6 });
}

export const nomePacote = (mes: string) => `pacote-${mes}.zip`;

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
