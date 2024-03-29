import * as express from "express";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {Collection, Db, MongoClient, ObjectId} from "mongodb";
import {authGuard} from "./auth";
import {noCache, verboseError} from "./util";
import {AuthenticatedRequest} from "./types";
import {ServerConfig} from "./config";

const PREFERENCE_SCHEMA_VERSION = 2;
const LAYOUT_SCHEMA_VERSION = 2;
const SNIPPET_SCHEMA_VERSION = 1;
const WORKSPACE_SCHEMA_VERSION = 0;
const preferenceSchema = require("../config/preference_schema_2.json");
const layoutSchema = require("../config/layout_schema_2.json");
const snippetSchema = require("../config/snippet_schema.json");
const workspaceSchema = require("../config/workspace_schema_1.json");
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
        console.log(`Created username index for collection ${collection.collectionName}`);
    }
}

async function createOrGetCollection(db: Db, collectionName: string) {
    const collectionExists = await db.listCollections({name: collectionName}, {nameOnly: true}).hasNext();
    if (collectionExists) {
        return db.collection(collectionName);
    } else {
        console.log(`Creating collection ${collectionName}`);
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
            await db.command({collMod: "preferences", validator: {}, validationLevel: "off"});
            // Update collection indices if necessary
            await updateUsernameIndex(layoutsCollection, false);
            await updateUsernameIndex(snippetsCollection, false);
            await updateUsernameIndex(workspacesCollection, false);
            await updateUsernameIndex(preferenceCollection, true);

            console.log(`Connected to ${client.options.dbName} on ${client.options.hosts} (Authenticated: ${client.options.credentials ? 'Yes': 'No'})`);
        } catch (err) {
            verboseError(err);
            console.error("Error connecting to database");
            process.exit(1);
        }
    } else {
        console.error("Database configuration not found");
        process.exit(1);
    }
}

async function handleGetPreferences(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!preferenceCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    try {
        const doc = await preferenceCollection.findOne({username: req.username}, {projection: {_id: 0, username: 0}});
        if (doc) {
            res.json({success: true, preferences: doc});
        } else {
            return next({statusCode: 500, message: "Problem retrieving preferences"});
        }
    } catch (err) {
        verboseError(err);
        return next({statusCode: 500, message: "Problem retrieving preferences"});
    }
}

async function handleSetPreferences(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
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
        console.log(validatePreferences.errors);
        return next({statusCode: 400, message: "Malformed preference update"});
    }

    try {
        const updateResult = await preferenceCollection.updateOne({username: req.username}, {$set: update}, {upsert: true});
        if (updateResult.acknowledged) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem updating preferences"});
        }
    } catch (err) {
        verboseError(err);
        return next({statusCode: 500, message: err.errmsg});
    }
}

async function handleClearPreferences(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
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

    const update: any = {};
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
        verboseError(err);
        return next({statusCode: 500, message: "Problem clearing preferences"});
    }
}

async function handleGetLayouts(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!layoutsCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    try {
        const layoutList = await layoutsCollection.find({username: req.username}, {projection: {_id: 0, username: 0}}).toArray();
        const layouts = {} as any;
        for (const entry of layoutList) {
            if (entry.name && entry.layout) {
                layouts[entry.name] = entry.layout;
            }
        }
        res.json({success: true, layouts});
    } catch (err) {
        verboseError(err);
        return next({statusCode: 500, message: "Problem retrieving layouts"});
    }
}

async function handleSetLayout(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
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
        console.log(validateLayout.errors);
        return next({statusCode: 400, message: "Malformed layout update"});
    }

    try {
        const updateResult = await layoutsCollection.updateOne({username: req.username, name: layoutName, layout}, {$set: {layout}}, {upsert: true});
        if (updateResult.acknowledged) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem updating layout"});
        }
    } catch (err) {
        verboseError(err);
        return next({statusCode: 500, message: err.errmsg});
    }
}

async function handleClearLayout(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!layoutsCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    const layoutName = req.body?.layoutName;
    try {
        const deleteResult = await layoutsCollection.deleteOne({username: req.username, name: layoutName});
        if (deleteResult.acknowledged) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem clearing layout"});
        }
    } catch (err) {
        console.log(err);
        return next({statusCode: 500, message: "Problem clearing layout"});
    }
}

async function handleGetSnippets(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!snippetsCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    try {
        const snippetList = await snippetsCollection.find({username: req.username}, {projection: {_id: 0, username: 0}}).toArray();
        const snippets = {} as any;
        for (const entry of snippetList) {
            if (entry.name && entry.snippet) {
                snippets[entry.name] = entry.snippet;
            }
        }
        res.json({success: true, snippets});
    } catch (err) {
        verboseError(err);
        return next({statusCode: 500, message: "Problem retrieving snippets"});
    }
}

async function handleSetSnippet(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
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
        console.log(validateSnippet.errors);
        return next({statusCode: 400, message: "Malformed snippet update"});
    }

    try {
        const updateResult = await snippetsCollection.updateOne({username: req.username, name: snippetName, snippet}, {$set: {snippet}}, {upsert: true});
        if (updateResult.acknowledged) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem updating snippet"});
        }
    } catch (err) {
        verboseError(err);
        return next({statusCode: 500, message: err.errmsg});
    }
}

async function handleClearSnippet(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!snippetsCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    const snippetName = req.body?.snippetName;
    try {
        const deleteResult = await snippetsCollection.deleteOne({username: req.username, name: snippetName});
        if (deleteResult.acknowledged) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem clearing snippet"});
        }
    } catch (err) {
        console.log(err);
        return next({statusCode: 500, message: "Problem clearing snippet"});
    }
}


async function handleClearWorkspace(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!workspacesCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    const workspaceName = req.body?.workspaceName;
    // TODO: handle CRUD with workspace ID instead of name
    const workspaceId = req.body?.id;

    try {
        const deleteResult = await workspacesCollection.deleteOne({username: req.username, name: workspaceName});
        if (deleteResult.acknowledged) {
            res.json({success: true});
        } else {
            return next({statusCode: 500, message: "Problem clearing workspace"});
        }
    } catch (err) {
        console.log(err);
        return next({statusCode: 500, message: "Problem clearing workspace"});
    }
}

async function handleGetWorkspaceList(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    if (!workspacesCollection) {
        return next({statusCode: 501, message: "Database not configured"});
    }

    try {
        const workspaceList = await workspacesCollection.find({username: req.username}, {projection: {_id: 1, name: 1, "workspace.date": 1}}).toArray();
        const workspaces = workspaceList?.map(w => ({...w, id: w._id, date: w.workspace?.date})) ?? [];
        res.json({success: true, workspaces});
    } catch (err) {
        verboseError(err);
        return next({statusCode: 500, message: "Problem retrieving workspaces"});
    }
}

async function handleGetWorkspaceByName(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
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
            res.json({success: true, workspace: {id: queryResult._id, name: queryResult.name, editable: true, ...queryResult.workspace}});
        }
    } catch (err) {
        verboseError(err);
        return next({statusCode: 500, message: "Problem retrieving workspace"});
    }
}


async function handleGetWorkspaceByKey(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
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
        const queryResult = await workspacesCollection.findOne({_id: new ObjectId(objectId)});
        if (!queryResult?.workspace) {
            return next({statusCode: 404, message: "Workspace not found"});
        } else if (queryResult.username !== req.username && !queryResult.shared) {
            return next({statusCode: 403, message: "Workspace not accessible"});
        } else {
            res.json({success: true, workspace: {id: queryResult._id, name: queryResult.name, editable: queryResult.username === req.username, ...queryResult.workspace}});
        }
    } catch (err) {
        verboseError(err);
        return next({statusCode: 500, message: "Problem retrieving workspace"});
    }
}


async function handleSetWorkspace(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
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
        console.log(validateWorkspace.errors);
        return next({statusCode: 400, message: "Malformed workspace update"});
    }

    try {
        const updateResult = await workspacesCollection.findOneAndUpdate({username: req.username, name: workspaceName}, {$set: {workspace}}, {upsert: true, returnDocument: "after"});
        if (updateResult.ok && updateResult.value) {
            res.json({
                success: true,
                workspace: {
                    ...(workspace as any),
                    id: updateResult.value._id.toString(),
                    editable: true,
                    name: workspaceName
                }});
            return;
        } else {
            return next({statusCode: 500, message: "Problem updating workspace"});
        }
    } catch (err) {
        verboseError(err);
        return next({statusCode: 500, message: err.errmsg});
    }
}


async function handleShareWorkspace(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
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
        verboseError(err);
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