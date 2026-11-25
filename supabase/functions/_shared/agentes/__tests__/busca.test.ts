import { describe, expect, it } from 'vitest';
import { type AnuncioBusca, filtroVariacoes, montarCandidatos, palavras, type VariacaoBusca, variacoesQueCasam } from '../busca.ts';

describe('palavras', () => {
  it('minúsculas, sem acento, sem repetição, separadas por qualquer pontuação', () => {
    expect(palavras('  Proteção, SOLAR/uv solar ')).toEqual(['protecao', 'solar', 'uv']);
  });
  it('tira palavra de enfeite quando sobra outra de 3 letras; senão mantém', () => {
    expect(palavras('short de linho tamanho G')).toEqual(['short', 'linho', 'g']);
    expect(palavras('estampa 1')).toEqual(['estampa', '1']);
    expect(palavras('tamanho 4')).toEqual(['tamanho', '4']);
  });
  it('sem nenhuma palavra de 3 caracteres, ou com mais de 20, não busca', () => {
    for (const t of ['4', 'G M', '***', '', '  ', Array.from({ length: 21 }, (_, i) => `pal${i}`).join(' ')]) {
      expect(palavras(t)).toEqual([]);
    }
  });
});

const an = (codigo_pai: string, textos: string[], mlbs: string[] = [`MLB-${codigo_pai}`]): AnuncioBusca =>
  ({ codigo_pai, titulo: textos[0], textos, mlbs });
const va = (codigo_pai: string, sku: string, mlb: string, cor: string | null, tamanho: string | null, nome = cor ?? ''): VariacaoBusca =>
  ({ codigo_pai, sku, mlb, nome, cor, tamanho });
const buscar = (t: string, a: AnuncioBusca[], v: VariacaoBusca[] = []) => montarCandidatos(palavras(t), a, v);

describe('montarCandidatos', () => {
  const CONJ = an('292', ['Conjunto Infantil Proteção Solar Uv', 'Conjunto Infantil Menina Proteção Solar UV'], ['MLB1', 'MLB2', 'MLB3']);
  const VS = [
    va('292', '296', 'MLB1', 'Estampa Neon', '4'), va('292', '297', 'MLB2', 'Estampa Neon', '6'), va('292', '290', 'MLB3', 'Estampa Flamingo', '4'),
  ];

  it('palavras no título, em qualquer ordem e sem acento → todos os MLBs, sem variações', () => {
    expect(buscar('solar PROTECAO menina', [CONJ], VS)).toEqual({
      candidatos: [{ codigo_pai: '292', titulo: 'Conjunto Infantil Proteção Solar Uv', mlbs: ['MLB1', 'MLB2', 'MLB3'] }],
      lista_cortada: false,
    });
  });

  it('estampa só da variação → candidato com os MLBs e as variações que bateram', () => {
    expect(buscar('neon', [CONJ], VS).candidatos).toEqual([{
      codigo_pai: '292', titulo: 'Conjunto Infantil Proteção Solar Uv', mlbs: ['MLB1', 'MLB2'],
      variacoes: [{ sku: '296', cor: 'Estampa Neon', tamanho: '4', mlb: 'MLB1' }, { sku: '297', cor: 'Estampa Neon', tamanho: '6', mlb: 'MLB2' }],
    }]);
  });

  it('título + cor + tamanho precisam bater na MESMA variação; um resultado continua candidato', () => {
    expect(buscar('conjunto neon tamanho 4', [CONJ], VS).candidatos).toMatchObject([{ mlbs: ['MLB1'], variacoes: [{ sku: '296' }] }]);
    expect(buscar('conjunto flamingo 6', [CONJ], VS).candidatos).toEqual([]);
  });

  it('tamanho e número são exatos: 4 não acha 40, G não acha GG; letra solta não casa dentro de palavra', () => {
    const c = an('1', ['Calça Jeans']);
    const s = an('2', ['Short Linho']);
    const v = [va('1', 'a', 'MA', 'Azul', '40'), va('1', 'b', 'MB', 'Azul', '4'), va('2', 'c', 'MC', 'Cinza', 'GG'), va('2', 'd', 'MD', 'Cinza', 'G')];
    expect(buscar('calca 4', [c, s], v).candidatos).toMatchObject([{ mlbs: ['MB'] }]);
    expect(buscar('short g', [c, s], v).candidatos).toMatchObject([{ mlbs: ['MD'] }]);
    expect(buscar('short gg', [c, s], v).candidatos).toMatchObject([{ mlbs: ['MC'] }]);
    expect(buscar('short z', [c, s], v).candidatos).toEqual([]);
  });

  it('tamanho por letras também é exato: XXL não acha XXXL', () => {
    const c = an('1', ['Camiseta Lisa']);
    expect(buscar('camiseta xxl', [c], [va('1', 'a', 'MA', 'Azul', 'XXXL'), va('1', 'b', 'MB', 'Azul', 'XXL')]).candidatos).toMatchObject([{ mlbs: ['MB'] }]);
  });

  it('número do título não vale por tamanho parcial: "kit 2" não acha "Kit 25"', () => {
    expect(buscar('kit 2', [an('1', ['Kit 25 Agulhas']), an('2', ['Kit 2 Blusas'])]).candidatos.map((c) => c.codigo_pai)).toEqual(['2']);
  });

  it('gênero e plural: "blusas pretas" acha Blusa na cor Preto; acento na cor não importa', () => {
    const b = an('1', ['Blusa Regata']);
    const v = [va('1', 'a', 'MA', 'Preto', 'M'), va('1', 'b', 'MB', 'Cáqui', 'M')];
    expect(buscar('blusas pretas m', [b], v).candidatos).toMatchObject([{ mlbs: ['MA'] }]);
    expect(buscar('blusa caqui', [b], v).candidatos).toMatchObject([{ mlbs: ['MB'] }]);
  });

  it('cor só no nome da variação (cor nula) também casa', () => {
    expect(buscar('fita vermelha', [an('1', ['Fita Cetim'])], [va('1', 'a', 'MA', null, null, 'FITA CETIM 10MM VERMELHO')]).candidatos)
      .toMatchObject([{ variacoes: [{ sku: 'a', cor: null, tamanho: null, mlb: 'MA' }] }]);
  });

  it('variação que bate em mais palavras vem primeiro', () => {
    const s = an('140', ['Short Masculino Preto']);
    const v = [va('140', 'a', 'MA', 'Azul', 'M'), va('140', 'b', 'MB', 'Preto', 'M')];
    expect(buscar('short preto m', [s], v).candidatos).toMatchObject([{ mlbs: ['MB', 'MA'], variacoes: [{ sku: 'b' }, { sku: 'a' }] }]);
  });

  it('anúncio legado: variações do mesmo MLB → um MLB só', () => {
    const v = [va('1', 'a', 'M1', 'Azul Claro', null), va('1', 'b', 'M1', 'Azul Escuro', null)];
    expect(buscar('fita azul', [an('1', ['Fita Cetim'])], v).candidatos).toMatchObject([{ mlbs: ['M1'], variacoes: [{ sku: 'a' }, { sku: 'b' }] }]);
  });

  it('variação de outro código não empresta cor; sem palavra não há candidato', () => {
    expect(buscar('conjunto neon', [CONJ], [va('999', 'x', 'MX', 'Neon', '4')]).candidatos).toEqual([]);
    expect(buscar('4', [CONJ], VS)).toEqual({ candidatos: [], lista_cortada: false });
  });

  it('corta em 10 candidatos, 60 MLBs e 20 variações, e avisa', () => {
    const dez = buscar('item', Array.from({ length: 11 }, (_, i) => an(`P${i}`, ['Item'])));
    expect(dez.candidatos).toHaveLength(10);
    expect(dez.lista_cortada).toBe(true);
    const mlbs = Array.from({ length: 61 }, (_, i) => `M${i}`);
    const muitos = buscar('item', [an('1', ['Item'], mlbs)]);
    expect(muitos.candidatos[0].mlbs).toHaveLength(60);
    expect(muitos.lista_cortada).toBe(true);
    const vs = buscar('item azul', [an('1', ['Item'])], mlbs.slice(0, 21).map((m, i) => va('1', `s${i}`, m, 'Azul', null)));
    expect(vs.candidatos[0].variacoes).toHaveLength(20);
    expect(vs.candidatos[0].mlbs).toHaveLength(21);
    expect(vs.lista_cortada).toBe(true);
  });
});

describe('filtroVariacoes', () => {
  it('a palavra mais longa que falta em cada título, sem repetir, com curinga no lugar de vogal e c', () => {
    expect(filtroVariacoes(palavras('conjunto neon 4'), [an('1', ['Conjunto']), an('2', ['Conjunto Neon'])]))
      .toBe('cor.ilike.%n__n%,nome.ilike.%n__n%,tamanho.ilike.%n__n%,cor.ilike.%4%,nome.ilike.%4%,tamanho.ilike.%4%');
  });
  it('tudo no título → null; nunca sai caractere que mude o filtro do PostgREST', () => {
    expect(filtroVariacoes(palavras('conjunto'), [an('1', ['Conjunto'])])).toBeNull();
    const f = filtroVariacoes(palavras('a,b),org_id.eq.outra(or"\\%*neon'), [an('1', ['Conjunto'])])!;
    expect(f).toMatch(/^(?:(?:cor|nome|tamanho)\.ilike\.%[a-z0-9_]+%,?)+$/);
  });
});

describe('variacoesQueCasam', () => {
  it('só as que completam o título do próprio código, sem corte', () => {
    const v = Array.from({ length: 30 }, (_, i) => va('1', `s${i}`, `M${i}`, i % 2 ? 'Azul' : 'Rosa', null));
    expect(variacoesQueCasam(palavras('item azul'), [an('1', ['Item'])], v)).toHaveLength(15);
    expect(variacoesQueCasam(palavras('item'), [an('1', ['Item'])], v)).toEqual([]);
  });
});
