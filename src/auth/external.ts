import * as fs from "fs";
import {CartaExternalAuthConfig, UserMap, Verifier} from "../types";
import * as jwt from "jsonwebtoken";
import {VerifyOptions} from "jsonwebtoken";

function populateUserMap(userMaps: Map<string, UserMap>, issuer: string | string[], filename: string) {
    const userMap = new Map<string, string>();
    try {
        const contents = fs.readFileSync(filename).toString();
        const lines = contents.split("\n");
        for (let line of lines) {
            line = line.trim();

            // Skip comments
            if (line.startsWith("#")) {
                continue;
            }

            // Ensure line is in format <username1> <username2>
            const entries = line.split(" ");
            if (entries.length !== 2) {
                console.log(`Ignoring malformed usermap line: ${line}`);
                continue;
            }
            userMap.set(entries[0], entries[1]);
        }
        console.log(`Updated usermap with ${userMap.size} entries`);
    } catch (e) {
        console.log(`Error reading user table`);
    }

    if (Array.isArray(issuer)) {
        for (const iss of issuer) {
            userMaps.set(iss, userMap);
        }
    } else {
        userMaps.set(issuer, userMap);
    }
}

export function watchUserTable(userMaps: Map<string, UserMap>, issuers: string | string[], filename: string) {
    populateUserMap(userMaps, issuers, filename);
    fs.watchFile(filename, () => populateUserMap(userMaps, issuers, filename));
}

export function generateExternalVerifiers(verifierMap: Map<string, Verifier>, authConf: CartaExternalAuthConfig) {
    const publicKey = fs.readFileSync(authConf.publicKeyLocation);
    const verifier = (cookieString: string) => {
        const payload: any = jwt.verify(cookieString, publicKey, {algorithm: authConf.keyAlgorithm} as VerifyOptions);
        if (payload && payload.iss && authConf.issuers.includes(payload.iss)) {
            // substitute unique field in for username
            if (authConf.uniqueField) {
                payload.username = payload[authConf.uniqueField];
            }
            return payload;
        } else {
            return undefined;
        }
    };

    for (const iss of authConf.issuers) {
        verifierMap.set(iss, verifier);
    }
}
