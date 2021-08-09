import * as express from "express";
import * as userid from "userid";
import * as LdapAuth from "ldapauth-fork";
import {CartaLdapAuthConfig} from "../types";
import {addTokensToResponse} from "./local";
import {verboseError, verboseLog} from "../util";


let ldap: LdapAuth;

export function getLdapLoginHandler(authConf: CartaLdapAuthConfig) {
    ldap = new LdapAuth(authConf.ldapOptions);
    ldap.on('error', err => console.error('LdapAuth: ', err));
    setTimeout(() => {
        const ldapConnected = (ldap as any)?._userClient?.connected;
        if (ldapConnected) {
            console.log("LDAP connected correctly");
        } else {
            console.error("LDAP not connected!");
        }
    }, 2000);

    return (req: express.Request, res: express.Response) => {
        let username = req.body?.username;
        const password = req.body?.password;

        if (!username || !password) {
            return res.status(400).json({statusCode: 400, message: "Malformed login request"});
        }

        const handleAuth = (err: Error | string, user: any) => {
            if (err) {
                console.error(err);
                return res.status(403).json({statusCode: 403, message: "Invalid username/password combo"});
            }
            if (user?.uid !== username) {
                console.warn(`Returned user "uid ${user?.uid}" does not match username "${username}"`);
                verboseLog(user);
            }
            try {
                const uid = userid.uid(username);
                console.log(`Authenticated as user ${username} with uid ${uid} using LDAP`);
                return addTokensToResponse(authConf, username, res);
            } catch (e) {
                verboseError(e);
                return res.status(403).json({statusCode: 403, message: "User does not exist"});
            }
        }

        ldap.authenticate(username, password, (error, user) => {
            const errorObj = error as Error;
            // Need to reconnect to LDAP when we get a TLS error
            if (errorObj?.name?.includes("ConfidentialityRequiredError")) {
                console.log(`TLS error encountered. Reconnecting to the LDAP server!`);
                ldap.close();
                ldap = new LdapAuth(authConf.ldapOptions);
                ldap.on('error', err => console.error('LdapAuth: ', err));
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