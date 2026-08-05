# ADR-0101 — O mapa de marca corrige a grafia, não troca a entidade

**Status:** Aceito
**Data:** 2026-08-04
**Decisores:** Diego
**Relaciona:** corrige defeito de composição introduzido em [ADR-0099](0099-titulo-padrao-mercado-livre.md)
(contrato de dez slots); medido pelo censo criado em [ADR-0100](0100-termos-com-risco-valvula-de-escape.md);
mesma classe de bug do [ADR-0072](0072-titulo-duplicacao-tipo-e-cor-fora-de-ordem.md) (guard
determinístico correto isoladamente, errado em composição)

## Contexto

O censo de descartes (`scripts/censo-descartes/`, 304 de 304 famílias elegíveis, 0 falhas) foi
rodado para medir se a IA contrabandeia termo não ancorado para dentro dos slots. **Não
contrabandeia:** zero descartes em `produto`, `modelo`, `medida`, `quantidade`, `material`,
`variacao`, `compatibilidade`, `aplicacao` e `sinonimo`.

Mas revelou outra coisa: **125 famílias (41,1%) perdiam a marca, e o responsável era o próprio
pipeline.**

`aplicarGuardsTitulo` gravava `out.marca = marcaDoFornecedor(fonte.fornecedor)` sem condição, e
`validarSlotsAncorados` derrubava a marca logo em seguida por falta de ancoragem na fonte. Em 73
casos isso era inócuo (a IA não tinha marca). Em **52 casos era perda líquida**:

| Ocorrências | IA extraiu (ancorado) | Mapa gravou | Resultado |
|---|---|---|---|
| 23× | `Progresso` | `Detallia` | `""` |
| 15× | `Cléa` | `Círculo` | `""` |
| 10× | `EUROROMA` | `Ecofibra` | `""` |
| 4× | `Bandeirantes` | `Bandeirante` | `""` |

### A causa é conceitual, não um descuido

`familias.fornecedor` é **razão social**, e o fornecedor muitas vezes é o fabricante ou
distribuidor — não a marca do produto. ECOFIBRA fabrica o EUROROMA; DETALLIA distribui a
PROGRESSO. O mapa em `titulo-marcas.ts` declara no próprio cabeçalho a regra correta — *"O MAPA
FORNECE A GRAFIA; A FONTE FORNECE A PERMISSÃO"* — mas o código a implementava como substituição
incondicional, o que troca a **entidade**, não a grafia.

O caso `Bandeirante` × `BANDEIRANTES` mostra a mesma falha por outro ângulo: `jaContem` usa
fronteira de palavra, então a forma singular do mapa não casa dentro do plural da fonte, e a marca
real da fonte era descartada em favor de uma que nunca ancoraria.

**Nenhum teste apanhava isto**, e não por descuido: cada função, isolada, faz exatamente o que
promete. O defeito só existe na composição — a mesma lição que o ADR-0099 registra sobre testar
guards isolados de suas vizinhas.

## Decisão

O mapa só sobrescreve a marca em dois casos:

1. **A IA não trouxe marca** — não há entidade a preservar; o mapa injeta e `validarSlotsAncorados`
   decide, exatamente como antes.
2. **A forma do mapa está ancorada na fonte** — é o caso para o qual o mapa foi criado: a fonte
   escreve `CIRCULO`, o mapa devolve `Círculo`. Corrigir grafia, não trocar nome.

Fora disso, a marca da IA é preservada e segue para `validarSlotsAncorados` como qualquer outra —
**a ancoragem continua obrigatória**. Este ADR não afrouxa a validação; muda apenas *qual grafia é
submetida* a ela.

```ts
const doMapa = marcaDoFornecedor(fonte.fornecedor);
if (doMapa && (!out.marca.trim() || jaContem(normalizar(textoFonte), normalizar(doMapa)))) {
  out.marca = doMapa;
}
```

## Efeito medido

Títulos reais, gerados com o pipeline de produção antes e depois:

```
02186551 · fornecedor ECOFIBRA INDUSTRIA TEXTIL
  antes: Barbante 4/6 610m Algodão 15% Outras Fibras
  depois: Barbante Euroroma 4/6 610m Algodão 15% Outras Fibras

00445916 · fornecedor DETALLIA FITAS TEXTEIS LTDA
  antes: Fita de Cetim Nº 1 100m 7mm 100% Poliéster
  depois: Fita de Cetim Progresso Nº 1 100m 7mm Poliéster Decoração
```

## Consequências

**Muda:** 52 das 304 famílias passam a ter marca no título — **apenas em CREATE novo**.
`atualizarItemML` nunca envia `title`, então nenhum dos anúncios já publicados é afetado. Com o
ritmo atual (7 CREATEs em dois dias), o ganho aparece devagar.

**Não muda:** a exigência de ancoragem, o bloqueio de nome de loja (`LOJA_NUNCA_MARCA`), o
comportamento quando a IA não traz marca, nem a entrada `null` do mapa para razão social sem marca
identificável.

**Consequência aceita — `Cléa` é linha, não marca.** Em 15 famílias a IA extrai `Cléa`, que é a
linha comercial; a marca é `Círculo`. O título passa a exibir `Cléa` no lugar de nada. É o termo
que o comprador busca e está ancorado na fonte, mas o slot `marca` passa a carregar uma linha.
Preferir `Círculo` exigiria ancorá-lo por outro caminho — fora do escopo deste ADR.

**Risco residual:** a IA pode extrair como marca um termo ancorado que não é marca. O risco é
pré-existente (a validação de ancoragem sempre foi o único filtro) e não aumenta aqui: antes desta
mudança, o mesmo termo sobreviveria em todos os casos onde o fornecedor não está no mapa.

## Verificação

- Teste dedicado: `supabase/functions/_shared/ai/__tests__/titulo-marca-mapa.test.ts` — cobre os
  dois casos do defeito e trava os quatro comportamentos que **não** podem mudar (grafia corrigida
  quando ancorada, mapa injetando com IA vazia, marca não ancorada continuando a cair, nome de loja
  nunca virando marca).
- No RED, apenas os dois testes do defeito falhavam; os quatro de preservação já passavam — o que
  confirma que a mudança é cirúrgica.
- Suíte completa: 2458 testes, 295 arquivos, verde. `pnpm lint`: 0 erros.

## Como reverter

Voltar a condição para `if (doMapa) out.marca = doMapa;` em `titulo-guards.ts`. O teste
`titulo-marca-mapa.test.ts` falha em dois casos, que é o comportamento esperado da reversão.
