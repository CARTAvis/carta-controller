import * as yargs from "yargs";
import * as Ajv from "ajv";
import * as url from "url";
import {CartaCommandLineOptions, CartaRuntimeConfig, CartaServerConfig} from "./types";

const argv = yargs.options({
    config: {
        type: "string",
        default: "/etc/carta/config.json",
        alias: "c",
        description: "Path to config file in JSON format"
    },
    test: {
        type: "string",
        alias: "t",
        requiresArg: true,
        description: "Test configuration with the provided user"
    }
}).argv as CartaCommandLineOptions;

const testUser = argv.test;
const configSchema = require("../config/config_schema.json");
const ajv = new Ajv({useDefaults: true});
const validateConfig = ajv.compile(configSchema);

let serverConfig: CartaServerConfig;

try {
    console.log(`Checking config file ${argv.config}`);
    serverConfig = require(argv.config);
    const isValid = validateConfig(serverConfig);
    if (!isValid) {
        console.error(validateConfig.errors);
        process.exit(1);
    }
} catch (err) {
    console.log(err);
    process.exit(1);
}


// Construct runtime config
const runtimeConfig: CartaRuntimeConfig = {};
runtimeConfig.dashboardAddress = serverConfig.dashboardAddress || (serverConfig.serverAddress + "/dashboard");
runtimeConfig.apiAddress = serverConfig.apiAddress || (serverConfig.serverAddress + "/api");
if (serverConfig.authProviders.google) {
    runtimeConfig.googleClientId = serverConfig.authProviders.google.clientId;
} else if (serverConfig.authProviders.external) {
    runtimeConfig.tokenRefreshAddress = serverConfig.authProviders.external.tokenRefreshAddress;
    runtimeConfig.logoutAddress = serverConfig.authProviders.external.logoutAddress;
} else {
    runtimeConfig.tokenRefreshAddress = runtimeConfig.apiAddress + "/auth/refresh";
    runtimeConfig.logoutAddress = runtimeConfig.apiAddress + "/auth/logout";
}
if (runtimeConfig.tokenRefreshAddress) {
    const authUrl = url.parse(runtimeConfig.tokenRefreshAddress);
    runtimeConfig.authPath = authUrl.pathname ?? "";
}

export {serverConfig as ServerConfig, runtimeConfig as RuntimeConfig, testUser};