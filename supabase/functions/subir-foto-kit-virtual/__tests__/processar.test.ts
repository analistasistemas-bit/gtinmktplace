// ADR-0154 D-5 / ADR-0033. Vitest (não Deno test) — runner que o CI/vitest.config.ts executam.
import { describe, it, expect, vi } from 'vitest';
import { subirFotoKitVirtual, validarSubirFotoKitVirtual, type SubirFotoKitVirtualDeps } from '../processar.ts';

function depsOk(over: Partial<SubirFotoKitVirtualDeps> = {}): SubirFotoKitVirtualDeps {
  return {
    orgId: 'org-1',
    usuariosDaOrg: new Set(['user-1']),
    urlAssinadaFoto: async (path) => `https://signed/${path}`,
    subirFoto: async () => 'PIC-123',
    capaIaGerada: async () => true,
    ...over,
  };
}

const USUARIOS = new Set(['user-1']);

describe('validarSubirFotoKitVirtual', () => {
  it('recusa path vazio/ausente antes de qualquer rede', () => {
    expect(validarSubirFotoKitVirtual({ fotoStoragePath: '' }, 'org-1', USUARIOS)).toEqual('path_invalido');
    expect(validarSubirFotoKitVirtual({ fotoStoragePath: '   ' }, 'org-1', USUARIOS)).toEqual('path_invalido');
  });

  it('aceita foto da org: capa IA e upload manual (pasta da org ou do usuário)', () => {
    for (const p of [
      'org-1/kit-virtual-ia/11111111-1111-4111-8111-111111111111.png',
      'user-1/kit-virtual-chave-1/foto.jpg',
      'org-1/kit-virtual-chave-1/Foto_do_kit.jpeg',
    ]) expect(validarSubirFotoKitVirtual({ fotoStoragePath: p }, 'org-1', USUARIOS), p).toBeNull();
  });

  it('recusa path de outra org, de usuário de fora, travessia e prévia reprovada da capa IA', () => {
    for (const p of ['org-1/kit-virtual-ia/11111111-1111-4111-8111-111111111111-t2.png', 'outraOrg/kit-virtual-ia/x.png', 'user-2/kit-virtual-chave-1/foto.jpg', 'org-1/../outraOrg/x.png']) {
      expect(validarSubirFotoKitVirtual({ fotoStoragePath: p }, 'org-1', USUARIOS), p).toEqual('path_invalido');
    }
  });
});

describe('subirFotoKitVirtual', () => {
  it('sobe a foto e devolve o picture_id do ML', async () => {
    const r = await subirFotoKitVirtual(depsOk(), { fotoStoragePath: 'org-1/kit-virtual-x/foto.jpg' });
    expect(r).toEqual({ ok: true, pictureId: 'PIC-123' });
  });

  it('path inválido: nem chama urlAssinadaFoto/subirFoto', async () => {
    let chamou = false;
    const deps = depsOk({ urlAssinadaFoto: async (p) => { chamou = true; return `https://signed/${p}`; } });
    const r = await subirFotoKitVirtual(deps, { fotoStoragePath: '' });
    expect(r).toEqual({ ok: false, motivo: 'path_invalido' });
    expect(chamou).toBe(false);
  });

  it('path de outra org: path_invalido sem chamar urlAssinadaFoto', async () => {
    let chamou = false;
    const deps = depsOk({ urlAssinadaFoto: async (p) => { chamou = true; return `https://signed/${p}`; } });
    const r = await subirFotoKitVirtual(deps, { fotoStoragePath: 'outraOrg/kit-virtual-ia/x.png' });
    expect(r).toEqual({ ok: false, motivo: 'path_invalido' });
    expect(chamou).toBe(false);
  });

  it('URL assinada não resolve (null): falha_url_assinada, sem chamar subirFoto', async () => {
    let chamouSubir = false;
    const deps = depsOk({
      urlAssinadaFoto: async () => null,
      subirFoto: async () => { chamouSubir = true; return 'PIC'; },
    });
    const r = await subirFotoKitVirtual(deps, { fotoStoragePath: 'org-1/x/foto.jpg' });
    expect(r).toMatchObject({ ok: false, motivo: 'falha_url_assinada' });
    expect(chamouSubir).toBe(false);
  });

  it('storage lança: falha_url_assinada com a mensagem original', async () => {
    const deps = depsOk({ urlAssinadaFoto: async () => { throw new Error('bucket indisponível'); } });
    const r = await subirFotoKitVirtual(deps, { fotoStoragePath: 'org-1/x/foto.jpg' });
    expect(r).toEqual({ ok: false, motivo: 'falha_url_assinada', mensagem: 'bucket indisponível' });
  });

  it('ML recusa o upload: falha_upload_ml com a mensagem do ML — não trava, é só o resultado', async () => {
    const deps = depsOk({ subirFoto: async () => { throw new Error('Falha ao subir foto (400): recusado'); } });
    const r = await subirFotoKitVirtual(deps, { fotoStoragePath: 'org-1/x/foto.jpg' });
    expect(r).toEqual({ ok: false, motivo: 'falha_upload_ml', mensagem: 'Falha ao subir foto (400): recusado' });
  });
});

// I1: o path da capa IA aprovada é determinístico; o objeto pode existir no storage com a linha ainda em
// `pendente_upload` (upload terminou depois do timeout, sem entrega faturada). Só `gerada` libera.
describe('subirFotoKitVirtual — capa IA só com entrega faturada (I1)', () => {
  const CAPA = 'org-1/kit-virtual-ia/11111111-1111-4111-8111-111111111111.png';
  type Linha = { org_id: string; storage_path: string; status: string };
  /** Mesmos filtros da consulta real (`capaIaGeradaNoBanco`): org + path + status gerada. */
  const fakeLinhas = (linhas: Linha[]) => async (path: string) =>
    linhas.some((l) => l.org_id === 'org-1' && l.storage_path === path && l.status === 'gerada');

  it('linha gerada da org: aceita e sobe', async () => {
    const r = await subirFotoKitVirtual(depsOk({ capaIaGerada: fakeLinhas([{ org_id: 'org-1', storage_path: CAPA, status: 'gerada' }]) }), { fotoStoragePath: CAPA });
    expect(r).toEqual({ ok: true, pictureId: 'PIC-123' });
  });

  for (const [caso, linhas] of [
    ['pendente_upload', [{ org_id: 'org-1', storage_path: CAPA, status: 'pendente_upload' }]],
    ['sem linha', []],
    ['linha de outra org', [{ org_id: 'org-2', storage_path: CAPA, status: 'gerada' }]],
  ] as Array<[string, Linha[]]>) {
    it(`${caso}: path_invalido sem assinar nem subir`, async () => {
      const urlAssinadaFoto = vi.fn(async (p: string) => `https://signed/${p}`);
      const subirFoto = vi.fn(async () => 'PIC');
      const r = await subirFotoKitVirtual(depsOk({ capaIaGerada: fakeLinhas(linhas), urlAssinadaFoto, subirFoto }), { fotoStoragePath: CAPA });
      expect(r).toEqual({ ok: false, motivo: 'path_invalido' });
      expect(urlAssinadaFoto).not.toHaveBeenCalled();
      expect(subirFoto).not.toHaveBeenCalled();
    });
  }

  it('falha ao ler a linha: falha fechada (falha_leitura), sem assinar nem subir', async () => {
    const urlAssinadaFoto = vi.fn(async (p: string) => `https://signed/${p}`);
    const r = await subirFotoKitVirtual(depsOk({ capaIaGerada: async () => { throw new Error('banco fora'); }, urlAssinadaFoto }), { fotoStoragePath: CAPA });
    expect(r).toEqual({ ok: false, motivo: 'falha_leitura', mensagem: 'banco fora' });
    expect(urlAssinadaFoto).not.toHaveBeenCalled();
  });

  it('upload manual: passa sem consultar a capa IA', async () => {
    const capaIaGerada = vi.fn(async () => false);
    const r = await subirFotoKitVirtual(depsOk({ capaIaGerada }), { fotoStoragePath: 'org-1/kit-virtual-chave-1/foto.jpg' });
    expect(r).toEqual({ ok: true, pictureId: 'PIC-123' });
    expect(capaIaGerada).not.toHaveBeenCalled();
  });
});
