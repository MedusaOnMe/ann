import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { startMonitoring, stopMonitoring, getStatus } from './monitor.js';
import { getWalletStats } from './walletManager.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API Routes - v1.1
app.get('/api/status', async (req, res) => {
    const status = getStatus();
    const walletStats = await getWalletStats();
    res.json({
        ...status,
        wallets: walletStats
    });
});

app.get('/api/launches', (req, res) => {
    const status = getStatus();
    res.json({
        launches: status.recentLaunches || [],
        totalLaunches: status.totalLaunches || 0
    });
});

// Serve the frontend
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
    console.log(`🪙 Annoying Coin server running on port ${PORT}`);

    // Start monitoring if CA is configured
    const targetCA = process.env.TARGET_CA;
    if (targetCA) {
        console.log(`📡 Starting to monitor CA: ${targetCA}`);
        startMonitoring(targetCA);
    } else {
        console.log('⚠️  No TARGET_CA configured. Set it in environment variables.');
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down...');
    stopMonitoring();
    process.exit(0);
});
