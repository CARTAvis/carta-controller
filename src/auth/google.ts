import {RuntimeConfig, ServerConfig} from "../config";
import {CartaGoogleAuthConfig, ScriptingAccess, Verifier} from "../types";
import {OAuth2Client} from "google-auth-library";
import {generateToken, TokenType} from "./local";
import {getUser, verifyToken} from "./index";
import ms = require("ms");
import * as express from "express";

export async function googleCallbackHandler (req: express.Request, res: express.Response, authConf: CartaGoogleAuthConfig) {
    // Check for g_csrf_token match between cookie and body
    if (!req.cookies["g_csrf_token"] || !req.body["g_csrf_token"] || req.cookies["g_csrf_token"] !== req.body["g_csrf_token"]) {
        return res.status(400).json({"error": "Missing or non-matching CSRF token"})
    }

    const oAuth2Client = new OAuth2Client();
    try {
        const result = await oAuth2Client.verifyIdToken({idToken: req?.body?.credential, audience: authConf.clientId});
        const payload = result.getPayload()

        // Do the mapping
        const username = authConf.useEmailAsId ? payload?.email : payload?.sub;

        // check that username exists and email is verified
        if (!username || !payload?.email_verified) {
            console.log("Google auth rejected due to lack of unique ID or email verification");
            return res.status(500).json({"error": "An error occured processing your login"});
        }
        
        // check that domain is valid
        if (authConf.validDomain && authConf.validDomain !== payload.hd) {
            console.log(`Google auth rejected due to incorrect domain: ${payload.hd}`);
            return res.status(500).json({"error": "An error occured processing your login"});
        }

        // create initial refresh token
        const refreshToken = generateToken(authConf, username, TokenType.Refresh);
        res.cookie("Refresh-Token", refreshToken, {
            path: RuntimeConfig.authPath,
            maxAge: ms(authConf.refreshTokenAge as string),
            httpOnly: true,
            secure: !ServerConfig.httpOnly,
            sameSite: "strict"
        });

        return res.redirect(`${RuntimeConfig.dashboardAddress}?googleuser=${username}`)

    } catch (e) {
        console.debug(e)
        return res.status(500).json({"error": "An error occured processing your login"})
    }
}


export function generateGoogleRefreshHandler(authConf: CartaGoogleAuthConfig) {
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
                    const access_token = generateToken(authConf, refreshToken.username, scriptingToken ? TokenType.Scripting : TokenType.Access);
                    console.log(`Refreshed ${scriptingToken ? "scripting" : "access"} token for user ${refreshToken.username}`);
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
