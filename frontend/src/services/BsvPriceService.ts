// ============================================================================
// BSV CHESS - Price Service
// ============================================================================

import { BSV_NETWORK } from '../constants';

export interface PriceData {
  bsvUsd: number;
  updatedAt: Date;
  source: string;
}

class BSVPriceService {
  private currentPrice: number = 0;
  private lastUpdate: Date = new Date(0);
  private updateInterval: ReturnType<typeof setInterval> | null = null;
  private readonly CACHE_DURATION_MS = 60000;

  private readonly PRICE_SOURCES = [
    {
      name: 'WhatsOnChain',
      url: 'https://api.whatsonchain.com/v1/bsv/main/exchangerate',
      parse: (data: any) => data.rate,
    },
    {
      name: 'CoinGecko',
      url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash-sv&vs_currencies=usd',
      parse: (data: any) => data['bitcoin-cash-sv']?.usd,
    },
  ];

  startAutoUpdate(intervalMs: number = 60000): void {
    this.updatePrice();
    this.updateInterval = setInterval(() => this.updatePrice(), intervalMs);
  }

  stopAutoUpdate(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  async updatePrice(): Promise<number> {
    for (const source of this.PRICE_SOURCES) {
      try {
        const response = await fetch(source.url);
        if (!response.ok) continue;
        const data = await response.json();
        const price = source.parse(data);
        if (price && price > 0) {
          this.currentPrice = price;
          this.lastUpdate = new Date();
          return price;
        }
      } catch {
        continue;
      }
    }

    if (this.currentPrice === 0) {
      this.currentPrice = 50;
    }
    return this.currentPrice;
  }

  async getPrice(): Promise<PriceData> {
    const now = new Date();
    const cacheAge = now.getTime() - this.lastUpdate.getTime();
    if (cacheAge > this.CACHE_DURATION_MS || this.currentPrice === 0) {
      await this.updatePrice();
    }
    return {
      bsvUsd: this.currentPrice,
      updatedAt: this.lastUpdate,
      source: 'cached',
    };
  }

  getPriceSync(): number {
    return this.currentPrice > 0 ? this.currentPrice : 50;
  }

  centsToSats(cents: number): number {
    const price = this.getPriceSync();
    const dollars = cents / 100;
    const bsvAmount = dollars / price;
    return Math.ceil(bsvAmount * 100_000_000);
  }

  satsToCents(sats: number): number {
    const price = this.getPriceSync();
    const bsvAmount = sats / 100_000_000;
    const dollars = bsvAmount * price;
    return Math.round(dollars * 100 * 100) / 100;
  }

  formatSats(sats: number): string {
    return sats.toLocaleString() + ' sats';
  }

  satsToUsd(sats: number): string {
    const usd = (sats / 1e8) * this.getPriceSync();
    return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
  }

  getPriceDisplay(): string {
    return `$${this.getPriceSync().toFixed(2)}`;
  }
}

export const bsvPriceService = new BSVPriceService();