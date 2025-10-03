import {spawnSync} from "node:child_process";
import type {NextFunction, Request, Response} from "express";

import winston from "winston";

export const logger = winston.createLogger({
    // Detailed setup is completed in config.ts
    levels: winston.config.syslog.levels
});

// Delay for the specified number of milliseconds
export async function delay(delay: number) {
    return new Promise<void>(resolve => {
        setTimeout(() => resolve(), delay);
    });
}

export function noCache(_req: Request, res: Response, next: NextFunction) {
    res.header("Cache-Control", "private, no-cache, no-store, must-revalidate");
    res.header("Expires", "-1");
    res.header("Pragma", "no-cache");
    next();
}

export function getUserId(username: string) {
    if (!username) {
        throw new Error("Missing argument for username");
    }

    const result = spawnSync("id", ["-u", username]);
    if (!result.status && result?.stdout) {
        const uid = Number.parseInt(result.stdout.toString());
        if (Number.isFinite(uid)) {
            return uid;
        }
    }
    throw new Error(`Can't find uid for username ${username}`);
}

export function generateUrlSafeString(length: number): string {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
    let sessionId = "";
    for (let i = 0; i < length; i++) {
        sessionId += charset[Math.floor(Math.random() * charset.length)];
    }
    return sessionId;
}
