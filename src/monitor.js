import WebSocket from 'ws';
import { launchAnnoyingCoin } from './launcher.js';
import { saveStats, getStats, saveLaunch, getRecentLaunches } from './firebase.js';
import dotenv from 'dotenv';

dotenv.config();

let isMonitoring = false;
let wsBondingCurve = null;  // Free WS for pre-migration tokens
let wsPumpSwap = null;       // Paid WS for post-migration tokens
let targetCA = null;

// PumpPortal API key for pump-swap (post-migration)
const PUMPPORTAL_API_KEY = process.env.PUMPPORTAL_API_KEY;
let totalLaunches = 0;
let recentLaunches = [];
let sessionLaunches = 0; // Track launches in current session (for test mode)

// Cooldown to prevent spam launches
let lastLaunchTime = 0;
const LAUNCH_COOLDOWN = parseInt(process.env.LAUNCH_COOLDOWN_MS || '30000'); // 30 seconds default

// Minimum buy amount to trigger launch (in SOL)
const MIN_BUY_AMOUNT = parseFloat(process.env.MIN_BUY_SOL || '0.15');

// TEST MODE - easily revertible by setting TEST_MODE=false in .env
const TEST_MODE = process.env.TEST_MODE === 'true';
const MAX_TEST_LAUNCHES = parseInt(process.env.MAX_TEST_LAUNCHES || '1');

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

    // Get buy amount in SOL (already in SOL, not lamports)
    const buyAmountSol = trade.solAmount;

    // Check minimum buy amount (skip silently if below threshold)
    if (buyAmountSol < MIN_BUY_AMOUNT) {
        return;
    }

    console.log(`\n🔔 BUY detected on target CA!`);
    console.log(`💰 Amount: ${buyAmountSol.toFixed(4)} SOL`);
    console.log(`👤 Buyer: ${trade.traderPublicKey?.slice(0, 8)}...`);
    console.log(`🔗 TX: ${signature.slice(0, 20)}...`);

    // Check test mode limit
    if (TEST_MODE && sessionLaunches >= MAX_TEST_LAUNCHES) {
        console.log(`🧪 TEST MODE: Already launched ${sessionLaunches}/${MAX_TEST_LAUNCHES} coins this session - SKIPPED`);
        return;
    }

    // Check cooldown
    const now = Date.now();
    if (now - lastLaunchTime < LAUNCH_COOLDOWN) {
        const remaining = Math.ceil((LAUNCH_COOLDOWN - (now - lastLaunchTime)) / 1000);
        console.log(`⏳ Cooldown active. ${remaining}s remaining...`);
        return;
    }

    console.log(`✅ LAUNCHING!`);

    // Launch a new annoying coin!
    lastLaunchTime = Date.now();
    const result = await launchAnnoyingCoin(signature, buyAmountSol);

    if (result.success) {
        totalLaunches++;
        sessionLaunches++;
        result.triggerBuyAmount = buyAmountSol;
        result.triggerBuyer = trade.traderPublicKey;

        if (TEST_MODE) {
            console.log(`🧪 TEST MODE: Launched ${sessionLaunches}/${MAX_TEST_LAUNCHES} coins this session`);
        }

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

function createWebSocket(name, url, reconnectFn) {
    console.log(`🔌 [${name}] Connecting...`);

    const ws = new WebSocket(url);

    ws.on('open', () => {
        console.log(`✅ [${name}] Connected!`);

        // Subscribe to trades for our target token
        const subscribeMsg = {
            method: 'subscribeTokenTrade',
            keys: [targetCA]
        };

        ws.send(JSON.stringify(subscribeMsg));
        console.log(`📡 [${name}] Subscribed to: ${targetCA.slice(0, 8)}...`);
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());

            // Handle trade events
            if (message.txType === 'buy' || message.txType === 'sell') {
                processTradeEvent(message);
            }
        } catch (err) {
            // Ignore parse errors
        }
    });

    ws.on('error', (error) => {
        console.error(`❌ [${name}] Error:`, error.message);
    });

    ws.on('close', () => {
        console.log(`🔌 [${name}] Disconnected`);

        // Reconnect after 5 seconds if still monitoring
        if (isMonitoring) {
            console.log(`🔄 [${name}] Reconnecting in 5s...`);
            setTimeout(reconnectFn, 5000);
        }
    });

    return ws;
}

function connectBondingCurveWS() {
    wsBondingCurve = createWebSocket(
        'Bonding Curve',
        'wss://pumpportal.fun/api/data',
        connectBondingCurveWS
    );
}

function connectPumpSwapWS() {
    if (!PUMPPORTAL_API_KEY) {
        console.log('⚠️  No PUMPPORTAL_API_KEY - pump-swap monitoring disabled');
        return;
    }
    wsPumpSwap = createWebSocket(
        'Pump-Swap',
        `wss://pumpportal.fun/api/data?api-key=${PUMPPORTAL_API_KEY}`,
        connectPumpSwapWS
    );
}

function connectWebSockets() {
    // Connect to both WebSockets for seamless coverage
    connectBondingCurveWS();  // Free - pre-migration tokens
    connectPumpSwapWS();       // Paid - post-migration tokens
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
    if (TEST_MODE) {
        console.log(`🧪 TEST MODE ENABLED: Max ${MAX_TEST_LAUNCHES} launch(es) this session`);
    }

    // Connect to both PumpPortal WebSockets
    connectWebSockets();
}

function stopMonitoring() {
    isMonitoring = false;

    if (wsBondingCurve) {
        wsBondingCurve.close();
        wsBondingCurve = null;
    }
    if (wsPumpSwap) {
        wsPumpSwap.close();
        wsPumpSwap = null;
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
        lastLaunchTime,
        testMode: TEST_MODE,
        sessionLaunches,
        maxTestLaunches: MAX_TEST_LAUNCHES
    };
}

export { startMonitoring, stopMonitoring, getStatus };
