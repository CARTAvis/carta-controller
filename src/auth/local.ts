import {CartaLocalAuthConfig, Verifier} from "../types";
import * as fs from "fs";
import * as jwt from "jsonwebtoken";
import {VerifyOptions} from "jsonwebtoken";
import * as express from "express";
import * as userid from "userid";
import {verifyToken} from "./index";
import ms = require("ms");
import {RuntimeConfig, ServerConfig} from "../config";

let privateKey: Buffer;

export function generateToken(authConf: CartaLocalAuthConfig, username: string, refreshToken: boolean) {
    if (!privateKey) {
        privateKey = fs.readFileSync(authConf.privateKeyLocation);
    }
    if (!authConf || !privateKey) {
        return null;
    }
    return jwt.sign(
        {
            iss: authConf.issuer,
            username,
            refreshToken
        },
        privateKey,
        {
            algorithm: authConf.keyAlgorithm,
            expiresIn: refreshToken ? authConf.refreshTokenAge : authConf.accessTokenAge
        }
    );
}

export function addTokensToResponse(authConf: CartaLocalAuthConfig, username: string, res: express.Response) {
    const refreshToken = generateToken(authConf, username, true);
    res.cookie("Refresh-Token", refreshToken, {
        path: RuntimeConfig.authPath,
        maxAge: ms(authConf.refreshTokenAge as string),
        httpOnly: true,
        secure: !ServerConfig.httpOnly,
        sameSite: "strict"
    });

    const access_token = generateToken(authConf, username, false);
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

        if (refreshTokenCookie) {
            try {
                const refreshToken = await verifyToken(refreshTokenCookie);
                if (!refreshToken || !refreshToken.username || !refreshToken.refreshToken) {
                    next({statusCode: 403, message: "Not authorized"});
                } else {
                    const uid = userid.uid(refreshToken.username);
                    const access_token = generateToken(authConf, refreshToken.username, false);
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
