import { describe, it, expect } from 'vitest';
import { gerenciarKit, type DepsGerenciarKit, type GerenciarKitInput, type RespostaRpcGerenciar } from '../processar.ts';

// Kit "Preto e Branco" em M e G; cada SKU de kit usa 1 Preto + 1 Branco do mesmo tamanho. A RPC (CAS + efeito numa
// transação) é coberta por supabase/tests/kit_variacao_gerenciar.sql; aqui, o que a edge monta e dispara.
function cenario(semAnuncio: string[] = []) {
  const log: string[] = [];
  const s = {
    chamadas: [] as Array<Parameters<DepsGerenciarKit['rpc']>[0]>,
    resposta: { ok: true, transferencia_id: null, normais: [], reposicao_desligada: false, so_em_kit: false, reposicao_auto: false, versao: 4 } as RespostaRpcGerenciar,
    encerrar: { ok: true, transferencia_id: 'T-ENC', versao: 4 } as RespostaRpcGerenciar,
  };
  const deps: DepsGerenciarKit = {
    orgId: 'ORG',
    async skusDoKit() {
      return [
        { codigo: 'KPB-M', componentes: [{ codigo: 'P-M', quantidade: 1 }, { codigo: 'B-M', quantidade: 1 }] },
        { codigo: 'KPB-G', componentes: [{ codigo: 'P-G', quantidade: 1 }, { codigo: 'B-G', quantidade: 1 }] },
      ];
    },
    async alvosDe(codigos) {
      return codigos.filter((c) => !semAnuncio.includes(c)).map((c) => ({ codigo: c, up_id: `UP-${c}`, item_ids: [`MLB-${c}`] }));
    },
    async rpc(a) { s.chamadas.push(a); log.push(`rpc ${a.acao}`); return s.resposta; },
    async enfileirarSaga(id) { log.push(`saga ${id}`); },
    async enfileirarReposicao(id) { log.push(`reposicao ${id}`); },
    async encerrar(kitId, versao) { log.push(`encerrar ${kitId} v${versao}`); return s.encerrar; },
  };
  return { deps, log, s };
}
const pedido = (p: Partial<GerenciarKitInput>): GerenciarKitInput => ({ kitId: 'K1', acao: 'alterar_meta', versao: 3, ...p });

describe('gerenciarKit', () => {
  it('toda operação exige a versão lida (sem ela não chama a RPC)', async () => {
    const { deps, log } = cenario();
    for (const acao of ['alterar_meta', 'ligar_so_em_kit', 'desligar_so_em_kit', 'ligar_reposicao', 'montar', 'desmontar'] as const) {
      expect(await gerenciarKit(deps, { kitId: 'K1', acao, meta: 1, chave: 'C', itens: [{ codigo: 'KPB-M', quantidade: 1 }] }))
        .toMatchObject({ ok: false, motivo: 'versao' });
    }
    expect(log).toEqual([]);
  });

  it('meta: uma chamada à RPC com a versão; reposição disparada só com "só em kit" e reposição ligadas', async () => {
    const c = cenario();
    expect(await gerenciarKit(c.deps, pedido({ meta: 4 }))).toMatchObject({ ok: true, versao: 4 });
    expect(c.s.chamadas[0]).toMatchObject({ kitId: 'K1', acao: 'alterar_meta', versao: 3, meta: 4 });
    expect(c.log).toEqual(['rpc alterar_meta']);
    const d = cenario();
    d.s.resposta = { ...d.s.resposta, so_em_kit: true, reposicao_auto: true };
    await gerenciarKit(d.deps, pedido({ meta: 4 }));
    expect(d.log).toEqual(['rpc alterar_meta', 'reposicao K1']);
  });

  it('meta inválida recusa antes da RPC', async () => {
    const { deps, log } = cenario();
    for (const meta of [-1, 1.5, Number.NaN, undefined]) {
      expect(await gerenciarKit(deps, pedido({ meta }))).toMatchObject({ ok: false, motivo: 'meta_invalida' });
    }
    expect(log).toEqual([]);
  });

  it('recusa da RPC (versão velha) chega com mensagem e nada é enfileirado', async () => {
    const c = cenario();
    c.s.resposta = { ok: false, motivo: 'versao' };
    expect(await gerenciarKit(c.deps, pedido({ meta: 4 }))).toMatchObject({ ok: false, motivo: 'versao', mensagem: expect.stringMatching(/outra tela/) });
    expect(c.log).toEqual(['rpc alterar_meta']);
  });

  it('ligar "Vender só em kit" manda as peças do kit como alvos e enfileira a sair_sobra', async () => {
    const c = cenario();
    c.s.resposta = { ...c.s.resposta, transferencia_id: 'T-LIGAR', so_em_kit: true, reposicao_auto: true };
    expect(await gerenciarKit(c.deps, pedido({ acao: 'ligar_so_em_kit' }))).toMatchObject({ ok: true, transferenciaId: 'T-LIGAR' });
    expect(c.s.chamadas[0].alvos.map((a) => a.codigo)).toEqual(['B-G', 'B-M', 'P-G', 'P-M']);
    expect(c.log).toEqual(['rpc ligar_so_em_kit', 'saga T-LIGAR']);
  });

  it('desligar "Vender só em kit" dispara a rodada que desfaz as pausas', async () => {
    const c = cenario();
    c.s.resposta = { ...c.s.resposta, normais: ['P-M'] };
    expect(await gerenciarKit(c.deps, pedido({ acao: 'desligar_so_em_kit' }))).toMatchObject({ ok: true, normais: ['P-M'] });
    expect(c.log).toEqual(['rpc desligar_so_em_kit', 'reposicao K1']);
  });

  it('montar: SKU de kit e componentes como alvos (nunca `criar`), chave e hash estáveis', async () => {
    const c = cenario();
    c.s.resposta = { ...c.s.resposta, transferencia_id: 'T1' };
    const p = pedido({ acao: 'montar', chave: 'CH1', itens: [{ codigo: 'KPB-M', quantidade: 2 }] });
    expect(await gerenciarKit(c.deps, p)).toMatchObject({ ok: true, transferenciaId: 'T1' });
    const a = c.s.chamadas[0];
    expect(a).toMatchObject({ acao: 'montar', versao: 3, chave: 'CH1', itens: [{ codigo: 'KPB-M', quantidade: 2 }], desligarSoEmKit: false });
    expect(a.alvos).toEqual([
      { codigo: 'B-M', up_id: 'UP-B-M', item_ids: ['MLB-B-M'] },
      { codigo: 'KPB-M', up_id: 'UP-KPB-M', item_ids: ['MLB-KPB-M'] },
      { codigo: 'P-M', up_id: 'UP-P-M', item_ids: ['MLB-P-M'] },
    ]);
    expect(c.log).toEqual(['rpc montar', 'saga T1']);
    // Mesmo pedido = mesmo hash (a RPC devolve a transferência original); outro pedido = outro hash.
    await gerenciarKit(c.deps, p);
    await gerenciarKit(c.deps, { ...p, itens: [{ codigo: 'KPB-M', quantidade: 3 }] });
    expect(c.s.chamadas[1].hash).toBe(a.hash);
    expect(c.s.chamadas[2].hash).not.toBe(a.hash);
  });

  it('montar/desmontar sem chave recusa', async () => {
    const { deps, log } = cenario();
    expect(await gerenciarKit(deps, pedido({ acao: 'montar', itens: [{ codigo: 'KPB-M', quantidade: 1 }] })))
      .toMatchObject({ ok: false, motivo: 'chave_ausente' });
    expect(log).toEqual([]);
  });

  it('SKU de kit sem anúncio recusa: o caminho de Gerenciar nunca cria anúncio', async () => {
    const { deps, log } = cenario(['KPB-G']);
    expect(await gerenciarKit(deps, pedido({ acao: 'montar', chave: 'C', itens: [{ codigo: 'KPB-G', quantidade: 1 }] })))
      .toMatchObject({ ok: false, motivo: 'sku_sem_anuncio' });
    expect(log).toEqual([]);
  });

  it('itens inválidos recusam (SKU de outro kit, 0, fracionado, repetido, vazio)', async () => {
    const { deps } = cenario();
    for (const itens of [
      [{ codigo: 'OUTRO', quantidade: 1 }], [{ codigo: 'KPB-M', quantidade: 0 }], [{ codigo: 'KPB-M', quantidade: 1.5 }],
      [{ codigo: 'KPB-M', quantidade: 1 }, { codigo: 'KPB-M', quantidade: 1 }], [], undefined,
    ]) {
      expect(await gerenciarKit(deps, pedido({ acao: 'desmontar', chave: 'C', itens }))).toMatchObject({ ok: false, motivo: 'itens_invalidos' });
    }
  });

  it('desmontar + desligar "Vender só em kit": UMA chamada com a intenção (a RPC desliga antes da transferência)', async () => {
    const c = cenario();
    c.s.resposta = { ...c.s.resposta, transferencia_id: 'T2', normais: ['P-G', 'B-G'], reposicao_desligada: true };
    const r = await gerenciarKit(c.deps, pedido({
      acao: 'desmontar', chave: 'CH2', desligarSoEmKit: true, itens: [{ codigo: 'KPB-G', quantidade: 1 }],
    }));
    expect(r).toMatchObject({ ok: true, transferenciaId: 'T2', reposicaoDesligada: true, normais: ['P-G', 'B-G'] });
    expect(c.s.chamadas).toHaveLength(1);
    expect(c.s.chamadas[0]).toMatchObject({ acao: 'desmontar', desligarSoEmKit: true });
    expect(c.log).toEqual(['rpc desmontar', 'saga T2', 'reposicao K1']);
  });

  it('ação desconhecida recusa', async () => {
    const { deps } = cenario();
    expect(await gerenciarKit(deps, pedido({ acao: 'apagar' as never }))).toMatchObject({ ok: false, motivo: 'acao_invalida' });
  });

  it('Encerrar kit: só a RPC própria (alvos saem do vínculo local no SQL) e a saga da transferência na fila', async () => {
    const c = cenario();
    expect(await gerenciarKit(c.deps, pedido({ acao: 'encerrar' }))).toMatchObject({ ok: true, transferenciaId: 'T-ENC', versao: 4 });
    expect(c.log).toEqual(['encerrar K1 v3', 'saga T-ENC']);
    expect(c.s.chamadas).toEqual([]);
  });

  it('Encerrar kit sem nada no ML: encerra direto e a rodada desfaz as pausas da automação', async () => {
    const c = cenario();
    c.s.encerrar = { ok: true, transferencia_id: null, encerrado: true, versao: 5 } as RespostaRpcGerenciar;
    expect(await gerenciarKit(c.deps, pedido({ acao: 'encerrar' }))).toMatchObject({ ok: true, encerrado: true });
    expect(c.log).toEqual(['encerrar K1 v3', 'reposicao K1']);
  });

  it('Encerrar kit com saldo ou transferência aberta: recusa com a mensagem e nada na fila', async () => {
    const c = cenario();
    c.s.encerrar = { ok: false, motivo: 'saldo', codigo: 'KPB-M' };
    expect(await gerenciarKit(c.deps, pedido({ acao: 'encerrar' })))
      .toEqual({ ok: false, motivo: 'saldo', mensagem: expect.stringContaining('Desmonte antes') });
    c.s.encerrar = { ok: false, motivo: 'transferencia_aberta' };
    expect(await gerenciarKit(c.deps, pedido({ acao: 'encerrar' })))
      .toMatchObject({ ok: false, motivo: 'transferencia_aberta' });
    expect(c.log).toEqual(['encerrar K1 v3', 'encerrar K1 v3']);
  });
});
