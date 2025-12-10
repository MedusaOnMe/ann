import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { connection } from './walletManager.js';
import { launchAnnoyingCoin } from './launcher.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let isMonitoring = false;
let subscriptionId = null;
let targetCA = null;
let totalLaunches = 0;
let recentLaunches = [];
let processedSignatures = new Set();

// Cooldown to prevent spam launches
let lastLaunchTime = 0;
const LAUNCH_COOLDOWN = parseInt(process.env.LAUNCH_COOLDOWN_MS || '30000'); // 30 seconds default

// Minimum buy amount to trigger launch (in SOL)
const MIN_BUY_AMOUNT = parseFloat(process.env.MIN_BUY_SOL || '0.15');

// Persistence file
const STATS_FILE = path.join(__dirname, '../data/stats.json');

function ensureDataDir() {
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

function loadStats() {
    ensureDataDir();
    try {
        if (fs.existsSync(STATS_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
            totalLaunches = data.totalLaunches || 0;
            recentLaunches = data.recentLaunches || [];
            console.log(`📊 Loaded stats: ${totalLaunches} total launches`);
        }
    } catch (err) {
        console.error('Failed to load stats:', err.message);
    }
}

function saveStats() {
    ensureDataDir();
    try {
        fs.writeFileSync(STATS_FILE, JSON.stringify({
            totalLaunches,
            recentLaunches: recentLaunches.slice(0, 100), // Keep last 100
            lastUpdated: Date.now()
        }, null, 2));
    } catch (err) {
        console.error('Failed to save stats:', err.message);
    }
}

// Parse transaction to detect buy amount
async function getBuyAmount(signature) {
    try {
        const txInfo = await connection.getTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
        });

        if (!txInfo || !txInfo.meta) {
            return null;
        }

        // Calculate SOL transferred by looking at balance changes
        // For pump.fun buys, the buyer's SOL decreases
        const preBalances = txInfo.meta.preBalances;
        const postBalances = txInfo.meta.postBalances;

        if (!preBalances || !postBalances || preBalances.length === 0) {
            return null;
        }

        // The first account is usually the fee payer (buyer)
        // Calculate how much SOL they spent (excluding fees)
        const fee = txInfo.meta.fee || 5000;

        // Look for the largest SOL decrease (excluding fee payer's fee)
        let maxSpent = 0;

        for (let i = 0; i < preBalances.length; i++) {
            const spent = preBalances[i] - postBalances[i];
            if (spent > fee) { // More than just the fee
                const actualSpent = (spent - (i === 0 ? fee : 0)) / LAMPORTS_PER_SOL;
                if (actualSpent > maxSpent) {
                    maxSpent = actualSpent;
                }
            }
        }

        return maxSpent;

    } catch (err) {
        console.error('Error parsing transaction:', err.message);
        return null;
    }
}

async function processTransaction(signature) {
    // Skip if already processed
    if (processedSignatures.has(signature)) {
        return;
    }
    processedSignatures.add(signature);

    // Keep set from growing too large
    if (processedSignatures.size > 1000) {
        const arr = Array.from(processedSignatures);
        processedSignatures = new Set(arr.slice(-500));
    }

    console.log(`\n🔔 New transaction detected: ${signature.slice(0, 20)}...`);

    // Check cooldown
    const now = Date.now();
    if (now - lastLaunchTime < LAUNCH_COOLDOWN) {
        const remaining = Math.ceil((LAUNCH_COOLDOWN - (now - lastLaunchTime)) / 1000);
        console.log(`⏳ Cooldown active. ${remaining}s remaining...`);
        return;
    }

    // Get buy amount
    const buyAmount = await getBuyAmount(signature);

    if (buyAmount === null) {
        console.log('⚠️  Could not determine buy amount, skipping');
        return;
    }

    console.log(`💰 Buy amount detected: ${buyAmount.toFixed(4)} SOL`);

    // Check minimum buy amount
    if (buyAmount < MIN_BUY_AMOUNT) {
        console.log(`❌ Buy amount ${buyAmount.toFixed(4)} SOL is below minimum ${MIN_BUY_AMOUNT} SOL - SKIPPED`);
        return;
    }

    console.log(`✅ Buy amount ${buyAmount.toFixed(4)} SOL meets minimum ${MIN_BUY_AMOUNT} SOL - LAUNCHING!`);

    // Launch a new annoying coin!
    lastLaunchTime = Date.now();
    const result = await launchAnnoyingCoin(signature, buyAmount);

    if (result.success) {
        totalLaunches++;
        result.triggerBuyAmount = buyAmount;
        recentLaunches.unshift(result);
        // Keep only last 100 launches in memory
        if (recentLaunches.length > 100) {
            recentLaunches = recentLaunches.slice(0, 100);
        }
        saveStats();
        console.log(`🎉 Total launches: ${totalLaunches}`);
    }
}

async function startMonitoring(ca) {
    if (isMonitoring) {
        console.log('Already monitoring!');
        return;
    }

    // Load existing stats
    loadStats();

    targetCA = ca;
    isMonitoring = true;

    console.log(`\n🎯 Starting to monitor CA: ${ca}`);
    console.log(`⏱️  Launch cooldown: ${LAUNCH_COOLDOWN / 1000}s`);
    console.log(`💰 Minimum buy amount: ${MIN_BUY_AMOUNT} SOL`);

    try {
        const pubkey = new PublicKey(ca);

        // Subscribe to account changes (logs)
        subscriptionId = connection.onLogs(
            pubkey,
            async (logs, context) => {
                if (logs.err) return;

                console.log(`📨 Activity detected on ${ca.slice(0, 8)}...`);
                await processTransaction(logs.signature);
            },
            'confirmed'
        );

        console.log(`✅ Subscribed to logs (ID: ${subscriptionId})`);

        // Also poll for recent transactions periodically as backup
        pollRecentTransactions(pubkey);

    } catch (err) {
        console.error('Failed to start monitoring:', err.message);
        isMonitoring = false;
    }
}

async function pollRecentTransactions(pubkey) {
    if (!isMonitoring) return;

    try {
        const signatures = await connection.getSignaturesForAddress(pubkey, {
            limit: 5
        });

        for (const sig of signatures) {
            if (!processedSignatures.has(sig.signature)) {
                await processTransaction(sig.signature);
            }
        }
    } catch (err) {
        console.error('Polling error:', err.message);
    }

    // Poll every 10 seconds as backup
    setTimeout(() => pollRecentTransactions(pubkey), 10000);
}

function stopMonitoring() {
    if (subscriptionId !== null) {
        connection.removeOnLogsListener(subscriptionId);
        subscriptionId = null;
    }
    isMonitoring = false;
    saveStats();
    console.log('🛑 Monitoring stopped');
}

function getStatus() {
    return {
        isMonitoring,
        targetCA,
        totalLaunches,
        recentLaunches: recentLaunches.slice(0, 20),
        cooldownMs: LAUNCH_COOLDOWN,
        minBuyAmount: MIN_BUY_AMOUNT,
        lastLaunchTime
    };
}

// Load stats on module init
loadStats();

export { startMonitoring, stopMonitoring, getStatus };
