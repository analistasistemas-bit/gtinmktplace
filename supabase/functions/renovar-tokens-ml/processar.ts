// ADR-0171 — miolo do renovador proativo, deps injetadas (padrão sincronizar-fiscal-ml).
import type { ConexaoCanal } from '../_shared/canais/conexao.ts';
import { MLApiError } from '../_shared/ml/erro-ml.ts';
import type { ResultadoRenovacaoProativa } from '../_shared/ml/token.ts';

/** 165 min: menos que as 6h de vida do token, e não múltiplo de :00/:30/:10 (ADR-0171). */
export const LIMITE_RENOVACAO_MS = 165 * 60_000;
const PAUSA_ENTRE_CONEXOES_MS = 2000;

export interface DepsRenovador {
  listarConexoesAExpirar: () => Promise<ConexaoCanal[]>;
  renovar: (conexao: ConexaoCanal, limiteMs: number) => Promise<ResultadoRenovacaoProativa>;
  sleep: (ms: number) => Promise<void>;
}

export interface ResumoRenovacao {
  ok: true;
  renovadas: number;
  puladas: number;
  falhas: number;
  interrompido_429: boolean;
}

/**
 * Renova as conexões, uma por vez, com pausa entre elas (rate limit do ML é por app/`client_id`,
 * não por conta — ADR-0171). Um 429 encerra a rodada (as demais ficam para a hora seguinte);
 * qualquer outro erro (inclusive do Redis) é logado e a rodada segue. Sempre devolve `ok: true`.
 */
export async function processarRenovacao(deps: DepsRenovador): Promise<ResumoRenovacao> {
  const conexoes = await deps.listarConexoesAExpirar();
  let renovadas = 0;
  let puladas = 0;
  let falhas = 0;
  let interrompido_429 = false;

  for (let i = 0; i < conexoes.length; i++) {
    const cx = conexoes[i];
    try {
      const resultado = await deps.renovar(cx, LIMITE_RENOVACAO_MS);
      if (resultado === 'renovado') renovadas++;
      else puladas++;
    } catch (e) {
      if (e instanceof MLApiError && e.status === 429) {
        console.error('[renovar-tokens-ml] 429 do ML — encerrando a rodada', { orgId: cx.orgId, conexaoId: cx.id });
        interrompido_429 = true;
        break;
      }
      falhas++;
      console.error('[renovar-tokens-ml] falha ao renovar conexão', {
        orgId: cx.orgId, conexaoId: cx.id, erro: e instanceof Error ? e.message : String(e),
      });
    }
    if (i < conexoes.length - 1) await deps.sleep(PAUSA_ENTRE_CONEXOES_MS);
  }

  return { ok: true, renovadas, puladas, falhas, interrompido_429 };
}
