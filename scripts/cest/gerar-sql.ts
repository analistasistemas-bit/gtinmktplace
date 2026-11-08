// CLI: gera o SQL da tabela oficial de CEST (ADR-0197). Imprime o SQL no stdout.
//   deno run --allow-read scripts/cest/gerar-sql.ts <html do Convênio 142/18>
// ponytail: o upsert não remove CEST revogado depois da carga; um refresh com revogação precisa de DELETE à mão.
import { comporTabelaCest, sqlSeedCest } from './compor.ts'

const MINIMO_LINHAS = 1000

const caminho = Deno.args[0]
if (!caminho) {
  console.error('uso: gerar-sql.ts <html do Convênio 142/18>')
  Deno.exit(1)
}
const { linhas, problemas } = comporTabelaCest(Deno.readTextFileSync(caminho))
if (problemas.length > 0 || linhas.length < MINIMO_LINHAS) {
  console.error(`carga inválida: ${linhas.length} linhas\n${problemas.slice(0, 20).join('\n')}`)
  Deno.exit(1)
}
console.log(sqlSeedCest(linhas))
