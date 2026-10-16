# Migração Cashbarber — Kingsman

Conferência em 02/10/2026. Destino: https://barber-system-yqu5.netlify.app/?shop=kingsman.

## Registros extraídos e destino

| Grupo | Extraídos | Incorporados às telas operacionais | Observação |
|---|---:|---:|---|
| Clientes | 2.285 | 2.285 | Mantido também o cadastro anterior do novo sistema |
| Profissionais | 18 | 18 | Histórico, sem login e sem cobrança por licença |
| Serviços | 42 | 42 | Um serviço inativo com duração inválida ficou inativo para revisão |
| Produtos | 49 | 49 | Status ativo/inativo preservado |
| Agendamentos | 25.735 | 25.734 | Um conflito real de horário preservado para revisão |
| Vínculos de serviços nos agendamentos | 33.378 | 33.377 | Um vínculo depende do agendamento em conflito |
| Histórico de procedimentos concluídos | — | 30.863 | Valor individual não informado na origem |
| Regras de disponibilidade | 60 | 60 | Regras por profissional |
| Bloqueios de agenda | 2.954 | Arquivo consultado pela agenda | Impedem novos agendamentos nos períodos bloqueados |
| Recebimentos | 24.136 | 23.905 | 231 registros inativos sem valor preservados no arquivo |
| Despesas | 9.395 | 9.389 | Seis registros não pagos preservados no arquivo |
| Comandas | 21.247 | Arquivo para consulta | Sem recriar pagamentos ou estoque |
| Planos | 31 | Arquivo para consulta | Regras futuras de utilização precisam de configuração |
| Contratos | 205 | Arquivo para consulta | 171 ativos na origem; nenhuma cobrança nova ativada |
| Recebíveis | 12.627 | Arquivo para consulta | Não gerar cobranças sem conferir os vínculos |
| Histórico de produtos por cliente | 874 | Arquivo para consulta | Origem sem preço unitário confiável e sem vínculo de comanda |
| Agregados mensais de vendas | 696 | Consulta histórica | Não somados novamente aos recebimentos |

## Valores conciliados

- Recebimentos confirmados importados: **R$ 1.614.285,17**.
- Despesas pagas importadas: **R$ 47.172,19**.
- Esses totais correspondem às exportações obtidas; não representam sincronização contínua com o Cashbarber.
- Há **223 recebimentos sem cliente identificado com segurança**. Receita, data e origem foram mantidas; clientes não foram associados por aproximação de nome.
- Os pagamentos antigos não fornecem vínculo confiável com todos os agendamentos. Por isso, ticket por atendimento pode aparecer como “Sem vínculo”.

## Mudanças publicadas

- Dashboard com receita recebida, planos ativos, ticket médio, ocupação e inadimplência; atalhos de WhatsApp preparam a conversa sem enviar mensagens.
- Ocupação respeita cancelamentos, folgas, intervalos e bloqueios extraídos.
- Margem de Lucro com visão do negócio, custos de produtos e serviços, impostos, taxas, comissões, materiais, extras, despesas de estrutura, markup e simulador de preço.
- Custos futuros registrados com valores preservados por venda. Compras de estoque não são deduzidas novamente como custo do item vendido.
- Histórico e tabelas com paginação; prontuários carregam somente os dados do cliente selecionado.
- Arquivo e relatório de revisão disponíveis em Configurações; contratos e planos antigos consultáveis em Assinaturas.

## Pendências reais

1. Conferir o agendamento conflitante, os 223 recebimentos sem cliente confirmado e o serviço inativo com duração inválida.
2. Informar impostos, comissões, materiais, custos de produtos e despesas de estrutura. A margem atual é uma **apuração parcial**, não o lucro real da barbearia.
3. Ativar a integração Mercado Pago na plataforma e conectar a conta da barbearia. Para substituir contratos antigos, conferir condições e obter novas autorizações; autorizações de cartão não foram migradas.
4. Convidar os profissionais que precisarão entrar no novo sistema. Os cadastros históricos não receberam convites automáticos.

## Verificação

- 43 testes automatizados aprovados e compilação de produção concluída.
- Conferência no banco dos status, totais, permissões por perfil, importação sem duplicação e quitação sem duplicação.
- Teste de bloqueio de agendamento nos horários preservados da origem.
- Conferência com o acesso master real das telas de dashboard, relatórios, assinaturas, custos e paginação do arquivo.
- Responsividade conferida em desktop e celular. Nenhuma mensagem enviada a clientes e nenhuma nova cobrança disparada.

## Melhorias propostas, aguardando escolha do usuário

- Estoque automático, ficha técnica e custo por porção no bar e cozinha.
- Abertura/fechamento de caixa por turno e conciliação dos pagamentos.
- Lembretes e recuperação de clientes pelo WhatsApp, com regras, consentimento e autorização de envio.
