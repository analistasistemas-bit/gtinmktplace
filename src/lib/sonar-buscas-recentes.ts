export interface BuscaRecente {
  termo: string;
  em: string;
  resultado_id: string;
}

export interface EscopoSonar {
  orgId: string;
  actorId: string;
  supportRequestId: string | null;
}

const MAXIMO = 10;
const normalizar = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const chave = (scope: EscopoSonar) =>
  `sonar:buscas-recentes:${scope.orgId}:${scope.actorId}:${scope.supportRequestId ?? 'cliente'}`;

export function inserirBusca(lista: BuscaRecente[], termo: string, em: string, resultadoId: string): BuscaRecente[] {
  const value = termo.trim();
  if (value.length < 3 || !resultadoId) return lista;
  const semRepetida = lista.filter((busca) => busca.resultado_id !== resultadoId && normalizar(busca.termo) !== normalizar(value));
  return [{ termo: value, em, resultado_id: resultadoId }, ...semRepetida].slice(0, MAXIMO);
}

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

export function lerBuscasRecentes(scope: EscopoSonar | null): BuscaRecente[] {
  if (!scope) return [];
  try {
    const raw = localStorage.getItem(chave(scope));
    const lista = raw ? JSON.parse(raw) : [];
    return Array.isArray(lista) ? lista.filter((busca): busca is BuscaRecente =>
      typeof busca?.termo === 'string' && typeof busca?.em === 'string' && typeof busca?.resultado_id === 'string') : [];
  } catch { return []; }
}

export function registrarBusca(scope: EscopoSonar, termo: string, resultadoId: string): BuscaRecente[] {
  const lista = inserirBusca(lerBuscasRecentes(scope), termo, new Date().toISOString(), resultadoId);
  try { localStorage.setItem(chave(scope), JSON.stringify(lista)); } catch { /* armazenamento indisponível */ }
  return lista;
}

export function limparBuscasRecentes(scope: EscopoSonar | null): void {
  if (!scope) return;
  try { localStorage.removeItem(chave(scope)); } catch { /* armazenamento indisponível */ }
}
