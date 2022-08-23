import axios from "axios";
import * as express from "express";
import * as fs from "fs";
import * as jose from 'jose';
import type { GetKeyFunction } from "jose/dist/types/types"

import * as jwt from "jsonwebtoken";
import {VerifyOptions} from "jsonwebtoken";

const { createHash, createPrivateKey, createPublicKey, privateEncrypt, publicEncrypt, KeyLike } = require('crypto');

import {CartaOidcAuthConfig, CartaServerConfig} from "../types";
import {RuntimeConfig, ServerConfig} from "../config";
import {RequestHandler, Verifier, UserMap} from "../types";
import { KeyObject, privateDecrypt } from "crypto";
import { ceil, floor, result } from "lodash";
import { JsonWebTokenError } from "jsonwebtoken";
import { Server } from "http";
import { auth } from "google-auth-library";

let privateKey: KeyObject;
let publicKey: KeyObject;
let jwksManager: GetKeyFunction<jose.JWSHeaderParameters, jose.FlattenedJWSInput>;

let oidcAuthEndpoint: string;
let oidcTokenEndpoint: string;
let oidcLogoutEndpoint: string;

type TokenOptions = {
    authCode?: string;
    oidcVerifier?: string;
    refreshToken?: string;
};

export async function initOidc(authConf: CartaOidcAuthConfig) {
    // Load public & private keys
    publicKey = createPublicKey(fs.readFileSync(authConf.localPublicKeyLocation));
    privateKey = createPrivateKey(fs.readFileSync(authConf.localPrivateKeyLocation));

    // Parse details of IdP from metadata URL
    const idpConfig = await axios.get(authConf.idpUrl + "/.well-known/openid-configuration");
    oidcAuthEndpoint = idpConfig.data['authorization_endpoint'];
    oidcTokenEndpoint = idpConfig.data['token_endpoint'];
    oidcLogoutEndpoint = idpConfig.data['end_session_endpoint'];

    // Init JWKS key management
    console.log(`Setting up JWKS management for ${idpConfig.data['jwks_uri']}`);
    jwksManager = jose.createRemoteJWKSet(new URL(idpConfig.data['jwks_uri']));
}

// A helper function as initial call to the IdP token endpoint and renewals are mostly the same
async function callIdpTokenEndpoint (usp: URLSearchParams, req: express.Request, res: express.Response, authConf: CartaOidcAuthConfig, scriptingToken: boolean = false, isLogin: boolean = false) {
    // Fill in the common request elements
    usp.set("client_id", authConf.clientId);
    usp.set("client_secret", authConf.clientSecret);
    usp.set("scope", authConf.scope);

    try {
        const result = await axios.post(`${oidcTokenEndpoint}`, usp);
        if (result.status != 200) {
            console.log(result)
            console.log("auth error")
            return res.status(403).json({statusCode: 403, message: "Authentication error"});
        }

        const { payload, protectedHeader } = await jose.jwtVerify(result.data['id_token'], jwksManager); 

        // Check audience
        if (payload.aud != authConf.clientId) {
            console.log(result)
            console.log(`invalid payload aud: ${payload.aud}`)
            return res.status(403).json({statusCode: 403, message: "Received an ID token not directed to us"});
        }

        let username = payload[authConf.uniqueField];
        if (username === undefined) {
            return res.status(500).json({statusCode: 500, message: "Unable to determine user ID from upstream token"});
        }

        // Build a pseudo-refresh token
        // If there's no actual refresh token then this will only last for as long as the access token does
        const refreshData = { username };
        if (result.data['refresh_token'] !== undefined) {
            refreshData['refresh_token'] = result.data['refresh_token'];
        }
        const refreshExpiry = result.data['refresh_expires_in'] !== undefined ? result.data['refresh_expires_in'] : result.data['expires_in'];
        refreshData['access_token_expiry'] =  floor(new Date().getTime() / 1000) + result.data['expires_in'];

        // Check group membership
        if (authConf.requiredGroup !== undefined) {
            if (payload[`${authConf.groupsField}`] === undefined) {
                console.log(payload[`${authConf.groupsField}`])
                console.log(result)
                return res.status(403).json({statusCode: 403, message: "Identity Provider did not supply group membership"})
            }
            const idpGroups = payload[`${authConf.groupsField}`];
            if (Array.isArray(idpGroups)) {
                const groupList: string[] = idpGroups;
                if (!groupList.includes(`${authConf.requiredGroup}`)) {
                    console.log(groupList)
                    console.log(authConf.groupsField)
                    console.log(result)
                    return res.status(403).json({statusCode: 403, message: "Not part of required group"})
                } else {
                    console.debug(`Verified membership in ${authConf.requiredGroup}`)
                }
            } else {
                console.log(result)
                console.log("invalid groups")
                return res.status(403).json({statusCode: 403, message: "Invalid group membership info received"})
            }
        }

        const rt = await new jose.SignJWT(refreshData)
            .setProtectedHeader({ alg: 'RS256' })
            .setIssuedAt()
            .setIssuer(authConf.issuer)
            .setExpirationTime(`${refreshExpiry}s`)
            .sign(privateKey);

        res.cookie("Refresh-Token", rt, {
            path: RuntimeConfig.authPath,
            maxAge: parseInt(refreshExpiry) * 1000,
            httpOnly: true,
            secure: !ServerConfig.httpOnly,
            sameSite: "strict"
        });

        if (result.data['id_token'] !== undefined) {
            res.cookie("Logout-Token", result.data['id_token'], {
                path: RuntimeConfig.logoutAddress,
                httpOnly: true,
                secure: !ServerConfig.httpOnly,
                sameSite: "strict"
            });
        }

        // After login redirect to the dashboard, but otherwise return a bearer token
        if (isLogin) {
            return res.redirect(`${new URL(`${RuntimeConfig.dashboardAddress}`, ServerConfig.serverAddress).href}?${new URLSearchParams(`oidcuser=${username}`).toString()}`);
        }
        else {
            let newAccessToken = { username };
            if (scriptingToken)
                newAccessToken['scripting'] = true;
            const newAccessTokenJWT = await new jose.SignJWT(newAccessToken)
                .setProtectedHeader({ alg: authConf.keyAlgorithm })
                .setIssuedAt()
                .setIssuer(authConf.issuer)
                .setExpirationTime(`${result.data['expires_in']}s`)
                .sign(privateKey);
            return res.json({
                access_token: newAccessTokenJWT,
                token_type: "bearer",
                username: payload.username,
                expires_in: result.data['expires_in']
            });
        }

    } catch(err) {
        console.warn(err);
        return res.status(500).json({statusCode: 500, message: "Error requesting tokens from identity provider"});
    }
}

export function generateLocalOidcRefreshHandler (authConf: CartaOidcAuthConfig) {
    return async (req: express.Request, res: express.Response) => {
        console.log("Running OIDC refresh handler")
        const refreshTokenCookie = req.cookies["Refresh-Token"];
        const scriptingToken = req.body?.scripting === true;

        if (refreshTokenCookie) {
            try {
                // Verify that the token is legit
                const { payload, protectedHeader } = await jose.jwtVerify(refreshTokenCookie, publicKey); 

                // Check if access token validity is there and at least cacheAccessTokenMinValidity seconds from expiry
                const remainingValidity = parseInt(`${payload['access_token_expiry']}`) - ceil(new Date().getTime() / 1000);

                if (remainingValidity > authConf.cacheAccessTokenMinValidity) {
                    let newAccessToken = {
                        username: payload.username,
                        expires_in: remainingValidity
                    };
                    if (scriptingToken)
                        newAccessToken['scripting'] = true;
                    const newAccessTokenJWT = await new jose.SignJWT(newAccessToken)
                        .setProtectedHeader({ alg: authConf.keyAlgorithm })
                        .setIssuedAt()
                        .setIssuer(`${ServerConfig.authProviders.oidc?.issuer}`)
                        .setExpirationTime(`${remainingValidity}s`)
                        .sign(privateKey);
        
                    return res.json({
                        access_token: newAccessTokenJWT,
                        token_type: "bearer",
                        username: payload.username,
                        expires_in: remainingValidity
                    });
                }

                // Need to request a new token from upstream
                if (payload['refresh_token'] !== undefined) {
                    const usp = new URLSearchParams();
                    usp.set("grant_type", "refresh_token");
                    usp.set("refresh_token", `${payload['refresh_token']}`);

                    return await callIdpTokenEndpoint(usp, req, res, authConf, scriptingToken);
                }

                // No refresh token available so redirect to login
                return res.redirect((new URL(RuntimeConfig.apiAddress + '/auth/login', ServerConfig.serverAddress)).href);
            } catch (err) {
                return res.status(400).json({statusCode: 400, message: "Invalid refresh token"});
            }
        } else {
            return res.status(400).json({statusCode: 400, message: "Missing refresh token"});
        }
    }
}

export function generateLocalOidcVerifier (verifierMap: Map<string, Verifier>, authConf: CartaOidcAuthConfig) {
    // Note that we need only verify the tokens we've wrapped ourselves here
    verifierMap.set(authConf.issuer, async cookieString => {
        const result = await jose.jwtVerify(cookieString, privateKey, {
            issuer: authConf.issuer,
            algorithms: [authConf.keyAlgorithm]
        });
        return result.payload;
    });
}

export function oidcLoginStart (req: express.Request, res: express.Response, authConf: CartaOidcAuthConfig) {
    const usp = new URLSearchParams();

    // Generate PKCE verifier & challenge
    const urlSafeChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
    const codeVerifier = Array.from({length:64}, (_,i) => urlSafeChars[Math.floor(Math.random() * urlSafeChars.length)]).join("");
    // depending on how pedantic we want to be we could encrypt there before cookifying it
    const encryptedCodeVerifier = publicEncrypt(publicKey,Buffer.from(codeVerifier, 'utf-8'))

    res.cookie('oidcVerifier', encryptedCodeVerifier, {
        maxAge: 600000,
        httpOnly: true,
        secure: !ServerConfig.httpOnly,
    });
    const codeChallenge = createHash('sha256')
                          .update(codeVerifier, 'utf-8')
                          .digest('base64url')
    usp.set('code_challenge_method', 'S256');
    usp.set('code_challenge', codeChallenge);

    usp.set('client_id', authConf.clientId);
    usp.set('redirect_uri', (new URL(RuntimeConfig.apiAddress + '/auth/oidcCallback', ServerConfig.serverAddress)).href);
    usp.set('response_type', 'code');
    usp.set('scope', authConf.scope);

    // Return redirect
    return res.redirect(`${oidcAuthEndpoint}?${usp.toString()}`);
}

export async function oidcCallbackHandler(req: express.Request, res: express.Response, authConf: CartaOidcAuthConfig) {
    console.log("Running OIDC callback handler");
    const usp = new URLSearchParams();

    if (req.cookies['oidcVerifier'] === undefined) {
        return res.status(400).json({statusCode: 400, message: "Missing OIDC verifier"});
    }

    const encryptedCodeVerifier = Buffer.from(req.cookies['oidcVerifier'], 'base64url');
    const codeVerifier = privateDecrypt(privateKey, encryptedCodeVerifier).toString('utf-8');

    usp.set('code_verifier', codeVerifier);
    res.clearCookie("oidcVerifier");
    usp.set("code", `${req.query.code}`);
    usp.set("grant_type", "authorization_code");
    usp.set('redirect_uri', (new URL(RuntimeConfig.apiAddress + '/auth/oidcCallback', ServerConfig.serverAddress)).href);

    return await callIdpTokenEndpoint (usp, req, res, authConf, false, true);
}

export async function oidcLogoutHandler(req: express.Request, res: express.Response) {
    res.cookie("Refresh-Token", "", {
        path: RuntimeConfig.authPath,
        maxAge: 0,
        httpOnly: true,
        secure: !ServerConfig.httpOnly,
        sameSite: "strict"
    });

    if (oidcLogoutEndpoint !== undefined) {
        // Redirect to the IdP to perform the logout
        let usp = new URLSearchParams();
        if (req.cookies['Logout-Token'] !== undefined) {
            usp.set('id_token_hint', req.cookies['Logout-Token'])
        }
        usp.set('post_logout_redirect_uri', `${ServerConfig.serverAddress}`);
        
        res.cookie("Logout-Token", "", {
            path: RuntimeConfig.logoutAddress,
            maxAge: 0,
            httpOnly: true,
            secure: !ServerConfig.httpOnly,
            sameSite: "strict"
        });

        return res.redirect(`${oidcLogoutEndpoint}?${usp.toString()}`);

    } else {
        return res.redirect(`${ServerConfig.serverAddress}`);
    }
}
