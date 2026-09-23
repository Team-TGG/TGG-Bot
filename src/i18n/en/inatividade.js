// Inglês das DMs de inatividade: a de marcação (quarta 06:10) e o lembrete de 3 em 3h. A chave é a frase em
// português exatamente como está no código — mudou lá, muda aqui, senão ela volta a sair em português (a
// checagem avisa).
//
// Só as DMs passam por aqui. O aviso no canal dos inativos é uma mensagem só para a lista inteira, e mensagem
// que fica no canal não tem como seguir o cargo de cada um — ver "Idioma por cargo" no CLAUDE.md.
export default {
  'Aviso de Inatividade': 'Inactivity Warning',

  // DM da marcação (weeklyInactiveService)
  'Você fez menos de **{minimo} de contribuição** na semana e foi marcado como inativo.':
    'You made less than **{minimo} contribution** this week and were marked as inactive.',
  'Veja o lembrete do TGG-Bot em <#{canal}> para saber como sair da lista e evitar ser removido da guilda.':
    'Check the TGG-Bot reminder in <#{canal}> to learn how to get off the list and avoid being removed from the guild.',
  'Se teve um motivo para não jogar, use `.active <justificativa>`. Se já sabe que vai ficar sem jogar nas próximas semanas, use `.justificativa <motivo> <semanas>`.':
    'If you had a reason not to play, use `.active <reason>`. If you already know you will be away for the next few weeks, use `.justificativa <reason> <weeks>`.',

  // DM do lembrete de 3h (inactivePlayers)
  'Você fez menos de {minimo} de contribuição e ficou inativo. Vá até <#{canal}> e leia o lembrete do TGG-Bot para saber mais, e evite ser removido da guilda.':
    'You made less than {minimo} contribution and were marked as inactive. Head to <#{canal}> and read the TGG-Bot reminder to learn more, and avoid being removed from the guild.',
};
