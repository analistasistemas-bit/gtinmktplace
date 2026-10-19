// CLI: gera o SQL da tabela oficial de NCM (ADR-0187). Imprime o SQL no stdout.
//   npx tsx scripts/ncm/gerar-sql.ts --modo seed|atualizar --entrada <json>
//       [--atuais <codigos.txt>] [--confirmar-encerramentos=<n>]
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { ausentesParaEncerrar, comporTabelaNcm, sqlAtualizacao, sqlSeed, validarCargaNcm } from './compor'

function abortar(msg: string): never {
  console.error(msg)
  process.exit(1)
}

const { values } = parseArgs({
  options: {
    modo: { type: 'string' },
    entrada: { type: 'string' },
    atuais: { type: 'string' },
    'confirmar-encerramentos': { type: 'string' },
  },
})

if ((values.modo !== 'seed' && values.modo !== 'atualizar') || !values.entrada) {
  abortar('uso: gerar-sql.ts --modo seed|atualizar --entrada <json> [--atuais <txt>] [--confirmar-encerramentos=<n>]')
}

const linhas = comporTabelaNcm(JSON.parse(readFileSync(values.entrada, 'utf8')))
const problemas = validarCargaNcm(linhas)
if (problemas.length > 0) abortar(`carga inválida:\n${problemas.slice(0, 20).join('\n')}`)

if (values.modo === 'seed') {
  process.stdout.write(sqlSeed(linhas) + '\n')
} else {
  if (!values.atuais) abortar('modo atualizar exige --atuais <codigos.txt>')
  const atuais = readFileSync(values.atuais, 'utf8').split(/\s+/).filter(Boolean)
  const c = values['confirmar-encerramentos']
  const r = ausentesParaEncerrar(atuais, linhas, c === undefined ? null : Number(c))
  if ('erro' in r) abortar(r.erro)
  process.stdout.write(sqlAtualizacao(linhas, r.encerrar))
}
