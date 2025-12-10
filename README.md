# ANNOYING COIN 😤

The most annoying coin launcher on Solana. Every time someone buys the monitored token, we automatically launch a new annoying coin on pump.fun!

## Setup

1. **Clone and install:**
```bash
git clone <your-repo>
cd annoying-coin
npm install
```

2. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your settings
```

3. **Add wallets for rotation:**
   - Generate multiple Solana wallets
   - Fund each with at least 0.1 SOL
   - Add private keys to `.env` as `WALLET_1`, `WALLET_2`, etc.

4. **Add token image:**
   - Place an image at `public/annoying.png` (recommended: 500x500px)
   - This image will be used for all launched tokens

5. **Set target CA:**
   - Set `TARGET_CA` in `.env` to the token you want to monitor

6. **Run locally:**
```bash
npm start
```

## Deploy to Railway

1. Push to GitHub
2. Connect repo to Railway
3. Add environment variables in Railway dashboard:
   - `RPC_ENDPOINT`
   - `TARGET_CA`
   - `WALLET_1`, `WALLET_2`, etc.
   - Other optional settings

Railway will auto-deploy on push.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RPC_ENDPOINT` | Yes | Solana RPC URL (paid recommended) |
| `TARGET_CA` | Yes | Token CA to monitor for buys |
| `WALLET_1` | Yes | First wallet private key (base58) |
| `WALLET_2+` | No | Additional wallets for rotation |
| `DEV_BUY_SOL` | No | SOL amount for dev buy (default: 0.01) |
| `PRIORITY_FEE` | No | Priority fee in SOL (default: 0.0005) |
| `LAUNCH_COOLDOWN_MS` | No | Cooldown between launches (default: 30000) |
| `TOKEN_NAME` | No | Override token name |
| `TOKEN_SYMBOL` | No | Override token symbol |

## Wallet Rotation

The system rotates through all configured wallets to:
- Spread launches across multiple addresses
- Help avoid potential blacklisting
- Distribute SOL costs

Add multiple funded wallets for best results!

## API Endpoints

- `GET /api/status` - Current status and wallet info
- `GET /api/launches` - Recent launch history

## How It Works

1. Server monitors the target CA for buy transactions
2. When a buy is detected, cooldown is checked
3. If clear, picks next wallet in rotation
4. Generates annoying token name/symbol
5. Uploads metadata to pump.fun IPFS
6. Creates and launches token via PumpPortal
7. Logs transaction and continues monitoring

Built with pure annoyance 😤
