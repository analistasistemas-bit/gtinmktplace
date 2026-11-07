import { describe, it, expect } from 'vitest';
import { carregarCatalogo } from '../io';

/**
 * Incidente 2026-08-11 (org DSA): `carregarCatalogo` filtrava `familias`/`variacoes` por
 * `user_id` — o `criado_por` da conexão do canal. Produto cadastrado por OUTRO membro da mesma
 * org ficava fora do catálogo, a venda vinha com `is_publiai = false` e SEM código, e a baixa
 * de estoque descartava o item em silêncio: 12 unidades venderam sem baixar nada.
 *
 * O fake registra os filtros aplicados por tabela — é exatamente isso que o teste protege.
 */
function criarAdminFake(conexao: { org_id: string } | null) {
  const filtros: Array<{ tabela: string; coluna: string; valor: string }> = [];

  function query(tabela: string) {
    const alvo = {
      select: () => alvo,
      not: () => alvo,
      eq: (coluna: string, valor: string) => {
        filtros.push({ tabela, coluna, valor });
        return alvo;
      },
      range: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () => Promise.resolve({ data: conexao, error: null }),
    };
    return alvo;
  }

  return { filtros, from: (tabela: string) => query(tabela) };
}

const ORG = 'org-1111';
const USER = 'user-2222';

/** `variacoes` responde uma página cheia e erra na seguinte. */
function adminComFalhaNaPagina2() {
  let chamadas = 0;
  const query = (tabela: string) => {
    const alvo = {
      select: () => alvo,
      not: () => alvo,
      eq: () => alvo,
      range: () => {
        if (tabela !== 'variacoes') return Promise.resolve({ data: [], error: null });
        chamadas += 1;
        return Promise.resolve(chamadas === 1
          ? { data: Array.from({ length: 1000 }, () => ({ familia_id: 'f', codigo: 'SKU' })), error: null }
          : { data: null, error: { message: 'timeout na página 2' } });
      },
    };
    return alvo;
  };
  return { from: query };
}

describe('carregarCatalogo — estrito', () => {
  it('sucesso seguido de falha lança no modo estrito', async () => {
    await expect(carregarCatalogo(adminComFalhaNaPagina2() as never, USER, ORG, { estrito: true }))
      .rejects.toThrow('timeout na página 2');
  });

  it('sem o modo estrito segue tolerante, para os chamadores atuais', async () => {
    await expect(carregarCatalogo(adminComFalhaNaPagina2() as never, USER, ORG)).resolves.toBeDefined();
  });
});

describe('carregarCatalogo — escopo', () => {
  it('filtra famílias e variações por org_id quando há conexão', async () => {
    const admin = criarAdminFake({ org_id: ORG });
    await carregarCatalogo(admin as never, USER);

    const familias = admin.filtros.filter((f) => f.tabela === 'familias');
    const variacoes = admin.filtros.filter((f) => f.tabela === 'variacoes');
    expect(familias).toEqual([{ tabela: 'familias', coluna: 'org_id', valor: ORG }]);
    expect(variacoes).toEqual([{ tabela: 'variacoes', coluna: 'org_id', valor: ORG }]);
  });

  it('nunca filtra o catálogo por user_id quando a org foi resolvida', async () => {
    const admin = criarAdminFake({ org_id: ORG });
    await carregarCatalogo(admin as never, USER);
    const porUsuario = admin.filtros.filter(
      (f) => f.coluna === 'user_id' && (f.tabela === 'familias' || f.tabela === 'variacoes'),
    );
    expect(porUsuario).toEqual([]);
  });

  // Sem conexão não há org para resolver. Cair para o comportamento antigo é melhor que
  // devolver catálogo vazio, que faria TODA venda parecer de terceiro.
  it('cai para user_id quando não há conexão do canal', async () => {
    const admin = criarAdminFake(null);
    await carregarCatalogo(admin as never, USER);

    const familias = admin.filtros.filter((f) => f.tabela === 'familias');
    expect(familias).toEqual([{ tabela: 'familias', coluna: 'user_id', valor: USER }]);
  });

  it('resolve a org uma vez só, não uma por consulta', async () => {
    const admin = criarAdminFake({ org_id: ORG });
    await carregarCatalogo(admin as never, USER);
    const conexoes = admin.filtros.filter((f) => f.tabela === 'marketplace_connections');
    // canal + criado_por = 2 filtros de UMA única resolução.
    expect(conexoes).toHaveLength(2);
  });
});
