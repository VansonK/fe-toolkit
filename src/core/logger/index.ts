export const logger = {
    info: (msg: string) => console.log(`[INFO] ${msg}`),
    success: (msg: string) => console.log(`[SUCCESS] ${msg}`),
    warning: (msg: string) => console.warn(`[WARNING] ${msg}`),
    error: (msg: string) => console.error(`[ERROR] ${msg}`)
};