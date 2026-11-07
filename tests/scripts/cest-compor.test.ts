import { describe, expect, it } from 'vitest';
import { comporTabelaCest, sqlSeedCest } from '../../scripts/cest/compor';

const p = (t: string, c = 'A7-2Tabelajustificado') => `<td><p class="${c}">${t}</p></td>`;
const linha = (item: string, cest: string, ncm: string, desc: string, c?: string) =>
  `<tr>${p(item, c)}${p(cest, c)}${p(ncm, c)}${p(desc, c)}</tr>`;
const anexo = (n: string, ...linhas: string[]) => `<p class="x">ANEXO ${n}</p><table>${linhas.join('')}</table>`;

describe('comporTabelaCest (ADR-0197)', () => {
  it('expande a célula de NCM em prefixos sem ponto, com <br> e vírgula final', () => {
    const { linhas, problemas } = comporTabelaCest(anexo('XIX',
      linha('1.0', '20.001.00', '3304.99.10<br> 3305', 'Cremes &amp; loções'),
      linha('2.0', '20.002.00', '8704.31.30,', 'Veículos'),
    ));
    expect(problemas).toEqual([]);
    expect(linhas).toEqual([
      { cest: '2000100', ncmPrefixo: '33049910', anexo: 'XIX', item: '1.0', descricao: 'Cremes & loções' },
      { cest: '2000100', ncmPrefixo: '3305', anexo: 'XIX', item: '1.0', descricao: 'Cremes & loções' },
      { cest: '2000200', ncmPrefixo: '87043130', anexo: 'XIX', item: '2.0', descricao: 'Veículos' },
    ]);
  });

  it('ignora redação anterior, item revogado e anexos fora de II a XXV', () => {
    const { linhas, problemas } = comporTabelaCest(
      anexo('I', linha('1.0', '99.001.00', '1111', 'Anexo I'))
      + anexo('IV',
        linha('1.0', '03.001.00', '2201', 'Antiga', 'A9-2Tabelajustificadoverde'),
        linha('2.0', '03.002.00', '2202', 'REVOGADO'),
        linha('3.0', '03.003.00', '2203', 'Vigente'))
      + anexo('XXVI', linha('1.0', '28.001.00', '3304', 'Porta a porta'))
      + anexo('XXVII', linha('1.0', '03.003.00', '2203', 'Escala não relevante')),
    );
    expect(problemas).toEqual([]);
    expect(linhas.map((l) => l.cest)).toEqual(['0300300']);
  });

  it('anomalia conhecida é ignorada e anomalia nova vira problema', () => {
    const { linhas, problemas } = comporTabelaCest(anexo('XIX',
      linha('40.0', '20.040.00', '3924.90.00 926.90.90', 'Chupetas'),
      linha('116.0', '17.116.00', '008.13 009.09', 'Sementes'),
      linha('999.0', '01.999.00', '', 'Outras peças'),
      linha('5.0', '20.005.00', '12.34', 'Erro novo'),
      linha('6.0', '20.006.00', '', 'Sem NCM novo'),
    ));
    expect(linhas.map((l) => l.ncmPrefixo)).toEqual(['39249000']);
    expect(problemas).toEqual(['2000500: NCM "12.34" fora do padrão', '2000600: linha sem NCM']);
  });

  it('o mesmo par CEST e NCM repetido entra uma vez', () => {
    const { linhas } = comporTabelaCest(anexo('II',
      linha('1.0', '01.001.00', '8421', 'A'), linha('1.1', '01.001.00', '8421', 'A')));
    expect(linhas).toHaveLength(1);
  });

  it('sqlSeedCest escapa aspas', () => {
    const sql = sqlSeedCest([{ cest: '2000100', ncmPrefixo: '3304', anexo: 'XIX', item: '1.0', descricao: "d'água" }]);
    expect(sql).toContain("('2000100', '3304', 'XIX', '1.0', 'd''água')");
  });
});
