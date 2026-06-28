# Diagramas técnicos

> Diagramas de arquitetura do PubliAI no padrão [C4 model](https://c4model.com/) +
> sequência + ERD. Cada diagrama tem o fonte `.drawio` (editável) e a exportação
> `.drawio.png` (com o XML embutido — abrir o PNG no draw.io recupera o editável).

## Como editar

1. Abra o `.drawio` (ou o `.drawio.png`) no [draw.io desktop](https://www.drawio.com/) ou em [app.diagrams.net](https://app.diagrams.net).
2. Edite e salve.
3. Reexporte o PNG:
   ```bash
   drawio -x -f png -e -s 2 -o NOME.drawio.png NOME.drawio
   ```
   (a flag `-e` embute o XML; `-s 2` dobra a resolução.)

## Índice

| Diagrama | Arquivo | O que mostra |
|---|---|---|
| **C4 N1 · Contexto** | [c4-n1-contexto](c4-n1-contexto.drawio.png) | PubliAI + atores e sistemas externos |
| **C4 N2 · Contêineres** | [c4-n2-conteineres](c4-n2-conteineres.drawio.png) | Frontend, Edge Functions, Postgres, Auth, Storage, QStash, Redis e externos |
| **C4 N3 · Componentes** | [c4-n3-componentes](c4-n3-componentes.drawio.png) | As 32 edge functions agrupadas por domínio + gatilho |
| **ERD · Modelo de dados** | [erd-modelo-de-dados](erd-modelo-de-dados.drawio.png) | Tabelas, relações, RLS, chaves |
| **Sequência · Publicação** | [seq-publicacao](seq-publicacao.drawio.png) | Pipeline ingest → IA → revisão → publicação ML |
| **Sequência · Faturamento** | [seq-faturamento](seq-faturamento.drawio.png) | Webhook ML → dedup → workers → banco/alerta |

## Convenção visual

- Roxo escuro = pessoa · roxo = PubliAI/contêiner · teal = infra Upstash (QStash/Redis) · cinza = sistema externo.
- Seta cheia = síncrono · seta tracejada = assíncrono (fila/webhook).

## Relação com a documentação

Estes diagramas complementam os docs textuais:
[explanation/arquitetura.md](../explanation/arquitetura.md),
[reference/edge-functions.md](../reference/edge-functions.md),
[reference/modelo-de-dados.md](../reference/modelo-de-dados.md).

> `legacy/` guarda o diagrama de arquitetura antigo (fluxo único), substituído por este conjunto C4.
