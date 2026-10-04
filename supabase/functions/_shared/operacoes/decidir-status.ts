// ADR-0174 emenda 2026-10-04 — decisão pura por item de pausar/reativar, a partir do status FRESCO do ML
// (o da tela Publicados tem cache de 5 min). Idempotente: item já no alvo nunca é escrito de novo.
import type { StatusAnuncioCanal } from '../canais/contrato.ts';
import type { AcaoStatus } from './tipos.ts';

export type DecisaoStatus =
  | { tipo: 'escrever'; alvo: 'ativo' | 'pausado' }
  | { tipo: 'fim'; status: 'ja_estava' | 'bloqueado' | 'erro'; mensagem: string | null };

export const MSG_BLOQUEADO_STATUS = 'Anúncio moderado ou encerrado no ML — não dá para pausar/reativar';
export const MSG_SEM_LEITURA = 'O ML não devolveu o anúncio';

export function decidirStatus(acao: AcaoStatus, atual: StatusAnuncioCanal | null, migracao: string | null): DecisaoStatus {
  if (migracao) return { tipo: 'fim', status: 'bloqueado', mensagem: migracao };
  if (atual === null || atual === 'indisponivel') return { tipo: 'fim', status: 'erro', mensagem: MSG_SEM_LEITURA };
  if (atual !== 'ativo' && atual !== 'pausado') return { tipo: 'fim', status: 'bloqueado', mensagem: MSG_BLOQUEADO_STATUS };
  const alvo = acao === 'pausar' ? 'pausado' : 'ativo';
  if (atual === alvo) return { tipo: 'fim', status: 'ja_estava', mensagem: null };
  return { tipo: 'escrever', alvo };
}
