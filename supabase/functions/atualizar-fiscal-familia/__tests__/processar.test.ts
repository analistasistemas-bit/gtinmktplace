import { describe, it, expect, vi } from 'vitest';
import { processarAtualizacaoFiscal, validarShapeEntrada, type DepsAtualizarFiscal, type EntradaFiscal } from '../processar';

// ── Fake admin: familias/empresa_fiscal (padrão igual ao de publish-familia-ml). ──
function fakeAdmin(over: {
  familia?: Record<string, unknown> | null; regime?: string;
  erros?: { familias?: string; empresa_fiscal?: string; update?: string; publicadas?: string };
  // C3: versões publicadas do produto (select de ids no then). Default = a própria família, se publicada.
  publicadas?: string[];
  // ncm_consultar: default = todo código vigente; 'vencido'/'inexistente'/'erro' forçam o caso.
  ncm?: 'vigente' | 'vencido' | 'inexistente' | 'erro';
} = {}) {
  const rpcs: string[] = [];
  const writes: Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const reads: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const familia = over.familia === undefined ? { ...FAMILIA_BASE } : over.familia;
  const regime = over.regime ?? 'simples';
  const erros = over.erros ?? {};
  const publicadas = over.publicadas
    ?? (familia && (familia as { status?: string }).status === 'publicado' ? [(familia as { id: string }).id] : []);
  function chain(table: string) {
    const rec = { op: '', payload: {} as Record<string, unknown>, filters: {} as Record<string, unknown> };
    const ler = () => {
      if (table === 'familias') return familia;
      if (table === 'empresa_fiscal') return { regime_tributario: regime };
      return null;
    };
    const erroDeLeitura = () => {
      if (table === 'familias') return erros.familias ? { message: erros.familias } : null;
      if (table === 'empresa_fiscal') return erros.empresa_fiscal ? { message: erros.empresa_fiscal } : null;
      return null;
    };
    const api: Record<string, unknown> = {
      select: () => { rec.op = rec.op || 'select'; return api; },
      eq: (col: string, val: unknown) => { rec.filters[col] = val; return api; },
      update: (payload: Record<string, unknown>) => { rec.op = 'update'; rec.payload = payload; return api; },
      maybeSingle: async () => {
        reads.push({ table, filters: rec.filters });
        return { data: erroDeLeitura() ? null : ler(), error: erroDeLeitura() };
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (rec.op === 'update') {
          writes.push({ table, payload: rec.payload, filters: rec.filters });
          const err = erros.update ? { message: erros.update } : null;
          return Promise.resolve({ data: null, error: err }).then(resolve);
        }
        reads.push({ table, filters: rec.filters });
        if (table === 'familias') {
          const err = erros.publicadas ? { message: erros.publicadas } : null;
          return Promise.resolve({ data: err ? null : publicadas.map((id) => ({ id })), error: err }).then(resolve);
        }
        return Promise.resolve({ data: ler(), error: erroDeLeitura() }).then(resolve);
      },
    };
    return api;
  }
  const rpc = async (fn: string, args: { p_codigos: string[] }) => {
    rpcs.push(fn);
    const modo = over.ncm ?? 'vigente';
    if (modo === 'erro') return { data: null, error: { message: 'rpc fora do ar' } };
    if (modo === 'inexistente') return { data: [], error: null };
    return { data: args.p_codigos.map((codigo) => ({ codigo, vigente: modo === 'vigente' })), error: null };
  };
  return { admin: { from: chain, rpc } as never, writes, reads, rpcs };
}

const FAMILIA_BASE = {
  id: 'fam-1', org_id: 'org-1', codigo_pai: 'PAI-1', nome_pai: 'AGULHA', unidade: 'UN', origem: 'nacional',
  ml_item_id: 'MLB123', status: 'publicado',
};

const FISCAL_OK: EntradaFiscal['fiscal'] = {
  ncm: '39269090', cest: null, origemNfe: 0, fci: null, exTipi: null, tributacaoIcms: '102',
};

function deps(admin: DepsAtualizarFiscal['admin'], enfileirarPush?: DepsAtualizarFiscal['enfileirarPush']): DepsAtualizarFiscal {
  return { admin, orgId: 'org-1', enfileirarPush: enfileirarPush ?? vi.fn(async () => 'msg-1') };
}

describe('processarAtualizacaoFiscal', () => {
  it('grava o fiscal em TODAS as versões do produto (org_id + codigo_pai), não só na editada', async () => {
    const { admin, writes } = fakeAdmin();
    const r = await processarAtualizacaoFiscal(deps(admin), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r.tipo).toBe('ok');
    expect(writes).toHaveLength(1);
    expect(writes[0].filters).toEqual({ org_id: 'org-1', codigo_pai: 'PAI-1' });
  });

  it('família de outra org (ou inexistente) → nao_encontrada, filtrando por org_id', async () => {
    const { admin, writes, reads } = fakeAdmin({ familia: null });
    const r = await processarAtualizacaoFiscal(deps(admin), { familiaId: 'fam-x', fiscal: FISCAL_OK });
    expect(r.tipo).toBe('nao_encontrada');
    expect(writes.length).toBe(0);
    expect(reads[0]).toEqual({ table: 'familias', filters: { id: 'fam-x', org_id: 'org-1' } });
  });

  it('fiscal incompleto → invalido com lista de erros, nada gravado', async () => {
    const { admin, writes } = fakeAdmin();
    const r = await processarAtualizacaoFiscal(deps(admin), {
      familiaId: 'fam-1', fiscal: { ...FISCAL_OK, ncm: '123' },
    });
    expect(r.tipo).toBe('invalido');
    if (r.tipo === 'invalido') expect(r.erros.length).toBeGreaterThan(0);
    expect(writes.length).toBe(0);
  });

  it('fiscal completo + família publicada (Legacy, com ml_item_id) → grava com regime da org e enfileira o push', async () => {
    const { admin, writes } = fakeAdmin({ regime: 'simples' });
    const enfileirarPush = vi.fn(async () => 'msg-1');
    const r = await processarAtualizacaoFiscal(deps(admin, enfileirarPush), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'ok', pushEnfileirado: true });
    expect(writes.length).toBe(1);
    expect(writes[0].payload.tributacao_icms_regime).toBe('simples');
    expect(writes[0].payload.ncm).toBe('39269090');
    // C4: edição fiscal invalida o push anterior — o novo push (ou a recuperação) conclui de novo.
    expect(writes[0].payload).toHaveProperty('fiscal_sincronizado_em', null);
    expect(enfileirarPush).toHaveBeenCalledWith('fam-1');
  });

  // Discrimina o gate de `status === 'publicado'` (pós-T7) do gate de `ml_item_id` do brief:
  // publicação via UP marca `status='publicado'` sem necessariamente preencher `ml_item_id` na
  // família (publicar-familia-up.ts). Sob `if (familia.ml_item_id)` este caso NÃO enfileiraria.
  it('publicada via UP (status publicado, sem ml_item_id) → enfileira mesmo assim', async () => {
    const { admin } = fakeAdmin({ familia: { ...FAMILIA_BASE, ml_item_id: null, status: 'publicado' } });
    const enfileirarPush = vi.fn(async () => 'msg-1');
    const r = await processarAtualizacaoFiscal(deps(admin, enfileirarPush), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'ok', pushEnfileirado: true });
    expect(enfileirarPush).toHaveBeenCalledWith('fam-1');
  });

  it('família não publicada → grava mas não enfileira', async () => {
    const { admin, writes } = fakeAdmin({ familia: { ...FAMILIA_BASE, status: 'pronto', ml_item_id: null } });
    const enfileirarPush = vi.fn(async () => 'msg-1');
    const r = await processarAtualizacaoFiscal(deps(admin, enfileirarPush), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'ok', pushEnfileirado: false });
    expect(writes.length).toBe(1);
    expect(enfileirarPush).not.toHaveBeenCalled();
  });

  // C3 (auditoria fiscal 19/10): a edição grava TODAS as versões; o push vale pra todas as publicadas.
  it('versão editada pronto + versão antiga publicado → enfileira o id da antiga', async () => {
    const { admin } = fakeAdmin({ familia: { ...FAMILIA_BASE, status: 'pronto' }, publicadas: ['fam-antiga'] });
    const enfileirarPush = vi.fn(async () => 'msg-1');
    const r = await processarAtualizacaoFiscal(deps(admin, enfileirarPush), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'ok', pushEnfileirado: true });
    expect(enfileirarPush).toHaveBeenCalledTimes(1);
    expect(enfileirarPush).toHaveBeenCalledWith('fam-antiga');
  });

  it('duas versões publicadas → enfileira as duas', async () => {
    const { admin } = fakeAdmin({ publicadas: ['fam-a', 'fam-b'] });
    const enfileirarPush = vi.fn(async () => 'msg-1');
    const r = await processarAtualizacaoFiscal(deps(admin, enfileirarPush), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'ok', pushEnfileirado: true });
    expect(enfileirarPush.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['fam-a', 'fam-b']);
  });

  it('nenhuma versão publicada → não enfileira, pushEnfileirado=false', async () => {
    const { admin } = fakeAdmin({ publicadas: [] });
    const enfileirarPush = vi.fn(async () => 'msg-1');
    const r = await processarAtualizacaoFiscal(deps(admin, enfileirarPush), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'ok', pushEnfileirado: false });
    expect(enfileirarPush).not.toHaveBeenCalled();
  });

  it('erro ao listar versões publicadas → ok com pushEnfileirado=false (UPDATE já gravou)', async () => {
    const { admin, writes } = fakeAdmin({ erros: { publicadas: 'timeout' } });
    const enfileirarPush = vi.fn(async () => 'msg-1');
    const r = await processarAtualizacaoFiscal(deps(admin, enfileirarPush), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'ok', pushEnfileirado: false });
    expect(writes).toHaveLength(1);
    expect(enfileirarPush).not.toHaveBeenCalled();
  });

  it('uma das N falha ao enfileirar → pushEnfileirado=false (tenta todas)', async () => {
    const { admin } = fakeAdmin({ publicadas: ['fam-a', 'fam-b'] });
    const enfileirarPush = vi.fn(async (id: string) => { if (id === 'fam-a') throw new Error('qstash'); return 'msg-1'; });
    const r = await processarAtualizacaoFiscal(deps(admin, enfileirarPush), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'ok', pushEnfileirado: false });
    expect(enfileirarPush).toHaveBeenCalledTimes(2);
  });

  it('erro lendo familias → falha, nunca 404 (leitura com erro não é decisão)', async () => {
    const { admin, writes } = fakeAdmin({ erros: { familias: 'timeout' } });
    const r = await processarAtualizacaoFiscal(deps(admin), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'falha', mensagem: 'timeout' });
    expect(writes.length).toBe(0);
  });

  it('erro lendo empresa_fiscal → falha, nunca default de regime "simples" em silêncio', async () => {
    const { admin, writes } = fakeAdmin({ erros: { empresa_fiscal: 'timeout' } });
    const r = await processarAtualizacaoFiscal(deps(admin), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'falha', mensagem: 'timeout' });
    expect(writes.length).toBe(0);
  });

  it('NCM fora da tabela oficial (ADR-0187) → invalido com a copy, zero update e zero enqueue', async () => {
    const { admin, writes } = fakeAdmin({ ncm: 'inexistente' });
    const enfileirarPush = vi.fn(async () => 'msg-1');
    const r = await processarAtualizacaoFiscal(deps(admin, enfileirarPush), {
      familiaId: 'fam-1', fiscal: { ...FISCAL_OK, ncm: '75937727' },
    });
    expect(r).toEqual({ tipo: 'invalido', erros: ['NCM 75937727 não existe na tabela oficial'] });
    expect(writes.length).toBe(0);
    expect(enfileirarPush).not.toHaveBeenCalled();
  });

  it('NCM vencido → invalido "não está mais vigente", zero update', async () => {
    const { admin, writes } = fakeAdmin({ ncm: 'vencido' });
    const r = await processarAtualizacaoFiscal(deps(admin), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'invalido', erros: ['NCM 39269090 não está mais vigente'] });
    expect(writes.length).toBe(0);
  });

  it('erro lendo ncm_consultar → falha (fail-closed), zero update e zero enqueue', async () => {
    const { admin, writes } = fakeAdmin({ ncm: 'erro' });
    const enfileirarPush = vi.fn(async () => 'msg-1');
    const r = await processarAtualizacaoFiscal(deps(admin, enfileirarPush), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r.tipo).toBe('falha');
    expect(writes.length).toBe(0);
    expect(enfileirarPush).not.toHaveBeenCalled();
  });

  it('erro no update → falha (não "invalido" com mensagem crua de banco)', async () => {
    const { admin } = fakeAdmin({ erros: { update: 'constraint violation' } });
    const r = await processarAtualizacaoFiscal(deps(admin), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'falha', mensagem: 'constraint violation' });
  });
});

// Ruling do controller (Task 13): família legada com `unidade` fora de UNIDADES_FISCAIS travava
// a fila sem saída, porque o payload fiscal nunca editava unidade. `fiscal.unidade` opcional
// resolve: presente, valida e grava; ausente, comportamento intacto (usa a unidade já gravada).
describe('processarAtualizacaoFiscal — unidade opcional (fix da fila travada)', () => {
  it('família com unidade fora do vocabulário, sem `unidade` no payload → continua invalido (documenta a trava)', async () => {
    const { admin, writes } = fakeAdmin({ familia: { ...FAMILIA_BASE, unidade: 'PACOTE' } });
    const r = await processarAtualizacaoFiscal(deps(admin), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r.tipo).toBe('invalido');
    if (r.tipo === 'invalido') expect(r.erros.some((e) => e.includes('unidade fiscal'))).toBe(true);
    expect(writes.length).toBe(0);
  });

  it('família com unidade fora do vocabulário + `unidade` válida no payload → grava a nova unidade e passa', async () => {
    const { admin, writes } = fakeAdmin({ familia: { ...FAMILIA_BASE, unidade: 'PACOTE' } });
    const r = await processarAtualizacaoFiscal(deps(admin), {
      familiaId: 'fam-1', fiscal: { ...FISCAL_OK, unidade: 'UN' },
    });
    expect(r).toEqual({ tipo: 'ok', pushEnfileirado: true });
    expect(writes.length).toBe(1);
    expect(writes[0].payload.unidade).toBe('UN');
  });

  it('`unidade` fora da whitelist no payload → invalido, nada gravado', async () => {
    const { admin, writes } = fakeAdmin({ familia: { ...FAMILIA_BASE, unidade: 'PACOTE' } });
    const r = await processarAtualizacaoFiscal(deps(admin), {
      familiaId: 'fam-1', fiscal: { ...FISCAL_OK, unidade: 'PACOTE' },
    });
    expect(r.tipo).toBe('invalido');
    expect(writes.length).toBe(0);
  });

  it('família já com unidade válida, `unidade` ausente no payload → não grava unidade (comportamento intacto)', async () => {
    const { admin, writes } = fakeAdmin(); // FAMILIA_BASE.unidade = 'UN'
    const r = await processarAtualizacaoFiscal(deps(admin), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'ok', pushEnfileirado: true });
    expect(writes[0].payload.unidade).toBeUndefined();
  });
});

describe('validarShapeEntrada', () => {
  it('body sem fiscal → mensagem de campo obrigatório', () => {
    expect(validarShapeEntrada({ familiaId: 'fam-1' })).toBe('familiaId (string) e fiscal (objeto) são obrigatórios');
  });

  it('body sem familiaId → mensagem de campo obrigatório', () => {
    expect(validarShapeEntrada({ fiscal: FISCAL_OK })).toBe('familiaId (string) e fiscal (objeto) são obrigatórios');
  });

  it('body válido → null', () => {
    expect(validarShapeEntrada({ familiaId: 'fam-1', fiscal: FISCAL_OK })).toBeNull();
  });

  // Fix round 1 (I3): `unidade: 5` chegava intacto até `.toUpperCase()` em
  // processarAtualizacaoFiscal e estourava TypeError cru (500) em vez de 400 de validação.
  it('fiscal.unidade não-string → mensagem de erro', () => {
    expect(validarShapeEntrada({ familiaId: 'fam-1', fiscal: { ...FISCAL_OK, unidade: 5 } }))
      .toBe('fiscal.unidade deve ser string');
  });

  it('fiscal.unidade string → null (válido)', () => {
    expect(validarShapeEntrada({ familiaId: 'fam-1', fiscal: { ...FISCAL_OK, unidade: 'UN' } })).toBeNull();
  });
});

// ADR-0181 D-5 — descrição fiscal viaja dentro de `fiscal` (contrato N-I2).
describe('processarAtualizacaoFiscal — descricaoFiscal', () => {
  it('ausente preserva, null limpa, texto grava com trim, >120 recusa', async () => {
    const roda = async (fiscal: EntradaFiscal['fiscal']) => {
      const { admin, writes } = fakeAdmin();
      const r = await processarAtualizacaoFiscal(deps(admin), { familiaId: 'fam-1', fiscal });
      return { r, writes };
    };
    // 1) chave ausente (cliente antigo) → update NÃO mexe na coluna
    expect((await roda(FISCAL_OK)).writes[0].payload).not.toHaveProperty('descricao_fiscal');
    // 2) null → limpa
    expect((await roda({ ...FISCAL_OK, descricaoFiscal: null })).writes[0].payload.descricao_fiscal).toBeNull();
    // 3) texto → grava com trim
    expect((await roda({ ...FISCAL_OK, descricaoFiscal: ' Short ' })).writes[0].payload.descricao_fiscal).toBe('Short');
    // 4) >120 depois do trim → inválido, nada gravado
    const longo = await roda({ ...FISCAL_OK, descricaoFiscal: 'x'.repeat(121) });
    expect(longo.r.tipo).toBe('invalido');
    if (longo.r.tipo === 'invalido') expect(longo.r.erros.join(' ')).toMatch(/descrição fiscal.*120/i);
    expect(longo.writes.length).toBe(0);
  });

  it('validarShapeEntrada: descricaoFiscal não-string e não-null → erro de shape', () => {
    expect(validarShapeEntrada({ familiaId: 'f', fiscal: { descricaoFiscal: 5 } })).toMatch(/descricaoFiscal/);
    expect(validarShapeEntrada({ familiaId: 'f', fiscal: { descricaoFiscal: null } })).toBeNull();
    expect(validarShapeEntrada({ familiaId: 'f', fiscal: { descricaoFiscal: 'x' } })).toBeNull();
  });
});
