import admin from 'firebase-admin';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Firebase
let db = null;

function initFirebase() {
    if (db) return db;

    try {
        const serviceAccount = {
            type: 'service_account',
            project_id: process.env.FIREBASE_PROJECT_ID,
            private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
            private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            client_email: process.env.FIREBASE_CLIENT_EMAIL,
            client_id: process.env.FIREBASE_CLIENT_ID,
            auth_uri: 'https://accounts.google.com/o/oauth2/auth',
            token_uri: 'https://oauth2.googleapis.com/token',
            auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
            client_x509_cert_url: process.env.FIREBASE_CERT_URL,
            universe_domain: 'googleapis.com'
        };

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`
        });

        db = admin.database();
        console.log('✅ Firebase initialized');
        return db;
    } catch (err) {
        console.error('❌ Firebase init failed:', err.message);
        return null;
    }
}

// Encryption functions
const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey() {
    const key = process.env.ENCRYPTION_KEY;
    if (!key || key.length < 32) {
        throw new Error('ENCRYPTION_KEY must be at least 32 characters!');
    }
    // Use first 32 chars as key
    return Buffer.from(key.slice(0, 32), 'utf8');
}

function encrypt(text) {
    const iv = crypto.randomBytes(16);
    const key = getEncryptionKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Return iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(encryptedData) {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

// Database operations
async function saveWallet(walletData) {
    const database = initFirebase();
    if (!database) return false;

    try {
        // Encrypt the private key before storing
        const encryptedKey = encrypt(walletData.privateKey);

        const dataToSave = {
            publicKey: walletData.publicKey,
            encryptedPrivateKey: encryptedKey,
            launchCount: walletData.launchCount || 0,
            createdAt: walletData.createdAt || Date.now(),
            updatedAt: Date.now()
        };

        await database.ref(`wallets/${walletData.publicKey}`).set(dataToSave);
        console.log(`💾 Wallet saved to Firebase: ${walletData.publicKey.slice(0, 8)}...`);
        return true;
    } catch (err) {
        console.error('Failed to save wallet:', err.message);
        return false;
    }
}

async function getWallets() {
    const database = initFirebase();
    if (!database) return [];

    try {
        const snapshot = await database.ref('wallets').once('value');
        const data = snapshot.val();

        if (!data) return [];

        const wallets = [];
        for (const [pubKey, walletData] of Object.entries(data)) {
            try {
                // Decrypt the private key
                const privateKey = decrypt(walletData.encryptedPrivateKey);
                wallets.push({
                    publicKey: walletData.publicKey,
                    privateKey: privateKey,
                    launchCount: walletData.launchCount || 0,
                    createdAt: walletData.createdAt
                });
            } catch (err) {
                console.error(`Failed to decrypt wallet ${pubKey}:`, err.message);
            }
        }

        console.log(`📂 Loaded ${wallets.length} wallets from Firebase`);
        return wallets;
    } catch (err) {
        console.error('Failed to get wallets:', err.message);
        return [];
    }
}

async function updateWalletLaunches(publicKey, launchCount) {
    const database = initFirebase();
    if (!database) return false;

    try {
        await database.ref(`wallets/${publicKey}`).update({
            launchCount: launchCount,
            updatedAt: Date.now()
        });
        return true;
    } catch (err) {
        console.error('Failed to update wallet:', err.message);
        return false;
    }
}

async function saveStats(stats) {
    const database = initFirebase();
    if (!database) return false;

    try {
        await database.ref('stats').set({
            totalLaunches: stats.totalLaunches || 0,
            lastLaunchTime: stats.lastLaunchTime || 0,
            updatedAt: Date.now()
        });
        return true;
    } catch (err) {
        console.error('Failed to save stats:', err.message);
        return false;
    }
}

async function getStats() {
    const database = initFirebase();
    if (!database) return { totalLaunches: 0, lastLaunchTime: 0 };

    try {
        const snapshot = await database.ref('stats').once('value');
        return snapshot.val() || { totalLaunches: 0, lastLaunchTime: 0 };
    } catch (err) {
        console.error('Failed to get stats:', err.message);
        return { totalLaunches: 0, lastLaunchTime: 0 };
    }
}

async function saveLaunch(launchData) {
    const database = initFirebase();
    if (!database) return false;

    try {
        const launchId = `launch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await database.ref(`launches/${launchId}`).set({
            ...launchData,
            id: launchId,
            timestamp: Date.now()
        });

        // Also update recent launches (keep last 100)
        const recentRef = database.ref('recentLaunches');
        const snapshot = await recentRef.once('value');
        let recent = snapshot.val() || [];

        if (!Array.isArray(recent)) {
            recent = Object.values(recent);
        }

        recent.unshift({ ...launchData, id: launchId, timestamp: Date.now() });
        if (recent.length > 100) {
            recent = recent.slice(0, 100);
        }

        await recentRef.set(recent);

        return true;
    } catch (err) {
        console.error('Failed to save launch:', err.message);
        return false;
    }
}

async function getRecentLaunches(limit = 20) {
    const database = initFirebase();
    if (!database) return [];

    try {
        const snapshot = await database.ref('recentLaunches').once('value');
        let data = snapshot.val() || [];

        if (!Array.isArray(data)) {
            data = Object.values(data);
        }

        return data.slice(0, limit);
    } catch (err) {
        console.error('Failed to get recent launches:', err.message);
        return [];
    }
}

export {
    initFirebase,
    encrypt,
    decrypt,
    saveWallet,
    getWallets,
    updateWalletLaunches,
    saveStats,
    getStats,
    saveLaunch,
    getRecentLaunches
};
