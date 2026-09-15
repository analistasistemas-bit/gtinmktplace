---
tags: [agentes-externos, mercado-livre, referencia]
atualizado: 2026-09-14
---

# API do ML para agentes

Endpoints corretos e armadilhas já pagas em produção, para orientar qualquer agente externo.
Ver [[Agentes Externos]], [[Muse (AVILBV)]].

## Perguntas (pré-venda)

São **diferentes** de mensagens pós-venda: outro recurso, outro caminho.

| Ação | Chamada |
|---|---|
| Listar pendentes | `GET /questions/search?seller_id=<id>&status=UNANSWERED&api_version=4` |
| Ler uma | `GET /questions/{question_id}?api_version=4` |
| **Responder** | `POST /answers` com `{ "question_id": <id>, "text": "..." }` |

**Não existe `POST /questions/{id}/answers`** — devolve 404. Foi o erro que travou o agente na
primeira tentativa. O caminho certo é o mesmo do PubliAI
(`supabase/functions/_shared/faturamento/perguntas-io.ts:56`).

Em `api_version=4` a resposta **não traz nickname** do comprador (resolver via `GET /users/{id}`)
nem **permalink** do anúncio (montar a partir do `item_id`).

## Mensagens pós-venda

| Ação | Chamada |
|---|---|
| Listar pendentes | `GET /messages/unread?role=seller&tag=post_sale` |
| Ler um pack | `GET /messages/packs/{pack_id}/sellers/{seller_id}?tag=post_sale&mark_as_read=false` |
| Responder | `POST /messages/packs/{pack_id}/sellers/{seller_id}?tag=post_sale` com `{from:{user_id}, to:{user_id}, text}` |

**Nunca iterar pedidos** para achar mensagem — é o que estoura o rate limit. `/messages/unread`
resolve em uma chamada.

**`mark_as_read=false` ao ler, sempre.** Sem ele o simples GET marca como lida e a mensagem some
da lista de pendentes do painel antes de alguém ter respondido. O PubliAI usa esse parâmetro
pelo mesmo motivo (`mensagens-io.ts:40`).

**Responder não marca como lida.** São coisas independentes. O ciclo completo é:

1. ler com `mark_as_read=false`
2. `POST` da resposta
3. **só se o POST teve sucesso**, um `GET` no pack *sem* `mark_as_read=false` — é isso que
   limpa o painel

Inverter a ordem faz o pendente sumir sem resposta enviada.

**Limite:** 500 requisições/minuto, compartilhado entre os GETs. Em 429, esperar — não
paralelizar para compensar.

## Fotos de variação

```jsonc
// 1) subir a foto
POST /pictures            { "source": "https://url-publica.jpg" }   // → { id }
// ⚠ /pictures/items/upload devolve 405 (tengine)

// 2) GET /items/{MLB} — guardar `pictures` e `variations` atuais

// 3) PUT /items/{MLB}
{
  "pictures":  [ { "id": "<cada id de atual.pictures>" }, { "id": "<a nova>" } ],
  "variations": [
    { "id": 178, "available_quantity": 5, "picture_ids": ["<líder>", "<a nova>"] },
    { "id": 179, "available_quantity": 3 }     // as que não mudam: só id + qty do GET
  ]
}
```

- **`variations` omitida é apagada** pelo ML. Sempre reenviar todas.
- `picture_ids` é substituição, não append. O primeiro id é a foto líder da cor.
- Toda foto referenciada precisa estar em `item.pictures` no mesmo PUT.
- Não tocar em `attribute_combinations` de variação com venda — o ML recusa o PUT inteiro
  ("You cannot change attribute combinations if the variation has bids").
- Upload de foto é assíncrono; conferir por `GET` depois.

## Vídeo — não é automatizável

O `video_id` do YouTube foi descontinuado nos itens. Hoje vídeo é **Clips**, e o upload existe
**só no app do celular**: menu → Clips → escolher o anúncio. Vertical (9:16), até 1 minuto,
aprovação em ~2 dias úteis.

Não há endpoint. Tentativa de upload pela API retorna 413 — sintoma de caminho inexistente, não
de arquivo grande. O agente pode **gerar** o vídeo em 9:16 e entregar o arquivo; subir é manual.

## Token

- `access_token`: 6h. Não precisa ser guardado.
- `refresh_token`: ~6 meses, **rotativo e de uso único**.

```
POST /oauth/token
grant_type=refresh_token&client_id=<APP_ID>&client_secret=<SECRET>&refresh_token=<atual>
```

A resposta traz um `refresh_token` **novo** — sobrescrever o guardado no mesmo instante. O
antigo morre no uso. Guardar em memória persistente, nunca em arquivo temporário (foi assim que
o agente perdeu a credencial e voltou a pedir autorização manual).

Nunca duas renovações em paralelo. Se a resposta vier incompleta, **não** descartar o refresh
antigo — repetir.

## Pós-venda: o que não funciona

A API de reclamações e devoluções (`/post-purchase/v1/claims`) responde **403** mesmo com a
permissão marcada — exige habilitação à parte junto ao ML. `orders` e `messages` funcionam
normalmente. Mesmo comportamento observado no app do PubliAI.
