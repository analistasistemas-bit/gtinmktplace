import { describe, it, expect } from 'vitest';
import { gerenciarKit, type DepsGerenciarKit, type KitGerenciado } from '../processar.ts';
import type { NovaTransferencia } from '../../_shared/kit-variacao/saga.ts';

// Kit "Preto e Branco" em M e G; cada SKU de kit usa 1 Preto + 1 Branco do mesmo tamanho.
function cenario(kit: Partial<KitGerenciado> = {}, semAnuncio: string[] = []) {
  const log: string[] = [];
  const estado: KitGerenciado = { id: 'K1', soEmKit: false, reposicaoAuto: false, meta: 0, versao: 3, ...kit };
  const transferencias: NovaTransferencia[] = [];
  const deps: DepsGerenciarKit = {
    orgId: 'ORG',
    async lerKit(id) { return id === 'K1' ? { ...estado } : null; },
    async skusDoKit() {
      return [
        { codigo: 'KPB-M', componentes: [{ codigo: 'P-M', quantidade: 1 }, { codigo: 'B-M', quantidade: 1 }] },
        { codigo: 'KPB-G', componentes: [{ codigo: 'P-G', quantidade: 1 }, { codigo: 'B-G', quantidade: 1 }] },
      ];
    },
    // Formato real de `alvosDe` (snake_case).
    async alvosDe(codigos) {
      return codigos.filter((c) => !semAnuncio.includes(c))
        .map((c) => ({ codigo: c, up_id: `UP-${c}`, item_ids: [`MLB-${c}`] }));
    },
    async casKit(id, versao, patch) {
      log.push(`cas ${id} v${versao} ${JSON.stringify(patch)}`);
      if (versao !== estado.versao) return false;
      Object.assign(estado, patch, { versao: estado.versao + 1 });
      return true;
    },
    async ligarSoEmKit(id) { log.push(`ligar ${id}`); estado.soEmKit = true; estado.reposicaoAuto = true; return { ok: true, transferenciaId: 'T-LIGAR' }; },
    async desligarSoEmKit(id) { log.push(`desligar ${id}`); estado.soEmKit = false; return ['P-M']; },
    async criarTransferencia(input) {
      log.push(`transferencia ${input.tipo}`);
      transferencias.push(input);
      return { id: 'T1' };
    },
    async enfileirarSaga(id) { log.push(`saga ${id}`); },
    async enfileirarReposicao(id) { log.push(`reposicao ${id}`); },
  };
  return { deps, log, estado, transferencias };
}

describe('gerenciarKit', () => {
  it('kit de outra org (ou inexistente) recusa sem agir', async () => {
    const { deps, log } = cenario();
    const r = await gerenciarKit(deps, { kitId: 'K9', acao: 'alterar_meta', versao: 3, meta: 2 });
    expect(r).toMatchObject({ ok: false, motivo: 'kit_nao_encontrado' });
    expect(log).toEqual([]);
  });

  it('alterar meta incrementa a versão e dispara a reposição só com "Vender só em kit"', async () => {
    const { deps, log, estado } = cenario({ soEmKit: true, reposicaoAuto: true });
    expect(await gerenciarKit(deps, { kitId: 'K1', acao: 'alterar_meta', versao: 3, meta: 4 })).toMatchObject({ ok: true });
    expect(estado).toMatchObject({ meta: 4, versao: 4 });
    expect(log).toEqual(['cas K1 v3 {"meta":4}', 'reposicao K1']);

    const sem = cenario();
    await gerenciarKit(sem.deps, { kitId: 'K1', acao: 'alterar_meta', versao: 3, meta: 4 });
    expect(sem.log).toEqual(['cas K1 v3 {"meta":4}']);
  });

  it('versão velha recusa (decisão de outra aba não é sobrescrita)', async () => {
    const { deps, estado } = cenario();
    const r = await gerenciarKit(deps, { kitId: 'K1', acao: 'alterar_meta', versao: 2, meta: 9 });
    expect(r).toMatchObject({ ok: false, motivo: 'versao' });
    expect(estado.meta).toBe(0);
  });

  it('meta inválida recusa', async () => {
    const { deps } = cenario();
    for (const meta of [-1, 1.5, Number.NaN, undefined]) {
      expect(await gerenciarKit(deps, { kitId: 'K1', acao: 'alterar_meta', versao: 3, meta }))
        .toMatchObject({ ok: false, motivo: 'meta_invalida' });
    }
  });

  it('ligar reposição exige "Vender só em kit"', async () => {
    const { deps, log } = cenario();
    expect(await gerenciarKit(deps, { kitId: 'K1', acao: 'ligar_reposicao', versao: 3 }))
      .toMatchObject({ ok: false, motivo: 'so_em_kit_desligado' });
    expect(log).toEqual([]);
  });

  it('ligar e desligar reposição incrementam a versão; ligar dispara a rodada', async () => {
    const { deps, log, estado } = cenario({ soEmKit: true });
    await gerenciarKit(deps, { kitId: 'K1', acao: 'ligar_reposicao', versao: 3 });
    await gerenciarKit(deps, { kitId: 'K1', acao: 'desligar_reposicao', versao: 4 });
    expect(estado).toMatchObject({ reposicaoAuto: false, versao: 5 });
    expect(log).toEqual([
      'cas K1 v3 {"reposicaoAuto":true}', 'reposicao K1',
      'cas K1 v4 {"reposicaoAuto":false}',
    ]);
  });

  it('ligar "Vender só em kit": versão primeiro, depois a função da Task 14, que enfileira a saga', async () => {
    const { deps, log } = cenario();
    const r = await gerenciarKit(deps, { kitId: 'K1', acao: 'ligar_so_em_kit', versao: 3 });
    expect(r).toMatchObject({ ok: true, transferenciaId: 'T-LIGAR' });
    expect(log).toEqual(['cas K1 v3 {}', 'ligar K1']);
  });

  it('ligar recusado (SKU ocupado) devolve o motivo', async () => {
    const { deps } = cenario();
    deps.ligarSoEmKit = async () => ({ ok: false, motivo: 'up_ocupado:P-M' });
    expect(await gerenciarKit(deps, { kitId: 'K1', acao: 'ligar_so_em_kit', versao: 3 }))
      .toMatchObject({ ok: false, motivo: 'up_ocupado' });
  });

  it('desligar "Vender só em kit" devolve os SKUs que voltaram a Normal', async () => {
    const { deps, log } = cenario({ soEmKit: true, reposicaoAuto: true });
    const r = await gerenciarKit(deps, { kitId: 'K1', acao: 'desligar_so_em_kit', versao: 3 });
    expect(r).toMatchObject({ ok: true, normais: ['P-M'] });
    expect(log).toEqual(['cas K1 v3 {}', 'desligar K1']);
  });

  it('montar mais: transferência `montar` com SKU de kit e componentes como alvos, nunca alvo `criar`', async () => {
    const { deps, log, transferencias } = cenario();
    const r = await gerenciarKit(deps, { kitId: 'K1', acao: 'montar', itens: [{ codigo: 'KPB-M', quantidade: 2 }] });
    expect(r).toMatchObject({ ok: true, transferenciaId: 'T1' });
    expect(transferencias[0]).toEqual({
      orgId: 'ORG', kitId: 'K1', tipo: 'montar', itens: [{ codigo: 'KPB-M', quantidade: 2 }],
      alvos: [
        { codigo: 'B-M', upId: 'UP-B-M', itemIds: ['MLB-B-M'] },
        { codigo: 'KPB-M', upId: 'UP-KPB-M', itemIds: ['MLB-KPB-M'] },
        { codigo: 'P-M', upId: 'UP-P-M', itemIds: ['MLB-P-M'] },
      ],
    });
    expect(transferencias[0].alvos.some((a) => 'criar' in a)).toBe(false);
    expect(log).toEqual(['transferencia montar', 'saga T1']);
  });

  it('montar em SKU de kit sem anúncio recusa: Montar mais nunca cria anúncio novo', async () => {
    const { deps, log } = cenario({}, ['KPB-G']);
    expect(await gerenciarKit(deps, { kitId: 'K1', acao: 'montar', itens: [{ codigo: 'KPB-G', quantidade: 1 }] }))
      .toMatchObject({ ok: false, motivo: 'sku_sem_anuncio' });
    expect(log).toEqual([]);
  });

  it('itens inválidos recusam (SKU de outro kit, quantidade 0 ou fracionada, repetido, vazio)', async () => {
    const { deps } = cenario();
    for (const itens of [
      [{ codigo: 'OUTRO', quantidade: 1 }], [{ codigo: 'KPB-M', quantidade: 0 }], [{ codigo: 'KPB-M', quantidade: 1.5 }],
      [{ codigo: 'KPB-M', quantidade: 1 }, { codigo: 'KPB-M', quantidade: 1 }], [], undefined,
    ]) {
      expect(await gerenciarKit(deps, { kitId: 'K1', acao: 'desmontar', itens }))
        .toMatchObject({ ok: false, motivo: 'itens_invalidos' });
    }
  });

  it('desmontar com reposição ligada desliga a reposição ANTES de criar a transferência', async () => {
    const { deps, log, estado } = cenario({ soEmKit: true, reposicaoAuto: true });
    const r = await gerenciarKit(deps, { kitId: 'K1', acao: 'desmontar', versao: 3, itens: [{ codigo: 'KPB-G', quantidade: 1 }] });
    expect(r).toMatchObject({ ok: true, transferenciaId: 'T1', reposicaoDesligada: true, soEmKit: true });
    expect(estado.reposicaoAuto).toBe(false);
    expect(log).toEqual(['cas K1 v3 {"reposicaoAuto":false}', 'transferencia desmontar', 'saga T1']);
  });

  it('desmontar com reposição ligada e versão velha recusa sem transferência', async () => {
    const { deps, log } = cenario({ soEmKit: true, reposicaoAuto: true });
    expect(await gerenciarKit(deps, { kitId: 'K1', acao: 'desmontar', versao: 1, itens: [{ codigo: 'KPB-G', quantidade: 1 }] }))
      .toMatchObject({ ok: false, motivo: 'versao' });
    expect(log.some((l) => l.startsWith('transferencia'))).toBe(false);
  });

  it('desmontar sem reposição não mexe na política', async () => {
    const { deps, log } = cenario();
    const r = await gerenciarKit(deps, { kitId: 'K1', acao: 'desmontar', itens: [{ codigo: 'KPB-G', quantidade: 1 }] });
    expect(r).toMatchObject({ ok: true, reposicaoDesligada: false, soEmKit: false });
    expect(log).toEqual(['transferencia desmontar', 'saga T1']);
  });

  it('transferência recusada (SKU ocupado) não enfileira a saga', async () => {
    const { deps, log } = cenario();
    deps.criarTransferencia = async () => ({ motivo: 'up_ocupado' });
    expect(await gerenciarKit(deps, { kitId: 'K1', acao: 'montar', itens: [{ codigo: 'KPB-M', quantidade: 1 }] }))
      .toMatchObject({ ok: false, motivo: 'up_ocupado' });
    expect(log).toEqual([]);
  });

  it('ação desconhecida recusa', async () => {
    const { deps } = cenario();
    expect(await gerenciarKit(deps, { kitId: 'K1', acao: 'apagar' as never, versao: 3 }))
      .toMatchObject({ ok: false, motivo: 'acao_invalida' });
  });
});
