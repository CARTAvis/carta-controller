import * as path from "path";
import * as fs from "fs";
import * as logSymbols from "log-symbols";
import * as userid from "userid";
import {ServerConfig} from "./config";
import {generateToken} from "./auth";
import {MongoClient} from "mongodb";

export async function runTests(username: string) {
    if (ServerConfig.authProviders?.ldap) {
        testUid(username);
        testToken(username);
    }
    await testDatabase();
    testFrontend();
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