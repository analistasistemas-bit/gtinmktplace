// I5 C1 — resumo do semáforo por item e comparação preview × execução (qualquer diferença → mudou).
import { centavos } from './alvo.ts';
import type { Avaliacao, CorAvaliada, Passo, PrecoAvaliado, Semaforo } from './tipos.ts';

const GRAVIDADE: Record<Semaforo, number> = { verde: 0, amarelo: 1, indisponivel: 2, vermelho: 3 };

export function resumir(cores: CorAvaliada[]): Avaliacao {
  let pior: Semaforo = 'verde';
  for (const c of cores) if (GRAVIDADE[c.semaforo] > GRAVIDADE[pior]) pior = c.semaforo;
  return {
    cores, pior,
    tem_vermelho: cores.some((c) => c.semaforo === 'vermelho'),
    tem_sem_dado: cores.some((c) => c.semaforo === 'indisponivel'),
  };
}

const CAMPOS = ['custo', 'piso', 'aliquota_pct', 'comissao_pct', 'comissao_fixa', 'frete'] as const;
const chave = (c: CorAvaliada) => String(c.variation_id ?? c.sku);
const igual = (a: number | null, b: number | null) => (a === null || b === null ? a === b : centavos(a) === centavos(b));

/** Casa os dois lados por chave. Chave repetida não dá para casar → conservador, força novo preview. */
function mudouPorChave<T>(antes: T[], agora: T[], chave: (x: T) => string, mudou: (a: T, b: T) => boolean): boolean {
  const mapa = new Map(agora.map((x) => [chave(x), x]));
  const chavesAntes = new Set(antes.map(chave));
  if (mapa.size !== agora.length || chavesAntes.size !== antes.length) return true;
  if (mapa.size !== chavesAntes.size) return true;
  return antes.some((a) => {
    const b = mapa.get(chave(a));
    return !b || mudou(a, b);
  });
}

export function mudouAvaliacao(antes: Avaliacao, agora: Avaliacao): boolean {
  return mudouPorChave(antes.cores, agora.cores, chave, (a, b) => a.origem !== b.origem || CAMPOS.some((k) => !igual(a[k], b[k])));
}

/** ADR-0196 — só o que será escrito: alvo do base, de cada faixa e de cada oferta; a saída não tem preço. A faixa usa o
 *  mesmo avaliador do base, então o resultado dela é o lucro por unidade. */
export async function avaliarPassos(passos: Passo[], avaliar: (preco: number) => Promise<Avaliacao>): Promise<PrecoAvaliado[]> {
  const alvos = passos.flatMap((p): Omit<PrecoAvaliado, 'avaliacao'>[] => {
    if (p.tipo === 'base') return [{ tipo: 'base', chave: 'base', preco: p.alvo }];
    if (p.tipo === 'oferta') return [{ tipo: 'oferta', chave: p.oferta.chave, preco: p.alvo }];
    if (p.tipo === 'faixas') return p.alvo.map((f) => ({ tipo: 'faixa', chave: String(f.min_unidades), preco: f.preco }));
    return [];
  });
  const precos: PrecoAvaliado[] = [];
  // ponytail: em série; cada avaliação lê o ML e o preview já roda itens em paralelo.
  for (const a of alvos) precos.push({ ...a, avaliacao: await avaliar(a.preco) });
  return precos;
}

/** Agregado que vai em `ItemPreview.avaliacao`: `reajuste_confirmar` exige as confirmações por ele. */
export function resumirPrecos(precos: PrecoAvaliado[]): Avaliacao {
  return resumir(precos.flatMap((p) => p.avaliacao.cores));
}

export function mudouPrecos(antes: PrecoAvaliado[], agora: PrecoAvaliado[]): boolean {
  return mudouPorChave(antes, agora, (p) => `${p.tipo}:${p.chave}`, (a, b) => mudouAvaliacao(a.avaliacao, b.avaliacao));
}
