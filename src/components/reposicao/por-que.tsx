// Frases geradas dos números (nunca IA): "Por quê" da família e rótulos de urgência.
import type { Urgencia } from '../../../supabase/functions/_shared/reposicao/calculo';
import type { StatusTone } from '@/components/ui/status-pill';
import type { FamiliaVisao } from '@/hooks/useReposicao';

export const ROTULO_URGENCIA: Record<Urgencia, string> = {
  ruptura: 'Ruptura', vai_faltar: 'Vai faltar', pedir_agora: 'Pedir agora', em_dia: 'Em dia',
};
export const TOM_URGENCIA: Record<Urgencia, StatusTone> = {
  ruptura: 'danger', vai_faltar: 'danger', pedir_agora: 'warning', em_dia: 'neutral',
};

/** YYYY-MM-DD → dd/mm. */
export const fmtDia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const dec = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
/** Sinal tipográfico (U+2212) no negativo, como `fmtBRLSinal`. */
export const pctSinal = (n: number) => {
  const r = Math.round(n * 100);
  return r > 0 ? `+${r}%` : r < 0 ? `−${-r}%` : '0%';
};

/** "Vende cerca de 1 a cada 4 dias." / "Vende cerca de 2,5 por dia." */
export function fraseVelocidade(v: number): string {
  if (v <= 0) return 'Sem venda prevista.';
  if (v >= 1) return `Vende cerca de ${dec(v)} por dia.`;
  const cada = Math.round(1 / v);
  return cada <= 1 ? 'Vende cerca de 1 por dia.' : `Vende cerca de 1 a cada ${cada} dias.`;
}

export function fraseDoPorQue(f: FamiliaVisao): string {
  const v = f.skus.reduce((a, s) => a + s.sug.v, 0);
  const partes = [`vende ${dec(v)}/dia`];
  if (f.tendencia) {
    const var_ = Math.round(Math.abs(f.tendencia.variacaoVendas) * 100);
    partes.push(`pedido ${pctSinal(f.tendencia.fator - 1)} (vendas ${f.tendencia.variacaoVendas >= 0 ? 'subiram' : 'caíram'} ${var_}% nas últimas 2 semanas)`);
  }
  const picos = [...new Set(f.skus.flatMap((s) => s.sug.picoLimitadoEm))].sort().map(fmtDia);
  if (picos.length === 1) partes.push(`pico de ${picos[0]} limitado`);
  else if (picos.length > 1) partes.push(`picos de ${picos.slice(0, -1).join(', ')} e ${picos.at(-1)} limitados`);
  const oferta = f.skus.reduce((a, s) => a + s.sug.vendasEmOferta, 0);
  if (oferta) partes.push(`${oferta} ${oferta === 1 ? 'venda' : 'vendas'} em oferta fora da tendência`);
  if (f.aCaminho) partes.push(`${f.aCaminho} a caminho${f.chegaEm ? `, chega ${fmtDia(f.chegaEm)}` : ''}`);
  return partes.join(' · ');
}

export function PorQue({ familia }: { familia: FamiliaVisao }) {
  return (
    <p className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Por quê: </span>{fraseDoPorQue(familia)}
    </p>
  );
}
