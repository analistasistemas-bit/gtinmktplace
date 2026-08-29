import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RespostaSecoes237Sonar, Secoes237Sonar } from '@/lib/sonar';
import { SonarAnalisePubliAI } from '../sonar-analise-publiai';

function resposta(over: Partial<Secoes237Sonar> = {}): RespostaSecoes237Sonar {
  return {
    conectado: true,
    secoes237: {
      '2.9': { estado: 'sem_dado', mensagem: 'o faturamento do nicho não é publicado (ADR-0143)' },
      '3.2': {
        estado: 'valor',
        vendas_mes_mediana: 0,
        vendedores_com_estimativa: 102,
        rotulo: 'mediana de vendas/mês — vendedores que disputam os catálogos desta amostra (102 vendedores)',
      },
      '3.3': {
        com_estimativa: 102,
        vendedores_distintos: 126,
        proporcao: 102 / 126,
        anuncios_na_amostra: 20,
        anuncios_com_catalogo: 9,
        proporcao_anuncios: 9 / 20,
        rotulo: '9 de 20 anúncios da amostra têm catálogo — 102 de 126 vendedores com estimativa mensal',
      },
      '3.4': { contagem: 24, rotulo: '24 vendedores sem estimativa mensal' },
      limitacao_3_2: 'loja inteira do vendedor; catálogos desta amostra',
      '7.4': null,
      ...over,
    },
    meta: {
      vendedores_distintos: 126, sem_seller_id: 11, serie_linhas: 900,
      anuncios_na_amostra: 20, catalogos_consultados: 9, catalogos_com_falha: 0,
    },
  };
}

const render237 = (data: RespostaSecoes237Sonar) =>
  render(<SonarAnalisePubliAI data={data} carregando={false} erro={null} />);

describe('SonarAnalisePubliAI — ADR-0143', () => {
  it('mediana zero aparece como número medido, nunca como ausência', () => {
    render237(resposta());
    expect(screen.getByText('0 un./mês')).toBeInTheDocument();
    expect(screen.queryByText(/sem estimativa no período/i)).toBeNull();
  });

  it('não exibe valor de faturamento — só o motivo de ele não existir', () => {
    const { container } = render237(resposta());
    expect(container.textContent).not.toMatch(/R\$/);
    expect(container.textContent).not.toMatch(/comporta entrada/i);
    expect(container.textContent).not.toMatch(/meta de entrada/i);
    // 2.9 permanece como ausência declarada (ADR-0143 D-3), e o operador lê o motivo.
    expect(screen.getByText(/não é publicado/)).toBeInTheDocument();
  });

  it('o percentual acompanha os anúncios, não a contagem de vendedores (spike 045)', () => {
    render237(resposta());
    const anuncios = screen.getByText(/anúncios da amostra têm catálogo/);
    expect(anuncios.textContent).toContain('9 de 20');
    expect(anuncios.textContent).toContain('45%');
    expect(anuncios.textContent).not.toContain('vendedores');

    const vendedores = screen.getByText(/vendedores com estimativa mensal/);
    expect(vendedores.textContent).toContain('102 de 126');
    expect(vendedores.textContent).toContain('24 sem estimativa');
    expect(vendedores.textContent).not.toMatch(/\d+%/);
  });

  it('o percentual de 7.4 carrega o próprio denominador, não o de 3.3', () => {
    render237(resposta({
      '7.4': {
        elegiveis: 5, vendedores_distintos: 5, top1: 0.949, corte: 0.4, dominante: true,
        rotulo: 'concentração por vendedor — 5 com venda registrada na amostra',
      },
    }));
    const linha = screen.getByText(/Top vendedor/);
    // 3.3 fala de 126 vendedores; este 95% é sobre 5 e precisa dizer isso na mesma frase.
    expect(linha.textContent).toContain('95% de 5 com venda registrada na amostra');
    expect(linha.textContent).toContain('dominante');
  });

  it('sem conexão do ML explica em vez de dar erro', () => {
    render237({ conectado: false });
    expect(screen.getByText(/Conecte o Mercado Livre/)).toBeInTheDocument();
  });

  it('3.2 sem dado ainda mostra a cobertura — o operador precisa saber por quê', () => {
    render237(resposta({
      '3.2': { estado: 'sem_dado', mensagem: 'amostra insuficiente: 1 de 5 vendedores mínimos com estimativa mensal' },
    }));
    expect(screen.getByText(/amostra insuficiente: 1 de 5/)).toBeInTheDocument();
    expect(screen.getByText(/anúncios da amostra têm catálogo/).textContent).toContain('9 de 20');
  });
});
