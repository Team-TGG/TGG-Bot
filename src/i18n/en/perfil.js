// Inglês do .profile: comando, cartão, botões, vitrine, lista e .limpar-perfil. A chave é a frase em português
// exatamente como está no código — mudou lá, muda aqui, senão ela volta a sair em português (a checagem avisa).
// Nome e descrição das insígnias não moram aqui: ficam no catálogo, no campo `en` de cada entrada.
export default {
  // Comando
  'O `.profile` está em teste, só para assistants ou superiores.': 'The `.profile` command is in testing, only for assistants and above.',
  'Membro inválido': 'Invalid member',
  'Use `.profile`, `.profile @membro` ou `.profile <ID do Discord>`.': 'Use `.profile`, `.profile @member` or `.profile <Discord ID>`.',
  'Perfil só para membros': 'Profiles are for members only',
  'O `.profile` é para membros ativos da guilda. Se você é membro, peça para a staff conferir seu cadastro.':
    'The `.profile` command is for active guild members. If you are a member, ask the staff to check your registration.',
  'Perfil não encontrado': 'Profile not found',
  '<@{id}> não é membro ativo da guilda.': '<@{id}> is not an active guild member.',
  'Gerando o perfil...': 'Generating the profile...',

  // Cartão
  'Sem nick': 'No nickname',
  'Líder': 'Leader',
  'Officer': 'Officer',
  'Membro': 'Member',
  'Recruta': 'Recruit',
  'Cargo indisponível': 'Rank unavailable',
  'Fora da guilda': 'Not in the guild',
  'Entrou hoje na guilda': 'Joined the guild today',
  'Na guilda há {tempo}': 'In the guild for {tempo}',
  '{n} dia': '{n} day',
  '{n} dias': '{n} days',
  '{n} mês': '{n} month',
  '{n} meses': '{n} months',
  '{n} ano': '{n} year',
  '{n} anos': '{n} years',
  '{anos} e {meses}': '{anos} and {meses}',
  'Tempo de guilda indisponível': 'Guild time unavailable',
  'PEAK ELO': 'PEAK ELO',
  'Sem mensagem ainda.': 'No message yet.',
  'VITRINE': 'SHOWCASE',

  // Tiers e categorias (chegam por variável: a checagem não confere, o log [I18N] sim)
  'Bronze': 'Bronze',
  'Prata': 'Silver',
  'Ouro': 'Gold',
  'Platina': 'Platinum',
  'Diamante': 'Diamond',
  'Conquistada': 'Earned',
  'Jogo': 'Game',
  'Guilda': 'Guild',
  'Discord': 'Discord',
  'Economia': 'Economy',

  // Botões do cartão
  'Vitrine': 'Showcase',
  'Editar mensagem': 'Edit message',
  'Sync': 'Sync',
  'Todas as insígnias': 'All badges',
  'Só o dono do perfil': 'Profile owner only',
  'Esse botão é de quem é dono do perfil. Abra o seu com `.profile`.': 'This button belongs to the profile owner. Open yours with `.profile`.',

  // Vitrine
  'Escolha o espaço': 'Choose a slot',
  'Espaço {n}': 'Slot {n}',
  'Vazio': 'Empty',
  'Qual espaço da vitrine você quer trocar?': 'Which showcase slot do you want to change?',
  'Quer trocar outro espaço?': 'Want to change another slot?',
  'Escolha a categoria': 'Choose a category',
  'Deixar o espaço vazio': 'Leave the slot empty',
  'Espaço {n}: de qual categoria é a insígnia?': 'Slot {n}: which category is the badge from?',
  'Você ainda não tem insígnia de {categoria}.': "You don't have any {categoria} badge yet.",
  'Escolha a insígnia': 'Choose a badge',
  'Espaço {n}: qual insígnia de {categoria}?': 'Slot {n}: which {categoria} badge?',
  '**{nome}** está no espaço {n}. O cartão está sendo atualizado.': '**{nome}** is now in slot {n}. The card is being updated.',
  'O espaço {n} ficou vazio. O cartão está sendo atualizado.': 'Slot {n} is now empty. The card is being updated.',

  // Todas as insígnias
  'Faltando': 'Missing',
  '{n} faltando': '{n} missing',
  '{feitas} de {total} completas': '{feitas} of {total} complete',
  'Nada faltando: todas as insígnias disponíveis estão no máximo.': 'Nothing missing: every available badge is maxed out.',
  'Insígnias · {aba}': 'Badges · {aba}',
  'Perfil de <@{dono}> · {resumo}': "<@{dono}>'s profile · {resumo}",
  'Página {pagina} de {paginas} · semana vai de quinta a quinta · recalculadas todo dia às 04:00':
    'Page {pagina} of {paginas} · weeks run Thursday to Thursday · recalculated daily at 04:00 (Brasília time)',
  'Anterior': 'Previous',
  'Próxima': 'Next',
  'em breve': 'coming soon',
  'completa': 'complete',
  'bloqueada': 'locked',
  'sem medição ainda · {alvo} com {proximo}': 'not measured yet · {alvo} at {proximo}',

  // Sync
  'Sync em espera': 'Sync on cooldown',
  'Você pode sincronizar de novo <t:{quando}:R>.': 'You can sync again <t:{quando}:R>.',
  'Insígnias atualizadas': 'Badges updated',
  '{n} tier(s) novo(s) desde a última leitura. O cartão está sendo atualizado.':
    ({ n }) => `${n} new tier${n === 1 ? '' : 's'} since the last check. The card is being updated.`,
  'Nada mudou desde a última leitura.': 'Nothing changed since the last check.',

  // Mensagem do perfil
  'Editar perfil': 'Edit profile',
  'Mensagem do perfil': 'Profile message',
  'Deixe vazio para tirar a mensagem do cartão': 'Leave empty to remove the message from the card',
  'Mensagem salva': 'Message saved',
  'Mensagem removida': 'Message removed',
  'O cartão está sendo atualizado.': 'The card is being updated.',

  // .limpar-perfil
  'Apenas helpers ou superiores podem limpar perfis.': 'Only helpers and above can clear profiles.',
  'Uso: `.limpar-perfil <@membro/ID>`': 'Usage: `.limpar-perfil <@member/ID>`',
  'Nada para limpar': 'Nothing to clear',
  '<@{id}> não tem mensagem no perfil.': '<@{id}> has no profile message.',
  'Perfil limpo': 'Profile cleared',
  'A mensagem de <@{id}> foi removida e registrada em log-guilda.': "<@{id}>'s message was removed and logged in log-guilda.",
  'A DM de aviso não chegou (DM fechada).': "The warning DM didn't go through (DMs closed).",
  'Cartões já enviados continuam com a imagem antiga: apague essas mensagens se precisar.':
    'Cards already sent keep the old image: delete those messages if needed.',
  'Mensagem do perfil removida': 'Profile message removed',
  'A staff removeu a mensagem do seu perfil por não seguir as regras do servidor. Você pode escrever outra pelo botão **Editar mensagem** do `.profile`.':
    'The staff removed your profile message for not following the server rules. You can write a new one with the **Edit message** button on `.profile`.',
};
