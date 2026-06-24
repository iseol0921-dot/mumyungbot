import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';

import fs from 'fs';

const SERVER_IDS = [
  '1506990201204117565'
];

const DATA_FILE = './voiceData.json';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { guilds: {} };
  }

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
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}일 ${hours}시간 ${minutes}분`;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

function getCurrentTotal(userData) {
  let total = userData.totalMs || 0;

  if (userData.joinedAt) {
    total += Date.now() - userData.joinedAt;
  }

  return total;
}

function formatDate(timestamp) {
  if (!timestamp) return '기록 없음';

  return new Date(timestamp).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul'
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
  .setDescription('7일 이상 음성채널 미접속자를 확인합니다')
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`${client.user.tag} 로그인 완료!`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  for (const guildId of SERVER_IDS) {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, guildId),
      { body: commands }
    );
  }

  console.log('명령어 등록 완료!');
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
  if (!interaction.isChatInputCommand()) return;

  const data = loadData();
  const guildId = interaction.guildId;

  if (interaction.commandName === '참여시간') {
    const target = interaction.options.getUser('유저') || interaction.user;
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);

    const userData = getUserData(data, guildId, target.id);
    if (member) userData.name = member.displayName;

    const total = getCurrentTotal(userData);

    await interaction.reply(
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
        userId,
        name: userData.name || userId,
        totalMs: getCurrentTotal(userData)
      }))
      .filter(v => v.totalMs > 0)
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, limit);

    const text = ranking.length
      ? ranking.map((v, i) => `${i + 1}. ${v.name} - ${formatTime(v.totalMs)}`).join('\n')
      : '아직 기록이 없습니다.';

    await interaction.reply(
      `🏆 음성 참여시간 랭킹\n\n${text}`
    );

    return;
  }

  if (interaction.commandName === '미접속일자') {
    const days =7;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    await interaction.guild.members.fetch();

    const guildData = data.guilds[guildId]?.users || {};
    const members = interaction.guild.members.cache
      .filter(m => !m.user.bot)
      .map(m => m);

    const inactive = members.filter(member => {
      const userData = guildData[member.id];

      if (!userData) return true;

      const lastActive = userData.joinedAt || userData.lastLeaveAt || userData.lastJoinAt;
      if (!lastActive) return true;

      return lastActive < cutoff;
    });

    const text = inactive.length
      ? inactive
          .slice(0, 50)
          .map(member => {
            const userData = guildData[member.id];
            const lastActive = userData
              ? formatDate(userData.joinedAt || userData.lastLeaveAt || userData.lastJoinAt)
              : '기록 없음';

            return `- ${member.displayName} / 마지막 음성: ${lastActive}`;
          })
          .join('\n')
      : `${days}일 이상 미접속자가 없습니다.`;

    await interaction.reply(
      `📅 ${days}일 이상 음성 미접속자\n\n${text}`
    );

    return;
  }
});

client.login(process.env.DISCORD_TOKEN);
