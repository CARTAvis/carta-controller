import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import * as JSONC from "jsonc-parser";
import _ from "lodash";
import moment from "moment-timezone";
import winston from "winston";
import yargs from "yargs";
import type {CartaCommandLineOptions, CartaRuntimeConfig, CartaServerConfig} from "./types";
import {logger} from "./util";

let timeZone: string | undefined;
const customTimestamp = () => {
    if (timeZone) return moment().tz(timeZone).format("YYYY-MM-DD HH:mm:ss");
    else return moment().format("YYYY-MM-DD HH:mm:ss");
};

// Different log formats
const logTextFormat = winston.format.combine(
    winston.format.timestamp({format: customTimestamp}),
    winston.format.printf(({level, message, timestamp}) => {
        return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
);
const logColorTextFormat = winston.format.combine(
    winston.format.timestamp({format: customTimestamp}),
    winston.format.printf(({level, message, timestamp}) => {
        const colorizer = winston.format.colorize();
        return `${timestamp} [${colorizer.colorize(level, level.toUpperCase())}]: ${message}`;
    })
);
const logJsonFormat = winston.format.combine(winston.format.timestamp({format: customTimestamp}), winston.format.json());

const defaultConfigPath = "/etc/carta/config.json";
const argv = yargs
    .parserConfiguration({
        "short-option-groups": false
    })
    .options({
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
        logLevel: {
            type: "string",
            choices: ["none", "emerg", "alert", "crit", "error", "warning", "notice", "info", "debug"],
            describe: "Log level to print to console",
            alias: "l"
        },
        logFormat: {
            type: "string",
            choices: ["text", "json"],
            describe: "Log type to print to console",
            alias: "f"
        }
    }).argv as CartaCommandLineOptions;

const usingCustomConfig = argv.config !== defaultConfigPath;
const testUser = argv.test;
const configSchema = require("../schemas/controller_config_schema_2.json");
const ajv = new Ajv({useDefaults: false});
const ajvWithDefaults = new Ajv({useDefaults: true});
addFormats(ajv);
addFormats(ajvWithDefaults);
const validateConfig = ajv.compile(configSchema);
const validateAndAddDefaults = ajvWithDefaults.compile(configSchema);

let serverConfig: CartaServerConfig;

const consoleTransport = new winston.transports.Console({
    format: argv.logFormat === "json" ? logJsonFormat : logColorTextFormat,
    level: argv.logLevel ? argv.logLevel : "info", // default to info until having parsed the config
    silent: argv.logLevel === "none"
});
logger.add(consoleTransport);

try {
    const configFiles: string[] = [];
    if (fs.existsSync(argv.config)) {
        configFiles.push(argv.config);
        const jsonString = fs.readFileSync(argv.config).toString();
        serverConfig = JSONC.parse(jsonString);
    } else {
        if (!usingCustomConfig) {
            serverConfig = {} as CartaServerConfig;
            logger.warning(`Skipping missing config file ${defaultConfigPath}`);
        } else {
            logger.crit(`Unable to find config file ${argv.config}`);
            process.exit(1);
        }
    }

    const configDir = path.join(path.dirname(argv.config), "config.d");
    if (fs.existsSync(configDir)) {
        const files = fs.readdirSync(configDir)?.sort();
        for (const file of files) {
            if (!file.match(/.*\.json$/)) {
                console.warn(`Skipping ${file}`);
                continue;
            }
            const jsonString = fs.readFileSync(path.join(configDir, file)).toString();
            const additionalConfig: unknown = JSONC.parse(jsonString) as CartaServerConfig;
            const isPartialConfigValid = validateConfig(additionalConfig);
            if (isPartialConfigValid) {
                serverConfig = _.merge(serverConfig, additionalConfig);
                configFiles.push(file);
            } else {
                logger.error(`Skipping invalid configuration file ${file}`);
                logger.error(validateConfig.errors);
            }
        }
    }

    // Check for use of deprecated logFileTemplate
    if ("logFileTemplate" in serverConfig) {
        logger.warning("The 'logFileTemplate' option is deprecated and renamed to 'backendLogFileTemplate'. Please update your config file.");
        if (!serverConfig.backendLogFileTemplate || serverConfig.backendLogFileTemplate === "") {
            serverConfig.backendLogFileTemplate = String(serverConfig.logFileTemplate);
        } else if (serverConfig.backendLogFileTemplate !== serverConfig.logFileTemplate) {
            logger.error("'logFileTemplate' and 'backendLogFileTemplate' are both set, and have conflicting values. Ignoring 'logFileTemplate'.");
        }
        delete serverConfig.logFileTemplate;
    }

    const isValid = validateAndAddDefaults(serverConfig);
    if (!isValid) {
        console.error(validateAndAddDefaults.errors);
        process.exit(1);
    }

    // Validate timezone setting
    if (serverConfig.timezone) {
        try {
            new Intl.DateTimeFormat("en-US", {timeZone: serverConfig.timezone});
            timeZone = serverConfig.timezone;
        } catch (err) {
            logger.debug(err);
            logger.error(`Ignoring invalid timezone "${serverConfig.timezone}" in config file`);
        }
    }

    // Reconfigure log transports
    if (argv.logLevel) {
        serverConfig.logLevelConsole = argv.logLevel;
    }
    if (argv.logFormat) {
        serverConfig.logTypeConsole = argv.logFormat;
    }
    consoleTransport.level = serverConfig.logLevelConsole;
    consoleTransport.format = serverConfig.logTypeConsole === "json" ? logJsonFormat : logColorTextFormat;
    consoleTransport.silent = serverConfig.logLevelConsole === "none";

    if (serverConfig.logFile && serverConfig.logFile !== "") {
        if (serverConfig.logLevelFile === "none") {
            logger.error(`Log file "${serverConfig.logFile}" specified but with a log level of "none"`);
        } else {
            try {
                logger.add(
                    new winston.transports.File({
                        level: serverConfig.logLevelFile,
                        filename: serverConfig.logFile,
                        format: serverConfig.logTypeFile === "json" ? logJsonFormat : logTextFormat
                    })
                );
                logger.info(`Started logging to ${serverConfig.logFile}`);
            } catch (err) {
                logger.debug(err);
                logger.error(`Error initializing logging to ${serverConfig.logFile}`);
                // Server currently continues to run
            }
        }
    }

    logger.info(`Loaded config from ${configFiles.join(", ")}`);
} catch (err) {
    logger.emerg(err);
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
    runtimeConfig.tokenRefreshAddress = `${runtimeConfig.apiAddress}/auth/refresh`;
    runtimeConfig.logoutAddress = `${runtimeConfig.apiAddress}/auth/logout`;
}
if (runtimeConfig.tokenRefreshAddress) {
    const authUrl = url.parse(runtimeConfig.tokenRefreshAddress);
    runtimeConfig.authPath = authUrl.pathname ?? "";
}

export {serverConfig as ServerConfig, runtimeConfig as RuntimeConfig, testUser};
