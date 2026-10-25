// Blockchain check — kisi bhi provider se (TronGrid / Ankr / QuickNode / NOWNodes / apna node).
//   Tron:  java-tron HTTP API (TronGrid wahi deta hai): /wallet/gettransactioninfobyid, /wallet/getnowblock
//   BSC / Polygon: EVM JSON-RPC: eth_getTransactionReceipt, eth_blockNumber, eth_getBlockByNumber
const { tronToHex, hexToTron } = require('./addr');

const TRANSFER = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const CHAINS = {
  trc20: { key: 'trc20', kind: 'tron', label: 'USDT · TRC20', chain: 'Tron (TRC20)', token: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6, chainId: null, explorer: 'https://tronscan.org/#/transaction/', fee: 'Fees TRX mein lagti hai', txHint: '64 characters (0-9, a-f)' },
  bep20: { key: 'bep20', kind: 'evm', label: 'USDT · BEP20', chain: 'BNB Smart Chain (BEP20)', token: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, chainId: 56, explorer: 'https://bscscan.com/tx/', fee: 'Fees BNB mein lagti hai', txHint: '0x se shuru, 66 characters' },
  polygon: { key: 'polygon', kind: 'evm', label: 'USDT · Polygon', chain: 'Polygon PoS', token: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, chainId: 137, explorer: 'https://polygonscan.com/tx/', fee: 'Fees POL mein lagti hai', txHint: '0x se shuru, 66 characters' },
};

function toMicro(value, decimals) {
  const v = BigInt(value);
  return Number(decimals >= 6 ? v / 10n ** BigInt(decimals - 6) : v * 10n ** BigInt(6 - decimals));
}

async function post(cfg, path, body) {
  if (!cfg.url) throw new Error('Provider URL set nahi hai');
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (cfg.header && cfg.key) headers[cfg.header] = cfg.key;
  const res = await fetch(cfg.url.replace(/\/+$/, '') + path, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  let d; try { d = JSON.parse(text); } catch { throw new Error(`Provider ka jawab samajh nahi aaya (HTTP ${res.status}) ${text.slice(0, 80)}`); }
  if (!res.ok) throw new Error(d?.Error || d?.error?.message || d?.message || `HTTP ${res.status}`);
  return d;
}
let rid = 1;
async function rpc(cfg, method, params) {
  const d = await post(cfg, '', { jsonrpc: '2.0', id: rid++, method, params });
  if (d.error) throw new Error(d.error.message || 'RPC error');
  return d.result;
}

// ---------- Tron ----------
async function tronHead(cfg) {
  const b = await post(cfg, '/wallet/getnowblock', {});
  const n = b?.block_header?.raw_data?.number;
  if (!Number.isFinite(n)) throw new Error('Ye Tron provider nahi lagta (getnowblock mein block number nahi)');
  return n;
}
async function tronCheck(cfg, txid, address) {
  const info = await post(cfg, '/wallet/gettransactioninfobyid', { value: txid });
  if (!info || !info.id) return { found: false };
  if (info.blockNumber && !info.blockTimeStamp) throw new Error('Tron block ka time nahi mila');
  if (info.receipt?.result && info.receipt.result !== 'SUCCESS') return { found: true, failed: true };
  const tokenHex = tronToHex(CHAINS.trc20.token), toHex = tronToHex(address);
  let micro = 0, from = '';
  for (const log of info.log || []) {
    if (String(log.address).toLowerCase().replace(/^41/, '') !== tokenHex) continue;
    if (!log.topics || log.topics[0] !== TRANSFER || log.topics[2].slice(-40).toLowerCase() !== toHex) continue;
    micro += toMicro('0x' + log.data, 6);
    from = hexToTron(log.topics[1].slice(-40));
  }
  const head = info.blockNumber ? await tronHead(cfg) : 0;
  return { found: true, micro, from, ts: info.blockTimeStamp || 0, confirmations: info.blockNumber ? Math.max(0, head - info.blockNumber + 1) : 0 };
}

// ---------- EVM ----------
async function evmCheck(cfg, net, txid, address) {
  const r = await rpc(cfg, 'eth_getTransactionReceipt', [txid]);
  if (!r) return { found: false };
  if (r.status !== '0x1') return { found: true, failed: true };
  let micro = 0, from = '';
  for (const l of r.logs || []) {
    if (l.address.toLowerCase() !== net.token.toLowerCase() || l.topics[0] !== '0x' + TRANSFER) continue;
    if (l.topics[2].slice(-40).toLowerCase() !== address.toLowerCase().slice(2)) continue;
    micro += toMicro(l.data, net.decimals); from = '0x' + l.topics[1].slice(-40);
  }
  const [head, blk] = await Promise.all([rpc(cfg, 'eth_blockNumber', []), rpc(cfg, 'eth_getBlockByNumber', [r.blockNumber, false])]);
  const ts = blk && blk.timestamp ? parseInt(blk.timestamp, 16) * 1000 : 0;
  if (!ts) throw new Error('Block ka time nahi mila');   // bina time ke "purana tx" check nahi ho sakta
  return { found: true, micro, from, ts, confirmations: Math.max(0, parseInt(head, 16) - parseInt(r.blockNumber, 16) + 1) };
}

function check(netKey, cfg, txid, address) {
  const net = CHAINS[netKey];
  return net.kind === 'tron' ? tronCheck(cfg, txid, address) : evmCheck(cfg, net, txid, address);
}
const txValid = (netKey, tx) => (CHAINS[netKey].kind === 'tron' ? /^[0-9a-f]{64}$/.test(tx) : /^0x[0-9a-f]{64}$/.test(tx));
const normTx = (netKey, tx) => { let t = String(tx || '').trim().toLowerCase(); if (CHAINS[netKey].kind === 'tron') t = t.replace(/^0x/, ''); return t; };

// Admin "Test" button
async function test(netKey, cfg) {
  const net = CHAINS[netKey], t0 = Date.now();
  if (net.kind === 'tron') return { block: await tronHead(cfg), ms: Date.now() - t0 };
  const [chainId, head] = await Promise.all([rpc(cfg, 'eth_chainId', []), rpc(cfg, 'eth_blockNumber', [])]);
  if (parseInt(chainId, 16) !== net.chainId) throw new Error(`Ye provider galat chain ka hai (chainId ${parseInt(chainId, 16)}, chahiye ${net.chainId})`);
  return { block: parseInt(head, 16), ms: Date.now() - t0 };
}

module.exports = { CHAINS, check, txValid, normTx, test, toMicro };
