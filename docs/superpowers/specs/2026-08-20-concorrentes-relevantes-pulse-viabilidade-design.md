# Concorrentes relevantes no Pulse e na Viabilidade

**Status:** aprovado em conversa; aguardando revisão do documento  
**Data:** 2026-08-20  
**Decisor de produto:** Diego

## Objetivo

Impedir que ofertas sem atividade ou de vendedores sem força comercial distorçam o menor preço,
a posição competitiva, os alertas e os cálculos financeiros. A mesma regra deve ser usada no
Pulse/Radar e na Análise de Viabilidade.

O sistema continuará preservando todas as ofertas coletadas como mercado observado. Somente as
ofertas qualificadas poderão compor o mercado relevante e influenciar decisões.

## Evidência que motivou a mudança

No produto Aptamil Premium 1 800 g, GTIN `7891025111825`, foram observadas 90 ofertas ativas:

- menor oferta observada: R$ 36,00;
- mediana: R$ 81,45;
- 33 vendedores com zero transações informadas;
- 56 anúncios com zero visitas medidas nos últimos 30 dias;
- corte de 10 transações, excluindo somente visitas medidas iguais a zero: 28 ofertas relevantes
  e menor preço relevante de R$ 70,19.

O preço de R$ 36,00 atualmente alimenta tanto o Pulse quanto a Viabilidade, inclusive comissão,
imposto, frete, líquido e semáforo. Isso produz uma referência comercial que o operador não deseja
acompanhar.

## Decisões

### Duas camadas de mercado

- **Mercado observado:** todas as ofertas ativas retornadas ou coletadas.
- **Mercado relevante:** somente ofertas que passam pela qualificação.

Ofertas fora da referência não serão apagadas. Permanecerão auditáveis, com o motivo da
classificação.

### Regra inicial fixa

A regra será única e não configurável nesta primeira versão.

Uma oferta será classificada da seguinte forma:

| Condição | Classificação | Motivo |
|---|---|---|
| `transactions_total` é `null` | Em observação | `DADOS_INSUFICIENTES` |
| `transactions_total < 10` | Fora da referência | `POUCAS_TRANSACOES` |
| `visitas_30d === 0` | Fora da referência | `SEM_VISITAS_30D` |
| reputação `1_red` ou `2_orange` | Fora da referência | `REPUTACAO_BAIXA` |
| passou pelas condições anteriores | Relevante | `QUALIFICADO` |

Regras de ausência:

- `visitas_30d = null` significa não medido ou falha de medição e não reprova a oferta;
- reputação ausente não é reputação ruim e não reprova a oferta;
- zero é um valor medido e deve permanecer diferente de `null`.

Se mais de um motivo de exclusão existir, a função poderá devolver todos para explicação na
interface. A classificação final continuará determinística.

### Reputação e métricas do vendedor

O coletor atual precisa normalizar os campos dentro de `seller_reputation`, em vez de procurá-los
no nível raiz da resposta de `/users/{seller_id}`. Devem ser preservados:

- `level_id`;
- `power_seller_status`;
- total e período das transações;
- transações concluídas e canceladas;
- avaliações positivas, neutras e negativas;
- métricas disponíveis de reclamações, atrasos e cancelamentos, com período, taxa e quantidade.

As métricas detalhadas serão exibidas como informação e poderão explicar a qualificação. Nesta
primeira versão, elas não acrescentarão novos limites numéricos além da cor consolidada de
reputação, evitando inventar um corte não validado.

## Arquitetura

### Classificador compartilhado

Uma função pura no domínio compartilhado receberá os dados da oferta e do vendedor e devolverá:

```ts
type QualificacaoOferta = {
  status: 'relevante' | 'observacao' | 'fora_referencia';
  motivos: Array<
    | 'QUALIFICADO'
    | 'DADOS_INSUFICIENTES'
    | 'POUCAS_TRANSACOES'
    | 'SEM_VISITAS_30D'
    | 'REPUTACAO_BAIXA'
  >;
};
```

Pulse e Viabilidade devem consumir essa mesma função. Não serão mantidas cópias da regra na
interface ou em funções distintas.

### Pulse/Radar

O Pulse usará as ofertas atuais e o snapshot mais recente de cada vendedor para produzir:

- ofertas observadas;
- ofertas relevantes;
- menor e maior preço relevantes;
- quantidade de vendedores relevantes;
- quantidade relevante com frete grátis e FULL;
- menor oferta observada, mantida apenas para auditoria.

Somente o mercado relevante alimentará:

- menor concorrente;
- posição do produto;
- alertas competitivos;
- simulação e referência de preço.

### Análise de Viabilidade

A Viabilidade continuará descobrindo o produto e suas ofertas pela API do Mercado Livre. Para
qualificá-las:

1. reutilizará snapshots do Pulse com no máximo 24 horas quando houver correspondência segura pelo
   produto de catálogo/GTIN e pela organização;
2. quando não houver snapshot completo dentro dessa janela, buscará reputação e visitas sob demanda;
3. reputação de vendedor será cacheada por 24 horas;
4. consultas ao Mercado Livre usarão concorrência limitada;
5. os demais produtos do lote continuarão sendo analisados se um GTIN falhar.

O cálculo financeiro usará exclusivamente o menor preço relevante. O menor observado não poderá
ser usado silenciosamente como fallback.

Quando não houver concorrente relevante:

- mostrar `Sem concorrente relevante`;
- não calcular comissão, imposto, frete, líquido, lucro, markup ou semáforo com base no mercado;
- manter o menor observado somente como contexto, claramente marcado como fora da referência.

## Interface

### Pulse

O resumo apresentará:

- `Menor concorrente relevante`;
- `Menor oferta observada`;
- `X relevantes de Y observadas`.

A tabela ganhará:

- qualificação;
- reputação por cor;
- MercadoLíder Silver, Gold ou Platinum;
- motivo da exclusão ou observação;
- indicação explícita de que a oferta impacta ou não a referência.

O filtro inicial exibirá ofertas relevantes. O operador poderá mostrar todas as ofertas observadas.

### Viabilidade

- `Menor na API do ML` será renomeado para `Menor relevante`;
- `Vendedores` exibirá `X de Y`, relevantes sobre observados;
- a linha expandida mostrará o intervalo do mercado relevante;
- a menor oferta observada será exibida separadamente quando diferir da referência;
- sem concorrente relevante, os campos financeiros dependentes do mercado mostrarão travessão e
  a mensagem correspondente.

No caso de referência aprovado, o Aptamil deverá mostrar R$ 70,19 como menor relevante e R$ 36,00
como menor observado fora da referência.

## Estatísticas

Preço mínimo, preço máximo, vendedores, frete grátis e FULL apresentados como mercado competitivo
serão calculados apenas entre ofertas relevantes. Os totais brutos permanecerão identificados como
mercado observado.

## Resiliência e segurança

- Falha ao obter transações deixa a oferta em observação e fora dos cálculos.
- Falha apenas na consulta de visitas produz `null` e não reprova a oferta.
- Falha na reputação não equivale a reputação baixa.
- Nenhuma falha autoriza voltar ao menor preço observado como fallback financeiro.
- A classificação não altera nem exclui dados brutos do Mercado Livre.
- Consultas e caches devem permanecer isolados por organização quando contiverem dados próprios
  dela; dados públicos de vendedor podem usar cache global já existente, sem incluir credenciais.

## Validação

### Testes unitários

- limites de 9 e 10 transações;
- visitas iguais a zero, positivas e `null`;
- reputações verde, verde-clara, amarela, laranja, vermelha e ausente;
- múltiplos motivos de exclusão;
- agregação separada de mercado observado e relevante.

### Testes de contrato e integração

- normalização de uma resposta realista de `/users/{seller_id}` com `seller_reputation` aninhada;
- mesma entrada produzindo a mesma qualificação no Pulse e na Viabilidade;
- nenhum relevante impedindo cálculos financeiros;
- falha isolada de um GTIN não derrubando o lote;
- cache e limite de concorrência das consultas adicionais.

### Testes de interface

- contagem `X de Y`;
- badges e motivos;
- filtros de relevantes e todas;
- menor observado separado do menor relevante;
- estado `Sem concorrente relevante` sem valores financeiros derivados.

### Cenário de aceitação

Para o GTIN `7891025111825`, usando o snapshot analisado em 2026-08-20:

- R$ 36,00 permanece como menor oferta observada;
- R$ 36,00 não afeta preço, posição, alerta ou viabilidade;
- 28 de 90 ofertas são relevantes;
- R$ 70,19 é o menor concorrente relevante;
- Pulse e Viabilidade apresentam a mesma referência.

## Fora de escopo

- configuração do corte por usuário ou organização;
- exclusão física de ofertas;
- inferência de vendas específicas do anúncio;
- descarte automático baseado apenas em preço atípico;
- novos limites baseados nas taxas detalhadas de reclamação, atraso ou cancelamento;
- alteração automática de preços ou de dados de produtos.

## Implantação e observabilidade

A mudança deve ser implantada em etapas compatíveis:

1. persistência e normalização correta dos dados de reputação;
2. classificador compartilhado e testes;
3. Pulse usando o mercado relevante;
4. Viabilidade usando o mercado relevante;
5. validação em produção do cenário Aptamil e de um cenário sem concorrentes relevantes.

Durante a validação, registrar contagens observadas e relevantes e os motivos agregados de exclusão,
sem registrar tokens ou respostas completas que contenham dados desnecessários.
