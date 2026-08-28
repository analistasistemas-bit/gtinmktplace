# ADR-0138: Campo de partículas das telas de auth roda em Three.js (GPGPU), carregado sob demanda

**Status:** Aceito
**Data:** 2026-08-28
**Decisores:** Diego (referência e especificação do efeito) + Claude (implementação)

## Contexto

As telas de auth (`/login`, `/reset-senha`, `/definir-senha`) usam o `AuthShell`, sempre dark
(ADR-0080), com um grid fino esvanecido ao fundo. Diego pediu o efeito da landing do Google
Antigravity: um campo de traços curtos que reagem ao ponteiro.

O efeito não é uma biblioteca pronta. Nem shadcn/ui nem MagicUI têm equivalente — o
`Particles` do MagicUI é parallax de pontos redondos, comportamento diferente. E o que dá a
característica do original não é atração ao cursor: é um **anel** que persegue o ponteiro com
interpolação lenta (fator 0.02 por quadro), de modo que existe atraso perceptível; as
partículas dentro do anel crescem e são empurradas, e voltam ao repouso por amortecimento.
Quando o ponteiro sai, o anel segue vagando guiado por ruído.

Uma primeira tentativa em canvas 2D girando cada traço em direção ao cursor foi descartada:
num traço de ~7px a rotação desloca as pontas em ~2px, e a medição no canvas mostrou 0,6% do
quadro mudando entre duas posições de cursor a 470px de distância — o campo tremia, não
acompanhava.

## Decisão

O campo roda em **Three.js com simulação GPGPU**: o estado de cada partícula (deslocamento
acumulado, escala, velocidade) vive num texel RGBA de uma textura float que um shader
reescreve a cada quadro, em ping-pong entre dois render targets; o desenho sai como
`gl_Points` com um SDF de retângulo arredondado girado por ruído simplex.

O `three` **não entra no bundle principal**. É `import()` dinâmico atrás de um teste de
WebGL2 + `EXT_color_buffer_float` feito antes da importação: sem suporte, o módulo nunca é
baixado e a tela fica com o gradiente estático. São ~131KB gzip num chunk próprio, fora do
caminho crítico da primeira tela do app.

Três parâmetros divergem dos números de produção do efeito original, todos por causa da tela
de login:

| Parâmetro | Original | Aqui | Motivo |
|---|---|---|---|
| Alcance do cursor | ~0.32 | 0.75 | o card ocupa o centro; um anel preso ao meio some atrás dele |
| Densidade | 230 (~11.700 partículas) | 20 (~2.000) | na largura do app as partículas se tocam e o campo vira textura |
| Deslocamento do anel | 0.62 | 0.35 | com 0.62 as partículas empilham na casca e formam um donut sólido |

Somam-se um piso e um teto na escala do ponto (a fórmula original assume uma escala maior que
esta simulação produz: sem piso a partícula em repouso sai com menos de 1px; sem teto a do
anel fica 10× a de repouso) e a máscara radial `.auth-particulas`, irmã da do `.auth-grid`,
que contém o campo no miolo em vez de deixá-lo cobrir a viewport.

## Alternativas consideradas

- **Canvas 2D com a mesma lógica de anel:** viável e sem dependência, mas perde o brilho por
  partícula e o teto prático fica em ~2 mil pontos com custo de CPU no thread principal.
  Rejeitada depois que a tentativa de rotação pura provou que o efeito precisa de mais de um
  canal visual para ser percebido.
- **tsParticles / particles.js:** não fazem campo de traços orientados; seriam uma dependência
  grande para reimplementar o efeito por cima mesmo assim.
- **`three` no bundle principal:** rejeitada — 131KB gzip no caminho crítico da tela de
  entrada, paga por todo usuário, inclusive quem não tem WebGL2.
- **Ler as cores dos tokens em runtime:** os tokens da marca são `oklch()` e o `THREE.Color`
  não entende essa função; resolver exigiria pintar num canvas só para ler o pixel de volta.
  Os hex ficam no componente com a origem anotada.

## Consequências

- `three` passa a ser dependência de produção do frontend, com um único consumidor. Se ele
  sair, `src/components/auth-particulas/` sai junto.
- As três telas de auth ganham o efeito juntas — quem criar uma quarta tela sobre o
  `AuthShell` a herda.
- A checagem de WebGL antes do `import()` também mantém o Three fora do jsdom: sem ela, o
  Vitest transformava a biblioteca inteira e estourava timeouts em testes sem relação com o
  efeito.
- `prefers-reduced-motion` rende um único quadro estático, sem `requestAnimationFrame` nem
  listener de ponteiro. Em telas < 768px a densidade cai à metade e a interação de ponteiro é
  desligada.
- A matemática testável (Poisson-disk das posições de repouso e o ruído do passeio do anel)
  vive em `auth-particulas/amostragem.ts`, fora do módulo do Three, e tem teste próprio. O
  shader em si só se verifica na tela.
