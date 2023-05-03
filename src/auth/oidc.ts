import axios from "axios";
import * as express from "express";
import * as fs from "fs";
import * as jose from 'jose';
import type { GetKeyFunction } from "jose/dist/types/types"

import {CartaOidcAuthConfig} from "../types";
import {RuntimeConfig, ServerConfig} from "../config";
import {Verifier} from "../types";
import { createHash, createPrivateKey, createPublicKey, createSecretKey, KeyObject, randomBytes } from "crypto";
import { ceil, floor } from "lodash";
import {initRefreshManager, acquireRefreshLock, releaseRefreshLock, getAccessTokenExpiry, clearTokens, setAccessTokenExpiry, setRefreshToken, getRefreshToken} from "./oidcRefreshManager";

let privateKey: KeyObject;
let publicKey: KeyObject;
let symmetricKey: KeyObject;
let jwksManager: GetKeyFunction<jose.JWSHeaderParameters, jose.FlattenedJWSInput>;

let oidcAuthEndpoint: string;
let oidcIssuer: string;
let oidcLogoutEndpoint: string;
let oidcTokenEndpoint: string;

let postLogoutRedirect: string;

export async function initOidc(authConf: CartaOidcAuthConfig) {
    // Load public & private keys
    publicKey = createPublicKey(fs.readFileSync(authConf.localPublicKeyLocation));
    privateKey = createPrivateKey(fs.readFileSync(authConf.localPrivateKeyLocation));
    symmetricKey = createSecretKey(Buffer.from(fs.readFileSync(authConf.symmetricKeyLocation, 'utf-8'), 'base64'));

    // Parse details of IdP from metadata URL
    const idpConfig = await axios.get(authConf.idpUrl + "/.well-known/openid-configuration");
    oidcAuthEndpoint = idpConfig.data['authorization_endpoint'];
    oidcIssuer = idpConfig.data['issuer'];
    oidcLogoutEndpoint = idpConfig.data['end_session_endpoint'];
    oidcTokenEndpoint = idpConfig.data['token_endpoint'];

    // Init JWKS key management
    console.log(`Setting up JWKS management for ${idpConfig.data['jwks_uri']}`);
    jwksManager = jose.createRemoteJWKSet(new URL(idpConfig.data['jwks_uri']));

    // Set logout redirect URL
    if (authConf.postLogoutRedirect !== undefined) {
        postLogoutRedirect = authConf.postLogoutRedirect;
    }
    else {
        postLogoutRedirect = `${ServerConfig.serverAddress}`;
    }

    // Init refresh token management
    await initRefreshManager();
}

function returnErrorMsg (req: express.Request, res: express.Response, statusCode: number, msg: string) {
    if (req.header('accept') == 'application/json') {
        return res.status(statusCode).json({ statusCode: statusCode, message: msg })
    }
    else {
        // Errors are presented to the user on the dashboard rather than returned via JSON messages
        return res.redirect(
            `${new URL(`${RuntimeConfig.dashboardAddress}`, ServerConfig.serverAddress).href}?${new URLSearchParams({'err':msg}).toString()}`
        );
    }
}

// A helper function as initial call to the IdP token endpoint and renewals are mostly the same
async function callIdpTokenEndpoint (usp: URLSearchParams, req: express.Request, res: express.Response,
                                     authConf: CartaOidcAuthConfig, scriptingToken: boolean = false,
                                     isLogin: boolean = false, sessionId: string, sessionEncKey: Buffer | undefined) {

    // Fill in the common request elements
    usp.set("client_id", authConf.clientId);
    usp.set("client_secret", authConf.clientSecret);
    usp.set("scope", authConf.scope);

    try {
        const result = await axios.post(`${oidcTokenEndpoint}`, usp);
        if (result.status != 200) {
            return returnErrorMsg(req, res, 500, "Authentication error");
        }

        const { payload, protectedHeader } = await jose.jwtVerify(result.data['id_token'], jwksManager, {
            issuer: oidcIssuer,
        });

        // Check audience
        if (payload.aud != authConf.clientId) {
            return returnErrorMsg(req, res, 500, "Service received an ID token directed to a different service");
        }

        // Create / retrieve session encryption key
        if (sessionEncKey === undefined) {
            //console.log("No session key received. Assuming initial login")
            sessionEncKey = randomBytes(32);
        }

        let username = payload[authConf.uniqueField];
        if (username === undefined) {
            return returnErrorMsg(req, res, 500, "Unable to match to a local user");
        }

        // Update DB to reflect new token + associated access token expiry
        if (result.data['refresh_token'] !== undefined) {
            setRefreshToken(username, sessionId, result.data['refresh_token'],
                            sessionEncKey, parseInt(result.data['refresh_expires_in']));
        }

        const refreshExpiry = result.data['refresh_expires_in'] !== undefined ? result.data['refresh_expires_in'] : result.data['expires_in'];
        //refreshData['access_token_expiry'] =  floor(new Date().getTime() / 1000) + result.data['expires_in'];
        if (result.data['expires_in'] !== undefined) {
            setAccessTokenExpiry(username, sessionId, parseInt(result.data['expires_in']));
            //console.log(`Access token expires in:\t${result.data['expires_in']}`)
        }

        // Check group membership
        if (authConf.requiredGroup !== undefined) {
            if (payload[`${authConf.groupsField}`] === undefined) {
                return returnErrorMsg(req, res, 403, "Identity provider did not supply group membership");
            }
            const idpGroups = payload[`${authConf.groupsField}`];
            if (Array.isArray(idpGroups)) {
                const groupList: string[] = idpGroups;
                if (!groupList.includes(`${authConf.requiredGroup}`)) {
                    return returnErrorMsg(req, res, 403, "Not part of required group");
                }
            } else {
                return returnErrorMsg(req, res, 403, "Invalid group membership info received");
            }
        }

        // Build refresh token
        // If there's no actual refresh token then this will only last for as long as the access token does
        const refreshData = {
            username,
            sessionId,
            sessionEncKey: sessionEncKey.toString('hex')
        };
        //console.log(`Session key in refresh token:\t${refreshData['sessionEncKey']}`)
        const rt = await new jose.EncryptJWT(refreshData)
            .setProtectedHeader({ alg: 'dir', enc: authConf.symmetricKeyType })
            .setIssuedAt()
            .setIssuer(authConf.issuer)
            .setExpirationTime(`${refreshExpiry}s`)
            .encrypt(symmetricKey);
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
        return returnErrorMsg(req, res, 500, "Error requesting tokens from identity provider");
    }
}

export function generateLocalOidcRefreshHandler (authConf: CartaOidcAuthConfig) {
    return async (req: express.Request, res: express.Response) => {
        //console.debug("Running OIDC refresh handler")
        const refreshTokenCookie = req.cookies["Refresh-Token"];
        const scriptingToken = req.body?.scripting === true;

        if (refreshTokenCookie) {
            try {
                // Verify that the token is legit
                const { payload, protectedHeader } = await jose.jwtDecrypt(refreshTokenCookie, symmetricKey, {
                    issuer: authConf.issuer
                }); 
        
                try {
                    if (! await acquireRefreshLock(payload?.sessionId,10)) {
                        return returnErrorMsg(req, res, 500, "Timed out waiting to acquire lock");
                    }
                } catch (err) {
                    return returnErrorMsg(req, res, 500, "Locking error");
                }

                try {
                    // Check if access token validity is there and at least cacheAccessTokenMinValidity seconds from expiry
                    const remainingValidity = await getAccessTokenExpiry(payload.username, payload.sessionId);
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
                    } else {
                        // Need to request a new token from upstream
                        const usp = new URLSearchParams();
                        const sessionEncKey = Buffer.from(`${payload?.sessionEncKey}`, 'hex');
                        usp.set("grant_type", "refresh_token");
                        usp.set("refresh_token", `${await getRefreshToken(payload.username, payload.sessionId, sessionEncKey)}`);
                        return await callIdpTokenEndpoint(usp, req, res, authConf, scriptingToken, false, `${payload['sessionId']}`, sessionEncKey);
                    }
                } finally {
                    await releaseRefreshLock(payload?.sessionId);
                }
            } catch (err) {
                return returnErrorMsg(req, res, 400, "Invalid refresh token");
            }
        } else {
            return returnErrorMsg(req, res, 400, "Missing refresh token");
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

export async function oidcLoginStart (req: express.Request, res: express.Response, authConf: CartaOidcAuthConfig) {
    try {
        const usp = new URLSearchParams();

        // Generate PKCE verifier & challenge
        const urlSafeChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
        const codeVerifier = Array.from({length:64}, (_,i) => urlSafeChars[Math.floor(Math.random() * urlSafeChars.length)]).join("");
        const encryptedCodeVerifier = await new jose.CompactEncrypt(new TextEncoder().encode(codeVerifier))
                                            .setProtectedHeader({ alg: 'RSA-OAEP', enc: 'A128GCM' })
                                            .encrypt(publicKey);

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

        // Create session key
        const sessionId = Array.from({length:32}, (_,i) => urlSafeChars[Math.floor(Math.random() * urlSafeChars.length)]).join("");
        res.cookie('sessionId', sessionId, {
            path: (new URL(RuntimeConfig.apiAddress + '/auth/oidcCallback', ServerConfig.serverAddress)).href,
            maxAge: 600000,
            httpOnly: true,
            secure: !ServerConfig.httpOnly,
        });
        usp.set('state', sessionId);

        usp.set('client_id', authConf.clientId);
        usp.set('redirect_uri', (new URL(RuntimeConfig.apiAddress + '/auth/oidcCallback', ServerConfig.serverAddress)).href);
        usp.set('response_type', 'code');
        usp.set('scope', authConf.scope);

        // Allow arbitrary params to be passed for IdPs like Google that require additional ones
        for (const item of authConf.additionalAuthParams) {
            usp.set(item[0],item[1])
        }

        // Return redirect
        return res.redirect(`${oidcAuthEndpoint}?${usp.toString()}`);
    } catch (err) {
        console.log(err);
        return returnErrorMsg(req, res, 500, err);
    }
}

export async function oidcCallbackHandler(req: express.Request, res: express.Response, authConf: CartaOidcAuthConfig) {
    try {
        //console.debug("Running OIDC callback handler");
        const usp = new URLSearchParams();

        if (req.cookies['oidcVerifier'] === undefined) {
            return returnErrorMsg(req, res, 400, "Missing OIDC verifier");
        }
        if (req.cookies['sessionId'] === undefined) {
            return returnErrorMsg(req, res, 400, "Missing session ID");
        } else if (req.cookies['sessionId'] != `${req.query.state}`) {
            return returnErrorMsg(req, res, 400, "Invalid session ID");
        } else {
            res.clearCookie('sessionId');
        }

        const decryptedCodeVerifier = await jose.compactDecrypt(req.cookies['oidcVerifier'], privateKey);
        const codeVerifier = new TextDecoder().decode(decryptedCodeVerifier.plaintext);

        usp.set('code_verifier', codeVerifier);
        res.clearCookie("oidcVerifier");
        usp.set("code", `${req.query.code}`);
        usp.set("grant_type", "authorization_code");
        usp.set('redirect_uri', (new URL(RuntimeConfig.apiAddress + '/auth/oidcCallback', ServerConfig.serverAddress)).href);

        return await callIdpTokenEndpoint (usp, req, res, authConf, false, true, `${req.query.state}`, undefined);
    } catch (err) {
        console.log(err);
        return returnErrorMsg(req, res, 500, err);
    }
}

export async function oidcLogoutHandler(req: express.Request, res: express.Response) {
    try {
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

            usp.set('post_logout_redirect_uri', postLogoutRedirect);

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
    } catch (err) {
        console.log(err);
        return returnErrorMsg(req, res, 500, err);       
    }
}
