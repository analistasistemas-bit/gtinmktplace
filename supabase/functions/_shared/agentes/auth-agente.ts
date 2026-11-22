// Portão da chamada de agente (ADR-0210, fatia 1). Lógica pura, padrão de `_shared/auth-org.ts`: todo IO chega
// por `DepsAuthAgente` (a fiação com o banco é da edge). A org vem só da linha da conexão.
import { extrairChave, hashChave, type LinhaConexao, situacaoDaConexao } from './credencial.ts';
import { reservarChamada, reservarFalhaIp } from './limite.ts';

export interface DepsAuthAgente {
  buscarConexaoPorHash(hash: string): Promise<LinhaConexao | null>;
  orgAtivaComModulo(orgId: string): Promise<boolean>;
  marcarUso(conexaoId: string): Promise<void>;
  agora: Date;
  ip: string;
}

type Recusa = {
  ok: false;
  status: 401 | 403 | 429 | 503;
  codigo: 'nao_autorizado' | 'acesso_desligado' | 'limite' | 'indisponivel';
};
export type ResultadoAuthAgente = { ok: true; conexaoId: string; orgId: string } | Recusa;

const INDISPONIVEL: Recusa = { ok: false, status: 503, codigo: 'indisponivel' };
const LIMITE: Recusa = { ok: false, status: 429, codigo: 'limite' };

/** Toda falha de credencial responde igual (401) e debita o IP; o motivo só vai ao log, nunca a chave/hash. */
async function recusarCredencial(d: DepsAuthAgente, motivo: string, conexaoId?: string): Promise<Recusa> {
  console.warn('[agentes/auth] credencial recusada', motivo, conexaoId ?? '');
  const r = await reservarFalhaIp(d.ip, d.agora);
  if (r === 'limite') return LIMITE;
  if (r === 'falha') return INDISPONIVEL;
  return { ok: false, status: 401, codigo: 'nao_autorizado' };
}

export async function autenticarAgente(req: Request, d: DepsAuthAgente): Promise<ResultadoAuthAgente> {
  const chave = extrairChave(req);
  if (!chave) return recusarCredencial(d, 'ausente_ou_malformada');

  let linha: LinhaConexao | null;
  try {
    linha = await d.buscarConexaoPorHash(await hashChave(chave));
  } catch (e) {
    // ponytail: só o nome do erro; a mensagem do banco poderia ecoar o hash do filtro.
    console.warn('[agentes/auth] busca da conexão falhou', e instanceof Error ? e.name : typeof e);
    return INDISPONIVEL;
  }
  if (!linha) return recusarCredencial(d, 'nao_encontrada');
  const situacao = situacaoDaConexao(linha, d.agora);
  if (situacao !== 'ok') return recusarCredencial(d, situacao, linha.id);

  try {
    if (!(await d.orgAtivaComModulo(linha.org_id))) return { ok: false, status: 403, codigo: 'acesso_desligado' };
  } catch (e) {
    console.warn('[agentes/auth] checagem da org falhou', linha.id, String(e));
    return INDISPONIVEL;
  }

  const r = await reservarChamada(linha.id, d.agora);
  if (r === 'limite') return LIMITE;
  if (r === 'falha') return INDISPONIVEL;

  try {
    await d.marcarUso(linha.id);
  } catch (e) {
    console.warn('[agentes/auth] marcarUso falhou (segue)', linha.id, String(e));
  }
  return { ok: true, conexaoId: linha.id, orgId: linha.org_id };
}
