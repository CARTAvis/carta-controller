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

export function generateLocalOidcRefreshHandler (authConf: CartaOidcAuthConfig) {
    return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        console.log("Running OIDC refresh handler")
        const refreshTokenCookie = req.cookies["Refresh-Token"];
        const scriptingToken = req.body?.scripting === true;

        if (refreshTokenCookie) {
            try {
                // Verify that the thing is legit
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
                        .sign(privateKey)
        
                    return res.json({
                        access_token: newAccessTokenJWT,
                        token_type: "bearer",
                        username: payload.username,
                        expires_in: remainingValidity
                    })
                }

                // Need to request a new token from upstream
                const usp = new URLSearchParams();
                usp.set("grant_type", "refresh_token");
                usp.set("refresh_token", `${payload['refresh_token']}`);
                usp.set("client_id", `${ServerConfig.authProviders.oidc?.clientId}`);
                usp.set("client_secret", `${ServerConfig.authProviders.oidc?.clientSecret}`);
                usp.set('redirect_uri', (new URL(RuntimeConfig.apiAddress + '/auth/oidcCallback', ServerConfig.serverAddress)).href);
                usp.set('scope', `${ServerConfig.authProviders.oidc?.scope}`)

                try {
                    const result = await axios.post(`${oidcTokenEndpoint}`, usp);
                    if (result.status != 200) {
                        return res.status(403).json({statusCode: 403, message: "Authentication error"});
                    }
                    const { payload, protectedHeader } = await jose.jwtVerify(result.data['access_token'], jwksManager); 
                    let username = payload[`${ServerConfig.authProviders.oidc?.uniqueField}`];
                    if (username === undefined) {
                        return res.status(500).json({statusCode: 500, message: "Unable to determine user ID from upstream token"})
                    }

                    // If refresh token and/or ID token in the result set cookies appropriately
                    if (result.data['refresh_token'] !== undefined) {
                        const refreshData = {
                            username,
                            'refresh_token': result.data['refresh_token'],
                        };
                        refreshData['access_token_expiry'] =  floor(new Date().getTime() / 1000) + result.data['expires_in']            
                        if (payload[`${ServerConfig.authProviders.oidc?.groupsField}`] !== undefined) {
                            refreshData['groups'] = payload[`${ServerConfig.authProviders.oidc?.groupsField}`];
                        }
                        const rt = await new jose.SignJWT(refreshData)
                            .setProtectedHeader({ alg: 'RS256' })
                            .setIssuedAt()
                            .setIssuer(`${ServerConfig.authProviders.oidc?.issuer}`)
                            .setExpirationTime(`${result.data['refresh_expires_in']}s`)
                            .sign(privateKey)
                        res.cookie("Refresh-Token", rt, {
                            path: RuntimeConfig.authPath,
                            maxAge: parseInt(result.data['refresh_expires_in']) * 1000,
                            httpOnly: true,
                            secure: !ServerConfig.httpOnly,
                            sameSite: "strict"
                        });
                    }
                    if (result.data['id_token'] !== undefined) {
                        res.cookie("Logout-Token", result.data['id_token'], {
                            path: RuntimeConfig.logoutAddress,
                            httpOnly: true,
                            secure: !ServerConfig.httpOnly,
                            sameSite: "strict"
                        });
                    }
            
                    // Recheck group membership
                    if (`${ServerConfig.authProviders.oidc?.requiredGroup}` !== undefined) {
                        if (payload[`${ServerConfig.authProviders.oidc?.groupsField}`] === undefined) {
                            return res.status(403).json({statusCode: 403, message: "Identity Provider did not supply group membership"})
                        }
                        const idpGroups = payload[`${ServerConfig.authProviders.oidc?.groupsField}`];
                        if (Array.isArray(idpGroups)) {
                            const groupList: string[] = Array.isArray(idpGroups) ? idpGroups : [];
                            if (!groupList.includes(`${ServerConfig.authProviders.oidc?.requiredGroup}`)) {
                                return res.status(403).json({statusCode: 403, message: "Not part of required group"})
                            } else {
                                console.log(`Verified membership in ${ServerConfig.authProviders.oidc?.requiredGroup}`)
                            }
                        } else {
                            return res.status(403).json({statusCode: 403, message: "Invalid group membership info received"})
                        }
                    }

                    // Construct + return new bearer token
                    let newAccessToken = { username };
                    if (scriptingToken)
                        newAccessToken['scripting'] = true;
                    const newAccessTokenJWT = await new jose.SignJWT(newAccessToken)
                        .setProtectedHeader({ alg: authConf.keyAlgorithm })
                        .setIssuedAt()
                        .setIssuer(`${ServerConfig.authProviders.oidc?.issuer}`)
                        .setExpirationTime(`${result.data['expires_in']}s`)
                        .sign(privateKey)
                    return res.json({
                        access_token: newAccessTokenJWT,
                        token_type: "bearer",
                        username: payload.username,
                        expires_in: result.data['expires_in']
                    })

                } catch(err) {
                        console.warn(err);
                        return res.status(500).json({statusCode: 500, message: "Error requesting tokens from identity provider"});
                }


            } catch (err) {
                next({statusCode: 400, message: "Invalid refresh token"});
            }
        } else {
            next({statusCode: 400, message: "Missing refresh token"});
        }

        next({statusCode: 500, message: "Error refreshing token"});
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

export function oidcLoginStart (req: express.Request, res: express.Response) {
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

 
    usp.set('client_id', `${ServerConfig.authProviders.oidc?.clientId}`);
    usp.set('redirect_uri', (new URL(RuntimeConfig.apiAddress + '/auth/oidcCallback', ServerConfig.serverAddress)).href);
    usp.set('response_type', 'code');
    usp.set('scope', `${ServerConfig.authProviders.oidc?.scope}`)

    // Return redirect
    return res.redirect(`${oidcAuthEndpoint}?${usp.toString()}`);
}

export async function oidcCallbackHandler(req: express.Request, res: express.Response) {
    console.log("Running OIDC callback handler");
    const usp = new URLSearchParams();

    if (req.cookies['oidcVerifier'] === undefined) {
        return res.status(400).json({statusCode: 400, message: "Missing OIDC verifier"})
    }

    const encryptedCodeVerifier = Buffer.from(req.cookies['oidcVerifier'], 'base64url');
    const codeVerifier = privateDecrypt(privateKey, encryptedCodeVerifier).toString('utf-8');

    usp.set('code_verifier', codeVerifier);
    res.clearCookie("oidcVerifier");

    usp.set("grant_type", "authorization_code");
    usp.set("client_id", `${ServerConfig.authProviders.oidc?.clientId}`);
    usp.set("client_secret", `${ServerConfig.authProviders.oidc?.clientSecret}`);
    usp.set("code", `${req.query.code}`);
    usp.set('redirect_uri', (new URL(RuntimeConfig.apiAddress + '/auth/oidcCallback', ServerConfig.serverAddress)).href);
    usp.set('scope', `${ServerConfig.authProviders.oidc?.scope}`)

    try {
        const result = await axios.post(`${oidcTokenEndpoint}`, usp);
        if (result.status != 200) {
            return res.status(403).json({statusCode: 403, message: "Authentication error"});
        }
        if (result.data['refresh_token'] !== undefined) {
            const { payload, protectedHeader } = await jose.jwtVerify(result.data['access_token'], jwksManager); 

            let username = payload[`${ServerConfig.authProviders.oidc?.uniqueField}`];
            if (username === undefined) {
                return res.status(500).json({statusCode: 500, message: "Unable to determine user ID from upstream token"})
            }
            const refreshData = {
                'username': username,
                'refresh_token': result.data['refresh_token'],
            };
            refreshData['access_token_expiry'] =  floor(new Date().getTime() / 1000) + result.data['expires_in']

            // Check group membership
            if (`${ServerConfig.authProviders.oidc?.requiredGroup}` !== undefined) {
                if (payload[`${ServerConfig.authProviders.oidc?.groupsField}`] === undefined) {
                    return res.status(403).json({statusCode: 403, message: "Identity Provider did not supply group membership"})
                }
                const idpGroups = payload[`${ServerConfig.authProviders.oidc?.groupsField}`];
                if (Array.isArray(idpGroups)) {
                    const groupList: string[] = Array.isArray(idpGroups) ? idpGroups : [];
                    if (!groupList.includes(`${ServerConfig.authProviders.oidc?.requiredGroup}`)) {
                        return res.status(403).json({statusCode: 403, message: "Not part of required group"})
                    } else {
                        console.log(`Verified membership in ${ServerConfig.authProviders.oidc?.requiredGroup}`)
                    }
                } else {
                    return res.status(403).json({statusCode: 403, message: "Invalid group membership info received"})
                }
            }

            const rt = await new jose.SignJWT(refreshData)
                .setProtectedHeader({ alg: 'RS256' })
                .setIssuedAt()
                .setIssuer(`${ServerConfig.authProviders.oidc?.issuer}`)
                .setExpirationTime(`${result.data['refresh_expires_in']}s`)
                .sign(privateKey)

            res.cookie("Refresh-Token", rt, {
                path: RuntimeConfig.authPath,
                maxAge: parseInt(result.data['refresh_expires_in']) * 1000,
                httpOnly: true,
                secure: !ServerConfig.httpOnly,
                sameSite: "strict"
            });

            res.cookie("Logout-Token", result.data['id_token'], {
                path: RuntimeConfig.logoutAddress,
                httpOnly: true,
                secure: !ServerConfig.httpOnly,
                sameSite: "strict"
            });

            return res.redirect(`${new URL(`${RuntimeConfig.dashboardAddress}`, ServerConfig.serverAddress).href}?${new URLSearchParams(`oidcuser=${username}`).toString()}`);
        }   
    } catch(err) {
        console.warn(err);
        return res.status(500).json({statusCode: 500, message: "Error requesting tokens from identity provider"});
    }
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
        return res.json({success: true});
    }
}
