// ADR-0200 (adendo 12/11): proposta de galeria por combinação, para a prévia da etapa 2. SÓ leitura. A mesma escolha de
// peça (`pecaDaCor`) e a mesma regra (`montarGaleriaKit`) da criação: o que a tela mostra é o que o servidor aceita.
import { pecaDaCor, type FotoPeca } from '../_shared/kit-variacao/galeria-pecas.ts';
import type { PecaOrigem } from '../_shared/kit-variacao/galeria-leitura.ts';

export interface CombinacaoPedida { rotulo: string; cores: string[] }
export interface FotoProposta extends FotoPeca { url: string | null; cor: string }
export interface Proposta { fotos: FotoProposta[]; avisos: string[]; indisponivel: boolean }

export interface DepsProposta {
  variacoes: Array<{ codigo: string; cor: string }>;
  vinculos: Array<{ sku: string; item_externo_id: string | null }>;
  categoriaId: string;
  lerLimite(categoriaId: string): Promise<number | null>;
  galeria(pecas: PecaOrigem[], limite: number): Promise<{ fotos: FotoPeca[]; avisos: string[]; indisponivel: boolean; urls: Record<string, string> }>;
}

const indisponivel = (aviso: string): Proposta => ({ fotos: [], avisos: [aviso], indisponivel: true });

export async function propostaDeGalerias(deps: DepsProposta, combinacoes: CombinacaoPedida[]): Promise<Record<string, Proposta>> {
  const limite = await deps.lerLimite(deps.categoriaId);
  const out: Record<string, Proposta> = {};
  for (const c of combinacoes) {
    if (limite === null) { out[c.rotulo] = indisponivel('Fotos das peças indisponíveis (limite de fotos da categoria não lido).'); continue; }
    const pecas = c.cores.map((cor) => ({ cor, itemId: pecaDaCor(deps.variacoes, deps.vinculos, cor) ?? '' }));
    const sem = pecas.find((p) => !p.itemId);
    if (sem) { out[c.rotulo] = indisponivel(`${sem.cor}: sem anúncio da peça no Mercado Livre; só a foto do kit.`); continue; }
    try {
      const r = await deps.galeria(pecas, limite);
      const corDoItem = new Map(pecas.map((p) => [p.itemId, p.cor]));
      out[c.rotulo] = {
        fotos: r.fotos.map((f) => ({ ...f, url: r.urls[f.id] ?? null, cor: corDoItem.get(f.item) ?? '' })),
        avisos: r.avisos, indisponivel: r.indisponivel,
      };
    } catch (e) {
      out[c.rotulo] = indisponivel(`Fotos das peças indisponíveis (${e instanceof Error ? e.message : String(e)}).`);
    }
  }
  return out;
}
