import {type ChildProcess, spawn, spawnSync} from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import LdapAuth from "ldapauth-fork";
import * as logSymbols from "log-symbols";
import moment from "moment";
import {MongoClient} from "mongodb";
import {client} from "websocket";
import {generateToken, TokenType} from "./auth/local";
import {ServerConfig, testUser} from "./config";
import type {CartaLdapAuthConfig, CartaLocalAuthConfig} from "./types";
import {delay, getUserId, logger} from "./util";

import read = require("read");

export async function runTests(username: string) {
    logger.info(`Testing configuration with user ${testUser}`);
    if (ServerConfig.authProviders?.ldap) {
        await testLdap(ServerConfig.authProviders.ldap, username);
        testUid(username);
        testToken(ServerConfig.authProviders.ldap, username);
    } else if (ServerConfig.authProviders?.pam) {
        await testPam(ServerConfig.authProviders.pam, username);
        testUid(username);
        testToken(ServerConfig.authProviders.pam, username);
    }
    await testDatabase();
    if (ServerConfig.backendLogFileTemplate) {
        await testLog(username);
    }
    testFrontend();
    const backendProcess = await testBackendStartup(username);
    await testKillScript(username, backendProcess);
}

async function testLog(username: string) {
    const logLocation = ServerConfig.backendLogFileTemplate.replace("{username}", username).replace("{pid}", "9999").replace("{datetime}", moment().format("YYYYMMDD.h_mm_ss"));

    try {
        const logStream = fs.createWriteStream(logLocation, {flags: "a"});
        // Transform callbacks into awaits
        await new Promise(res => logStream.write("test", res));
        await new Promise(res => logStream.end(res));
        fs.unlinkSync(logLocation);
        logger.info(`${logSymbols.success} Checked log writing for user ${username}`);
    } catch (err) {
        logger.debug(err);
        throw new Error(`Could not create log file at ${logLocation} for user ${username}. Please check your config file's backendLogFileTemplate option`);
    }
}

function testLdap(authConf: CartaLdapAuthConfig, username: string) {
    return new Promise<void>((resolve, reject) => {
        if (authConf) {
            let ldap: LdapAuth;
            try {
                ldap = new LdapAuth(authConf.ldapOptions);
                setTimeout(() => {
                    read({prompt: `Password for user ${username}:`, silent: true}).then(password => {
                        ldap.authenticate(username, password, (error, user) => {
                            if (error) {
                                logger.debug(error);
                                reject(new Error(`Could not authenticate as user ${username}. Please check your config file's ldapOptions section!`));
                            } else {
                                logger.info(`${logSymbols.success} Checked LDAP connection for user ${username}`);
                                if (user?.uid !== username) {
                                    logger.warning(`${logSymbols.warning} Returned user "uid ${user?.uid}" does not match username "${username}"`);
                                    logger.debug(user);
                                }
                                resolve();
                            }
                        });
                    });
                }, 5000);
            } catch (e) {
                logger.debug(e);
                reject(new Error("Cannot create LDAP object. Please check your config file's ldapOptions section!"));
            }
        }
    });
}

function testPam(authConf: CartaLocalAuthConfig, username: string) {
    const {pamAuthenticate} = require("node-linux-pam");

    return new Promise<void>((resolve, reject) => {
        if (authConf) {
            read({prompt: `Password for user ${username}:`, silent: true}).then(password => {
                pamAuthenticate({username, password}, (err: Error | string, code: number) => {
                    if (err) {
                        logger.debug(err);
                        reject(new Error(`Could not authenticate as user ${username}. Error code ${code}`));
                    } else {
                        logger.info(`${logSymbols.success} Checked PAM connection for user ${username}`);
                        resolve();
                    }
                });
            });
        }
    });
}

async function testDatabase() {
    try {
        const client = await MongoClient.connect(ServerConfig.database.uri);
        const db = await client.db(ServerConfig.database.databaseName);
        await db.listCollections({}, {nameOnly: true}).hasNext();
    } catch (e) {
        logger.debug(e);
        throw new Error("Cannot connect to MongoDB. Please check your config file's database section!");
    }
    logger.info(`${logSymbols.success} Checked database connection`);
}

function testUid(username: string) {
    let uid: number;
    try {
        uid = getUserId(username);
    } catch (e) {
        logger.debug(e);
        throw new Error(`Cannot verify uid of user ${username}`);
    }
    logger.info(`${logSymbols.success} Verified uid (${uid}) for user ${username}`);
}

function testToken(authConf: CartaLocalAuthConfig, username: string) {
    let token: string;
    try {
        token = generateToken(authConf, username, TokenType.Access);
    } catch (e) {
        logger.debug(e);
        throw new Error("Cannot generate access token. Please check your config file's auth section!");
    }
    if (!token) {
        throw new Error("Invalid access token. Please check your config file's auth section!");
    }
    logger.info(`${logSymbols.success} Generated access token for user ${username}`);
}

function testFrontend() {
    if (!ServerConfig.frontendPath) {
        ServerConfig.frontendPath = path.join(__dirname, "../node_modules/carta-frontend/build");
    }

    let indexContents: string;
    try {
        indexContents = fs.readFileSync(`${ServerConfig.frontendPath}/index.html`).toString();
    } catch (e) {
        logger.debug(e);
        throw new Error(`Cannot access frontend at ${ServerConfig.frontendPath}`);
    }

    if (!indexContents) {
        throw new Error(`Invalid frontend at ${ServerConfig.frontendPath}`);
    } else {
        logger.info(`${logSymbols.success} Read frontend index.html from ${ServerConfig.frontendPath}`);
    }
}

async function testBackendStartup(username: string) {
    const port = ServerConfig.backendPorts.max - 1;

    let args: string[] = [];
    if (ServerConfig.preserveEnv) {
        args.push("--preserve-env=CARTA_AUTH_TOKEN");
    }

    args = args.concat([
        "-n", // run non-interactively. If password is required, sudo will bail
        "-u",
        `${username}`,
        ServerConfig.processCommand,
        "--no_frontend",
        "--no_database",
        "--debug_no_auth",
        "--port",
        `${port}`,
        "--top_level_folder",
        ServerConfig.rootFolderTemplate.replace("{username}", username),
        "--controller_deployment"
    ]);

    if (ServerConfig.backendLogFileTemplate) {
        args.push("--no_log");
    }

    if (ServerConfig.additionalArgs) {
        args = args.concat(ServerConfig.additionalArgs);
    }

    // Finally, add the positional argument for the base folder
    args.push(ServerConfig.baseFolderTemplate.replace("{username}", username));

    logger.debug(`running sudo ${args.join(" ")}`);

    // Use same stdout and stderr stream for the backend process
    const backendProcess = spawn("sudo", args, {stdio: "inherit"});
    await delay(2000);
    if (backendProcess.signalCode) {
        throw new Error(`Backend process terminated with code ${backendProcess.signalCode}. Please check your sudoers config, processCommand option and additionalArgs section`);
    } else {
        logger.info(`${logSymbols.success} Backend process started successfully`);
    }

    const wsClient = new client();
    let wsConnected = false;
    wsClient.on("connect", () => {
        wsConnected = true;
    });
    wsClient.on("connectFailed", e => {
        logger.debug(e);
    });

    wsClient.connect(`ws://localhost:${port}`);
    await delay(1000);
    if (wsConnected) {
        logger.info(`${logSymbols.success} Backend process accepted connection`);
    } else {
        throw new Error("Cannot connect to backend process. Please check your additionalArgs section. If sudo is prompting you for a password, please check your sudoers config");
    }

    return backendProcess;
}

async function testKillScript(username: string, existingProcess: ChildProcess) {
    if (existingProcess.signalCode) {
        throw new Error(`Backend process already killed, signal code ${existingProcess.signalCode}`);
    }
    const args = ["-u", `${username}`, ServerConfig.killCommand, `${existingProcess.pid}`];
    logger.debug(`running sudo ${args.join(" ")}`);
    const res = spawnSync("sudo", args, {encoding: "utf8"});
    if (res.error) {
        logger.debug(res.error);
        logger.debug(`stdout:\t${res.stdout}`);
        logger.debug(`stderr:\t${res.stderr}`);
    }
    if (res.status) {
        throw new Error(`Cannot execute kill script (error status ${res.status}. Please check your killCommand option`);
    }
    // Delay to allow the parent process to exit
    await delay(1000);
    if (existingProcess.signalCode === "SIGKILL") {
        logger.info(`${logSymbols.success} Backend process killed correctly`);
    } else {
        throw new Error("Failed to kill process. Please check your killCommand option. If sudo is prompting you for a password, please check your sudoers config");
    }
}
