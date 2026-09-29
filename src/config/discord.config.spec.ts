import { discordSettings } from './discord.config';

describe('Discord configuration', () => {
  it('defaults to disabled without credentials', () => {
    expect(discordSettings({}).enabled).toBe(false);
  });
  it('requires both destinations when enabled', () => {
    expect(() =>
      discordSettings({ DISCORD_NOTIFICATIONS_ENABLED: 'true' }),
    ).toThrow('DISCORD_REPORT_WEBHOOK_URL');
  });
  it.each([
    'http://discord.com/api/webhooks/1/token',
    'https://example.com/api/webhooks/1/token',
    'https://discord.com@evil.test/api/webhooks/1/token',
    'https://discord.com/api/webhooks/1/token?secret=private',
  ])('rejects unsafe URL without exposing secrets: %s', (url) => {
    expect(() => discordSettings({ DISCORD_REPORT_WEBHOOK_URL: url })).toThrow(
      'DISCORD_REPORT_WEBHOOK_URL must be a Discord HTTPS webhook URL',
    );
  });
  it('accepts standard Discord webhook destinations', () => {
    expect(
      discordSettings({
        DISCORD_NOTIFICATIONS_ENABLED: 'true',
        DISCORD_REPORT_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/fake',
        DISCORD_CONTACT_WEBHOOK_URL:
          'https://discord.com/api/v10/webhooks/456/fake',
      }).enabled,
    ).toBe(true);
  });
});
