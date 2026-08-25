---
tags: [bugs, conhecidos]
atualizado: 2026-08-24
---

# Bugs Conhecidos

Problemas identificados e **ainda abertos** (não resolvidos). Fonte: `docs/project-status.md`
("Riscos e ressalvas abertas"), `docs/reference/edge-functions.md`, `docs/TASKS.md`. Ver
[[Incidentes]] (o que já foi corrigido), [[Problemas Resolvidos]].

## 7 de 147 produtos sem foto na tela Estoque — decisão pendente do Diego

Nos 7, nem a família nem nenhuma variação têm `imagem_path`/`ml_picture_id`, então a tela não tem
o que renderizar (o fallback para a foto do ML funciona nos outros 140).

**Causa:** o lote #45 subiu **sem nenhuma imagem** e recriou 135 famílias; como a tela adota a
família mais recente de cada `codigo_pai` (âncora ADR-0025), essas viraram as canônicas. Em
`ingest-lote`, `imagem_path` vem só do lote atual (`matchImagem`) e **nunca é herdado** da família
anterior — só o `ml_picture_id` é (`herdarPictureId`). Por isso 128 dos 135 escaparam: são
publicados e herdaram o id da foto do ML; sobraram justamente os não publicados.

Dos 7: **2 têm o arquivo no Storage** (do lote #33) — `03149730` (28 variações) e `02960150` —,
4 nunca tiveram foto, e o 7º é `EXT-MLB6901126538` (a foto existe no anúncio, mas
`capa_ml_picture_id` está nulo; o prefixo `EXT-` não é gerado por nenhum código do repositório).

**Por que não foi corrigido direto:** herdar `imagem_path` no re-ingest não é trocar uma linha —
`herdarPictureId(base.imagem_path, herdado)` zera o id do ML quando enxerga imagem nova, então
passar o caminho herdado ali **derrubaria a foto de produto publicado**. Alternativas na mesa:
(a) religar por SQL só as 29 variações dos 2 produtos; (b) reenviar as fotos no lote #45;
(c) herdar `imagem_path` com uma flag que não invalide o `ml_picture_id`. Ver [[Estoque]].

## Parsing de milhar pt-BR ainda aberto em `/publicados`

`src/components/variacao-card.tsx` (edição de preço na tela Publicados) tem o **mesmo** bug de
parsing corrigido em `src/lib/formato.ts` (`parseNumeroPtBr`) durante o redesenho do Estoque:
`"1.234"` grava `R$ 1,23`. Ficou explicitamente fora do escopo do PR #56.

## Retry de foto — cobertura parcial

O retry de foto transiente foi reforçado e validado no `CREATE` (`publish-familia-ml`), mas o
mesmo padrão ainda **não foi estendido de forma consistente ao `UPDATE`**
(`update-familia-ml`). Fica pendente até haver necessidade operacional real.

## E4 — publicação de vertical nova ainda não comprovada ponta a ponta

Validado até Revisão/banco (categoria `MLB189007` + `VOLTAGE` closed-set + publicabilidade) para
uma furadeira, mas o único CREATE real de prova da reauditoria foi com família de fita —
**não** com uma furadeira de verdade. Decisão registrada: não forçar um publish sintético;
fechar quando uma furadeira real entrar num lote de produção normal.
