import * as express from "express";
import * as LdapAuth from "ldapauth-fork";
import {Algorithm} from "jsonwebtoken";

export interface CartaLocalAuthConfig {
    publicKeyLocation: string;
    privateKeyLocation: string;
    keyAlgorithm: Algorithm;
    issuer: string;
    refreshTokenAge: string;
    accessTokenAge: string;
    scriptingTokenAge: string;
}

export interface CartaLdapAuthConfig extends CartaLocalAuthConfig {
    // Options to pass through to the LDAP Auth instance
    ldapOptions: LdapAuth.Options;
}

export interface CartaGoogleAuthConfig extends CartaLocalAuthConfig {
    clientId: string;
    // Valid domain to accept. If this is empty or undefined, all domains are accepted. Domain specified by "hd" field
    validDomain?: string;
    //  Set this to true if you want to lookup users by email address instead of sub
    useEmailAsId: boolean;
    // User lookup table as text file in format <unique user ID> <system user>. If no user lookup is needed, leave this blank
    userLookupTable: string;
}

export interface CartaExternalAuthConfig {
    issuers: string[];
    publicKeyLocation: string;
    keyAlgorithm: string;
    // Unique field to be used as username
    uniqueField: string;
    // User lookup table as text file in format <authenticated username> <system user>. If no user lookup is needed, leave this blank
    userLookupTable?: string;
    // Routes for refreshing access tokens and logging out
    tokenRefreshAddress: string;
    logoutAddress: string;
}

export interface CartaOidcAuthConfig {
    // URL from which the OpenID Connect endpoint's metadata can be retrieved
    idpUrl: string;
    // Unique field to be used as username
    uniqueField: string;
    // Client ID as registered with the OpenID connect endpoint.
    clientId: string;
    // Client secret as registered with the OpenID connect endpoint.
    clientSecret: string;
    // User lookup table as text file in format <authenticated username> <system user>. If no user lookup is needed, leave this blank
    scope: string;
    // Scopes to request.
    userLookupTable?: string;
    // Field containing list of groups/roles possessed by the user
    groupsField?: string;
    // Value to be required as one of the listed user groups/roles in groupsField
    requiredGroup?: string;
    // Public key used for locally-issued tokens
    localPublicKeyLocation: string;
    // Private key used for locally-issued tokens
    localPrivateKeyLocation: string;
    // Algorithm for locally-issued tokens
    keyAlgorithm: Algorithm;
    // Issuer for locally issued tokens
    issuer: string;
    // Location of base64-encoded symmetric key for refresh tokens
    symmetricKeyLocation: string;
    // Type of symmetric key used
    // See https://www.iana.org/assignments/jose/jose.xhtml#web-signature-encryption-algorithms
    symmetricKeyType: string;
    // Recycle access tokens from upstream server if they still have sufficient lifetime remaining (seconds)
    cacheAccessTokenMinValidity: number;
    // A set of additional parameters to include in token requests
    additionalAuthParams: Map<string, string>;
    // Location to redirect to after logout
    postLogoutRedirect: string;
}

export enum ScriptingAccess {
    Enabled = "enabled-all-users",
    Disabled = "disabled-all-users",
    OptIn = "opt-in"
}

export interface CartaServerConfig {
    // One authProvider must be defined
    authProviders: {
        pam?: CartaLocalAuthConfig;
        ldap?: CartaLdapAuthConfig;
        google?: CartaGoogleAuthConfig;
        external?: CartaExternalAuthConfig;
        oidc?: CartaOidcAuthConfig;
    };
    database: {
        uri: string;
        databaseName?: string;
    };
    // Port to listen on. It is advised to listen on a port other than 80 or 443, behind an SSL proxy
    serverPort: number | string;
    // Host interface to listen on. If empty, all interfaces are used
    serverInterface: string;
    // Allow HTTP-only connections. For testing or internal networks only.
    httpOnly: boolean;
    // Public-facing server address
    serverAddress?: string;
    // If you need to optionally specify a different API or dashboard address
    dashboardAddress: string;
    apiAddress?: string;
    frontendPath: string;
    // Range of ports to user for backend processes. Effectively limits the number of simultaneous users
    backendPorts: {
        min: number;
        max: number;
    };
    // Command to execute when starting the backend process
    processCommand: string;
    // Use the --preserveEnv argument when calling sudo
    preserveEnv: boolean;
    // The {username} placeholder will be replaced with the username
    rootFolderTemplate: string;
    baseFolderTemplate: string;
    // {pid} will be replaced by the started process ID
    // {datetime} will be replaced by date and time formatted as "YYYYMMDD.h_mm_ss"
    // Note: if you use /var/log/carta for log files, make sure the user running the server has the appropriate permissions
    logFileTemplate: string;
    // Additional arguments to be passed to the backend process, defined as an array of strings
    additionalArgs: string[];
    killCommand: string;
    // How long to wait before checking whether started process is still running and sending res
    startDelay: number;
    // Dashboard appearance configuration
    dashboard?: {
        // Background color for the dashboard
        backgroundColor: string;
        // Background color for the institutional logo banner
        bannerColor: string;
        // Path to institutional logo in PNG format
        bannerImage?: string;
        // Text displayed before and after sign-in. Plain text or HTML
        infoText?: string;
        // Text displayed before sign-in only. Plain text or HTML
        loginText?: string;
        // Footer text. Plain text or HTML
        footerText?: string;
    };
    // Allow scripting
    scriptingAccess?: ScriptingAccess;
}

export interface CartaCommandLineOptions {
    [x: string]: unknown;
    config: string;
    test: string;
    verbose: boolean;
}

export interface CartaRuntimeConfig {
    dashboardAddress?: string;
    apiAddress?: string;
    tokenRefreshAddress?: string;
    logoutAddress?: string;
    authPath?: string;
}

export type RequestHandler = (req: express.Request, res: express.Response) => void;
export type AsyncRequestHandler = (req: express.Request, res: express.Response, next: express.NextFunction) => void;
export type AuthenticatedRequest = express.Request & {username?: string; scripting?: boolean};

// Token verifier function
export type Verifier = (cookieString: string) => any;
// Map for looking up system user name from authenticated user name
export type UserMap = Map<string, string>;
