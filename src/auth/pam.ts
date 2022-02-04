import * as express from "express";
import * as userid from "userid";
import {CartaLocalAuthConfig} from "../types";
import {addTokensToResponse} from "./local";

export function getPamLoginHandler(authConf: CartaLocalAuthConfig) {
    const {pamAuthenticate} = require("node-linux-pam");

    return (req: express.Request, res: express.Response) => {
        let username = req.body?.username;
        const password = req.body?.password;
        const embedRefresh: boolean = req.body?.embedRefresh === true;

        if (!username || !password) {
            return res.status(400).json({statusCode: 400, message: "Malformed login request"});
        }

        pamAuthenticate({username, password}, (err: Error | string, code: number) => {
            if (err) {
                return res.status(403).json({statusCode: 403, message: "Invalid username/password combo"});
            } else {
                try {
                    const uid = userid.uid(username);
                    console.log(`Authenticated as user ${username} with uid ${uid} using PAM`);
                    return addTokensToResponse(res, authConf, username, embedRefresh);
                } catch (e) {
                    return res.status(403).json({statusCode: 403, message: "User does not exist"});
                }
            }
        });
    };
}
