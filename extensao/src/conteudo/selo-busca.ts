// Texto e tom do selo nos cards da busca (ADR-0189 D-11, Task 22). Só para card casado com SKU da org; sem vínculo não
// ganha selo (o painel oferece vincular). "Simulação Clássico": o card não diz o tipo do anúncio (consultor, 22/10).
import type { ResultadoCard } from '../../../supabase/functions/_shared/extensao/busca.ts';
import type { TomDoSelo } from './selo';

const pct = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export function seloDaBusca(r: ResultadoCard | undefined): { texto: string; tom: TomDoSelo; titulo: string } | null {
  if (!r || r.estado === 'sem_vinculo') return null;
  if (r.estado === 'limite') return { texto: 'Limite de análise', tom: 'neutro', titulo: 'Muitas análises em sequência: tente de novo pelo painel em um minuto.' };
  if (r.estado === 'sem_categoria') return { texto: 'Sem categoria', tom: 'neutro', titulo: 'Não foi possível identificar a categoria desta oferta.' };
  if (r.estado === 'indisponivel') return { texto: 'Margem indisponível', tom: 'neutro', titulo: r.motivo };
  if (r.estado !== 'ok') return null;
  const c = r.margem?.classico;
  if (!c || c.estado !== 'ok' || c.valor.margemPct === null) {
    return { texto: 'Margem indisponível', tom: 'neutro', titulo: c && c.estado === 'indisponivel' ? c.motivo : 'Informe o custo e a origem no painel.' };
  }
  const m = c.valor.margemPct;
  return {
    texto: `Simulação Clássico ${pct(m)}`,
    tom: m < 0 ? 'prejuizo' : 'lucro',
    titulo: `Seu SKU ${r.codigo}: margem simulada no Clássico ao preço deste card. Abra o painel para ver o Premium.`,
  };
}
