import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import * as url from "node:url";
import * as bodyParser from "body-parser";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, {type NextFunction, type Request, type Response} from "express";
import bearerToken from "express-bearer-token";
import httpProxy from "http-proxy";
import {authGuard, authRouter} from "./auth";
import {RuntimeConfig, ServerConfig, testUser} from "./config";
import {runTests} from "./controllerTests";
import {databaseRouter, initDB} from "./database";
import {createScriptingProxyHandler, createUpgradeHandler, serverRouter} from "./serverHandlers";
import {logger} from "./util";

interface AppError extends Error {
    statusCode?: number;
    status?: string;
}

if (testUser) {
    runTests(testUser).then(
        () => {
            logger.info(`Controller tests with user ${testUser} succeeded`);
            process.exit(0);
        },
        err => {
            logger.error(err);
            logger.info(`Controller tests with user ${testUser} failed`);
            process.exit(1);
        }
    );
} else {
    const app = express();
    app.use(bodyParser.urlencoded({extended: true}));
    app.use(cookieParser());
    app.use(bearerToken());
    app.use(cors());
    app.use(compression());
    app.set("view engine", "pug");
    app.set("views", path.join(__dirname, "../views"));
    app.use("/api/auth", bodyParser.json(), authRouter);
    app.use("/api/server", bodyParser.json(), serverRouter);
    app.use("/api/database", bodyParser.json(), databaseRouter);

    app.use("/config", (_req: Request, res: Response) => {
        return res.json(RuntimeConfig);
    });

    // Prevent caching of the frontend HTML code
    const staticHeaderHandler = (res: Response, path: string) => {
        if (path.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-cache");
        }
    };

    if (ServerConfig.frontendPath) {
        logger.info(`Serving CARTA frontend from ${ServerConfig.frontendPath}`);
        app.use(
            "/",
            express.static(ServerConfig.frontendPath, {
                setHeaders: staticHeaderHandler
            })
        );
    } else {
        const frontendPackage = require("../node_modules/carta-frontend/package.json");
        const frontendVersion = frontendPackage?.version;
        logger.info(`Serving packaged CARTA frontend (Version ${frontendVersion})`);
        app.use("/", express.static(path.join(__dirname, "../node_modules/carta-frontend/build"), {setHeaders: staticHeaderHandler}));
    }

    let bannerDataUri: string;
    if (ServerConfig.dashboard?.bannerImage) {
        const isBannerSvg = ServerConfig.dashboard.bannerImage.toLowerCase().endsWith(".svg");
        const bannerDataBase64 = fs.readFileSync(ServerConfig.dashboard.bannerImage, "base64");
        if (isBannerSvg) {
            bannerDataUri = `data:image/svg+xml;base64,${bannerDataBase64}`;
        } else {
            bannerDataUri = `data:image/png;base64,${bannerDataBase64}`;
        }
    }

    app.get("/frontend", (req, res) => {
        const queryString = url.parse(req.url, false)?.query;
        if (queryString) {
            return res.redirect(`${ServerConfig.serverAddress ?? ""}/?${queryString}`);
        } else {
            return res.redirect(ServerConfig.serverAddress ?? "");
        }
    });

    const packageJson = require(path.join(__dirname, "../package.json"));
    app.get("/dashboard", (_req, res) => {
        res.render("templated", {
            googleClientId: ServerConfig.authProviders.google?.clientId,
            oidcClientId: ServerConfig.authProviders.oidc?.clientId,
            hostedDomain: ServerConfig.authProviders.google?.validDomain,
            googleCallback: `${ServerConfig.serverAddress}${RuntimeConfig.apiAddress}/auth/googleCallback`,
            bannerColor: ServerConfig.dashboard?.bannerColor,
            backgroundColor: ServerConfig.dashboard?.backgroundColor,
            bannerImage: bannerDataUri,
            infoText: ServerConfig.dashboard?.infoText,
            loginText: ServerConfig.dashboard?.loginText,
            footerText: ServerConfig.dashboard?.footerText,
            controllerVersion: packageJson.version
        });
    });

    app.use("/dashboard", express.static(path.join(__dirname, "../public")));

    // Scripting proxy
    const backendProxy = httpProxy.createServer({ws: true});
    app.post("/api/scripting/*", authGuard, createScriptingProxyHandler(backendProxy));

    // Simplified error handling
    app.use((err: AppError, _req: Request, res: Response, _next: NextFunction) => {
        res.status(err.statusCode ?? 500).json({
            status: err.status ?? "error",
            message: err.message
        });
    });

    // Handle WS connections
    const expressServer = http.createServer(app);
    expressServer.on("upgrade", createUpgradeHandler(backendProxy));

    // Handle WS disconnects
    backendProxy.on("error", (err: Error & {code?: string}) => {
        // Ignore connection resets
        if (err?.code === "ECONNRESET") {
            return;
        } else {
            logger.error(`Proxy error:\t${err}`);
        }
    });

    async function init() {
        await initDB();
        const onListenStart = () => {
            logger.info(`Started listening for login requests on port ${ServerConfig.serverPort}`);
        };

        // NodeJS Server constructor supports either a port (and optional interface) OR a path
        if (ServerConfig.serverInterface && typeof ServerConfig.serverPort === "number") {
            expressServer.listen(ServerConfig.serverPort, ServerConfig.serverInterface, onListenStart);
        } else {
            expressServer.listen(ServerConfig.serverPort, onListenStart);
        }
    }

    init().then(() => logger.info(`Server initialised successfully at ${ServerConfig.serverAddress ?? "localhost"}`));
}
