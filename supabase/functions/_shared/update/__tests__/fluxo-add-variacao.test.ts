import { describe, it, expect } from 'vitest';
import { coresDesmarcadasPublicadas, ehFluxoAddVariacao, mensagemCoresDesmarcadas } from '../fluxo-add-variacao';

function admin(resposta: { data: unknown; error: { message: string } | null }) {
  const api = { select: () => api, eq: () => api, maybeSingle: async () => resposta };
  return { from: () => api } as never;
}

describe('ehFluxoAddVariacao', () => {
  it('lote manual → true', async () => {
    expect(await ehFluxoAddVariacao(admin({ data: { origem: 'manual' }, error: null }), 'l1')).toBe(true);
  });

  it('lote de planilha → false', async () => {
    expect(await ehFluxoAddVariacao(admin({ data: { origem: 'planilha' }, error: null }), 'l1')).toBe(false);
  });

  it('erro lendo o lote → lança (nunca vira false, que reprecificaria as irmãs)', async () => {
    await expect(ehFluxoAddVariacao(admin({ data: null, error: { message: 'timeout' } }), 'l1'))
      .rejects.toThrow(/lote l1.*timeout/);
  });

  it('lote ausente → lança', async () => {
    await expect(ehFluxoAddVariacao(admin({ data: null, error: null }), 'l1')).rejects.toThrow(/lote l1 não encontrado/);
  });
});

// Incidente 12/11/2026 (produto 92710170).
describe('coresDesmarcadasPublicadas', () => {
  type Resposta = { data: unknown; error: { message: string } | null };
  function adminTabelas(tabelas: Record<string, Resposta>) {
    const lidas: string[] = [];
    const from = (tabela: string) => {
      const api: Record<string, unknown> = {
        select: () => api, eq: () => api,
        then: (ok: (v: Resposta) => unknown) => { lidas.push(tabela); return Promise.resolve(tabelas[tabela]!).then(ok); },
      };
      return api;
    };
    return { admin: { from } as never, lidas };
  }
  const ok = (data: unknown): Resposta => ({ data, error: null });
  const falha = (message: string): Resposta => ({ data: null, error: { message } });
  const excl = (codigo: string, ml_variation_id: string | null = null) => ({ codigo, ml_variation_id, excluida_da_publicacao: true });
  const incl = (codigo: string, ml_variation_id: string | null = null) => ({ codigo, ml_variation_id, excluida_da_publicacao: false });
  const item = (sku: string, item_externo_id: string | null, retirado = false) => ({ sku, item_externo_id, retirado });

  it('User Products: devolve só a desmarcada com filho vivo (não retirado, com item), em ordem', async () => {
    const { admin } = adminTabelas({
      anuncios_externos_itens: ok([
        item('C1', 'MLB1'), item('C2', 'MLB2'), item('C3', 'MLB3'), item('RETIRADA', 'MLB4', true), item('SEM_ITEM', null),
      ]),
    });
    const fotografia = [incl('C1'), excl('C3'), excl('C2'), excl('RETIRADA'), excl('SEM_ITEM'), excl('NOVA')];
    expect(await coresDesmarcadasPublicadas(admin, fotografia, 'root-1')).toEqual(['C2', 'C3']);
  });

  it('anúncio com variações: desmarcada casada (ml_variation_id) conta, mesmo sem raiz', async () => {
    const { admin, lidas } = adminTabelas({});
    expect(await coresDesmarcadasPublicadas(admin, [incl('V1', 'MLV1'), excl('V2', 'MLV2'), excl('NOVA')], null)).toEqual(['V2']);
    expect(lidas).toEqual([]);
  });

  it('nenhuma desmarcada → vazio, sem ler nada', async () => {
    const { admin, lidas } = adminTabelas({});
    expect(await coresDesmarcadasPublicadas(admin, [incl('C1'), incl('C2')], 'root-1')).toEqual([]);
    expect(lidas).toEqual([]);
  });

  // A regra decide sobre a fotografia recebida: não relê `variacoes`, então não há segunda leitura para divergir.
  it('nunca lê a tabela de variações', async () => {
    const { admin, lidas } = adminTabelas({ anuncios_externos_itens: ok([item('C2', 'MLB2')]) });
    await coresDesmarcadasPublicadas(admin, [excl('C2')], 'root-1');
    expect(lidas).toEqual(['anuncios_externos_itens']);
  });

  it.each([
    ['erro ao ler os itens', { anuncios_externos_itens: falha('timeout') }, /itens do anúncio.*timeout/],
    ['itens sem resposta', { anuncios_externos_itens: ok(null) }, /itens do anúncio.*sem resposta/],
  ])('%s → lança (nunca vira "sem desmarcadas")', async (_nome, tabelas, erro) => {
    await expect(coresDesmarcadasPublicadas(adminTabelas(tabelas).admin, [excl('C2')], 'root-1')).rejects.toThrow(erro);
  });

  it('mensagem no padrão do reposicao_sem_item, com teto de 10 SKUs', () => {
    const skus = Array.from({ length: 12 }, (_, i) => `S${i + 1}`);
    expect(mensagemCoresDesmarcadas(['A', 'B'])).toBe(
      "UPDATE bloqueado: 2 cor(es) desmarcada(s) já publicada(s) no Mercado Livre (A, B). Em 'Adicionar variação' "
      + 'nenhuma cor pode ser desmarcada. Nada foi enviado. Marque todas as cores e reenvie.',
    );
    expect(mensagemCoresDesmarcadas(skus)).toContain('12 cor(es)');
    expect(mensagemCoresDesmarcadas(skus)).toContain('S10…)');
  });
});
