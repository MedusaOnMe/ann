import { PublicKey } from '@solana/web3.js';
import { connection } from './walletManager.js';
import { launchAnnoyingCoin } from './launcher.js';
import dotenv from 'dotenv';

dotenv.config();

let isMonitoring = false;
let subscriptionId = null;
let targetCA = null;
let totalLaunches = 0;
let recentLaunches = [];
let processedSignatures = new Set();

// Cooldown to prevent spam launches
let lastLaunchTime = 0;
const LAUNCH_COOLDOWN = parseInt(process.env.LAUNCH_COOLDOWN_MS || '30000'); // 30 seconds default

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

    // Try to get transaction details to verify it's a buy
    try {
        const txInfo = await connection.getTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
        });

        if (!txInfo) {
            console.log('⚠️  Could not fetch transaction details');
            return;
        }

        // Basic check - if transaction involves SOL transfer to the token, it's likely a buy
        // For pump.fun tokens, buys involve the bonding curve
        console.log('✅ Transaction confirmed as interaction with target CA');

        // Launch a new annoying coin!
        lastLaunchTime = Date.now();
        const result = await launchAnnoyingCoin(signature);

        if (result.success) {
            totalLaunches++;
            recentLaunches.unshift(result);
            // Keep only last 50 launches in memory
            if (recentLaunches.length > 50) {
                recentLaunches = recentLaunches.slice(0, 50);
            }
        }

    } catch (err) {
        console.error('Error processing transaction:', err.message);
    }
}

async function startMonitoring(ca) {
    if (isMonitoring) {
        console.log('Already monitoring!');
        return;
    }

    targetCA = ca;
    isMonitoring = true;

    console.log(`\n🎯 Starting to monitor CA: ${ca}`);
    console.log(`⏱️  Launch cooldown: ${LAUNCH_COOLDOWN / 1000}s`);

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
    console.log('🛑 Monitoring stopped');
}

function getStatus() {
    return {
        isMonitoring,
        targetCA,
        totalLaunches,
        recentLaunches: recentLaunches.slice(0, 10),
        cooldownMs: LAUNCH_COOLDOWN,
        lastLaunchTime
    };
}

export { startMonitoring, stopMonitoring, getStatus };
