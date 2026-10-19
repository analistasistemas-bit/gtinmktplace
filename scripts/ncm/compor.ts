// Composição da tabela oficial de NCM (JSON do Siscomex) e geração de SQL — ADR-0187.
// Puro: sem I/O. O CLI está em gerar-sql.ts.

export type NcmLinha = { codigo: string; descricao: string; dataInicio: string; dataFim: string }

type NoSiscomex = { Codigo: string; Descricao: string; Data_Inicio: string; Data_Fim: string }

const MIN_CODIGOS = 10000

const soDigitos = (s: string) => s.replace(/\D/g, '')

// "- Calças ... <i>shorts</i>:" -> "Calças ... shorts"
function limpar(descricao: string): string {
  return descricao
    .replace(/<[^>]*>/g, '')
    .replace(/\*/g, '') // nota de rodapé do Siscomex: "(Fatos*)" -> "(Fatos)"
    .replace(/^\s*-+\s*/, '')
    .replace(/:\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// "31/12/9999" -> "9999-12-31". Não valida o calendário (validarCargaNcm faz).
function dataIso(br: string): string {
  const [d, m, a] = br.split('/')
  return `${a}-${m}-${d}`
}

export function comporTabelaNcm(json: { Nomenclaturas: NoSiscomex[] }): NcmLinha[] {
  const porDigitos = new Map<string, NoSiscomex>()
  for (const n of json.Nomenclaturas) porDigitos.set(soDigitos(n.Codigo), n)

  const linhas: NcmLinha[] = []
  for (const n of json.Nomenclaturas) {
    const codigo = soDigitos(n.Codigo)
    if (codigo.length !== 8) continue
    // Ancestrais por prefixo de dígitos: posição (4), depois 5, 6, 7. Capítulo (2) fora.
    const partes: string[] = []
    for (const tam of [4, 5, 6, 7]) {
      const anc = porDigitos.get(codigo.slice(0, tam))
      if (anc) partes.push(limpar(anc.Descricao))
    }
    partes.push(limpar(n.Descricao))
    linhas.push({
      codigo,
      descricao: partes.join(' › '),
      dataInicio: dataIso(n.Data_Inicio),
      dataFim: dataIso(n.Data_Fim),
    })
  }
  return linhas
}

function dataValida(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return false
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

export function validarCargaNcm(linhas: NcmLinha[]): string[] {
  const problemas: string[] = []
  if (linhas.length < MIN_CODIGOS) {
    problemas.push(`só ${linhas.length} códigos (mínimo ${MIN_CODIGOS})`)
  }
  const vistos = new Set<string>()
  for (const l of linhas) {
    if (vistos.has(l.codigo)) problemas.push(`código duplicado: ${l.codigo}`)
    vistos.add(l.codigo)
    if (!dataValida(l.dataInicio) || !dataValida(l.dataFim)) {
      problemas.push(`data inválida em ${l.codigo}: ${l.dataInicio} / ${l.dataFim}`)
    } else if (l.dataInicio > l.dataFim) {
      problemas.push(`data_inicio > data_fim em ${l.codigo}`)
    }
  }
  return problemas
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`
const valores = (l: NcmLinha) => `(${q(l.codigo)}, ${q(l.descricao)}, ${q(l.dataInicio)}, ${q(l.dataFim)})`

export function sqlSeed(linhas: NcmLinha[]): string {
  const lotes: string[] = []
  for (let i = 0; i < linhas.length; i += 1000) {
    lotes.push(
      `insert into public.ncm_oficial (codigo, descricao, data_inicio, data_fim) values\n` +
        linhas.slice(i, i + 1000).map(valores).join(',\n') +
        ';',
    )
  }
  return lotes.join('\n')
}

export function sqlAtualizacao(linhas: NcmLinha[], encerrar: string[]): string {
  const partes = ['begin;']
  for (let i = 0; i < linhas.length; i += 1000) {
    partes.push(
      `insert into public.ncm_oficial (codigo, descricao, data_inicio, data_fim) values\n` +
        linhas.slice(i, i + 1000).map(valores).join(',\n') +
        `\non conflict (codigo) do update set descricao = excluded.descricao, ` +
        `data_inicio = excluded.data_inicio, data_fim = excluded.data_fim, atualizado_em = now();`,
    )
  }
  if (encerrar.length > 0) {
    partes.push(
      `update public.ncm_oficial set data_fim = current_date - 1, atualizado_em = now() ` +
        `where codigo = any(array[${encerrar.map(q).join(', ')}]) and data_fim >= current_date;`,
    )
  }
  partes.push('commit;')
  return partes.join('\n') + '\n'
}

// Códigos vigentes hoje na tabela e ausentes do JSON só são encerrados com confirmação
// explícita da quantidade (JSON parcial acima do mínimo não pode extinguir código válido).
export function ausentesParaEncerrar(
  atuais: string[],
  linhas: NcmLinha[],
  confirmados: number | null,
): { encerrar: string[] } | { erro: string } {
  const noJson = new Set(linhas.map((l) => l.codigo))
  const ausentes = atuais.filter((c) => !noJson.has(c))
  if (ausentes.length === 0) return { encerrar: [] }
  if (confirmados !== ausentes.length) {
    return {
      erro:
        `${ausentes.length} código(s) vigentes ausentes do JSON: ${ausentes.join(', ')}. ` +
        `Confira com a resolução Gecex e rode com --confirmar-encerramentos=${ausentes.length}.`,
    }
  }
  return { encerrar: ausentes }
}
