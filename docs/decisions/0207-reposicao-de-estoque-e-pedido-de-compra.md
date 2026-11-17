# ADR-0207 — Reposição de estoque e pedido de compra (orgs sem ERP)

Status: ACEITO (2026-11-17) — no ar em produção (main fdb30add + polimento); números validados com dados reais da loja piloto (conta por SKU conferida à mão contra o ledger; tela = cálculo); 1º pedido real pendente com o Diego · decisões do grilling com o Diego + revisões Fable 5.2, GPT 6.1 Sol (high) e Grok 4.7 (xhigh) aceitas na íntegra pelo Diego · Relaciona: ADR-0094 (estoque único no app), ADR-0134 (alerta de estoque zerado), ADR-0172 (Vendas SKU), ADR-0181 (entrada por nota de compra), ADR-0200/0205 (kits) · Glossário: `CONTEXT.md`, seção "Reposição de estoque" · Spec: `docs/superpowers/specs/2026-11-16-reposicao-design.md`

## Contexto
Zaven, DSA e Daludi Shop não têm ERP e refazem compras de cabeça. A Zaven pediu, para a Calça Sarja, saber quais cores e tamanhos repor e quando aumentar o pedido. Vale para qualquer produto, com ou sem grade.

Medido em produção (16/11): Zaven tem vendas no ML só desde 03/11 (72 vendas, 311 SKUs) e ledger de estoque desde 18/10; DSA desde 2017; Daludi Shop desde 19/09. Na Calça Sarja (00000169), cada SKU vendeu 0–3 un. e 4 SKUs com venda estão zerados (8 das 13 vendas). A coluna FORNECEDOR da planilha está 100% preenchida, mas na DSA e na Daludi Shop traz a **marca**, com grafias duplicadas. Promoções guardam só a foto atual de participação, sem histórico. `kit_saida`/`kit_entrada` são transferência de estoque base→kit, não venda (`20261108031720_kit_variacao_inventario.sql`).

"Recompra" já é termo da Fatia 3 de Vendas SKU (cliente final que compra de novo); esta feature usa **Reposição**.

## Decisão

### Parâmetros
1. **Um prazo de reposição e uma cobertura desejada por org**, em dias, para todos os fornecedores (Zaven: 15 e 30). A data prevista de cada pedido é editável.

### Demanda
2. **Dia disponível** = estoque > 0 **e** anúncio ativo no canal (a partir da primeira publicação; pausa, moderação e encerramento ficam fora). Reconstruído pelo `estoque_movimentos.estoque_resultante` e pelo histórico de status do anúncio.
3. **Unidades vendidas** = vendas menos cancelamentos. Devolução não desconta: a unidade foi vendida; se voltar vendável, entra no estoque pelo estorno. Nunca há velocidade negativa.
4. **Kits:** a demanda da base inclui a venda direta mais a venda de cada kit × unidades da base na composição; a parcela do kit é dividida pelos dias disponíveis **do kit**. Estoque montado em kit **não** conta como estoque da base (não atende venda avulsa). `kit_saida`/`kit_entrada` nunca contam como venda. O kit não é item a comprar.
5. **Ordem de cálculo (fixa, cada ajuste aplicado uma vez):**
   1. unidades por dia e SKU, com a parcela dos kits;
   2. **dia atípico** no grão da família: dia em que a família vendeu mais de 3× a mediana dos seus dias com venda e ≥ 4 un. é limitado ao teto, e o corte é repartido entre os SKUs do dia na proporção do que venderam;
   3. **venda em oferta**: preço unitário ≥ 15% abaixo do percentil 75 do preço do SKU na janela (com menos de 5 vendas do SKU, o percentil 75 da família);
   4. **velocidade própria** por SKU = unidades ÷ dias disponíveis, janela de 60 dias ou o histórico disponível;
   5. **curva da família**;
   6. **mistura** própria × curva;
   7. **tendência** da família.
6. **Curva da família** = participação de cada cor e de cada tamanho na velocidade por dia disponível, como produto das marginais cor × tamanho, só entre SKUs elegíveis (existentes e sem Não repor). Velocidade da família = soma das velocidades próprias.
7. **Mistura gradual:** v = w × própria + (1 − w) × curva × velocidade da família, com w = min(1, unidades vendidas do SKU na janela ÷ 6). Depois, as velocidades dos SKUs são **reescaladas para somar a velocidade da família**: a mistura não cria demanda.

### Tendência
8. Calculada **na família**, só com ≥ 28 dias de histórico disponível, excluindo dias em oferta. Recente (14 dias disponíveis) × base (60). **Acelerando:** recente ≥ 1,3 × base e ≥ 5 vendas recentes. **Esfriando:** recente ≤ 0,7 × base e a base esperava ≥ 5 vendas nos 14 dias. Nos dois casos, todas as velocidades da família são multiplicadas por (recente + base) ÷ (2 × base). A tela mostra o ajuste aplicado ("+20% no pedido"), não só a variação das vendas.

### Quantidade
9. **Projeção diária por SKU**, de hoje até hoje + prazo + cobertura: o estoque cai pela velocidade, sem ficar negativo (venda perdida não consome mercadoria que ainda vai chegar), e sobe na data prevista de cada pedido aberto; pedido atrasado entra como se chegasse amanhã.
10. **Falta do SKU** = max(0, velocidade × cobertura − estoque projetado no dia hoje + prazo − chegadas previstas depois disso, dentro da cobertura).
11. **Estoque de segurança na família:** folga = quantil 85% de Poisson(Σ velocidades × cobertura) − Σ velocidades × cobertura, repartida entre os SKUs com falta na proporção da velocidade. A folga tem piso 0: com Σ velocidades × cobertura ≲ 0,16 o quantil 85% é 0 e a família não ganha folga (só a falta e o mínimo de 1 do item 12).
12. **Inteiros:** o total da família (falta + folga) é arredondado para cima e, se houver múltiplo de compra, até o próximo múltiplo; o total é distribuído entre os SKUs pelo maior resto, e a soma sempre fecha. SKU com venda nos últimos 30 dias e estoque projetado zero na chegada recebe no mínimo 1. O múltiplo de compra é da família (`familias.multiplo_compra`), definido na linha do produto, e só admin muda (vale para toda compra daquele produto).
13. **Não repor** por SKU, cor ou família: sai da sugestão e da curva.

### Urgência
14. Sai da mesma projeção do item 9, nunca de outra conta:
    - **Ruptura**: estoque hoje 0 e velocidade > 0 (com pedido a caminho, mostra "chega dd/mm");
    - **Vai faltar**: a projeção zera antes de hoje + prazo;
    - **Pedir agora**: há quantidade a pedir pelo item 12;
    - **Em dia**: nada a pedir.
    Todo SKU com quantidade a pedir está numa faixa de ação. Excesso fica fora da v1.

### Pedido
15. **Pedido de compra no app:** a sugestão aprovada (como veio ou editada) vira pedido de um fornecedor. Rascunho é da org (salvo e compartilhado); só admin aprova; o admin é avisado no app quando há rascunho esperando. Estados: Rascunho → Aprovado → **Enviado ao fornecedor** (marcado ao copiar o texto ou à mão) → Parcial → Recebido / Saldo encerrado; Atrasado é um alerta sobre Enviado ou Parcial. Editável (quantidade, data) até o primeiro recebimento, com registro de quem alterou; depois de aprovado, só admin edita (senão a edição pularia a aprovação). Prazo e cobertura (configuração da org) também só admin.
    - **Data prevista ≠ hoje + prazo:** "aprovar não gera nova sugestão" vale para o pedido previsto para hoje + prazo. Se a data prevista for antes, a mercadoria entra antes na projeção e parte dela é consumida até hoje + prazo; se for depois, há dias sem a mercadoria e a chegada só conta na cobertura. Nos dois casos a sugestão logo após aprovar pode mudar um pouco — é esperado, é a projeção com a data real.
16. **Recebimento vinculado:** a entrada escolhe o pedido. Nota de compra pré-seleciona o pedido aberto do fornecedor do CNPJ emitente (o fornecedor ganha CNPJ opcional) e nem oferece pedido de fornecedor com outro CNPJ; pedido de fornecedor ainda sem CNPJ só recebe a nota depois de o operador confirmar que esse fornecedor passa a ser identificado pelo CNPJ do emitente (sem a confirmação, o banco recusa e nada é gravado); entrada manual pergunta "De qual pedido?" (pedidos abertos com o SKU, ou "nenhum", que não baixa). Excedente entra no estoque e fecha o item sem saldo negativo. Desfazer a nota desfaz a baixa. No parcial, o sistema pergunta "o restante ainda vem?"; "não" encerra o saldo, mostrando antes quais itens serão encerrados, e é reversível.

### Aviso e medição
17. **Resumo de reposição diário** (app + Telegram, categoria nova `reposicao`): só o que entrou em Ruptura, Vai faltar ou Pedir agora desde o último aviso, mais pedidos atrasados e rascunho esperando aprovação. Sem novidade, sem aviso. Categoria nova exige as 2 CHECKs e o redeploy do `usuarios` (lição do ADR-0134).
18. **Foto diária da sugestão:** sugestão e velocidade de cada SKU gravadas por dia, para comparar previsto × vendido e recalibrar os limites. A v1 grava; a tela de acurácia vem depois.

### Fornecedor, acesso
19. **Fornecedor como cadastro da org:** agrupa nomes da coluna FORNECEDOR normalizados por caixa e acento; CNPJ opcional. Junção manual de nomes (aba Fornecedores) fica para a fase DSA/Daludi Shop. Um pedido = um fornecedor. `vinculos_fornecedor` aparece no texto do pedido quando existir.
20. **Módulo `reposicao` por org** na Central, incluso no plano por ora. Item próprio no menu, logo abaixo de Estoque.

### Emenda 17/11 (consultor)
21. **Completar grade:** SKU sem nenhum movimento de estoque (em data nenhuma) fica fora da curva da família e da reescala, como se não fosse elegível: velocidade 0, pedido 0 e Em dia para todos os fins (cards, filtros, urgência da família, venda perdida, resumo diário). Recebe à parte a estimativa `completarGrade` = max(1, ⌈share da cor × share do tamanho × velocidade da família × cobertura⌉), com os shares e a velocidade da família dos SKUs elegíveis (cor ou tamanho que só ele tem usa o share médio 1/n daquela dimensão; família sem venda dá 0), sem mudar o número de nenhum outro SKU. O total da família nunca inclui essa estimativa; ela só entra no rascunho quando a organização clica "Incluir no pedido" no mapa da grade. SKU que já teve estoque e zerou continua Ruptura (item 14).
22. **Primeiro pedido da org:** o primeiro "Aprovar pedido" (org sem nenhum pedido fora de rascunho) pede confirmação com o total de unidades, o percentual ainda estimado pela família e o fornecedor, lembrando que o PubliAI não envia nada. Sem teto em R$.

## Condição para a fase 2 (DSA e Daludi Shop)
Antes de ligar o módulo nessas orgs: **validade e lote** (cosmético/saúde comprado para 30 dias pode vencer) e **sazonalidade** pelo mesmo período do ano anterior (DSA tem vendas desde 2017).

## Fora da v1
PDF do pedido (o texto para WhatsApp basta), aba Fornecedores, gráfico de projeção, faixa e card Excesso, teto em R$ por pedido, prazo por fornecedor, pedido mínimo e grade fechada do fornecedor, tela de acurácia, separação de estoque Full.

## Riscos
- Zaven: com no máximo 3 vendas por SKU, w ≤ 0,5 por semanas; a curva pesa pelo menos metade. A tela diz isso com o percentual de produtos ainda estimados pela família, sem prometer data.
- Poisson na família subestima folga quando a venda vem em rajadas; a foto diária mede o erro e decide se a v2 troca por binomial negativa.
- Histórico de status do anúncio (para o dia disponível) precisa ser confirmado na fonte antes do plano; se não existir, a v1 usa a data da primeira publicação e trata pausa como disponível, declarando o limite.
- Limites (6 vendas, 1,3/0,7, 3× mediana, 15% sobre o percentil 75, quantil 85%) são iniciais; recalibrar com a foto diária após 60 dias.
- Critérios de aceite obrigatórios no plano: aprovar um pedido não gera nova sugestão sem venda nova; nenhum SKU com quantidade a pedir aparece como Em dia; a soma por SKU fecha com o total da família; entrada do fornecedor B nunca baixa pedido do fornecedor A.
