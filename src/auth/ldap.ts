import type express from "express";
import LdapAuth from "ldapauth-fork";
import type {Client, SearchEntryObject} from "ldapjs";
import type {CartaLdapAuthConfig} from "../types";
import {getUserId, logger} from "../util";
import {addTokensToResponse} from "./local";

interface LdapAuthWithClient extends LdapAuth {
    _userClient?: Client & {connected?: boolean};
}
let ldap: LdapAuthWithClient;

export function getLdapLoginHandler(authConf: CartaLdapAuthConfig) {
    ldap = new LdapAuth(authConf.ldapOptions);
    ldap.on("error", err => logger.error("LdapAuth: ", err));
    setTimeout(() => {
        const ldapConnected = ldap?._userClient?.connected;
        if (ldapConnected) {
            logger.info("LDAP connected correctly");
        } else {
            logger.error("LDAP not connected!");
        }
    }, 2000);

    return (req: express.Request, res: express.Response) => {
        const username = req.body?.username;
        const password = req.body?.password;

        if (!username || !password) {
            return res.status(400).json({statusCode: 400, message: "Malformed login request"});
        }

        const handleAuth = (err: Error | string, user: SearchEntryObject | null) => {
            if (err) {
                logger.error(err);
                return res.status(403).json({
                    statusCode: 403,
                    message: "Invalid username/password combo"
                });
            }
            if (user?.uid !== username) {
                logger.warning(`Returned user "uid ${user?.uid}" does not match username "${username}"`);
                logger.debug(user);
            }
            try {
                const uid = getUserId(username);
                logger.info(`Authenticated as user ${username} with uid ${uid} using LDAP`);
                return addTokensToResponse(res, authConf, username);
            } catch (e) {
                logger.debug(e);
                return res.status(403).json({statusCode: 403, message: "User does not exist"});
            }
        };

        ldap.authenticate(username, password, (error, user) => {
            const errorObj = error as Error;
            // Need to reconnect to LDAP when we get a TLS error
            if (errorObj?.name?.includes("ConfidentialityRequiredError")) {
                logger.warning(`TLS error encountered. Reconnecting to the LDAP server!`);
                ldap.close();
                ldap = new LdapAuth(authConf.ldapOptions);
                ldap.on("error", err => logger.error("LdapAuth: ", err));
                // Wait for the connection to be re-established
                setTimeout(() => {
                    ldap.authenticate(username, password, handleAuth);
                }, 500);
            } else {
                handleAuth(error, user);
            }
        });
    };
}
