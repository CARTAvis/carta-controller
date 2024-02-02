import * as yargs from "yargs";
import * as url from "url";
import * as fs from "fs";
import * as path from "path";
import * as JSONC from "jsonc-parser";
import * as _ from "lodash";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {CartaCommandLineOptions, CartaRuntimeConfig, CartaServerConfig} from "./types";
import { server } from "websocket";

const defaultConfigPath = "/etc/carta/config.json";
const argv = yargs.options({
    config: {
        type: "string",
        default: defaultConfigPath,
        alias: "c",
        description: "Path to config file in JSON format"
    },
    test: {
        type: "string",
        alias: "t",
        requiresArg: true,
        description: "Test configuration with the provided user"
    },
    verbose: {
        type: "boolean",
        alias: "v"
    }
}).argv as CartaCommandLineOptions;

const usingCustomConfig = argv.config !== defaultConfigPath;
const testUser = argv.test;
const verboseOutput = argv.verbose;
const configSchema = require("../config/config_schema.json");
const ajv = new Ajv({useDefaults: false, allowUnionTypes: true});
const ajvWithDefaults = new Ajv({useDefaults: true, allowUnionTypes: true});
addFormats(ajv);
addFormats(ajvWithDefaults);
const validateConfig = ajv.compile(configSchema);
const validateAndAddDefaults = ajvWithDefaults.compile(configSchema);

let serverConfig: CartaServerConfig;

try {
    console.log(`Checking config file ${argv.config}`);
    if (fs.existsSync(argv.config)) {
        const jsonString = fs.readFileSync(argv.config).toString();
        serverConfig = JSONC.parse(jsonString);
    } else {
        if (!usingCustomConfig) {
            serverConfig = {} as CartaServerConfig;
            console.log(`Skipping missing config file ${defaultConfigPath}`);
        } else {
            console.log(new Error(`Unable to find config file ${argv.config}`));
            process.exit(1);
        }
    }

    const configDir = path.join(path.dirname(argv.config), "config.d");
    if (fs.existsSync(configDir)) {
        const files = fs.readdirSync(configDir)?.sort();
        for (const file of files) {
            if (!file.match(/.*\.json$/)) {
                console.log(`Skipping ${file}`);
                continue;
            }
            const jsonString = fs.readFileSync(path.join(configDir, file)).toString();
            const additionalConfig: any = JSONC.parse(jsonString) as CartaServerConfig;
            const isPartialConfigValid = validateConfig(additionalConfig);
            if (isPartialConfigValid) {
                serverConfig = _.merge(serverConfig, additionalConfig);
                console.log(`Adding additional config file config.d/${file}`);
            } else {
                console.log(`Skipping invalid configuration file ${file}`);
                console.error(validateConfig.errors);
            }
        }
    }

    const isValid = validateAndAddDefaults(serverConfig);
    if (!isValid) {
        console.error(validateAndAddDefaults.errors);
        process.exit(1);
    }
} catch (err) {
    console.log(err);
    process.exit(1);
}

// Check defaults:
if (!serverConfig.rootFolderTemplate) {
    console.log("No top-level folder was specified. Reverting to default location");
    const defaultFolders = ["/usr/share/carta", "/usr/local/share/carta"];
    for (const f of defaultFolders) {
        if (fs.existsSync(f)) {
            serverConfig.rootFolderTemplate = f;
            break;
        }
    }
    if (!serverConfig.rootFolderTemplate) {
        console.error("Could not find a default top-level folder!");
        process.exit(1);
    }
}

if (!serverConfig.baseFolderTemplate) {
    serverConfig.baseFolderTemplate = serverConfig.rootFolderTemplate;
}

// Construct runtime config
const runtimeConfig: CartaRuntimeConfig = {};
runtimeConfig.dashboardAddress = serverConfig.dashboardAddress || "/dashboard";
runtimeConfig.apiAddress = serverConfig.apiAddress || "/api";
if (serverConfig.authProviders.external) {
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
runtimeConfig.logoutUsingGet = serverConfig.authProviders.oidc !== undefined;

export {serverConfig as ServerConfig, runtimeConfig as RuntimeConfig, testUser, verboseOutput};
