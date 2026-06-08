const crypto = require('crypto');
const {
  Client,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const config = require('./config');
const { ensureDataFile, loadData, saveData } = require('./storage');
const {
  parser,
  resolveYouTubeFeedUrl,
  resolveBloggerFeedUrl,
  getItemLink,
  sortItems,
  buildYouTubeEmbed,
  buildBloggerEmbed,
} = require('./feeds');

// ── Startup Validation ─────────────────────────────────────────────────────────

if (!config.token || !config.clientId) {
  console.error('❌ Missing BOT_TOKEN or CLIENT_ID in environment variables.');
  process.exit(1);
}

// ── State ──────────────────────────────────────────────────────────────────────

ensureDataFile();
let store = loadData();

/** @type {Map<string, {platform: string, sourceName: string, sourceUrl: string, feedUrl: string, userId: string, guildId: string, createdAt: number}>} */
const pendingAdds = new Map();
let polling = false;

// ── Constants ──────────────────────────────────────────────────────────────────

/** Pending session TTL: 10 minutes */
const PENDING_TTL_MS = 10 * 60 * 1000;

/** Permission denied message */
const NO_PERMISSION_MSG =
  '❌ You need the **Administrator** or **Manage Server** permission to use this command.';

// ── Pending Sessions Cleanup ───────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, draft] of pendingAdds.entries()) {
    if (now - draft.createdAt > PENDING_TTL_MS) {
      pendingAdds.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} expired pending session(s).`);
  }
}, PENDING_TTL_MS).unref();

// ── Permission Helper ──────────────────────────────────────────────────────────

function hasManagePermission(interaction) {
  const { member } = interaction;
  if (!member || !member.permissions) return false;
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

// ── Utility Functions ──────────────────────────────────────────────────────────

function saveStore() {
  saveData(store);
}

function createId() {
  return crypto.randomBytes(6).toString('hex');
}

function truncate(text, max) {
  const value = String(text ?? '').trim();
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

// ── RSS / Feed Helpers ─────────────────────────────────────────────────────────

async function sendSubscriptionItem(client, subscription, item) {
  const channel = await client.channels.fetch(subscription.channelId).catch(() => null);
  if (!channel || typeof channel.send !== 'function' || !channel.isTextBased()) {
    return false;
  }

  const embed =
    subscription.type === 'youtube'
      ? buildYouTubeEmbed(item, subscription.name)
      : buildBloggerEmbed(item, subscription.name);

  await channel.send({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });

  return true;
}

async function initializeSubscriptionLastItem(subscription) {
  try {
    const feed = await parser.parseURL(subscription.feedUrl);
    const items = sortItems(feed.items || []);
    if (items[0]) {
      subscription.lastItemLink = getItemLink(items[0]);
    }
  } catch (error) {
    console.error(
      `⚠️  Initialization failed for ${subscription.type} / ${subscription.name}:`,
      error.message
    );
  }
}

async function pollSubscriptions(client) {
  if (polling) return;
  polling = true;

  try {
    let changed = false;

    for (const subscription of store.subscriptions) {
      try {
        const feed = await parser.parseURL(subscription.feedUrl);
        const items = sortItems(feed.items || []);

        if (!items.length) {
          continue;
        }

        if (!subscription.lastItemLink) {
          subscription.lastItemLink = getItemLink(items[0]);
          changed = true;
          continue;
        }

        const index = items.findIndex(
          (item) => getItemLink(item) === subscription.lastItemLink
        );

        if (index <= 0) {
          const newest = getItemLink(items[0]);
          if (newest && newest !== subscription.lastItemLink) {
            subscription.lastItemLink = newest;
            changed = true;
          }
          continue;
        }

        const newItems = items.slice(0, index).reverse();
        for (const item of newItems.slice(-5)) {
          await sendSubscriptionItem(client, subscription, item);
        }

        const newest = getItemLink(items[0]);
        if (newest && newest !== subscription.lastItemLink) {
          subscription.lastItemLink = newest;
          changed = true;
        }
      } catch (error) {
        console.error(
          `⚠️  Polling failed for ${subscription.type} / ${subscription.name}:`,
          error.message
        );
      }
    }

    if (changed) {
      saveStore();
    }
  } finally {
    polling = false;
  }
}

// ── Embed / Menu Builders (Modified for Guild Isolation) ──────────────────────

function buildListEmbed(type, guildId) {
  const subs = store.subscriptions.filter((s) => s.type === type && s.guildId === guildId);
  const title =
    type === 'youtube' ? 'قنوات YouTube المحفوظة' : 'مدونات Blogger المحفوظة';
  const color = type === 'youtube' ? 0xff0000 : 0xf57c00;

  const embed = new EmbedBuilder().setTitle(title).setColor(color);

  if (!subs.length) {
    embed.setDescription('لا توجد عناصر محفوظة في هذا السيرفر بعد.');
    return embed;
  }

  embed.setDescription('هذه هي الاشتراكات المحفوظة حاليًا في هذا السيرفر:');

  const fields = subs.slice(0, 25).map((sub, index) => ({
    name: `${index + 1}. ${sub.name}`,
    value: `المصدر: ${sub.sourceUrl}\nقناة النشر: <#${sub.channelId}>`,
    inline: false,
  }));

  embed.addFields(fields);
  return embed;
}

function buildRemoveMenu(type, guildId) {
  const subs = store.subscriptions.filter((s) => s.type === type && s.guildId === guildId).slice(0, 25);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`remove:${type}`)
    .setPlaceholder(
      type === 'youtube' ? 'اختر قناة YouTube للحذف' : 'اختر مدونة Blogger للحذف'
    );

  menu.addOptions(
    subs.map((sub) => ({
      label: truncate(sub.name, 100),
      value: sub.id,
      description: truncate(sub.channelId ? `#${sub.channelId}` : 'No channel', 100),
    }))
  );

  return new ActionRowBuilder().addComponents(menu);
}

// ── Command Handlers ───────────────────────────────────────────────────────────

async function handleAddCommand(interaction, type) {
  const modal = new ModalBuilder()
    .setCustomId(`${type}:add_modal`)
    .setTitle(type === 'youtube' ? 'إضافة قناة YouTube' : 'إضافة مدونة Blogger');

  const nameInput = new TextInputBuilder()
    .setCustomId('source_name')
    .setLabel(type === 'youtube' ? 'اسم قناة YouTube' : 'اسم مدونة Blogger')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const urlInput = new TextInputBuilder()
    .setCustomId('source_url')
    .setLabel(
      type === 'youtube'
        ? 'رابط قناة YouTube أو رابط التغذية'
        : 'رابط مدونة Blogger'
    )
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(300);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(urlInput)
  );

  await interaction.showModal(modal);
}

async function handleListCommand(interaction, type) {
  const embed = buildListEmbed(type, interaction.guildId);
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleRemoveCommand(interaction, type) {
  const subs = store.subscriptions.filter((s) => s.type === type && s.guildId === interaction.guildId);

  if (!subs.length) {
    await interaction.reply({ content: 'لا توجد عناصر لحذفها في هذا السيرفر.', ephemeral: true });
    return;
  }

  const row = buildRemoveMenu(type, interaction.guildId);
  await interaction.reply({
    content: 'اختر العنصر الذي تريد حذفه:',
    components: [row],
    ephemeral: true,
  });
}

async function handlePlatformCommand(interaction, type) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'add') return handleAddCommand(interaction, type);
  if (subcommand === 'list') return handleListCommand(interaction, type);
  if (subcommand === 'remove') return handleRemoveCommand(interaction, type);
}

// ── Discord Client ─────────────────────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`   Serving ${client.guilds.cache.size} guild(s).`);

  for (const subscription of store.subscriptions) {
    if (subscription.lastItemLink === undefined) {
      await initializeSubscriptionLastItem(subscription);
    }
  }
  saveStore();

  await pollSubscriptions(client);
  setInterval(() => pollSubscriptions(client), config.pollIntervalMs);
  console.log(`🔄 RSS polling started (every ${config.pollIntervalMs / 1000}s).`);
});

// ── Interaction Handler ────────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!hasManagePermission(interaction)) {
        await interaction.reply({ content: NO_PERMISSION_MSG, ephemeral: true });
        return;
      }

      if (interaction.commandName === 'youtube') {
        await handlePlatformCommand(interaction, 'youtube');
        return;
      }

      if (interaction.commandName === 'blogger') {
        await handlePlatformCommand(interaction, 'blogger');
        return;
      }

      return;
    }

    if (interaction.isModalSubmit()) {
      if (!hasManagePermission(interaction)) {
        await interaction.reply({ content: NO_PERMISSION_MSG, ephemeral: true });
        return;
      }

      const [platform, action] = interaction.customId.split(':');
      if (action !== 'add_modal' || !['youtube', 'blogger'].includes(platform)) {
        return;
      }

      const sourceName = interaction.fields.getTextInputValue('source_name').trim();
      const sourceUrl = interaction.fields.getTextInputValue('source_url').trim();

      if (!sourceName || !sourceUrl) {
        await interaction.reply({ content: 'البيانات غير مكتملة.', ephemeral: true });
        return;
      }

      let feedUrl;
      try {
        feedUrl =
          platform === 'youtube'
            ? await resolveYouTubeFeedUrl(sourceUrl)
            : resolveBloggerFeedUrl(sourceUrl);
      } catch (error) {
        await interaction.reply({
          content: `تعذر قراءة الرابط: ${error.message}`,
          ephemeral: true,
        });
        return;
      }

      const sessionId = createId();

      pendingAdds.set(sessionId, {
        platform,
        sourceName,
        sourceUrl,
        feedUrl,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        createdAt: Date.now(),
      });

      const row = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`add_channel:${sessionId}`)
          .setPlaceholder('اختر قناة النشر')
          .addChannelTypes(ChannelType.GuildText)
      );

      await interaction.reply({
        content: 'تم استلام البيانات. اختر الآن قناة النشر من القائمة:',
        components: [row],
        ephemeral: true,
      });
      return;
    }

    if (interaction.isChannelSelectMenu()) {
      if (!hasManagePermission(interaction)) {
        await interaction.reply({ content: NO_PERMISSION_MSG, ephemeral: true });
        return;
      }

      const [action, sessionId] = interaction.customId.split(':');
      if (action !== 'add_channel') return;

      const draft = pendingAdds.get(sessionId);

      if (!draft || draft.userId !== interaction.user.id) {
        await interaction.reply({
          content: '⚠️ هذه الجلسة غير صالحة أو منتهية الصلاحية. يرجى كتابة الأمر مجدداً.',
          ephemeral: true,
        });
        return;
      }

      if (Date.now() - draft.createdAt > PENDING_TTL_MS) {
        pendingAdds.delete(sessionId);
        await interaction.reply({
          content: '⚠️ انتهت مهلة الـ 10 دقائق المحددة للإعداد. يرجى المحاولة مجدداً.',
          ephemeral: true,
        });
        return;
      }

      const channelId = interaction.values[0];

      const duplicate = store.subscriptions.find(
        (s) =>
          s.type === draft.platform &&
          s.feedUrl === draft.feedUrl &&
          s.channelId === channelId &&
          s.guildId === interaction.guildId
      );

      if (duplicate) {
        duplicate.name = draft.sourceName;
        duplicate.sourceUrl = draft.sourceUrl;
        pendingAdds.delete(sessionId);
        saveStore();
        await interaction.update({
          content: `تم تحديث الاشتراك الموجود بالفعل بنجاح: **${draft.sourceName}**`,
          components: [],
        });
        return;
      }

      const subscription = {
        id: `${draft.platform}_${Date.now()}_${createId()}`,
        type: draft.platform,
        name: draft.sourceName,
        sourceUrl: draft.sourceUrl,
        feedUrl: draft.feedUrl,
        channelId,
        guildId: interaction.guildId,
        lastItemLink: null,
      };

      await initializeSubscriptionLastItem(subscription);

      store.subscriptions.push(subscription);
      pendingAdds.delete(sessionId);
      saveStore();

      await interaction.update({
        content: `تمت إضافة **${draft.sourceName}** بنجاح. سيتم الإرسال تلقائيًا إلى <#${channelId}>.`,
        components: [],
      });
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (!hasManagePermission(interaction)) {
        await interaction.reply({ content: NO_PERMISSION_MSG, ephemeral: true });
        return;
      }

      const [action, platform] = interaction.customId.split(':');
      if (action !== 'remove') return;

      const selectedId = interaction.values[0];
      const index = store.subscriptions.findIndex(
        (s) => s.id === selectedId && s.type === platform && s.guildId === interaction.guildId
      );

      if (index === -1) {
        await interaction.reply({
          content: 'العنصر المحدد غير موجود في هذا الخادم.',
          ephemeral: true,
        });
        return;
      }

      const removed = store.subscriptions.splice(index, 1)[0];
      saveStore();

      await interaction.update({
        content: `تم حذف **${removed.name}** بنجاح من هذا الخادم.`,
        components: [],
      });
    }
  } catch (error) {
    console.error('❌ Interaction error:', error);
    const errorMsg = 'حدث خطأ غير متوقع أثناء تنفيذ الأمر.';
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: errorMsg, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: errorMsg, ephemeral: true }).catch(() => {});
    }
  }
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error);
});

client.login(config.token);
