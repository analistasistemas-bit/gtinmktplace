# Spike 040 — Revisão adversarial da ADR-0140

**Data:** 2026-08-28
**Revisor:** Codex `gpt-5.6-sol` (effort high), read-only sobre a worktree — **achados reconferidos um a um** contra o código, as ADRs e as fontes públicas da JoomPulse
**Revisa:** [ADR-0140](../decisions/0140-analise-publiai-joompulse-radar-e-sonar.md), com apoio de [ADR-0132](../decisions/0132-analise-avancada-joompulse.md), [Spike 038](038-joompulse-parcial-correlacao-e-semantica.md), [Spike 039](039-joompulse-cobertura-medida.md)

## Resposta curta

A ADR-0140 declarava **"nada bloqueia a implementação"**. Cinco achados foram confirmados com
citação literal, e dois eram bloqueadores duros.

**Desfecho (2026-08-28, mesmo dia):**

- **B-1 (autorização) — RESOLVIDO.** Diego confirmou ter a autorização necessária para usar a
  licença JoomPulse desta forma. A revisão questionava a *forma do registro* na D-25, não a
  existência da parceria. **A ADR-0140 volta a "liberado para implementação".**
- **B-2 (D-9) — RESOLVIDO.** Diego decidiu: preço médio **em reais só no modo EAN**, onde a
  amostra é o mesmo produto; no **modo termo**, percentual / equivalente por unidade. É a saída
  que a própria ADR-0138 adotou. A D-9 e a D-10 da ADR-0140 já refletem isso.
- **Furos financeiros e premissas não medidas — permanecem** como trabalho técnico obrigatório
  antes de a DRE ir ao ar.

---

## Bloqueadores confirmados

### B-1 — D-25 apoia-se em confirmação verbal contra termos escritos que a proíbem

Verificado em https://joompulse.com/termos-e-condicoes (28/08/2026):

- **§4.2** — proíbe "Construir APIs: Criar ou desenvolver APIs ou funcionalidades semelhantes com
  base no serviço ou acessá-lo de uma maneira que ignore a interface regular"; "uso automatizado
  do serviço JoomPulse por meio do uso de bots, scripts ou outros meios automatizados"; e
  "Vender, distribuir ou explorar comercialmente o serviço, as informações e os dados exibidos no
  serviço JoomPulse **sem permissão explícita**".
- **§5.3** — "licença limitada, não exclusiva, **intransferível e revogável** para acessar e usar
  nosso serviço de análise apenas para **fins comerciais internos**".

O Gateway do PubliAI é, ao pé da letra dos três incisos, uma API construída sobre o serviço, de
uso automatizado, servindo organizações terceiras dentro de um SaaS pago. A D-25 registra apenas
"confirmado pela JoomPulse a Diego". Suporte confirmando "server-to-server" não é a "permissão
explícita" que o §4.2 exige, e não cobre nem a redistribuição a organizações-cliente nem a
derivação (cache, relatório de 12 meses, DRE, texto de IA).

**Resolve:** autorização escrita da JoomPulse nomeando Gateway server-to-server, exposição a
organizações terceiras em produto pago, cache de 7 dias, relatório derivado retido por 12 meses e
uso do dado como insumo de IA. Sem esse documento, nenhuma linha de Gateway.

### B-2 — D-9 reintroduz o preço absoluto que a ADR-0138 matou no mesmo dia

A D-9 calcula um **preço médio em reais** sobre o Top 5 do nicho do Sonar. A ADR-0138, escrita em
28/08/2026 a partir de regra do próprio operador
([0138:202-207](../decisions/0138-sonar-linguagem-comercial-e-condicao-de-entrada.md)):

> Este card só existe na busca por **termo**, cuja amostra mistura embalagens: "abraçadeira nylon"
> devolve Kit 500 a R$ 39,90, Kit 1000 a R$ 77,96 e Kit 50 a R$ 19,06 lado a lado. Um
> `bata R$ 39,90` seria alvo de prejuízo para quem for cadastrar outro tamanho de kit — exatamente
> o erro que a **Errata 1 do ADR-0124** proíbe (ela matou as faixas de preço do Sonar porque
> *tercil sobre embalagens diferentes não descreve nicho nenhum*).

A "média sem extremos" é um tercil com outro nome, aplicado ao mesmo universo heterogêneo, no
relatório que decide compra de estoque. O Top 5 por faturamento **agrava** o problema: kits
grandes concentram receita, então a média puxa para o kit de 1000 e o operador aplica no de 50.

**Resolvido em 2026-08-28 por Diego:** as duas saídas, cada uma no seu modo — preço médio em reais
**só no modo EAN**, percentual / equivalente por unidade **no modo termo**.

---

## Furos financeiros confirmados no código

A D-2 promete que "todo valor financeiro exibido tem função pura testada por trás" e a D-18 que
comissão e frete vêm das APIs oficiais. O código existente converte **falha em zero**, três vezes:

| Onde | O que acontece |
|---|---|
| `_shared/ml/listing-prices.ts:17-20` | `percentage_fee ?? 0` e `fixed_fee ?? 0` — HTTP 200 com schema mudado vira **comissão R$ 0** |
| `_shared/ml/tarifa.ts:24` | `sale_fee_amount ?? 0` — mesma conversão |
| `_shared/ml/frete.ts:21-25,55` | `catch { return 0 }` em erro de rede; `list_cost` inválido vira 0; ausência de cobertura vira 0 |
| `_shared/ml/frete.ts:27-32` | `DIMENSOES_DEFAULT` (16×11×6 cm, 300 g) substitui dimensões ausentes **em silêncio** |

Cenário: o endpoint responde 400 "sem me2" → a DRE desconta frete R$ 0 → o operador compra estoque
acreditando numa margem que não existe, com o número rotulado como oficial. A ADR-0095 já registra
incidente real por essa mesma causa. Isso viola a regra do projeto de que valor financeiro nunca
defaulta em silêncio.

**Mitigação já disponível:** `calculadora-ml.ts:15` define
`Proveniencia = 'official' | 'partial' | 'estimated'`. O conserto é propagar essa proveniência até
a célula e recusar a DRE quando não for `official` — não é motor novo.

### Cenários da DRE não podem reutilizar uma cotação

`calcularSensibilidade()` (`calculadora-ml.ts:339-352`) extrapola a comissão **linearmente** a
partir de uma cotação única e **preserva a taxa fixa e o frete anteriores**. Comissão e frete têm
degraus por faixa de preço, e a modalidade vira em R$ 150. Cotação em R$ 78,99 e cenário em
R$ 79,00 caem em faixas de frete diferentes; o cálculo mantém a estrutura antiga e erra com
aparência de precisão cirúrgica. Os cinco cenários da D-15 exigem **cinco cotações**, não uma.

O próprio `dialog-margem-sonar.tsx:76` já invalida a simulação quando o preço muda — o app sabe
disso; a D-15 esqueceu.

### O formulário da D-5 não alimenta o motor

`EntradaCalculadoraML` (`calculadora-ml.ts:17-28`) exige `custosFixos`, `custosVariaveis`,
`rebate` e `margemAlvoPct`. A D-5 pede apenas custo, origem, peso e dimensões — os demais entram
como zero implícito, inflando o lucro unitário. E o **ROI prometido na seção 6 não tem definição**:
não há quantidade, capital imobilizado nem horizonte.

**A trava de imposto da D-17 está correta** e coerente com a ADR-0086 e com
`dialog-margem-sonar.tsx:64-75`. **A D-18 também está correta** quanto a não embutir tabela: a
grade de `tabela-frete.ts` é 7×4 obtida da API, sem valores em código. O risco residual é outro —
ela usa **pacotes representativos**, e um pacote real de 40×30×20 cm mapeado para a linha de 2 kg
devolve o frete de outro pacote. Serve para orientação, não para a DRE "exata" da seção 6.

---

## Contradições internas

| # | Contradição |
|---|---|
| C-1 | **D-11 × D-12.** A D-11 diz que a correlação por `id` cobre anúncio **sem catálogo**; a D-12 encerra com "anúncio sem ficha de catálogo permanece sem Análise PubliAI". Duas implementações conformes fariam coisas opostas. A frase da D-12 é resíduo do enquadramento da ADR-0132 — o que a D-12 rejeita é o casamento por título, não o anúncio sem ficha. |
| C-2 | **Linha 137 × linha 145.** A ADR afirmava a cobertura como medida (Spike 039) e, sete linhas abaixo, "A cobertura real (...) **também não foi medida**". Resíduo pré-Spike 039. **Corrigido nesta entrega.** |
| C-3 | **D-13 × D-22.** O relatório espera dado novo a cada dia; o cache cru vive 7 dias. A chave do cache não foi definida. Consulta de 1/9 sobrevive até 8/9 e o botão "atualizar" de 5/9 devolve dado de 1/9 com carimbo novo. A chave precisa conter a data do snapshot. |
| C-4 | **Estado da célula × granularidade da consulta.** A tabela de estados diz "anúncio não rastreado pela JoomPulse", mas depois da emenda do Spike 039 a consulta é **por catálogo**. O rótulo manda o operador investigar o anúncio dele quando a ausência é do catálogo. |
| C-5 | **D-27 assume o pior caso sem base.** A §7 da política de privacidade diz: "Você pode desconectar o cliente de IA da sua conta JoomPulse a qualquer momento **a partir do próprio cliente de IA**. A desconexão revoga as credenciais de acesso anteriormente emitidas." Isso descreve o caminho do cliente MCP oficial; se cobre também a credencial OAuth de um Gateway próprio é **exatamente o que não foi testado** — em nenhuma das duas direções. A D-27 adota "revogação remota é inexistente" porque o suporte não soube informar, mas o documento público do fornecedor afirma revogação no caminho que ele conhece. A premissa é **não testada**, não refutada; o risco é a UI avisar o cliente de algo que o fornecedor promete não acontecer. |

---

## Premissas ainda não medidas

O Spike 039 mediu o universo do **Radar**. A ADR-0140 aplica esses números ao **Sonar**, e isso
não foi verificado:

1. **Os 82% vêm de `pulse_ofertas`** — concorrentes catalogados coletados pelo Radar. O Sonar
   busca por termo: outro universo, com anúncios fora de catálogo, outras categorias e outras
   embalagens. A cobertura do Sonar é **desconhecida**.
2. **O Top 5 da D-9 pode não existir.** Só 8 de 90 anúncios de concorrentes tinham
   `orderCount1m > 0`. Se a proporção valer no Sonar, uma amostra de 20 teria ~2 elegíveis — e a
   D-10 testa "menos de 5 **no nicho**", não "menos de 5 **elegíveis**". Com 20 anúncios e 2 com
   receita, a regra considera o nicho grande e a exclusão de extremos deixa zero elementos.
3. **A consulta em lote da D-4 nunca foi testada no tamanho real.** O teste usou 10 catálogos. O
   Radar **não pagina** (`src/pages/Pulse.tsx:79`, `fetchPulseProdutos` sem `range`/`limit`): são
   229 catálogos ativos hoje, contra o limite de 100 do CubeJS medido no Spike 038. A "consulta
   única ao abrir a tela" falha inteira em vez de degradar por lote.
4. **Nunca se comparou duas credenciais nem dois planos.** A D-26 assume respostas iguais entre
   contas porque a JoomPulse afirmou; um plano básico que omita uma measure disponível no avançado
   quebraria o relatório de um cliente e não do outro.
5. **Campos prometidos sem consulta registrada:** preço mínimo histórico, desconto máximo, vendas
   de 365 dias do vendedor e o formato de deep link aparecem na ADR sem nenhuma das quatro
   consultas dos spikes tê-los retornado.

---

## Lacunas de desenho

- **As seções 2, 3 e 7 do relatório não têm contrato.** Nenhum dos quatro documentos define campos,
  fontes, unidades, nulabilidade ou critério de aceite. Não há como escrever teste.
- **Qual modo do Sonar recebe o botão?** Busca por termo e busca por EAN são universos diferentes
  (ADR-0127). A D-13 persiste "por produto", mas no modo termo não existe produto.
- **Segurança da camada de IA.** Título e nickname de terceiros entram no prompt: não há defesa
  declarada contra prompt injection, nem verificação determinística de que a IA não inventou número
  — que é exatamente o que a D-2 proíbe.
- **Multi-tenancy dos dados novos.** As tabelas Pulse atuais têm RLS correta
  (`20260816125057_pulse_v1.sql:65`), mas não há schema nem RLS desenhados para credencial, cache
  cru, relatório, custo de IA e auditoria. Workers com `service_role` ignoram RLS; a ADR-0027 exige
  propagação explícita e teste cross-tenant.
- **Falta o estado "conexão ML expirada".** Seis seções abrem com a JoomPulse, mas comissão e frete
  vêm do ML: a máquina de estados só cobre falhas da JoomPulse.
- **D-23 não define a janela** de "indisponibilidade que persista além da janela".
- **D-21 mantém consumo sobre assinatura possivelmente pessoal** após o titular sair, contra a
  licença intransferível do §5.3.
- **Os scripts do Spike 039 ficaram em diretório efêmero.** Sem dataset, sem hash de amostra, sem
  estratificação: a medição que liberou a coluna não é reproduzível.

## O que a revisão confirmou como correto

- A separação de três camadas da D-2 (dado / cálculo / texto).
- A trava LOUD de imposto por origem da D-17.
- A recusa do casamento por título (intenção da D-12).
- A D-18 quanto a não embutir tabela de comissão ou frete em código.
- A emenda do Spike 039 à D-4 (ganhador por vendedor, não por anúncio).

## Ordem de ataque sugerida

1. Autorização escrita da JoomPulse (B-1) — precede tudo.
2. Reescrever a D-9 em percentual/equivalente por unidade (B-2).
3. Fault injection nas APIs do ML: 400/401/429/500, timeout, schema sem `sale_fee_amount`,
   `list_cost` ausente, `me2=false`. Todo caso deve produzir "DRE indisponível", nunca zero.
4. Medir a cobertura no universo real do Sonar (termo e EAN), com o `N` elegível por consulta.
5. Testar a consulta em lote no tamanho real do Radar e definir o lote.
6. Fechar o contrato das seções 2, 3 e 7 antes de qualquer código de relatório.
