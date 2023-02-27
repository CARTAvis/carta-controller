import {AuthenticatedRequest, CartaLocalAuthConfig, ScriptingAccess, Verifier} from "../types";
import * as fs from "fs";
import * as jwt from "jsonwebtoken";
import {VerifyOptions} from "jsonwebtoken";
import * as express from "express";
import {verifyToken} from "./index";
import {RuntimeConfig, ServerConfig} from "../config";
import ms = require("ms");
import {getUserId} from "../util";

let privateKey: Buffer;

export enum TokenType {
    Access,
    Refresh,
    Scripting
}

export function generateToken(authConf: CartaLocalAuthConfig, username: string, tokenType: TokenType) {
    if (!privateKey) {
        privateKey = fs.readFileSync(authConf.privateKeyLocation);
    }
    if (!authConf || !privateKey) {
        return null;
    }

    const payload: any = {
        iss: authConf.issuer,
        username
    };

    const options: jwt.SignOptions = {
        algorithm: authConf.keyAlgorithm,
        expiresIn: authConf.accessTokenAge
    };

    if (tokenType === TokenType.Refresh) {
        payload.refresh = true;
        options.expiresIn = authConf.refreshTokenAge;
    } else if (tokenType === TokenType.Scripting) {
        payload.scripting = true;
        options.expiresIn = authConf.scriptingTokenAge;
    }

    return jwt.sign(payload, privateKey, options);
}

export function addTokensToResponse(res: express.Response, authConf: CartaLocalAuthConfig, username: string) {
    const refreshToken = generateToken(authConf, username, TokenType.Refresh);
    res.cookie("Refresh-Token", refreshToken, {
        path: RuntimeConfig.authPath,
        maxAge: ms(authConf.refreshTokenAge as string),
        httpOnly: true,
        secure: !ServerConfig.httpOnly,
        sameSite: "strict"
    });

    const access_token = generateToken(authConf, username, TokenType.Access);

    res.json({
        access_token,
        token_type: "bearer",
        expires_in: ms(authConf.accessTokenAge as string) / 1000
    });
}

export function generateLocalVerifier(verifierMap: Map<string, Verifier>, authConf: CartaLocalAuthConfig) {
    const publicKey = fs.readFileSync(authConf.publicKeyLocation);
    verifierMap.set(authConf.issuer, cookieString => {
        const payload: any = jwt.verify(cookieString, publicKey, {algorithm: authConf.keyAlgorithm} as VerifyOptions);
        if (payload && payload.iss === authConf.issuer) {
            return payload;
        } else {
            return undefined;
        }
    });
}

export function generateLocalRefreshHandler(authConf: CartaLocalAuthConfig) {
    return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const refreshTokenCookie = req.cookies["Refresh-Token"];
        const scriptingToken = req.body?.scripting === true;
        if (refreshTokenCookie) {
            try {
                const refreshToken = await verifyToken(refreshTokenCookie);
                if (!refreshToken || !refreshToken.username || !refreshToken.refresh) {
                    next({statusCode: 403, message: "Not authorized"});
                } else if (scriptingToken && ServerConfig.scriptingAccess !== ScriptingAccess.Enabled) {
                    next({statusCode: 500, message: "Scripting access not enabled for this server"});
                } else {
                    const uid = getUserId(refreshToken.username);
                    const access_token = generateToken(authConf, refreshToken.username, scriptingToken ? TokenType.Scripting : TokenType.Access);
                    console.log(`Refreshed ${scriptingToken ? "scripting" : "access"} token for user ${refreshToken.username} with uid ${uid}`);
                    res.json({
                        access_token,
                        token_type: "bearer",
                        username: refreshToken.username,
                        expires_in: ms(scriptingToken ? authConf.scriptingTokenAge : (authConf.accessTokenAge as string)) / 1000
                    });
                }
            } catch (err) {
                next({statusCode: 400, message: "Invalid refresh token"});
            }
        } else {
            next({statusCode: 400, message: "Missing refresh token"});
        }
    };
}
