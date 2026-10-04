// I5 C1 — resumo do semáforo por item e comparação preview × execução (qualquer diferença → mudou).
import { centavos } from './alvo.ts';
import type { Avaliacao, CorAvaliada, Semaforo } from './tipos.ts';

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

export function mudouAvaliacao(antes: Avaliacao, agora: Avaliacao): boolean {
  const mapa = new Map(agora.cores.map((c) => [chave(c), c]));
  const chavesAntes = new Set(antes.cores.map(chave));
  // chave repetida = não dá para casar cor a cor → conservador, força novo preview
  if (mapa.size !== agora.cores.length || chavesAntes.size !== antes.cores.length) return true;
  if (mapa.size !== chavesAntes.size) return true;
  for (const a of antes.cores) {
    const b = mapa.get(chave(a));
    if (!b || a.origem !== b.origem) return true;
    if (CAMPOS.some((k) => !igual(a[k], b[k]))) return true;
  }
  return false;
}
