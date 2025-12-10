# ANNOYING COIN 😤

The most annoying coin launcher on Solana. Every time someone buys the monitored token (above minimum threshold), we automatically launch a new annoying coin on pump.fun!

## Features

- **Auto-launch coins** when buys are detected on target CA
- **Minimum buy filter** (default 0.15 SOL) to prevent spam
- **Auto-generate wallets** from a master wallet
- **5 launches per wallet** then generates a new one
- **Persistent stats** - survives restarts
- **Annoying web UI** with live updates

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

3. **Fund your master wallet:**
   - Create a Solana wallet
   - Add the private key (base58) to `.env` as `MASTER_WALLET`
   - Fund it with SOL (system uses ~0.3 SOL per child wallet)

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
   - `RPC_ENDPOINT` - Use a paid RPC (Helius, QuickNode)
   - `TARGET_CA` - Token to monitor
   - `MASTER_WALLET` - Your funded wallet private key
   - Other optional settings

Railway will auto-deploy on push.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_ENDPOINT` | Yes | - | Solana RPC URL (paid recommended) |
| `TARGET_CA` | Yes | - | Token CA to monitor for buys |
| `MASTER_WALLET` | Yes | - | Master wallet private key (base58) |
| `MIN_BUY_SOL` | No | 0.15 | Min buy amount to trigger launch |
| `SOL_PER_WALLET` | No | 0.3 | SOL to transfer to each child wallet |
| `MAX_LAUNCHES_PER_WALLET` | No | 5 | Launches before generating new wallet |
| `MIN_MASTER_BALANCE` | No | 0.5 | SOL buffer to keep in master |
| `DEV_BUY_SOL` | No | 0.01 | SOL for dev buy on each launch |
| `PRIORITY_FEE` | No | 0.0005 | Priority fee in SOL |
| `LAUNCH_COOLDOWN_MS` | No | 30000 | Cooldown between launches (ms) |
| `TOKEN_NAME` | No | Random | Override token name |
| `TOKEN_SYMBOL` | No | Random | Override token symbol |

## How Wallet Rotation Works

1. You fund ONE master wallet
2. On first launch, system generates a child wallet
3. Transfers 0.3 SOL from master to child
4. Uses child wallet to launch token
5. After 5 launches, generates new child wallet
6. Repeat!

This way:
- Your master wallet never directly launches tokens
- Child wallets are auto-generated (different addresses each time)
- Each child only launches 5 tokens
- Harder to track/blacklist

## Costs

Per launch: ~0.02-0.03 SOL (fees) + dev buy amount
Per wallet (5 launches): ~0.25-0.3 SOL total

## API Endpoints

- `GET /api/status` - Current status, wallet info, recent launches
- `GET /api/launches` - Launch history

## Data Persistence

Stats and wallet data are saved to `data/` directory:
- `data/stats.json` - Launch counts and history
- `data/wallets.json` - Generated child wallet keys

**Important:** The `data/` directory is gitignored. On Railway, data persists until redeployment.

Built with pure annoyance 😤
