import WebSocket from 'ws';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { launchAnnoyingCoin } from './launcher.js';
import { saveStats, getStats, saveLaunch, getRecentLaunches } from './firebase.js';
import dotenv from 'dotenv';

dotenv.config();

let isMonitoring = false;
let ws = null;
let targetCA = null;
let totalLaunches = 0;
let recentLaunches = [];

// Cooldown to prevent spam launches
let lastLaunchTime = 0;
const LAUNCH_COOLDOWN = parseInt(process.env.LAUNCH_COOLDOWN_MS || '30000'); // 30 seconds default

// Minimum buy amount to trigger launch (in SOL)
const MIN_BUY_AMOUNT = parseFloat(process.env.MIN_BUY_SOL || '0.15');

// Track processed transactions to avoid duplicates
const processedTxs = new Set();

async function loadStatsFromFirebase() {
    try {
        const stats = await getStats();
        totalLaunches = stats.totalLaunches || 0;
        recentLaunches = await getRecentLaunches(20);
        console.log(`📊 Loaded stats from Firebase: ${totalLaunches} total launches`);
    } catch (err) {
        console.error('Failed to load stats:', err.message);
    }
}

async function saveStatsToFirebase() {
    try {
        await saveStats({
            totalLaunches,
            lastLaunchTime
        });
    } catch (err) {
        console.error('Failed to save stats:', err.message);
    }
}

async function processTradeEvent(trade) {
    // Only process buys on our target CA
    if (trade.mint !== targetCA) return;
    if (trade.txType !== 'buy') return;

    const signature = trade.signature;

    // Skip if already processed
    if (processedTxs.has(signature)) return;
    processedTxs.add(signature);

    // Keep set from growing too large
    if (processedTxs.size > 1000) {
        const arr = Array.from(processedTxs);
        processedTxs.clear();
        arr.slice(-500).forEach(tx => processedTxs.add(tx));
    }

    // Get buy amount in SOL
    const buyAmountSol = trade.solAmount / LAMPORTS_PER_SOL;

    console.log(`\n🔔 BUY detected on target CA!`);
    console.log(`💰 Amount: ${buyAmountSol.toFixed(4)} SOL`);
    console.log(`👤 Buyer: ${trade.traderPublicKey?.slice(0, 8)}...`);
    console.log(`🔗 TX: ${signature.slice(0, 20)}...`);

    // Check minimum buy amount
    if (buyAmountSol < MIN_BUY_AMOUNT) {
        console.log(`❌ Buy amount ${buyAmountSol.toFixed(4)} SOL is below minimum ${MIN_BUY_AMOUNT} SOL - SKIPPED`);
        return;
    }

    // Check cooldown
    const now = Date.now();
    if (now - lastLaunchTime < LAUNCH_COOLDOWN) {
        const remaining = Math.ceil((LAUNCH_COOLDOWN - (now - lastLaunchTime)) / 1000);
        console.log(`⏳ Cooldown active. ${remaining}s remaining...`);
        return;
    }

    console.log(`✅ Buy amount ${buyAmountSol.toFixed(4)} SOL meets minimum ${MIN_BUY_AMOUNT} SOL - LAUNCHING!`);

    // Launch a new annoying coin!
    lastLaunchTime = Date.now();
    const result = await launchAnnoyingCoin(signature, buyAmountSol);

    if (result.success) {
        totalLaunches++;
        result.triggerBuyAmount = buyAmountSol;
        result.triggerBuyer = trade.traderPublicKey;

        recentLaunches.unshift(result);
        if (recentLaunches.length > 100) {
            recentLaunches = recentLaunches.slice(0, 100);
        }

        // Save to Firebase
        await saveLaunch(result);
        await saveStatsToFirebase();

        console.log(`🎉 Total launches: ${totalLaunches}`);
    }
}

function connectWebSocket() {
    console.log('🔌 Connecting to PumpPortal WebSocket...');

    ws = new WebSocket('wss://pumpportal.fun/api/data');

    ws.on('open', () => {
        console.log('✅ WebSocket connected!');

        // Subscribe to trades for our target token
        const subscribeMsg = {
            method: 'subscribeTokenTrade',
            keys: [targetCA]
        };

        ws.send(JSON.stringify(subscribeMsg));
        console.log(`📡 Subscribed to trades for: ${targetCA.slice(0, 8)}...`);
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());

            // Handle trade events
            if (message.txType === 'buy' || message.txType === 'sell') {
                processTradeEvent(message);
            }
        } catch (err) {
            // Ignore parse errors for non-JSON messages
        }
    });

    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
    });

    ws.on('close', () => {
        console.log('🔌 WebSocket disconnected');

        // Reconnect after 5 seconds if still monitoring
        if (isMonitoring) {
            console.log('🔄 Reconnecting in 5 seconds...');
            setTimeout(connectWebSocket, 5000);
        }
    });
}

async function startMonitoring(ca) {
    if (isMonitoring) {
        console.log('Already monitoring!');
        return;
    }

    targetCA = ca;
    isMonitoring = true;

    // Load existing stats from Firebase
    await loadStatsFromFirebase();

    console.log(`\n🎯 Starting to monitor CA: ${ca}`);
    console.log(`⏱️  Launch cooldown: ${LAUNCH_COOLDOWN / 1000}s`);
    console.log(`💰 Minimum buy amount: ${MIN_BUY_AMOUNT} SOL`);

    // Connect to PumpPortal WebSocket
    connectWebSocket();
}

function stopMonitoring() {
    isMonitoring = false;

    if (ws) {
        ws.close();
        ws = null;
    }

    saveStatsToFirebase();
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

export { startMonitoring, stopMonitoring, getStatus };
