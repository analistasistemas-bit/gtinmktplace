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
        rotulo: 'média mensal dos últimos 12 meses — loja inteira (102 vendedores estabelecidos)',
      },
      '3.3': {
        com_estimativa: 102,
        vendedores_distintos: 126,
        estabelecidos: 110,
        proporcao: 102 / 126,
        anuncios_na_amostra: 20,
        anuncios_com_catalogo: 9,
        proporcao_anuncios: 9 / 20,
        rotulo: '9 de 20 anúncios da amostra têm catálogo — 102 de 110 vendedores estabelecidos com estimativa mensal',
      },
      '3.4': { contagem: 24, total_no_catalogo: 134, rotulo: '24 de 134 concorrentes ficaram de fora: menos de 50 vendas na vida' },
      '3.6': {
        estabelecidos: 50,
        crescendo: 37,
        estaveis: 8,
        encolhendo: 5,
        sem_serie: 0,
        proporcao_crescendo: 37 / 50,
        dias_janela: 10,
        base_pequena: false,
        rotulo: '37 de 50 vendedores estabelecidos vendendo mais que há um ano '
          + '(comparado com os mesmos 10 dias de 12 meses atrás)',
      },
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

describe('SonarAnalisePubliAI — ADR-0146', () => {
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

    const vendedores = screen.getByText(/vendedores estabelecidos com estimativa mensal/);
    expect(vendedores.textContent).toContain('102 de 110');
    expect(vendedores.textContent).toContain('fora da conta');
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

  it('exibe os dois KpiCard lado a lado: tendência e média mensal', () => {
    render237(resposta());
    expect(screen.getByText('Concorrentes vendendo mais que há um ano')).toBeInTheDocument();
    expect(screen.getByText('37 de 50')).toBeInTheDocument();
    expect(screen.getByText('Média mensal por vendedor (12 meses)')).toBeInTheDocument();
    expect(screen.getByText('0 un./mês')).toBeInTheDocument();
  });

  it('mostra a linha dos três estados: crescendo, estáveis, encolhendo', () => {
    render237(resposta());
    expect(screen.getByText('37 crescendo · 8 estáveis · 5 encolhendo')).toBeInTheDocument();
  });

  it('3.2 sem_dado com estabelecidos > 0: a tendência continua aparecendo (ADR-0145 D-3)', () => {
    render237(resposta({
      '3.2': { estado: 'sem_dado', mensagem: 'amostra insuficiente: 3 de 5 vendedores estabelecidos mínimos com estimativa mensal' },
    }));
    expect(screen.getByText('Concorrentes vendendo mais que há um ano')).toBeInTheDocument();
    expect(screen.getByText('37 de 50')).toBeInTheDocument();
  });

  it('base pequena mostra aviso curto', () => {
    render237(resposta({
      '3.6': {
        estabelecidos: 3, crescendo: 2, estaveis: 1, encolhendo: 0, sem_serie: 0,
        proporcao_crescendo: 2 / 3, dias_janela: 10, base_pequena: true,
        rotulo: '2 de 3 vendedores estabelecidos vendendo mais que há um ano',
      },
    }));
    expect(screen.getByText(/Base pequena/)).toBeInTheDocument();
  });

  it('todos os estabelecidos com um único snapshot (sem_serie = estabelecidos): o card de '
    + 'tendência e a linha dos três estados somem — 0 de 0 seria número fabricado (ADR-0146 D-2)', () => {
    render237(resposta({
      '3.6': {
        estabelecidos: 4, crescendo: 0, estaveis: 0, encolhendo: 0, sem_serie: 4,
        proporcao_crescendo: null, dias_janela: null, base_pequena: true,
        rotulo: '0 de 0 vendedores estabelecidos vendendo mais que há um ano',
      },
    }));
    expect(screen.queryByText('Concorrentes vendendo mais que há um ano')).toBeNull();
    expect(screen.queryByText(/crescendo ·/)).toBeNull();
    expect(screen.getByText('Média mensal por vendedor (12 meses)')).toBeInTheDocument();
  });

  it('sem vendedor estabelecido nenhum, o card de tendência não aparece', () => {
    render237(resposta({
      '3.6': {
        estabelecidos: 0, crescendo: 0, estaveis: 0, encolhendo: 0, sem_serie: 0,
        proporcao_crescendo: null, dias_janela: null, base_pequena: false,
        rotulo: 'nenhum vendedor estabelecido nos catálogos desta amostra',
      },
    }));
    expect(screen.queryByText('Concorrentes vendendo mais que há um ano')).toBeNull();
    expect(screen.getByText('Média mensal por vendedor (12 meses)')).toBeInTheDocument();
  });

  it('cabeçalho declara média dos últimos 12 meses, loja inteira do vendedor', () => {
    render237(resposta());
    expect(screen.getByText('média dos últimos 12 meses · loja inteira do vendedor')).toBeInTheDocument();
  });

  it('nenhum texto renderizado contém "365"', () => {
    const { container } = render237(resposta());
    expect(container.textContent).not.toMatch(/365/);
  });
});
