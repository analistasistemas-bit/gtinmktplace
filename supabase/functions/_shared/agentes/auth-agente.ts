// Portão da chamada de agente (ADR-0210, fatia 1). Lógica pura, padrão de `_shared/auth-org.ts`: todo IO chega
// por `DepsAuthAgente` (a fiação com o banco é da edge). A org vem só da linha da conexão.
// Logs só com códigos fixos: nada de chave, hash, motivo do 401 ou mensagem de erro de dependência.
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

const indisponivel = (codigo: string): Recusa => {
  console.warn(`[agentes] auth: ${codigo}`);
  return INDISPONIVEL;
};

const textoNaoVazio = (v: unknown) => typeof v === 'string' && v.length > 0;

/** Toda falha de credencial responde igual (401) e debita o IP. Loga um evento genérico só enquanto o IP está
 *  abaixo do teto (atacante não controla volume de log). */
async function recusarCredencial(d: DepsAuthAgente): Promise<Recusa> {
  const r = await reservarFalhaIp(d.ip, d.agora);
  if (r === 'limite') return LIMITE;
  if (r === 'falha') return INDISPONIVEL;
  console.warn('[agentes] credencial recusada');
  return { ok: false, status: 401, codigo: 'nao_autorizado' };
}

export async function autenticarAgente(req: Request, d: DepsAuthAgente): Promise<ResultadoAuthAgente> {
  const chave = extrairChave(req);
  if (!chave) return recusarCredencial(d);

  let linha: LinhaConexao | null;
  try {
    linha = await d.buscarConexaoPorHash(await hashChave(chave));
  } catch {
    return indisponivel('banco_indisponivel');
  }
  if (!linha) return recusarCredencial(d);
  if (!textoNaoVazio(linha.id) || !textoNaoVazio(linha.org_id)) return indisponivel('linha_invalida');
  if (situacaoDaConexao(linha, d.agora) !== 'ok') return recusarCredencial(d);

  try {
    if ((await d.orgAtivaComModulo(linha.org_id)) !== true) return { ok: false, status: 403, codigo: 'acesso_desligado' };
  } catch {
    return indisponivel('modulo_indisponivel');
  }

  const r = await reservarChamada(linha.id, d.agora);
  if (r === 'limite') return LIMITE;
  if (r === 'falha') return INDISPONIVEL;

  try {
    await d.marcarUso(linha.id);
  } catch {
    console.warn('[agentes] auth: marcar_uso_falhou');
  }
  return { ok: true, conexaoId: linha.id, orgId: linha.org_id };
}
