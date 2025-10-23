import * as fs from "node:fs";
import jwt, {type JwtPayload, type VerifyOptions} from "jsonwebtoken";
import type {CartaExternalAuthConfig, UserMap, Verifier} from "../types";
import {logger} from "../util";

export function populateUserMap(userMaps: Map<string, UserMap>, issuer: string | string[], filename: string) {
    const userMap = new Map<string, string>();

    const commentRegex = new RegExp(/\s*#.*$/);
    const fieldRegex = new RegExp(/^(.*?)\s+(\S+)$/);

    try {
        const contents = fs.readFileSync(filename).toString();
        const lines = contents.split("\n");
        for (let line of lines) {
            // Trim leading and trailing whitespace
            line = line.trim();

            // Strip comments
            line = line.replace(commentRegex, "");

            // Skip empty lines
            if (!line) {
                continue;
            }

            // Valid entry format: <username1> <username2>
            // <username1> can be an arbitrary JSON string.
            // <username2> is a POSIX username which definitely contains no spaces.
            // The field separator can be any amount of whitespace.
            const entry = line.match(fieldRegex);
            if (!entry) {
                logger.warning(`Ignoring malformed usermap line: ${line}`);
                continue;
            }

            // Captured groups are 1-indexed (0 is the whole match)
            userMap.set(entry[1], entry[2]);
        }
        logger.info(`Updated usermap with ${userMap.size} entries`);
    } catch (e) {
        logger.debug(e);
        logger.error(`Error reading user table`);
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
        const payload: JwtPayload | string = jwt.verify(cookieString, publicKey, {
            algorithm: authConf.keyAlgorithm
        } as VerifyOptions);
        if (typeof payload !== "string" && payload.iss && authConf.issuers.includes(payload.iss)) {
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
