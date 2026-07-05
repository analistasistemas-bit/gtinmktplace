// E6 (ADR-0061 / D-E6.5): conector fake para provar o worker genérico ponta a ponta
// sem canal real. Instalável no registry SÓ em teste (registrarConectorParaTeste); como
// não é importado fora de __tests__, some do bundle de produção.
import type {
  ChannelConnector, ContextoCanal, AnuncioCanonico, AtualizacaoCanonica,
  ResultadoCanal, RefAnuncio, ResultadoAtualizacao, StatusCanal, MetricasVendasCanal,
  ErroCanalCodigo, FaixaAtacado,
} from './contrato.ts';

interface FalhaArmada { codigo: ErroCanalCodigo; retentavel: boolean }

class FakeConnector implements ChannelConnector {
  // `id` do contrato é CanalId ('mercado_livre'); o fake usa 'fake' via cast só em teste.
  readonly id = 'fake' as ChannelConnector['id'];
  readonly capabilities = {
    variacoes: true, descricaoSeparada: false, catalogo: false,
    desconto: false, atacado: false, dimensoesPacote: true,
  };

  chamadas: Array<{ metodo: string; args: unknown }> = [];
  private falha: FalhaArmada | null = null;
  private seq = 0;

  /** Reseta o estado entre testes. */
  reset(): void { this.chamadas = []; this.falha = null; this.seq = 0; }
  /** Arma uma falha para o próximo criar/atualizar. */
  falharProximo(codigo: ErroCanalCodigo, retentavel: boolean): void { this.falha = { codigo, retentavel }; }

  private registrar(metodo: string, args: unknown) { this.chamadas.push({ metodo, args }); }
  private consumirFalha(): FalhaArmada | null { const f = this.falha; this.falha = null; return f; }

  subirFoto(_ctx: ContextoCanal, sourceUrl: string): Promise<string> {
    this.registrar('subirFoto', { sourceUrl });
    return Promise.resolve(`FAKE-FOTO-${this.seq++}`);
  }

  criarAnuncio(_ctx: ContextoCanal, anuncio: AnuncioCanonico): Promise<ResultadoCanal<RefAnuncio>> {
    this.registrar('criarAnuncio', anuncio);
    const f = this.consumirFalha();
    if (f) return Promise.resolve({ ok: false, erro: { codigo: f.codigo, mensagemOperador: `fake:${f.codigo}`, retentavel: f.retentavel } });
    const sku0 = anuncio.variacoes[0]?.sku ?? 'item';
    return Promise.resolve({
      ok: true,
      valor: {
        itemExternoId: `FAKE-${sku0}`,
        variacoesExternas: Object.fromEntries(anuncio.variacoes.map((v) => [v.sku, `FAKE-VAR-${v.sku}`])),
      },
    });
  }

  garantirDescricao(_ctx: ContextoCanal, itemExternoId: string, descricao: string): Promise<void> {
    this.registrar('garantirDescricao', { itemExternoId, descricao });
    return Promise.resolve();
  }

  aplicarAtacado(_ctx: ContextoCanal, itemExternoId: string, precoBase: number, faixas: FaixaAtacado[]): Promise<void> {
    this.registrar('aplicarAtacado', { itemExternoId, precoBase, faixas });
    return Promise.resolve();
  }

  atualizarAnuncio(_ctx: ContextoCanal, a: AtualizacaoCanonica): Promise<ResultadoCanal<ResultadoAtualizacao>> {
    this.registrar('atualizarAnuncio', a);
    const f = this.consumirFalha();
    if (f) return Promise.resolve({ ok: false, erro: { codigo: f.codigo, mensagemOperador: `fake:${f.codigo}`, retentavel: f.retentavel } });
    return Promise.resolve({
      ok: true,
      valor: { variacoesExternas: Object.fromEntries(a.novas.map((v) => [v.sku, `FAKE-VAR-${v.sku}`])) },
    });
  }

  sincronizarDescricao(_ctx: ContextoCanal, itemExternoId: string, _atual: string, _cores: string[]): Promise<string | null> {
    this.registrar('sincronizarDescricao', { itemExternoId });
    return Promise.resolve(null);
  }

  lerStatus(_ctx: ContextoCanal, itemExternoIds: string[]): Promise<Record<string, StatusCanal>> {
    this.registrar('lerStatus', { itemExternoIds });
    const out: Record<string, StatusCanal> = {};
    for (const id of itemExternoIds) out[id] = { status: 'ativo', motivo: null, estoque: 10, preco: 9.9, listingType: 'classico' };
    return Promise.resolve(out);
  }

  atualizarStatus(_ctx: ContextoCanal, itemExternoId: string, status: 'ativo' | 'pausado'): Promise<ResultadoCanal<void>> {
    this.registrar('atualizarStatus', { itemExternoId, status });
    return Promise.resolve({ ok: true });
  }

  lerMetricasVendas(): Promise<MetricasVendasCanal> {
    this.registrar('lerMetricasVendas', {});
    return Promise.resolve({ porItem: {}, totais: { faturamento: 0, unidades: 0, pedidos: 0 } });
  }
}

export const fakeConnector = new FakeConnector();
