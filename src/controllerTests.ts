import * as path from "path";
import * as fs from "fs";
import {MongoClient} from "mongodb";
import * as LdapAuth from "ldapauth-fork";
import * as logSymbols from "log-symbols";
import * as userid from "userid";
import * as chalk from "chalk";
import * as moment from "moment";
import {ServerConfig, testUser} from "./config";
import {generateToken} from "./auth";
import {ChildProcess, spawn, spawnSync} from "child_process";
import {delay} from "./util";
import {client} from "websocket";

const read = require("read");

export async function runTests(username: string) {
    console.log(`Testing configuration with user ${chalk.bold(testUser)}`);
    if (ServerConfig.authProviders?.ldap) {
        await testLdap(username);
        testUid(username);
        testToken(username);
    }
    await testDatabase();
    if (ServerConfig.logFileTemplate) {
        testLog(username);
    }
    testFrontend();
    const backendProcess = await testBackendStartup(username);
    await testKillScript(username, backendProcess);
}

function testLog(username: string) {
    const logLocation = ServerConfig.logFileTemplate
        .replace("{username}", username)
        .replace("{pid}", "9999")
        .replace("{datetime}", moment().format("YYYYMMDD.h_mm_ss"));

    try {
        const logStream = fs.createWriteStream(logLocation, {flags: "a"});
        logStream.write("test");
        logStream.close();
        fs.unlinkSync(logLocation);
        console.log(logSymbols.success, `Checked log writing for user ${username}`);
    } catch (err) {
        throw new Error(`Could not create log file at ${logLocation} for user ${username}. Please check your config file's logFileTemplate option`);
    }
}

function testLdap(username: string) {
    return new Promise<void>((resolve, reject) => {
        const ldapAuth = ServerConfig.authProviders?.ldap;
        if (ldapAuth) {
            let ldap: LdapAuth;
            try {
                ldap = new LdapAuth(ldapAuth.ldapOptions);
                setTimeout(() => {
                    read({prompt: `Password for user ${username}:`, silent: true}, (er: any, password: string) => {
                        ldap.authenticate(username, password, (error, result) => {
                            if (error) {
                                reject(new Error(`Could not authenticate as user ${username}. Please check your config file's ldapOptions section!`));
                            } else {
                                console.log(logSymbols.success, `Checked LDAP connection for user ${username}`);
                                resolve();
                            }
                        });
                    })
                }, 5000);
            } catch (e) {
                reject(new Error("Cannot create LDAP object. Please check your config file's ldapOptions section!"));
            }
        }
    });
}

async function testDatabase() {
    try {
        const client = await MongoClient.connect(ServerConfig.database.uri, {useUnifiedTopology: true});
        const db = await client.db(ServerConfig.database.databaseName);
        await db.listCollections({}, {nameOnly: true}).hasNext();
    } catch (e) {
        throw new Error("Cannot connect to MongoDB. Please check your config file's database section!");
    }
    console.log(logSymbols.success, "Checked database connection");
}

function testUid(username: string) {
    let uid: number;
    try {
        uid = userid.uid(username);
    } catch (e) {
        throw new Error(`Cannot verify uid of user ${username}`);
    }
    if (!uid) {
        throw new Error(`Cannot verify uid of user ${username}`);
    }
    console.log(logSymbols.success, `Verified uid (${uid}) for user ${username}`);
}

function testToken(username: string) {
    let token;
    try {
        token = generateToken(username, false);
    } catch (e) {
        throw new Error(`Cannot generate access token. Please check your config file's ldap auth section!`);
    }
    if (!token) {
        throw new Error(`Cannot generate access token. Please check your config file's ldap auth section!`);
    }
    console.log(logSymbols.success, `Generated access token for user ${username}`);
}

function testFrontend() {
    if (!ServerConfig.frontendPath) {
        ServerConfig.frontendPath = path.join(__dirname, "../node_modules/carta-frontend/build");
    }

    let indexContents: string;
    try {
        indexContents = fs.readFileSync(ServerConfig.frontendPath + "/index.html").toString();
    } catch (e) {
        throw new Error(`Cannot access frontend at ${ServerConfig.frontendPath}`);
    }

    if (!indexContents) {
        throw new Error(`Cannot access frontend at ${ServerConfig.frontendPath}`);
    } else {
        console.log(logSymbols.success, `Read frontend index.html from ${ServerConfig.frontendPath}`);
    }
}


async function testBackendStartup(username: string) {
    const port = ServerConfig.backendPorts.max - 1;
    let args = [
        "--preserve-env=CARTA_AUTH_TOKEN",
        "-u", `${username}`,
        ServerConfig.processCommand,
        "--no_http", "true",
        "--debug_no_auth", "true",
        "--no_log", ServerConfig.logFileTemplate ? "true" : "false",
        "--port", `${port}`,
        "--top_level_folder", ServerConfig.rootFolderTemplate.replace("{username}", username),
        ServerConfig.baseFolderTemplate.replace("{username}", username),
    ];

    if (ServerConfig.additionalArgs) {
        args = args.concat(ServerConfig.additionalArgs);
    }

    const backendProcess = spawn("sudo", args);
    await delay(2000);
    if (backendProcess.signalCode) {
        throw new Error("Backend process terminated. Please check your sudoers config, processCommand option and additionalArgs section")
    } else {
        console.log(logSymbols.success, "Backend process started successfully");
    }

    const wsClient = new client();
    let wsConnected = false;
    wsClient.on("connect", () => {
        wsConnected = true;
    });

    wsClient.connect(`ws://localhost:${port}`);
    await delay(1000);
    if (wsConnected) {
        console.log(logSymbols.success, "Backend process accepted connection");
    } else {
        throw new Error("Cannot connect to backend process. Please check your additionalArgs section. If sudo is prompting you for a password, please check your sudoers config");
    }

    return backendProcess;
}

async function testKillScript(username: string, existingProcess: ChildProcess) {
    if (existingProcess.signalCode) {
        throw new Error("Backend process already killed");
    }
    const res = spawnSync("sudo", ["-u", `${username}`, ServerConfig.killCommand, `${existingProcess.pid}`]);
    if (res.status) {
        throw  new Error("Cannot execute kill script. Please check your killCommand option");
    }
    // Delay to allow the parent process to exit
    await delay(1000);
    if (existingProcess.signalCode === "SIGKILL") {
        console.log(logSymbols.success, "Backend process killed correctly");
    } else {
        throw  new Error("Failed to kill process. Please check your killCommand option. If sudo is prompting you for a password, please check your sudoers config")
    }
}