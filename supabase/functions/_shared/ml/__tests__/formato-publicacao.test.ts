import { describe, it, expect } from 'vitest';
import {
  lerFormatoPublicacao, confirmarFormatoPublicacao, type FormatoRepo, type FormatoPublicacaoML,
} from '../formato-publicacao';

// Fake in-memory FormatoRepo (as portas puras não conhecem o Supabase).
function fakeRepo(): FormatoRepo {
  const store = new Map<string, FormatoPublicacaoML>();
  const chave = (c: string, cat: string) => `${c}::${cat}`;
  return {
    buscar: (connectionId, categoriaId) => Promise.resolve(store.get(chave(connectionId, categoriaId)) ?? null),
    salvar: (connectionId, categoriaId, formato) => { store.set(chave(connectionId, categoriaId), formato); return Promise.resolve(); },
  };
}

describe('formato-publicacao (cache por conexão+categoria)', () => {
  it('desconhecido quando nunca gravado', async () => {
    const repo = fakeRepo();
    expect(await lerFormatoPublicacao(repo, 'conn-1', 'MLB419782')).toBe('desconhecido');
  });

  it('grava e lê de volta', async () => {
    const repo = fakeRepo();
    await confirmarFormatoPublicacao(repo, 'conn-1', 'MLB419782', 'user_products');
    expect(await lerFormatoPublicacao(repo, 'conn-1', 'MLB419782')).toBe('user_products');
  });

  it('isola por conexão (uma conexão não vaza para outra)', async () => {
    const repo = fakeRepo();
    await confirmarFormatoPublicacao(repo, 'conn-1', 'MLB419782', 'user_products');
    expect(await lerFormatoPublicacao(repo, 'conn-2', 'MLB419782')).toBe('desconhecido');
  });

  it('isola por categoria (mesma conexão, categorias diferentes não vazam)', async () => {
    const repo = fakeRepo();
    await confirmarFormatoPublicacao(repo, 'conn-1', 'MLB419782', 'user_products');
    expect(await lerFormatoPublicacao(repo, 'conn-1', 'MLB271227')).toBe('desconhecido');
  });
});
