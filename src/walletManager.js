import { Keypair, Connection, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import { saveWallet, getWallets, updateWalletLaunches as fbUpdateWalletLaunches } from './firebase.js';

dotenv.config();

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

// Config - Updated defaults
const MAX_LAUNCHES_PER_WALLET = parseInt(process.env.MAX_LAUNCHES_PER_WALLET || '10');
const SOL_PER_WALLET = parseFloat(process.env.SOL_PER_WALLET || '0.15');
const MIN_MASTER_BALANCE = parseFloat(process.env.MIN_MASTER_BALANCE || '0.2');

// Master wallet (the one you fund)
let masterWallet = null;

// Generated child wallets (in memory, synced with Firebase)
let childWallets = [];
let currentWalletIndex = 0;
let isInitialized = false;

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

async function loadWalletsFromFirebase() {
    if (isInitialized) return;

    try {
        const wallets = await getWallets();
        childWallets = wallets.map(w => ({
            keypair: Keypair.fromSecretKey(bs58.decode(w.privateKey)),
            publicKey: w.publicKey,
            launchCount: w.launchCount || 0,
            createdAt: w.createdAt
        }));
        isInitialized = true;
        console.log(`📂 Loaded ${childWallets.length} wallets from Firebase`);
    } catch (err) {
        console.error('Failed to load wallets from Firebase:', err.message);
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
    const newPrivateKey = bs58.encode(newKeypair.secretKey);

    console.log(`🆕 New wallet: ${newPublicKey.slice(0, 8)}...`);
    console.log(`🔑 Private key saved to Firebase (encrypted)`);

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

        // Create wallet object
        const newWallet = {
            keypair: newKeypair,
            publicKey: newPublicKey,
            launchCount: 0,
            createdAt: Date.now()
        };

        // Save to Firebase (encrypted)
        await saveWallet({
            publicKey: newPublicKey,
            privateKey: newPrivateKey,
            launchCount: 0,
            createdAt: Date.now()
        });

        // Add to local array
        childWallets.push(newWallet);

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

    // Load existing wallets from Firebase if not loaded
    if (!isInitialized) {
        await loadWalletsFromFirebase();
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
                if (balance > 0.03 * LAMPORTS_PER_SOL) { // Need at least 0.03 SOL
                    availableWallet = wallet;
                    currentWalletIndex = idx;
                    break;
                } else {
                    console.log(`⚠️  Wallet ${wallet.publicKey.slice(0, 8)}... is low on funds (${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL), skipping`);
                }
            } catch (err) {
                console.error('Balance check error:', err.message);
            }
        }
    }

    // If no available wallet, generate a new one
    if (!availableWallet) {
        console.log('📊 All wallets exhausted or empty, generating new one...');
        availableWallet = await generateNewWallet();
        currentWalletIndex = childWallets.length - 1;
    }

    console.log(`🔄 Using wallet: ${availableWallet.publicKey.slice(0, 8)}... (${availableWallet.launchCount}/${MAX_LAUNCHES_PER_WALLET} launches)`);

    return availableWallet;
}

async function incrementWalletLaunches(publicKey) {
    const wallet = childWallets.find(w => w.publicKey === publicKey);
    if (wallet) {
        wallet.launchCount++;

        // Update in Firebase
        await fbUpdateWalletLaunches(publicKey, wallet.launchCount);

        console.log(`📈 Wallet ${publicKey.slice(0, 8)}... now at ${wallet.launchCount}/${MAX_LAUNCHES_PER_WALLET} launches`);
    }
}

async function getWalletStats() {
    // Ensure wallets are loaded
    if (!isInitialized) {
        await loadWalletsFromFirebase();
    }

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

export {
    getNextWallet,
    getWalletStats,
    incrementWalletLaunches,
    connection,
    getMasterBalance,
    MAX_LAUNCHES_PER_WALLET,
    loadWalletsFromFirebase
};
