import {AuthenticatedRequest, CartaLocalAuthConfig, ScriptingAccess, Verifier} from "../types";
import * as fs from "fs";
import * as jwt from "jsonwebtoken";
import {VerifyOptions} from "jsonwebtoken";
import * as express from "express";
import * as userid from "userid";
import {verifyToken} from "./index";
import {RuntimeConfig, ServerConfig} from "../config";
import ms = require("ms");

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

export function addTokensToResponse(res: express.Response, authConf: CartaLocalAuthConfig, username: string, addRefreshToBody: boolean = false) {
    const refreshToken = generateToken(authConf, username, TokenType.Refresh);
    res.cookie("Refresh-Token", refreshToken, {
        path: RuntimeConfig.authPath,
        maxAge: ms(authConf.refreshTokenAge as string),
        httpOnly: true,
        secure: !ServerConfig.httpOnly,
        sameSite: "strict"
    });

    const access_token = generateToken(authConf, username, TokenType.Access);
    const body: any = {
        access_token,
        token_type: "bearer",
        expires_in: ms(authConf.accessTokenAge as string) / 1000
    };
    if (addRefreshToBody) {
        body.refresh_token = refreshToken;
    }

    res.json(body);
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

        if (refreshTokenCookie) {
            try {
                const refreshToken = await verifyToken(refreshTokenCookie);
                if (!refreshToken || !refreshToken.username || !refreshToken.refreshToken) {
                    next({statusCode: 403, message: "Not authorized"});
                } else {
                    const uid = userid.uid(refreshToken.username);
                    const access_token = generateToken(authConf, refreshToken.username, TokenType.Access);
                    console.log(`Refreshed access token for user ${refreshToken.username} with uid ${uid}`);
                    res.json({
                        access_token,
                        token_type: "bearer",
                        username: refreshToken.username,
                        expires_in: ms(authConf.accessTokenAge as string) / 1000
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

export function generateLocalTokenHandler(authConfig: CartaLocalAuthConfig) {
    return async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
        // TODO: Handle opt-in scripting access
        if (ServerConfig.scriptingAccess !== ScriptingAccess.Enabled) {
            return next({statusCode: 500, message: "Scripting access not enabled for this server"});
        }
        if (!req.username) {
            return next({statusCode: 403, message: "Not authorized"});
        }

        const token = generateToken(authConfig, req.username, TokenType.Scripting);
        return res.json({
            token,
            token_type: "bearer",
            username: req.username,
            expires_in: ms(authConfig.scriptingTokenAge as string) / 1000
        });
    };
}
