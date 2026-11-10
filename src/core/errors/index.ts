import { logger } from '../logger';

export function handleError(error: Error | string, exitCode: number = 1): never {
    const message = error instanceof Error ? error.message : error;
    logger.error(message);
    process.exit(exitCode);
}