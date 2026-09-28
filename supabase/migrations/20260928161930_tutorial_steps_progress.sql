-- Interactive, role-aware walkthroughs. Content is global; completion is
-- private to one user in one barbershop (or to a platform master globally).
create table public.tutorial_steps (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('master','admin','barber','client')),
  module_key text not null check (module_key in (
    'master','dashboard','reports','appointments','clients','services',
    'subscriptions','products','bar','finance','goals','partners',
    'marketing','ai','bio','settings','tutorial'
  )),
  position integer not null check (position between 1 and 100),
  title text not null check (length(btrim(title)) between 3 and 160),
  description text not null check (length(btrim(description)) between 10 and 1200),
  action_label text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role, module_key, position),
  check (role = 'master' or module_key <> 'master'),
  check (role <> 'master' or module_key in ('master','tutorial'))
);
create index tutorial_steps_role_module_idx
  on public.tutorial_steps (role, module_key, position) where active;

create table public.tutorial_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  barbershop_id uuid references public.barbershops(id) on delete cascade,
  step_id uuid not null references public.tutorial_steps(id) on delete cascade,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (user_id, barbershop_id, step_id)
);
create index tutorial_progress_shop_user_idx
  on public.tutorial_progress (barbershop_id, user_id, step_id);
create index tutorial_progress_user_completed_idx
  on public.tutorial_progress (user_id, barbershop_id, completed_at)
  where completed_at is not null;

create function app_private.can_see_tutorial_step(p_step_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.tutorial_steps step
    where step.id = p_step_id and step.active and (
      (step.role = 'master' and app_private.is_platform_admin())
      or (step.role = 'admin' and exists (
        select 1 from public.memberships m
        where m.user_id = (select auth.uid())
          and m.role = 'admin' and m.active
      ))
      or (step.role = 'barber' and exists (
        select 1 from public.memberships m
        where m.user_id = (select auth.uid())
          and m.role = 'barber' and m.active
          and (step.module_key = 'tutorial'
            or app_private.has_module(m.barbershop_id, step.module_key))
      ))
      or (step.role = 'client'
        and step.module_key in ('dashboard','appointments','subscriptions','tutorial')
        and exists (
          select 1 from public.clients c
          where c.user_id = (select auth.uid())
        ))
    )
  );
$$;
revoke execute on function app_private.can_see_tutorial_step(uuid)
  from public, anon, authenticated;
grant execute on function app_private.can_see_tutorial_step(uuid)
  to authenticated;

create function app_private.can_access_tutorial_step(
  p_step_id uuid, p_barbershop_id uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.tutorial_steps step
    where step.id = p_step_id and step.active and (
      (step.role = 'master'
        and p_barbershop_id is null
        and app_private.is_platform_admin())
      or (step.role = 'admin'
        and p_barbershop_id is not null
        and exists (
          select 1 from public.memberships m
          where m.barbershop_id = p_barbershop_id
            and m.user_id = (select auth.uid())
            and m.role = 'admin' and m.active
        ))
      or (step.role = 'barber'
        and p_barbershop_id is not null
        and exists (
          select 1 from public.memberships m
          where m.barbershop_id = p_barbershop_id
            and m.user_id = (select auth.uid())
            and m.role = 'barber' and m.active
            and (step.module_key = 'tutorial'
              or app_private.has_module(p_barbershop_id, step.module_key))
        ))
      or (step.role = 'client'
        and p_barbershop_id is not null
        and step.module_key in ('dashboard','appointments','subscriptions','tutorial')
        and exists (
          select 1 from public.clients c
          where c.barbershop_id = p_barbershop_id
            and c.user_id = (select auth.uid())
        ))
    )
  );
$$;
revoke execute on function app_private.can_access_tutorial_step(uuid,uuid)
  from public, anon, authenticated;
grant execute on function app_private.can_access_tutorial_step(uuid,uuid)
  to authenticated;

create function app_private.normalize_tutorial_progress()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
begin
  select role into v_role from public.tutorial_steps where id = new.step_id;
  if v_role is null then
    raise exception 'Tutorial step not found' using errcode = '23503';
  end if;
  if (v_role = 'master') is distinct from (new.barbershop_id is null) then
    raise exception 'Tutorial progress shop context does not match role'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id
      or new.barbershop_id is distinct from old.barbershop_id
      or new.step_id is distinct from old.step_id then
      raise exception 'Tutorial progress identity cannot change'
        using errcode = '23514';
    end if;
    if new.completed_at is distinct from old.completed_at then
      new.completed_at := case when new.completed_at is null then null else now() end;
    end if;
    new.updated_at := now();
  elsif new.completed_at is not null then
    new.completed_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function app_private.normalize_tutorial_progress()
  from public, anon, authenticated;
create trigger normalize_tutorial_progress
  before insert or update on public.tutorial_progress
  for each row execute function app_private.normalize_tutorial_progress();

create trigger set_tutorial_step_updated_at
  before update on public.tutorial_steps
  for each row execute function app_private.touch_updated_at();

alter table public.tutorial_steps enable row level security;
alter table public.tutorial_progress enable row level security;
revoke all on public.tutorial_steps, public.tutorial_progress
  from anon, authenticated;
grant all on public.tutorial_steps, public.tutorial_progress to service_role;
grant select on public.tutorial_steps to authenticated;
grant select, insert on public.tutorial_progress to authenticated;
grant update (completed_at) on public.tutorial_progress to authenticated;

create policy tutorial_steps_visible on public.tutorial_steps
  for select to authenticated
  using (app_private.can_see_tutorial_step(id));
create policy tutorial_progress_own_read on public.tutorial_progress
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and app_private.can_access_tutorial_step(step_id, barbershop_id)
  );
create policy tutorial_progress_own_insert on public.tutorial_progress
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and app_private.can_access_tutorial_step(step_id, barbershop_id)
  );
create policy tutorial_progress_own_update on public.tutorial_progress
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and app_private.can_access_tutorial_step(step_id, barbershop_id)
  )
  with check (
    user_id = (select auth.uid())
    and app_private.can_access_tutorial_step(step_id, barbershop_id)
  );

-- Each step names a concrete action in the corresponding existing screen.
insert into public.tutorial_steps
  (role, module_key, position, title, description, action_label)
values
  ('master','tutorial',1,'Conheça o roteiro','Abra cada módulo para ver as etapas disponíveis. Marque a etapa como concluída somente depois de conferir o resultado na tela.','Ver roteiro'),
  ('master','master',1,'Ative seu acesso master','Entre com o e-mail autorizado para a plataforma e ative o acesso master. Confira se o Painel master aparece no menu.','Abrir painel master'),
  ('master','master',2,'Cadastre a primeira barbearia','No Painel master, crie a barbearia com nome e identificador público. Verifique se ela aparece no seletor de lojas.','Criar barbearia'),
  ('master','master',3,'Defina a cobrança por barbeiro','Informe o valor mensal por barbeiro ativo e revise a quantidade de profissionais de cada loja antes de habilitar a cobrança.','Revisar cobrança'),
  ('master','master',4,'Convide o administrador da loja','Vincule o e-mail do administrador à barbearia correta e confirme o convite antes de liberar o uso da equipe.','Gerenciar acessos'),

  ('admin','tutorial',1,'Use o passo a passo','Escolha um módulo, execute a ação indicada e marque a etapa como concluída. O progresso fica salvo para esta barbearia.','Ver módulos'),
  ('admin','dashboard',1,'Confira o panorama','Abra a visão geral e confira agendamentos, clientes e resultados do período selecionado.','Abrir visão geral'),
  ('admin','dashboard',2,'Investigue um indicador','Se um indicador chamar atenção, abra a aba correspondente e compare os registros que formam o número.','Analisar painel'),
  ('admin','reports',1,'Selecione o período','Escolha a semana ou o intervalo que deseja analisar; compare faturamento pago e ticket médio no mesmo período.','Abrir relatórios'),
  ('admin','reports',2,'Acompanhe o retorno','Compare cadastros novos, primeira visita concluída e retorno por barbeiro em até 30 dias.','Ver retenção'),
  ('admin','appointments',1,'Revise a agenda','Confira os horários disponíveis e os agendamentos do dia antes de confirmar alterações com a equipe.','Abrir agenda'),
  ('admin','appointments',2,'Faça um agendamento','Selecione cliente, profissional, serviço e horário livre; confira valor e cobertura de assinatura antes de salvar.','Agendar atendimento'),
  ('admin','clients',1,'Cadastre um cliente','Registre nome e contato na aba Clientes. Confira se o cadastro está associado à barbearia correta.','Abrir clientes'),
  ('admin','clients',2,'Vincule o profissional','Atribua o barbeiro responsável ao cliente para que ele veja apenas os dados dos próprios atendidos.','Definir barbeiro'),
  ('admin','services',1,'Cadastre os serviços','Informe nome, duração, preço, custo estimado e disponibilidade de cada procedimento.','Abrir serviços'),
  ('admin','services',2,'Organize os horários','Configure dias e janelas de atendimento de cada barbeiro; confira a agenda pública antes de divulgar.','Definir horários'),
  ('admin','subscriptions',1,'Crie um plano','Defina preço, periodicidade, quantidade de visitas e serviços incluídos antes de ativar o plano.','Abrir assinaturas'),
  ('admin','subscriptions',2,'Conecte o recebimento','Nas configurações, conecte a conta Mercado Pago da barbearia e confirme os pagamentos antes de considerar a assinatura ativa.','Configurar cobrança'),
  ('admin','products',1,'Cadastre o catálogo','Informe produto, categoria, preço, custo e quantidade inicial em estoque.','Abrir produtos'),
  ('admin','products',2,'Confira uma venda','Registre uma venda de teste interna e confira se os itens e o estoque foram atualizados corretamente.','Ver vendas'),
  ('admin','bar',1,'Monte o cardápio','Marque produtos como Bar ou Cozinha e confira preço e estoque disponíveis para a equipe.','Abrir bar e cozinha'),
  ('admin','bar',2,'Acompanhe a comanda','Registre os itens consumidos e mude o estado da comanda quando o pedido for entregue.','Ver comandas'),
  ('admin','finance',1,'Registre a estrutura','Informe o custo mensal da estrutura e a porcentagem de lucro desejada.','Abrir financeiro'),
  ('admin','finance',2,'Lance despesas','Cadastre cada gasto com categoria, valor e data; depois compare as despesas com o faturamento pago.','Cadastrar despesa'),
  ('admin','finance',3,'Peça uma análise','Use a sugestão da IA para revisar custos, margem e preços; confira os números antes de aplicar mudanças.','Analisar preços'),
  ('admin','goals',1,'Crie a meta da loja','Defina indicador, período e valor desejado para acompanhar a evolução da barbearia.','Abrir metas'),
  ('admin','goals',2,'Defina uma meta individual','Escolha o barbeiro e cadastre uma meta para que ela apareça no painel dele.','Atribuir meta'),
  ('admin','partners',1,'Cadastre um parceiro','Registre nome, contato e tipo de parceria para organizar indicações e ações conjuntas.','Abrir parceiros'),
  ('admin','partners',2,'Acompanhe as ações','Revise os parceiros ativos e mantenha atualizados os contatos e os resultados combinados.','Ver parceiros'),
  ('admin','marketing',1,'Siga o roteiro orgânico','Revise perfil, temas, calendário e chamadas para agendamento; marque as tarefas executadas.','Abrir marketing'),
  ('admin','marketing',2,'Prepare anúncios pagos','Confira conta de anúncios, objetivo, público local, orçamento e destino antes de publicar campanha.','Ver guia de anúncios'),
  ('admin','marketing',3,'Analise o Instagram','Conecte a conta profissional quando disponível e peça uma análise dos dados autorizados.','Conectar Instagram'),
  ('admin','ai',1,'Descreva a pergunta','Escolha o tipo de análise e informe o problema concreto que deseja resolver.','Abrir solicitações à IA'),
  ('admin','ai',2,'Confira a resposta','Compare as sugestões com os dados da barbearia antes de alterar preços, gastos ou campanhas.','Ver respostas'),
  ('admin','bio',1,'Monte a mini bio','Configure título, descrição e links de agendamento, assinatura, produtos e WhatsApp.','Abrir mini bio'),
  ('admin','bio',2,'Teste os links públicos','Abra a página da barbearia como cliente e confirme cada destino antes de compartilhar no Instagram.','Ver página pública'),
  ('admin','settings',1,'Atualize a barbearia','Revise nome, contato, WhatsApp e chave Pix informativa da loja.','Abrir configurações'),
  ('admin','settings',2,'Convide a equipe','Envie convite por e-mail para cada administrador ou barbeiro que deve usar o sistema.','Convidar pessoa'),
  ('admin','settings',3,'Libere abas individualmente','Abra as permissões de cada barbeiro e marque apenas as abas necessárias ao trabalho dele.','Configurar acessos'),

  ('barber','tutorial',1,'Acompanhe sua evolução','Abra o roteiro da aba liberada para você e marque cada tarefa quando terminar. O progresso é só seu nesta barbearia.','Ver roteiro'),
  ('barber','dashboard',1,'Confira o dia','Veja seus atendimentos e números pessoais antes de começar a agenda.','Abrir visão geral'),
  ('barber','reports',1,'Leia seus resultados','Selecione um período e acompanhe faturamento, ticket médio e retorno dos seus clientes novos.','Abrir relatórios'),
  ('barber','appointments',1,'Confira seus horários','Veja os horários disponíveis e os agendamentos atribuídos a você.','Abrir agenda'),
  ('barber','appointments',2,'Atualize o atendimento','Após realizar o serviço, atualize o estado do agendamento para manter o histórico correto.','Atualizar agenda'),
  ('barber','clients',1,'Consulte seus clientes','Abra somente os clientes atribuídos a você e revise contato e histórico antes do atendimento.','Abrir clientes'),
  ('barber','clients',2,'Registre informações úteis','Anote preferências e detalhes necessários para o próximo atendimento do seu cliente.','Atualizar cliente'),
  ('barber','services',1,'Confira seus serviços','Revise os procedimentos e os preços publicados pela barbearia antes de orientar o cliente.','Abrir serviços'),
  ('barber','subscriptions',1,'Confira o plano do cliente','Veja se a assinatura está ativa, se cobre o procedimento e quantas visitas restam no ciclo.','Ver assinaturas'),
  ('barber','products',1,'Confira o estoque','Veja produtos e quantidades disponíveis antes de oferecer um item ao cliente.','Abrir produtos'),
  ('barber','bar',1,'Registre o consumo','Selecione os itens consumidos na barbearia e confira a comanda antes de entregar.','Abrir bar e cozinha'),
  ('barber','bar',2,'Entregue o pedido','Depois de entregar os itens, atualize o estado da comanda para a equipe acompanhar.','Atualizar comanda'),
  ('barber','goals',1,'Crie sua meta pessoal','Escolha um indicador e um prazo realista; acompanhe sua evolução na aba Metas.','Abrir metas'),
  ('barber','goals',2,'Veja a meta da barbearia','Confira a meta coletiva e eventual meta individual definida pelo administrador.','Ver metas'),
  ('barber','partners',1,'Conheça as parcerias','Veja os parceiros cadastrados e as condições atuais antes de indicar um contato.','Abrir parceiros'),
  ('barber','marketing',1,'Execute uma tarefa orgânica','Siga o guia da semana, publique conteúdo autorizado e registre a ação concluída.','Abrir marketing'),
  ('barber','marketing',2,'Revise anúncios com a equipe','Consulte o roteiro de campanha paga antes de sugerir criativos ou orçamento ao administrador.','Ver guia de anúncios'),
  ('barber','ai',1,'Envie uma solicitação','Descreva uma dúvida operacional concreta e confira a resposta antes de usar a sugestão.','Abrir solicitações à IA'),
  ('barber','bio',1,'Compartilhe o link certo','Abra a mini bio da barbearia e use o link público de agendamento ao orientar um cliente.','Abrir mini bio'),
  ('barber','settings',1,'Confira seus acessos','Veja quais abas foram liberadas pelo administrador e solicite ajustes diretamente a ele.','Abrir configurações'),

  ('client','tutorial',1,'Use este guia','Marque as etapas depois de concluir cada ação. Seu progresso fica salvo na barbearia que você está visitando.','Ver meu roteiro'),
  ('client','dashboard',1,'Confira seu resumo','Veja seus próximos horários, visitas anteriores e valores pagos na área do cliente.','Abrir minha área'),
  ('client','appointments',1,'Escolha o procedimento','Veja descrição, duração e preço antes de selecionar um serviço.','Escolher serviço'),
  ('client','appointments',2,'Reserve um horário','Escolha barbeiro e horário livre; confira os dados e conclua o agendamento.','Agendar atendimento'),
  ('client','appointments',3,'Acompanhe suas visitas','Revise os dias em que você foi atendido e o histórico dos procedimentos realizados.','Ver histórico'),
  ('client','subscriptions',1,'Compare os planos','Confira preço, frequência, serviços incluídos e número de visitas de cada plano.','Ver planos'),
  ('client','subscriptions',2,'Acompanhe sua assinatura','Depois da confirmação do pagamento, veja período vigente e visitas restantes antes de agendar.','Ver minha assinatura');
