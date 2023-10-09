import * as express from "express";
import * as httpProxy from "http-proxy";
import * as url from "url";
import * as fs from "fs";
import * as moment from "moment";
import * as querystring from "querystring";
import {v4} from "uuid";
import * as io from "@pm2/io";
import * as tcpPortUsed from "tcp-port-used";
import {ChildProcess, spawn, spawnSync} from "child_process";
import {IncomingMessage} from "http";
import {LinkedList} from "mnemonist";
import {delay, noCache, verboseError} from "./util";
import {authGuard, getUser, verifyToken} from "./auth";
import {AuthenticatedRequest} from "./types";
import {ServerConfig} from "./config";
import {setupWSConnection} from "../node_modules/y-websocket/bin/utils.js";
import * as ws from "ws";

type ProcessInfo = {
    process: ChildProcess;
    port: number;
    headerToken: string;
    ready: boolean;
};

const processMap = new Map<string, ProcessInfo>();
const logMap = new Map<string, LinkedList<string>>();
const LOG_LIMIT = 1000;

const userProcessesMetric = io.metric({
    name: "Active Backend Processes",
    id: "app/realtime/backend"
});

function appendLog(username: string, output: string) {
    if (!username) {
        return;
    }
    let list = logMap.get(username);
    if (!list) {
        list = new LinkedList<string>();
        logMap.set(username, list);
    }

    while (list.size >= LOG_LIMIT) {
        list.shift();
    }
    list.push(output);
}

function setPendingProcess(username: string, port: number, headerToken: string, process: ChildProcess) {
    processMap.set(username, {port, process, headerToken, ready: false});
    userProcessesMetric.set(processMap.size);
}

function setReadyProcess(username: string, pid: number) {
    const processInfo = processMap.get(username);
    if (processInfo?.process?.pid === pid) {
        processInfo.ready = true;
    } else {
        console.error(`Process ${pid} is missing`);
    }
}

function deleteProcess(username: string) {
    processMap.delete(username);
    userProcessesMetric.set(processMap.size);
}

async function nextAvailablePort() {
    // Get a map of all the ports in the range currently in use
    let existingPorts = new Map<number, boolean>();
    processMap.forEach(value => {
        existingPorts.set(value.port, true);
    });

    for (let p = ServerConfig.backendPorts.min; p < ServerConfig.backendPorts.max; p++) {
        if (!existingPorts.has(p)) {
            try {
                const portUsed = await tcpPortUsed.check(p);
                if (!portUsed) {
                    return p;
                } else {
                    console.log(`Skipping stale port ${p}`);
                }
            } catch (err) {
                verboseError(err);
                console.log(`Error checking status for port ${p}: ${err.message}`);
            }
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
            running: true
        });
    } else {
        res.json({
            success: true,
            running: false
        });
    }
}

function handleLog(req: AuthenticatedRequest, res: express.Response) {
    if (!req.username) {
        res.status(403).json({success: false, message: "Invalid username"});
        return;
    }

    const logList = logMap.get(req.username);
    if (!logList?.size) {
        res.json({success: false});
        return;
    }

    res.json({
        success: true,
        log: logList.toArray()?.join("")
    });
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
                    spawnSync("sudo", ["-u", `${username}`, ServerConfig.killCommand, `${existingProcess.process.pid}`]);
                    // Delay to allow the parent process to exit
                    await delay(10);
                    deleteProcess(username);
                }
            } catch (e) {
                verboseError(e);
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
            verboseError(e);
            return next(e);
        }
    }
}

async function startServer(username: string) {
    let logStream: fs.WriteStream | undefined;

    try {
        const port = await nextAvailablePort();
        if (port < 0) {
            throw {statusCode: 500, message: "No available ports for the backend process"};
        }

        let args: string[] = [];
        if (ServerConfig.preserveEnv) {
            args.push("--preserve-env=CARTA_AUTH_TOKEN");
        }

        args = args.concat([
            "-n", // run non-interactively. If password is required, sudo will bail
            "-u",
            `${username}`,
            ServerConfig.processCommand,
            "--no_http",
            "--port",
            `${port}`,
            "--top_level_folder",
            ServerConfig.rootFolderTemplate.replace("{username}", username),
            "--controller_deployment"
        ]);

        if (ServerConfig.logFileTemplate) {
            args.push("--no_log");
        }

        if (ServerConfig.additionalArgs) {
            args = args.concat(ServerConfig.additionalArgs);
        }

        // Finally, add the positional argument for the base folder
        args.push(ServerConfig.baseFolderTemplate.replace("{username}", username));

        const headerToken = v4();
        const child = spawn("sudo", args, {env: {CARTA_AUTH_TOKEN: headerToken}});
        setPendingProcess(username, port, headerToken, child);

        let logLocation;

        if (ServerConfig.logFileTemplate) {
            logLocation = ServerConfig.logFileTemplate.replace("{username}", username).replace("{pid}", child.pid.toString()).replace("{datetime}", moment().format("YYYYMMDD.h_mm_ss"));

            try {
                logStream = fs.createWriteStream(logLocation, {flags: "a"});
                child.stdout.pipe(logStream);
                child.stderr.pipe(logStream);
                child.stdout.on("data", function(data) {
                    const line = data.toString() as string;
                    appendLog(username, line);
                });

                child.stderr.on("data", function(data) {
                    const line = data.toString() as string;
                    appendLog(username, line);
                });
            } catch (err) {
                verboseError(err);
                console.error(`Could not create log file at ${logLocation}. Please ensure folder exists and permissions are set correctly`);
            }
        } else {
            logLocation = "stdout";
            child.stdout.on("data", function(data) {
                const line = data.toString() as string;
                appendLog(username, line);
                console.log(line);
            });

            child.stderr.on("data", function(data) {
                const line = data.toString() as string;
                appendLog(username, line);
                console.log(line);
            });
        }

        child.on("exit", code => {
            console.log(`Process ${child.pid} exited with code ${code} and signal ${child.signalCode}`);
            deleteProcess(username);
            logStream?.end();
        });

        // Check for early exit of backend process
        await delay(ServerConfig.startDelay);
        if (child.exitCode || child.signalCode) {
            throw {statusCode: 500, message: `Problem starting process for user ${username}`};
        } else {
            console.log(`Started process with PID ${child.pid} for user ${username} on port ${port}. Outputting to ${logLocation}`);
            setReadyProcess(username, child.pid);
            return;
        }
    } catch (e) {
        verboseError(e);
        console.log(`Problem starting process for user ${username}`);
        logStream?.end();
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
            spawnSync("sudo", ["-u", `${req.username}`, ServerConfig.killCommand, `${existingProcess.process.pid}`]);
            // Delay to allow the parent process to exit
            await delay(10);
            console.log(`Process with PID ${existingProcess.process.pid} for user ${req.username} exited via stop request`);
            deleteProcess(req.username);
            res.json({success: true});
        } else {
            return next({statusCode: 400, message: `No existing process belonging to user ${req.username}`});
        }
    } catch (e) {
        verboseError(e);
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

        const remoteAddress = req.headers?.["x-forwarded-for"] || req.connection?.remoteAddress;
        console.log(`WS upgrade request from ${remoteAddress} for authenticated user ${token.username}`);

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
            if (!existingProcess.ready) {
                // Wait until existing process is ready
                await delay(ServerConfig.startDelay);
            }
            console.log(`Redirecting to backend process for ${username} (port ${existingProcess.port})`);
            req.headers["carta-auth-token"] = existingProcess.headerToken;
            req.url = "/";
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
};

export const createScriptingProxyHandler = (server: httpProxy) => async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    const username = req?.username;
    if (!username) {
        return next({statusCode: 401, message: "Not authorized"});
    }

    if (!req.scripting) {
        return next({statusCode: 403, message: "API token supplied does not permit scripting"});
    }

    try {
        const remoteAddress = req.headers?.["x-forwarded-for"] || req.connection?.remoteAddress;
        let existingProcess = processMap.get(username);

        if (!existingProcess?.process || existingProcess.process.signalCode) {
            // Attempt to start new process
            existingProcess?.process?.removeAllListeners();
            await startServer(username);
            existingProcess = processMap.get(username);
        }

        if (existingProcess && !existingProcess.process.signalCode) {
            if (!existingProcess.ready) {
                // Wait until existing process is ready
                await delay(ServerConfig.startDelay);
            }
            req.headers["carta-auth-token"] = existingProcess.headerToken;
            return server.web(req, res, {target: {host: "localhost", port: existingProcess.port}});
        } else {
            return next({statusCode: 500, message: `Backend process could not be started for ${username}`});
        }
    } catch (err) {
        console.log(`Error proxying scripting request for ${req.username}`);
        console.log(err);
        return next({statusCode: 500, message: `Error proxying scripting request for ${req.username}`});
    }
};

export async function yjsUpgradeHandler(ws: ws.WebSocket, req: express.Request) {
    if (!req.params.docName || !req.query?.token) {
        ws.close();
        return;
    }

    const tokenString = req.query?.token as string;
    if (!tokenString || Array.isArray(tokenString)) {
        console.log(`Incoming Websocket upgrade request is missing an authentication token`);
        return ws.close();
    }

    const token = await verifyToken(tokenString);
    if (!token || !token.username) {
        console.log(`Incoming Websocket upgrade request has an invalid token`);
        return ws.close();
    }

    console.log(`Starting collaborative session for doc ${req.params.docName} as user ${token.username}`);
    return setupWSConnection(ws, req, {docName: req.params.docName});
}

export const serverRouter = express.Router();
serverRouter.post("/start", authGuard, noCache, handleStartServer);
serverRouter.post("/stop", authGuard, noCache, handleStopServer);
serverRouter.get("/status", authGuard, noCache, handleCheckServer);
serverRouter.get("/log", authGuard, noCache, handleLog);
