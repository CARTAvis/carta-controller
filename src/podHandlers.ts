import express, {Request, Response, NextFunction} from 'express';
import httpProxy from "http-proxy";
import * as url from "url";
import * as querystring from "querystring";
import {v4} from "uuid";
import {IncomingMessage} from "http";
import {delay, noCache, verboseError} from "./util";
import {authGuard, getUser, verifyToken} from "./auth";
import {AuthenticatedRequest} from "./types";
import { execFile } from 'child_process';
import { env} from "process";

import { KubeConfig, CoreV1Api } from '@kubernetes/client-node';
const kubNamespace : string = env.K8S_NAMESPACE ? env.K8S_NAMESPACE : 'default';
const kubBackendImg : string = env.K8S_BACKEND_IMG ? env.K8S_BACKEND_IMG : 'quay.io/aikema/carta_k8s_backend';
const kubImagesPvc : string = env.K8S_IMAGES_PVC ? env.K8S_IMAGES_PVC : 'cephfs-images-pvc';
if (env.K8S_NAMESPACE) {
    console.log(`Read k8s namespace "${kubNamespace}" from environment`)
}
if (env.K8S_BACKEND_IMG) {
    console.log(`Read k8s backend image "${kubBackendImg}" from environment`)
}
if (env.K8S_IMAGES_PVC) {
    console.log(`Read k8s image PVC "${kubImagesPvc}" from environment`)
}
const kc = new KubeConfig();
kc.loadFromCluster();

const k8sApi = kc.makeApiClient(CoreV1Api);

export function getUserIdInfo (username: string): Promise<{uid: number, gid: number, groups: number[]}> {
    return new Promise((resolve, reject) => {
        execFile('/usr/bin/id', [username], (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                const output = stdout.trim();
                const uid_output = output?.match(/uid=(\d+)/);
                const gid_output = output?.match(/gid=(\d+)/);
                const groups_output =  output.match(/groups=(.*)/);

                if (Array.isArray(uid_output) && uid_output[1] !== undefined &&
                    Array.isArray(gid_output) && gid_output[1] !== undefined &&
                    Array.isArray(groups_output) && groups_output[1] !== undefined) {
                        const uid = parseInt(uid_output[1]);
                        const gid = parseInt(gid_output[1]);
                        const groups = groups_output[1].split(',').map(group => parseInt(group.split('(')[0]));
                        if (isNaN(uid) || isNaN(gid) || groups.map(x => isNaN(x)).includes(true)) {
                            reject(new Error("Invalid id info"))
                        } else {
                            resolve({ uid, gid, groups });
                        }
                } else {
                    reject(new Error("Invalid id info"));
                } 
            }
        });
    });
}

async function handleCheckServer(req: AuthenticatedRequest, res: Response) {
    if (!req.username) {
        res.status(403).json({success: false, message: "Invalid username"});
        return;
    }

    try {
        const labelSelector = `name=carta-backend-${req.username}`;

        const pod = await k8sApi.readNamespacedPod(`carta-backend-${req.username}`, kubNamespace);
        const containerStatuses = pod?.body?.status?.containerStatuses;

        res.json({
            success: true,
            running: containerStatuses && ! containerStatuses[0].state?.running
        });
    } catch (e) {
        res.json({
            success: false,
            running: undefined
        });
    }
}

async function handleLog(req: AuthenticatedRequest, res: Response) {
    if (!req.username) {
        res.status(403).json({success: false, message: "Invalid username"});
        return;
    }

    try {
        // Pull this from container logs
        const podName = `carta-backend-${req.username}`;
        const podLog = await k8sApi.readNamespacedPodLog(podName || "", kubNamespace);

        res.json({
            success: true,
            log: podLog.body
        })
        return;
    } catch (error) {
        console.log(error);
        res.json({success: false});
        return;
    }
}

async function handleStartServer(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        res.status(403).json({success: false, message: "Invalid username"});
        return;
    }

    console.log("handleStartServer never actually gets executed")
    throw {statusCode: 501, message: "Not implemented as never in practice gets called"};

    /*
    startServer(req.username);
    return res.json({success: true, existing: true});
    */
}

async function startServer(username: string) {

    let userInfo : {uid: number, gid: number, groups: number[]} | undefined;

    try {
        userInfo = await getUserIdInfo(username)
    } catch (err) {
        console.log(`User ${username} info could not be found`)
        return;
    }
    if (!userInfo) {
        console.log(`User ${username} info could not be found`)
        return;
    }

    const manifest = {
        metadata: {
            name: `carta-backend-${username}`,
        },
        spec: {
            volumes: [{ name: 'images-volume', persistentVolumeClaim: {claimName: kubImagesPvc}},
                      { name: 'backend-config', configMap: { name: 'carta-backend-config' }},
                      { name: 'nss-extrausers', configMap: { name: 'carta-extrausers' }}],
            restartPolicy: 'Never',
            securityContext: {
                runAsUser: userInfo.uid,
                runAsGroup: userInfo.gid,
                supplementalGroups: userInfo.groups,
            },
            containers: [
            {
                name: `carta-backend-${username}`,
                image: kubBackendImg,
                imagePullPolicy: 'Always',
                args: [
                '--top_level_folder',
                '/images',
                '--controller_deployment',
                '/images'
                ],
                ports: [{ containerPort: 3002 }],
                volumeMounts: [{
                    mountPath: '/images',
                    name: 'images-volume'
                    }, {
                        mountPath: '/config',
                        readOnly: true,
                        name: 'backend-config'
                    }, {
                        mountPath: '/var/lib/extrausers',
                        readOnly: true,
                        name: 'nss-extrausers'
                    }],
                env: [
                {
                    name: 'CARTA_AUTH_TOKEN',
                    value: v4(),
                },
                ],
                securityContext: {
                    allowPrivilegeEscalation: false,
                },
            },
            ],
        }
    };

    k8sApi.createNamespacedPod(kubNamespace, manifest).then(
        (response) => {
            console.log(`Pod created:\t${response?.body?.metadata?.name}`);
        },
        (err) => {
            console.error('Error:', err);
        },
    );

    const labelSelector = `name=carta-backend-${username}`;
    for (let i = 0; i < 100; i++) {
        try {
            const res = await k8sApi.readNamespacedPod(`carta-backend-${username}`, kubNamespace);

            const containerStatuses = res?.body?.status?.containerStatuses;
            if (! containerStatuses || ! containerStatuses[0].state?.running ) {
                console.log(`Pod not running for ${username}`)
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                console.log(`Pod running for ${username}`)
                break;
            }
        } catch (err) {
            if (err.response && err.response.body && err.response.body.code === 404) {
                console.log(`Pod not running for ${username}`)
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                console.log(err)
            }
        }
    }
}

async function handleStopServer(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.username) {
        return next({statusCode: 403, message: "Invalid username"});
    }

    try {
        const podName=`carta-backend-${req.username}`;
        const gracePeriodSeconds = 2;
        await k8sApi.deleteNamespacedPod(podName, kubNamespace, undefined, undefined, gracePeriodSeconds);
        console.log('Pod deleted:', podName);
    } catch (error) {
        console.error('Error: ', error)
    }

    res.json({success: true});
    return;
}

export const createUpgradeHandler = (server: httpProxy) => async (req: IncomingMessage, socket: any, head: any) => {
    try {
        if (!req?.url) {
            return socket.end();
        }
        let parsedUrl = url.parse(req.url);
        if (!parsedUrl?.query) {
            console.log(`Incoming Websocket upgrade request could not be parsed: ${req.url}`);
            return socket.end();
        }
        let queryParameters = querystring.parse(parsedUrl.query);
        const tokenString = queryParameters?.token;
        if (!tokenString || Array.isArray(tokenString)) {
            console.log(`Incoming Websocket upgrade request is missing an authentication token`);
            return socket.end();
        }

        const token = await verifyToken(tokenString);
        if (!token || !token.username) {
            console.log(`Incoming Websocket upgrade request has an invalid token`);
            return socket.end();
        }

        const remoteAddress = req.headers?.["x-forwarded-for"] || req.connection?.remoteAddress;
        console.log(`WS upgrade request from ${remoteAddress} for authenticated user ${token.username}`);

        const username = getUser(token.username, token.iss);
        if (!username) {
            console.log(`Could not find username ${token.username} in the user map`);
            return socket.end();
        }

        // Look up pod info and create if necessary
       const podName = `carta-backend-${username}`;
       try {
            const res = await k8sApi.readNamespacedPod(podName, kubNamespace);

            const containerStatuses = res?.body?.status?.containerStatuses;
            if (containerStatuses && containerStatuses[0].state?.terminated) {
                console.log(`Found stopped backend for ${username} ... need to remove it and start a new one`)
                await k8sApi.deleteNamespacedPod(podName, kubNamespace);
                let podExists = true;
                while (podExists) {
                    try {
                        await k8sApi.readNamespacedPod(podName, kubNamespace);
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } catch (err) {
                        if (err.response.statusCode === 404) {
                            podExists = false;
                        } else {
                            throw err;
                        }
                    }
                }
                await startServer(username);
            }
            if (! containerStatuses || ! containerStatuses[0].state?.running ) {
                console.log(`Server not running for ${username}... assume it's still starting`)
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
       } catch (err) {
         if (err.response && err.response.body && err.response.body.code === 404) {
            console.log(`No pod found for ${username}`);
            await startServer(username);
         } else {
            console.log(err);
            return socket.end();
         }
       }

        // Look up auth token
        const pod = await k8sApi.readNamespacedPod(`carta-backend-${username}`, kubNamespace)
        const podIp = `${pod.body.status?.podIP}`;
        const cartaAuthToken = pod?.body?.spec?.containers[0]?.env?.find(env => env.name === 'CARTA_AUTH_TOKEN');
        if (cartaAuthToken === undefined) {
            throw new Error(`Auth token missing for ${username}`);
        }

        req.headers["carta-auth-token"] = cartaAuthToken?.value; //cartaAuthToken?.value;
        req.url = "/";
        return server.ws(req, socket, head, {target: {host: podIp, port: 3002}});
    } catch (err) {
        console.log(`Error upgrading socket`);
        console.log(err);
        return socket.end();
    }
};

export const createScriptingProxyHandler = (server: httpProxy) => async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    console.log("createScriptingProxyHandler not implemented as neither Google nor OIDC auth methods compatible")
    throw {statusCode: 501, message: "createScriptingProxyHandler not implemented as neither Google nor OIDC auth methods compatible"};
};

export const serverRouter = express.Router();
serverRouter.post("/start", authGuard, noCache, handleStartServer); // in practice not used
serverRouter.post("/stop", authGuard, noCache, handleStopServer);
serverRouter.get("/status", authGuard, noCache, handleCheckServer);
serverRouter.get("/log", authGuard, noCache, handleLog);
