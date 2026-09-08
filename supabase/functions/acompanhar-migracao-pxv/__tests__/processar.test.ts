import { describe, it, expect } from 'vitest';
import {
  acompanharMigracaoPxv, DELAY_CRIANDO_S, DELAY_ATIVANDO_S, MAX_TENTATIVAS,
  type PortasAcompanhamento, type EstadoMigracao,
} from '../processar';
import type { VariacaoSnapshot } from '../../_shared/ml/migracao-pxv';

const SNAP: VariacaoSnapshot[] = [
  { id: '10', sku: '00000001', cor: 'Azul' },
  { id: '20', sku: '00000002', cor: 'Rosa' },
];
const NOVOS = [{ itemId: 'MLB-A', variationId: '10' }, { itemId: 'MLB-B', variationId: '20' }];

function fakeMundo(over: Partial<{
  estado: EstadoMigracao | null;
  claimOk: boolean;
  status: { encontrada: boolean; migracaoCompleta: string | null; ativacaoCompleta: string | null; novosItens: typeof NOVOS };
  cores: Map<string, string | null>;
  adocao: { ok: boolean; mensagem?: string; retryavel?: boolean };
  saldos: Array<{ sku: string; local: number; vivo: number }>;
}> = {}) {
  const chamadas = {
    reenfileirou: [] as Array<{ tentativa: number; delay: number }>,
    concluiu: 0, erros: [] as string[], notificacoes: [] as string[],
    empurrou: [] as string[][], adotou: 0, leuCores: 0,
  };
  const portas: PortasAcompanhamento = {
    carregarEstado: () => Promise.resolve(
      over.estado === undefined
        ? { mlItemIdAnterior: 'MLB1', snapshot: SNAP, status: 'em_andamento', tentativa: 1 }
        : over.estado,
    ),
    assumirRodada: () => Promise.resolve(over.claimOk ?? true),
    lerStatus: () => Promise.resolve(over.status ?? {
      encontrada: true, migracaoCompleta: '2026-09-08T10:00:00Z',
      ativacaoCompleta: '2026-09-08T10:05:00Z', novosItens: NOVOS,
    }),
    lerCores: (ids) => { chamadas.leuCores += 1; return Promise.resolve(over.cores ?? new Map(ids.map((i) => [i, null]))); },
    lerVariacoesLocais: () => Promise.resolve([
      { codigo: '00000001', mlVariationId: '10' }, { codigo: '00000002', mlVariationId: '20' },
    ]),
    adotar: () => { chamadas.adotou += 1; return Promise.resolve(over.adocao ?? { ok: true }); },
    lerSaldos: () => Promise.resolve(over.saldos ?? [
      { sku: '00000001', local: 5, vivo: 5 }, { sku: '00000002', local: 3, vivo: 3 },
    ]),
    empurrarEstoque: (skus) => { chamadas.empurrou.push(skus); return Promise.resolve(); },
    reenfileirar: (tentativa, delay) => { chamadas.reenfileirou.push({ tentativa, delay }); return Promise.resolve(); },
    concluir: () => { chamadas.concluiu += 1; return Promise.resolve(); },
    marcarErro: (m) => { chamadas.erros.push(m); return Promise.resolve(); },
    notificar: (t) => { chamadas.notificacoes.push(t); return Promise.resolve(); },
  };
  return { portas, chamadas };
}

describe('acompanharMigracaoPxv — espera', () => {
  it('sem activation_completed e ainda criando → reagenda com passo longo', async () => {
    const w = fakeMundo({
      status: { encontrada: true, migracaoCompleta: null, ativacaoCompleta: null, novosItens: [] },
    });
    const r = await acompanharMigracaoPxv(w.portas, 1);
    expect(r).toEqual({ tipo: 'aguardando', proximoDelayS: DELAY_CRIANDO_S });
    expect(w.chamadas.reenfileirou).toEqual([{ tentativa: 2, delay: DELAY_CRIANDO_S }]);
    expect(w.chamadas.adotou).toBe(0);
  });

  // Depois que os filhos existem, só falta ativar — e cada minuto nessa janela é um minuto em que
  // uma venda no clone escaparia da baixa de estoque. Por isso o passo encurta.
  it('migration_completed preenchido → passo curto', async () => {
    const w = fakeMundo({
      status: { encontrada: true, migracaoCompleta: '2026-09-08T10:00:00Z', ativacaoCompleta: null, novosItens: NOVOS },
    });
    const r = await acompanharMigracaoPxv(w.portas, 3);
    expect(r).toEqual({ tipo: 'aguardando', proximoDelayS: DELAY_ATIVANDO_S });
  });

  it('404 no ML (migração não encontrada) ainda espera, não desiste no 1º ciclo', async () => {
    const w = fakeMundo({
      status: { encontrada: false, migracaoCompleta: null, ativacaoCompleta: null, novosItens: [] },
    });
    expect((await acompanharMigracaoPxv(w.portas, 1)).tipo).toBe('aguardando');
  });
});

// A API do ML não tem estado de falha: travada é indistinguível de lenta. Sem orçamento finito o
// worker giraria para sempre e o operador nunca saberia.
describe('acompanharMigracaoPxv — orçamento esgotado', () => {
  it('marca erro e notifica, com texto diferente para "não encontrada"', async () => {
    const w = fakeMundo({
      status: { encontrada: false, migracaoCompleta: null, ativacaoCompleta: null, novosItens: [] },
    });
    const r = await acompanharMigracaoPxv(w.portas, MAX_TENTATIVAS);
    expect(r.tipo).toBe('erro');
    expect(w.chamadas.erros[0]).toMatch(/não reconhece nenhuma migração/i);
    expect(w.chamadas.notificacoes).toHaveLength(1);
    expect(w.chamadas.reenfileirou).toEqual([]);
  });

  it('em transição no esgotamento → mensagem de conferir no painel', async () => {
    const w = fakeMundo({
      status: { encontrada: true, migracaoCompleta: null, ativacaoCompleta: null, novosItens: [] },
    });
    await acompanharMigracaoPxv(w.portas, MAX_TENTATIVAS);
    expect(w.chamadas.erros[0]).toMatch(/não terminou dentro do tempo/i);
  });
});

describe('acompanharMigracaoPxv — conclusão', () => {
  it('casa por variation_id, adota, empurra estoque e conclui', async () => {
    const w = fakeMundo();
    const r = await acompanharMigracaoPxv(w.portas, 2);
    expect(r.tipo).toBe('concluido');
    expect(w.chamadas.adotou).toBe(1);
    expect(w.chamadas.concluiu).toBe(1);
    expect(w.chamadas.empurrou).toEqual([['00000001', '00000002']]);
    expect(w.chamadas.notificacoes[0]).toMatch(/concluída/i);
    // Não paga o GET das cores quando o id já casou.
    expect(w.chamadas.leuCores).toBe(0);
  });

  it('só lê cores quando o casamento por id falha', async () => {
    const w = fakeMundo({
      status: {
        encontrada: true, migracaoCompleta: 'x', ativacaoCompleta: 'y',
        novosItens: [{ itemId: 'MLB-A', variationId: '999' }, { itemId: 'MLB-B', variationId: '888' }],
      },
      cores: new Map([['MLB-A', 'Azul'], ['MLB-B', 'Rosa']]),
    });
    const r = await acompanharMigracaoPxv(w.portas, 2);
    expect(r.tipo).toBe('concluido');
    expect(w.chamadas.leuCores).toBe(1);
  });

  it('casamento impossível → erro, sem adotar nada', async () => {
    const w = fakeMundo({
      status: {
        encontrada: true, migracaoCompleta: 'x', ativacaoCompleta: 'y',
        novosItens: [{ itemId: 'MLB-Z', variationId: 'zzz' }],
      },
      cores: new Map([['MLB-Z', 'Turquesa']]),
    });
    const r = await acompanharMigracaoPxv(w.portas, 2);
    expect(r.tipo).toBe('erro');
    expect(w.chamadas.adotou).toBe(0);
    expect(w.chamadas.concluiu).toBe(0);
  });
});

// Se houve venda no clone antes de o app reconhecê-lo, a baixa não aconteceu e o saldo local ficou
// alto demais. Empurrar ali RESTAURARIA unidades já vendidas — o oversell clássico.
describe('acompanharMigracaoPxv — trava anti-oversell no push de estoque', () => {
  it('SKU com saldo local MAIOR que o vivo não é empurrado, e o operador é avisado', async () => {
    const w = fakeMundo({
      saldos: [
        { sku: '00000001', local: 5, vivo: 5 },
        { sku: '00000002', local: 9, vivo: 4 },
      ],
    });
    const r = await acompanharMigracaoPxv(w.portas, 2);
    expect(r.tipo).toBe('concluido');
    expect(w.chamadas.empurrou).toEqual([['00000001']]);
    expect(w.chamadas.notificacoes[0]).toMatch(/00000002/);
    expect(w.chamadas.notificacoes[0]).toMatch(/venda ainda não registrada/i);
  });

  it('saldo local menor que o vivo é empurrado (caso legítimo)', async () => {
    const w = fakeMundo({
      saldos: [{ sku: '00000001', local: 2, vivo: 7 }, { sku: '00000002', local: 3, vivo: 3 }],
    });
    await acompanharMigracaoPxv(w.portas, 2);
    expect(w.chamadas.empurrou).toEqual([['00000001', '00000002']]);
  });

  it('todos suspeitos → não empurra nada, mas conclui a adoção', async () => {
    const w = fakeMundo({ saldos: [{ sku: '00000001', local: 9, vivo: 1 }] });
    const r = await acompanharMigracaoPxv(w.portas, 2);
    expect(r.tipo).toBe('concluido');
    expect(w.chamadas.empurrou).toEqual([]);
  });
});

describe('acompanharMigracaoPxv — concorrência e transitórios', () => {
  it('claim perdido → encerra em silêncio, sem adotar nem notificar', async () => {
    const w = fakeMundo({ claimOk: false });
    expect(await acompanharMigracaoPxv(w.portas, 2)).toEqual({ tipo: 'duplicado' });
    expect(w.chamadas.adotou).toBe(0);
    expect(w.chamadas.notificacoes).toEqual([]);
  });

  it('episódio já encerrado (estado nulo ou erro) → duplicado', async () => {
    for (const estado of [null, { mlItemIdAnterior: 'MLB1', snapshot: SNAP, status: 'erro', tentativa: 1 }]) {
      const w = fakeMundo({ estado: estado as EstadoMigracao | null });
      expect((await acompanharMigracaoPxv(w.portas, 2)).tipo).toBe('duplicado');
    }
  });

  // A tag `_pending` do ML e `activation_completed` não caem necessariamente juntos: a adoção pode
  // recusar por "ainda em migração" logo depois de o status dizer concluído. Isso é espera, não erro.
  it('adoção retornando retryável → reagenda em vez de marcar erro', async () => {
    const w = fakeMundo({ adocao: { ok: false, retryavel: true, mensagem: 'ainda em migração' } });
    const r = await acompanharMigracaoPxv(w.portas, 2);
    expect(r.tipo).toBe('aguardando');
    expect(w.chamadas.erros).toEqual([]);
  });

  it('adoção retryável no fim do orçamento vira erro', async () => {
    const w = fakeMundo({ adocao: { ok: false, retryavel: true, mensagem: 'ainda em migração' } });
    expect((await acompanharMigracaoPxv(w.portas, MAX_TENTATIVAS)).tipo).toBe('erro');
  });
});
