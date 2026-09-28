# Identidade visual por barbearia

Cada barbearia tem uma identidade própria para o painel administrativo, o painel do barbeiro, a área do cliente e a página pública. O painel master continua com a marca da plataforma. O tema publicado pertence ao cadastro da barbearia; trocar de barbearia troca também cores, tipografia, logo, imagem principal e frase de marca.

## Como configurar

1. Um administrador abre **Identidade visual** e informa o link do perfil da barbearia no Instagram.
2. Em **Salvar e analisar com IA**, o sistema salva o link e tenta consultar os metadados públicos do perfil. O administrador pode acrescentar orientações sobre a marca e o endereço de uma logo própria.
3. A IA propõe paleta, tipografia e frase de marca. A proposta mostra as fontes efetivamente lidas e suas limitações; o administrador examina a prévia antes de publicar.
4. **Publicar identidade** aplica a proposta a todos os acessos daquela barbearia. As outras barbearias não são alteradas. O administrador pode analisar novamente e publicar uma nova versão.

O link público do Instagram é distinto da conexão Meta usada para métricas e anúncios. Um link, sozinho, pode não liberar imagens, publicações nem stories. Se o Instagram bloquear a leitura pública e não houver informações adicionais fornecidas pelo administrador, a análise informa a limitação em vez de inventar a aparência do perfil. O tema anterior permanece publicado se uma nova análise falhar.

## Primeira identidade: Kingsman

- Perfil informado: [@barbeariakingsmann1](https://www.instagram.com/barbeariakingsmann1/).
- Referência verificada no perfil em 28/09/2026: marca preta, dourada e branca, lettering ornamental e navalhas cruzadas; frase “Estilo é poder e aqui você é rei!”.
- A logo local veio da imagem pública do perfil e tem 100 × 100 px. É usada como selo pequeno, acompanhada do nome em texto nítido.
- A imagem principal preta e dourada foi gerada para o sistema como composição editorial. Ela não representa uma fotografia do estabelecimento.
- O tema foi aplicado ao cadastro `kingsman` no Supabase. A rota pública é `/b/kingsman`.

## Segurança

Somente administrador ativo da barbearia ou administrador master pode analisar e publicar a identidade. Propostas e orientações permanecem privadas; visitantes e clientes recebem apenas o tema aprovado. O backend valida o endereço do Instagram, os formatos de cor e os endereços das imagens antes de publicar, e limita frequência de análises. A leitura de perfil público não segue redirecionamentos para outros domínios.
