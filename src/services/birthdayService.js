import { EmbedBuilder } from 'discord.js';
import { getTodayBirthdays } from '../db.js';
import { birthdays as birthdayConfig, discord as discordConfig } from '../../config/index.js';

export function createBirthdayEmbed(userId) {
  return new EmbedBuilder()
    .setColor(0xff69b4) 
    .setTitle('🎉 Feliz Aniversário! 🎂')
    .setDescription(`Parabéns, <@${userId}>! Que você celebre seu aniversário com muita alegria e tenha um dia incrível cheio de felicidades!`)
    .setImage('https://i.imgur.com/R5cODcM.gif')
    .setTimestamp()
    .setFooter({ text: 'Team TGG' });
}

export async function processBirthdays(client) {
  const { guildId } = discordConfig;
  const { roleId, channelId } = birthdayConfig;

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const todayBirthdays = await getTodayBirthdays();
    if (todayBirthdays.length === 0) {
      console.log('[Birthday] Nenhum aniversariante hoje');
      return;
    }

    console.log(`[Birthday] ${todayBirthdays.length} aniversariante(s) encontrado(s)`);

    const birthdayChannel = await client.channels.fetch(channelId).catch(() => null);
    if (!birthdayChannel) return;

    for (const birthday of todayBirthdays) {
      try {
        const member = await guild.members.fetch(birthday.user_id).catch(() => null);
        if (!member || !member.roles) {
          console.log(`[Birthday] Membro ${birthday.user_id} não encontrado ou sem dados de cargo`);
          continue;
        }

        if (!member.roles.cache.has(roleId)) {
          await member.roles.add(roleId);
          console.log(`[Birthday] Cargo atribuído a ${member.user.tag}`);
        }

      
        const embed = createBirthdayEmbed(birthday.user_id);
        await birthdayChannel.send({ embeds: [embed] });

      } catch (err) {
        console.error(`[Birthday] Erro ao processar aniversariante ${birthday.user_id}:`, err.message);
      }
    }

  } catch (err) {
    console.error('[Birthday] Erro ao processar aniversários:', err.message);
  }
}

export async function removeBirthdayRole(client) {
  const { guildId } = discordConfig;
  const { roleId } = birthdayConfig;

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const birthdayRole = await guild.roles.fetch(roleId).catch(() => null);
    if (!birthdayRole) return;

    for (const [_, member] of birthdayRole.members) {
      try {
        await member.roles.remove(roleId);
        console.log(`[Birthday] Cargo removido de ${member.user.tag}`);
      } catch (err) {
        console.error(`[Birthday] Erro ao remover cargo de ${member.user.tag}:`, err.message);
      }
    }

  } catch (err) {
    console.error('[Birthday] Erro ao remover cargos de aniversário:', err.message);
  }
}
