const strippedPath = window.location.href.replace(window.location.search, "").replace("/dashboard", "/");
const apiBase = `${strippedPath}api`;
const urlParams = new URLSearchParams(window.location.search);
let redirectUrl;
let autoRedirect = false;
redirectUrl = `${strippedPath}`;
if (urlParams.has("redirectParams")) {
    redirectUrl += atob(urlParams.get("redirectParams"));
    autoRedirect = true;
}

const isPopup = urlParams.get("popup");

let serverCheckHandle;

let authenticationType = "";
let authenticatedUser = "";
let token = "";
let tokenLifetime = -1;
let tokenExpiryTime = -1;
let serverRunning = false;
let notyf;

apiCall = async (callName, jsonBody, method, authRequired) => {
    const options = {
        method: method || "get"
    };
    if (method !== "get" && jsonBody) {
        options.body = JSON.stringify(jsonBody);
        options.headers = {"Content-Type": "application/json"}
    } else {
        options.headers = {};
    }

    if (token) {
        options.headers["Authorization"] = `Bearer ${token}`;
    }

    const currentTime = Date.now() / 1000;
    // If access token expires in under 10 seconds, attempt to refresh before making the call
    if (authRequired && tokenExpiryTime < currentTime + 10) {
        try {
            if (authenticationType === "local") {
                await refreshLocalToken();
            } else if (authenticationType === "google") {
                await refreshGoogleToken();
            } else if (authenticationType === "oidc") {
                await refreshOidcToken();
            }
        } catch (e) {
            console.log(e);
        }
    }
    return fetch(`${apiBase}/${callName}`, options);
}

function setToken(tokenString, expiresIn) {
    token = tokenString;
    tokenLifetime = expiresIn;
    if (isFinite(tokenLifetime) && tokenLifetime > 0) {
        console.log(`Token updated and valid for ${tokenLifetime.toFixed()} seconds`);
        const currentTimeSeconds = Date.now() / 1000;
        tokenExpiryTime = currentTimeSeconds + tokenLifetime;
    } else {
        clearToken();
    }
}

function clearToken() {
    console.log("Clearing token");
    token = undefined;
    tokenLifetime = -1;
}

showMessage = (message, error, elementId) => {
    const statusElement = document.getElementById(elementId || "carta-status");

    if (message) {
        statusElement.style.display = "block";
    } else {
        statusElement.style.display = "none";
        return;
    }

    if (error) {
        statusElement.className = "error-message";
    } else {
        statusElement.className = "success-message";
    }
    statusElement.innerHTML = message;
}

setButtonDisabled = (elementId, disabled) => {
    const button = document.getElementById(elementId);
    if (button) {
        button.disabled = disabled;
        if (disabled) {
            button.classList.add("button-disabled");
        } else {
            button.classList.remove("button-disabled")
        }
    }
}

updateServerStatus = async () => {
    let hasServer = false;
    try {
        const res = await apiCall("server/status", {}, "get", true);
        if (res.ok) {
            const body = await res.json();
            if (body.success && body.running) {
                hasServer = true;
            }
        } else if (res.status === 403) {
            console.log("Authentication has been lost");
            await handleLogout();
        }
    } catch (e) {
        console.log(e);
    }
    updateRedirectURL(hasServer);
    serverRunning = hasServer;
}

updateRedirectURL = (hasServer) => {
    if (hasServer) {
        showMessage("CARTA server running", false, "carta-status");
    } else {
        showMessage(`Logged in as ${authenticatedUser}`, false, "carta-status");
    }
}

handleLogin = async () => {
    setButtonDisabled("login", true);
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const body = {username, password};

    try {
        const res = await apiCall("auth/login", body, "post");
        if (res.ok) {
            const body = await res.json();
            setToken(body.access_token, body.expires_in || Number.MAX_VALUE);

            await onLoginSucceeded(username, "local");
        } else {
            onLoginFailed(res.status);
        }
    } catch (e) {
        onLoginFailed(500);
    }
    setButtonDisabled("login", false);
};

handleOidcLogin = async () => {
    const usp = new URLSearchParams();
    usp.set('client_id', document.getElementById("clientId").value);
    const authEndpoint = document.getElementById("authEndpoint").value;
    const clientId = document.getElementById("clientId").value;

    // Generate PKCE verifier & challenge
    const urlSafeChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
    const code_verifier = Array.from({length:64}, (_,i) => urlSafeChars[Math.floor(Math.random() * urlSafeChars.length)]).join("");
    sessionStorage.setItem("oidc_code_verifier", code_verifier);

    const array = new TextEncoder()
                    .encode(code_verifier);
    const buffer = await window.crypto.subtle.digest('SHA-256', array);

    const sha256_array = Array.from(new Uint8Array(buffer));
    const code_challenge = btoa(String.fromCharCode.apply(null, new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    usp.set('redirect_uri', strippedPath + 'dashboard');
    usp.set('response_type', 'code');
    usp.set('scope', document.getElementById("oidcScope") ? document.getElementById("oidcScope").value : "openid");
    usp.set('code_challenge_method', 'S256');
    usp.set('code_challenge', code_challenge);

    const oidcLoginUrl = authEndpoint + "?" + usp.toString();

    localStorage.removeItem("oidc_refresh_token");

    window.location.replace(oidcLoginUrl);
}

handleOidcCallback = async (code) => {
    const tokenEndpoint = document.getElementById("tokenEndpoint").value;

    const usp = new URLSearchParams();

    usp.set("grant_type", "authorization_code");
    usp.set("client_id", document.getElementById("clientId").value);
    usp.set("code", code);
    usp.set("code_verifier", sessionStorage.getItem("oidc_code_verifier"));
    usp.set("redirect_uri", strippedPath + 'dashboard');
    usp.set("scope", document.getElementById("oidcScope") ? document.getElementById("oidcScope").value : "openid");

    const options = {
        "method": "post",
        "headers": {
            "Content-Type": 'application/x-www-form-urlencoded'
        },
        "body": usp.toString()
    };

    try {
        res = await fetch(tokenEndpoint,options);

        if (res.ok) {
            const body = await res.json();

            setToken(body.access_token, body.expires_in || Number.MAX_VALUE);
            localStorage.setItem("oidc_refresh_token", body.refresh_token);
            localStorage.setItem("oidc_id_token", body.id_token);

            // Note that validation of the token signature and actual account mapping happens serverside
            b64_url = body.access_token.split('.')[1];
            b64 = b64_url.replace(/-/g, '+').replace(/_/g, '/');
            at_json = JSON.parse(atob(b64));
            sessionStorage.removeItem("oidc_code_verifier");
            if ('preferred_username' in at_json) {
                onLoginSucceeded(at_json.preferred_username, "oidc");
            } else {
                onLoginSucceeded(at_json.sub, "oidc");
            }
        }
        else {
            onLoginFailed(res.status);

        }
    } catch (e) {
        onLoginFailed(500);
        console.log(e)
    }

}

onLoginFailed = (status) => {
    clearToken();
    notyf.error(status === 403 ? "Invalid username/password combination" : "Could not authenticate correctly");
}

onLoginSucceeded = async (username, type) => {
    authenticatedUser = username;
    authenticationType = type;
    localStorage.setItem("authenticationType", type);
    notyf.success(`Logged in as ${authenticatedUser}`);
    if (autoRedirect) {
        handleOpenCarta();
    } else {
        showLoginForm(false);
        showCartaForm(true);
        clearInterval(serverCheckHandle);
        serverCheckHandle = setInterval(updateServerStatus, 5000);
        await updateServerStatus();
    }
}

handleServerStop = async () => {
    try {
        try {
            const res = await apiCall("server/stop", undefined, "post", true);
            const body = await res.json();
            if (body.success) {
                notyf.open({type: "info", message: "Stopped CARTA server successfully"});
                await updateServerStatus();
            } else {
                notyf.error("Failed to stop CARTA server");
                console.log(body.message);
            }
        } catch (e) {
            console.log(e);
        }
    } catch (e) {
        notyf.error("Failed to stop CARTA server");
        console.log(e);
    }
}

handleLogout = async () => {
    clearInterval(serverCheckHandle);
    if (authenticationType === "google") {
        await handleGoogleLogout();
    } else if (authenticationType === "local") {
        await handleLocalLogout();
    }
    if (serverRunning) {
        await handleServerStop();
    }
    showMessage();
    showCartaForm(false);
    showLoginForm(true);
    localStorage.removeItem("authenticationType");
    clearToken();

    // OIDC needs to redirect which should happen
    // after the clearToken + localStorage pruning
    if (authenticationType === "oidc") {
        handleOidcLogout();
    }
}

handleOpenCarta = () => {
    window.open(redirectUrl, "_self");
}

handleLog = async () => {
    // Disable log buttons for 5 seconds
    setButtonDisabled("show-logs", true);
    setButtonDisabled("refresh-logs", true);

    setTimeout(() => {
        setButtonDisabled("show-logs", false);
        setButtonDisabled("refresh-logs", false);
    }, 5000);

    try {
        const res = await apiCall("server/log", undefined, "get", true);
        const body = await res.json();
        if (body.success && body.log) {
            document.getElementById("log-modal").style.display = "block"
            document.getElementById("main-div").classList.add("blurred");
            const outputElement = document.getElementById("log-output");
            if (outputElement) {
                outputElement.innerText = body.log;
                outputElement.scrollTop = outputElement.scrollHeight;
            }
        } else {
            notyf.error("Failed to retrieve backend log");
            console.log(body.message);
        }
    } catch (e) {
        console.log(e);
    }
}

handleHideLog = () => {
    document.getElementById("log-modal").style.display = "none"
    document.getElementById("main-div").classList.remove("blurred");
}

initGoogleAuth = () => {
    gapi.load("auth2", function () {
        console.log("Google auth loaded");
        gapi.auth2.init();
    });
};

onSignIn = (googleUser) => {
    const profile = googleUser.getBasicProfile();
    const authResponse = googleUser.getAuthResponse();
    setToken(authResponse.id_token, authResponse.expires_in);
    onLoginSucceeded(profile.getEmail(), "google");
}

handleGoogleLogout = async () => {
    try {
        if (gapi && gapi.auth2) {
            const authInstance = gapi.auth2.getAuthInstance();
            if (authInstance) {
                await authInstance.disconnect();
            }
        }
    } catch (err) {
        notyf.error("Error signing out of Google");
        console.log(err);
    }
}

handleOidcLogout = async () => {
    // Implementing as per https://openid.net/specs/openid-connect-rpinitiated-1_0.html
    let rp_logout_redirect = document.getElementById("logoutURL").value;

    let usp = new URLSearchParams();
    usp.set('id_token_hint', localStorage.getItem("oidc_id_token"))
    usp.set('post_logout_redirect_uri', redirectUrl)

    localStorage.removeItem("oidc_refresh_token");
    localStorage.removeItem("oidc_id_token");

    window.location.replace(rp_logout_redirect + "?" + usp.toString())
}

handleLocalLogout = async () => {
    await apiCall("auth/logout", undefined, "post", false);
}

handleKeyup = (e) => {
    if (e.keyCode === 13) {
        const loginButton = document.getElementById("login");
        if (loginButton && !loginButton.disabled) {
            handleLogin();
        }
    }
}

refreshGoogleToken = async () => {
    try {
        if (gapi && gapi.auth2) {
            const authInstance = gapi.auth2.getAuthInstance();
            if (authInstance && authInstance.currentUser) {
                const user = authInstance.currentUser.get();
                if (user) {
                    const authResponse = await user.reloadAuthResponse();
                    if (authResponse && authResponse.id_token) {
                        setToken(authResponse.id_token, authResponse.expires_in);
                    }
                }
            }
        }
    } catch (err) {
        notyf.error("Error refreshing Google login");
        console.log(err);
    }
}

refreshLocalToken = async () => {
    try {
        const res = await apiCall("auth/refresh", {}, "post");
        if (res.ok) {
            const body = await res.json();
            if (body.access_token) {
                setToken(body.access_token, body.expires_in || Number.MAX_VALUE);
            }
        }
    } catch (err) {
        notyf.error("Error refreshing authentication");
        console.log(err);
    }
}

refreshOidcToken = async () => {
    try {
        const clientId = document.getElementById("clientId").value;
        const tokenEndpoint = document.getElementById("tokenEndpoint").value;

        const usp = new URLSearchParams();
        usp.set("grant_type", "refresh_token");
        usp.set("client_id", clientId);
        usp.set("refresh_token", localStorage.getItem("oidc_refresh_token"));

        const options = {
            "method": "post",
            "headers": {
                "Content-Type": 'application/x-www-form-urlencoded' 
            },
            "body": usp.toString(),
        };

        res = await fetch(tokenEndpoint,options);

        if (res.ok) {
            body = JSON.parse(await res.text())

            setToken(body.access_token, body.expires_in || Number.MAX_VALUE);
            localStorage.setItem("oidc_refresh_token", body.refresh_token);
            localStorage.setItem("oidc_id_token", body.id_token);
        } else {
            notyf.error("Error refreshing authentication");
        }
    } catch (err) {
        notyf.error("Error refreshing authentication");
        console.log(err);
    }
}

showCartaForm = (show) => {
    const cartaForm = document.getElementsByClassName("carta-form")[0];
    if (show) {
        cartaForm.style.display = "block";
    } else {
        cartaForm.style.display = "none";

    }
}

showLoginForm = (show) => {
    const loginForm = document.getElementsByClassName("login-form")[0];
    if (show) {
        loginForm.style.display = "block";
    } else {
        loginForm.style.display = "none";

    }
}

window.onload = async () => {
    notyf = new Notyf({
        ripple: true,
        position: {x: "center"},
        types: [{
            type: "warning",
            background: "orange"
        }, {
            type: "info",
            background: "#4c84af",
        }]
    });

    if (sessionStorage.getItem("oidc_code_verifier") !== null && urlParams.has('code')) {
        handleOidcCallback(urlParams.get('code'));
    }

    // Hide open button if using popup
    if (isPopup) {
        document.getElementById("open").style.display = "none";
    }
    const existingLoginType = localStorage.getItem("authenticationType");
    if (existingLoginType === "local") {
        try {
            const res = await apiCall("auth/refresh", {}, "post");
            if (res.ok) {
                const body = await res.json();
                if (body.access_token) {
                    setToken(body.access_token, body.expires_in || Number.MAX_VALUE);
                    await onLoginSucceeded(body.username, "local");
                } else {
                    await handleLogout();
                }
            }
        } catch (e) {
            console.log(e);
        }
    } else if (existingLoginType === "oidc"  && !urlParams.has('code')) {
        try {
            const clientId = document.getElementById("clientId").value;
            const tokenEndpoint = document.getElementById("tokenEndpoint").value;

            const usp = new URLSearchParams();
            usp.set("grant_type", "refresh_token");
            usp.set("client_id", clientId);
            usp.set("refresh_token", localStorage.getItem("oidc_refresh_token"));

            const options = {
                "method": "post",
                "headers": {
                    "Content-Type": 'application/x-www-form-urlencoded' 
                },
                "body": usp.toString(),
            };

            res = await fetch(tokenEndpoint,options);

            if (res.ok) {
                body = JSON.parse(await res.text())

                if (body.access_token) {
                    setToken(body.access_token, body.expires_in || Number.MAX_VALUE);
                    localStorage.setItem("oidc_refresh_token", body.refresh_token);
                    localStorage.setItem("oidc_id_token", body.id_token);

                    b64_url = body.access_token.split('.')[1];
                    b64 = b64_url.replace(/-/g, '+').replace(/_/g, '/');
                    at_json = JSON.parse(atob(b64));
                    if ('preferred_username' in at_json) {
                        onLoginSucceeded(at_json.preferred_username, "oidc");
                    } else {
                        onLoginSucceeded(at_json.sub, "oidc");
                    }
                } else {
                    await handleLogout();
                }
            }
        } catch (err) {
            notyf.error("Error refreshing authentication");
            console.log(err);
        }
    }

    // Wire up buttons and inputs
    const loginButton = document.getElementById("login");
    if (loginButton) {
        loginButton.onclick = handleLogin;
    }

    const usernameInput = document.getElementById("username");
    if (usernameInput) {
        usernameInput.onkeyup = handleKeyup;
    }

    const passwordInput = document.getElementById("password");
    if (passwordInput) {
        passwordInput.onkeyup = handleKeyup;
    }

    const oidcLoginButton = document.getElementById("oidcLogin");
    if (oidcLoginButton) {
        oidcLoginButton.onclick = handleOidcLogin;
    }

    document.getElementById("stop").onclick = handleServerStop;
    document.getElementById("open").onclick = handleOpenCarta;
    document.getElementById("show-logs").onclick = handleLog;
    document.getElementById("refresh-logs").onclick = handleLog;
    document.getElementById("hide-logs").onclick = handleHideLog;
    document.getElementById("logout").onclick = handleLogout;

}
