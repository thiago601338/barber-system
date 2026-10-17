// Gravações de tela narradas, uma por função de cada solução (dados de clientes trocados na gravação).
export interface MarketingVideo {id:string;title:string;seconds:number;transcript:string}
export const marketingVideos:Record<string,MarketingVideo[]> = {
 "agenda": [
  {
   "id": "agenda-1",
   "title": "Cada barbeiro tem seu tempo",
   "seconds": 18,
   "transcript": "Cada barbeiro trabalha no seu ritmo. Em Serviços, escolha o procedimento e o profissional. Ajuste a duração e o tempo de preparo só para ele. A agenda passa a reservar exatamente esse tempo."
  },
  {
   "id": "agenda-2",
   "title": "Folga também entra na agenda",
   "seconds": 27,
   "transcript": "Os dias e horários de cada barbeiro ficam cadastrados aqui. Dá para adicionar um horário semanal, como o sábado de um profissional. Folgas e jornadas diferentes entram como exceção do dia. E um compromisso pessoal vira um bloqueio, que não aparece como vaga para o cliente."
  },
  {
   "id": "agenda-3",
   "title": "Vai precisar do mesmo equipamento?",
   "seconds": 24,
   "transcript": "Lavatório, cadeira especial, equipamento de química: tudo isso pode virar um recurso. Você informa o nome e quantas unidades a barbearia tem. Depois, liga o recurso ao serviço, e a agenda só oferece o horário quando ele está livre."
  },
  {
   "id": "agenda-4",
   "title": "Quem está esperando uma vaga?",
   "seconds": 17,
   "transcript": "O cliente queria um horário que já estava ocupado? Coloque ele na lista de espera, com o dia, o período e o barbeiro que prefere. Quando abrir uma vaga, você oferece, e a reserva só entra na agenda depois que ele aceitar."
  },
  {
   "id": "agenda-5",
   "title": "Precisou mudar o horário?",
   "seconds": 18,
   "transcript": "As regras de cancelamento e remarcação ficam no fim da página de serviços. Defina com quantas horas de antecedência o cliente pode cancelar ou remarcar. Se quiser, peça também a confirmação de presença. A área do cliente segue essas regras."
  },
  {
   "id": "agenda-6",
   "title": "O atendimento está no plano?",
   "seconds": 22,
   "transcript": "Num novo agendamento, escolha o cliente, o barbeiro e o serviço. Depois, o dia e uma das vagas livres. O sistema confere na hora se o serviço faz parte da assinatura e quantos usos ainda restam."
  }
 ],
 "club": [
  {
   "id": "assinaturas-1",
   "title": "O combinado fica registrado",
   "seconds": 18,
   "transcript": "Em Assinaturas, os planos mostram valor, ciclo, visitas e serviços incluídos. Quando o cliente assina, essas condições ficam salvas no contrato dele. Mesmo que você crie planos novos depois, o combinado com quem já assinou continua ali."
  },
  {
   "id": "assinaturas-2",
   "title": "Quantas visitas ainda tem?",
   "seconds": 18,
   "transcript": "Na aba Contratos, você vê cada assinante, o plano e o próximo ciclo. Abra um contrato para conferir o que ele contratou. O saldo de visitas acompanha os atendimentos feitos pelo plano, separados dos avulsos."
  },
  {
   "id": "assinaturas-3",
   "title": "Já pagou ou ainda está pendente?",
   "seconds": 17,
   "transcript": "O calendário mostra os próximos ciclos de cada assinatura. Ao lado, o status: ativo, aguardando ou em atraso. A renovação e os novos usos seguem a confirmação do pagamento."
  },
  {
   "id": "assinaturas-4",
   "title": "Saiba quem precisa de atenção",
   "seconds": 16,
   "transcript": "O valor em atraso aparece logo no painel. Na aba Inadimplentes, ficam os contratos com pagamento pendente. Com o plano e o ciclo em mãos, fica mais fácil conversar com o cliente."
  },
  {
   "id": "assinaturas-5",
   "title": "Seu clube está dando resultado?",
   "seconds": 16,
   "transcript": "A saúde dos planos começa pela receita recorrente do mês. Você acompanha quantos assinantes estão com o ciclo ativo e o que foi recebido. E vê os cancelamentos e a margem de contribuição do clube."
  },
  {
   "id": "assinaturas-6",
   "title": "Receba na conta da barbearia",
   "seconds": 15,
   "transcript": "O dinheiro das assinaturas vai para a conta da barbearia. Em Configurações, conecte a sua conta do Mercado Pago. Esses recebimentos ficam separados da mensalidade que você paga pelo sistema."
  }
 ],
 "solo": [
  {
   "id": "autonomo-1",
   "title": "Você no controle do seu negócio",
   "seconds": 17,
   "transcript": "Quem trabalha por conta própria entra como administrador. Agenda, clientes, serviços e financeiro ficam todos liberados. E as configurações da barbearia também são suas."
  },
  {
   "id": "autonomo-2",
   "title": "Sua rotina cabe na agenda",
   "seconds": 17,
   "transcript": "Sua agenda mostra os atendimentos do dia. Precisa sair mais cedo? Bloqueie o período em Serviços. Aquele horário deixa de aparecer como vaga para o cliente."
  },
  {
   "id": "autonomo-3",
   "title": "Lembre como seu cliente gosta",
   "seconds": 14,
   "transcript": "Em Clientes, cada pessoa tem o seu prontuário. Abra para ver o histórico de atendimentos. E anote as preferências para consultar na próxima visita."
  },
  {
   "id": "autonomo-4",
   "title": "O dia rendeu. E o dinheiro?",
   "seconds": 15,
   "transcript": "Em Barbeiros, você vê o faturamento do mês. Clique no profissional para abrir os rendimentos. Faturamento, comissão, custos e o que sobra, mês a mês, em gráfico."
  },
  {
   "id": "autonomo-5",
   "title": "Dê atenção a quem já atende com você",
   "seconds": 18,
   "transcript": "Em CRM e retorno, aparecem os clientes que merecem um contato. Quem está sem visita há um tempo e quem faz aniversário. Em Fidelidade e indicação, você monta a política de pontos e benefícios."
  },
  {
   "id": "autonomo-6",
   "title": "Seu trabalho merece ser encontrado",
   "seconds": 13,
   "transcript": "A Mini bio já vem pronta com a sua marca. O link leva para a página com seus serviços e o agendamento. É só compartilhar com seus clientes."
  }
 ],
 "client": [
  {
   "id": "cliente-1",
   "title": "O próximo atendimento à mão",
   "seconds": 15,
   "transcript": "Esta é a área do seu cliente, com a cara da barbearia. Na Agenda, ele vê os próximos horários marcados. E pode confirmar, remarcar ou cancelar, dentro dos prazos que você definiu."
  },
  {
   "id": "cliente-2",
   "title": "Quando veio e quanto gastou",
   "seconds": 16,
   "transcript": "Logo na entrada, o cliente vê quantas visitas fez e quanto já pagou. Mais abaixo, os atendimentos anteriores. Cada pessoa acessa só as informações da própria conta."
  },
  {
   "id": "cliente-3",
   "title": "O que ainda pode usar no plano",
   "seconds": 16,
   "transcript": "Quem é assinante vê quantos usos ainda tem. Na aba Assinatura, ficam o plano, o ciclo e as condições contratadas. Se faltar confirmar um pagamento, isso aparece indicado."
  },
  {
   "id": "cliente-4",
   "title": "Hora de marcar de novo",
   "seconds": 19,
   "transcript": "Quer voltar? É só tocar em agendar procedimento. O cliente escolhe o serviço e o barbeiro. E a agenda mostra as vagas livres para o novo horário."
  },
  {
   "id": "cliente-5",
   "title": "Os produtos da barbearia por perto",
   "seconds": 17,
   "transcript": "Pela página da barbearia, o cliente também chega aos produtos. Pomadas, shampoos, óleos, com foto e preço. A compra e a retirada seguem o que a barbearia oferece."
  },
  {
   "id": "cliente-6",
   "title": "Um atalho na tela do celular",
   "seconds": 16,
   "transcript": "No topo da área do cliente, aparece o convite para a tela inicial. Com um toque, ele adiciona a barbearia ao celular, como um aplicativo. Sem baixar nada na loja de aplicativos."
  }
 ],
 "finance": [
  {
   "id": "financeiro-1",
   "title": "O que entrou e o que ainda vem",
   "seconds": 17,
   "transcript": "No painel, o dinheiro aparece separado em três partes. O que já foi recebido, e o que foi vendido ou realizado. E o que ainda está previsto na agenda. Cada número abre os registros de onde veio."
  },
  {
   "id": "financeiro-2",
   "title": "Feche o caixa com os registros na mão",
   "seconds": 21,
   "transcript": "Em Financeiro, a aba Caixa e comandas organiza o dia. Abra o caixa com o valor que está na gaveta. Durante o dia, entram comandas e pagamentos em dinheiro, Pix ou cartão, prontos para conferir no fechamento."
  },
  {
   "id": "financeiro-3",
   "title": "Aluguel, energia, material…",
   "seconds": 20,
   "transcript": "As despesas da barbearia ficam no Financeiro. Clique em registrar despesa e descreva o gasto. Escolha o tipo e o valor. Assim você sabe quanto custa manter as portas abertas."
  },
  {
   "id": "financeiro-4",
   "title": "Quanto sobra em cada venda?",
   "seconds": 22,
   "transcript": "Em Margem de Lucro, veja o resultado de cada produto e serviço. Receita, custo total, contribuição e margem, item por item. E use o simulador para testar um preço antes de mudar no catálogo."
  },
  {
   "id": "financeiro-5",
   "title": "O produto entrou, saiu ou foi usado?",
   "seconds": 18,
   "transcript": "Em Produtos, cada item mostra preço e estoque. Abra um produto para ver preço, custo, estoque atual e o mínimo para repor. Compras, vendas, consumo e ajustes ficam registrados no histórico de estoque."
  },
  {
   "id": "financeiro-6",
   "title": "Comissão sem depender da memória",
   "seconds": 19,
   "transcript": "As comissões ficam em Financeiro, na aba da equipe. Defina a regra de cada profissional para serviços e produtos. O extrato mostra o que está disponível, o que aguarda recebimento e o que precisa de revisão."
  }
 ],
 "minibio": [
  {
   "id": "minibio-1",
   "title": "Tem que ter a sua cara",
   "seconds": 19,
   "transcript": "Em Identidade visual, você parte do Instagram da barbearia. Descreva o ambiente, e a IA sugere cores, tipografia e o estilo da página. A identidade aparece na MiniBio, na área do cliente e na da equipe."
  },
  {
   "id": "minibio-2",
   "title": "Mostre quem atende e o que faz",
   "seconds": 17,
   "transcript": "Esta é a página pública da barbearia. Os serviços aparecem com tempo e preço, do jeito que estão cadastrados. E na hora de agendar, o cliente vê a equipe e escolhe com quem quer cortar."
  },
  {
   "id": "minibio-3",
   "title": "Do serviço escolhido ao horário marcado",
   "seconds": 19,
   "transcript": "O cliente toca em agendar procedimento. Escolhe o serviço, o barbeiro e o dia. Vê só as vagas que cabem na agenda, com as regras de cancelamento já à vista."
  },
  {
   "id": "minibio-4",
   "title": "Tem plano? Vende produtos?",
   "seconds": 13,
   "transcript": "Na mesma página, aparecem os produtos da barbearia. Com foto, preço e disponibilidade. E os planos de assinatura, para o cliente assinar direto por ali."
  },
  {
   "id": "minibio-5",
   "title": "Ficou com dúvida? Tem como falar com você",
   "seconds": 21,
   "transcript": "Em Configurações, informe o telefone, o WhatsApp e o Instagram da barbearia. Esses contatos vão para a página pública. Assim, o cliente encontra o Instagram e o endereço de onde a barbearia fica."
  },
  {
   "id": "minibio-6",
   "title": "Um endereço só seu para compartilhar",
   "seconds": 19,
   "transcript": "Na Mini bio fica o endereço da sua página. É sistemadebarbearia ponto com ponto br, barra b, barra o nome da barbearia. Dá para adicionar links extras e colocar tudo na bio do Instagram."
  }
 ],
 "whatsapp": [
  {
   "id": "whatsapp-1",
   "title": "Conecte o WhatsApp da barbearia",
   "seconds": 23,
   "transcript": "Na aba WhatsApp com IA, a barbearia conecta o próprio número. Dá para usar o número que você já tem no WhatsApp Business e continuar respondendo pelo celular. Ou conectar um número novo, só para o atendimento. A conexão é pela API oficial da Meta, e a IA só responde quando o cliente escreve primeiro."
  },
  {
   "id": "whatsapp-2",
   "title": "Preços e serviços na hora",
   "seconds": 25,
   "transcript": "Antes de ligar, você pode testar a IA aqui mesmo. Ela já conhece os serviços e os preços da barbearia. E responde as dúvidas do dia a dia, do jeito que você configurou."
  },
  {
   "id": "whatsapp-3",
   "title": "Agenda direto pela conversa",
   "seconds": 15,
   "transcript": "Todas as conversas ficam reunidas no painel. Aqui, o cliente pediu um horário para amanhã à tarde. A IA consultou a agenda, ofereceu as vagas livres e já deixou a reserva feita."
  },
  {
   "id": "whatsapp-4",
   "title": "Do seu jeito de atender",
   "seconds": 14,
   "transcript": "Em Como a IA atende, você escreve as regras da casa. Tom de voz, formas de pagamento, atraso, estacionamento. E liga ou desliga o atendimento automático quando quiser."
  },
  {
   "id": "whatsapp-5",
   "title": "A equipe assume quando precisar",
   "seconds": 17,
   "transcript": "Quer responder você mesmo? Abra a conversa. Clique em assumir conversa e escreva. A IA pausa naquele atendimento. Quando terminar, devolva para a IA continuar."
  },
  {
   "id": "whatsapp-6",
   "title": "Modelos de mensagem",
   "seconds": 18,
   "transcript": "Em Modelos de mensagem ficam os textos aprovados pela Meta. Como a confirmação de horário e o lembrete. Para criar um novo, dê um nome, escreva o texto e envie para aprovação."
  }
 ]
}
