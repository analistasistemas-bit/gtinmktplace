# ADR-0081: Corte de egress — URL assinada persistida e poll de vendas em 3 minutos

**Status:** Aceito
**Data:** 2026-07-19
**Decisores:** Diego

## Contexto

Em 19/07/2026 o Supabase notificou que a organização estourou a cota de Egress do plano Free:
6,74 GB usados contra 5 GB inclusos, com carência até 18/08/2026 — depois disso as requisições
passam a receber 402.

Números do endpoint `usage/daily` do dashboard (ciclo 24/06 a 24/07), todos do projeto
`gtin_mktplace_ia` (o outro projeto da org registrou 0 GB):

| Tipo | Volume | % |
|---|---|---|
| Storage | 4,75 GB | 70% |
| PostgREST (REST) | 1,98 GB | 29% |
| Auth / Realtime / Functions / Pooler | 0,013 GB | <1% |

**Storage.** O bucket `imagens` tem 2.548 arquivos somando 377 MB — o bucket inteiro saiu ~12,6
vezes no mês. As duas fontes server-side foram descartadas por evidência: a Vision de cor tem
cache Redis por código (`process-familia`), então reprocesso não rebaixa imagem; e só ~120
anúncios foram criados/atualizados no período (~180 MB, 4% do total). Sobra a UI: `useImageUrl`
gerava uma signed URL nova a cada sessão, e URL diferente a cada vez significa que o cache de
CDN e o do navegador nunca acertam. O indicador Cached Egress confirmava: 0,04 de 5 GB (<1%).

Ponto-chave: os objetos **já** carregam `cache-control: max-age=3600` (default do Supabase,
nunca sobrescrito no upload). O cache sempre esteve configurado — era anulado pelo token
rotativo. Não estamos adicionando cache, estamos destravando o que existia.

**REST.** `useVendas` fazia poll a cada 45s enquanto qualquer aba estivesse aberta (~1.900
requisições/dia), e cada resposta é a janela inteira de vendas com itens. O REST subiu de
27 MB/dia no início do ciclo para 227 MB/dia no fim — é a fonte que estava piorando.

## Decisão

**1. A signed URL passa a ser persistida.** `useImageUrl` gera a URL com validade de 7 dias e
guarda em `localStorage` (`publiai:img-urls:v1`), reaproveitando enquanto faltar mais de 1 dia
para expirar; entradas vencidas são varridas na próxima escrita. A URL fica estável entre
recargas e sessões, então CDN e navegador voltam a cachear. Trocar a foto reusa o mesmo path:
`invalidarImagem(qc, path)` descarta a entrada e força um token novo, que por ser outra URL
também fura o cache do navegador — chamada nos três handlers de troca de capa em
`familia-expanded.tsx`.

`invalidarImagem` cobre os **7** pontos que regravam um path: as 3 subidas e as 3 remoções de
capa (`familia-expanded.tsx`) e a troca de foto de variação (`variacao-card.tsx`). Faltar um
deles é regressão silenciosa — a foto velha continua no cache do navegador **mesmo após F5**,
porque a URL não mudou.

`signOut` chama `limparUrlsImagem()`: a URL assinada é bearer token de 7 dias e sobreviveria ao
fim da sessão em máquina compartilhada.

**2. `useVendas` passa de 45s para 180s.** `refetchOnWindowFocus` continua ligado, o que já
cobre o caso "voltei para a aba e quero ver agora".

## Alternativa descartada: bucket público

Bucket público daria URL permanente e o mesmo ganho de cache com menos código. Foi descartado
por segurança: a policy ativa é `imagens: select org` (ADR-0027, E7) e existe isolamento real
entre organizações no bucket. Público removeria esse isolamento, e URL pública não expira —
uma URL vazada revela `user_id` e `lote_id`, e como os nomes de arquivo são previsíveis
(`CAPA_00CODIGO.jpg`), o vazamento exporia o lote inteiro, incluindo fotos de produto ainda não
publicado ou recusado. Num SaaS multi-tenant o preço não compensa. A URL de 7 dias entrega
praticamente a mesma economia mantendo login obrigatório e limitando um vazamento no tempo.

Aumentar o `max-age` dos objetos também foi descartado, mas por um motivo diferente do que
parecia: quando a hora do `max-age` vence, o navegador revalida com `If-None-Match` e recebe
**304 sem corpo** — egress ~zero. O custo residual não vem do `max-age`, vem da renovação da URL
a cada 6 dias, que muda a URL e fura CDN e navegador de uma vez. Se um dia precisar de mais
corte, o botão certo é alongar `TTL_S`, não o `max-age`.

## Armadilha: a gravação do store não pode ler antes do `await`

A primeira versão lia o store no início de `resolverUrlImagem` e gravava depois de assinar. Como
a tela carrega N fotos de uma vez, as N chamadas liam o mesmo estado antigo e cada uma gravava o
objeto inteiro por cima — só a última sobrevivia. Medido no browser: 8 fotos na tela, **3
entradas gravadas**. O cache nunca enchia e a economia não aconteceria.

A correção é reler o store **depois** do `await`, imediatamente antes de gravar: sem `await`
entre ler e gravar, nenhuma chamada concorrente intercala. Coberto pelo teste "N resoluções
concorrentes gravam TODAS as entradas".

## Verificação

Medido no browser contra o Supabase real, tela de Revisão com 7 fotos:

| Cenário | Requests | Duração mediana |
|---|---|---|
| URL nova a cada sessão (antes) | 14 | 664 ms — todas da rede |
| URL persistida (depois) | 7 | 0 ms — todas do cache |

(`transferSize` não serve de métrica aqui: é zerado pela política de CORS em recursos
cross-origin. A duração é o sinal confiável.)

Verificação final é no próximo ciclo de billing: Egress cobrado abaixo de 5,5 GB e Cached Egress
(cota separada de 5 GB, hoje em <1%) subindo — é para lá que o tráfego de imagem migra.

## Como reverter

Voltar `useImageUrl` para gerar signed URL de 1h sem persistência e `useVendas` para 45s.
Não há migration envolvida.
