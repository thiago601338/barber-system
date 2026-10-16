/** Known provider messages are translated once so every form gives the same guidance. */
export function errorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : String((value as { message?: string })?.message || 'Não foi possível concluir a operação.')
  if (/email rate limit|over_email_send_rate_limit/i.test(message)) return 'O limite de envio de e-mails foi atingido. Aguarde antes de tentar novamente. O administrador pode configurar um serviço de e-mail próprio.'
  if (/invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos. Confira seus dados e tente novamente.'
  if (/email not confirmed/i.test(message)) return 'Confirme seu e-mail pelo link de acesso antes de entrar.'
  if (/user already registered|already been registered/i.test(message)) return 'Este e-mail já possui uma conta. Entre ou use “Esqueci minha senha”.'
  if (/jwt expired|invalid jwt|session.*expired/i.test(message)) return 'Sua sessão expirou. Entre novamente para continuar.'
  if (/failed to fetch|networkerror|load failed/i.test(message)) return 'Não foi possível conectar ao sistema. Confira sua conexão e tente novamente.'
  if (/duplicate key.*unique/i.test(message)) return 'Já existe um registro com estes dados. Confira o cadastro antes de repetir.'
  if (/row.level security|permission denied|access denied/i.test(message)) return 'Seu perfil não tem permissão para esta operação. Peça ao administrador para revisar seu acesso.'
  if (/violates foreign key|foreign key constraint/i.test(message)) return 'Um dos registros relacionados não está disponível nesta barbearia. Atualize a lista e selecione novamente.'
  if (/violates check constraint|null value in column/i.test(message)) return 'Confira os campos obrigatórios e os valores informados antes de salvar.'
  return message
}
