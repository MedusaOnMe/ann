import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';

dotenv.config();

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

// Wallet pool - load from environment
// Format: WALLET_1, WALLET_2, WALLET_3, etc. (private keys in base58)
let walletPool = [];
let currentWalletIndex = 0;
let walletUsageCount = {};

function loadWallets() {
    walletPool = [];
    let i = 1;

    // Load wallets from environment variables
    while (process.env[`WALLET_${i}`]) {
        try {
            const privateKey = process.env[`WALLET_${i}`];
            const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
            walletPool.push({
                keypair,
                publicKey: keypair.publicKey.toBase58(),
                index: i
            });
            walletUsageCount[keypair.publicKey.toBase58()] = 0;
            console.log(`✅ Loaded wallet ${i}: ${keypair.publicKey.toBase58().slice(0, 8)}...`);
            i++;
        } catch (err) {
            console.error(`❌ Failed to load WALLET_${i}:`, err.message);
            i++;
        }
    }

    // If no wallets configured, check for single PRIVATE_KEY
    if (walletPool.length === 0 && process.env.PRIVATE_KEY) {
        try {
            const keypair = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));
            walletPool.push({
                keypair,
                publicKey: keypair.publicKey.toBase58(),
                index: 0
            });
            walletUsageCount[keypair.publicKey.toBase58()] = 0;
            console.log(`✅ Loaded single wallet: ${keypair.publicKey.toBase58().slice(0, 8)}...`);
        } catch (err) {
            console.error('❌ Failed to load PRIVATE_KEY:', err.message);
        }
    }

    console.log(`📊 Total wallets loaded: ${walletPool.length}`);
    return walletPool.length;
}

// Get the next wallet in rotation
async function getNextWallet() {
    if (walletPool.length === 0) {
        loadWallets();
    }

    if (walletPool.length === 0) {
        throw new Error('No wallets configured! Add WALLET_1, WALLET_2, etc. to environment.');
    }

    // Simple round-robin rotation
    const wallet = walletPool[currentWalletIndex];
    currentWalletIndex = (currentWalletIndex + 1) % walletPool.length;

    // Check balance
    try {
        const balance = await connection.getBalance(wallet.keypair.publicKey);
        const solBalance = balance / LAMPORTS_PER_SOL;

        if (solBalance < 0.05) {
            console.log(`⚠️  Wallet ${wallet.index} low on funds: ${solBalance.toFixed(4)} SOL`);
            // Try next wallet if this one is too low
            if (walletPool.length > 1) {
                return getNextWallet();
            }
        }

        console.log(`🔄 Using wallet ${wallet.index}: ${wallet.publicKey.slice(0, 8)}... (${solBalance.toFixed(4)} SOL)`);
    } catch (err) {
        console.error('Failed to check balance:', err.message);
    }

    walletUsageCount[wallet.publicKey]++;
    return wallet;
}

// Get stats for all wallets
async function getWalletStats() {
    const stats = [];

    for (const wallet of walletPool) {
        try {
            const balance = await connection.getBalance(wallet.keypair.publicKey);
            stats.push({
                index: wallet.index,
                publicKey: wallet.publicKey,
                balance: balance / LAMPORTS_PER_SOL,
                usageCount: walletUsageCount[wallet.publicKey] || 0
            });
        } catch (err) {
            stats.push({
                index: wallet.index,
                publicKey: wallet.publicKey,
                balance: 'error',
                usageCount: walletUsageCount[wallet.publicKey] || 0
            });
        }
    }

    return stats;
}

// Initialize wallets on module load
loadWallets();

export { getNextWallet, getWalletStats, loadWallets, connection };
