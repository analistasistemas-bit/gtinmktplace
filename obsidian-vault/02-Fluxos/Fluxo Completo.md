---
tags: [fluxos]
atualizado: 2026-08-08
---

# Fluxo Completo

Jornada planilha → anúncio, espelhada nos status de `lotes` e `familias`. Ver [[Arquitetura Geral]].

```mermaid
flowchart TD
    A[Operador] -->|upload planilha + fotos| B["ingest-lote<br/>lote: importando→processando"]
    B --> C["QStash enfileira famílias pendentes"]
    C --> D["process-familia worker<br/>familia: processando→pronto/erro"]
    D --> E["REVISÃO HUMANA<br/>lote: revisao"]
    E -->|Publicar| F["publicar-familias<br/>fila serial por (canal, org)"]
    F --> G["publish-familia-ml (CREATE)<br/>ou update-familia-ml (UPDATE)<br/>familia: publicando→publicado"]
    G --> H["vincular-catalogo (+10min)<br/>lote: concluido"]
```

## Etapas

1. **[[Upload Planilha]]** — `ingest-lote`: valida colunas, agrupa por PAI, casa fotos, detecta
   CREATE vs UPDATE, cria `familias`+`variacoes`, enfileira pendentes.
2. **[[Upload Fotos]]** — `upload-imagens-lote`: casa arquivo por nome (`00CODIGO`, `CAPA_`,
   `CAPA2_`, `CAPA3_`).
3. **[[Processamento IA]]** — `process-familia` (worker): claim atômico, resolve cor, gera copy,
   detecta categoria, monta atributos, calcula preço/concorrência.
4. **Revisão humana** — operador confere copy/preço/cor/categoria na tela Revisão, exclui
   variações, escolhe o que publicar. Etapa obrigatória — nada vai ao ar sem aprovação.
5. **[[Publicação Mercado Livre]]** — `publicar-familias` → fila serial → `publish-familia-ml`
   (CREATE) ou `update-familia-ml` (UPDATE); sobe fotos, cria/atualiza item, aplica atacado,
   espelha em `anuncios_externos`.
6. **Vínculo de catálogo** — `vincular-catalogo` (delay 10min): opt-in por GTIN; alerta Telegram
   se no-match.

Em categorias User Products que exigem item plano, uma família multicor publica N itens técnicos
agregados por `family_id`/`family_name`; o UPDATE é feito por item filho. Ver
[[Publicação Mercado Livre]].

## Referências de código

`src/lib/{ingest,publicar,publicavel,jornada,queries}.ts`;
`supabase/functions/{ingest-lote,process-familia,publish-familia-ml,update-familia-ml,vincular-catalogo}`.

## Módulos que acompanham o fluxo mas não fazem parte do pipeline de publicação

- **Faturamento** — vendas/perguntas/devoluções via webhook, ver [[Marketplace]]
- **Financeiro** — liberações via Mercado Pago
- **Viabilidade** — análise de concorrência/margem antes de cadastrar. **Desde 2026-08-08 também
  é porta de entrada do pipeline:** o botão "Cadastrar" na linha do resultado abre o cadastro
  manual já pré-preenchido (nome e descrição da ficha de catálogo do ML, GTIN, custo, mínimo e
  dimensões), caindo no mesmo lote manual da sessão (ADR-0094 D-1.1) e seguindo daí pelo fluxo
  normal: IA → Revisão → publicação. `origem` e foto **nunca** são pré-preenchidas. Ver
  `docs/spikes/037-cadastrar-a-partir-da-viabilidade.md`.
