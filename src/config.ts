import * as yargs from "yargs";
import * as Ajv from "ajv";
import * as url from "url";
import * as fs from "fs";
import * as path from "path";
import * as JSONC from "jsonc-parser";
import * as _ from "lodash";
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
    let jsonString = fs.readFileSync(argv.config).toString();
    serverConfig = JSONC.parse(jsonString);

    const configDir = path.join(path.dirname(argv.config), "config.d")
    if (fs.existsSync(configDir)) {
        const files = fs.readdirSync(configDir);
        for (const file of files) {
            if (!file.match(/.*\.json$/)) {
                console.log(`Skipping ${file}`);
                continue;
            }
            jsonString = fs.readFileSync(path.join(configDir, file)).toString();
            const additionalConfig: any = JSONC.parse(jsonString) as CartaServerConfig;
            const isPartialConfigValid = validateConfig(additionalConfig);
            if (isPartialConfigValid) {
                serverConfig = _.merge(serverConfig, additionalConfig);
                console.log(`Adding additional config file config.d/${file}`);
            } else {
                console.log(`Skipping invalid configuration file ${file}`);
            }

        }
    }

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
runtimeConfig.dashboardAddress = serverConfig.dashboardAddress || "/dashboard";
runtimeConfig.apiAddress = serverConfig.apiAddress || "/api";
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