import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin } from './fake-admin'
import { avisarPedidosProntos } from '../aviso-pronto'

type Linha = Record<string, unknown>
const T0 = Date.parse('2026-11-12T12:00:00Z')
const min = (n: number) => new Date(T0 + n * 60_000).toISOString()
const APP = 'https://app.publiai.com.br/'
const LINK = 'https://app.publiai.com.br/#/publicados/MLB123/galeria'

let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let enviar: ReturnType<typeof vi.fn>
let agora: Date

const pedido = (id: string, extra: Linha = {}): Linha => ({
  id, org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'fam', criado_por: 'u1', criado_em: min(-10), ...extra,
})
// Imagem do plano formato 2 (rot2) por padrão; rot1 = roteiro do formato antigo.
const img = (pedido_id: string, status: string, extra: Linha = {}): Linha => ({
  pedido_id, status, alertas: status === 'gerada' || status === 'aprovada' ? [] : null, cena_path: 'c.jpg', roteiro_id: 'rot2', ...extra,
})
const PLANO2 = { formato: 2, imagens: [1, 2, 3, 4, 5, 6, 7].map((posicao) => ({ posicao, textos: [], prompt: 'p' })) }
const ANTIGO = { versao: 1, imagens: [{ missao: 1, texto: 'x' }] }

beforeEach(() => {
  agora = new Date(T0)
  db = {
    galeria_pedidos: [], galeria_imagens: [], notificacoes: [], ml_notificacoes_enviadas: [],
    anuncios_externos: [{ id: 'an1', org_id: 'org', item_externo_id: 'MLB123' }],
    anuncios_externos_itens: [],
    familias: [{ id: 'fam', org_id: 'org', titulo_ml: 'Fio Amigurumi 254 m', nome_pai: 'FIO AMIG' }],
    configuracoes: [{ org_id: 'org', telegram_bot_token: 'tok', telegram_chat_id: null, telegram_ativo: true }],
    profiles: [{ id: 'u1', org_id: 'org', telegram_chat_id: '111' }, { id: 'u2', org_id: 'org', telegram_chat_id: '222' }],
    galeria_roteiros: [{ id: 'rot2', org_id: 'org', conteudo: PLANO2 }, { id: 'rot1', org_id: 'org', conteudo: ANTIGO }],
  }
  fake = fakeAdmin(db)
  enviar = vi.fn(async () => true)
})

const rodar = () => avisarPedidosProntos(fake.admin as never, { agora, appUrl: APP, enviar: enviar as never })
const avisos = () => db.notificacoes

describe('avisarPedidosProntos', () => {
  it('sem pedidos na janela → 0 e nenhuma outra consulta', async () => {
    expect(await rodar()).toBe(0)
    expect(fake.escritas).toEqual([])
  })

  it('imagem ainda aberta → não avisa', async () => {
    db.galeria_pedidos.push(pedido('p1'))
    db.galeria_imagens.push(img('p1', 'gerada'), img('p1', 'gerando'))
    expect(await rodar()).toBe(0)
    expect(avisos()).toEqual([])
  })

  it('gerada ainda sem conferência (alertas nulo) → não avisa', async () => {
    db.galeria_pedidos.push(pedido('p1'))
    db.galeria_imagens.push(img('p1', 'gerada', { alertas: null }))
    expect(await rodar()).toBe(0)
    expect(avisos()).toEqual([])
  })

  it('pronta → avisa uma vez com texto e link; 2º tick não repete nem manda Telegram', async () => {
    db.galeria_pedidos.push(pedido('p1'))
    db.galeria_imagens.push(img('p1', 'gerada'), img('p1', 'aprovada'), img('p1', 'falhou'))
    expect(await rodar()).toBe(1)
    const texto = `Suas imagens ficaram prontas: Fio Amigurumi 254 m. 2 para conferir, 1 não saiu. Abra para aprovar: ${LINK}`
    expect(avisos()).toEqual([expect.objectContaining({ user_id: 'u1', org_id: 'org', categoria: 'imagem_ia', texto, chave: 'galeria_pronta:p1' })])
    expect(enviar).toHaveBeenCalledWith('tok', '111', texto)
    agora = new Date(T0 + 60_000)
    expect(await rodar()).toBe(0)
    expect(avisos()).toHaveLength(1)
    expect(enviar).toHaveBeenCalledTimes(1)
  })

  it('família e perfil de outra org com o mesmo id não são usados (título genérico, sem Telegram)', async () => {
    db.familias = [{ id: 'fam', org_id: 'outra', titulo_ml: 'Anúncio de outra org', nome_pai: 'OUTRA' }]
    db.profiles = [{ id: 'u1', org_id: 'outra', telegram_chat_id: '999' }]
    db.galeria_pedidos.push(pedido('p1'))
    db.galeria_imagens.push(img('p1', 'gerada'))
    expect(await rodar()).toBe(1)
    expect(avisos()[0].texto).toBe(`Suas imagens ficaram prontas: seu anúncio. 1 para conferir. Abra para aprovar: ${LINK}`)
    expect(enviar).not.toHaveBeenCalled()
  })

  it('singular e plural: "1 para conferir"; "2 não saíram"', async () => {
    db.galeria_pedidos.push(pedido('p1'))
    db.galeria_imagens.push(img('p1', 'gerada'), img('p1', 'falhou'), img('p1', 'falhou'))
    await rodar()
    expect(avisos()[0].texto).toBe(`Suas imagens ficaram prontas: Fio Amigurumi 254 m. 1 para conferir, 2 não saíram. Abra para aprovar: ${LINK}`)
  })

  it('dois pedidos da mesma rodada → um aviso com a chave do mais recente; pedido novo depois → novo aviso', async () => {
    db.galeria_pedidos.push(pedido('p1', { criado_em: min(-30) }), pedido('p2', { criado_em: min(-5) }))
    db.galeria_imagens.push(img('p1', 'gerada'), img('p2', 'gerada'))
    expect(await rodar()).toBe(1)
    expect(avisos().map((n) => n.chave)).toEqual(['galeria_pronta:p2'])
    expect(avisos()[0].texto).toContain('2 para conferir')

    db.galeria_pedidos.push(pedido('p3', { criado_em: min(1) }))
    db.galeria_imagens.push(img('p3', 'pendente'))
    agora = new Date(T0 + 2 * 60_000)
    expect(await rodar()).toBe(0) // p3 ainda aberta: a rodada inteira espera
    db.galeria_imagens[2].status = 'gerada'
    db.galeria_imagens[2].alertas = []
    expect(await rodar()).toBe(1)
    expect(avisos().map((n) => n.chave)).toEqual(['galeria_pronta:p2', 'galeria_pronta:p3'])
    expect(avisos()[1].texto).toContain('3 para conferir')
  })

  it('outro usuário no mesmo anúncio → aviso próprio, só dele', async () => {
    db.galeria_pedidos.push(pedido('p1'), pedido('p2', { criado_por: 'u2' }))
    db.galeria_imagens.push(img('p1', 'gerada'), img('p2', 'gerada'), img('p2', 'gerada'))
    expect(await rodar()).toBe(2)
    expect(avisos().map((n) => [n.user_id, n.chave])).toEqual([['u1', 'galeria_pronta:p1'], ['u2', 'galeria_pronta:p2']])
    expect(avisos()[1].texto).toContain('2 para conferir')
    expect(enviar.mock.calls.map((c) => c[1])).toEqual(['111', '222'])
  })

  it('só falhas → texto de falha', async () => {
    db.galeria_pedidos.push(pedido('p1'))
    db.galeria_imagens.push(img('p1', 'falhou'), img('p1', 'falhou'))
    expect(await rodar()).toBe(1)
    expect(avisos()[0].texto).toBe(`Não foi possível gerar as imagens de Fio Amigurumi 254 m (2 não saíram). Abra para tentar de novo: ${LINK}`)
  })

  it.each([
    ['sem telegram_chat_id', () => { db.profiles[0].telegram_chat_id = null }],
    ['sem token', () => { db.configuracoes[0].telegram_bot_token = null }],
    ['telegram_ativo falso', () => { db.configuracoes[0].telegram_ativo = false }],
  ])('%s → só app', async (_, preparar) => {
    preparar()
    db.galeria_pedidos.push(pedido('p1'))
    db.galeria_imagens.push(img('p1', 'gerada'))
    expect(await rodar()).toBe(1)
    expect(avisos()).toHaveLength(1)
    expect(enviar).not.toHaveBeenCalled()
  })

  it('erro no Telegram não lança e o aviso do app fica', async () => {
    enviar.mockRejectedValueOnce(new Error('telegram fora'))
    db.galeria_pedidos.push(pedido('p1'))
    db.galeria_imagens.push(img('p1', 'gerada'))
    expect(await rodar()).toBe(1)
    expect(avisos()).toHaveLength(1)
  })

  it('pedido antigo (roteiro fora do formato 2) dentro da janela → não avisa', async () => {
    db.galeria_pedidos.push(pedido('p1'))
    db.galeria_imagens.push(img('p1', 'gerada', { roteiro_id: 'rot1' }), img('p1', 'aprovada', { roteiro_id: 'rot1' }))
    expect(await rodar()).toBe(0)
    expect(avisos()).toEqual([])
  })

  it('pedido antigo aberto não segura a rodada', async () => {
    db.galeria_pedidos.push(pedido('p1'), pedido('p2', { criado_em: min(-5) }))
    db.galeria_imagens.push(img('p1', 'gerando', { roteiro_id: 'rot1' }), img('p2', 'gerada'))
    expect(await rodar()).toBe(1)
    expect(avisos()[0]).toMatchObject({ chave: 'galeria_pronta:p2' })
  })

  it('rodada mista: avisa uma vez, conta só o formato 2 e a chave nunca é do pedido antigo (mesmo sendo o mais novo)', async () => {
    db.galeria_pedidos.push(pedido('pNovo', { criado_em: min(-30) }), pedido('pVelho', { criado_em: min(-5) }))
    db.galeria_imagens.push(
      img('pVelho', 'gerada', { roteiro_id: 'rot1' }), img('pVelho', 'gerada', { roteiro_id: 'rot1' }), img('pVelho', 'falhou', { roteiro_id: 'rot1' }),
      img('pNovo', 'gerada'), img('pNovo', 'falhou'), img('pNovo', 'desatualizada'),
    )
    expect(await rodar()).toBe(1)
    expect(avisos()).toEqual([expect.objectContaining({
      chave: 'galeria_pronta:pNovo',
      texto: `Suas imagens ficaram prontas: Fio Amigurumi 254 m. 1 para conferir, 1 não saiu. Abra para aprovar: ${LINK}`,
    })])
    expect(await rodar()).toBe(0)
  })

  it('rodada só com imagens desatualizadas/descartadas do formato 2 → não avisa', async () => {
    db.galeria_pedidos.push(pedido('p1'))
    db.galeria_imagens.push(img('p1', 'desatualizada'), img('p1', 'descartada'))
    expect(await rodar()).toBe(0)
    expect(avisos()).toEqual([])
  })

  it('pedido com mais de 3 h não é lido', async () => {
    db.galeria_pedidos.push(pedido('p1', { criado_em: min(-181) }))
    db.galeria_imagens.push(img('p1', 'gerada'))
    expect(await rodar()).toBe(0)
    expect(avisos()).toEqual([])
  })

  it('anúncio sem item no ML → texto sem link', async () => {
    db.anuncios_externos[0].item_externo_id = null
    db.anuncios_externos_itens.push({ anuncio_externo_id: 'an1', org_id: 'org', sku: 'A', item_externo_id: null, retirado: false })
    db.galeria_pedidos.push(pedido('p1'))
    db.galeria_imagens.push(img('p1', 'gerada'))
    await rodar()
    expect(avisos()[0].texto).toBe('Suas imagens ficaram prontas: Fio Amigurumi 254 m. 1 para conferir. Abra a galeria em Publicados.')
  })

  it('anúncio UP (item nulo na partição) → MLB do primeiro filho não retirado por sku', async () => {
    db.anuncios_externos[0].item_externo_id = null
    db.anuncios_externos_itens.push(
      { anuncio_externo_id: 'an1', org_id: 'org', sku: 'C', item_externo_id: 'MLB9', retirado: false },
      { anuncio_externo_id: 'an1', org_id: 'org', sku: 'A', item_externo_id: 'MLB7', retirado: true },
      { anuncio_externo_id: 'an1', org_id: 'org', sku: 'B', item_externo_id: 'MLB8', retirado: false },
    )
    db.galeria_pedidos.push(pedido('p1'))
    db.galeria_imagens.push(img('p1', 'gerada'))
    await rodar()
    expect(avisos()[0].texto).toContain('https://app.publiai.com.br/#/publicados/MLB8/galeria')
  })
})
