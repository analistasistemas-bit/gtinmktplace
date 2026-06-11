# ADR-0022 — Tipo de aviamento "cola" + seletor manual de categoria

**Status:** Aceito
**Data:** 2026-06-11
**Estende:** [ADR-0009](0009-campos-payload-ml-e-categoria-deterministica.md) (categoria via lookup determinístico)

## Contexto

O lote #26 trouxe um produto fora dos três tipos mapeados (linha/fita/botão): **cola em bastão para pistola de cola quente**. A detecção por regex (`detectarTipoAviamento`) caiu em `outro` → família sem `categoria_ml_id` → bloqueada na publicação ("Categoria indefinida"). Não havia caminho de recuperação: o `CardCategoria` era só leitura, então qualquer produto novo fora do domínio de aviamentos ficava travado para sempre.

Diego sinalizou que produtos fora de aviamentos vão continuar aparecendo e pediu a solução à prova de futuro: **mapear a cola E adicionar um seletor manual** para qualquer produto que caia em `outro`.

## Decisão

### 1. Novo tipo determinístico `cola` (estende ADR-0009)

Categoria-folha real, validada na API ML (2026-06-11):

| Tipo | Categoria | Nome ML | Obrigatórios |
|---|---|---|---|
| `cola` | **MLB277319** | Bastões de Cola (p/ pistolas elétricas) | BRAND + MODEL |

- Path: `Arte, Papelaria e Armarinho > Artigos de Armarinho > Bastões de Cola`. `listing_allowed: true`, folha.
- Atributos obrigatórios = `BRAND` + `MODEL` (idêntico à `linha`); `montarAtributosML('cola', …)` reusa o ramo da linha.
- A categoria **expõe `EMPTY_GTIN_REASON`** (value `17055160` "produto não tem código cadastrado") → adicionada a `CATEGORIAS_COM_EMPTY_GTIN_REASON`.
- Regex de detecção: termos `cola`/`colas` (camada regex, origem `regex`).

### 2. Seletor manual de categoria (escape hatch)

Para produtos que a regex deixou em `outro`, o operador escolhe a categoria na Revisão entre os tipos com categoria-folha mapeada (linha/fita/botão/cola).

- Edge `definir-categoria-familia` (verify_jwt true, RLS por `user_id`): recebe `{ familia_id, tipo }`, reusa o código canônico de `_shared/categoria` (`categoriaParaTipo` + `montarAtributosML` a partir do `nome_pai`/`fornecedor`/`descricao_pai`) e grava `categoria_ml_id`/`tipo_aviamento`/`tipo_origem='manual'`/`atributos_ml`. **Sem duplicar a lógica de atributos no frontend** (evita drift de deploy).
- `CardCategoria` mostra um `Select` quando a categoria está indefinida; ao escolher, dispara a edge e invalida a query.

## Consequências

- Cola passa a publicar automaticamente como qualquer aviamento mapeado (CREATE roda IA + categoria; UPDATE preserva por ADR-0016).
- Tipos novos fora do mapa ainda caem em `outro`, mas agora têm saída manual — sem travar o lote.
- O seletor só oferece tipos com categoria-folha conhecida; uma busca livre de categorias no ML fica fora de escopo (YAGNI).

## Pendências / riscos conhecidos

- **Produto sem cor:** a cola não tem cor; hoje entra como variação única com `COLOR` = "Outra"/"Branco". A categoria MLB277319 tem `COLOR` como `allow_variations` (51 valores fixos). Validar na publicação real (bug bash) se o ML aceita o valor de cor enviado; se rejeitar, tratar produto-sem-cor separadamente.
