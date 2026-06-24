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

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior
} from '@discordjs/voice';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_IDS = ['1506990201204117565'];
const DATA_FILE = './voiceData.json';

const KAKUM_ALERT_MS = 5 * 1000; // 테스트용 5초. 성공하면 80 * 1000 으로 바꾸기

const kakumTimers = new Map();

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

function makeKakumEmbed(status, detail) {
  return new EmbedBuilder()
    .setTitle('📢 카쿰 단체유혹 타이머')
    .setDescription(
      `상태: **${status}**\n\n${detail}\n\n` +
      `첫 유혹 맞고 나서 **시작/리셋** 누르기\n` +
      `효과음 테스트는 현재 5초 뒤 울림`
    )
    .setColor(0x9b59b6);
}

function makeKakumButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('kakum_start')
      .setLabel('시작/리셋')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('kakum_stop')
      .setLabel('종료')
      .setEmoji('⏹️')
      .setStyle(ButtonStyle.Danger)
  );
}

function clearKakumTimer(guildId) {
  const old = kakumTimers.get(guildId);
  if (!old) return;

  if (old.alertTimeout) clearTimeout(old.alertTimeout);

  try {
    if (old.connection) old.connection.destroy();
  } catch {}

  kakumTimers.delete(guildId);
}

async function playAlarm(connection) {
  console.log('카쿰 알람 재생 시도!');

  const alarmPath = path.join(__dirname, 'sounds', 'alarm.mp3');

  if (!fs.existsSync(alarmPath)) {
    console.log('alarm.mp3 파일이 없습니다:', alarmPath);
    return;
  }

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10000);
    console.log('음성 연결 준비 완료');

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play
      }
    });

    const resource = createAudioResource(alarmPath, {
      inlineVolume: true
    });

    resource.volume?.setVolume(1.5);

    connection.subscribe(player);
    player.play(resource);

    player.on(AudioPlayerStatus.Playing, () => {
      console.log('효과음 재생중!');
    });

    player.on(AudioPlayerStatus.Idle, () => {
      console.log('효과음 재생 끝!');
    });

    player.on('error', error => {
      console.error('효과음 재생 오류:', error);
    });
  } catch (error) {
    console.error('음성 연결/재생 실패:', error);
  }
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
    .setName('카쿰타이머')
    .setDescription('카쿰 단체유혹 타이머 버튼을 생성합니다')
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
      const guildId = interaction.guildId;

      if (interaction.customId === 'kakum_start') {
        const voiceChannel = interaction.member.voice.channel;

        if (!voiceChannel) {
          await interaction.reply({
            content: '먼저 음성채널에 들어가 있어야 봇이 그 방으로 들어갈 수 있어!',
            ephemeral: true
          });
          return;
        }

        clearKakumTimer(guildId);

        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guild.id,
          adapterCreator: interaction.guild.voiceAdapterCreator,
          selfDeaf: false
        });

        const alertTimeout = setTimeout(async () => {
          await playAlarm(connection);

          try {
            await interaction.message.edit({
              embeds: [
                makeKakumEmbed(
                  '🔔 알림 울림',
                  '단체유혹 10초 전 알림이야! 유혹 맞고 나면 다시 시작/리셋 눌러줘.'
                )
              ],
              components: [makeKakumButtons()]
            });
          } catch (e) {
            console.error('카쿰 메시지 수정 오류:', e);
          }
        }, KAKUM_ALERT_MS);

        kakumTimers.set(guildId, {
          alertTimeout,
          connection
        });

        await interaction.update({
          embeds: [
            makeKakumEmbed(
              '작동중',
              '타이머 시작됨. 테스트라서 **5초 뒤** 효과음이 울려.'
            )
          ],
          components: [makeKakumButtons()]
        });

        return;
      }

      if (interaction.customId === 'kakum_stop') {
        clearKakumTimer(guildId);

        await interaction.update({
          embeds: [
            makeKakumEmbed(
              '대기중',
              '타이머 정지됨. 다시 시작하려면 시작/리셋 눌러줘.'
            )
          ],
          components: [makeKakumButtons()]
        });

        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;

    await interaction.deferReply();

    const guildId = interaction.guildId || SERVER_IDS[0];
    const data = loadData();

    if (interaction.commandName === '카쿰타이머') {
      await interaction.editReply({
        embeds: [
          makeKakumEmbed(
            '대기중',
            '첫 유혹 맞고 나서 시작/리셋 버튼을 눌러줘.'
          )
        ],
        components: [makeKakumButtons()]
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

      let guild = interaction.guild;

      if (!guild) {
        guild = client.guilds.cache.get(guildId);
      }

      if (!guild) {
        try {
          guild = await client.guilds.fetch(guildId);
        } catch {
          guild = null;
        }
      }

      if (!guild) {
        await interaction.editReply(
          '서버 정보를 못 불러왔어. 그래도 봇은 켜져 있어. 잠깐 뒤에 다시 해봐.'
        );
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

client.login(process.env.DISCORD_TOKEN);
