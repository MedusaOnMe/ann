import { VersionedTransaction, Keypair } from '@solana/web3.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getNextWallet, connection, incrementWalletLaunches } from './walletManager.js';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Annoying names and descriptions
const ANNOYING_ADJECTIVES = [
    'Super', 'Mega', 'Ultra', 'Hyper', 'Maximum', 'Extreme', 'Infinite',
    'Turbo', 'Giga', 'Omega', 'Alpha', 'Epic', 'Legendary', 'Divine',
    'Cosmic', 'Quantum', 'Nuclear', 'Atomic', 'Plasma', 'Laser'
];

const ANNOYING_SUFFIXES = [
    'Inu', 'Moon', 'Rocket', 'Gem', 'Diamond', 'Gold', 'King',
    'Doge', 'Pepe', 'Chad', 'Based', 'Pump', 'Send', 'Lambo',
    'Elon', 'Trump', 'Wojak', 'Frog', 'Cat', 'Dog'
];

const ANNOYING_DESCRIPTIONS = [
    "The most ANNOYING coin you'll ever own! 🚀🚀🚀",
    "ANNOYING your portfolio to the MOON! 💎🙌",
    "Can't stop won't stop being ANNOYING! 😤",
    "Certified ANNOYING - deal with it! 😎",
    "So ANNOYING it hurts (your wallet)! 💸",
    "Born to be ANNOYING, forced to moon! 🌙",
    "ANNOYING level: OVER 9000! 💥",
    "Warning: Extreme ANNOYANCE ahead! ⚠️",
    "The ANNOYANCE is just getting started! 🔥",
    "Too ANNOYING to fail! 📈"
];

function generateAnnoyingName() {
    const adj = ANNOYING_ADJECTIVES[Math.floor(Math.random() * ANNOYING_ADJECTIVES.length)];
    const suffix = ANNOYING_SUFFIXES[Math.floor(Math.random() * ANNOYING_SUFFIXES.length)];
    return `${adj} Annoying ${suffix}`;
}

function generateAnnoyingSymbol() {
    const chars = 'ANNOY';
    const extra = Math.floor(Math.random() * 1000);
    return `${chars}${extra}`;
}

function generateAnnoyingDescription() {
    return ANNOYING_DESCRIPTIONS[Math.floor(Math.random() * ANNOYING_DESCRIPTIONS.length)];
}

// Create the annoying image on the fly (base64 encoded simple image)
async function getAnnoyingImage() {
    const imagePath = path.join(__dirname, '../public/annoying-token.png');

    // Check if we have a custom image
    if (fs.existsSync(imagePath)) {
        return fs.readFileSync(imagePath);
    }

    // Otherwise use the default annoying image from public folder
    const defaultPath = path.join(__dirname, '../public/annoying.png');
    if (fs.existsSync(defaultPath)) {
        return fs.readFileSync(defaultPath);
    }

    // Create a simple placeholder if no image exists
    console.log('⚠️  No token image found, using placeholder');
    return null;
}

async function launchAnnoyingCoin(triggerTx = null, triggerBuyAmount = 0) {
    console.log('\n🚀 LAUNCHING NEW ANNOYING COIN! 🚀\n');

    try {
        // Get rotating wallet
        const wallet = await getNextWallet();
        const signerKeyPair = wallet.keypair;

        // Generate random keypair for the new token
        const mintKeypair = Keypair.generate();

        // Generate annoying metadata
        const tokenName = process.env.TOKEN_NAME || generateAnnoyingName();
        const tokenSymbol = process.env.TOKEN_SYMBOL || generateAnnoyingSymbol();
        const tokenDescription = generateAnnoyingDescription();

        console.log(`📝 Token Name: ${tokenName}`);
        console.log(`📝 Token Symbol: ${tokenSymbol}`);
        console.log(`📝 Description: ${tokenDescription}`);
        console.log(`📝 Mint Address: ${mintKeypair.publicKey.toBase58()}`);
        console.log(`📝 Using Wallet: ${wallet.publicKey.slice(0, 8)}...`);

        // Prepare form data for IPFS upload
        const formData = new FormData();

        // Get image
        const imageBuffer = await getAnnoyingImage();
        if (imageBuffer) {
            const blob = new Blob([imageBuffer], { type: 'image/png' });
            formData.append('file', blob, 'annoying.png');
        }

        formData.append('name', tokenName);
        formData.append('symbol', tokenSymbol);
        formData.append('description', tokenDescription);
        formData.append('twitter', process.env.TWITTER_URL || 'https://twitter.com/annoyingcoin');
        formData.append('telegram', process.env.TELEGRAM_URL || '');
        formData.append('website', process.env.WEBSITE_URL || '');
        formData.append('showName', 'true');

        // Upload metadata to IPFS via pump.fun
        console.log('📤 Uploading metadata to IPFS...');
        const metadataResponse = await fetch('https://pump.fun/api/ipfs', {
            method: 'POST',
            body: formData,
        });

        if (!metadataResponse.ok) {
            throw new Error(`IPFS upload failed: ${metadataResponse.statusText}`);
        }

        const metadataResponseJSON = await metadataResponse.json();
        console.log('✅ Metadata uploaded:', metadataResponseJSON.metadataUri);

        // Get the create transaction from PumpPortal
        const devBuyAmount = parseFloat(process.env.DEV_BUY_SOL || '0.01');
        console.log(`💰 Dev buy amount: ${devBuyAmount} SOL`);

        const response = await fetch('https://pumpportal.fun/api/trade-local', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                publicKey: wallet.publicKey,
                action: 'create',
                tokenMetadata: {
                    name: metadataResponseJSON.metadata.name,
                    symbol: metadataResponseJSON.metadata.symbol,
                    uri: metadataResponseJSON.metadataUri
                },
                mint: mintKeypair.publicKey.toBase58(),
                denominatedInSol: 'true',
                amount: devBuyAmount,
                slippage: 10,
                priorityFee: parseFloat(process.env.PRIORITY_FEE || '0.0005'),
                pool: 'pump'
            })
        });

        if (response.status !== 200) {
            const errorText = await response.text();
            throw new Error(`Trade API failed: ${response.status} - ${errorText}`);
        }

        // Sign and send transaction
        console.log('✍️  Signing transaction...');
        const data = await response.arrayBuffer();
        const tx = VersionedTransaction.deserialize(new Uint8Array(data));
        tx.sign([mintKeypair, signerKeyPair]);

        console.log('📡 Sending transaction...');
        const signature = await connection.sendTransaction(tx, {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
        });

        console.log('\n✅ ANNOYING COIN LAUNCHED! ✅');
        console.log(`🔗 Transaction: https://solscan.io/tx/${signature}`);
        console.log(`🪙 Token: https://pump.fun/${mintKeypair.publicKey.toBase58()}`);

        // Increment wallet launch count
        incrementWalletLaunches(wallet.publicKey);

        return {
            success: true,
            signature,
            mint: mintKeypair.publicKey.toBase58(),
            name: tokenName,
            symbol: tokenSymbol,
            wallet: wallet.publicKey,
            triggerTx,
            triggerBuyAmount,
            timestamp: Date.now()
        };

    } catch (error) {
        console.error('❌ Launch failed:', error.message);
        return {
            success: false,
            error: error.message,
            timestamp: Date.now()
        };
    }
}

export { launchAnnoyingCoin };
