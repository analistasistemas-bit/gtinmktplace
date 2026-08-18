import { describe, it, expect } from 'vitest';
import {
  perguntaPrecisaUpsert, claimPrecisaProcessar, GRACA_CLAIM_DIAS,
  type PerguntaLocal, type DevolucaoLocal,
} from '../reconciliar-filtros';
import { memoCatalogo } from '../io';

/**
 * O reconciliar-faturamento regravava TODA pergunta e TODO claim do vendedor a cada hora, mesmo
 * sem mudança: ~19 mil requisições PostgREST/dia para reescrever dado idêntico (~10 MB/dia de
 * egress; o projeto estourou os 5 GB do plano Free em 2026-08).
 *
 * Estes testes são a trava do lado perigoso: pular DEMAIS deixaria de gravar mudança real —
 * inclusive de estado financeiro (estorno via `return_status_money`). Cada caso de "pula" tem o
 * caso simétrico de "não pula".
 */

const ANSWERED: PerguntaLocal = {
  status: 'ANSWERED', resposta: 'chega em 3 dias', item_titulo: 'Creme X',
  comprador_id: 77, comprador_nick: 'FULANO',
};
const row = (over: Partial<{ status: string; resposta: string | null; comprador_id: number | null }> = {}) => ({
  status: 'ANSWERED', resposta: 'chega em 3 dias', comprador_id: 77, ...over,
});

describe('perguntaPrecisaUpsert', () => {
  it('pula quando o estado gravado já é idêntico ao do ML', () => {
    expect(perguntaPrecisaUpsert(row(), 'Creme X', ANSWERED)).toBe(false);
  });

  it('processa pergunta nunca vista', () => {
    expect(perguntaPrecisaUpsert(row(), 'Creme X', undefined)).toBe(true);
  });

  it('processa quando o status mudou (UNANSWERED → ANSWERED)', () => {
    expect(perguntaPrecisaUpsert(row(), 'Creme X', { ...ANSWERED, status: 'UNANSWERED' })).toBe(true);
  });

  it('processa quando a resposta mudou', () => {
    expect(perguntaPrecisaUpsert(row({ resposta: 'outro texto' }), 'Creme X', ANSWERED)).toBe(true);
  });

  it('processa quando o título do anúncio mudou', () => {
    expect(perguntaPrecisaUpsert(row(), 'Creme X 200ml', ANSWERED)).toBe(true);
  });

  // buscarTituloItem devolve null em erro; tratar isso como "mudou" faria o upsert gravar
  // item_titulo = null e APAGAR o título bom por causa de uma falha transitória do ML.
  it('NÃO processa por título ausente — falha do ML não pode apagar o título gravado', () => {
    expect(perguntaPrecisaUpsert(row(), null, ANSWERED)).toBe(false);
  });

  // O ML v4 parou de mandar `from.nickname`; o reconciliar é quem faz esse backfill.
  it('processa enquanto o nick do comprador estiver faltando e houver de quem buscar', () => {
    expect(perguntaPrecisaUpsert(row(), 'Creme X', { ...ANSWERED, comprador_nick: null })).toBe(true);
  });

  it('não processa por nick faltando quando não há comprador para resolver', () => {
    const semComprador = { ...ANSWERED, comprador_nick: null, comprador_id: null };
    expect(perguntaPrecisaUpsert(row({ comprador_id: null }), 'Creme X', semComprador)).toBe(false);
  });
});

const AGORA = Date.parse('2026-08-18T00:00:00.000Z');
const diasAtras = (d: number) => new Date(AGORA - d * 24 * 60 * 60 * 1000).toISOString();

const FECHADO_ANTIGO: DevolucaoLocal = {
  status: 'closed', stage: 'claim', aberto_em: diasAtras(60),
  fechado_em: diasAtras(30), return_status_money: 'refunded',
};

describe('claimPrecisaProcessar', () => {
  const claim = (over: Partial<{ status: string | null; stage: string | null }> = {}) =>
    ({ status: 'closed', stage: 'claim', ...over });

  it('pula claim fechado há muito tempo, com dinheiro resolvido e mesmo status/stage', () => {
    expect(claimPrecisaProcessar(claim(), FECHADO_ANTIGO, AGORA)).toBe(false);
  });

  it('processa claim novo (sem registro local)', () => {
    expect(claimPrecisaProcessar(claim(), undefined, AGORA)).toBe(true);
  });

  it('processa claim aberto, mesmo sem diferença de campo', () => {
    const aberto = { ...FECHADO_ANTIGO, status: 'opened', fechado_em: null };
    expect(claimPrecisaProcessar(claim({ status: 'opened' }), aberto, AGORA)).toBe(true);
  });

  it('processa quando o status mudou no ML', () => {
    expect(claimPrecisaProcessar(claim({ status: 'opened' }), FECHADO_ANTIGO, AGORA)).toBe(true);
  });

  it('processa quando o stage mudou no ML', () => {
    expect(claimPrecisaProcessar(claim({ stage: 'dispute' }), FECHADO_ANTIGO, AGORA)).toBe(true);
  });

  // return_status_money vem de GET /returns, NÃO do payload do claim: uma mudança ali é invisível
  // para as comparações de status/stage. Dinheiro em trânsito nunca pode ser pulado.
  it('processa enquanto o dinheiro do return não estiver em estado final', () => {
    const emTransito = { ...FECHADO_ANTIGO, return_status_money: 'pending' };
    expect(claimPrecisaProcessar(claim(), emTransito, AGORA)).toBe(true);
  });

  it('processa claim fechado dentro da janela de graça (dinheiro ainda pode se mexer)', () => {
    const recente = { ...FECHADO_ANTIGO, fechado_em: diasAtras(GRACA_CLAIM_DIAS - 1) };
    expect(claimPrecisaProcessar(claim(), recente, AGORA)).toBe(true);
  });

  it('pula claim fechado logo depois da janela de graça', () => {
    const foraDaGraca = { ...FECHADO_ANTIGO, fechado_em: diasAtras(GRACA_CLAIM_DIAS + 1) };
    expect(claimPrecisaProcessar(claim(), foraDaGraca, AGORA)).toBe(false);
  });

  it('processa quando não há data confiável de fechamento nem de abertura', () => {
    const semData = { ...FECHADO_ANTIGO, aberto_em: null, fechado_em: null };
    expect(claimPrecisaProcessar(claim(), semData, AGORA)).toBe(true);
  });

  it('cai para aberto_em quando fechado_em é nulo', () => {
    const semFecho = { ...FECHADO_ANTIGO, fechado_em: null, aberto_em: diasAtras(1) };
    expect(claimPrecisaProcessar(claim(), semFecho, AGORA)).toBe(true);
  });
});

/** Fake mínimo: conta quantas vezes cada tabela foi consultada. */
function criarAdminFake() {
  const acessos: string[] = [];
  function query(tabela: string) {
    acessos.push(tabela);
    const alvo = {
      select: () => alvo,
      not: () => alvo,
      eq: () => alvo,
      range: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () => Promise.resolve({ data: { org_id: 'org-1' }, error: null }),
    };
    return alvo;
  }
  return { acessos, from: (tabela: string) => query(tabela) };
}

describe('memoCatalogo', () => {
  it('carrega o catálogo uma única vez para o mesmo usuário na mesma invocação', async () => {
    const admin = criarAdminFake();
    const catalogoDe = memoCatalogo(admin as never);
    await catalogoDe('user-1');
    await catalogoDe('user-1');
    expect(admin.acessos.filter((t) => t === 'variacoes')).toHaveLength(1);
  });

  it('deduplica chamadas concorrentes (guarda a Promise, não o valor)', async () => {
    const admin = criarAdminFake();
    const catalogoDe = memoCatalogo(admin as never);
    await Promise.all([catalogoDe('user-1'), catalogoDe('user-1')]);
    expect(admin.acessos.filter((t) => t === 'variacoes')).toHaveLength(1);
  });

  it('não mistura catálogos de usuários diferentes', async () => {
    const admin = criarAdminFake();
    const catalogoDe = memoCatalogo(admin as never);
    await catalogoDe('user-1');
    await catalogoDe('user-2');
    expect(admin.acessos.filter((t) => t === 'variacoes')).toHaveLength(2);
  });
});
