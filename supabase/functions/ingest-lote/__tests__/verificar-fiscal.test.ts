import { describe, expect, it } from 'vitest';
import { exigirFiscalExplicito, exigirNcmVigente, resolverCamposFiscais } from '../verificar-fiscal.ts';

const pai = (extra: Record<string, unknown>) => ({ CODIGO: '00100', PAI: '0', ...extra });

describe('exigirFiscalExplicito (org com módulo fiscal — ADR-0135)', () => {
  it('PAI com NCM de 8 dígitos passa', () => {
    expect(() => exigirFiscalExplicito([pai({ NCM: '39269090' })])).not.toThrow();
  });
  it('PAI sem NCM aborta nomeando o código', () => {
    expect(() => exigirFiscalExplicito([pai({})])).toThrow(/00100.*NCM.*vazio/s);
  });
  it('NCM com máscara 3926.90.90 é normalizado e passa', () => {
    expect(() => exigirFiscalExplicito([pai({ NCM: '3926.90.90' })])).not.toThrow();
  });
  it('acumula TODOS os PAIs problemáticos numa mensagem só', () => {
    expect(() => exigirFiscalExplicito([
      pai({}), { CODIGO: '00200', PAI: '0', NCM: 'abc' },
    ])).toThrow(/2 produto\(s\) PAI/);
  });
  it('linha filha (PAI != 0) é ignorada', () => {
    expect(() => exigirFiscalExplicito([{ CODIGO: '00101', PAI: '00100' }])).not.toThrow();
  });
  it('ORIGEM_NFE presente mas inválida aborta (opcional ≠ silencioso)', () => {
    expect(() => exigirFiscalExplicito([pai({ NCM: '39269090', ORIGEM_NFE: '9' })]))
      .toThrow(/ORIGEM_NFE/);
  });
  it('CSOSN de um dos códigos do cadastro manual passa', () => {
    expect(() => exigirFiscalExplicito([pai({ NCM: '39269090', CSOSN: '102' })])).not.toThrow();
  });
  it('CSOSN fora da lista aborta (opcional ≠ silencioso)', () => {
    expect(() => exigirFiscalExplicito([pai({ NCM: '39269090', CSOSN: '999' })]))
      .toThrow(/CSOSN/);
  });
});

describe('resolverCamposFiscais (re-ingest herda opcionais vazios — fix round 1)', () => {
  const grupoVazio = { ncm: '39269090', cest: null, origem_nfe: null, tributacao_icms: null };
  const anterior = {
    cest: '0102300', origem_nfe: 1, tributacao_icms: '102', tributacao_icms_regime: 'simples',
  };

  it('célula CEST vazia no re-ingest mantém o CEST anterior', () => {
    const r = resolverCamposFiscais(grupoVazio, anterior);
    expect(r.cest).toBe('0102300');
  });

  it('célula preenchida e válida sobrescreve o anterior', () => {
    const r = resolverCamposFiscais({ ...grupoVazio, cest: '9988776' }, anterior);
    expect(r.cest).toBe('9988776');
  });

  it('tributacao_icms herdado traz o tributacao_icms_regime anterior junto (nunca separado)', () => {
    const antNormal = { ...anterior, tributacao_icms: '00', tributacao_icms_regime: 'normal' };
    const r = resolverCamposFiscais(grupoVazio, antNormal);
    expect(r.tributacao_icms).toBe('00');
    expect(r.tributacao_icms_regime).toBe('normal');
  });

  it('CSOSN novo na planilha vence o anterior e fixa regime simples', () => {
    const antNormal = { ...anterior, tributacao_icms: '00', tributacao_icms_regime: 'normal' };
    const r = resolverCamposFiscais({ ...grupoVazio, tributacao_icms: '500' }, antNormal);
    expect(r.tributacao_icms).toBe('500');
    expect(r.tributacao_icms_regime).toBe('simples');
  });

  it('ORIGEM_NFE = 0 herdado sobrevive (0 é código válido, não "ausente")', () => {
    const r = resolverCamposFiscais(grupoVazio, { ...anterior, origem_nfe: 0 });
    expect(r.origem_nfe).toBe(0);
  });

  it('sem anterior (CREATE) e célula vazia → null, sem herança', () => {
    const r = resolverCamposFiscais(grupoVazio, undefined);
    expect(r.cest).toBeNull();
    expect(r.origem_nfe).toBeNull();
    expect(r.tributacao_icms).toBeNull();
    expect(r.tributacao_icms_regime).toBeNull();
  });

  // R6-I1 (ADR-0181): a planilha não tem coluna de descrição fiscal — o UPDATE sempre herda.
  // Sem isto, o próximo push fiscal mandaria o nome_pai como `title` ao Faturador.
  it('descricao_fiscal herda da família anterior no UPDATE', () => {
    const r = resolverCamposFiscais(grupoVazio, { ...anterior, descricao_fiscal: 'Short masculino' });
    expect(r.descricao_fiscal).toBe('Short masculino');
    expect(resolverCamposFiscais(grupoVazio, undefined).descricao_fiscal).toBeNull();
  });

  it('NCM nunca herda (obrigatório na própria planilha)', () => {
    const r = resolverCamposFiscais({ ...grupoVazio, ncm: '3926.90.90' }, anterior);
    expect(r.ncm).toBe('39269090');
  });
});

describe('exigirNcmVigente (ADR-0187)', () => {
  const fakeAdmin = (data: unknown, error: unknown = null) =>
    ({ rpc: async () => ({ data, error }) }) as never;

  it('PAI com NCM inexistente aborta citando o código e o motivo', async () => {
    const admin = fakeAdmin([]);
    await expect(exigirNcmVigente(admin, [{ CODIGO: '00000140', PAI: '0', NCM: '75937727' }]))
      .rejects.toThrow(/1 produto\(s\) PAI.*00000140.*não existe na tabela oficial.*ADR-0187/s);
  });
  it('PAI com NCM vencido aborta com "não está mais vigente"', async () => {
    const admin = fakeAdmin([{ codigo: '39269090', vigente: false }]);
    await expect(exigirNcmVigente(admin, [pai({ NCM: '3926.90.90' })]))
      .rejects.toThrow(/00100.*não está mais vigente/s);
  });
  it('linhas filhas são ignoradas (rpc nem é chamado)', async () => {
    const admin = { rpc: () => { throw new Error('não deveria chamar'); } } as never;
    await expect(exigirNcmVigente(admin, [{ CODIGO: '00101', PAI: '00100', NCM: '75937727' }]))
      .resolves.toBeUndefined();
  });
  it('todos vigentes resolve', async () => {
    const admin = fakeAdmin([{ codigo: '39269090', vigente: true }]);
    await expect(exigirNcmVigente(admin, [pai({ NCM: '39269090' })])).resolves.toBeUndefined();
  });
  it('erro de leitura rejeita (nunca passa)', async () => {
    const admin = fakeAdmin(null, { message: 'boom' });
    await expect(exigirNcmVigente(admin, [pai({ NCM: '39269090' })])).rejects.toThrow(/boom/);
  });
});
