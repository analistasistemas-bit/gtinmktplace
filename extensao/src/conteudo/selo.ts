// Texto do selo ao lado do preço (ADR-0189 D-6/D-9). Usa o resultado Clássico.
import type { RespostaAnuncio } from '../../../supabase/functions/_shared/extensao/analisar-anuncio.ts';

const num = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = (n: number) => `R$ ${num(n)}`;

/** '' = sem selo. */
export function textoDoSelo(r: RespostaAnuncio): string {
  if (r.proprio) return 'Anúncio seu · abrir no PubliAI';
  const c = r.margem?.classico;
  if (c?.estado !== 'ok') return '';
  const { lucro, margemPct, recebe } = c.valor;
  if (lucro !== null && margemPct !== null) return `Minha margem ${brl(lucro)} (${num(margemPct)}%)`;
  return `Recebe ${brl(recebe)} · informe o custo`;
}

/** Mensagem do SW: a sessão mudou (logout, troca de conta, expiração) → o selo com a margem da sessão anterior sai. */
export function aoMensagemDoSw(msg: unknown, doc: Document = document): void {
  if ((msg as { tipo?: unknown } | null)?.tipo === 'publiai:sessao-mudou') doc.getElementById('publiai-selo')?.remove();
}
