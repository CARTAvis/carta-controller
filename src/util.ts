import * as express from "express";
import {verboseOutput} from "./config";

// Delay for the specified number of milliseconds
export async function delay(delay: number) {
    return new Promise<void>(resolve => {
        setTimeout(() => resolve(), delay);
    });
}

export function noCache(req: express.Request, res: express.Response, next: express.NextFunction) {
    res.header("Cache-Control", "private, no-cache, no-store, must-revalidate");
    res.header("Expires", "-1");
    res.header("Pragma", "no-cache");
    next();
}

export function verboseLog(...args: any[]) {
    if (verboseOutput) {
        console.log(args);
    }
}

export function verboseError(...args: any[]) {
    if (verboseOutput) {
        console.error(args);
    }
}
