# ADR-0124 — Veredito de oportunidade do Sonar

- **Status:** aceito
- **Data:** 2026-08-18
- **Relacionados:** ADR-0120 (Sonar), ADR-0122 (vendas via Apify), ADR-0020 (semáforo de preço)

## Contexto

O Sonar mostrava sete números crus (visitas, fichas, ofertas, vendedores, frete grátis, vendas,
mercado endereçável) e deixava a conclusão para o operador. Diego pediu um veredito: *"quero bater
o olho e saber se é viável ou não, sem precisar calcular nada"*.

O problema não era falta de dado, era que os números **exigem cruzamento mental e têm armadilhas**:
os KPIs de cima falam de 40 fichas de catálogo e o bloco de vendas fala de 20 anúncios da busca
(universos diferentes); visitas são de 30 dias e vendas são acumuladas desde o lançamento (janelas
diferentes); e as vendas cobrem só o topo do ranking. Cruzar isso de cabeça leva a erro.

## Decisão

Um card de veredito no topo da aba Sonar — 🟢 alta / 🟡 média / 🔴 baixa — com uma frase de motivo
e os fatores que o produziram, calculado por função pura no frontend
(`src/lib/veredito-sonar.ts`) a partir dos dois payloads que a tela já recebe. Sem endpoint novo,
sem custo adicional.

### 1. Postura editorial: oportunidade = dá para ENTRAR e vender

Não é "mercado grande". Mercado gigante e saturado vale **média**; nicho pequeno com venda provada
e quase sem concorrente vale **alta**. É o que a ferramenta promete — garimpo antes de cadastrar.

### 2. Métrica descartada: "visitas por oferta"

Foi a primeira proposta e está errada por dois motivos. Ela pune o nicho pequeno duas vezes (as
visitas já subestimam o tráfego, porque medimos só o anúncio mais barato de até 40 fichas) e mede
**atenção**, não **compra**. Aplicada aos dados reais, classificaria "tecido oxford 10 metros" —
nicho em que a operação vende de verdade — como oportunidade baixa.

### 3. Os fatores e as faixas

| Fator | Fórmula | 🟢 | 🟡 | 🔴 |
|---|---|---|---|---|
| **Demanda** | `itens_com_vendas / itens_analisados` (liquidez) + `vendas_totais` | liquidez ≥ 70% **e** vendas ≥ 5.000 | resto | vendas < 1.000 **ou** liquidez < 30% |
| **Disputa** | `vendedores_distintos` + `frete_gratis_pct` | ≤ 10 vendedores **e** ≤ 50% frete | resto | > 25 vendedores **ou** ≥ 85% frete |
| **Tração** | `valor_mercado / vendedores_distintos` | ≥ R$ 150 mil/vendedor | R$ 30–150 mil | < R$ 30 mil |
| **Marca** | % de fichas ativas com loja oficial | < 20% | 20–50% | > 50% |

Por que **liquidez** e não vendas absolutas: normaliza o tamanho do nicho — "dos anúncios do topo,
quantos de fato vendem?". É a única prova de compra que não é estimativa (o ADR-0120 proíbe
derivar vendas de visitas). O piso absoluto impede que um nicho morto com 3 anúncios passe.

Por que **vendedores** e não ofertas: ofertas inflam com multi-anúncio do mesmo seller.
`frete_gratis_pct` entra como proxy de profissionalização — 88% num nicho é campo de vendedor
estruturado (Full); 23% é campo amador, onde dá para entrar.

Por que **valor por vendedor**: R$ 600 mil entre 7 vendedores é negócio; entre 200 não é. Absorve o
ticket automaticamente, o que dispensa um fator de preço separado.

### 4. Combinação

Demanda, Disputa e Tração pontuam 🟢=2, 🟡=1, 🔴=0. **Demanda 🔴 é gate absoluto** (sem prova de
compra não existe oportunidade, por melhores que sejam os outros); fora isso, alta a partir de
`máximo − 1` e baixa até `máximo / 3`. A escala é proporcional ao número de fatores disponíveis
para o fallback (abaixo) não virar "baixa" só por ter um fator a menos.

### 5. Marca só alerta na pontuação; fecha a Entrada (ADR-0128)

Decisão do Diego: nicho dominado por loja oficial gera aviso — com menção explícita ao risco de
moderação por propriedade intelectual, que já custou o cancelamento do Aquaphor — mas **não altera
a pontuação** de Demanda/Disputa/Tração. Fica visualmente separado dos três que pontuam, para não
parecer que entra na conta.

**ADR-0128:** marca ruim (>50% loja oficial) **fecha a Entrada** (`entrada = 'fechada'`), o que
impede `nivel === 'alta'` e muda o título para "Demanda … · entrada fechada". Continua sem
pontuar: só controla a pergunta "dá para entrar?", não a pergunta "vende?".

### 6. Fallback sem vendas

Apify fora do ar ou sem token: Demanda cai no proxy de visitas 30 d (🟢 ≥ 10.000, 🔴 < 300 — cortes
generosos porque o número subestima), Tração sai da conta e o card marca "sem dados de venda".
Nunca converte visitas em vendas.

### 7. Vocabulário distinto do ADR-0020

O `SemaforoPreco` já usa "Vale a pena" em verde para outra pergunta: *este preço cobre meu custo e
meu piso?*. O veredito julga o **nicho**, não um preço — daí "Oportunidade alta/média/baixa",
ícones de tendência em vez de círculos, e nenhum reuso de `calcularSemaforo`. Dois "vale a pena"
com sentidos diferentes na mesma tela seria pior que dois nomes.

## Calibração e validação

Faixas sugeridas por análise dedicada e testadas contra os três nichos reais medidos em 18/08, que
viraram o gabarito em `src/lib/__tests__/veredito-sonar.test.ts`:

| Nicho | Demanda | Disputa | Tração | Veredito |
|---|---|---|---|---|
| EUCERIN protetor solar | 🟢 75%, 154 mil | 🔴 27 vendedores, 88% frete | 🟢 R$ 647 mil/vend. | 🟡 média |
| protetor solar facial | 🟢 85%, 812 mil | 🔴 idem | 🟢 R$ 2,2 mi/vend. | 🟡 média |
| tecido oxford 10 metros | 🟢 81%, 8.100 | 🟢 7 vendedores, 23% frete | 🟡 R$ 85 mil/vend. | 🟢 **alta** |

O tecido oxford dar **alta** é o critério de aceitação da regra: é um nicho pequeno em que a
operação lucra, e qualquer calibração que o condene está errada por construção.

**Guard descartado durante a implementação:** a sugestão original bloqueava Disputa 🟢 quando
`total_catalogo` estivesse saturado em 10.000. Medição posterior mostrou que **os dois nichos
reais, de tamanhos opostos, exibem exatamente 10.000** — o ML satura esse campo —, então o guard
desligaria o fator Disputa em quase todo termo. Quem discrimina é `vendedores_distintos` na
amostra (27 contra 7). Há teste travando isso.

## Premissas frágeis (o que revisitar)

1. **Vendas acumuladas não são ritmo.** Anúncio de 2019 infla Demanda e Tração. Melhoria de maior
   retorno: ler `date_created` do item (API oficial, grátis) e anualizar.
2. **Calibração com N=3.** Os cortes vêm de três nichos. O caminho para melhorar é rodar 20–30
   termos que o Diego rotule "entraria / não entraria" e ajustar contra esse gabarito.
3. **Liquidez tende a alto** — o ranking do ML já favorece quem vende, então o top-20 é enviesado.
   Se na prática tudo der ≥ 70%, subir o corte para 80–85%.
4. **Denominadores de universos diferentes** na Tração: `valor_mercado` vem do scraper (top ~20 da
   busca) e `vendedores_distintos` da API oficial (40 fichas). Vale como razão comparativa entre
   termos, não como número absoluto.
5. **Frete grátis como proxy de profissionalização** é heurística não validada; conferir contra %
   de vendedores com Mercado Envios Full quando esse dado for coletado.

Os cortes são constantes nomeadas num único módulo justamente para essa recalibração ser uma
troca de número, não uma refatoração.

## Adendo (2026-08-18) — "Saiba mais" determinístico

O card ganhou um expansível "Saiba mais" que traduz o veredito em linguagem de mercado. Decisão:
**explicação 100% determinística** (templates sobre os mesmos cortes deste ADR), nunca gerada por
IA — custo zero, sem latência, sem risco de interpretação inventada, e testável junto do gabarito.
Conteúdo: pontuação real (`soma de máximo` + gate de Demanda explícito), frase por fator com o
número da amostra vs. o corte, mini-régua das faixas, o delta até a próxima faixa ("para
destravar"), uma frase de ação por nível e um bloco "Contexto do nicho" com dados que o score não
usa (mediana de preço das fichas, ticket médio, % Full e % internacionais da amostra Apify) —
rotulado como fora da pontuação. Implementação em `src/lib/veredito-sonar.ts` (campo aditivo
`explicacao` + `contextoNicho`), render em `src/components/pulse/veredito-sonar.tsx`.

## Adendo (2026-08-21) — Área "Insights do nicho"

O card tinha um lado direito pobre: só a frase-resumo. Diego quer o Sonar como diferencial de
SaaS premium frente a concorrentes (Hunter Spy, JoomPulse), que mostram vários insights sempre
visíveis, não escondidos atrás de um expansível. Decisão, grillada em sessão de `/grill-with-docs`
com análise cruzada via modelo Fable dos dois concorrentes:

**1. Só o Sonar.** O Radar (`Pulse.tsx`) tem modelo de dado diferente; herda o padrão depois, como
entrega separada.

**2. Continua 100% determinístico.** Nenhum dos três cards novos abaixo exige IA em runtime — todos
promovem cálculo que `calcularVereditoAnuncios`/`rivaisPodio` já produzem, sem novo endpoint e sem
novo custo. A postura editorial deste ADR (nunca gerar interpretação por IA) permanece intacta;
abrir espaço pra texto gerado por IA (ex.: um "copiloto" consultivo) fica como decisão futura
separada e explícita, não implícita nesta entrega.

**3. Frase-resumo (`resumoVeredito`) ganha tom mais amigável/comercial.** Ex.: "Tem gente
comprando, mas o topo é Full. Não enche estoque." vira algo como "Mercado aquecido, mas dominado
por quem já tem Full — entrar com estoque grande é nadar contra a maré." **Guardrail inegociável:**
quando a ação é "não compre estoque", isso continua cristalino — é decisão de dinheiro real, tom
mais leve não pode diluir o aviso.

**4. Nova seção "Insights do nicho"**, sempre visível, dentro do mesmo `Card`, entre a frase-resumo
e o botão "Saiba mais" — não fica escondida atrás do expansível, ao contrário do resto da
explicação (que continua determinística e agora colapsada). Reaproveita o padrão visual de
mini-card já usado em `painel-analise.tsx` (borda, `bg-card`, ícone Lucide + label), em vez de um
componente novo.

**5. Três cards nesta entrega** (ranqueados pelo Fable entre o que já está calculado e na tela, sem
custo extra; os demais — mercado endereçável, barreiras estruturais, qualidade, desconto médio,
tendência de visitas — ficam de backlog):

   - **Por que a entrada está aberta/fechada + como destravar** — de `entrada` +
     `explicacao.fatores[].destravar`. Diferencial real: nenhum dos dois concorrentes explica o que
     precisaria mudar pra abrir o nicho.
   - **Pódio de rivais** — de `rivaisPodio` (top 5 por faturamento, inclui "fantasma" sem rótulo de
     loja). Sai de dentro do "Saiba mais" (não duplica a lista).
   - **Faixas de preço da amostra** (barato/médio/premium por tercis de `preco`) — nova sort sobre
     dado já lido.

**6. Ausência de dado nunca vira sinal bom, e cards vazios se escondem** (mesma regra do resto do
Sonar — RaioX já faz isso): `entrada === 'nao_medida'` mostra a causa da não-medição em vez de
chutar aberta/fechada; `rivaisPodio` vazio esconde o card inteiro (nunca "0 rivais"); amostra de
preço pequena demais para tercis cai para min–max simples.

**7. Sem paywall.** O PubliAI não tem infraestrutura de tier por feature dentro do Sonar hoje
(billing é por assinatura da conta, ADR-0028); os insights são função pura sem custo marginal por
usuário. "Premium" aqui é posicionamento de produto, não gate de acesso — criar gating seria escopo
novo não pedido.

Implementação prevista em `src/lib/veredito-sonar.ts` (dados) e
`src/components/pulse/veredito-sonar.tsx` (render), como entrega separada desta sessão de design.
