import { describe, it, expect } from 'vitest';
import {
  CANAIS, LISTA_CANAIS, infoCanal, canaisOperaveis, canaisEmBreve, contrasteTexto,
} from '@/lib/canais';

describe('registry de canais', () => {
  it('tem os 5 marketplaces, só ML ativo', () => {
    expect(LISTA_CANAIS.map((c) => c.id)).toEqual([
      'mercado_livre', 'shopee', 'magalu', 'amazon', 'casas_bahia',
    ]);
    expect(CANAIS.mercado_livre.status).toBe('ativo');
    expect(LISTA_CANAIS.filter((c) => c.status === 'em_breve')).toHaveLength(4);
  });

  it('infoCanal devolve o canal ou null para id desconhecido', () => {
    expect(infoCanal('mercado_livre')?.nome).toBe('Mercado Livre');
    expect(infoCanal('aliexpress')).toBeNull();
  });

  it('canaisOperaveis = habilitados na org E ativos no registry', () => {
    expect(canaisOperaveis(['mercado_livre']).map((c) => c.id)).toEqual(['mercado_livre']);
    // shopee habilitada na org mas em_breve no registry → não operável
    expect(canaisOperaveis(['mercado_livre', 'shopee']).map((c) => c.id)).toEqual(['mercado_livre']);
    expect(canaisOperaveis([])).toEqual([]);
  });

  it('canaisEmBreve = todo o resto do registry (em_breve OU não habilitado)', () => {
    expect(canaisEmBreve(['mercado_livre']).map((c) => c.id)).toEqual([
      'shopee', 'magalu', 'amazon', 'casas_bahia',
    ]);
  });

  it('só o ML tem capabilities (não inventamos limites dos demais)', () => {
    expect(CANAIS.mercado_livre.capabilities?.tituloMax).toBe(60);
    expect(CANAIS.shopee.capabilities).toBeUndefined();
  });

  it('contrasteTexto escolhe texto legível sobre a cor da marca', () => {
    expect(contrasteTexto('#FFE600')).toBe('#000000'); // amarelo ML → texto preto
    expect(contrasteTexto('#EE4D2D')).toBe('#ffffff'); // laranja Shopee → texto branco
  });
});
