import { describe, it, expect } from 'vitest';
import { removerComposicaoUP, type PortasRemocao } from '../remover-composicao';
import type { FilhoComp, ConfirmacaoComp } from '../atualizar-composicao';

function fakePortas(over: Partial<PortasRemocao> = {}): PortasRemocao & { pausados: string[]; statusSalvo: Record<string, string> } {
  const pausados: string[] = [];
  const statusSalvo: Record<string, string> = {};
  return {
    pausados,
    statusSalvo,
    pausar: async (itemExternoId: string) => { pausados.push(itemExternoId); },
    confirmar: async (): Promise<ConfirmacaoComp> => ({ ok: true, status: 'paused' }),
    salvarStatus: async (sku: string, status: string) => { statusSalvo[sku] = status; },
    ...over,
  };
}

const FILHO = (over: Partial<FilhoComp> = {}): FilhoComp => ({
  sku: 'A', status: 'ativo', retirado: false, itemExternoId: 'MLB1', familyId: 'F', ...over,
});

describe('removerComposicaoUP — mini-saga de remoção (ADR-0088: pausar TODOS, depois deletar)', () => {
  it('todos os filhos confirmam pausado → pronto_para_deletar', async () => {
    const portas = fakePortas();
    const r = await removerComposicaoUP(portas, [FILHO({ sku: 'A' }), FILHO({ sku: 'B', itemExternoId: 'MLB2' })]);
    expect(r).toEqual({ tipo: 'pronto_para_deletar' });
    expect(portas.pausados).toEqual(['MLB1', 'MLB2']);
  });

  it('lista vazia (ou todos já retirados) → pronto_para_deletar vacuamente, sem pausar nada', async () => {
    const portas = fakePortas();
    const r = await removerComposicaoUP(portas, []);
    expect(r).toEqual({ tipo: 'pronto_para_deletar' });
    expect(portas.pausados).toEqual([]);
  });

  // Revisão Codex (round 2): confiar em retirado=true sem reconfirmar tinha um furo real — um
  // crash no readd da composição (entre ativar() remoto ter sucesso e marcarAtivo() local, que só
  // então limpa retirado) deixa a linha retirado=true LOCALMENTE mas ATIVA de verdade no ML, e o
  // catch genérico do adapter (atualizar-familia-up.ts) limpa mudando_composicao mesmo em falha
  // transitória — o gate de mudando_composicao em processar.ts não pega essa janela sozinho.
  // Fix: nunca confiar em retirado=true sem reconfirmar — pausar+confirmar TODO filho com
  // itemExternoId, retirado ou não (a remoção verifica a REALIDADE do ML, não um flag local).
  it('filho retirado=true COM itemExternoId AINDA é pausado+confirmado (nunca confia no tombstone sem reconfirmar)', async () => {
    const portas = fakePortas();
    const r = await removerComposicaoUP(portas, [FILHO({ sku: 'A', retirado: true, itemExternoId: 'MLB1' })]);
    expect(r).toEqual({ tipo: 'pronto_para_deletar' });
    expect(portas.pausados).toEqual(['MLB1']); // reconfirmado, não pulado
  });

  it('filho retirado=true cujo GET revela ATIVO de verdade (crash entre ativar() e marcarAtivo()) → pendente, nunca deleta', async () => {
    const portas = fakePortas({
      confirmar: async (): Promise<ConfirmacaoComp> => ({ ok: true, status: 'active' }), // ativo de verdade!
    });
    const r = await removerComposicaoUP(portas, [FILHO({ sku: 'A', retirado: true, itemExternoId: 'MLB1' })]);
    expect(r).toEqual({ tipo: 'incompleto', pendentes: ['A'] });
  });

  // Corolário do fix acima: reconfirmar retirados quebraria pra sempre um tombstone cujo item foi
  // apagado independentemente no ML (delete manual, purga) — pausar() dá 404 e sem tratamento
  // especial isso viraria `remocao_pendente` permanente (nenhum retry resolveria, item nunca volta).
  // 404/410 = item genuinamente sumido = seguro pra remoção local prosseguir.
  it('filho retirado=true cujo item SUMIU no ML (404) → tratado como seguro, NÃO pendente (senão nunca converge)', async () => {
    const erro404 = Object.assign(new Error('não encontrado'), { status: 404 });
    const portas = fakePortas({
      pausar: async () => { throw erro404; },
    });
    const r = await removerComposicaoUP(portas, [FILHO({ sku: 'A', retirado: true, itemExternoId: 'MLB1' })]);
    expect(r).toEqual({ tipo: 'pronto_para_deletar' });
  });

  it('filho NÃO-retirado cujo item SUMIU no ML (410) → também tratado como seguro', async () => {
    const erro410 = Object.assign(new Error('gone'), { status: 410 });
    const portas = fakePortas({
      pausar: async () => { throw erro410; },
    });
    const r = await removerComposicaoUP(portas, [FILHO({ sku: 'A', itemExternoId: 'MLB1' })]);
    expect(r).toEqual({ tipo: 'pronto_para_deletar' });
  });

  it('erro de rede genérico (sem status, ou 5xx) continua virando pendente — só 404/410 é seguro', async () => {
    const erro500 = Object.assign(new Error('instabilidade'), { status: 500 });
    const portas = fakePortas({ pausar: async () => { throw erro500; } });
    const r = await removerComposicaoUP(portas, [FILHO({ sku: 'A', itemExternoId: 'MLB1' })]);
    expect(r).toEqual({ tipo: 'incompleto', pendentes: ['A'] });
  });

  // Revisão Codex (round 2), ponto B: criacao_incerta+itemExternoId=null é o ÚNICO estado
  // null-id perigoso (salvarCriado grava status='criado'+id JUNTOS na composição — todo outro
  // status sem id é genuinamente pré-POST). Um POST pode ter sido aceito no ML sem o id ter sido
  // salvo localmente (resposta perdida/timeout). Nunca trivialmente "ok, pula" — bloqueia a
  // remoção até a PRÓPRIA saga de composição (buscarPorSku) adotar o órfão num retry futuro.
  it('filho criacao_incerta SEM itemExternoId → NUNCA trivialmente ok, vira pendente (pode ter POST real no ML sem id salvo)', async () => {
    const portas = fakePortas();
    const r = await removerComposicaoUP(portas, [FILHO({ sku: 'A', status: 'criacao_incerta', itemExternoId: null })]);
    expect(r).toEqual({ tipo: 'incompleto', pendentes: ['A'] });
  });

  it('criacao_incerta pendente NÃO reescreve o status local (preserva pra saga de composição poder adotar o órfão depois)', async () => {
    const portas = fakePortas();
    await removerComposicaoUP(portas, [FILHO({ sku: 'A', status: 'criacao_incerta', itemExternoId: null })]);
    expect(portas.statusSalvo).toEqual({}); // NÃO marcado remocao_pendente — isso bloquearia a adoção
  });

  it('filho pendente (nunca tentou POST) SEM itemExternoId continua trivialmente ok — só criacao_incerta é perigoso', async () => {
    const portas = fakePortas();
    const r = await removerComposicaoUP(portas, [FILHO({ sku: 'A', status: 'pendente', itemExternoId: null })]);
    expect(r).toEqual({ tipo: 'pronto_para_deletar' });
    expect(portas.pausados).toEqual([]);
  });

  it('filho sem itemExternoId (nunca subiu no ML) conta como trivialmente ok', async () => {
    const portas = fakePortas();
    const r = await removerComposicaoUP(portas, [FILHO({ sku: 'A', itemExternoId: null })]);
    expect(r).toEqual({ tipo: 'pronto_para_deletar' });
    expect(portas.pausados).toEqual([]);
  });

  it('TRY-ALL (não fail-fast): tenta pausar TODOS os filhos mesmo se um deles não confirmar — operador é o loop de retry, cada clique deve maximizar progresso', async () => {
    const portas = fakePortas({
      confirmar: async (itemExternoId: string): Promise<ConfirmacaoComp> =>
        itemExternoId === 'MLB2' ? { ok: false, status: 'active' } : { ok: true, status: 'paused' },
    });
    const r = await removerComposicaoUP(portas, [
      FILHO({ sku: 'A', itemExternoId: 'MLB1' }),
      FILHO({ sku: 'B', itemExternoId: 'MLB2' }),
      FILHO({ sku: 'C', itemExternoId: 'MLB3' }),
    ]);
    expect(portas.pausados).toEqual(['MLB1', 'MLB2', 'MLB3']); // os 3 foram tentados, não só até o 1º falho
    expect(r).toEqual({ tipo: 'incompleto', pendentes: ['B'] });
  });

  it('filho não confirma (GET falhou/transiente) → marca remocao_pendente SÓ nesse filho, incompleto', async () => {
    const portas = fakePortas({
      confirmar: async (): Promise<ConfirmacaoComp> => ({ ok: false, status: null }),
    });
    const r = await removerComposicaoUP(portas, [FILHO({ sku: 'A', itemExternoId: 'MLB1' })]);
    expect(r).toEqual({ tipo: 'incompleto', pendentes: ['A'] });
    expect(portas.statusSalvo).toEqual({ A: 'remocao_pendente' });
  });

  it('status confirmado não é "paused" (ainda active) → pendente/incompleto', async () => {
    const portas = fakePortas({
      confirmar: async (): Promise<ConfirmacaoComp> => ({ ok: true, status: 'active' }),
    });
    const r = await removerComposicaoUP(portas, [FILHO({ sku: 'A', itemExternoId: 'MLB1' })]);
    expect(r).toEqual({ tipo: 'incompleto', pendentes: ['A'] });
  });

  it('múltiplos filhos pausados-OK não são marcados remocao_pendente (só os que falharam)', async () => {
    const portas = fakePortas({
      confirmar: async (itemExternoId: string): Promise<ConfirmacaoComp> =>
        itemExternoId === 'MLB2' ? { ok: false, status: null } : { ok: true, status: 'paused' },
    });
    await removerComposicaoUP(portas, [
      FILHO({ sku: 'A', itemExternoId: 'MLB1' }),
      FILHO({ sku: 'B', itemExternoId: 'MLB2' }),
    ]);
    expect(portas.statusSalvo).toEqual({ B: 'remocao_pendente' }); // só B, não A
  });

  it('item errado (seller divergente, inesperado=true) também conta como pendente, nunca deleta', async () => {
    const portas = fakePortas({
      confirmar: async (): Promise<ConfirmacaoComp> => ({ ok: false, status: 'active', inesperado: true }),
    });
    const r = await removerComposicaoUP(portas, [FILHO({ sku: 'A', itemExternoId: 'MLB1' })]);
    expect(r).toEqual({ tipo: 'incompleto', pendentes: ['A'] });
    expect(portas.statusSalvo).toEqual({ A: 'remocao_pendente' });
  });

  it('TRY-ALL sobrevive a EXCEÇÃO (não só "não confirmou"): pausar() rejeitando no meio não para o loop (revisão Codex — atualizarStatusML lança em qualquer HTTP não-2xx)', async () => {
    const portas = fakePortas({
      pausar: async (itemExternoId: string) => {
        if (itemExternoId === 'MLB2') throw new Error('rede instável');
      },
    });
    const r = await removerComposicaoUP(portas, [
      FILHO({ sku: 'A', itemExternoId: 'MLB1' }),
      FILHO({ sku: 'B', itemExternoId: 'MLB2' }),
      FILHO({ sku: 'C', itemExternoId: 'MLB3' }),
    ]);
    expect(r).toEqual({ tipo: 'incompleto', pendentes: ['B'] });
    expect(portas.statusSalvo).toEqual({ B: 'remocao_pendente' });
  });

  it('TRY-ALL sobrevive a EXCEÇÃO no confirmar() também', async () => {
    const portas = fakePortas({
      confirmar: async (itemExternoId: string): Promise<ConfirmacaoComp> => {
        if (itemExternoId === 'MLB1') throw new Error('timeout');
        return { ok: true, status: 'paused' };
      },
    });
    const r = await removerComposicaoUP(portas, [
      FILHO({ sku: 'A', itemExternoId: 'MLB1' }),
      FILHO({ sku: 'B', itemExternoId: 'MLB2' }),
    ]);
    expect(portas.pausados).toEqual(['MLB1', 'MLB2']); // B foi tentado mesmo com A explodindo antes
    expect(r).toEqual({ tipo: 'incompleto', pendentes: ['A'] });
  });

  it('sempre confirma por GET mesmo se o status LOCAL já for pausado — nunca confia sem confirmar (anti "disparei PUT, logo pausou")', async () => {
    let confirmarChamado = 0;
    const portas = fakePortas({
      confirmar: async (): Promise<ConfirmacaoComp> => { confirmarChamado++; return { ok: true, status: 'paused' }; },
    });
    await removerComposicaoUP(portas, [FILHO({ sku: 'A', itemExternoId: 'MLB1', status: 'pausado' })]);
    expect(confirmarChamado).toBe(1); // confirmou de novo, não pulou por já estar 'pausado' localmente
  });
});
