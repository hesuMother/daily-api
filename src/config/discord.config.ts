export interface DiscordSettings {
  enabled: boolean;
  reportWebhookUrl: string;
  contactWebhookUrl: string;
}

export function discordSettings(raw: Record<string, unknown>): DiscordSettings {
  const flag = raw.DISCORD_NOTIFICATIONS_ENABLED ?? 'false';
  if (flag !== 'true' && flag !== 'false')
    throw new Error('DISCORD_NOTIFICATIONS_ENABLED must be true or false');
  function webhook(key: string): string {
    const value = raw[key];
    if (value === undefined || value === '') {
      if (flag === 'true')
        throw new Error(
          key + ' is required when Discord notifications are enabled',
        );
      return '';
    }
    // Never include the webhook value in configuration errors: its path is a credential.
    try {
      if (typeof value !== 'string') throw new Error();
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'discord.com' ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/api\/(?:v\d+\/)?webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname)
      )
        throw new Error();
      return url.href;
    } catch {
      throw new Error(key + ' must be a Discord HTTPS webhook URL');
    }
  }
  return {
    enabled: flag === 'true',
    reportWebhookUrl: webhook('DISCORD_REPORT_WEBHOOK_URL'),
    contactWebhookUrl: webhook('DISCORD_CONTACT_WEBHOOK_URL'),
  };
}
