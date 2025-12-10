import { Keypair, Connection, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

// Config
const MAX_LAUNCHES_PER_WALLET = parseInt(process.env.MAX_LAUNCHES_PER_WALLET || '5');
const SOL_PER_WALLET = parseFloat(process.env.SOL_PER_WALLET || '0.3'); // SOL to transfer to each new wallet
const MIN_MASTER_BALANCE = parseFloat(process.env.MIN_MASTER_BALANCE || '0.5'); // Keep at least this much in master

// Master wallet (the one you fund)
let masterWallet = null;

// Generated child wallets
let childWallets = [];
let currentWalletIndex = 0;

// Persistence file path
const DATA_FILE = path.join(__dirname, '../data/wallets.json');

function ensureDataDir() {
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

function loadData() {
    ensureDataDir();
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            childWallets = data.childWallets.map(w => ({
                ...w,
                keypair: Keypair.fromSecretKey(bs58.decode(w.privateKey))
            }));
            currentWalletIndex = data.currentWalletIndex || 0;
            console.log(`📂 Loaded ${childWallets.length} existing child wallets`);
            return true;
        }
    } catch (err) {
        console.error('Failed to load wallet data:', err.message);
    }
    return false;
}

function saveData() {
    ensureDataDir();
    try {
        const data = {
            childWallets: childWallets.map(w => ({
                publicKey: w.publicKey,
                privateKey: bs58.encode(w.keypair.secretKey),
                launchCount: w.launchCount,
                createdAt: w.createdAt
            })),
            currentWalletIndex
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Failed to save wallet data:', err.message);
    }
}

function loadMasterWallet() {
    const masterKey = process.env.MASTER_WALLET;
    if (!masterKey) {
        console.error('❌ MASTER_WALLET not configured in environment!');
        return false;
    }

    try {
        masterWallet = Keypair.fromSecretKey(bs58.decode(masterKey));
        console.log(`✅ Master wallet loaded: ${masterWallet.publicKey.toBase58().slice(0, 8)}...`);
        return true;
    } catch (err) {
        console.error('❌ Failed to load MASTER_WALLET:', err.message);
        return false;
    }
}

async function getMasterBalance() {
    if (!masterWallet) return 0;
    try {
        const balance = await connection.getBalance(masterWallet.publicKey);
        return balance / LAMPORTS_PER_SOL;
    } catch (err) {
        console.error('Failed to get master balance:', err.message);
        return 0;
    }
}

async function generateNewWallet() {
    console.log('\n🔧 Generating new child wallet...');

    if (!masterWallet) {
        throw new Error('Master wallet not loaded!');
    }

    // Check master balance
    const masterBalance = await getMasterBalance();
    console.log(`💰 Master wallet balance: ${masterBalance.toFixed(4)} SOL`);

    if (masterBalance < MIN_MASTER_BALANCE + SOL_PER_WALLET) {
        throw new Error(`Master wallet too low! Need at least ${(MIN_MASTER_BALANCE + SOL_PER_WALLET).toFixed(2)} SOL, have ${masterBalance.toFixed(4)} SOL`);
    }

    // Generate new keypair
    const newKeypair = Keypair.generate();
    const newPublicKey = newKeypair.publicKey.toBase58();
    console.log(`🆕 New wallet: ${newPublicKey.slice(0, 8)}...`);

    // Transfer SOL from master to new wallet
    const transferAmount = SOL_PER_WALLET * LAMPORTS_PER_SOL;
    console.log(`💸 Transferring ${SOL_PER_WALLET} SOL from master...`);

    try {
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: masterWallet.publicKey,
                toPubkey: newKeypair.publicKey,
                lamports: transferAmount
            })
        );

        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [masterWallet],
            { commitment: 'confirmed' }
        );

        console.log(`✅ Transfer complete: ${signature.slice(0, 20)}...`);

        // Add to child wallets
        const newWallet = {
            keypair: newKeypair,
            publicKey: newPublicKey,
            launchCount: 0,
            createdAt: Date.now()
        };

        childWallets.push(newWallet);
        saveData();

        return newWallet;

    } catch (err) {
        console.error('❌ Transfer failed:', err.message);
        throw err;
    }
}

async function getNextWallet() {
    // Load master if not loaded
    if (!masterWallet) {
        loadMasterWallet();
    }

    // Load existing wallets if not loaded
    if (childWallets.length === 0) {
        loadData();
    }

    // Find a wallet with launches remaining
    let availableWallet = null;

    for (let i = 0; i < childWallets.length; i++) {
        const idx = (currentWalletIndex + i) % childWallets.length;
        const wallet = childWallets[idx];

        if (wallet.launchCount < MAX_LAUNCHES_PER_WALLET) {
            // Check if wallet still has balance
            try {
                const balance = await connection.getBalance(wallet.keypair.publicKey);
                if (balance > 0.05 * LAMPORTS_PER_SOL) { // Need at least 0.05 SOL
                    availableWallet = wallet;
                    currentWalletIndex = idx;
                    break;
                } else {
                    console.log(`⚠️  Wallet ${wallet.publicKey.slice(0, 8)}... is low on funds, skipping`);
                }
            } catch (err) {
                console.error('Balance check error:', err.message);
            }
        }
    }

    // If no available wallet, generate a new one
    if (!availableWallet) {
        console.log('📊 All wallets exhausted, generating new one...');
        availableWallet = await generateNewWallet();
        currentWalletIndex = childWallets.length - 1;
    }

    console.log(`🔄 Using wallet: ${availableWallet.publicKey.slice(0, 8)}... (${availableWallet.launchCount}/${MAX_LAUNCHES_PER_WALLET} launches)`);

    return availableWallet;
}

function incrementWalletLaunches(publicKey) {
    const wallet = childWallets.find(w => w.publicKey === publicKey);
    if (wallet) {
        wallet.launchCount++;
        saveData();
        console.log(`📈 Wallet ${publicKey.slice(0, 8)}... now at ${wallet.launchCount}/${MAX_LAUNCHES_PER_WALLET} launches`);
    }
}

async function getWalletStats() {
    const stats = {
        master: null,
        children: [],
        totalLaunchCapacity: 0,
        usedLaunches: 0
    };

    // Master wallet stats
    if (masterWallet) {
        try {
            const balance = await connection.getBalance(masterWallet.publicKey);
            stats.master = {
                publicKey: masterWallet.publicKey.toBase58(),
                balance: balance / LAMPORTS_PER_SOL
            };
        } catch (err) {
            stats.master = {
                publicKey: masterWallet.publicKey.toBase58(),
                balance: 'error'
            };
        }
    }

    // Child wallet stats
    for (const wallet of childWallets) {
        try {
            const balance = await connection.getBalance(wallet.keypair.publicKey);
            stats.children.push({
                publicKey: wallet.publicKey,
                balance: balance / LAMPORTS_PER_SOL,
                launchCount: wallet.launchCount,
                maxLaunches: MAX_LAUNCHES_PER_WALLET,
                createdAt: wallet.createdAt
            });
            stats.totalLaunchCapacity += MAX_LAUNCHES_PER_WALLET;
            stats.usedLaunches += wallet.launchCount;
        } catch (err) {
            stats.children.push({
                publicKey: wallet.publicKey,
                balance: 'error',
                launchCount: wallet.launchCount,
                maxLaunches: MAX_LAUNCHES_PER_WALLET
            });
        }
    }

    return stats;
}

// Initialize on load
loadMasterWallet();
loadData();

export {
    getNextWallet,
    getWalletStats,
    incrementWalletLaunches,
    connection,
    getMasterBalance,
    MAX_LAUNCHES_PER_WALLET
};
