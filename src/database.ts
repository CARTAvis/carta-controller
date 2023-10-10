import * as express from "express";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {Collection, Db, MongoClient, ObjectId} from "mongodb";
import {authGuard} from "./auth";
import {noCache, toObjectId, verboseError} from "./util";
import {AuthenticatedRequest} from "./types";
import {ServerConfig} from "./config";
import {MongodbPersistence} from "y-mongodb";
import * as Y from "yjs";
import {setPersistence} from "../node_modules/y-websocket/bin/utils.js";
import {WorkspaceFile} from "./models/WorkspaceFile";


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
let workspaceTransactionsCollection: Collection;
let workspacePersistence: MongodbPersistence;

async function updateIndex(collection: Collection, indexName: string, unique: boolean) {
    const hasIndex = await collection.indexExists(indexName);
    if (!hasIndex) {
        await collection.createIndex({[indexName]: 1}, {name: indexName, unique});
        console.log(`Created ${indexName} index for collection ${collection.collectionName}`);
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

export async function initYjsPersistence() {
    const collection = "workspace-transactions";
    workspacePersistence = new MongodbPersistence(ServerConfig.database.uri + `/${ServerConfig.database.databaseName}`, collection);

    setPersistence({
        bindState: async (docName, ydoc) => {
            // Here you listen to granular document updates and store them in the database
            // You don't have to do this, but it ensures that you don't lose content when the server crashes
            // See https://github.com/yjs/yjs#Document-Updates for documentation on how to encode
            // document updates

            const doc = await workspacePersistence.getYDoc(docName);
            const newUpdates = Y.encodeStateAsUpdate(ydoc);
            workspacePersistence.storeUpdate(docName, newUpdates);
            Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(doc));
            ydoc.on("update", async update => {
                workspacePersistence.storeUpdate(docName, update);
                const doc = await workspacePersistence.getYDoc(docName);
                console.log(doc.toJSON());
            });
        },
        writeState: async (docName, ydoc) => {
            // This is called when all connections to the document are closed.
            // In the future, this method might also be called in intervals or after a certain number of updates.
            return new Promise<void>(resolve => {
                // When the returned Promise resolves, the document will be destroyed.
                // So make sure that the document really has been written to the database.
                resolve();
            });
        }
    });
}

export async function initDB() {
    if (!(ServerConfig.database?.uri && ServerConfig.database?.databaseName)) {
        console.error("Database configuration not found");
        return process.exit(1);
    }

    try {
        client = await MongoClient.connect(ServerConfig.database.uri);
        const db = client.db(ServerConfig.database.databaseName);
        layoutsCollection = await createOrGetCollection(db, "layouts");
        snippetsCollection = await createOrGetCollection(db, "snippets");
        preferenceCollection = await createOrGetCollection(db, "preferences");
        workspacesCollection = await createOrGetCollection(db, "workspaces");
        workspaceTransactionsCollection = await createOrGetCollection(db, "workspace-transactions");

        // Remove any existing validation in preferences collection
        await db.command({collMod: "preferences", validator: {}, validationLevel: "off"});
        // Update collection indices if necessary
        await updateIndex(layoutsCollection, "username", false);
        await updateIndex(snippetsCollection, "username", false);
        await updateIndex(workspacesCollection, "username", false);
        await updateIndex(preferenceCollection, "username", true);
        // Yjs init
        await initYjsPersistence();
        await updateIndex(workspaceTransactionsCollection, "docName", false);

        console.log(`Connected to server ${ServerConfig.database.uri} and database ${ServerConfig.database.databaseName}`);
    } catch (err) {
        verboseError(err);
        console.error("Error connecting to database");
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
        const workspaceDocQuery = await workspacesCollection.findOne({username: req.username, name: workspaceName});
        if (!workspaceDocQuery?.workspace) {
            return next({statusCode: 404, message: "Workspace not found"});
        }

        // Delete transactions for this workspace
        const workspaceId = workspaceDocQuery._id.toString();
        const transactionDeleteResult = await workspaceTransactionsCollection.deleteMany({docName: workspaceId});
        console.log(`Deleted ${transactionDeleteResult.deletedCount} transactions for workspace ${workspaceId}`);

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
        const objectId = toObjectId(req.params.key);
        const queryResult = await workspacesCollection.findOne({_id: objectId});
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

export async function canLoadWorkspace(username: string, key: string) {
    if (!workspacesCollection) {
        return false;
    }

    try {
        const objectId = toObjectId(key);
        const workspaceDocQuery = await workspacesCollection.findOne({_id: objectId});
        if (!workspaceDocQuery?.workspace) {
            return false;
        }
        return workspaceDocQuery.username === username || !!workspaceDocQuery.shared;
    } catch (err) {
        verboseError(err);
        return false;
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
        const updateResult = await workspacesCollection.findOneAndUpdate({username: req.username, name: workspaceName}, {$set: {workspace}}, {
            upsert: true,
            returnDocument: "after"
        });
        if (updateResult.ok && updateResult.value) {

            // Create YJS document for workspace
            const workspaceId = updateResult.value._id.toString();
            const key = Buffer.from(workspaceId, "hex").toString("base64url");
            //const doc = initWorkspace(key, (workspace as any).files);

            res.json({
                success: true,
                workspace: {
                    ...(workspace as any),
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