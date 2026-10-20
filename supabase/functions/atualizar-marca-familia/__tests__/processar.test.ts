import { describe, it, expect } from 'vitest';
import { processarEdicaoMarca, type DepsEdicaoMarca } from '../processar';

function fake(opts: {
  marcaPropria?: boolean;
  publicado?: boolean;
  erroGravar?: string;
  falhaEnfileirar?: boolean;
} = {}) {
  const chamadas = {
    gravar: [] as Array<{ codigoPai: string; marca: string }>,
    enfileirar: [] as Array<{ codigoPai: string; versao: number }>,
    erros: [] as string[],
    auditoria: [] as string[],
  };
  const deps: DepsEdicaoMarca = {
    lerMarcaOrg: async () => ({ marcaPropria: opts.marcaPropria ?? true, marcaPadrao: 'Zaven' }),
    gravarMarca: async (_org, codigoPai, marca) => {
      if (opts.erroGravar) throw new Error(opts.erroGravar);
      chamadas.gravar.push({ codigoPai, marca });
      return opts.publicado === false ? { publicado: false, versao: null } : { publicado: true, versao: 7 };
    },
    enfileirar: async (_org, codigoPai, versao) => {
      if (opts.falhaEnfileirar) throw new Error('qstash fora');
      chamadas.enfileirar.push({ codigoPai, versao });
    },
    marcarErro: async (_org, _cp, _v, erro) => { chamadas.erros.push(erro); },
    auditar: async (r) => { chamadas.auditoria.push(r); },
  };
  return { deps, chamadas };
}

const base = { orgId: 'org-z', podeEditar: true, codigoPai: '00000064', marca: 'Lacoste' as string | null };

describe('processarEdicaoMarca (ADR-0188)', () => {
  it('sem permissão (membro / suporte só leitura) → 403, auditado, nada gravado', async () => {
    const f = fake();
    const r = await processarEdicaoMarca(f.deps, { ...base, podeEditar: false });
    expect(r.status).toBe(403);
    expect(f.chamadas.gravar).toHaveLength(0);
    expect(f.chamadas.auditoria).toEqual(['denied']);
  });

  it('org sem marca própria → 400', async () => {
    const f = fake({ marcaPropria: false });
    expect((await processarEdicaoMarca(f.deps, base)).status).toBe(400);
    expect(f.chamadas.gravar).toHaveLength(0);
  });

  it('marca só com espaços → 400; sem código → 400', async () => {
    const f = fake();
    expect((await processarEdicaoMarca(f.deps, { ...base, marca: '   ' })).status).toBe(400);
    expect((await processarEdicaoMarca(f.deps, { ...base, codigoPai: '' })).status).toBe(400);
    expect(f.chamadas.gravar).toHaveLength(0);
  });

  it('publicado → grava a marca aparada e enfileira com a versão devolvida', async () => {
    const f = fake();
    const r = await processarEdicaoMarca(f.deps, { ...base, marca: ' Lacoste ' });
    expect(r).toEqual({ status: 200, body: { ok: true, publicado: true, status: 'pendente' } });
    expect(f.chamadas.gravar).toEqual([{ codigoPai: '00000064', marca: 'Lacoste' }]);
    expect(f.chamadas.enfileirar).toEqual([{ codigoPai: '00000064', versao: 7 }]);
    expect(f.chamadas.auditoria).toEqual(['succeeded']);
  });

  it('"usar a marca da org" (marca null) → grava a marca padrão da org', async () => {
    const f = fake();
    await processarEdicaoMarca(f.deps, { ...base, marca: null });
    expect(f.chamadas.gravar[0].marca).toBe('Zaven');
  });

  it('não publicado → grava e não enfileira', async () => {
    const f = fake({ publicado: false });
    const r = await processarEdicaoMarca(f.deps, base);
    expect(r.body).toEqual({ ok: true, publicado: false, status: null });
    expect(f.chamadas.enfileirar).toHaveLength(0);
  });

  it('falha ao enfileirar → marca erro durável e responde status erro (a marca já está salva)', async () => {
    const f = fake({ falhaEnfileirar: true });
    const r = await processarEdicaoMarca(f.deps, base);
    expect(r).toEqual({ status: 200, body: { ok: true, publicado: true, status: 'erro' } });
    expect(f.chamadas.erros[0]).toMatch(/Falha ao enviar/);
  });

  it('produto processando/publicando (MARCA_OCUPADO) → 409 com mensagem', async () => {
    const f = fake({ erroGravar: 'MARCA_OCUPADO' });
    const r = await processarEdicaoMarca(f.deps, base);
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ erro: 'Produto em processamento ou publicação — tente de novo quando terminar.' });
  });

  it('produto inexistente → 404; erro inesperado → 500 auditado como falha', async () => {
    expect((await processarEdicaoMarca(fake({ erroGravar: 'MARCA_INEXISTENTE' }).deps, base)).status).toBe(404);
    const f = fake({ erroGravar: 'timeout' });
    expect((await processarEdicaoMarca(f.deps, base)).status).toBe(500);
    expect(f.chamadas.auditoria).toEqual(['failed']);
  });
});
