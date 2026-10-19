// CLI: gera o SQL da tabela oficial de NCM (ADR-0187). Imprime o SQL no stdout.
//   deno run --allow-read scripts/ncm/gerar-sql.ts --modo seed|atualizar --entrada <json> \
//       [--atuais <codigos.txt>] [--confirmar-encerramentos=<n>]
import { ausentesParaEncerrar, comporTabelaNcm, sqlAtualizacao, sqlSeed, validarCargaNcm } from './compor.ts'

export type SaidaCli = { codigo: number; stdout: string; stderr: string }

const USO = 'uso: gerar-sql.ts --modo seed|atualizar --entrada <json> [--atuais <txt>] [--confirmar-encerramentos=<n>]'

// Fluxo do CLI sem I/O direto: argv e leitura de arquivo entram por parâmetro (testável).
export function executarCli(argv: string[], lerArquivo: (caminho: string) => string): SaidaCli {
  const erro = (stderr: string): SaidaCli => ({ codigo: 1, stdout: '', stderr: stderr + '\n' })
  const opt: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i])
    if (!m) return erro(USO)
    opt[m[1]] = m[2] ?? argv[++i] ?? ''
  }

  if ((opt.modo !== 'seed' && opt.modo !== 'atualizar') || !opt.entrada) return erro(USO)

  const linhas = comporTabelaNcm(JSON.parse(lerArquivo(opt.entrada)))
  const problemas = validarCargaNcm(linhas)
  if (problemas.length > 0) return erro(`carga inválida:\n${problemas.slice(0, 20).join('\n')}`)

  if (opt.modo === 'seed') return { codigo: 0, stdout: sqlSeed(linhas) + '\n', stderr: '' }

  if (!opt.atuais) return erro('modo atualizar exige --atuais <codigos.txt>')
  const atuais = lerArquivo(opt.atuais).split(/\s+/).filter(Boolean)
  const c = opt['confirmar-encerramentos']
  const r = ausentesParaEncerrar(atuais, linhas, c === undefined ? null : Number(c))
  if ('erro' in r) return erro(r.erro)
  const aviso = r.encerrar.length > 0 ? `encerrando ${r.encerrar.length} código(s): ${r.encerrar.join(', ')}\n` : ''
  return { codigo: 0, stdout: sqlAtualizacao(linhas, r.encerrar), stderr: aviso }
}

// ponytail: `Deno` declarado à mão; o script só roda sob `deno run` (vitest importa só executarCli).
declare const Deno: {
  args: string[]
  readTextFileSync(p: string): string
  stdout: { writeSync(b: Uint8Array): number }
  exit(c: number): never
}

if ((import.meta as { main?: boolean }).main) {
  const enc = new TextEncoder()
  const s = executarCli(Deno.args, (p) => Deno.readTextFileSync(p))
  if (s.stderr) console.error(s.stderr.trimEnd())
  if (s.stdout) Deno.stdout.writeSync(enc.encode(s.stdout))
  Deno.exit(s.codigo)
}
