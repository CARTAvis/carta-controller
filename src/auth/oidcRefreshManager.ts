import {createCipheriv, createDecipheriv, randomBytes} from "node:crypto";
import {floor} from "lodash";
import {Binary, type Collection, MongoClient} from "mongodb";

import {ServerConfig} from "../config";
import {logger} from "../util";

let lockCollection: Collection;
let refreshTokenCollection: Collection;
let accessTokenLifeTimesCollection: Collection;

export async function initRefreshManager() {
    try {
        // A weird error occurs when a second DB object is created using same client
        // so recreating the client here as well
        const client = await MongoClient.connect(ServerConfig.database.uri);
        const db = client.db(ServerConfig.database.databaseName);

        // Ensure that locks and refresh tokens tables are there with appropriate indices
        if (!(await db.listCollections({name: "tokenLock"}, {nameOnly: true}).hasNext())) {
            logger.info("Creating token lock collection");
            lockCollection = await db.createCollection("tokenLock");
        } else {
            lockCollection = await db.collection("tokenLock");
        }
        if (!(await db.listCollections({name: "refreshTokens"}, {nameOnly: true}).hasNext())) {
            logger.info("Creating refresh tokens collection");
            refreshTokenCollection = await db.createCollection("refreshTokens");
        } else {
            refreshTokenCollection = await db.collection("refreshTokens");
        }
        if (!(await db.listCollections({name: "accessTokenLifetimes"}, {nameOnly: true}).hasNext())) {
            logger.info("Creating access token's lifetimes collection");
            accessTokenLifeTimesCollection = await db.createCollection("accessTokenLifetimes");
        } else {
            accessTokenLifeTimesCollection = await db.collection("accessTokenLifetimes");
        }

        // Create indices
        const hasLockSessionIndex = await lockCollection.indexExists("lockSession");
        if (!hasLockSessionIndex) {
            await lockCollection.createIndex({sessionid: 1}, {name: "lockSession", unique: true});
            logger.info("Created session index for lockSession collection");
        }
        const hasLockExpiryIndex = await lockCollection.indexExists("lockExpiry");
        if (!hasLockExpiryIndex) {
            await lockCollection.createIndex({expireAt: 1}, {name: "lockExpiry", expireAfterSeconds: 0});
            logger.info("Created expiry index for lockSession collection");
        }
        for (const coll of [refreshTokenCollection, accessTokenLifeTimesCollection]) {
            const hasUserSessionIndex = await coll.indexExists("userSession");
            if (!hasUserSessionIndex) {
                await coll.createIndex({username: 1, sessionid: 1}, {name: "userSession", unique: true});
                logger.info(`Created username/session index for collection ${coll.collectionName}`);
            }

            const hasExpiryIndex = await coll.indexExists("expiryIndex");
            if (!hasExpiryIndex) {
                await coll.createIndex({expireAt: 1}, {name: "expiryIndex", expireAfterSeconds: 0});
                logger.info(`Created index adding TTL for collection ${coll.collectionName}`);
            }
        }
    } catch (err) {
        logger.emerg("Error with database connection");
        logger.debug(err);
        process.exit(1);
    }
}

/*
This function (and the corresponding releaseRefreshLock) provide basic
distributed locking capabilities using the expiry TTLs in mongodb, which
will hopefully be adequate for the purposes in use for here.
*/
export async function acquireRefreshLock(sessionid, expiresIn, numRetries = 40, msBetweenRetries = 500) {
    const expireAt = new Date(Date.now() + expiresIn * 1000);

    for (let i = 0; i < numRetries; i++) {
        try {
            // TTLs indexes are only garbage-collected every minute or so, so manually
            // purge any that have expired
            await lockCollection.deleteMany({expireAt: {$lt: new Date()}});

            await lockCollection.insertOne({
                sessionid,
                expireAt
            });

            // No duplicate key error throw by above insert so got lock
            return true;
        } catch (e) {
            if (e.code !== 11000) {
                // Not a duplicate key error (which would indicate a failure to acquire the lock)
                logger.warning(e);
            }
        }
        // Wait the specified amount of time before trying again
        await new Promise(resolve => {
            setTimeout(resolve, msBetweenRetries);
        });
    }

    // Failed to acquire lock despite hitting numRetries
    return false;
}

export async function releaseRefreshLock(sessionid) {
    // Delete lock record from DB
    try {
        const deleteResult = await lockCollection.deleteOne({sessionid});
        return deleteResult.acknowledged;
    } catch (e) {
        logger.warning(e);
        return false;
    }
}

// A symmetric key is used to encrypt the refreshToken at rest, with the key
// only retained by the client
export async function getRefreshToken(username, sessionid, symmKey) {
    try {
        const record = await refreshTokenCollection.findOne({
            username,
            sessionid
        });

        if (record?.expireAt < Date.now()) {
            // An already expired token that MongoDB hasn't clear out yet
            return;
        }

        const decipher = createDecipheriv("aes-256-cbc", symmKey, record?.iv.buffer);
        let decrypted = decipher.update(record?.refreshToken, "hex", "utf8");
        decrypted += decipher.final("utf8");

        return decrypted;
    } catch (e) {
        logger.error(e);
        return;
    }
}

// A symmetric key is used to encrypt the refreshToken at rest, with the key
// only retained by the client
export async function setRefreshToken(username, sessionid, refreshToken, symmKey, expiresIn) {
    try {
        // Encrypt the token so gaining access to mongo isn't enough to steal the refresh token
        const iv = randomBytes(16);
        const cipher = createCipheriv("aes-256-cbc", symmKey, iv);
        const encrypted = cipher.update(refreshToken, "utf8", "hex") + cipher.final("hex");

        const expireAt = new Date(Date.now() + expiresIn * 1000);
        const updateResult = await refreshTokenCollection.updateOne(
            {username, sessionid},
            {
                $set: {
                    expireAt,
                    refreshToken: encrypted,
                    iv: new Binary(iv)
                }
            },
            {upsert: true}
        );
        return updateResult.acknowledged;
    } catch (e) {
        logger.error(e);
        return false;
    }
}

export async function getAccessTokenExpiry(username, sessionid) {
    try {
        // Lookup record in MongoDB using key
        const record = await accessTokenLifeTimesCollection.findOne({
            username,
            sessionid
        });
        // Calculate expiry by subtracting the current time from stored key's expiry time
        const remaining = floor((record?.expireAt.getTime() - Date.now()) / 1000);
        if (remaining > 0) {
            return remaining;
        }
    } catch (e) {
        logger.error(e);
        // Return 0 if record not found or an unexpected error occurs
        return 0;
    }
    // Return 0 if record not found or an unexpected error occurs
    return 0;
}

export async function setAccessTokenExpiry(username, sessionid, expiresIn) {
    try {
        const expireAt = new Date(Date.now() + expiresIn * 1000);
        const updateResult = await accessTokenLifeTimesCollection.updateOne({username, sessionid}, {$set: {expireAt}}, {upsert: true});
        return updateResult.acknowledged;
    } catch (e) {
        logger.error(e);
        return false;
    }
}
