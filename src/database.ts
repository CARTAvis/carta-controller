import Ajv from "ajv";
import addFormats from "ajv-formats";
import express, {type NextFunction, type Response} from "express";
import {type Collection, type Db, MongoClient, ObjectId} from "mongodb";
import {authGuard} from "./auth";
import {ServerConfig} from "./config";
import type {AuthenticatedRequest} from "./types";
import {logger, noCache} from "./util";

const PREFERENCE_SCHEMA_VERSION = 2;
const LAYOUT_SCHEMA_VERSION = 2;
const SNIPPET_SCHEMA_VERSION = 1;
const WORKSPACE_SCHEMA_VERSION = 0;
const preferenceSchema = require("../schemas/preferences_schema_2.json");
const layoutSchema = require("../schemas/layout_schema_2.json");
const snippetSchema = require("../schemas/snippet_schema_1.json");
const workspaceSchema = require("../schemas/workspace_schema_1.json");
const ajv = new Ajv({useDefaults: true, strictTypes: false});
addFormats(ajv);
const validatePreferences = ajv.compile(preferenceSchema);
const validateLayout = ajv.compile(layoutSchema);
const validateSnippet = ajv.compile(snippetSchema);
const validateWorkspace = ajv.compile(workspaceSchema);

let client: MongoClient;
let preferenceCollection: Collection;
let layoutsCollection: Collection;
let snippetsCollection: Collection;
let workspacesCollection: Collection;

async function updateUsernameIndex(collection: Collection, unique: boolean) {
    const hasIndex = await collection.indexExists("username");
    if (!hasIndex) {
        await collection.createIndex({username: 1}, {name: "username", unique});
        logger.info(`Created username index for collection ${collection.collectionName}`);
    }
}

async function createOrGetCollection(db: Db, collectionName: string) {
    const collectionExists = await db.listCollections({name: collectionName}, {nameOnly: true}).hasNext();
    if (collectionExists) {
        return db.collection(collectionName);
    } else {
        logger.info(`Creating collection ${collectionName}`);
        return db.createCollection(collectionName);
    }
}

export async function initDB() {
    if (ServerConfig.database?.uri && ServerConfig.database?.databaseName) {
        try {
            client = await MongoClient.connect(ServerConfig.database.uri);
            const db = await client.db(ServerConfig.database.databaseName);
            layoutsCollection = await createOrGetCollection(db, "layouts");
            snippetsCollection = await createOrGetCollection(db, "snippets");
            preferenceCollection = await createOrGetCollection(db, "preferences");
            workspacesCollection = await createOrGetCollection(db, "workspaces");
            // Remove any existing validation in preferences collection
            await db.command({
                collMod: "preferences",
                validator: {},
                validationLevel: "off"
            });
            // Update collection indices if necessary
            await updateUsernameIndex(layoutsCollection, false);
            await updateUsernameIndex(snippetsCollection, false);
            await updateUsernameIndex(workspacesCollection, false);
            await updateUsernameIndex(preferenceCollection, true);

            logger.info(`Connected to ${client.options.dbName} on ${client.options.hosts} (Authenticated: ${client.options.credentials ? "Yes" : "No"})`);
        } catch (err) {
            logger.debug(err);
            logger.emerg("Error connecting to database");
            process.exit(1);
        }
    } else {
        logger.emerg("Database configuration not found");
        process.exit(1);
    }
}

async function handleGetPreferences(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!preferenceCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    try {
        const doc = await preferenceCollection.findOne({username: req.username}, {projection: {_id: 0, username: 0}});
        if (doc) {
            const isValid = validatePreferences(doc);
            if (!isValid) {
                const errors = JSON.stringify(validatePreferences.errors);
                logger.warning(`Returning invalid preferences:\n${errors}`);
            }
            res.json({success: true, preferences: doc});
        } else {
            return next({
                statusCode: 500,
                message: "Problem retrieving preferences"
            });
        }
    } catch (err) {
        logger.debug(err);
        return next({statusCode: 500, message: "Problem retrieving preferences"});
    }
}

async function handleSetPreferences(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!preferenceCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    const update = req.body;
    // Check for malformed update
    if (!update || !Object.keys(update).length || update.username || update._id) {
        return next({statusCode: 400, message: "Malformed preference update"});
    }

    update.version = PREFERENCE_SCHEMA_VERSION;

    const validUpdate = validatePreferences(update);
    if (!validUpdate) {
        const errors = JSON.stringify(validatePreferences.errors);
        logger.warning(`Rejecting invalid preference update:\n${errors}`);
        return next({statusCode: 400, message: "Invalid preference update"});
    }

    try {
        const updateResult = await preferenceCollection.updateOne({username: req.username}, {$set: update}, {upsert: true});
        if (updateResult.acknowledged) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem updating preferences"});
        }
    } catch (err) {
        logger.debug(err);
        return next({statusCode: 500, message: err.errmsg});
    }
}

async function handleClearPreferences(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!preferenceCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    const keys: string[] = req.body?.keys;
    // Check for malformed update
    if (!keys || !Array.isArray(keys) || !keys.length) {
        return next({statusCode: 400, message: "Malformed key list"});
    }

    const update: Record<string, string> = {};
    for (const key of keys) {
        update[key] = "";
    }

    try {
        const updateResult = await preferenceCollection.updateOne({username: req.username}, {$unset: update});
        if (updateResult.acknowledged) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem clearing preferences"});
        }
    } catch (err) {
        logger.debug(err);
        return next({statusCode: 500, message: "Problem clearing preferences"});
    }
}

async function handleGetLayouts(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!layoutsCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    try {
        const layoutList = await layoutsCollection.find({username: req.username}, {projection: {_id: 0, username: 0}}).toArray();
        const layouts: Record<string, string> = {};
        for (const entry of layoutList) {
            if (entry.name && entry.layout) {
                const isValid = validateLayout(entry.layout);
                if (!isValid) {
                    const errors = JSON.stringify(validateLayout.errors);
                    logger.warning(`Returning invalid layout '${entry.name}':\n${errors}`);
                }
                layouts[entry.name] = entry.layout;
            }
        }
        res.json({success: true, layouts});
    } catch (err) {
        logger.debug(err);
        return next({statusCode: 500, message: "Problem retrieving layouts"});
    }
}

async function handleSetLayout(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!layoutsCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    const layoutName = req.body?.layoutName;
    const layout = req.body?.layout;
    // Check for malformed update
    if (!layoutName || !layout || layout.layoutVersion !== LAYOUT_SCHEMA_VERSION) {
        return next({statusCode: 400, message: "Malformed layout update"});
    }

    const validUpdate = validateLayout(layout);
    if (!validUpdate) {
        const errors = JSON.stringify(validateLayout.errors);
        logger.warning(`Rejecting invalid layout update:\n${errors}`);
        return next({statusCode: 400, message: "Invalid layout update"});
    }

    try {
        const updateResult = await layoutsCollection.updateOne({username: req.username, name: layoutName, layout}, {$set: {layout}}, {upsert: true});
        if (updateResult.acknowledged) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem updating layout"});
        }
    } catch (err) {
        logger.debug(err);
        return next({statusCode: 500, message: err.errmsg});
    }
}

async function handleClearLayout(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!layoutsCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    const layoutName = req.body?.layoutName;
    try {
        const deleteResult = await layoutsCollection.deleteOne({
            username: req.username,
            name: layoutName
        });
        if (deleteResult.acknowledged) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem clearing layout"});
        }
    } catch (err) {
        logger.error(err);
        return next({statusCode: 500, message: "Problem clearing layout"});
    }
}

async function handleGetSnippets(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!snippetsCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    try {
        const snippetList = await snippetsCollection.find({username: req.username}, {projection: {_id: 0, username: 0}}).toArray();
        const snippets: Record<string, string> = {};
        for (const entry of snippetList) {
            if (entry.name && entry.snippet) {
                const isValid = validateSnippet(entry.snippet);
                if (!isValid) {
                    const errors = JSON.stringify(validateSnippet.errors);
                    logger.warning(`Returning invalid snippet '${entry.name}':\n${errors}`);
                }
                snippets[entry.name] = entry.snippet;
            }
        }
        res.json({success: true, snippets});
    } catch (err) {
        logger.debug(err);
        return next({statusCode: 500, message: "Problem retrieving snippets"});
    }
}

async function handleSetSnippet(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!snippetsCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    const snippetName = req.body?.snippetName;
    const snippet = req.body?.snippet;
    // Check for malformed update
    if (!snippetName || !snippet || snippet.snippetVersion !== SNIPPET_SCHEMA_VERSION) {
        return next({statusCode: 400, message: "Malformed snippet update"});
    }

    const validUpdate = validateSnippet(snippet);
    if (!validUpdate) {
        const errors = JSON.stringify(validateSnippet.errors);
        logger.error(`Rejecting invalid snippet update:\n${errors}`);
        return next({statusCode: 400, message: "Invalid snippet update"});
    }

    try {
        const updateResult = await snippetsCollection.updateOne({username: req.username, name: snippetName, snippet}, {$set: {snippet}}, {upsert: true});
        if (updateResult.acknowledged) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem updating snippet"});
        }
    } catch (err) {
        logger.debug(err);
        return next({statusCode: 500, message: err.errmsg});
    }
}

async function handleClearSnippet(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!snippetsCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    const snippetName = req.body?.snippetName;
    try {
        const deleteResult = await snippetsCollection.deleteOne({
            username: req.username,
            name: snippetName
        });
        if (deleteResult.acknowledged) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem clearing snippet"});
        }
    } catch (err) {
        logger.error(err);
        return next({statusCode: 500, message: "Problem clearing snippet"});
    }
}

async function handleClearWorkspace(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!workspacesCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    const workspaceName = req.body?.workspaceName;
    // TODO: handle CRUD with workspace ID instead of name
    // const workspaceId = req.body?.id;

    try {
        const deleteResult = await workspacesCollection.deleteOne({
            username: req.username,
            name: workspaceName
        });
        if (deleteResult.acknowledged) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem clearing workspace"});
        }
    } catch (err) {
        logger.error(err);
        return next({statusCode: 500, message: "Problem clearing workspace"});
    }
}

async function handleGetWorkspaceList(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!workspacesCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    try {
        const workspaceList = await workspacesCollection.find({username: req.username}, {projection: {_id: 1, name: 1, "workspace.date": 1}}).toArray();
        const workspaces =
            workspaceList?.map(w => ({
                ...w,
                id: w._id.toString(),
                date: w.workspace?.date
            })) ?? [];
        res.json({success: true, workspaces});
    } catch (err) {
        logger.debug(err);
        return next({statusCode: 500, message: "Problem retrieving workspaces"});
    }
}

async function handleGetWorkspaceByName(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!req.params?.name) {
        return next({statusCode: 403, message: "Invalid workspace name"});
    }

    if (!workspacesCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    try {
        const queryResult = await workspacesCollection.findOne({username: req.username, name: req.params.name}, {projection: {username: 0}});
        if (!queryResult?.workspace) {
            return next({statusCode: 404, message: "Workspace not found"});
        } else {
            const workspace = {
                id: queryResult._id.toString(),
                name: queryResult.name,
                editable: true,
                ...queryResult.workspace
            };
            const isValid = validateWorkspace(workspace);
            if (!isValid) {
                const errors = JSON.stringify(validateWorkspace.errors);
                logger.warning(`Returning invalid workspace '${workspace.name}':\n${errors}`);
            }
            res.json({success: true, workspace: workspace});
        }
    } catch (err) {
        logger.debug(err);
        return next({statusCode: 500, message: "Problem retrieving workspace"});
    }
}

async function handleGetWorkspaceByKey(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!req.params?.key) {
        return next({statusCode: 403, message: "Invalid workspace id"});
    }

    if (!workspacesCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    try {
        const objectId = Buffer.from(req.params.key, "base64url").toString("hex");
        const queryResult = await workspacesCollection.findOne({
            _id: new ObjectId(objectId)
        });
        if (!queryResult?.workspace) {
            return next({statusCode: 404, message: "Workspace not found"});
        } else if (queryResult.username !== req.username && !queryResult.shared) {
            return next({statusCode: 403, message: "Workspace not accessible"});
        } else {
            const workspace = {
                id: queryResult._id.toString(),
                name: queryResult.name,
                editable: queryResult.username === req.username,
                ...queryResult.workspace
            };
            const isValid = validateWorkspace(workspace);
            if (!isValid) {
                const errors = JSON.stringify(validateWorkspace.errors);
                logger.warning(`Returning invalid workspace '${workspace.name}':\n${errors}`);
            }
            res.json({success: true, workspace: workspace});
        }
    } catch (err) {
        logger.debug(err);
        return next({statusCode: 500, message: "Problem retrieving workspace"});
    }
}

async function handleSetWorkspace(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!workspacesCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    const workspaceName = req.body?.workspaceName;
    const workspace = req.body?.workspace;
    // Check for malformed update
    if (!workspaceName || !workspace || workspace.workspaceVersion !== WORKSPACE_SCHEMA_VERSION) {
        return next({statusCode: 400, message: "Malformed workspace update"});
    }

    const validUpdate = validateWorkspace(workspace);
    if (!validUpdate) {
        const errors = JSON.stringify(validateWorkspace.errors);
        logger.error(`Rejecting invalid workspace update:\n${errors}`);
        return next({statusCode: 400, message: "Invalid workspace update"});
    }

    try {
        const updateResult = await workspacesCollection.findOneAndUpdate({username: req.username, name: workspaceName}, {$set: {workspace}}, {upsert: true, returnDocument: "after"});
        if (updateResult.ok && updateResult.value) {
            res.json({
                success: true,
                workspace: {
                    ...(workspace as Record<string, unknown>),
                    id: updateResult.value._id.toString(),
                    editable: true,
                    name: workspaceName
                }
            });
            return;
        } else {
            return next({statusCode: 500, message: "Problem updating workspace"});
        }
    } catch (err) {
        logger.debug(err);
        return next({statusCode: 500, message: err.errmsg});
    }
}

async function handleShareWorkspace(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    const id = req.params.id as string;
    if (!id) {
        return next({statusCode: 403, message: "Invalid workspace id"});
    }

    if (!workspacesCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    try {
        const updateResult = await workspacesCollection.findOneAndUpdate({_id: new ObjectId(id)}, {$set: {shared: true}});
        if (updateResult.ok) {
            const shareKey = Buffer.from(id, "hex").toString("base64url");
            res.json({success: true, id, shareKey});
        } else {
            return next({statusCode: 500, message: "Problem sharing workspace"});
        }
    } catch (err) {
        logger.debug(err);
        return next({statusCode: 500, message: err.errmsg});
    }
}

export const databaseRouter = express.Router();

databaseRouter.get("/preferences", authGuard, noCache, handleGetPreferences);
databaseRouter.put("/preferences", authGuard, noCache, handleSetPreferences);
databaseRouter.delete("/preferences", authGuard, noCache, handleClearPreferences);

databaseRouter.get("/layouts", authGuard, noCache, handleGetLayouts);
databaseRouter.put("/layout", authGuard, noCache, handleSetLayout);
databaseRouter.delete("/layout", authGuard, noCache, handleClearLayout);

databaseRouter.get("/snippets", authGuard, noCache, handleGetSnippets);
databaseRouter.put("/snippet", authGuard, noCache, handleSetSnippet);
databaseRouter.delete("/snippet", authGuard, noCache, handleClearSnippet);

databaseRouter.post("/share/workspace/:id", authGuard, noCache, handleShareWorkspace);

databaseRouter.get("/list/workspaces", authGuard, noCache, handleGetWorkspaceList);
databaseRouter.get("/workspace/key/:key", authGuard, noCache, handleGetWorkspaceByKey);
databaseRouter.get("/workspace/:name", authGuard, noCache, handleGetWorkspaceByName);
databaseRouter.put("/workspace", authGuard, noCache, handleSetWorkspace);
databaseRouter.delete("/workspace", authGuard, noCache, handleClearWorkspace);
