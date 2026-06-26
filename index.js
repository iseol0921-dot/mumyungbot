import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from 'discord.js';
import 'dotenv/config';

import fs from 'fs';

const SERVER_IDS = ['1506990201204117565'];
const DATA_FILE = './voiceData.json';

const JOB_ROLES = {
  warrior: '1511648603930890331',
  mage: '1511648663380693173',
  thief: '1511648542396125274',
  archer: '1511648446862458970',
  pirate: '1511649928001228941'
};

const JOB_LABELS = {
  warrior: '전사',
  mage: '법사',
  thief: '도적',
  archer: '궁수',
  pirate: '해적'
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { guilds: {} };
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { guilds: {} };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getUserData(data, guildId, userId) {
  if (!data.guilds[guildId]) data.guilds[guildId] = { users: {} };
  if (!data.guilds[guildId].users[userId]) {
    data.guilds[guildId].users[userId] = {
      totalMs: 0,
      joinedAt: null,
      lastJoinAt: null,
      lastLeaveAt: null,
      name: ''
    };
  }
  return data.guilds[guildId].users[userId];
}

function formatTime(ms) {
  const min = Math.floor(ms / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;

  if (d > 0) return `${d}일 ${h}시간 ${m}분`;
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분`;
}

function formatDate(t) {
  if (!t) return '기록 없음';
  return new Date(t).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

function getCurrentTotal(u) {
  let total = u.totalMs || 0;
  if (u.joinedAt) total += Date.now() - u.joinedAt;
  return total;
}

function makeJobEmbed() {
  return new EmbedBuilder()
    .setTitle('⚔️ 직업 선택')
    .setDescription(
      '본인의 직업을 선택해주세요.\n\n' +
      '직업은 **1개만 선택 가능**합니다.\n' +
      '다른 직업을 누르면 기존 직업 역할은 자동으로 제거됩니다.'
    )
    .setColor(0x9b59b6);
}

function makeJobButtons() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('job_warrior')
      .setLabel('전사')
      .setEmoji('⚔️')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId('job_thief')
      .setLabel('도적')
      .setEmoji('🗡️')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId('job_archer')
      .setLabel('궁수')
      .setEmoji('🏹')
      .setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('job_mage')
      .setLabel('법사')
      .setEmoji('✨')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId('job_pirate')
      .setLabel('해적')
      .setEmoji('☠️')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId('job_reset')
      .setLabel('리셋')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

async function setJobRole(interaction, jobKey) {
  const member = interaction.member;

  const allRoleIds = Object.values(JOB_ROLES);
  const removeRoles = allRoleIds.filter(roleId => member.roles.cache.has(roleId));

  if (removeRoles.length > 0) {
    await member.roles.remove(removeRoles);
  }

  if (jobKey === 'reset') {
    await interaction.reply({
      content: '🔄 직업 역할을 모두 제거했습니다.',
      ephemeral: true
    });
    return;
  }

  const roleId = JOB_ROLES[jobKey];
  const label = JOB_LABELS[jobKey];

  if (!roleId) {
    await interaction.reply({
      content: '직업 역할 설정을 찾을 수 없습니다.',
      ephemeral: true
    });
    return;
  }

  await member.roles.add(roleId);

  await interaction.reply({
    content: `✅ **${label}** 역할이 지급되었습니다.`,
    ephemeral: true
  });
}

const commands = [
  new SlashCommandBuilder()
    .setName('참여시간')
    .setDescription('음성채널 참여시간을 확인합니다')
    .addUserOption(o =>
      o.setName('유저')
        .setDescription('확인할 유저')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('참여랭킹')
    .setDescription('음성채널 참여시간 랭킹을 확인합니다')
    .addIntegerOption(o =>
      o.setName('인원')
        .setDescription('표시할 인원 수')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('미접속일자')
    .setDescription('7일 이상 음성채널 미접속자를 확인합니다'),

  new SlashCommandBuilder()
    .setName('직업패널')
    .setDescription('직업 선택 버튼 패널을 생성합니다')
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`${client.user.tag} 로그인 완료!`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  for (const guildId of SERVER_IDS) {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, guildId),
      { body: commands }
    );
    console.log(`${guildId} 명령어 등록 완료!`);
  }

  console.log('전체 명령어 등록 완료!');
});

client.on('voiceStateUpdate', (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const guildId = member.guild.id;
  const userId = member.user.id;

  const oldChannel = oldState.channelId;
  const newChannel = newState.channelId;

  if (oldChannel === newChannel) return;

  const data = loadData();
  const userData = getUserData(data, guildId, userId);

  userData.name = member.displayName;

  if (!oldChannel && newChannel) {
    userData.joinedAt = Date.now();
    userData.lastJoinAt = Date.now();
  }

  if (oldChannel && !newChannel) {
    if (userData.joinedAt) {
      userData.totalMs += Date.now() - userData.joinedAt;
    }
    userData.joinedAt = null;
    userData.lastLeaveAt = Date.now();
  }

  saveData(data);
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('job_')) {
        const jobKey = interaction.customId.replace('job_', '');
        await setJobRole(interaction, jobKey);
        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;

    await interaction.deferReply();

    const guildId = interaction.guildId || SERVER_IDS[0];
    const data = loadData();

    if (interaction.commandName === '직업패널') {
      await interaction.editReply({
        embeds: [makeJobEmbed()],
        components: makeJobButtons()
      });
      return;
    }

    if (interaction.commandName === '참여시간') {
      const target = interaction.options.getUser('유저') || interaction.user;
      const userData = getUserData(data, guildId, target.id);
      const total = getCurrentTotal(userData);

      await interaction.editReply(
        `📊 ${userData.name || target.username}님의 음성 참여시간\n\n` +
        `총 참여시간: **${formatTime(total)}**\n` +
        `마지막 입장: ${formatDate(userData.lastJoinAt)}\n` +
        `마지막 퇴장: ${formatDate(userData.lastLeaveAt)}`
      );
      return;
    }

    if (interaction.commandName === '참여랭킹') {
      const limit = interaction.options.getInteger('인원') || 10;
      const guildData = data.guilds[guildId]?.users || {};

      const ranking = Object.entries(guildData)
        .map(([userId, userData]) => ({
          name: userData.name || userId,
          totalMs: getCurrentTotal(userData)
        }))
        .filter(v => v.totalMs > 0)
        .sort((a, b) => b.totalMs - a.totalMs)
        .slice(0, limit);

      const text = ranking.length
        ? ranking.map((v, i) => `${i + 1}. ${v.name} - ${formatTime(v.totalMs)}`).join('\n')
        : '아직 기록이 없습니다.';

      await interaction.editReply(`🏆 음성 참여시간 랭킹\n\n${text}`);
      return;
    }

    if (interaction.commandName === '미접속일자') {
      const days = 7;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

      let guild = interaction.guild || client.guilds.cache.get(guildId);

      if (!guild) {
        try {
          guild = await client.guilds.fetch(guildId);
        } catch {
          guild = null;
        }
      }

      if (!guild) {
        await interaction.editReply('서버 정보를 못 불러왔어.');
        return;
      }

      let membersCollection;
      try {
        membersCollection = await guild.members.fetch();
      } catch {
        membersCollection = guild.members.cache;
      }

      const members = Array.from(membersCollection.values())
        .filter(m => !m.user.bot);

      const guildData = data.guilds[guildId]?.users || {};

      const inactive = members.filter(member => {
        const userData = guildData[member.id];
        if (!userData) return true;
        const lastActive = userData.joinedAt || userData.lastLeaveAt || userData.lastJoinAt;
        if (!lastActive) return true;
        return lastActive < cutoff;
      });

      const text = inactive.length
        ? inactive.slice(0, 50).map(member => {
            const userData = guildData[member.id];
            const lastActive = userData
              ? formatDate(userData.joinedAt || userData.lastLeaveAt || userData.lastJoinAt)
              : '기록 없음';
            return `- ${member.displayName} / 마지막 음성: ${lastActive}`;
          }).join('\n')
        : `${days}일 이상 미접속자가 없습니다.`;

      await interaction.editReply(`📅 ${days}일 이상 음성 미접속자\n\n${text}`);
      return;
    }
  } catch (error) {
    console.error(error);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('오류가 발생했어. Railway 로그 확인 필요!');
      } else {
        await interaction.reply('오류가 발생했어. Railway 로그 확인 필요!');
      }
    } catch {}
  }
});

const token = process.env.DISCORD_TOKEN?.trim();

if (!token) {
  console.error('DISCORD_TOKEN이 없습니다. .env 파일을 확인하세요.');
  process.exit(1);
}

client.login(token);
