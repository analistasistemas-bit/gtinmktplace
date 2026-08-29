#!/usr/bin/env node
// Verifica que todo link markdown para outro arquivo .md dentro de docs/ aponta para um arquivo
// que existe. Nasceu de 36 links quebrados encontrados de uma vez (2026-08-28), quase todos
// ADRs citando outra ADR pelo nome de antes de um rename — o prefixo numérico batia, o nome não.
//
// Só valida a EXISTÊNCIA do arquivo. Âncoras (#secao) são ignoradas de propósito: validá-las
// exigiria parsear títulos e a taxa de falso positivo não compensa.
//
// Uso: node scripts/checar-links-docs.mjs   (sai 1 se houver link quebrado)

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'

const RAIZ = resolve(import.meta.dirname, '..')
const ESCOPO = join(RAIZ, 'docs')

function arquivosMd(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) return arquivosMd(caminho)
    return caminho.endsWith('.md') ? [caminho] : []
  })
}

// [texto](destino) — captura o destino, que pode trazer âncora e %20
const LINK = /\]\(([^)\s]+)\)/g

const quebrados = []

for (const arquivo of arquivosMd(ESCOPO)) {
  const conteudo = readFileSync(arquivo, 'utf8')
  for (const [, destinoBruto] of conteudo.matchAll(LINK)) {
    const destino = decodeURIComponent(destinoBruto.split('#')[0])
    if (!destino) continue
    if (/^[a-z]+:/i.test(destinoBruto)) continue // http:, https:, mailto:

    // Caminho absoluto da máquina de alguém nunca resolve para outra pessoa nem no GitHub.
    // Vale para QUALQUER destino, não só .md — havia links assim para o diretório docs/decisions.
    if (destino.startsWith('/')) {
      quebrados.push({ arquivo, destino, motivo: 'caminho absoluto' })
      continue
    }
    // Existência só para .md: destinos de outros tipos entram e saem do repo com frequência
    // e não valem o falso positivo.
    if (!destino.endsWith('.md')) continue
    if (!existsSync(resolve(dirname(arquivo), destino))) {
      quebrados.push({ arquivo, destino, motivo: 'arquivo não existe' })
    }
  }
}

if (quebrados.length === 0) {
  console.log('✓ links de docs/ ok — nenhum destino quebrado')
  process.exit(0)
}

console.error(`✗ ${quebrados.length} link(s) quebrado(s) em docs/:\n`)
for (const { arquivo, destino, motivo } of quebrados) {
  console.error(`  ${relative(RAIZ, arquivo)}`)
  console.error(`    -> ${destino}  (${motivo})`)
}
console.error('\nCorrija o destino ou remova o link.')
process.exit(1)
