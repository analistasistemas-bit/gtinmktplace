---
tags: [fluxos, ingest]
atualizado: 2026-07-01
---

# Upload Fotos

Parte do [[Upload Planilha]]. Edge function `upload-imagens-lote` (`verify_jwt=true`, HTTP
FormData, não idempotente). Classificação em `_shared/upload/match.ts`.

## Convenção de nome de arquivo

| Padrão | Papel |
|---|---|
| `00CODIGO.ext` | Foto da variação (regex `^(\d{8})\.(jpe?g\|png)$`) |
| `CAPA_00CODIGO.ext` | Capa comum da família |
| `CAPA2_00CODIGO.ext` | Segunda foto comum |
| `CAPA3_00CODIGO.ext` | Terceira foto comum |

`ext` aceito: `jpg`, `jpeg`, `png`. Código sempre 8 dígitos.

## Casamento com variação/família

O operador costuma nomear a foto pelo código vendável (filho), não pelo PAI — o parser aceita um
código único ou vários candidatos (PAI + códigos das variações) ao procurar a capa.

## Armazenamento

Bucket privado `imagens` do Supabase Storage. Path `{user_id}/{lote_id}/{arquivo}`. RLS: acesso
só quando `auth.uid()` bate com o primeiro segmento do path. Ver [[Segurança]], [[Supabase]].
