import * as express from "express";
import * as httpProxy from "http-proxy";
import * as url from "url";
import * as fs from "fs";
import * as moment from "moment";
import * as querystring from "querystring";
import {ChildProcess, spawn, spawnSync} from "child_process";
import {delay, noCache} from "./util";
import {AuthenticatedRequest, authGuard, getUser, verifyToken} from "./auth";
import {IncomingMessage} from "http";

const config = require("../config/config.ts");
const processMap = new Map<string, { process: ChildProcess, port: number }>();

function nextAvailablePort() {
    if (!processMap.size) {
        return config.backendPorts.min;
    }

    // Get a map of all the ports in the range currently in use
    let existingPorts = new Map<number, boolean>();
    processMap.forEach(value => {
        existingPorts.set(value.port, true);
    })

    for (let p = config.backendPorts.min; p < config.backendPorts.max; p++) {
        if (!existingPorts.has(p)) {
            return p;
        }
    }
    return -1;
}

function handleCheckServer(req: AuthenticatedRequest, res: express.Response) {
    if (!req.username) {
        res.status(403).json({success: false, message: "Invalid username"});
        return;
    }

    const existingProcess = processMap.get(req.username);
    if (existingProcess) {
        res.json({
            success: true,
            running: true,
        });
    } else {
        res.json({
            success: true,
            running: false
        });
    }
}

async function handleStartServer(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    const username = req.username;
    const forceRestart = req.body?.forceRestart;
    if (!username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    const existingProcess = processMap.get(username);

    if (existingProcess) {
        if (forceRestart) {
            // Kill existing backend process for this
            try {
                const existingProcess = processMap.get(username);
                if (existingProcess) {
                    // Kill the process via the kill script
                    spawnSync("sudo", ["-u", `${username}`, config.killCommand, `${existingProcess.process.pid}`]);
                    // Delay to allow the parent process to exit
                    await delay(10);
                    processMap.delete(username);
                }
            } catch (e) {
                console.log(`Error killing existing process belonging to user ${username}`);
                return next({statusCode: 400, message: "Problem killing existing process"});
            }
        } else {
            return res.json({success: true, existing: true});
        }
    } else {
        try {
            await startServer(username);
            return res.json({success: true});
        } catch (e) {
            return next(e);
        }
    }
}

async function startServer(username: string) {
    let logStream: fs.WriteStream | undefined;

    try {
        const port = nextAvailablePort();
        if (port < 0) {
            throw {statusCode: 500, message: "No available ports for the backend process"};
        }

        let args = [
            "-u", `${username}`,
            config.processCommand,
            "-port", `${port}`,
            "-root", config.rootFolderTemplate.replace("{username}", username),
            "-base", config.baseFolderTemplate.replace("{username}", username),
        ];

        if (config.additionalArgs) {
            args = args.concat(config.additionalArgs);
        }

        const child = spawn("sudo", args);
        let logLocation: string;

        if (config.logFileTemplate) {
            logLocation = config.logFileTemplate
                .replace("{username}", username)
                .replace("{pid}", child.pid.toString())
                .replace("{datetime}", moment().format("YYYYMMDD.h_mm_ss"));

            logStream = fs.createWriteStream(logLocation, {flags: "a"});
            child.stdout.pipe(logStream);
            child.stderr.pipe(logStream);
        } else {
            logLocation = "stdout";
        }

        child.on("exit", code => {
            console.log(`Process ${child.pid} exited with code ${code} and signal ${child.signalCode}`);
            processMap.delete(username);
            logStream?.close();
        });

        // Check for early exit of backend process
        await delay(config.startDelay);
        if (child.exitCode || child.signalCode) {
            throw {statusCode: 500, message: `Problem starting process for user ${username}`};
        } else {
            console.log(`Started process with PID ${child.pid} for user ${username} on port ${port}. Outputting to ${logLocation}`);
            processMap.set(username, {port, process: child});
            return;
        }
    } catch (e) {
        console.log(`Problem starting process for user ${username}`);
        logStream?.close();
        if (e.statusCode && e.message) {
            throw e;
        } else {
            throw {statusCode: 500, message: `Problem starting process for user ${username}`};
        }
    }
}

async function handleStopServer(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    // Kill existing backend process for this
    try {
        const existingProcess = processMap.get(req.username);
        if (existingProcess) {
            existingProcess.process.removeAllListeners();
            // Kill the process via the kill script
            spawnSync("sudo", ["-u", `${req.username}`, config.killCommand, `${existingProcess.process.pid}`]);
            // Delay to allow the parent process to exit
            await delay(10);
            console.log(`Process with PID ${existingProcess.process.pid} for user ${req.username} exited via stop request`);
            processMap.delete(req.username);
            res.json({success: true});
        } else {
            return next({statusCode: 400, message: `No existing process belonging to user ${req.username}`});
        }
    } catch (e) {
        console.log(`Error killing existing process belonging to user ${req.username}`);
        return next({statusCode: 500, message: "Problem killing existing process"});
    }
}

export const createUpgradeHandler = (server: httpProxy) => async (req: IncomingMessage, socket: any, head: any) => {
    try {
        if (!req?.url) {
            return socket.end();
        }
        let parsedUrl = url.parse(req.url);
        if (!parsedUrl?.query) {
            console.log(`Incoming Websocket upgrade request could not be parsed: ${req.url}`);
            return socket.end();
        }
        let queryParameters = querystring.parse(parsedUrl.query);
        const tokenString = queryParameters?.token;
        if (!tokenString || Array.isArray(tokenString)) {
            console.log(`Incoming Websocket upgrade request is missing an authentication token`);
            return socket.end();
        }

        const token = await verifyToken(tokenString);
        if (!token || !token.username) {
            console.log(`Incoming Websocket upgrade request has an invalid token`);
            return socket.end();
        }
        const username = getUser(token.username, token.iss);
        if (!username) {
            console.log(`Could not find username ${token.username} in the user map`);
            return socket.end();
        }
        let existingProcess = processMap.get(username);

        if (!existingProcess?.process || existingProcess.process.signalCode) {
            // Attempt to start new process
            existingProcess?.process?.removeAllListeners();
            await startServer(username);
            existingProcess = processMap.get(username);
        }

        if (existingProcess && !existingProcess.process.signalCode) {
            console.log(`Redirecting to backend process for ${username} (port ${existingProcess.port})`);
            return server.ws(req, socket, head, {target: {host: "localhost", port: existingProcess.port}});
        } else {
            console.log(`Backend process could not be started`);
            return socket.end();
        }
    } catch (err) {
        console.log(`Error upgrading socket`);
        console.log(err);
        return socket.end();
    }
}

export const serverRouter = express.Router();
serverRouter.post("/start", authGuard, noCache, handleStartServer);
serverRouter.post("/stop", authGuard, noCache, handleStopServer);
serverRouter.get("/status", authGuard, noCache, handleCheckServer);

