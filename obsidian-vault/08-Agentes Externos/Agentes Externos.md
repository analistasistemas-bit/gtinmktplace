---
tags: [agentes-externos, operacao, mercado-livre]
atualizado: 2026-09-14
---

# Agentes externos

Agentes de IA que operam a **conta de marketplace** diretamente pela API, **fora** do PubliAI.
Não confundir com [[Agentes]] (`07-IA/`), que trata dos agentes que trabalham no *repositório*.

Aqui o objeto não é código: é a conta AVILBV no Mercado Livre, em produção, com clientes reais
do outro lado.

## Notas desta área

- [[Apps do Mercado Livre]] — registro de aplicações OAuth, permissões e isolamento
- [[Muse (AVILBV)]] — o primeiro agente externo em operação
- [[API do ML para Agentes]] — endpoints corretos e armadilhas já pagas

## Princípios

1. **Um app por agente.** Nunca compartilhar credencial entre agentes — o `refresh_token` do ML
   é rotativo e de uso único: o primeiro que renovar invalida a cópia do outro. É o mesmo motivo
   do lock em `supabase/functions/_shared/ml/token.ts`.
2. **A permissão é a trava; o prompt não é.** O portal do ML dá granularidade por *área*
   (Publicação, Comunicações, Métricas…), não por operação. Um app só de leitura é fisicamente
   incapaz de escrever; um prompt dizendo "não publique" é apenas um pedido.
3. **Estoque e preço pertencem ao PubliAI.** Agente externo não toca. O push do app é absoluto e
   arrasta o anúncio inteiro — ver [[Estoque]].
4. **Título, categoria e status não se alteram fora do fluxo do app.** Troca de categoria
   re-modera o anúncio; já custou um anúncio cancelado por propriedade intelectual.
5. **Foto de variação é seguro.** O PubliAI nunca reescreve `picture_ids` de variação publicada
   (`montarVariacoesUpdate` só envia fotos quando recebe `picsPorCodigo`, e os dois call sites
   passam `undefined`).

## O que fica fora do alcance de qualquer agente externo

| Operação | Motivo |
|---|---|
| `POST /items` (publicar) | revisão humana obrigatória antes de publicar |
| Estoque / preço | fonte de verdade é o PubliAI |
| `status` (pausar, reativar, encerrar) | ação restrita a admin no app (ADR-0060) |
| `title`, `category_id`, `attributes` | re-moderação |
| Vídeo | não existe endpoint — ver [[API do ML para Agentes]] |
