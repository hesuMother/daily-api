import { RobotsTxtFile } from 'crawlee';
import { CrawlError } from './types/external-product';

export interface CrawlSitePolicy {
  /** Enabling a provider requires a review of the site's terms and permitted paths. */
  allowedOrigins: readonly string[];
  isAllowedPath(url: URL): boolean;
}

export function permittedUrl(value: string, policy: CrawlSitePolicy): string {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !policy.allowedOrigins.includes(url.origin) ||
      !policy.isAllowedPath(url)
    )
      throw new Error();
    url.hash = '';
    return url.href;
  } catch {
    throw new CrawlError('URL_NOT_ALLOWED', false);
  }
}

/** Per-batch cache. Use Crawlee's parser with plain fetch: no fingerprint-generating HTTP client. */
export class CrawlRobotsPolicy {
  private readonly files = new Map<string, Promise<RobotsTxtFile>>();
  async assertAllowed(url: string, signal: AbortSignal): Promise<void> {
    const robotsUrl = new URL('/robots.txt', url).href;
    let pending = this.files.get(robotsUrl);
    if (!pending) {
      pending = this.load(robotsUrl, signal);
      this.files.set(robotsUrl, pending);
      void pending.catch(() => this.files.delete(robotsUrl));
    }
    const file = await pending;
    if (!file.isAllowed(url, '*') || !file.isAllowed(url, 'Lightpanda'))
      throw new CrawlError('ROBOTS_DENIED', false);
  }
  private async load(url: string, signal: AbortSignal): Promise<RobotsTxtFile> {
    try {
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      });
      if (response.status === 404) {
        await response.body?.cancel();
        return RobotsTxtFile.from(url, '');
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error();
      }
      const body = await response.text();
      if (body.length > 512000) throw new Error();
      return RobotsTxtFile.from(url, body);
    } catch {
      throw new CrawlError('ROBOTS_DENIED', false);
    }
  }
}
