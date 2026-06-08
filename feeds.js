const Parser = require('rss-parser');
const { EmbedBuilder } = require('discord.js');

const parser = new Parser({
  timeout: 20000,
  headers: {
    'User-Agent': 'GOST Social Bot',
    Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
  },
});

function trim(text, max) {
  const value = String(text ?? '').trim();
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function normalizeUrl(input) {
  const value = String(input ?? '').trim();
  if (!value) return null;
  try {
    if (/^https?:\/\//i.test(value)) return new URL(value);
    return new URL(`https://${value}`);
  } catch {
    return null;
  }
}

function extractChannelIdFromHtml(html) {
  const patterns = [
    /"channelId":"(UC[a-zA-Z0-9_-]{20,})"/,
    /"externalId":"(UC[a-zA-Z0-9_-]{20,})"/,
    /"browseId":"(UC[a-zA-Z0-9_-]{20,})"/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function extractVideoId(source) {
  const value = String(source ?? '');
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /yt:video:([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function extractFirstImage(html) {
  const value = String(html ?? '');
  const match = value.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] || null;
}

async function resolveYouTubeFeedUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('YouTube URL is empty.');
  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(raw)) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${raw}`;
  }
  if (/feeds\/videos\.xml\?channel_id=/i.test(raw)) return raw;

  const url = normalizeUrl(raw);
  if (!url) throw new Error('Invalid YouTube URL.');

  const channelIdFromQuery = url.searchParams.get('channel_id');
  if (channelIdFromQuery) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelIdFromQuery}`;
  }

  const channelPathMatch = url.pathname.match(/^\/channel\/(UC[a-zA-Z0-9_-]{20,})/i);
  if (channelPathMatch?.[1]) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelPathMatch[1]}`;
  }

  const handleMatch = url.pathname.match(/^\/@([^/]+)/);
  if (handleMatch) {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GOST Social Bot)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!response.ok) throw new Error(`Could not open the YouTube channel page (HTTP ${response.status}).`);
    const html = await response.text();
    const channelId = extractChannelIdFromHtml(html);
    if (!channelId) throw new Error('Could not detect the YouTube channel ID from that link.');
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  }
  throw new Error('Unsupported YouTube URL format.');
}

function resolveBloggerFeedUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('Blogger URL is empty.');
  const url = normalizeUrl(raw);
  if (!url) throw new Error('Invalid Blogger URL.');
  if (/\/feeds\/posts\/default/i.test(url.pathname)) return url.toString();
  return `${url.origin}/feeds/posts/default?alt=rss&max-results=10`;
}

function getItemLink(item) {
  if (!item) return '';
  if (typeof item.link === 'string' && item.link.trim()) return item.link.trim();
  if (item.link && typeof item.link === 'object' && typeof item.link.href === 'string') return item.link.href.trim();
  if (typeof item.guid === 'string' && item.guid.trim()) return item.guid.trim();
  if (typeof item.id === 'string' && item.id.trim()) return item.id.trim();
  return '';
}

function getItemDate(item) {
  if (!item) return 0;
  const raw = item.isoDate || item.pubDate || item.published || item.updated || item.date || null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}

function sortItems(items) {
  return [...items].sort((a, b) => getItemDate(b) - getItemDate(a));
}

function buildYouTubeEmbed(item, sourceName) {
  const title = trim(item?.title || sourceName || 'New YouTube Video', 256);
  const link = getItemLink(item);
  const videoId = extractVideoId(link || item?.id || '');
  const thumbnail = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setURL(link || null)
    .setColor(0xff0000)
    .setFooter({ text: 'GOST Social • YouTube' })
    .setTimestamp(new Date(getItemDate(item) || Date.now()));

  if (thumbnail) embed.setThumbnail(thumbnail);
  return embed;
}

function buildBloggerEmbed(item, sourceName) {
  const title = trim(item?.title || sourceName || 'New Blog Post', 256);
  const link = getItemLink(item);
  const content = item?.content || item?.contentSnippet || '';
  const image = extractFirstImage(content);

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setURL(link || null)
    .setColor(0xf57c00)
    .setFooter({ text: 'GOST Social • Blogger' })
    .setTimestamp(new Date(getItemDate(item) || Date.now()));

  if (image) embed.setImage(image);
  return embed;
}

module.exports = {
  parser,
  resolveYouTubeFeedUrl,
  resolveBloggerFeedUrl,
  getItemLink,
  sortItems,
  buildYouTubeEmbed,
  buildBloggerEmbed,
};
