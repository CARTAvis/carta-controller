import express, {NextFunction, Request, Response} from "express";
import {spawnSync} from "child_process";
import { createWriteStream, existsSync } from "fs";

import {ServerConfig, consoleLogLevelOverride} from "./config";
import { Logger as TSLogger, ILogObj } from "tslog";
import { LogLevel } from "./types";

export const logger: TSLogger<ILogObj> = new TSLogger({
    prettyLogTemplate: "{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}\t{{logLevelName}}\t"
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

export function initLogger() {
   if (consoleLogLevelOverride) {
    if (consoleLogLevelOverride !== "none") {
        const consoleLogger = logger.getSubLogger({ minLevel: LogLevel[consoleLogLevelOverride] });
    }
   }
   else if (ServerConfig.logLevelConsole !== LogLevel.none || !ServerConfig.logFile) {
     const consoleLogger = logger.getSubLogger({ minLevel: ServerConfig.logLevelConsole })
     //consoleLogger.attachTransport(msg => console.log(msg + "\n"))
   }

   if (ServerConfig.logFile && ServerConfig.logLevelFile !== LogLevel.none && existsSync(ServerConfig.logFile)) {
     const logFileStream = createWriteStream("ServerConfig.logFile", { flags: "a" });
     const fileLogger = logger.getSubLogger({ minLevel: ServerConfig.logLevelFile });
     fileLogger.attachTransport(msg => logFileStream.write(msg + "\n"));
     //console.log(`File log level: ${ServerConfig.logLevelFile}`)
   }

}

export function log(level: LogLevel, arg) {
    if (!logger)
        initLogger();

    switch (level) {
        case LogLevel.trace:
            logger.trace(arg)
            break;
        case LogLevel.debug:
            logger.debug(arg)
            break;
        case LogLevel.info:
            logger.info(arg)
            break;
        case LogLevel.warn:
            logger.warn(arg)
            break;
        case LogLevel.error:
            logger.error(arg)
            break;
        case LogLevel.fatal:
            logger.fatal(arg)
            break;
        default:
        case LogLevel.none:
            logger.warn("Logger received message with invalid log level")
            logger.warn(arg)
    }
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