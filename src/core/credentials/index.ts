import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const CREDENTIALS_DIR = path.join(os.homedir(), '.fe-toolkit');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.enc');

const ALGORITHM = 'aes-256-gcm';
const APP_SALT = 'fe-toolkit-secure-salt-v1';

function getMachineKey(): Buffer {
    // Combine OS specifics to create a unique string for this specific user/machine
    const machineId = `${os.userInfo().username}-${os.hostname()}-${os.arch()}-${APP_SALT}`;
    // Use scrypt to derive a robust 32-byte key from the machine data
    return crypto.scryptSync(machineId, APP_SALT, 32);
}

function encryptData(data: object): string {
    const key = getMachineKey();
    const iv = crypto.randomBytes(12); // 12-byte initialization vector for GCM
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    // Store IV, AuthTag, and Encrypted Data together
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptData(encryptedString: string): Record<string, string> | null {
    try {
        const [ivHex, authTagHex, encryptedHex] = encryptedString.split(':');
        if (!ivHex || !authTagHex || !encryptedHex) return null;

        const key = getMachineKey();
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return JSON.parse(decrypted);
    } catch {
        // Will fail if tampered with or moved to a different machine
        return null;
    }
}

export function getSecureToken(provider: string): string | null {
    if (!fs.existsSync(CREDENTIALS_FILE)) return null;
    try {
        const rawData = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
        const data = decryptData(rawData);
        
        if (!data) return null;
        
        const token = data[provider];
        return token ? token.trim() : null;
    } catch {
        return null;
    }
}

export function saveSecureToken(provider: string, token: string): boolean {
    try {
        if (!fs.existsSync(CREDENTIALS_DIR)) {
            fs.mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
        }
        
        let data: Record<string, string> = {};
        if (fs.existsSync(CREDENTIALS_FILE)) {
            const rawData = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
            const parsedData = decryptData(rawData);
            if (parsedData) data = parsedData;
        }
        
        data[provider] = token;
        
        const encryptedContent = encryptData(data);
        fs.writeFileSync(CREDENTIALS_FILE, encryptedContent, { mode: 0o600 });
        
        return true;
    } catch {
        return false;
    }
}

export async function validateToken(provider: string, token: string, host: string): Promise<boolean> {
    try {
        let url = '';
        let headers: Record<string, string> = { 'Authorization': `Bearer ${token}` };

        if (provider === 'github') {
            url = 'https://api.github.com/user';
            headers['Accept'] = 'application/vnd.github.v3+json';
            headers['User-Agent'] = 'fe-toolkit-cli';
        } else if (provider === 'gitea') {
            // Gunakan host dari repo URL untuk Gitea API
            url = `https://${host}/api/v1/user`; 
        } else if (provider === 'gitlab') {
            // Gunakan host custom jika ada (untuk self-hosted), default ke gitlab.com
            const gitlabHost = host || 'gitlab.com';
            url = `https://${gitlabHost}/api/v4/user`;
        } else {
            return false;
        }

        const response = await fetch(url, { headers });
        return response.ok;
    } catch {
        return false;
    }
}