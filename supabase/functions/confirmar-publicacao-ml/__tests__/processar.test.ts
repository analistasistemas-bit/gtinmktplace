import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processarConfirmacao, type DepsConfirmacao } from '../processar';

const VERSAO = '2026-11-05T12:00:00.000Z';
const JOB = { familia_id: 'fam-1', tentativa: 1, versao: VERSAO };

type Linha = Record<string, unknown>;
const linhaBase = (over: Linha = {}): Linha => ({
  id: 'c1', org_id: 'org-1', lote_id: 'lote-1', familia_id: 'fam-1', codigo_pai: '000', item_externo_id: 'MLB1',
  modelo: 'variacoes', enviado: { A: { qtd: 10, anterior: 4, variacao_id: '11' } },
  status: 'aguardando', tentativas: 0, enviado_em: VERSAO, ...over,
});

interface Consulta { tabela: string; op: string; payload?: Linha; filtros: Array<[string, string, unknown]> }

function fakeAdmin(o: {
  linhas?: Linha[]; claimErro?: boolean; maisNovas?: Linha[];
  movimentos?: Array<{ codigo: string; quantidade: number }>; movimentosErro?: boolean; nome?: string;
} = {}) {
  const consultas: Consulta[] = [];
  const resolver = (c: Consulta) => {
    if (c.tabela === 'confirmacoes_ml' && c.op === 'update' && c.payload && 'tentativas' in c.payload) {
      if (o.claimErro) return { data: null, error: { message: 'boom' } };
      const tentativas = c.filtros.find((f) => f[1] === 'tentativas')?.[2];
      return { data: (o.linhas ?? []).filter((l) => l.tentativas === tentativas), error: null };
    }
    if (c.tabela === 'confirmacoes_ml' && c.op === 'select') return { data: o.maisNovas ?? [], error: null };
    if (c.tabela === 'estoque_movimentos') {
      return o.movimentosErro ? { data: null, error: { message: 'boom' } } : { data: o.movimentos ?? [], error: null };
    }
    if (c.tabela === 'familias') return { data: { nome_pai: o.nome ?? 'Fita' }, error: null };
    return { data: null, error: null };
  };
  const from = (tabela: string) => {
    const c: Consulta = { tabela, op: 'select', filtros: [] };
    consultas.push(c);
    const filtro = (tipo: string) => (col: string, v: unknown) => { c.filtros.push([tipo, col, v]); return q; };
    const q: Record<string, unknown> = {
      select: () => q,
      update: (p: Linha) => { c.op = 'update'; c.payload = p; return q; },
      eq: filtro('eq'), neq: filtro('neq'), in: filtro('in'), gt: filtro('gt'), gte: filtro('gte'),
      maybeSingle: async () => resolver(c),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver(c)).then(ok, ko),
    };
    return q;
  };
  const escritas = () => consultas.filter((c) => c.op === 'update');
  // A primeira escrita é o claim; o desfecho vem depois dela.
  const desfechos = () => escritas().slice(1);
  return { admin: { from } as never, consultas, escritas, desfechos };
}

const lerOk = (qtd: number) => vi.fn(async (_t: string, ids: string[]) => Object.fromEntries(
  ids.map((id) => [id, { total: qtd, porVariacao: { 11: qtd } }]),
));

function deps(admin: never, over: Partial<DepsConfirmacao> = {}): DepsConfirmacao {
  return {
    admin,
    resolverConexao: vi.fn(async () => ({ id: 'cx' })) as never,
    getToken: vi.fn(async () => 'tok'),
    lerEstoqueItens: lerOk(10) as never,
    enfileirarConfirmacao: vi.fn(async () => 'msg'),
    notificarCategoria: vi.fn(async () => 1),
    agora: () => '2026-11-05T12:01:00.000Z',
    ...over,
  };
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('processarConfirmacao — claim (ADR-0195)', () => {
  it('claim pelos filtros da escrita e da leitura anterior', async () => {
    const f = fakeAdmin({ linhas: [linhaBase()] });
    await processarConfirmacao(deps(f.admin), JOB);
    const [claim] = f.escritas();
    expect(claim.tabela).toBe('confirmacoes_ml');
    expect(claim.payload).toEqual({ tentativas: 1 });
    expect(claim.filtros).toEqual(expect.arrayContaining([
      ['eq', 'familia_id', 'fam-1'], ['eq', 'enviado_em', VERSAO], ['eq', 'status', 'aguardando'], ['eq', 'tentativas', 0],
    ]));
  });

  it('zero linhas (reentrega, entrega dupla ou job antigo): sai sem ler, agendar nem notificar', async () => {
    const f = fakeAdmin({ linhas: [] });
    const d = deps(f.admin);
    const r = await processarConfirmacao(d, JOB);
    expect(r.status).toBe(200);
    expect(d.lerEstoqueItens).not.toHaveBeenCalled();
    expect(d.enfileirarConfirmacao).not.toHaveBeenCalled();
    expect(d.notificarCategoria).not.toHaveBeenCalled();
    expect(f.desfechos()).toEqual([]);
  });

  it('reentrega da tentativa 1 depois de fechada não reabre nem repete a notificação', async () => {
    const f = fakeAdmin({ linhas: [linhaBase({ tentativas: 1 })] });
    const d = deps(f.admin);
    await processarConfirmacao(d, JOB);
    expect(d.lerEstoqueItens).not.toHaveBeenCalled();
    expect(d.notificarCategoria).not.toHaveBeenCalled();
  });

  it('erro no claim devolve 500 para o QStash retentar, e nada foi consumido', async () => {
    const f = fakeAdmin({ claimErro: true });
    expect((await processarConfirmacao(deps(f.admin), JOB)).status).toBe(500);
  });
});

describe('processarConfirmacao — escrita mais nova (ADR-0195)', () => {
  it('outra família escreveu depois no mesmo item: fecha inconclusivo sem ler', async () => {
    const f = fakeAdmin({
      linhas: [linhaBase()],
      maisNovas: [{ item_externo_id: 'MLB1' }],
    });
    const d = deps(f.admin);
    await processarConfirmacao(d, JOB);
    expect(d.lerEstoqueItens).not.toHaveBeenCalled();
    expect(f.desfechos()[0].payload).toMatchObject({ status: 'inconclusivo', verificado_em: '2026-11-05T12:01:00.000Z' });
    const busca = f.consultas.find((c) => c.tabela === 'confirmacoes_ml' && c.op === 'select')!;
    expect(busca.filtros).toEqual(expect.arrayContaining([
      ['eq', 'org_id', 'org-1'], ['in', 'item_externo_id', ['MLB1']], ['neq', 'familia_id', 'fam-1'], ['gt', 'enviado_em', VERSAO],
    ]));
  });

  it('só o item afetado fecha; o outro da família segue a leitura', async () => {
    const f = fakeAdmin({
      linhas: [linhaBase(), linhaBase({ id: 'c2', item_externo_id: 'MLB2' })],
      maisNovas: [{ item_externo_id: 'MLB1' }],
    });
    const d = deps(f.admin);
    await processarConfirmacao(d, JOB);
    expect((d.lerEstoqueItens as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual(['MLB2']);
    expect(f.desfechos().map((c) => c.payload?.status)).toEqual(['inconclusivo', 'confirmado']);
  });
});

describe('processarConfirmacao — veredito (ADR-0195)', () => {
  it('igual ao enviado: confirmado com verificado_em e observado', async () => {
    const f = fakeAdmin({ linhas: [linhaBase()] });
    const d = deps(f.admin);
    await processarConfirmacao(d, JOB);
    expect(f.desfechos()[0].payload).toEqual({
      status: 'confirmado', observado: { A: 10 }, divergentes: [], verificado_em: '2026-11-05T12:01:00.000Z',
    });
    expect(f.desfechos()[0].filtros).toEqual(expect.arrayContaining([
      ['eq', 'id', 'c1'], ['eq', 'enviado_em', VERSAO], ['eq', 'status', 'aguardando'],
    ]));
    expect(d.enfileirarConfirmacao).not.toHaveBeenCalled();
    expect(d.notificarCategoria).not.toHaveBeenCalled();
  });

  it('modelo item lê o total; UP não tem variação', async () => {
    const f = fakeAdmin({ linhas: [linhaBase({ modelo: 'item', enviado: { A: { qtd: 7, anterior: null, variacao_id: null } } })] });
    const d = deps(f.admin, { lerEstoqueItens: vi.fn(async () => ({ MLB1: { total: 7, porVariacao: {} } })) as never });
    await processarConfirmacao(d, JOB);
    expect(f.desfechos()[0].payload).toMatchObject({ status: 'confirmado', observado: { A: 7 } });
  });

  it('divergente na tentativa 1: continua aguardando e agenda a 2ª leitura em 180 s', async () => {
    const f = fakeAdmin({ linhas: [linhaBase()] });
    const d = deps(f.admin, { lerEstoqueItens: lerOk(7) as never });
    await processarConfirmacao(d, JOB);
    expect(f.desfechos()).toEqual([]);
    expect(f.escritas()[0].payload).toEqual({ tentativas: 1 });
    expect(d.enfileirarConfirmacao).toHaveBeenCalledWith({ familia_id: 'fam-1', tentativa: 2, versao: VERSAO }, 180);
  });

  it('um job por família: dois itens divergentes agendam uma releitura', async () => {
    const f = fakeAdmin({ linhas: [linhaBase(), linhaBase({ id: 'c2', item_externo_id: 'MLB2' })] });
    const d = deps(f.admin, { lerEstoqueItens: lerOk(7) as never });
    await processarConfirmacao(d, JOB);
    expect(d.enfileirarConfirmacao).toHaveBeenCalledTimes(1);
  });

  it('falha ao agendar a releitura fecha inconclusivo, sem deixar a linha presa', async () => {
    const f = fakeAdmin({ linhas: [linhaBase()] });
    const d = deps(f.admin, {
      lerEstoqueItens: lerOk(7) as never,
      enfileirarConfirmacao: vi.fn(async () => { throw new Error('qstash fora'); }),
    });
    const r = await processarConfirmacao(d, JOB);
    expect(r.status).toBe(200);
    expect(f.desfechos()[0].payload).toMatchObject({ status: 'inconclusivo' });
  });

  it('divergente na 3: falhou, grava divergentes e avisa com chave', async () => {
    const f = fakeAdmin({ linhas: [linhaBase({ tentativas: 2 })] });
    const d = deps(f.admin, { lerEstoqueItens: lerOk(7) as never });
    await processarConfirmacao(d, { ...JOB, tentativa: 3 });
    expect(f.desfechos()[0].payload).toMatchObject({
      status: 'falhou', observado: { A: 7 }, divergentes: [{ sku: 'A', enviado: 10, observado: 7 }],
    });
    expect(d.notificarCategoria).toHaveBeenCalledTimes(1);
    expect(d.notificarCategoria).toHaveBeenCalledWith(
      f.admin, 'org-1', 'estoque', expect.stringContaining('Fita'), { chave: `confirmacao-falhou:fam-1:${VERSAO}` },
    );
  });

  it('falha ao notificar não muda o desfecho', async () => {
    const f = fakeAdmin({ linhas: [linhaBase({ tentativas: 2 })] });
    const d = deps(f.admin, {
      lerEstoqueItens: lerOk(7) as never,
      notificarCategoria: vi.fn(async () => { throw new Error('telegram'); }),
    });
    expect((await processarConfirmacao(d, { ...JOB, tentativa: 3 })).status).toBe(200);
  });

  it('429 na 3: inconclusivo, sem notificação', async () => {
    const f = fakeAdmin({ linhas: [linhaBase({ tentativas: 2 })] });
    const d = deps(f.admin, { lerEstoqueItens: vi.fn(async () => ({ MLB1: 'erro' as const })) as never });
    await processarConfirmacao(d, { ...JOB, tentativa: 3 });
    expect(f.desfechos()[0].payload).toMatchObject({ status: 'inconclusivo' });
    expect(d.notificarCategoria).not.toHaveBeenCalled();
  });

  it('leitura falhou na tentativa 1: relê', async () => {
    const f = fakeAdmin({ linhas: [linhaBase()] });
    const d = deps(f.admin, { lerEstoqueItens: vi.fn(async () => ({ MLB1: 'erro' as const })) as never });
    await processarConfirmacao(d, JOB);
    expect(d.enfileirarConfirmacao).toHaveBeenCalledWith({ familia_id: 'fam-1', tentativa: 2, versao: VERSAO }, 180);
  });

  it('sem conexão, token inválido ou ledger fora: leitura falhou, não veredito', async () => {
    for (const over of [
      { resolverConexao: vi.fn(async () => null) as never },
      { getToken: vi.fn(async () => { throw new Error('token'); }) },
    ] as Array<Partial<DepsConfirmacao>>) {
      const f = fakeAdmin({ linhas: [linhaBase({ tentativas: 2 })] });
      await processarConfirmacao(deps(f.admin, over), { ...JOB, tentativa: 3 });
      expect(f.desfechos()[0].payload).toMatchObject({ status: 'inconclusivo' });
    }
    const f = fakeAdmin({ linhas: [linhaBase({ tentativas: 2 })], movimentosErro: true });
    const d = deps(f.admin, { lerEstoqueItens: lerOk(7) as never });
    await processarConfirmacao(d, { ...JOB, tentativa: 3 });
    expect(f.desfechos()[0].payload).toMatchObject({ status: 'inconclusivo' });
    expect(d.notificarCategoria).not.toHaveBeenCalled();
  });

  it('movimentos somam por SKU, da org, a partir de enviado_em menos 5 min', async () => {
    const f = fakeAdmin({
      linhas: [linhaBase()],
      movimentos: [{ codigo: 'A', quantidade: -1 }, { codigo: 'A', quantidade: -2 }],
    });
    await processarConfirmacao(deps(f.admin, { lerEstoqueItens: lerOk(7) as never }), JOB);
    expect(f.desfechos()[0].payload).toMatchObject({ status: 'confirmado' });
    const mov = f.consultas.find((c) => c.tabela === 'estoque_movimentos')!;
    expect(mov.filtros).toEqual(expect.arrayContaining([
      ['eq', 'org_id', 'org-1'], ['in', 'codigo', ['A']], ['gte', 'criado_em', '2026-11-05T11:55:00.000Z'],
    ]));
  });

  it('divergência com movimento na 3: inconclusivo, sem notificação', async () => {
    const f = fakeAdmin({ linhas: [linhaBase({ tentativas: 2 })], movimentos: [{ codigo: 'A', quantidade: -1 }] });
    const d = deps(f.admin, { lerEstoqueItens: lerOk(7) as never });
    await processarConfirmacao(d, { ...JOB, tentativa: 3 });
    expect(f.desfechos()[0].payload).toMatchObject({ status: 'inconclusivo' });
    expect(d.notificarCategoria).not.toHaveBeenCalled();
  });

  it('escrita não aplicada na 3: falhou mesmo com movimento', async () => {
    const f = fakeAdmin({
      linhas: [linhaBase({ tentativas: 2, enviado: { A: { qtd: 10, anterior: 15, variacao_id: '11' } } })],
      movimentos: [{ codigo: 'A', quantidade: 3 }],
    });
    const d = deps(f.admin, { lerEstoqueItens: lerOk(15) as never });
    await processarConfirmacao(d, { ...JOB, tentativa: 3 });
    expect(f.desfechos()[0].payload).toMatchObject({ status: 'falhou' });
    expect(d.notificarCategoria).toHaveBeenCalledTimes(1);
  });

  it('venda no ML depois do PUT aplicado, voltando ao saldo anterior: confirmado', async () => {
    const f = fakeAdmin({
      linhas: [linhaBase({ enviado: { A: { qtd: 10, anterior: 8, variacao_id: '11' } } })],
      movimentos: [{ codigo: 'A', quantidade: -2, motivo: 'venda', canal_origem: 'mercado_livre' }],
    });
    const d = deps(f.admin, { lerEstoqueItens: lerOk(8) as never });
    await processarConfirmacao(d, JOB);
    expect(f.desfechos()[0].payload).toMatchObject({ status: 'confirmado' });
  });

  it('só toca em confirmacoes_ml: nenhuma escrita em outra tabela, nenhum conector nas dependências', async () => {
    const f = fakeAdmin({ linhas: [linhaBase({ tentativas: 2 })] });
    const d = deps(f.admin, { lerEstoqueItens: lerOk(7) as never });
    await processarConfirmacao(d, { ...JOB, tentativa: 3 });
    expect(f.escritas().every((c) => c.tabela === 'confirmacoes_ml')).toBe(true);
    expect(Object.keys(d).some((k) => /conn|conector|atualizar/i.test(k))).toBe(false);
  });
});
