import { describe, expect, it } from 'vitest';
import { avaliarQualidade, normalizarQualidade, type DadosQualidade } from '../qualidade';

const foto = (id: string, largura: number | null, altura: number | null) => ({ id, largura, altura });
const bom: DadosQualidade = {
  fotos: [1, 2, 3, 4, 5].map((n) => foto(`f${n}`, 1200, 1200)),
  clips: 1,
  descricao: 800,
  garantia: '90 dias de garantia de fábrica.',
  disponivel: 120,
  disponivelTexto: null,
};
const item = (d: DadosQualidade, chave: string) => avaliarQualidade(d).itens.find((i) => i.chave === chave)!;

describe('avaliarQualidade (ADR-0189 D-10, Task 17)', () => {
  it('anúncio completo: seis itens ok', () => {
    const r = avaliarQualidade(bom);
    expect(r.itens.map((i) => [i.chave, i.estado])).toEqual([
      ['fotos', 'ok'], ['resolucao', 'ok'], ['clips', 'ok'], ['descricao', 'ok'], ['garantia', 'ok'], ['disponivel', 'ok'],
    ]);
    expect(r.atencao).toBe(0);
    expect(r.fotosFracas).toEqual([]);
  });

  it('menos de 5 fotos e resolução: qualquer lado < 1200 conta; dimensão desconhecida não conta nem vira ok', () => {
    const d = { ...bom, fotos: [foto('a', 1200, 573), foto('b', 1200, 1200), foto('c', null, 900)] };
    expect(item(d, 'fotos')).toMatchObject({ estado: 'atencao', valor: '3' });
    expect(item(d, 'resolucao')).toMatchObject({ estado: 'atencao' });
    expect(avaliarQualidade(d).fotosFracas).toEqual([{ id: 'a', posicao: 1 }]);
    const soDesconhecida = { ...bom, fotos: [...bom.fotos!.slice(0, 4), foto('x', null, null)] };
    expect(item(soDesconhecida, 'resolucao').estado).toBe('nao_informado');
  });

  it('sem Clips, descrição curta, ausente ou vazia', () => {
    expect(item({ ...bom, clips: 0 }, 'clips')).toMatchObject({ estado: 'atencao', valor: 'Sem Clips' });
    expect(item({ ...bom, descricao: 415 }, 'descricao')).toMatchObject({ estado: 'atencao', valor: '415 caracteres' });
    expect(item({ ...bom, descricao: 0 }, 'descricao')).toMatchObject({ estado: 'atencao', valor: 'Sem descrição' });
    expect(item({ ...bom, descricao: null }, 'descricao').estado).toBe('nao_informado');
  });

  it('garantia: só "Sem garantia" exato (ponto final aceito) alerta; ausente é não informada', () => {
    expect(item({ ...bom, garantia: ' Sem garantia. ' }, 'garantia').estado).toBe('atencao');
    expect(item({ ...bom, garantia: 'Sem garantia de fábrica, só do vendedor' }, 'garantia').estado).toBe('ok');
    expect(item({ ...bom, garantia: null }, 'garantia')).toMatchObject({ estado: 'nao_informado', valor: 'Não informada' });
  });

  it('disponibilidade exibida < 50 é atenção; ausente não vira ok', () => {
    expect(item({ ...bom, disponivel: 16 }, 'disponivel')).toMatchObject({ estado: 'atencao', valor: '16' });
    expect(item({ ...bom, disponivel: null }, 'disponivel').estado).toBe('nao_informado');
  });

  it('normalizarQualidade: mantém a forma válida e descarta lixo vindo da página', () => {
    expect(normalizarQualidade(bom)).toEqual(bom);
    expect(normalizarQualidade(null)).toBeNull();
    expect(normalizarQualidade({ fotos: [{ id: 1 }, { id: 'ok', largura: -1, altura: 1.5 }], clips: 'x', descricao: 1e9, garantia: 7, disponivel: 3 }))
      .toEqual({ fotos: [{ id: 'ok', largura: null, altura: null }], clips: null, descricao: null, garantia: null, disponivel: 3, disponivelTexto: null });
  });

  it('disponível: mostra o texto do ML ("+50") quando há; o estado segue o número (auditoria × Avant, 25/10)', () => {
    expect(item({ ...bom, disponivel: 100, disponivelTexto: '+50 disponíveis' }, 'disponivel')).toMatchObject({ estado: 'ok', valor: '+50' });
    expect(item({ ...bom, disponivel: 16, disponivelTexto: '+50 disponíveis' }, 'disponivel')).toMatchObject({ estado: 'atencao', valor: '+50' });
    expect(item({ ...bom, disponivel: null, disponivelTexto: '+50 disponíveis' }, 'disponivel').estado).toBe('nao_informado');
    // Estado antigo (sem o campo) segue com o número.
    const { disponivelTexto: _, ...antigo } = bom;
    expect(item(antigo as DadosQualidade, 'disponivel').valor).toBe('120');
  });

  it('normalizarQualidade: disponivelTexto só string curta no formato "+N disponíveis"', () => {
    expect(normalizarQualidade({ ...bom, disponivelTexto: '+50 disponíveis' })!.disponivelTexto).toBe('+50 disponíveis');
    for (const ruim of ['x'.repeat(41), `+5${'0'.repeat(30)} disponíveis`, 'Último disponível', 50, null]) {
      expect(normalizarQualidade({ ...bom, disponivelTexto: ruim })!.disponivelTexto).toBeNull();
    }
  });

  it('galeria não lida: fotos, resolução e Clips não informados (nunca ok)', () => {
    const r = avaliarQualidade({ ...bom, fotos: null, clips: null });
    expect(['fotos', 'resolucao', 'clips'].map((c) => r.itens.find((i) => i.chave === c)!.estado)).toEqual(['nao_informado', 'nao_informado', 'nao_informado']);
  });
});
