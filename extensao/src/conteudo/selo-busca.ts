// Linha "Minha margem" do Mini-bloco da busca (ADR-0189 D-11; emenda 2026-11-02). Só para card casado com SKU da org;
// sem vínculo não há linha (o painel oferece vincular). "Simulação Clássico": o card não diz o tipo do anúncio (consultor, 22/10).
import type { ResultadoCard } from '../../../supabase/functions/_shared/extensao/busca.ts';

export type TomDaMargem = 'lucro' | 'prejuizo' | 'neutro' | 'aguardando';

const pct = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** `rotulo` (identidade, roxo) e `valor` (tom lucro/prejuízo); sem valor, o rótulo leva o tom (aguardando = warning). */
export type LinhaDaMargem = { rotulo: string; valor: string | null; tom: TomDaMargem; titulo: string };

export function seloDaBusca(r: ResultadoCard | undefined): LinhaDaMargem | null {
  if (!r || r.estado === 'sem_vinculo') return null;
  if (r.estado === 'limite') return { rotulo: 'Minha margem · aguardando cota', valor: null, tom: 'aguardando', titulo: 'Cota de análises do minuto esgotada: a margem volta sozinha na janela seguinte.' };
  if (r.estado === 'sem_categoria') return { rotulo: 'Minha margem indisponível', valor: null, tom: 'neutro', titulo: 'Não foi possível identificar a categoria desta oferta.' };
  if (r.estado === 'indisponivel') return { rotulo: 'Minha margem indisponível', valor: null, tom: 'neutro', titulo: r.motivo };
  if (r.estado !== 'ok') return null;
  const c = r.margem?.classico;
  if (!c || c.estado !== 'ok' || c.valor.margemPct === null) {
    return { rotulo: 'Minha margem indisponível', valor: null, tom: 'neutro', titulo: c && c.estado === 'indisponivel' ? c.motivo : 'Informe o custo e a origem no painel.' };
  }
  const m = c.valor.margemPct;
  return {
    rotulo: 'Minha margem · Clássico',
    valor: pct(m),
    tom: m < 0 ? 'prejuizo' : 'lucro',
    titulo: `Seu SKU ${r.codigo}: margem simulada no Clássico ao preço deste card. Abra o painel para ver o Premium.`,
  };
}
