import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

// ─── Rotation pools ──────────────────────────────────────────────────────────

const USER_AGENTS = [
  // Chrome – Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  // Chrome – macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  // Chrome – Linux
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  // Firefox – Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  // Firefox – macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:126.0) Gecko/20100101 Firefox/126.0",
  // Edge – Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  // Safari – macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
] as const;

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
] as const;

// ─── Options ─────────────────────────────────────────────────────────────────

export interface PlaywrightScraperOptions {
  headless?: boolean;
  /** Number of retry attempts after the first failure (default: 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1 000) */
  baseBackoffMs?: number;
  /** Navigation timeout in ms (default: 30 000) */
  navigationTimeoutMs?: number;
}

// ─── Abstract base ────────────────────────────────────────────────────────────

/**
 * Abstract base class for Playwright-based scrapers.
 *
 * Subclasses implement `scrapeUrl(page, url): Promise<T>` and get:
 *   - Shared headless Chromium browser instance (lazy-initialised, auto-reconnected)
 *   - Random user-agent + viewport per request
 *   - Exponential backoff retry with full jitter
 *   - Automatic context/page cleanup on every attempt
 */
export abstract class PlaywrightScraper<T = unknown> {
  private readonly headless: boolean;
  protected readonly maxRetries: number;
  protected readonly baseBackoffMs: number;
  protected readonly navigationTimeoutMs: number;
  private browser: Browser | null = null;

  constructor(opts: PlaywrightScraperOptions = {}) {
    this.headless = opts.headless ?? true;
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseBackoffMs = opts.baseBackoffMs ?? 1_000;
    this.navigationTimeoutMs = opts.navigationTimeoutMs ?? 30_000;
  }

  /**
   * Implement the actual scraping logic. Called inside a fresh browser context
   * on every attempt; the page is closed automatically after this resolves/rejects.
   */
  protected abstract scrapeUrl(page: Page, url: string): Promise<T>;

  /**
   * Scrape `url` with automatic retries and exponential backoff.
   * Throws the last error if all attempts are exhausted.
   */
  async scrape(url: string): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const base = this.baseBackoffMs * 2 ** (attempt - 1);
        // full jitter: uniform in [0, base]
        const delay = Math.random() * base;
        console.log(
          `[${this.constructor.name}] retry ${attempt}/${this.maxRetries} in ${Math.round(delay)}ms — ${url}`,
        );
        await sleep(delay);
      }

      const ctx = await this.createContext();
      const page = await ctx.newPage();

      try {
        page.setDefaultNavigationTimeout(this.navigationTimeoutMs);
        return await this.scrapeUrl(page, url);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          `[${this.constructor.name}] attempt ${attempt + 1} failed: ${lastError.message}`,
        );
      } finally {
        await page.close().catch(() => undefined);
        await ctx.close().catch(() => undefined);
      }
    }

    throw lastError ?? new Error(`All ${this.maxRetries + 1} attempts failed for ${url}`);
  }

  /** Release the shared browser. Call during worker shutdown. */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async getBrowser(): Promise<Browser> {
    if (!this.browser?.isConnected()) {
      this.browser = await chromium.launch({
        headless: this.headless,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-extensions",
        ],
      });
    }
    return this.browser;
  }

  private async createContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const userAgent = randomPick(USER_AGENTS);
    const viewport = randomPick(VIEWPORTS);

    return browser.newContext({
      userAgent,
      viewport,
      locale: "en-US",
      timezoneId: "America/New_York",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        DNT: "1",
      },
    });
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function randomPick<T>(arr: readonly T[]): T {
  if (arr.length === 0) throw new RangeError("Cannot pick from an empty array");
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
