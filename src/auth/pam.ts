import type {Request, Response} from "express";
import type {CartaLocalAuthConfig} from "../types";
import {getUserId, logger} from "../util";
import {addTokensToResponse} from "./local";

export function getPamLoginHandler(authConf: CartaLocalAuthConfig) {
    const {pamAuthenticate} = require("node-linux-pam");

    return (req: Request, res: Response) => {
        const username = req.body?.username;
        const password = req.body?.password;

        if (!username || !password) {
            return res.status(400).json({statusCode: 400, message: "Malformed login request"});
        }

        pamAuthenticate({username, password}, (err: Error | string, code: number) => {
            if (err) {
                return res.status(403).json({
                    statusCode: 403,
                    message: "Invalid username/password combo"
                });
            } else {
                try {
                    const uid = getUserId(username);
                    logger.info(`Authenticated as user ${username} with uid ${uid} using PAM`);
                    return addTokensToResponse(res, authConf, username);
                } catch (e) {
                    logger.debug(`A PAM-related error occurred: ${e} (code ${code})`);
                    return res.status(403).json({statusCode: 403, message: "User does not exist"});
                }
            }
        });
    };
}
