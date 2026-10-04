import { describe, expect, it, vi } from 'vitest';
import { etapaReajuste, type DepsEtapaReajuste } from '../etapa.ts';
import { MLApiError } from '../../../ml/erro-ml.ts';
import { MSG_RECONECTAR, MSG_SEM_CONEXAO } from '../../falhas.ts';

const AGORA = Date.parse('2026-10-04T12:00:00Z');
const OP = { id: 'op', org_id: 'org', origem_id: null };
type It = { ml_item_id: string; status: string; etapa: string | null; proxima_conferencia: string | null; mensagem?: string };

/** Banco em memória com o contrato de encerrarSemEtapa (DepsReajuste): sem etapa → erro; com etapa → conferindo agendado. */
function montar(itens: It[], conexao: DepsEtapaReajuste<string>['conexao']) {
  const banco = {
    agora: () => AGORA,
    reivindicar: vi.fn(), itensPendentes: vi.fn(), temEnviando: vi.fn(), gravarItem: vi.fn(), continuar: vi.fn(),
    agendarConferencia: vi.fn(async () => {}),
    concluir: vi.fn(async () => {}),
    itensAConferir: vi.fn(async () => itens.filter((i) => i.status === 'conferindo' && i.proxima_conferencia)
      .map((i) => ({ ...i, preco: null, conferencias: 0, semaforo: null, confirmado_risco: false, saida_pedida_em: null }) as never)),
    encerrarSemEtapa: vi.fn(async (_op: string, mensagem: string) => {
      for (const i of itens) {
        if (i.status !== 'pendente' && i.status !== 'enviando') continue;
        Object.assign(i, i.etapa === null
          ? { status: 'erro', mensagem }
          : { status: 'conferindo', mensagem, proxima_conferencia: new Date(AGORA + 10 * 60_000).toISOString() });
      }
    }),
  };
  const executar = vi.fn(async () => ({ processados: 1, continuou: false }));
  return { itens, banco, executar, deps: { conexao, banco, executar } as DepsEtapaReajuste<string> };
}
const mix = (): It[] => [
  { ml_item_id: 'A', status: 'pendente', etapa: null, proxima_conferencia: null },
  { ml_item_id: 'B', status: 'enviando', etapa: 'escrita_pedida', proxima_conferencia: null },
];

describe('etapaReajuste', () => {
  it('invalid_grant: sem etapa → erro, com etapa → conferindo; operação não conclui e a conferência é agendada', async () => {
    const m = montar(mix(), async () => { throw new MLApiError(400, 'refresh recusado', 'invalid_grant'); });
    expect(await etapaReajuste(OP, m.deps)).toEqual({ ok: false, erro: MSG_RECONECTAR });
    expect(m.itens.map((i) => i.status)).toEqual(['erro', 'conferindo']);
    expect(m.itens[1].etapa).toBe('escrita_pedida');
    expect(m.banco.encerrarSemEtapa).toHaveBeenCalledWith('op', MSG_RECONECTAR);
    expect(m.banco.concluir).not.toHaveBeenCalled();
    expect(m.banco.agendarConferencia).toHaveBeenCalledWith(600);
    expect(m.executar).not.toHaveBeenCalled();
  });

  it('sem conexão: idem com MSG_SEM_CONEXAO', async () => {
    const m = montar(mix(), async () => null);
    expect(await etapaReajuste(OP, m.deps)).toEqual({ ok: false, erro: MSG_SEM_CONEXAO });
    expect(m.itens.map((i) => i.status)).toEqual(['erro', 'conferindo']);
    expect(m.banco.concluir).not.toHaveBeenCalled();
    expect(m.banco.agendarConferencia).toHaveBeenCalledWith(600);
  });

  it('sem conexão e nada com etapa: conclui', async () => {
    const m = montar([{ ml_item_id: 'A', status: 'pendente', etapa: null, proxima_conferencia: null }], async () => null);
    await etapaReajuste(OP, m.deps);
    expect(m.banco.concluir).toHaveBeenCalledOnce();
    expect(m.banco.agendarConferencia).not.toHaveBeenCalled();
  });

  it('erro transitório (inclusive MLApiError sem invalid_grant) relança sem encerrar nada', async () => {
    for (const erro of [new Error('banco fora'), new MLApiError(500, 'ML 500')]) {
      const m = montar(mix(), async () => { throw erro; });
      await expect(etapaReajuste(OP, m.deps)).rejects.toBe(erro);
      expect(m.banco.encerrarSemEtapa).not.toHaveBeenCalled();
      expect(m.itens.map((i) => i.status)).toEqual(['pendente', 'enviando']);
    }
  });

  it('com conexão: delega ao executor com a conexão', async () => {
    const m = montar(mix(), async () => 'cx');
    expect(await etapaReajuste(OP, m.deps)).toEqual({ ok: true, processados: 1, continuou: false });
    expect(m.executar).toHaveBeenCalledWith('cx');
    expect(m.banco.encerrarSemEtapa).not.toHaveBeenCalled();
  });
});
