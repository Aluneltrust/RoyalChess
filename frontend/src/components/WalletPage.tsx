// ============================================================================
// WALLET PAGE — Balance, Send, Receive, History
// ============================================================================

import React, { useState, useEffect } from 'react';
import { PrivateKey } from '@bsv/sdk';
import { BSV_NETWORK, BACKEND_URL } from '../constants';
import { bsvWalletService, fetchBalance, bsvPriceService } from '../services';

interface WalletPageProps {
  onBack: () => void;
  walletPrivateKey: PrivateKey | null;
  walletAddress: string;
}

export default function WalletPage({ onBack, walletPrivateKey, walletAddress }: WalletPageProps) {
  const [balance, setBalance] = useState(0);
  const [activeTab, setActiveTab] = useState<'receive' | 'send' | 'buy' | 'history'>('receive');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'success' | 'error'>('info');
  const [sendAddress, setSendAddress] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [bsvPrice, setBsvPrice] = useState(50);
  const [buyAmount, setBuyAmount] = useState('5');

  useEffect(() => {
    refreshBalance();
    bsvPriceService.updatePrice().then(setBsvPrice);
  }, []);

  const refreshBalance = async () => {
    if (!walletAddress) return;
    setIsLoading(true);
    const bal = await fetchBalance(walletAddress);
    setBalance(bal);
    setIsLoading(false);
  };

  const showMsg = (msg: string, type: 'info' | 'success' | 'error') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(''), 5000);
  };

  const sendTransaction = async () => {
    if (!walletPrivateKey) { showMsg('No wallet', 'error'); return; }
    if (!sendAddress || !sendAmount) { showMsg('Enter address and amount', 'error'); return; }
    const amt = parseInt(sendAmount);
    if (isNaN(amt) || amt < 546) { showMsg('Min 546 sats', 'error'); return; }
    if (!/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(sendAddress)) { showMsg('Invalid address', 'error'); return; }

    setIsLoading(true);
    try {
      bsvWalletService.connect(walletPrivateKey.toWif());
      const result = await bsvWalletService.sendPayment(sendAddress, amt);
      if (result.success) {
        showMsg(`Sent! TX: ${result.txid?.slice(0, 16)}...`, 'success');
        setSendAddress(''); setSendAmount('');
        setTimeout(refreshBalance, 2000);
      } else {
        showMsg(`Failed: ${result.error}`, 'error');
      }
    } catch (err: any) { showMsg(err.message, 'error'); }
    setIsLoading(false);
  };

  const formatSats = (sats: number) => `${Math.abs(sats).toLocaleString()} sats`;
  const formatUSD = (sats: number) => {
    const usd = (Math.abs(sats) / 1e8) * bsvPrice;
    return `$${usd.toFixed(4)}`;
  };

  const exportKey = () => {
    if (!walletPrivateKey) return;
    const wif = walletPrivateKey.toWif();
    if (confirm('Your WIF will be shown. Never share it!\n\nCopy it to a safe place.')) {
      prompt('Your WIF (private key):', wif);
    }
  };

  return (
    <div className="wallet-page">
      <div className="wallet-container">
        <div className="wallet-header">
          <button className="btn btn-secondary" onClick={onBack}>← Back</button>
          <h1>💰 Wallet</h1>
        </div>

        <div className="balance-card">
          <div className="balance-label">Balance</div>
          <div className="balance-amount">{formatSats(balance)}</div>
          <div className="balance-usd">{formatUSD(balance)}</div>
          <button className="btn btn-tiny" onClick={refreshBalance} disabled={isLoading}>
            {isLoading ? '...' : '↻'} Refresh
          </button>
        </div>

        {message && <div className={`wallet-message ${messageType}`}>{message}</div>}

        <div className="wallet-tabs">
          {(['receive', 'send', 'buy', 'history'] as const).map(tab => (
            <button key={tab} className={`tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}>
              {tab === 'buy' ? '💵 Buy' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="tab-content">
          {activeTab === 'receive' && (
            <div className="receive-tab">
              <div className="address-label">Your BSV Address</div>
              <div className="address-box" onClick={() => {
                navigator.clipboard.writeText(walletAddress);
                showMsg('Address copied!', 'success');
              }}>
                <span className="address-text">{walletAddress}</span>
                <span className="copy-icon">📋</span>
              </div>
              <p className="address-hint">Click to copy. Send BSV here to fund your game wallet.</p>
              <div className="qr-section">
                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${walletAddress}`}
                  alt="QR" className="qr-image" />
              </div>
              <button className="btn btn-secondary" onClick={exportKey}>Export Private Key (WIF)</button>
              <p className="backup-warning">⚠️ Never share your WIF! Store it safely.</p>
            </div>
          )}

          {activeTab === 'send' && (
            <div className="send-tab">
              <div className="form-group">
                <label>Recipient Address</label>
                <input type="text" placeholder="1ABC... or 3XYZ..." value={sendAddress}
                  onChange={(e) => setSendAddress(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Amount (satoshis)</label>
                <input type="number" placeholder="10000" value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)} min="546" />
                <div className="amount-helpers">
                  {[10000, 50000, 100000].map(v => (
                    <button key={v} onClick={() => setSendAmount(String(v))}>{(v/1000)}k</button>
                  ))}
                  <button onClick={() => setSendAmount(String(Math.max(0, balance - 200)))}>Max</button>
                </div>
              </div>
              <button className="btn btn-primary" onClick={sendTransaction}
                disabled={isLoading || !sendAddress || !sendAmount || parseInt(sendAmount) < 546}>
                {isLoading ? 'Sending...' : 'Send BSV'}
              </button>
            </div>
          )}

          {activeTab === 'buy' && (
            <div className="buy-tab">
              <div className="buy-header">
                <h3>Buy BSV Instantly</h3>
                <p className="buy-subtitle">Send payment via PayPal, Venmo, or CashApp. BSV will be sent to your game wallet within minutes.</p>
              </div>

              <div className="buy-rate">
                <span>Current Rate:</span>
                <strong>1 BSV = ${bsvPrice.toFixed(2)}</strong>
              </div>

              <div className="buy-amount-section">
                <label>How much do you want to spend (USD)?</label>
                <div className="buy-amount-row">
                  <input type="number" placeholder="5" value={buyAmount}
                    onChange={(e) => setBuyAmount(e.target.value)} min="1" max="500" />
                  <span className="buy-estimate">
                    ≈ {((parseFloat(buyAmount || '0') / bsvPrice) * 1e8).toLocaleString(undefined, {maximumFractionDigits: 0})} sats
                  </span>
                </div>
                <div className="buy-presets">
                  {[5, 10, 25, 50].map(v => (
                    <button key={v} className={`buy-preset ${buyAmount === String(v) ? 'active' : ''}`}
                      onClick={() => setBuyAmount(String(v))}>${v}</button>
                  ))}
                </div>
              </div>

              <div className="buy-methods">
                <h4>Payment Methods</h4>

                <div className="pay-method">
                  <div className="pay-icon">🅿️</div>
                  <div className="pay-details">
                    <strong>PayPal</strong>
                    <span className="pay-handle" onClick={() => {
                      navigator.clipboard.writeText('comingsoon@email.com');
                      showMsg('PayPal email copied!', 'success');
                    }}>coming-soon@email.com 📋</span>
                  </div>
                </div>

                <div className="pay-method">
                  <div className="pay-icon">💜</div>
                  <div className="pay-details">
                    <strong>Venmo</strong>
                    <span className="pay-handle" onClick={() => {
                      navigator.clipboard.writeText('@ComingSoon');
                      showMsg('Venmo handle copied!', 'success');
                    }}>@Coming-soon📋</span>
                  </div>
                </div>

                <div className="pay-method">
                  <div className="pay-icon">💚</div>
                  <div className="pay-details">
                    <strong>CashApp</strong>
                    <span className="pay-handle" onClick={() => {
                      navigator.clipboard.writeText('$ComingSoon');
                      showMsg('CashApp tag copied!', 'success');
                    }}>$Coming-soon 📋</span>
                  </div>
                </div>
              </div>

              <div className="buy-methods crypto-methods">
                <h4>🪙 Stablecoin (USDT / USDC)</h4>
                <p className="crypto-subtitle">Send stablecoins directly — instant, no bank needed. BSV sent to your wallet automatically.</p>

                <div className="pay-method crypto-method">
                  <div className="pay-icon">🔷</div>
                  <div className="pay-details">
                    <strong>Ethereum (ERC-20)</strong>
                    <span className="pay-handle" onClick={() => {
                      navigator.clipboard.writeText('0xYOUR_ETH_ADDRESS_HERE');
                      showMsg('ETH address copied!', 'success');
                    }}>0xYOUR_ETH_ADDRESS_HERE 📋</span>
                    <span className="network-tag">USDT · USDC</span>
                  </div>
                </div>

                <div className="pay-method crypto-method">
                  <div className="pay-icon">🔴</div>
                  <div className="pay-details">
                    <strong>Tron (TRC-20)</strong>
                    <span className="pay-handle" onClick={() => {
                      navigator.clipboard.writeText('YOUR_TRON_ADDRESS_HERE');
                      showMsg('Tron address copied!', 'success');
                    }}>YOUR_TRON_ADDRESS_HERE 📋</span>
                    <span className="network-tag">USDT · Lowest fees</span>
                  </div>
                </div>

                <div className="pay-method crypto-method">
                  <div className="pay-icon">🟡</div>
                  <div className="pay-details">
                    <strong>BNB Smart Chain (BEP-20)</strong>
                    <span className="pay-handle" onClick={() => {
                      navigator.clipboard.writeText('0xYOUR_BSC_ADDRESS_HERE');
                      showMsg('BSC address copied!', 'success');
                    }}>0xYOUR_BSC_ADDRESS_HERE 📋</span>
                    <span className="network-tag">USDT · USDC</span>
                  </div>
                </div>

                <div className="crypto-note">
                  ⚡ Send <strong>${buyAmount || '?'}</strong> in USDT or USDC on any network above. Include your BSV address in the memo/note if possible — otherwise BSV is sent to your game wallet automatically.
                </div>
              </div>

              <div className="buy-instructions">
                <h4>How it works</h4>
                <ol>
                  <li>Send <strong>${buyAmount || '?'}</strong> to any of the above</li>
                  <li>Include your wallet address in the payment note:<br/>
                    <code className="wallet-addr-code" onClick={() => {
                      navigator.clipboard.writeText(walletAddress);
                      showMsg('Address copied!', 'success');
                    }}>{walletAddress} 📋</code>
                  </li>
                  <li>BSV will be sent to your wallet within minutes</li>
                </ol>
              </div>

              <div className="buy-disclaimer">
                ⚠️ Manual process — please allow up to 30 minutes during business hours. For large amounts ($50+), response may take longer.
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="history-tab">
              <p className="no-history">
                View your transactions on{' '}
                <a href={`https://whatsonchain.com/address/${walletAddress}`} target="_blank" rel="noopener">
                  WhatsOnChain ↗
                </a>
              </p>
            </div>
          )}
        </div>

        <div className="wallet-footer">
          <span>{BSV_NETWORK === 'main' ? '🟢 Mainnet' : '🟡 Testnet'}</span>
          <span>BSV: ${bsvPrice.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}