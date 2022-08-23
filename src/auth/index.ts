import * as jwt from "jsonwebtoken";
import * as express from "express";
import {noCache} from "../util";
import {RequestHandler, AsyncRequestHandler, AuthenticatedRequest, Verifier, UserMap} from "../types";
import {ServerConfig, RuntimeConfig} from "../config";
import {generateExternalVerifiers, watchUserTable} from "./external";
import {generateLocalRefreshHandler, generateLocalVerifier} from "./local";
import {generateLocalOidcRefreshHandler, generateLocalOidcVerifier, oidcCallbackHandler, oidcLogoutHandler, oidcLoginStart, initOidc} from "./oidc";
import {getLdapLoginHandler} from "./ldap";
import {getPamLoginHandler} from "./pam";
import {generateGoogleVerifier, validGoogleIssuers} from "./google";

// maps JWT claim "iss" to a token verifier
const tokenVerifiers = new Map<string, Verifier>();
// maps JWT claim "iss" to a user map
const userMaps = new Map<string, UserMap>();

let loginHandler: RequestHandler = (req, res) => {
    throw {statusCode: 501, message: "Login not implemented"};
};

let refreshHandler: AsyncRequestHandler = (req, res) => {
    throw {statusCode: 501, message: "Token refresh not implemented"};
};

// Local providers
if (ServerConfig.authProviders.pam) {
    const authConf = ServerConfig.authProviders.pam;
    generateLocalVerifier(tokenVerifiers, authConf);
    loginHandler = getPamLoginHandler(authConf);
    refreshHandler = generateLocalRefreshHandler(authConf);
} else if (ServerConfig.authProviders.ldap) {
    const authConf = ServerConfig.authProviders.ldap;
    generateLocalVerifier(tokenVerifiers, authConf);
    loginHandler = getLdapLoginHandler(authConf);
    refreshHandler = generateLocalRefreshHandler(authConf);
} else if (ServerConfig.authProviders.google) {
    const authConf = ServerConfig.authProviders.google;
    generateGoogleVerifier(tokenVerifiers, authConf);
    if (authConf.userLookupTable) {
        watchUserTable(userMaps, validGoogleIssuers, authConf.userLookupTable);
    }
} else if (ServerConfig.authProviders.external) {
    const authConf = ServerConfig.authProviders.external;
    generateExternalVerifiers(tokenVerifiers, authConf);
    const tablePath = authConf.userLookupTable;
    if (tablePath) {
        watchUserTable(userMaps, authConf.issuers, tablePath);
    }
} else if (ServerConfig.authProviders.oidc) {
    const authConf = ServerConfig.authProviders.oidc;
    generateLocalOidcVerifier(tokenVerifiers, authConf);
    refreshHandler = generateLocalOidcRefreshHandler(authConf);
    loginHandler = oidcLoginStart;
    initOidc(authConf);
    if (authConf.userLookupTable) {
        watchUserTable(userMaps, authConf.issuer, authConf.userLookupTable);
    }
}

// Check for empty token verifies
if (!tokenVerifiers.size) {
    console.error("No valid token verifiers specified");
    process.exit(1);
}

export async function verifyToken(cookieString: string) {
    const tokenJson: any = jwt.decode(cookieString);
    if (tokenJson && tokenJson.iss) {
        const verifier = tokenVerifiers.get(tokenJson.iss);
        if (verifier) {
            return await verifier(cookieString);
        }
    }
    return undefined;
}

export function getUser(username: string, issuer: string) {
    const userMap = userMaps.get(issuer);
    if (userMap) {
        return userMap.get(username);
    } else {
        return username;
    }
}

// Express middleware to guard against unauthorized access. Writes the username to the request object
export async function authGuard(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    const tokenString = req.token;
    if (tokenString) {
        try {
            const token = await verifyToken(tokenString);

            if (!token || !token.username) {
                next({statusCode: 403, message: "Not authorized"});
            } else {
                req.username = getUser(token.username, token.iss);
                if (token.scripting) {
                    req.scripting = true;
                }
                next();
            }
        } catch (err) {
            next({statusCode: 403, message: err.message});
        }
    } else {
        next({statusCode: 403, message: "Not authorized"});
    }
}

function logoutHandler(req: express.Request, res: express.Response) {
    res.cookie("Refresh-Token", "", {
        path: RuntimeConfig.authPath,
        maxAge: 0,
        httpOnly: true,
        secure: !ServerConfig.httpOnly,
        sameSite: "strict"
    });
    return res.json({success: true});
}

function handleCheckAuth(req: AuthenticatedRequest, res: express.Response) {
    res.json({
        success: true,
        username: req.username
    });
}

export const authRouter = express.Router();
if (ServerConfig.authProviders.oidc) {
    authRouter.get("/logout", noCache, oidcLogoutHandler);
    authRouter.get("/oidcCallback", noCache, oidcCallbackHandler);
    authRouter.get("/login", noCache, loginHandler);
}
else {
    authRouter.post("/login", noCache, loginHandler);
    authRouter.post("/logout", noCache, logoutHandler);
}
authRouter.post("/refresh", noCache, refreshHandler);
authRouter.get("/status", authGuard, noCache, handleCheckAuth);
