// Buscas recentes do Sonar (pedido do Diego 18/08, referência Hunter Spy): histórico local por
// navegador (localStorage) — sem tabela, sem RLS, sem sync entre dispositivos de propósito.
// ponytail: se um dia precisar seguir o usuário entre máquinas, vira coluna em configuracoes.
// Clicar numa busca re-dispara o garimpo normal: termo dentro do cache (painel 24h / vendas 7d)
// volta em ~2s sem custo; fora dele paga como qualquer busca nova.

export interface BuscaRecente {
  termo: string;
  em: string; // ISO
}

const CHAVE = 'sonar:buscas-recentes';
const MAXIMO = 10;

const normalizar = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');

/** Pura: insere no topo, deduplicando pelo termo normalizado (re-busca só sobe a existente). */
export function inserirBusca(lista: BuscaRecente[], termo: string, em: string): BuscaRecente[] {
  const t = termo.trim();
  if (t.length < 3) return lista;
  const semRepetida = lista.filter((b) => normalizar(b.termo) !== normalizar(t));
  return [{ termo: t, em }, ...semRepetida].slice(0, MAXIMO);
}

/** Pura: "agora há pouco" / "há 23 minutos" / "há cerca de 17 horas" / "há 2 dias". */
export function tempoRelativo(iso: string, agora: Date): string {
  const ms = agora.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} minuto${min === 1 ? '' : 's'}`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `há cerca de ${horas} hora${horas === 1 ? '' : 's'}`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} dia${dias === 1 ? '' : 's'}`;
}

// --- Wrappers de localStorage (não testados; a lógica está nas puras acima) ---------------------

export function lerBuscasRecentes(): BuscaRecente[] {
  try {
    const raw = localStorage.getItem(CHAVE);
    const lista = raw ? JSON.parse(raw) : [];
    return Array.isArray(lista)
      ? lista.filter((b): b is BuscaRecente => typeof b?.termo === 'string' && typeof b?.em === 'string')
      : [];
  } catch {
    return [];
  }
}

export function registrarBusca(termo: string): BuscaRecente[] {
  const lista = inserirBusca(lerBuscasRecentes(), termo, new Date().toISOString());
  try { localStorage.setItem(CHAVE, JSON.stringify(lista)); } catch { /* storage cheio/bloqueado */ }
  return lista;
}

export function limparBuscasRecentes(): void {
  try { localStorage.removeItem(CHAVE); } catch { /* idem */ }
}
