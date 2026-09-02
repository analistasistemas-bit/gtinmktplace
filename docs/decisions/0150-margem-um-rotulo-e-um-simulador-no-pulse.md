# ADR-0150 — Uma base, um rótulo e um simulador de margem em todo o Pulse

**Status:** Aceito
**Data:** 2026-09-01
**Decisores:** Diego
**Relaciona:** [0119](0119-pulse-inteligencia-de-mercado-dirigida.md) (Erratas 6/7/11 — a margem do
Radar), [0148](0148-dre-fatia-1-uma-cotacao-e-o-guard-de-proveniencia.md) (**implementa o seletor de
âncora que a D-8 deixou explicitamente para "a fatia seguinte"**),
[0149](0149-dre-fatia-2-cinco-precos-e-capital-do-lote.md) (os cinco preços),
[0120](0120-pulse-sonar-garimpo-por-termo.md) (o Sonar),
[0055](0055-imposto-por-origem-nacional-importado.md) (imposto por origem)

---

## Contexto

Três rótulos, duas bases e o mesmo símbolo `%` convivem hoje na mesma tela do Sonar:

| Onde | Conta | Rótulo na tela |
|---|---|---|
| `dialog-margem-sonar.tsx` (botão "Simular" da tabela) | `liquido ÷ custo` | "Margem sobre o custo (markup)" |
| `sonar-dre.tsx` (tabela de cenários) | `lucro ÷ precoVenda` | "Margem s/ venda" |
| `sonar-dre.tsx` (bloco do lote) | `lucro ÷ custo` | "markup líquido" |
| `dialog-detalhe.tsx` (Radar) | `liquido ÷ preco` | "Sobra para você (%)" |

E as duas ferramentas do Sonar respondem **coisas diferentes à mesma pergunta**: o dialog calcula
sem dimensões e avisa "frete não estimado — margem otimista"; a DRE recusa calcular sem os quatro
campos do pacote ([ADR-0148](0148-dre-fatia-1-uma-cotacao-e-o-guard-de-proveniencia.md), D-4 e D-5),
porque cotar com um pacote padrão daria número oficial sobre uma caixa que não existe. Qual das duas
respostas o operador leva depende de qual botão ele apertou.

Em demonstração, é o ponto onde a plateia se perde. Em operação, é como um markup de 30% vira uma
margem de 23% na cabeça de quem decide comprar o lote.

## Decisões

### D-1 — Dois nomes, e eles não se misturam

Em todo o Pulse (Radar e Sonar), percentual de margem é escrito por extenso, com o denominador no
nome:

- **Margem s/ venda** — `lucro ÷ preço de venda`. É o número de quem olha a saúde do preço.
- **Markup** — `lucro ÷ custo`. É o número de quem olha o retorno da compra.

`%` sozinho, "margem" sozinho e "margem sobre o custo" saem da tela. O rótulo do Radar continua
sendo "Sobra para você" para o **valor em reais** — ele responde "quanto sobra", que é outra
pergunta — mas o percentual ao lado dele (`dialog-detalhe.tsx`, hoje um `(x,x%)` sem denominador)
passa a dizer `s/ venda`.

Linha a linha da tabela de Contexto, para não sobrar dúvida na implementação:

| Onde | O que acontece |
|---|---|
| `dialog-margem-sonar.tsx` — "Margem sobre o custo (markup)" | some junto com o componente (D-2) |
| `sonar-dre.tsx:337` — "Margem s/ venda" | **fica como está**; já é o nome canônico |
| `sonar-dre.tsx:389` — "markup líquido" | **fica como está**; "markup" já carrega o denominador, e é a base certa para a pergunta que o bloco do lote responde (retorno sobre o capital da compra) |
| `dialog-detalhe.tsx` — "Sobra para você" + `(x,x%)` | o rótulo em reais fica; o percentual ganha `s/ venda` |

Ou seja: a Task que implementar esta ADR muda **um** rótulo (o do Radar) e apaga um outro junto com
a tela dele. Os dois da DRE já estão conformes — a divergência nunca esteve neles.

### D-2 — O Sonar tem **um** simulador de margem, e ele é a DRE

`dialog-margem-sonar.tsx` é aposentado. O botão **Simular** de cada linha da tabela passa a **trocar
a âncora da DRE** para aquele anúncio e rolar até ela.

Isto **implementa** o seletor que a [ADR-0148](0148-dre-fatia-1-uma-cotacao-e-o-guard-de-proveniencia.md)
D-8 declarou pendente ("um seletor de âncora fica para a fatia seguinte", registrado em
`PulseSonar.tsx:788`) — não contradiz a D-8: a âncora **padrão** continua sendo o primeiro anúncio
da amostra, o que muda é que ela deixa de ser a única.

A DRE é a que sobrevive **porque é a que recusa**: sem custo, sem origem ou sem peso e dimensões ela
não exibe número nenhum, e diz em texto qual campo falta. Isso é a regra LOUD financeira do projeto
([ADR-0055](0055-imposto-por-origem-nacional-importado.md),
[ADR-0148](0148-dre-fatia-1-uma-cotacao-e-o-guard-de-proveniencia.md) D-4) — nenhum número de margem,
imposto ou custo sai com insumo presumido; insumo ausente vira travessão com o motivo, nunca zero. O
dialog fazia o oposto: estimava o frete como zero e rotulava o resultado de "otimista", o que é um
número de dinheiro com insumo presumido usando um aviso como licença.

Consequência aceita de propósito: simular um anúncio passa a **exigir** custo, origem e as quatro
medidas do pacote (peso e três dimensões) — seis campos contra os três de antes. Perde-se a resposta
rápida e otimista; ganha-se que o Sonar não tenha mais duas respostas para a mesma pergunta. A
recusa é uma resposta.

### D-3 — `margemSimulada()` morre com o dialog

A função (`sonar.ts`) existia só para ele e é a única no código que divide líquido por custo
chamando o resultado de "margem". Sai junto, com o seu bloco de testes: código órfão que calcula
dinheiro é o que reaparece seis meses depois numa tela nova, com o rótulo errado.

## Alternativas descartadas

- **Manter os dois e só corrigir os rótulos.** Não resolve a divergência de fundo: um estima frete
  como zero e o outro recusa. Rótulo certo em cima de duas respostas diferentes ainda é duas
  respostas diferentes.
- **Fazer o dialog exigir dimensões também.** Seria reconstruir a DRE dentro de um dialog `md` — o
  mesmo formulário, o mesmo motor, duas telas para manter.
- **Adotar markup em todo lugar** (é o vocabulário do comprador). A DRE inteira, a
  [ADR-0149](0149-dre-fatia-2-cinco-precos-e-capital-do-lote.md) e os cards de
  Publicados/Faturamento já falam nas duas bases conforme a pergunta; unificar em uma só perderia
  informação.

## Consequências

- Boas: um número de margem por pergunta; menos 208 linhas de componente e uma função de dinheiro a
  menos; o Sonar deixa de ter dois caminhos que se contradizem.
- Ruins / tradeoffs aceitos: simular um anúncio ficou mais caro em digitação (6 campos contra 3). A
  resposta rápida que se perde era a otimista — a que ignorava frete.
- Como reverter: `git revert` da task que remove o dialog; a DRE não depende dele.

## Critérios de aceite

1. `grep -rn "margem sobre o custo\|margemSimulada" src/` não devolve nada.
2. Todo percentual de margem visível no Pulse diz `s/ venda` ou `markup` (Radar e Sonar) — nenhum
   `%` aparece sem o denominador no rótulo.
3. Clicar em **Simular** numa linha da tabela do Sonar muda o nome da âncora no cabeçalho da DRE.
4. `dialog-margem-sonar.tsx` não existe mais.
