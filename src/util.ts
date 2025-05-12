import {NextFunction, Request, Response} from "express";
import {spawnSync} from "child_process";

import { Logger as TSLogger, ILogObj } from "tslog";

export const logger: TSLogger<ILogObj> = new TSLogger({
//    type: "hidden",
    hideLogPositionForProduction: true, // for performance - override in startup if debug (or higher) loglevel
    //overwrite: { transportFormatted: (logMetaMarkup: string, logArgs: unknown[], logErrors: string[], settings: unknown) => {} }
});

// Delay for the specified number of milliseconds
export async function delay(delay: number) {
    return new Promise<void>(resolve => {
        setTimeout(() => resolve(), delay);
    });
}

export function noCache(req: Request, res: Response, next: NextFunction) {
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
        if (isFinite(uid)) {
            return uid;
        }
    }
    throw new Error(`Can't find uid for username ${username}`);
}