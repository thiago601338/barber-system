import { moduleLabels, type ModuleKey, type Role } from './types'

export type TourModule = ModuleKey | 'master' | 'client'

export interface TourStep {
  id?: string
  audioText?: string
  module: TourModule
  kind: 'nav' | 'content'
  selector: string
  revealSelector?: string
  title: string
  description: string
  practice?: {
    instruction: string
    completeOn?: 'click' | 'input' | 'focus' | 'valid_form' | 'quiz'
    openedSelector?: string
    quiz?: { question: string; choices: string[]; correct: number; explanation: string }
  }
}

export interface TourChapter {
  id: string
  module: TourModule
  title: string
  summary: string
  group: string
  steps: TourStep[]
}

interface ChapterCopy {
  module: ModuleKey
  title: string
  summary: string
  group: string
  focus: string
  focusSelector: string
  action: string
  actionSelector: string
  actionOpenedSelector?: string
}

const adminChapters: ChapterCopy[] = [
  { module: 'dashboard', title: 'Comece pela visão geral', summary: 'Leia os principais números e encontre o próximo atendimento.', group: 'GESTÃO', focus: 'Veja o panorama do dia. Os cartões e a agenda usam os registros da sua barbearia.', focusSelector: '.content .stats-grid', action: 'Use os indicadores para decidir qual área abrir. Confira a origem dos números antes de agir.', actionSelector: '.content .dashboard-grid' },
  { module: 'reports', title: 'Entenda faturamento e retorno', summary: 'Ajuste o período e investigue ticket, novos clientes e retenção.', group: 'GESTÃO', focus: 'Escolha uma faixa rápida ou informe as datas. O período escolhido muda a leitura de faturamento e ticket.', focusSelector: '.content .report-quick-ranges', action: 'Alterne entre “Faturamento e ticket” e “Clientes e retorno” para comparar receita, primeira visita e retorno por profissional.', actionSelector: '.content .report-section-tabs' },
  { module: 'appointments', title: 'Organize a agenda', summary: 'Veja horários e inicie um agendamento com dados completos.', group: 'GESTÃO', focus: 'Navegue entre os dias e confira os horários livres de cada profissional.', focusSelector: '.content .calendar-toolbar', action: 'Abra “Novo agendamento” e veja os campos de cliente, barbeiro, serviço, assinatura e horário disponível. Nada é salvo sem confirmar.', actionSelector: '[data-tour-action="appointment-create"]', actionOpenedSelector: '[data-tour-form="appointment-create"]' },
  { module: 'clients', title: 'Cuide dos clientes', summary: 'Cadastre clientes e mantenha o histórico de atendimentos.', group: 'GESTÃO', focus: 'Nesta área você encontra os contatos e o histórico dos clientes da barbearia.', focusSelector: '.content .panel', action: 'Abra “Novo cliente” e confira nome, telefone, e-mail, barbeiro responsável e observações antes de salvar.', actionSelector: '[data-tour-action="client-create"]', actionOpenedSelector: '[data-tour-form="client-create"]' },
  { module: 'services', title: 'Configure serviços e horários', summary: 'Defina procedimentos, valores e disponibilidade da equipe.', group: 'GESTÃO', focus: 'Cadastre duração e preço de cada serviço; eles aparecem no agendamento público.', focusSelector: '.content .panel', action: 'Abra “Adicionar horário” e configure o profissional, dia da semana, início e fim. Esses horários alimentam a agenda pública.', actionSelector: '[data-tour-action="availability-create"]', actionOpenedSelector: '[data-tour-form="availability-create"]' },
  { module: 'subscriptions', title: 'Monte as assinaturas', summary: 'Crie planos e acompanhe contratos e recebíveis.', group: 'OPERAÇÃO', focus: 'Use estas abas para separar contratos, planos, recebíveis e inadimplentes.', focusSelector: '.content .segmented', action: 'Abra “Novo plano” e confira preço, ciclo, visitas e serviços incluídos. A cobrança real só avança depois da confirmação do provedor.', actionSelector: '[data-tour-action="subscription-create-plan"]', actionOpenedSelector: '[data-tour-form="subscription-create-plan"]' },
  { module: 'products', title: 'Cadastre produtos', summary: 'Mantenha preços, custos e estoque atualizados.', group: 'OPERAÇÃO', focus: 'O catálogo separa itens de barbearia, bar e cozinha.', focusSelector: '.content .segmented', action: 'Abra “Novo produto” e veja onde cadastrar foto, categoria, preço, custo e quantidade em estoque.', actionSelector: '[data-tour-action="product-create"]', actionOpenedSelector: '[data-tour-form="product-create"]' },
  { module: 'bar', title: 'Controle bar e cozinha', summary: 'Registre comandas e acompanhe a entrega.', group: 'OPERAÇÃO', focus: 'Acompanhe as comandas abertas e os itens consumidos.', focusSelector: '.content .order-grid, .content .page-stack > .panel', action: 'Abra “Nova comanda” e selecione cliente, produto e quantidade. Só confirme depois que o pedido estiver correto.', actionSelector: '[data-tour-action="bar-order-create"]', actionOpenedSelector: '[data-tour-form="bar-order-create"]' },
  { module: 'finance', title: 'Conheça os custos', summary: 'Registre despesas e analise a margem desejada.', group: 'RESULTADOS', focus: 'Informe o custo da estrutura e a meta de lucro para entender a margem da barbearia.', focusSelector: '.content .panel', action: 'Abra “Registrar despesa” e confira descrição, categoria, valor, data e recorrência antes de salvar.', actionSelector: '[data-tour-action="expense-create"]', actionOpenedSelector: '[data-tour-form="expense-create"]' },
  { module: 'goals', title: 'Defina metas', summary: 'Acompanhe objetivos da loja e da equipe.', group: 'RESULTADOS', focus: 'Veja o andamento das metas da barbearia e dos profissionais.', focusSelector: '.content .goal-grid, .content .page-stack > .panel', action: 'Abra “Nova meta” e defina indicador, valor alvo, período e destinatário antes de criar.', actionSelector: '[data-tour-action="goal-create"]', actionOpenedSelector: '[data-tour-form="goal-create"]' },
  { module: 'partners', title: 'Monte o Clube do Parceiro', summary: 'Cadastre parceiros e crie ofertas com regras próprias.', group: 'CRESCIMENTO', focus: 'Acompanhe parceiros ativos, ofertas e reservas atribuídas ao programa.', focusSelector: '.content .partner-club-stats', action: 'Abra “Novo parceiro” para cadastrar perfil, contato, Instagram e logo. Depois use “Nova oferta” para criar cupom e link de indicação.', actionSelector: '[data-tour-action="partner-create"]', actionOpenedSelector: '[data-tour-form="partner-create"]' },
  { module: 'marketing', title: 'Planeje o marketing', summary: 'Siga as tarefas orgânicas e o roteiro de anúncios.', group: 'CRESCIMENTO', focus: 'Leia as etapas de conteúdo orgânico e campanhas pagas antes de criar uma ação.', focusSelector: '.content .page-stack > .panel:first-of-type', action: 'Abra “Nova tarefa” e registre uma ação com canal e prazo para a equipe acompanhar.', actionSelector: '[data-tour-action="marketing-task-create"]', actionOpenedSelector: '[data-tour-form="marketing-task-create"]' },
  { module: 'ai', title: 'Converse com a IA sobre a barbearia', summary: 'Tire dúvidas, peça orientações ou prepare um cadastro.', group: 'CRESCIMENTO', focus: 'Escreva sua pergunta ou pedido com linguagem natural. A IA considera o contexto disponível desta barbearia.', focusSelector: '.content .ai-help-input textarea', action: 'Respostas não alteram registros. Se houver uma ação disponível, revise a proposta e confirme apenas quando os campos estiverem corretos.', actionSelector: '.content .ai-help-thread' },
  { module: 'bio', title: 'Monte a mini bio', summary: 'Reúna agendamento, produtos, assinatura e contato.', group: 'CRESCIMENTO', focus: 'O endereço público da barbearia aparece aqui. Teste os links antes de compartilhar.', focusSelector: '.content .public-url', action: 'Abra “Adicionar link” e cadastre texto, endereço, tipo e posição do botão público.', actionSelector: '[data-tour-action="bio-link-create"]', actionOpenedSelector: '[data-tour-form="bio-link-create"]' },
  { module: 'branding', title: 'Crie a identidade da loja', summary: 'Analise o Instagram, revise a prévia e publique.', group: 'SISTEMA', focus: 'Cadastre o link oficial do Instagram. A análise propõe cores, tipografia e tom para esta barbearia.', focusSelector: '.content .brand-studio-grid .panel:first-child', action: 'Revise a prévia e publique somente quando a aparência estiver fiel à empresa.', actionSelector: '.content .brand-review-grid .panel:nth-child(2)' },
  { module: 'settings', title: 'Ajuste equipe e permissões', summary: 'Convide pessoas e libere as abas individualmente.', group: 'SISTEMA', focus: 'Revise os dados, integrações e permissões da barbearia nesta tela.', focusSelector: '.content .dashboard-grid', action: 'Abra “Convidar pessoa” e confira e-mail, nome exibido e perfil. Depois ajuste as abas permitidas por barbeiro.', actionSelector: '[data-tour-action="team-invite"]', actionOpenedSelector: '[data-tour-form="team-invite"]' },
]

const barberChapters: ChapterCopy[] = [
  { module: 'dashboard', title: 'Veja seu dia', summary: 'Consulte seus atendimentos e números pessoais.', group: 'SEU TRABALHO', focus: 'Confira os atendimentos do dia antes de começar.', focusSelector: '.content .dashboard-grid', action: 'Use os cartões para acompanhar seus números conforme as permissões liberadas pela barbearia.', actionSelector: '.content .stats-grid' },
  { module: 'reports', title: 'Entenda seus resultados', summary: 'Acompanhe ticket, faturamento e retorno dos seus clientes.', group: 'SEU TRABALHO', focus: 'Escolha o período que deseja comparar.', focusSelector: '.content .report-quick-ranges', action: 'Alterne entre faturamento e clientes para ver os indicadores disponíveis para você.', actionSelector: '.content .report-section-tabs' },
  { module: 'appointments', title: 'Consulte sua agenda', summary: 'Veja horários e atendimentos atribuídos a você.', group: 'SEU TRABALHO', focus: 'Navegue pelos dias e confira os atendimentos agendados.', focusSelector: '.content .calendar-toolbar', action: 'Abra um atendimento para ver os detalhes. Atualize o estado somente após realizar o procedimento.', actionSelector: '.content .calendar-shell' },
  { module: 'clients', title: 'Conheça seus clientes', summary: 'Consulte o histórico dos clientes vinculados a você.', group: 'SEU TRABALHO', focus: 'Nesta lista aparecem apenas os clientes aos quais você tem acesso.', focusSelector: '.content .panel', action: 'Abra um cadastro antes do atendimento para revisar preferências e histórico.', actionSelector: '.content .table-scroll' },
  { module: 'services', title: 'Revise procedimentos', summary: 'Confira duração e preços publicados.', group: 'SEU TRABALHO', focus: 'Consulte os serviços para orientar o cliente com o preço e o tempo corretos.', focusSelector: '.content .panel', action: 'Veja também seus horários de atendimento definidos pela barbearia.', actionSelector: '.content .panel:nth-of-type(2)' },
  { module: 'subscriptions', title: 'Confira a assinatura', summary: 'Veja se o plano cobre o serviço e os usos restantes.', group: 'ATENDIMENTO', focus: 'Abra o contrato do cliente e confira o status da assinatura.', focusSelector: '.content .segmented', action: 'Antes de agendar, confirme os serviços cobertos e quantas visitas restam no ciclo.', actionSelector: '.content .panel' },
  { module: 'products', title: 'Conheça o estoque', summary: 'Consulte disponibilidade antes de oferecer um item.', group: 'ATENDIMENTO', focus: 'Filtre os produtos por categoria para encontrar o item.', focusSelector: '.content .segmented', action: 'Confira preço e estoque no catálogo antes de orientar o cliente.', actionSelector: '.content .panel' },
  { module: 'bar', title: 'Acompanhe comandas', summary: 'Registre consumo e conclusão de pedidos.', group: 'ATENDIMENTO', focus: 'Veja as comandas abertas da barbearia.', focusSelector: '.content .order-grid, .content .page-stack > .panel', action: 'Abra “Nova comanda” somente quando seu acesso permitir registrar consumo. Confira cliente, produto e quantidade antes de confirmar.', actionSelector: '[data-tour-action="bar-order-create"]', actionOpenedSelector: '[data-tour-form="bar-order-create"]' },
  { module: 'goals', title: 'Acompanhe suas metas', summary: 'Defina um objetivo pessoal e veja as metas recebidas.', group: 'EVOLUÇÃO', focus: 'Consulte o andamento da sua meta pessoal e das metas atribuídas pelo administrador.', focusSelector: '.content .goal-grid, .content .page-stack > .panel', action: 'Abra “Nova meta” para praticar o cadastro de uma meta pessoal quando essa permissão estiver liberada.', actionSelector: '[data-tour-action="goal-create"]', actionOpenedSelector: '[data-tour-form="goal-create"]' },
  { module: 'partners', title: 'Conheça o Clube do Parceiro', summary: 'Veja os benefícios e links de indicação.', group: 'EVOLUÇÃO', focus: 'Veja as ofertas ativas na barbearia.', focusSelector: '.content .partner-club-stats', action: 'Abra “Ofertas e cupons” para encontrar regras e copiar o link correto.', actionSelector: '.content .partner-club-tabs' },
  { module: 'marketing', title: 'Siga o plano de marketing', summary: 'Veja tarefas orgânicas e orientações de anúncios.', group: 'EVOLUÇÃO', focus: 'Siga a sequência de ações orgânicas da barbearia.', focusSelector: '.content .page-stack > .panel:first-of-type', action: 'Use o roteiro de anúncios como referência e alinhe a publicação com a administração.', actionSelector: '.content .page-stack > .panel:first-of-type .segmented' },
  { module: 'ai', title: 'Converse com a IA sobre seu trabalho', summary: 'Tire dúvidas e prepare ações dentro dos seus acessos.', group: 'EVOLUÇÃO', focus: 'Pergunte sobre seus horários e atividades ou peça ajuda para planejar uma meta pessoal.', focusSelector: '.content .ai-help-input textarea', action: 'A IA responde com os dados que seu perfil pode ver. Um cadastro só é gravado quando você revisa e confirma a proposta.', actionSelector: '.content .ai-help-thread' },
  { module: 'bio', title: 'Compartilhe o link correto', summary: 'Encontre a página pública de agendamento.', group: 'EVOLUÇÃO', focus: 'Copie o endereço público da barbearia para orientar seus clientes.', focusSelector: '.content .public-url', action: 'Confira se o botão de agendamento leva à página certa.', actionSelector: '.content .phone-frame' },
  { module: 'settings', title: 'Entenda seus acessos', summary: 'Confira o que a administração liberou para você.', group: 'SISTEMA', focus: 'O menu lateral mostra as abas liberadas para você. No celular, abra o menu pelo botão no topo.', focusSelector: '.content .page-header', action: 'Se precisar de outra aba, peça ao administrador da sua barbearia.', actionSelector: '.content .dashboard-grid' },
]

function chapterFromCopy(copy: ChapterCopy): TourChapter {
  const moduleLabel = moduleLabels[copy.module]
  const focusIsText = copy.focusSelector.includes('textarea') || copy.focusSelector.includes('input')
  const actionIsText = copy.actionSelector.includes('textarea') || copy.actionSelector.includes('input')
  return {
    id: copy.module,
    module: copy.module,
    title: copy.title,
    summary: copy.summary,
    group: copy.group,
    steps: [
      { module: copy.module, kind: 'nav', selector: `[data-tour-nav="${copy.module}"]`, title: `Abra ${moduleLabel}`, description: `${copy.summary} Clique na aba destacada para abrir a tela.`, practice: { instruction: `Clique na aba ${moduleLabel} para continuar.`, completeOn: 'click' } },
      { module: copy.module, kind: 'content', selector: copy.focusSelector, title: 'Onde começar', description: copy.focus, practice: { instruction: focusIsText ? 'Clique no campo destacado e digite um teste curto para praticar.' : 'Clique ou toque na área destacada para reconhecer onde essa informação fica.', completeOn: focusIsText ? 'input' : 'click' } },
      { module: copy.module, kind: 'content', selector: copy.actionSelector, title: 'Teste rápido', description: copy.action, practice: { instruction: copy.actionOpenedSelector ? 'Clique no botão destacado e confira o formulário aberto. Nada é salvo sem você confirmar.' : actionIsText ? 'Digite um teste curto no campo destacado. Nada é enviado sem você confirmar.' : 'Faça um teste na área destacada. Pode abrir, clicar ou focar no recurso; nada é salvo sem confirmação.', completeOn: actionIsText ? 'input' : 'click', openedSelector: copy.actionOpenedSelector } },
    ],
  }
}

const masterChapter: TourChapter = {
  id: 'master', module: 'master', title: 'Administre a plataforma', group: 'PLATAFORMA',
  summary: 'Crie barbearias, ajuste o valor por barbeiro e acompanhe a cobrança.',
  steps: [
    { module: 'master', kind: 'nav', selector: '[data-tour-nav="master"]', title: 'Abra o Painel master', description: 'Este acesso reúne todas as barbearias cadastradas na plataforma.', practice: { instruction: 'Clique em Painel master para confirmar que você sabe voltar para a visão da plataforma.', completeOn: 'click' } },
    { module: 'master', kind: 'content', selector: '[data-tour-action="master-seat-price"]', revealSelector: '[data-tour-master-view="settings"]', title: 'Defina o valor por barbeiro', description: 'Configure aqui a mensalidade central por profissional ativo. Confira o valor antes de habilitar a cobrança.', practice: { instruction: 'Clique neste bloco e identifique onde fica o valor por barbeiro.', completeOn: 'click' } },
    { module: 'master', kind: 'content', selector: '[data-tour-action="master-invite-admin"]', revealSelector: '[data-tour-master-view="shops"]', title: 'Convide o administrador', description: 'Vincule o administrador à barbearia certa e confira o acesso antes de entregar a conta.', practice: { instruction: 'Clique no botão destacado para abrir o convite do administrador. Nada é enviado sem confirmar.', completeOn: 'click', openedSelector: '[data-tour-form="master-invite-admin"]' } },
    { module: 'master', kind: 'content', selector: '[data-tour-action="master-create-shop"]', title: 'Crie uma barbearia', description: 'Cadastre uma empresa com nome e endereço público. Depois selecione a loja para configurar a operação.', practice: { instruction: 'Clique em “Nova barbearia” para abrir o cadastro correto. Nada é salvo sem confirmar.', completeOn: 'click', openedSelector: '[data-tour-form="master-create-shop"]' } },
  ],
}

const masterAiChapter: ChapterCopy = {
  module: 'ai', title: 'Converse com a IA da plataforma',
  summary: 'Pergunte sobre a operação da plataforma ou prepare o cadastro de uma barbearia.',
  group: 'PLATAFORMA',
  focus: 'Sem uma loja selecionada, descreva uma dúvida sobre a plataforma ou peça para preparar uma nova barbearia.',
  focusSelector: '.content .ai-help-input textarea',
  action: 'A conversa não muda dados. Para criar uma barbearia, confira a prévia e confirme a ação.',
  actionSelector: '.content .ai-help-thread',
}

const clientChapter: TourChapter = {
  id: 'client', module: 'client', title: 'Conheça sua área', group: 'SUA CONTA',
  summary: 'Encontre horários, visitas, assinatura e agendamento.',
  steps: [
    { module: 'client', kind: 'content', selector: '[data-tour-client="summary"]', title: 'Sua área pessoal', description: 'Aqui aparecem seus horários e benefícios nesta barbearia.', practice: { instruction: 'Toque neste resumo para identificar onde começa sua área.', completeOn: 'click' } },
    { module: 'client', kind: 'content', selector: '[data-tour-client="stats"]', title: 'Seu resumo', description: 'Confira visitas concluídas, valor pago e quantos usos ainda restam no plano, quando houver assinatura ativa.', practice: { instruction: 'Toque nos números e confira quais indicadores aparecem para você.', completeOn: 'click' } },
    { module: 'client', kind: 'content', selector: '[data-tour-client="upcoming"]', title: 'Próximos horários', description: 'Veja os agendamentos confirmados e a data de cada atendimento.', practice: { instruction: 'Toque nesta área para localizar seus próximos horários.', completeOn: 'click' } },
    { module: 'client', kind: 'content', selector: '[data-tour-client="plan"]', title: 'Sua assinatura', description: 'Confira o plano, o ciclo atual e as visitas disponíveis antes de agendar.', practice: { instruction: 'Toque no plano para reconhecer onde ficam os usos restantes.', completeOn: 'click' } },
    { module: 'client', kind: 'content', selector: '[data-tour-client="history"]', title: 'Histórico de visitas', description: 'Revise os dias em que você foi atendido, os valores e os procedimentos registrados.', practice: { instruction: 'Toque no histórico e veja onde consultar visitas anteriores.', completeOn: 'click' } },
    { module: 'client', kind: 'content', selector: '[data-tour-client="book"]', title: 'Faça seu próximo agendamento', description: 'Abra o agendamento, escolha procedimento, barbeiro e um horário disponível. Confira o valor antes de concluir.', practice: { instruction: 'Toque no agendamento para praticar onde iniciar uma nova reserva.', completeOn: 'click' } },
  ],
}

export function getTourChapters(role: Role, allowedModules: ModuleKey[], hasShop: boolean): TourChapter[] {
  if (role === 'client') return enrichChapters([clientChapter], role)
  if (role === 'master' && !hasShop) {
    return enrichChapters([masterChapter, ...(allowedModules.includes('ai') ? [chapterFromCopy(masterAiChapter)] : [])], role)
  }
  const list = role === 'barber' ? barberChapters : adminChapters
  const chapters = list.filter(copy => allowedModules.includes(copy.module as ModuleKey)).map(chapterFromCopy)
  // The platform tour has its own context. Opening it from a shop removes
  // the shop menu, so a combined tour cannot continue to the shop modules.
  return enrichChapters(chapters, role)
}

const exerciseCopies: Partial<Record<TourModule,string>> = {
 clients: 'Use um nome fictício, como Cliente de treino. Preencha os contatos e escolha o responsável. Não use dados pessoais para praticar.',
 appointments: 'Escolha cliente, profissional, procedimentos e uma vaga disponível. Confira duração, cobertura do plano e o valor antes de validar.',
 services: 'Escolha profissional, dia e horários de início e fim. O fim precisa ser posterior ao início. Confira os intervalos da equipe.',
 subscriptions: 'Informe nome do plano, preço, frequência, limite de visitas e procedimentos incluídos. As condições serão preservadas no contrato quando houver uma contratação real.',
 products: 'Informe nome, categoria, preço e custo. Confira a quantidade inicial e o estoque mínimo. O teste não envia imagens nem altera o estoque.',
 bar: 'Escolha o cliente e adicione itens à comanda. Confira as quantidades e o total. No treino nenhum consumo é lançado.',
 finance: 'Informe descrição, categoria, data e valor da despesa. Confira se ela já foi paga e evite duplicar custos.',
 goals: 'Escolha indicador, destinatário, período e valor alvo. Uma meta da barbearia é diferente de uma meta pessoal.',
 partners: 'Pratique com o nome Parceiro de treino. Confira os campos de contato e perfil. Cupons e condições serão cadastrados separadamente na operação real.',
 marketing: 'Escreva uma ação concreta, escolha o canal e informe um prazo para acompanhar a execução.',
 bio: 'Informe um texto para o botão e um endereço completo com HTTPS. Confira tipo e posição antes de validar.',
 settings: 'Pratique o convite com um endereço fictício, por exemplo treino@example.com, e escolha o perfil correto. Nenhum convite será enviado.',
 master: 'Use dados fictícios e confira a empresa ou destinatário escolhido. Nenhuma barbearia, acesso ou cobrança é criado no modo de treino.',
}
const spokenModule:Partial<Record<TourModule,string>>={master:'Painel master',client:'Sua área'}
// Narração: o nome da etapa só é dito no primeiro passo; os demais dizem o número do passo e a tela, sem repetir.
function spokenTitle(step:TourStep,label:string):string{
 if(step.title==='Onde começar')return `Onde começar na tela ${label}`
 if(step.title==='Teste rápido')return `Teste rápido na tela ${label}`
 if(step.title==='Confira o que você aprendeu')return `Confira o que você aprendeu sobre ${label}`
 return step.title
}
function narration(chapter:TourChapter,step:TourStep,index:number,total:number):string{
 const label=spokenModule[step.module]||moduleLabels[step.module as ModuleKey]||chapter.title
 const intro=index===0?`${chapter.title}. `:''
 const practice=step.practice?` Para praticar: ${step.practice.instruction}`:''
 const quiz=step.practice?.quiz?` Pergunta: ${step.practice.quiz.question} ${step.practice.quiz.choices.map((choice,i)=>`Opção ${i+1}: ${choice}.`).join(' ')}`:''
 return `${intro}Passo ${index+1} de ${total}. ${spokenTitle(step,label)}. ${step.description}${practice}${quiz}`
}
function enrichChapters(chapters:TourChapter[],role:Role):TourChapter[]{
 return chapters.map(chapter=>{
  const steps:TourStep[]=[]
  for(const step of chapter.steps){
   steps.push(step)
   const form=step.practice?.openedSelector
   if(form)steps.push({module:step.module,kind:'content',selector:form,title:'Preencha e valide o cadastro de treino',description:exerciseCopies[step.module]||'Preencha os campos obrigatórios e confira os dados antes de confirmar.',practice:{instruction:'Altere pelo menos um campo e clique em Validar treino. O sistema confere os campos e mostra o resultado sem gravar registros reais. Depois feche o cadastro para seguir.',completeOn:'valid_form',openedSelector:form}})
  }
  if(!steps.some(s=>s.practice?.completeOn==='valid_form'))steps.push({module:chapter.module,kind:'content',selector:chapter.steps[chapter.steps.length-1].selector,title:'Confira o que você aprendeu',description:'Responda o teste para confirmar que você entendeu a finalidade desta área.',practice:{instruction:'Escolha a resposta correta no guia para concluir este exercício.',completeOn:'quiz',quiz:quizFor(chapter.module)}})
  return {...chapter,steps:steps.map((step,index)=>({...step,id:`${role}:${chapter.id}:${index}`,audioText:narration(chapter,step,index,steps.length)}))}
 })
}
function quizFor(module:TourModule):NonNullable<NonNullable<TourStep['practice']>['quiz']>{
 const quizzes:Partial<Record<TourModule,[string,string[],number,string]>>={
  dashboard:['Qual valor já entrou no caixa?',['Reservas futuras','Receita recebida com pagamento confirmado','Preço total de todos os planos'],1,'Recebimentos confirmados são diferentes do que foi vendido e do que está previsto.'],
  reports:['Como comparar resultados com precisão?',['Usar períodos equivalentes e conferir a origem','Somar todas as visitas a mensalidades','Comparar qualquer intervalo sem verificar datas'],0,'Os filtros e a origem dos dados determinam a leitura correta do relatório.'],
  subscriptions:['Posso tratar todo contrato importado como cobertura confirmada?',['Sim, basta o nome do plano','Não. É preciso conferir condições, ciclo e pagamento','Sim, se o serviço custa zero'],1,'Benefícios dependem de condições comprovadas e saldo elegível no ciclo.'],
  ai:['Quando uma proposta da IA altera o sistema?',['Quando ela responde','Após revisão e confirmação da ação permitida','Ao abrir a conversa'],1,'A IA prepara a proposta; a gravação depende da confirmação e da validação no servidor.'],
  products:['O que comprova uma alteração de estoque?',['Só editar o saldo','Uma movimentação registrada com motivo e responsável','Uma foto do item'],1,'Compras, vendas, consumo e ajustes precisam de histórico de movimentação.'],
  client:['O que devo conferir antes de agendar?',['Somente o nome do profissional','Procedimentos, preço ou cobertura e horário disponível','Qualquer horário que eu quiser'],1,'A reserva depende da disponibilidade real e das condições da assinatura.'],
  branding:['Quando uma identidade passa a aparecer para os clientes?',['Ao digitar o Instagram','Após revisar a prévia e publicar','Ao iniciar a análise'],1,'A prévia permite revisar a identidade antes da publicação.'],
 }
 const q=quizzes[module]||['Como agir nesta área?',['Conferir dados e permissões antes de salvar ou compartilhar','Salvar qualquer alteração sem revisar','Usar dados de outras barbearias'],0,'Revise o contexto da barbearia e os dados disponíveis no seu perfil.']
 return{question:q[0],choices:q[1],correct:q[2],explanation:q[3]}
}

export interface SavedTourRun { chapterIds:string[]; stepKey:string; skippedModules:TourModule[]; completedSteps:string[]; updatedAt:string }
export function validSavedTourRun(value:unknown):SavedTourRun|null{
 if(!value||typeof value!=='object')return null
 const v=value as Partial<SavedTourRun>
 const strings=(items:unknown):items is string[]=>Array.isArray(items)&&items.every(item=>typeof item==='string')
 return strings(v.chapterIds)&&typeof v.stepKey==='string'&&strings(v.skippedModules)&&strings(v.completedSteps)&&typeof v.updatedAt==='string'&&Number.isFinite(Date.parse(v.updatedAt))?v as SavedTourRun:null
}
export function readSavedTourRun(key:string):SavedTourRun|null{try{return validSavedTourRun(JSON.parse(localStorage.getItem(`${key}:run`)||'null'))}catch{return null}}
export function saveTourRun(key:string,run:SavedTourRun|null):void{try{if(run)localStorage.setItem(`${key}:run`,JSON.stringify(run));else localStorage.removeItem(`${key}:run`)}catch{/* Navigation remains available without storage. */}}

export function tourStorageKey(userId: string, shopId: string | undefined, role: Role): string {
  return `barber-guided-tour:v1:${userId}:${shopId || 'platform'}:${role}`
}

export function readFinishedTours(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch { return [] }
}

export function saveFinishedTours(key: string, ids: string[]): void {
  try { localStorage.setItem(key, JSON.stringify([...new Set([...readFinishedTours(key), ...ids])])) } catch { /* The tour remains usable without browser storage. */ }
}
