This document outlines steps required to get a CARTA controller configured on K8s using the `k8s-test` branch of the [carta-controller repo](https://github.com/cartavis/carta-controller).

Prerequisites
===
* Some sort of ingress configured to route and perform SSLification while acting as a reverse proxy.  We used the [Traefik ingress](https://doc.traefik.io/traefik/providers/kubernetes-ingress/) to align with the CANFAR project.

* [Ceph CSI](https://github.com/ceph/ceph-csi) or other storage infrastructure backend supporting multiple attachments.  The k8s version of the carta controller requires that a persistent volume claim exist which (named `images-pvc` by default which can be overridden by defining the environment variable `K8S_IMAGES_PVC` for the controller instances).

* A way to deal with userid and groupid mapping in k8s to match filesystem mounts.  In the example here, the [libnss-extrausers library](https://github.com/deepin-community/libnss-extrausers) is used to inject additional UIDs and GIDs into the controller container, with it then in turn injecting the corresponding numeric UID and GIDs into backend pods.  This is a different approach than used in the CANFAR platform, which instead uses a separate service to provide UID/GID mappings.  More details on how to configure this will be provided later.

ConfigMaps, Persistant Volume Claims, and Secrets
===

**Backend configmap**

A configuration file for the backend is dynamically generated based on a config map named `carta-backend-config`.  This allows most of the fields in the backend config to specified similar to how they are in the config files generally available (`browser`, `enable_scripting`, `event_thread_count`, `exit_timeout`, `idle_timeout`, `initial_timeout`, `log_performance`, `log_protocol_messages`, `omp_threads`, `read_only_mode`, `starting_folder`, `top_level_folder`, `verbosity`).  An example config map manifest follows:
```
apiVersion: v1
data:
  enable_scripting: "false"
  exit_timeout: "0"
  idle_timeout: "14400"
  initial_timeout: "30"
  omp_threads: "8"
kind: ConfigMap
metadata:
  creationTimestamp: null
  name: carta-backend-config
```
**Controller config**

This basically contains a copy of the carta config directory in k8s secret form (expected to be named `carta-config`).  It's advised to create the config in a directory as with a normal controller setup, and then generate the config by using a command similar to the following one:
```
kubectl create secret generic carta-config --from-file=./my-carta-config
```

**Extra users**
As mentioned, the `libnss-extrausers` app is being used in this example as a way to inject extra users through allowing additional password and shadow files to be viewable by the controller.  Currently this is setup by mounting a configmap named `carta-extrausers` when creating controller pods through for more dynamic systems a filesystem could be mounted at that path instead.  The secret can be created in a similar fashion as with the controller secret 
```
kubectl create secret generic carta-extrausers --from-file=./my-extra-users
```
Service account creation / configuration
===
For the controller to be able to manage CARTA backends and view their log output a service account was used, a setup similar to the following was used with this service account then made available during container deployment.

**Role**
```
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  creationTimestamp: null
  name: carta-controller-role
  namespace: default
rules:
- apiGroups:
  - ""
  resources:
  - pods
  verbs:
  - get
  - list
  - create
  - delete
- apiGroups:
  - ""
  resources:
  - "pods/log"
  verbs:
  - get
```

**Service account**
```
apiVersion: v1
kind: ServiceAccount
metadata:
  creationTimestamp: null
  name: carta-controller-sa
  namespace: default
```

**Rolebindings**
```
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  creationTimestamp: null
  name: carta-controller-role-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: carta-controller-role
subjects:
- kind: ServiceAccount
  name: carta-controller-sa
  namespace: default
```

Deploy the controller
===
```
apiVersion: apps/v1
kind: Deployment
metadata:
  creationTimestamp: null
  labels:
    app: carta-controller
  name: carta-controller
spec:
  replicas: 1
  selector:
    matchLabels:
      app: carta-controller
  strategy: {}
  template:
    metadata:
      creationTimestamp: null
      labels:
        app: carta-controller
    spec:
      serviceAccountName: carta-controller-sa
      containers:
      - image: quay.io/aikema/carta_k8s_controller_static:latest
        imagePullPolicy: Always
        name: carta-controller
        resources: {}
        env:
         - name: "K8S_NAMESPACE"
           value: "default"
         - name: "K8S_IMAGES_PVC"
           value: "cephfs-images-pvc"
        volumeMounts:
          - mountPath: /etc/carta
            name: carta-config
          - mountPath: /var/lib/extrausers
            name: nss-extrausers
        securityContext:
          runAsUser: 1000
          runAsGroup: 1000
          allowPrivilegeEscalation: false
        ports:
          - containerPort: 8000
      volumes:
      - name: carta-config
        secret:
          secretName: carta-config
      - name: nss-extrausers
        configMap:
          name: carta-extrausers
status: {}
```

Making the service accessible
===
A k8s service was created, and then the Traefik ingress was used to route traffic to instances of the controller via the service.  As previously mentioned the Traefik ingress was chosen to align with 

**Service**
```
apiVersion: v1
kind: Service
metadata:
  name: controller-service
spec:
  selector:
    app: carta-controller
  ports:
    - protocol: TCP
      port: 8000
      targetPort: 8000
```

**IngressRoutes**
```
---
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: ingressroute
spec:
  entryPoints:
    - web
    - websecure
  routes:
  - match: PathPrefix(`/`)
    kind: Rule
    services:
    - name: controller-service
      port: 8000
```

Expected soon
===
The above provides a short outline of how to deploy CARTA set to launch pods on kubernetes, and helm charts are expected to be available shortly to help further automate the process.

Recipes for the containers used herein can be found [here](https://github.com/daikema/carta_k8s_containers).
