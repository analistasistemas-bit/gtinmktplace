import { describe, expect, it } from 'vitest'
import {
  ausentesParaEncerrar,
  comporTabelaNcm,
  sqlAtualizacao,
  sqlSeed,
  validarCargaNcm,
  type NcmLinha,
} from '../../scripts/ncm/compor'
import { executarCli } from '../../scripts/ncm/gerar-sql'

const no = (Codigo: string, Descricao: string, Data_Inicio = '01/04/2022', Data_Fim = '31/12/9999') => ({
  Codigo,
  Descricao,
  Data_Inicio,
  Data_Fim,
})

const json = {
  Nomenclaturas: [
    no('01', 'Animais vivos.'),
    no('62', 'Vestuário e seus acessórios, de malha.'),
    no(
      '62.03',
      'Ternos (Fatos*), conjuntos, calças, jardineiras, bermudas e <i>shorts</i> (calções) (exceto de banho), de uso masculino.',
    ),
    no('6203.4', '- Calças, jardineiras, bermudas e <i>shorts</i> (calções):'),
    no('6203.42.00', '-- De algodão'),
    no('6203.49.00', '-- De outras matérias têxteis'),
  ],
}

const linha = (codigo: string, dataFim = '9999-12-31'): NcmLinha => ({
  codigo,
  descricao: `d ${codigo}`,
  dataInicio: '2022-04-01',
  dataFim,
})
const muitas = (n: number) => Array.from({ length: n }, (_, i) => linha(String(10000000 + i)))

describe('comporTabelaNcm', () => {
  const linhas = comporTabelaNcm(json)

  it('só códigos de 8 dígitos viram linha, sem pontos', () => {
    expect(linhas.map((l) => l.codigo)).toEqual(['62034200', '62034900'])
  })

  it('compõe a descrição pelos ancestrais, sem HTML nem travessões', () => {
    const d = linhas.find((l) => l.codigo === '62034900')!.descricao
    expect(d.startsWith('Ternos (Fatos), conjuntos, calças')).toBe(true)
    expect(d).not.toContain('*')
    expect(d).toContain('Calças, jardineiras, bermudas e shorts (calções)')
    expect(d).not.toMatch(/<i>|- |:/)
    expect(d.endsWith('De outras matérias têxteis')).toBe(true)
    expect(d).toContain(' › ')
    expect(d).not.toContain('Vestuário')
  })

  it('converte datas dd/mm/aaaa para ISO', () => {
    expect(linhas[0].dataInicio).toBe('2022-04-01')
    expect(linhas[0].dataFim).toBe('9999-12-31')
  })
})

describe('validarCargaNcm', () => {
  it('aceita carga válida', () => {
    expect(validarCargaNcm(muitas(10000))).toEqual([])
  })
  it('acusa contagem, duplicado, data inválida e início > fim', () => {
    expect(validarCargaNcm(muitas(9999)).join()).toMatch(/9999/)
    expect(validarCargaNcm([...muitas(10000), linha('10000000')]).join()).toContain('10000000')
    const ruim = comporTabelaNcm({ Nomenclaturas: [no('6203.49.00', 'x', '01/04/2022', '31/02/2026')] })
    expect(validarCargaNcm([...muitas(10000), ...ruim]).join()).toContain('62034900')
    expect(validarCargaNcm([...muitas(10000), linha('99999999', '2000-01-01')]).join()).toContain('99999999')
  })
})

describe('sql', () => {
  it('sqlSeed escapa aspas e agrupa em lotes de 1000', () => {
    const sql = sqlSeed([{ ...linha('11111111'), descricao: "d'água" }, ...muitas(1000)])
    expect(sql).toContain("'d''água'")
    expect(sql.match(/insert into public\.ncm_oficial/g)).toHaveLength(2)
    expect(sql.match(/on conflict \(codigo\) do nothing;/g)).toHaveLength(2)
  })
  it('sqlAtualizacao sem encerrar não encerra nada', () => {
    const sql = sqlAtualizacao([linha('11111111')], [])
    expect(sql).not.toMatch(/\b(begin|commit);/)
    expect(sql).toContain('on conflict (codigo) do update set')
    expect(sql).not.toContain('current_date - 1')
  })
  it('sqlAtualizacao encerra só os confirmados', () => {
    const sql = sqlAtualizacao([linha('22222222')], ['11111111'])
    expect(sql).toContain('current_date - 1')
    expect(sql).toContain("array['11111111']")
  })
})

describe('ausentesParaEncerrar', () => {
  const linhas = muitas(10001)
  const atuais = [...linhas.map((l) => l.codigo), '75937727']
  it('sem confirmação aborta citando o código', () => {
    const r = ausentesParaEncerrar(atuais, linhas, null)
    expect('erro' in r && r.erro).toContain('75937727')
  })
  it('confirmação igual à quantidade encerra', () => {
    expect(ausentesParaEncerrar(atuais, linhas, 1)).toEqual({ encerrar: ['75937727'] })
  })
  it('confirmação diferente aborta', () => {
    expect('erro' in ausentesParaEncerrar(atuais, linhas, 2)).toBe(true)
  })
  it('nenhum ausente não exige confirmação', () => {
    expect(ausentesParaEncerrar(linhas.map((l) => l.codigo), linhas, null)).toEqual({ encerrar: [] })
  })
})

describe('executarCli', () => {
  const entrada = JSON.stringify({
    Nomenclaturas: muitas(10001).map((l) => no(l.codigo.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3'), 'x')),
  })
  const arquivos: Record<string, string> = {
    'e.json': entrada,
    'a.txt': '10000000 75937727\n',
  }
  const ler = (p: string) => arquivos[p]
  const base = ['--modo', 'atualizar', '--entrada', 'e.json', '--atuais', 'a.txt']

  it('confirmação exata: exit 0, SQL no stdout, códigos encerrados no stderr', () => {
    const r = executarCli([...base, '--confirmar-encerramentos=1'], ler)
    expect(r.codigo).toBe(0)
    expect(r.stderr).toContain('75937727')
    expect(r.stdout).toContain("array['75937727']")
  })
  it('sem confirmação: exit 1, stdout vazio, código no stderr', () => {
    const r = executarCli(base, ler)
    expect(r.codigo).toBe(1)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('75937727')
  })
  it('seed: exit 0 com inserts', () => {
    const r = executarCli(['--modo', 'seed', '--entrada', 'e.json'], ler)
    expect(r.codigo).toBe(0)
    expect(r.stdout).toContain('insert into public.ncm_oficial')
  })
})
