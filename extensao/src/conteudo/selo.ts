// Texto do selo ao lado do preço (ADR-0189 D-6/D-9). Usa o resultado Clássico.
import type { RespostaAnuncio } from '../../../supabase/functions/_shared/extensao/analisar-anuncio.ts';
import { limparMiniaturas } from './miniaturas';

const num = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = (n: number) => `R$ ${num(n)}`;

/** Sempre há selo: sem margem calculável (falta custo/origem, comissão indisponível) ele convida a abrir o painel,
 *  onde a pendência aparece. */
export function textoDoSelo(r: RespostaAnuncio): string {
  if (r.proprio) return 'Anúncio seu · abrir no PubliAI';
  const c = r.margem?.classico;
  if (c?.estado !== 'ok') return 'Calcular minha margem';
  const { lucro, margemPct, recebe } = c.valor;
  if (lucro !== null && margemPct !== null) return `Minha margem ${brl(lucro)} (${num(margemPct)}%)`;
  return `Recebe ${brl(recebe)} · informe o custo`;
}

export type TomDoSelo = 'lucro' | 'prejuizo' | 'neutro' | 'proprio' | 'conectar';

/** Cor do selo: segue o lucro do Clássico (o mesmo número do texto). */
export function tomDoSelo(r: RespostaAnuncio): TomDoSelo {
  if (r.proprio) return 'proprio';
  const c = r.margem?.classico;
  if (c?.estado !== 'ok' || c.valor.lucro === null) return 'neutro';
  return c.valor.lucro < 0 ? 'prejuizo' : 'lucro';
}

let mudancasDeSessao = 0;

/** Mensagem do SW: a sessão mudou (logout, troca de conta, expiração) → o selo com a margem da sessão anterior e as
 *  marcas nas miniaturas saem. */
export function aoMensagemDoSw(msg: unknown, doc: Document = document): void {
  if ((msg as { tipo?: unknown } | null)?.tipo !== 'publiai:sessao-mudou') return;
  mudancasDeSessao++;
  doc.getElementById('publiai-selo')?.remove();
  limparMiniaturas(doc);
}

/** null se a sessão mudou enquanto `p` estava em voo: a resposta é da sessão anterior e não vira selo. */
export async function comSessaoEstavel<T>(p: Promise<T>): Promise<T | null> {
  const antes = mudancasDeSessao;
  const r = await p;
  return mudancasDeSessao === antes ? r : null;
}
